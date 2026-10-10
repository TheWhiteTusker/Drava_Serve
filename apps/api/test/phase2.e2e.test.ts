import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { businessDate } from '@fnb/shared';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx } from '../src/common.js';
import { closeAll, tenantSchema as t } from '../src/db/index.js';
import { stockTx } from '../src/stock.js';
import { setupFixture, type Fixture } from './fixture.js';
import { startApp } from './helpers.js';

// Phase 2 main flow: opening stock by count, write-offs with and without approval, transfers,
// expiry order, average cost, the last-portion race, reversals, the liquor register, live push.

let app: INestApplication;
let f: Fixture;
let sys: Ctx;

beforeAll(async () => {
  app = await startApp();
  await app.listen(0);
  f = await setupFixture(app, 'p2');
  sys = Ctx.system(f.cust.customer.id, f.db, 'test');
});

afterAll(async () => {
  await f?.drop();
  await app?.close();
  await closeAll();
});

describe('phase 2: inventory ledger', () => {
  it('opening stock enters through a stock count, approved directly by the owner', async () => {
    await f.opening('kitchen', { tomato: '1000', corn: '1000', tomatoBase: '10', cornBase: '10' });
    await f.opening('bar', { whiskyA: '300', whiskyB: '3000', whiskyC: '3000', whiskyD: '3000', whiskyE: '3000' });
    expect(await f.balance('tomato')).toBe('1000.000');
    expect(await f.balance('whiskyA', 'bar')).toBe('300.000');
  });

  it('shows portions available and status per menu item', async () => {
    const a = (await f.owner.get(`/inventory/availability?outletId=${f.outlet.id}`)).body;
    const soup = a.find((x: any) => x.menuItemId === f.m.tomatoSoup);
    expect(soup).toMatchObject({ portions: 4, status: 'low' }); // 1000 g ÷ 250 g, at or under 5 is "few left"
    expect(a.find((x: any) => x.menuItemId === f.m.whiskyA)).toMatchObject({ portions: 5, status: 'low' });
    expect(a.find((x: any) => x.menuItemId === f.m.whiskyB)).toMatchObject({ portions: 50, status: 'available' });
  });

  it('stock view shows each store, the total and the status against levels', async () => {
    const r = (await f.owner.get(`/inventory/stock?outletId=${f.outlet.id}`)).body;
    const tomato = r.items.find((i: any) => i.id === f.s.tomato);
    expect(tomato).toMatchObject({ total: '1000.000', status: 'critical', value: '20.00' });
    // The cashier cannot see stock at all.
    expect((await f.people.cashier.get(`/inventory/stock?outletId=${f.outlet.id}`)).status).toBe(403);
  });

  it("a storekeeper's write-off waits for a manager; the storekeeper cannot approve it", async () => {
    const r = await f.people.store.post('/inventory/movements', { storeId: f.store('kitchen'), stockItemId: f.s.tomato, qty: '100', movement: 'wastage', reason: 'Bruised' });
    expect(r.body.status).toBe('pending');
    expect(await f.balance('tomato')).toBe('1000.000');
    expect((await f.people.store.post(`/approvals/${r.body.id}/decide`, { approve: true })).status).toBe(403);
    const ok = await f.people.manager.post(`/approvals/${r.body.id}/decide`, { approve: true });
    expect(ok.body.status).toBe('approved');
    expect(await f.balance('tomato')).toBe('900.000');
    // Approving twice does nothing.
    expect((await f.people.manager.post(`/approvals/${r.body.id}/decide`, { approve: true })).status).toBe(409);
  });

  it("a chef's spillage goes straight in; a reason is required", async () => {
    expect((await f.people.chef.post('/inventory/movements', { storeId: f.store('bar'), stockItemId: f.s.whiskyB, qty: '30', movement: 'spillage', reason: '' })).status).toBe(400);
    const r = await f.people.chef.post('/inventory/movements', { storeId: f.store('bar'), stockItemId: f.s.whiskyB, qty: '30', movement: 'spillage', reason: 'Knocked over' });
    expect(r.body.status).toBe('applied');
    expect(await f.balance('whiskyB', 'bar')).toBe('2970.000');
  });

  it('a staff meal always needs an approver', async () => {
    const r = await f.people.chef.post('/inventory/movements', { storeId: f.store('kitchen'), stockItemId: f.s.corn, qty: '200', movement: 'staff_meal', reason: 'Lunch' });
    expect(r.body.status).toBe('pending');
  });

  it('transfers move stock between stores at the same cost, and refuse more than is there', async () => {
    const r = await f.people.store.post('/inventory/transfers', { fromStoreId: f.store('kitchen'), toStoreId: f.store('main'), lines: [{ stockItemId: f.s.tomato, qty: '100' }] });
    expect(r.status).toBe(201);
    expect(await f.balance('tomato')).toBe('800.000');
    expect(await f.balance('tomato', 'main')).toBe('100.000');
    const tooMuch = await f.people.store.post('/inventory/transfers', { fromStoreId: f.store('kitchen'), toStoreId: f.store('main'), lines: [{ stockItemId: f.s.tomato, qty: '5000' }] });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.message).toMatch(/Not enough Tomato/);
  });

  it('receipts move the weighted average cost; perishables are issued earliest expiry first', async () => {
    await stockTx(sys, (_tx, post) =>
      post([
        { storeId: f.store('main'), stockItemId: f.s.tomato, qty: '1000', unitCost: '0.05', movement: 'goods_receipt', expiresOn: '2026-12-31' },
        { storeId: f.store('main'), stockItemId: f.s.tomato, qty: '500', unitCost: '0.05', movement: 'goods_receipt', expiresOn: '2026-11-01' },
      ]),
    );
    const [bal] = await f.db.select().from(t.stockBalance).where(eq(t.stockBalance.storeId, f.store('main')));
    // 100 g at ₹0.02 + 1500 g at ₹0.05 → ₹0.048125 per g
    expect(bal.avgCost).toBe('0.048125');
    const { rows } = await stockTx(sys, (_tx, post) => post([{ storeId: f.store('main'), stockItemId: f.s.tomato, qty: '-800', movement: 'wastage', reason: 'test' }]));
    const lots = await f.db.select().from(t.stockLot).where(eq(t.stockLot.storeId, f.store('main')));
    const expiryOf = (id: string | null) => lots.find((l) => l.id === id)?.expiresOn ?? null;
    // 500 g expiring 1 Nov first, then 300 g from the 31 Dec lot. The 100 g that came by
    // transfer kept its kitchen expiry (3 days), which is sooner still, so it went first.
    expect(rows.map((r) => [expiryOf(r.lotId), r.qty])).toEqual([
      [expiryOf(rows[0].lotId), '-100.000'],
      ['2026-11-01', '-500.000'],
      ['2026-12-31', '-200.000'],
    ]);
  });

  it('two counters taking the last portion at the same moment: one wins, one is told it ran out', async () => {
    // 300 ml of Whisky A: five 60 ml pegs. Two counters each try to take 240 ml.
    const take = () => stockTx(sys, (_tx, post) => post([{ storeId: f.store('bar'), stockItemId: f.s.whiskyA, qty: '-240', movement: 'sale' }]));
    const results = await Promise.allSettled([take(), take()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason.message).toMatch(/Not enough Whisky A/);
    expect(await f.balance('whiskyA', 'bar')).toBe('60.000');
  });

  it('the balance always equals the sum of the ledger', async () => {
    const rows = await f.db.execute(
      `select b.store_id, b.stock_item_id, b.qty, coalesce(sum(l.qty), 0) as ledger
       from stock_balance b left join stock_ledger l on l.store_id = b.store_id and l.stock_item_id = b.stock_item_id
       group by b.store_id, b.stock_item_id, b.qty having b.qty <> coalesce(sum(l.qty), 0)`,
    );
    expect(rows.rows).toEqual([]);
  });

  it('a mistaken entry is corrected by a reversing entry, never edited', async () => {
    const [spill] = await f.db.select().from(t.stockLedger).where(eq(t.stockLedger.movement, 'spillage'));
    const r = await f.people.manager.post('/inventory/reversals', { ledgerId: spill.id, reason: 'Entered twice' });
    expect(r.body.status).toBe('applied');
    expect(await f.balance('whiskyB', 'bar')).toBe('3000.000');
    expect((await f.people.manager.post('/inventory/reversals', { ledgerId: spill.id, reason: 'again' })).status).toBe(409);
  });

  it('stock count variance is reported by item and cause, and corrected on approval', async () => {
    const c = (await f.people.store.post('/inventory/counts', { storeId: f.store('kitchen'), scheduledFor: '2026-10-10' })).body;
    const started = (await f.people.store.post(`/inventory/counts/${c.id}/start`)).body;
    expect(started.lines.find((l: any) => l.stockItemId === f.s.tomato).expectedQty).toBe('800.000');
    const entered = (await f.people.store.put(`/inventory/counts/${c.id}/lines`, [{ stockItemId: f.s.tomato, countedQty: '750', cause: 'Trimming' }])).body;
    expect(entered.lines.find((l: any) => l.stockItemId === f.s.tomato)).toMatchObject({ variance: '-50.000', cause: 'Trimming' });
    const sub = (await f.people.store.post(`/inventory/counts/${c.id}/submit`)).body;
    expect(sub.status).toBe('pending');
    await f.people.manager.post(`/approvals/${sub.id}/decide`, { approve: true });
    expect(await f.balance('tomato')).toBe('750.000');
  });

  it('prints the daily liquor register per label in bottles', async () => {
    const today = businessDate(new Date());
    const r = (await f.owner.get(`/inventory/liquor-register?outletId=${f.outlet.id}&date=${today}`)).body;
    const a = r.rows.find((x: any) => x.stockItemId === f.s.whiskyA);
    expect(a.ml).toMatchObject({ sales: '240.000', closing: '60.000' });
    expect(a.bottles.closing).toBe('0.08');
    expect(r.rows.some((x: any) => x.name === 'Tomato')).toBe(false);
  });

  it('pushes stock and availability changes live to devices at the outlet', async () => {
    const url = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const socket = connect(url, { path: '/api/socket', auth: { token: f.ownerToken }, transports: ['websocket'] });
    await new Promise((res) => socket.on('connect', res));
    await new Promise((res) => setTimeout(res, 200)); // let the server finish joining rooms
    const got = new Promise<any>((res) => socket.on('availability', res));
    await f.people.chef.post('/inventory/movements', { storeId: f.store('bar'), stockItemId: f.s.whiskyA, qty: '60', movement: 'spillage', reason: 'Dropped' });
    const ev = await got;
    expect(ev.items.find((i: any) => i.menuItemId === f.m.whiskyA)).toMatchObject({ portions: 0, status: 'out' });
    socket.close();
  });
});

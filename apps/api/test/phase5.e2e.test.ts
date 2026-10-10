import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { businessDate } from '@fnb/shared';
import { closeAll, tenantSchema as t } from '../src/db/index.js';
import { setupFixture, type Fixture } from './fixture.js';
import { startApp } from './helpers.js';

// Phase 5 main flow: a counter takes orders, the bill opens at the first order, more orders
// join it, payment deducts stock per recipe, offline bills arrive once, and anything that
// changes money after the fact needs a manager.

let app: INestApplication;
let f: Fixture;
let pos: Fixture['owner'];
let table: string;

const order = (bill: string, lines: { menuItemId: string; qty: string; priceCharged?: string }[], opts: { offline?: boolean; at?: Date; kind?: string; clientId?: string } = {}) =>
  pos.post('/pos/orders', {
    outletId: f.outlet.id,
    bill: { clientId: bill, kind: opts.kind ?? 'takeaway', tableId: opts.kind === 'dine_in' ? table : null },
    order: { clientId: opts.clientId ?? randomUUID(), placedAt: (opts.at ?? new Date()).toISOString(), lines },
    offline: !!opts.offline,
  });
const pay = (bill: string, amount: string, opts: { offline?: boolean; clientId?: string; mode?: string } = {}) =>
  pos.post('/pos/payments', { billClientId: bill, paidAt: new Date().toISOString(), payments: [{ clientId: opts.clientId ?? randomUUID(), mode: opts.mode ?? 'cash', amount }], offline: !!opts.offline });

beforeAll(async () => {
  app = await startApp();
  f = await setupFixture(app, 'p5');
  pos = f.people.cashier;
  await f.opening('kitchen', { tomato: '1000', corn: '1000', tomatoBase: '10', cornBase: '10' });
  await f.opening('bar', { whiskyA: '300', whiskyB: '3000', whiskyC: '3000' });
  [{ id: table }] = await f.db.insert(t.diningTable).values({ outletId: f.outlet.id, name: 'T1' }).returning();
});

afterAll(async () => {
  await f?.drop();
  await app?.close();
  await closeAll();
});

const bill1 = randomUUID();
const firstOrder = randomUUID();
const openedAt = new Date(Date.now() - 45 * 60_000);

describe('phase 5: billing POS', () => {
  it('the POS catalog has prices, order and stock, but no costs or margins', async () => {
    const c = (await pos.get(`/pos/catalog?outletId=${f.outlet.id}`)).body;
    expect(c.outlet).toMatchObject({ code: 'TST', fssaiNumber: '12345678901234' });
    expect(c.menu.find((m: any) => m.id === f.m.tomatoSoup)).toMatchObject({ price: '160.00', portions: 4, status: 'low', dietType: 'veg' });
    expect(JSON.stringify(c)).not.toMatch(/margin|portionCost|costAtSale|"cost"/i);
    expect((await f.people.watchman.get(`/pos/catalog?outletId=${f.outlet.id}`)).status).toBe(403);
  });

  it('the bill opens at the first order, at a table', async () => {
    const r = await order(bill1, [{ menuItemId: f.m.tomatoSoup, qty: '2' }], { kind: 'dine_in', at: openedAt, clientId: firstOrder });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'open', table: 'T1', foodSubtotal: '320.00', foodTax: '16.00', total: '336.00' });
    expect(new Date(r.body.openedAt).getTime()).toBe(openedAt.getTime());
  });

  it('the same order sent twice is stored once', async () => {
    const r = await order(bill1, [{ menuItemId: f.m.tomatoSoup, qty: '2' }], { kind: 'dine_in', at: openedAt, clientId: firstOrder });
    expect(r.body.lines).toHaveLength(1);
  });

  it('a later order joins the same bill; food and liquor are totalled separately', async () => {
    const r = (await order(bill1, [{ menuItemId: f.m.whiskyB, qty: '1' }], { kind: 'dine_in' })).body;
    expect(r.lines).toHaveLength(2);
    expect(r).toMatchObject({ foodSubtotal: '320.00', foodTax: '16.00', liquorSubtotal: '360.00', liquorTax: '0.00', total: '696.00' });
    expect(r.taxes.food.taxes.map((x: any) => x.name)).toEqual(['CGST', 'SGST']);
  });

  it('ordered portions are held back from what others can sell', async () => {
    const c = (await pos.get(`/pos/catalog?outletId=${f.outlet.id}`)).body;
    expect(c.menu.find((m: any) => m.id === f.m.tomatoSoup).portions).toBe(2);
  });

  it('two counters selling the last portions at once: one succeeds, the other is told it just sold out', async () => {
    const [a, b] = await Promise.all([order(randomUUID(), [{ menuItemId: f.m.tomatoSoup, qty: '2' }]), order(randomUUID(), [{ menuItemId: f.m.tomatoSoup, qty: '2' }])]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const lost = a.status === 409 ? a : b;
    expect(lost.body.message).toMatch(/Just sold out: Tomato Soup \(0 left\)/);
    expect(lost.body.soldOut[0]).toMatchObject({ menuItemId: f.m.tomatoSoup, portions: 0 });
  });

  it('payment closes the bill and deducts stock per recipe in one go; paying twice changes nothing', async () => {
    const payId = randomUUID();
    expect((await pay(bill1, '500')).status).toBe(400); // less than the bill
    const r = (await pay(bill1, '696', { clientId: payId })).body;
    expect(r).toMatchObject({ status: 'paid', businessDate: businessDate(new Date()) });
    expect(await f.balance('tomato')).toBe('500.000'); // 2 × 250 g
    expect(await f.balance('whiskyB', 'bar')).toBe('2940.000');
    await pay(bill1, '696', { clientId: payId });
    expect(await f.balance('tomato')).toBe('500.000');
    const sales = await f.db.select().from(t.stockLedger).where(and(eq(t.stockLedger.refId, r.id), eq(t.stockLedger.movement, 'sale')));
    expect(sales).toHaveLength(3); // tomato, soup base, whisky
  });

  it('time spent runs from the first order to payment', async () => {
    const [b] = await f.db.select().from(t.bill).where(eq(t.bill.clientId, bill1));
    expect((b.paidAt!.getTime() - b.openedAt.getTime()) / 60_000).toBeGreaterThanOrEqual(45);
  });

  it('bills taken offline arrive once, priced as on the device; a shortfall is recorded, not refused', async () => {
    const off = randomUUID();
    // The other counter already holds the last two portions; offline, the device still sells 5.
    const r = await order(off, [{ menuItemId: f.m.tomatoSoup, qty: '5', priceCharged: '150' }], { offline: true });
    expect(r.status).toBe(201);
    expect(r.body.lines[0]).toMatchObject({ price: '150.00' });
    const paid = (await pay(off, r.body.total, { offline: true })).body;
    expect(paid.status).toBe('paid');
    expect(Number(await f.balance('tomato'))).toBeLessThan(0); // the ledger shows the shortfall
  });

  it('beverage offers change the price silently on new bills; the bill shows only the price charged', async () => {
    const before = randomUUID();
    await order(before, [{ menuItemId: f.m.cornSoup, qty: '1' }]); // opened before the offer
    await f.owner.put('/settings', { outletId: f.outlet.id, key: 'offers.liquorEnabled', value: true }); // Whisky A has 5 serves: low
    await new Promise((r) => setTimeout(r, 20));
    const fresh = (await order(randomUUID(), [{ menuItemId: f.m.whiskyB, qty: '1' }])).body;
    expect(fresh.lines[0].price).toBe('324.00');
    const old = (await order(before, [{ menuItemId: f.m.whiskyB, qty: '1' }])).body;
    expect(old.lines.find((l: any) => l.menuItemId === f.m.whiskyB).price).toBe('360.00');
    const text = JSON.stringify(fresh);
    for (const word of ['menuPrice', 'activeDiscount', 'offer']) expect(text).not.toContain(word);
    // Behind the scenes the line keeps the menu price and the offer it came from.
    const [line] = await f.db.select().from(t.orderLine).where(eq(t.orderLine.id, fresh.lines[0].id));
    expect(line).toMatchObject({ menuPrice: '360.00', priceCharged: '324.00' });
    expect(line.activeDiscountId).toBeTruthy();
  });

  it('removing an item, a discount, a cancellation or a refund needs a manager', async () => {
    const b = randomUUID();
    const r = (await order(b, [{ menuItemId: f.m.cornSoup, qty: '1' }, { menuItemId: f.m.whiskyC, qty: '1' }])).body;
    const disc = (await pos.post(`/pos/bills/${r.id}/discount`, { discountPct: '10', reason: 'Regular guest' })).body;
    expect(disc.status).toBe('pending');
    expect((await pos.post(`/approvals/${disc.id}/decide`, { approve: true })).status).toBe(403);
    await f.people.manager.post(`/approvals/${disc.id}/decide`, { approve: true });
    const voided = (await pos.post(`/pos/bills/${r.id}/void`, { lineId: r.lines.find((l: any) => l.menuItemId === f.m.whiskyC).id, reason: 'Ordered by mistake' })).body;
    await f.people.manager.post(`/approvals/${voided.id}/decide`, { approve: true });
    const after = (await pos.get(`/pos/bills/${r.id}`)).body;
    // Corn soup ₹160 − 10% = ₹144 + GST 5% = ₹151.20 → ₹151
    expect(after).toMatchObject({ foodSubtotal: '160.00', manualDiscount: '16.00', total: '151.00' });
    expect(after.lines.find((l: any) => l.menuItemId === f.m.whiskyC).status).toBe('voided');

    const paid = (await pay(b, after.total)).body;
    const cornBefore = await f.balance('corn');
    const cancel = (await pos.post(`/pos/bills/${paid.id}/cancel`, { reason: 'Guest complaint' })).body;
    expect(cancel.status).toBe('pending');
    await f.people.manager.post(`/approvals/${cancel.id}/decide`, { approve: true });
    expect((await pos.get(`/pos/bills/${paid.id}`)).body.status).toBe('cancelled');
    expect(Number(await f.balance('corn'))).toBe(Number(cornBefore) + 200); // stock comes back

    const b2 = randomUUID();
    const r2 = (await order(b2, [{ menuItemId: f.m.cornSoup, qty: '1' }])).body;
    await pay(b2, r2.total, { mode: 'upi' });
    const refund = (await pos.post(`/pos/bills/${r2.id}/refund`, { amount: r2.total, mode: 'upi', reason: 'Wrong order' })).body;
    await f.people.manager.post(`/approvals/${refund.id}/decide`, { approve: true });
    expect((await pos.get(`/pos/bills/${r2.id}`)).body.status).toBe('refunded');
  });

  it('closes the day: open bills must be settled first, then totals by tax and payment mode', async () => {
    const today = businessDate(new Date());
    const blocked = await f.people.manager.post('/pos/day-close', { outletId: f.outlet.id, businessDate: today });
    expect(blocked.status).toBe(409);
    const open = (await f.people.manager.get(`/pos/bills?outletId=${f.outlet.id}&status=open`)).body;
    for (const b of open) await pay(b.clientId, b.total);
    const preview = (await f.people.manager.get(`/pos/day-close?outletId=${f.outlet.id}&date=${today}`)).body;
    expect(preview.totals.openBills).toBe(0);
    const closed = (await f.people.manager.post('/pos/day-close', { outletId: f.outlet.id, businessDate: today, cashCounted: preview.totals.byMode.cash })).body;
    expect(closed.totals).toMatchObject({ cancelled: 1, refunded: 1, cashDifference: '0.00' });
    expect(closed.totals.liquorRegister.length).toBeGreaterThan(0);
    expect((await f.people.manager.post('/pos/day-close', { outletId: f.outlet.id, businessDate: today })).status).toBe(409);
    expect((await pos.post('/pos/day-close', { outletId: f.outlet.id, businessDate: today })).status).toBe(403);
    // Offers end at day close.
    expect((await f.owner.get(`/offers?outletId=${f.outlet.id}&status=active`)).body).toEqual([]);
  });
});

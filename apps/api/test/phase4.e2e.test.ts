import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx } from '../src/common.js';
import { closeAll, tenantSchema as t } from '../src/db/index.js';
import { endOffersForDay } from '../src/pricing/offers.js';
import { recostAfterReceipt } from '../src/pricing/costing.js';
import { stockTx } from '../src/stock/ledger.js';
import { setupFixture, type Fixture } from './fixture.js';
import { client, startApp } from './helpers.js';

// Phase 4 main flow, built on the handoff's worked examples:
// - tomato from ₹20 to ₹50 a kg swaps Tomato Soup and Sweet Corn Soup (6.10)
// - Whisky A running low puts Whisky B and C on offer and skips D (6.9)

let app: INestApplication;
let f: Fixture;
let sys: Ctx;
const soups = async (who = f.owner) =>
  ((await who.get(`/menu/ranked?outletId=${f.outlet.id}`)).body as any[]).filter((i) => i.course === 'Soups and salads').map((i) => i.name);
const item = async (id: string) => ((await f.owner.get(`/menu/ranked?outletId=${f.outlet.id}`)).body as any[]).find((i) => i.id === id);

beforeAll(async () => {
  app = await startApp();
  f = await setupFixture(app, 'p4');
  sys = Ctx.system(f.cust.customer.id, f.db, 'test');
  await f.opening('kitchen', { tomato: '5000', corn: '5000', tomatoBase: '20', cornBase: '20' });
  // Whisky A: 240 ml = 4 serves (low). B–E: plenty.
  await f.opening('bar', { whiskyA: '240', whiskyB: '3000', whiskyC: '3000', whiskyD: '3000', whiskyE: '3000' });
  await f.owner.put('/margin-targets', { outletId: f.outlet.id, categoryId: null, targetPct: '70' });
  await f.owner.post('/offers/run', { outletId: f.outlet.id });
});

afterAll(async () => {
  await f?.drop();
  await app?.close();
  await closeAll();
});

describe('phase 4: costing, ranking and beverage offers', () => {
  it('costs each dish from its recipe and the latest billed rates', async () => {
    const c = (await f.owner.get(`/costing?outletId=${f.outlet.id}`)).body;
    expect(c.find((x: any) => x.id === f.m.tomatoSoup)).toMatchObject({ portionCost: '38.000000', marginAmount: '122.00', marginPct: '76.25', targetPct: '70.00', underTarget: false });
    expect(c.find((x: any) => x.id === f.m.cornSoup)).toMatchObject({ portionCost: '42.000000', marginPct: '73.75' });
  });

  it('ranks inside the course by margin %: Tomato Soup first at ₹20 tomato', async () => {
    expect(await soups()).toEqual(['Tomato Soup', 'Sweet Corn Soup']);
  });

  it('tomato at ₹50 a kg re-costs the soup (+₹7.50) and swaps the order', async () => {
    await stockTx(sys, async (tx, post) => {
      await post([{ storeId: f.store('kitchen'), stockItemId: f.s.tomato, qty: '1000', unitCost: '0.05', movement: 'goods_receipt' }]);
      await tx.update(t.stockItem).set({ currentCost: '0.05' }).where(eq(t.stockItem.id, f.s.tomato));
      await recostAfterReceipt(sys, tx, [f.s.tomato]);
    });
    const c = (await f.owner.get(`/costing?outletId=${f.outlet.id}`)).body.find((x: any) => x.id === f.m.tomatoSoup);
    expect(c).toMatchObject({ portionCost: '45.500000', marginPct: '71.56' });
    expect(await soups()).toEqual(['Sweet Corn Soup', 'Tomato Soup']);
  });

  it('flags a dish under target with a suggested price; the price changes only when a manager approves', async () => {
    await f.owner.put('/margin-targets', { outletId: f.outlet.id, categoryId: f.cat('Soups and salads'), targetPct: '75' });
    const [req] = await f.db.select().from(t.approvalRequest).where(and(eq(t.approvalRequest.type, 'price_change'), eq(t.approvalRequest.entityId, f.m.tomatoSoup)));
    expect(req.proposed).toMatchObject({ sellingPrice: '182.00' }); // 45.50 ÷ (1 − 75%)
    expect((await item(f.m.tomatoSoup)).price).toBe('160.00');
    await f.people.manager.post(`/approvals/${req.id}/decide`, { approve: true });
    expect((await item(f.m.tomatoSoup)).price).toBe('182.00');
    expect(await soups()).toEqual(['Tomato Soup', 'Sweet Corn Soup']); // 75.00% beats 73.75%
  });

  it('a sold-out dish drops below the ones still available, whatever its margin', async () => {
    await f.owner.post('/inventory/movements', { storeId: f.store('kitchen'), stockItemId: f.s.tomatoBase, qty: '20', movement: 'wastage', reason: 'Spoilt batch' });
    expect(await soups()).toEqual(['Sweet Corn Soup', 'Tomato Soup']);
    expect((await item(f.m.tomatoSoup)).status).toBe('out');
    await f.opening('kitchen', { tomatoBase: '20' });
    expect(await soups()).toEqual(['Tomato Soup', 'Sweet Corn Soup']);
  });

  it('a manager pin puts a dish first', async () => {
    await f.people.manager.put(`/menu-items/${f.m.cornSoup}/placement`, { pinPosition: 1, offerExcluded: false });
    expect(await soups()).toEqual(['Sweet Corn Soup', 'Tomato Soup']);
    await f.people.manager.put(`/menu-items/${f.m.cornSoup}/placement`, { pinPosition: null, offerExcluded: false });
  });

  it('a manager price change above the limit waits for approval; the owner sets prices freely', async () => {
    const current = (await f.people.manager.get(`/menu-items/${f.m.cornSoup}`)).body;
    const r = (await f.people.manager.put(`/menu-items/${f.m.cornSoup}`, { ...current, sellingPrice: '220' })).body;
    expect(r.priceApproval).toBeTruthy();
    expect(r.sellingPrice).toBe('160.00');
    const small = (await f.people.manager.put(`/menu-items/${f.m.cornSoup}`, { ...r, sellingPrice: '170' })).body;
    expect(small.sellingPrice).toBe('170.00'); // within 10%
    const own = (await f.owner.put(`/menu-items/${f.m.cornSoup}`, { ...small, sellingPrice: '160' })).body;
    expect(own.sellingPrice).toBe('160.00');
  });

  it("a chef's recipe change that pushes margin under target needs approval", async () => {
    const recipe = (await f.people.chef.get(`/menu-items/${f.m.cornSoup}/recipe`)).body;
    const heavier = recipe.lines.map((l: any) => ({ stockItemId: l.stockItemId, quantity: l.stockItemId === f.s.corn ? '600' : l.quantity, yieldPct: l.yieldPct }));
    const r = (await f.people.chef.put(`/menu-items/${f.m.cornSoup}/recipe`, { recipeVersion: recipe.recipeVersion, lines: heavier })).body;
    expect(r.status).toBe('pending');
    expect((await f.people.chef.put(`/menu-items/${f.m.cornSoup}/recipe`, { recipeVersion: 999, lines: heavier })).status).toBe(409);
    await f.people.manager.post(`/approvals/${r.approvalId}/decide`, { approve: true });
    const after = (await f.owner.get(`/menu-items/${f.m.cornSoup}/recipe`)).body;
    expect(after.portionCost).toBe('74.000000'); // 600 g × ₹0.08 + ₹26
  });

  it('no offers while the outlet switch is off', async () => {
    expect((await f.owner.get(`/offers?outletId=${f.outlet.id}&status=active`)).body).toEqual([]);
  });

  it('switching offers on: Whisky A (4 serves left) puts B and C on offer; D is under the margin floor; E is above the band', async () => {
    await f.owner.put('/settings', { outletId: f.outlet.id, key: 'offers.liquorEnabled', value: true });
    const offers = (await f.owner.get(`/offers?outletId=${f.outlet.id}&status=active`)).body;
    expect(offers.map((o: any) => [o.item, o.trigger, o.menuPrice, o.offerPrice]).sort()).toEqual([
      ['Whisky B 60 ml', 'Whisky A 60 ml', '360.00', '324.00'],
      ['Whisky C 60 ml', 'Whisky A 60 ml', '340.00', '306.00'],
    ]);
  });

  it('the price changes silently: the menu shows only the price to charge', async () => {
    const b = await item(f.m.whiskyB);
    expect(b.price).toBe('324.00');
    const guest = await client(app).get(`/public/menu/${f.cust.code}/TST`);
    expect(guest.status).toBe(200);
    const gb = guest.body.items.find((i: any) => i.name === 'Whisky B 60 ml');
    expect(gb.price).toBe('324.00');
    const text = JSON.stringify(guest.body);
    for (const word of ['menuPrice', 'offerPrice', 'discount', 'margin', 'cost', 'activeDiscount']) expect(text).not.toContain(word);
  });

  it('margins never reach the POS', async () => {
    expect((await f.people.cashier.get(`/costing?outletId=${f.outlet.id}`)).status).toBe(403);
    const pos = JSON.stringify((await f.people.cashier.get(`/menu/ranked?outletId=${f.outlet.id}`)).body);
    expect(pos).not.toMatch(/margin|portionCost|cost/i);
  });

  it('beverages keep type and brand order, not margin order', async () => {
    const names = ((await f.owner.get(`/menu/ranked?outletId=${f.outlet.id}`)).body as any[]).filter((i) => i.department === 'beverage').map((i) => i.name);
    expect(names).toEqual(['Whisky A 60 ml', 'Whisky B 60 ml', 'Whisky C 60 ml', 'Whisky D 60 ml', 'Whisky E 60 ml']);
  });

  it('restocking the low whisky above trigger + buffer ends its offers, logged with the reason', async () => {
    await f.opening('bar', { whiskyA: '600' }); // 10 serves > 5 + 3
    expect((await f.owner.get(`/offers?outletId=${f.outlet.id}&status=active`)).body).toEqual([]);
    const ended = (await f.owner.get(`/offers?outletId=${f.outlet.id}&status=ended`)).body;
    expect(ended.every((o: any) => o.endReason === 'restocked' && o.trigger === 'Whisky A 60 ml')).toBe(true);
    expect((await item(f.m.whiskyB)).price).toBe('360.00');
  });

  it('an excluded beverage is never promoted; offers end at day end and when switched off', async () => {
    await f.people.manager.put(`/menu-items/${f.m.whiskyC}/placement`, { pinPosition: null, offerExcluded: true });
    await f.people.chef.post('/inventory/movements', { storeId: f.store('bar'), stockItemId: f.s.whiskyA, qty: '360', movement: 'spillage', reason: 'test' });
    const active = (await f.owner.get(`/offers?outletId=${f.outlet.id}&status=active`)).body;
    expect(active.map((o: any) => o.item)).toEqual(['Whisky B 60 ml']);
    // The day-end job only ends offers that started before the new business day began.
    expect(await endOffersForDay(sys, f.outlet.id, new Date(Date.now() - 3600_000))).toBe(0);
    expect(await endOffersForDay(sys, f.outlet.id)).toBe(1);
    await f.owner.post('/offers/run', { outletId: f.outlet.id });
    expect((await f.owner.get(`/offers?outletId=${f.outlet.id}&status=active`)).body).toHaveLength(1);
    await f.owner.put('/settings', { outletId: f.outlet.id, key: 'offers.liquorEnabled', value: false });
    expect((await f.owner.get(`/offers?outletId=${f.outlet.id}&status=active`)).body).toEqual([]);
  });
});

describe('activity feed: what happened and why', () => {
  const feed = async (kind?: string) => (await f.owner.get(`/activity?outletId=${f.outlet.id}${kind ? `&kind=${kind}` : ''}`)).body as any[];

  it('explains each offer: which drink ran low, how many serves were left, and the new prices', async () => {
    const started = await feed('offer_started');
    expect(started.at(-1).message).toBe(
      'Whisky A 60 ml is running low (4 left), so 2 similar drinks are 10% off: Whisky C 60 ml ₹340 → ₹306 and Whisky B 60 ml ₹360 → ₹324.',
    );
    expect(started.at(-1).data).toMatchObject({ triggerName: 'Whisky A 60 ml', triggerServes: 4 });
  });

  it('explains why an offer ended', async () => {
    const ended = (await feed('offer_ended')).map((e: any) => e.message);
    expect(ended).toContain('Whisky A 60 ml was restocked (10 left), so Whisky C 60 ml is back to ₹340 and Whisky B 60 ml is back to ₹360.');
    expect(ended.some((m: string) => m.startsWith('The business day ended'))).toBe(true);
    expect(ended.some((m: string) => m.startsWith('Beverage offers were switched off for this outlet'))).toBe(true);
  });

  it('records dishes selling out and coming back, and price suggestions', async () => {
    const all = (await feed()).map((e: any) => e.message);
    expect(all).toContain('Tomato Soup has sold out. It is greyed out on the POS and the guest menu.');
    expect(all.some((m: string) => m.startsWith('Tomato Soup is available again'))).toBe(true);
    expect(all.some((m: string) => m.startsWith("Tomato Soup's margin fell to 71.56% (target 75%)"))).toBe(true);
  });

  it('is for owners and managers, not the counter; and cannot be edited', async () => {
    expect((await f.people.cashier.get(`/activity?outletId=${f.outlet.id}`)).status).toBe(403);
    await expect(f.db.execute('delete from activity')).rejects.toThrow();
  });
});

import type { INestApplication } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx } from '../src/common.js';
import { closeAll, tenantSchema as t } from '../src/db/index.js';
import { indentDueAt, tickCustomer } from '../src/jobs.js';
import { setupFixture, type Fixture } from './fixture.js';
import { startApp } from './helpers.js';

// Phase 3 main flow: nightly indent → vendor PDF → gate check → staff re-check → goods
// received note signed by both → stock at the billed rate → accounts pays.

let app: INestApplication;
let f: Fixture;
let veg: string;
let bar: string;
const units: Record<string, string> = {};

beforeAll(async () => {
  app = await startApp();
  f = await setupFixture(app, 'p3');
  await f.opening('kitchen', { tomato: '1000', corn: '1000', tomatoBase: '50', cornBase: '50' });
  await f.opening('bar', { whiskyB: '3000' });
  for (const k of ['tomato', 'corn', 'whiskyB']) units[k] = (await f.owner.get(`/stock-items/${f.s[k]}`)).body.units[0].id;
  veg = (await f.owner.post('/vendors', { name: 'Veg supplier', department: 'food' })).body.id;
  bar = (await f.owner.post('/vendors', { name: 'Liquor distributor', department: 'beverage' })).body.id;
  await f.owner.put(`/vendors/${veg}/items`, [
    { stockItemId: f.s.tomato, unitId: units.tomato, packSize: '1' },
    { stockItemId: f.s.corn, unitId: units.corn, packSize: '5' },
  ]);
  await f.owner.put(`/vendors/${bar}/items`, [{ stockItemId: f.s.whiskyB, unitId: units.whiskyB, packSize: '1' }]);
});

afterAll(async () => {
  await f?.drop();
  await app?.close();
  await closeAll();
});

let vegIndent: any;
let delivery: string;
let grn1: string;

describe('phase 3: purchasing and receiving', () => {
  it('the indent is due at the cut-off the evening before delivery', () => {
    expect(indentDueAt('2026-10-11', '23:00').toISOString()).toBe(new Date('2026-10-10T23:00:00+05:30').toISOString());
    expect(indentDueAt('2026-10-11', '01:00').toISOString()).toBe(new Date('2026-10-11T01:00:00+05:30').toISOString());
  });

  it('builds one indent per vendor: par − on hand − on order, rounded up to the pack', async () => {
    const r = (await f.people.manager.post('/indents/build', { outletId: f.outlet.id, forDate: '2026-10-20' })).body;
    expect(r.indents).toHaveLength(2);
    const list = (await f.people.manager.get(`/indents?outletId=${f.outlet.id}&forDate=2026-10-20`)).body;
    vegIndent = (await f.people.manager.get(`/indents/${list.find((i: any) => i.vendorId === veg).id}`)).body;
    const qty = (id: string) => vegIndent.lines.find((l: any) => l.stockItemId === id).suggestedQty;
    expect(qty(f.s.tomato)).toBe('9.000'); // 10 kg par − 1 kg → 9 kg
    expect(qty(f.s.corn)).toBe('5.000'); // 3 kg short, sold in 5 kg packs
    const barIndent = (await f.people.manager.get(`/indents/${list.find((i: any) => i.vendorId === bar).id}`)).body;
    expect(barIndent.lines[0].suggestedQty).toBe('2.000'); // 1500 ml short = 2 bottles
    expect(barIndent.lines[0].unit).toBe('bottle');
  });

  it('cannot send the PDF before approval; approval creates the delivery for the receiving app', async () => {
    expect((await f.people.manager.get(`/indents/${vegIndent.id}/pdf`)).status).toBe(400);
    const tomatoLine = vegIndent.lines.find((l: any) => l.stockItemId === f.s.tomato);
    await f.people.manager.put(`/indents/${vegIndent.id}/lines`, [{ id: tomatoLine.id, approvedQty: '9' }]);
    const r = await f.people.manager.post(`/indents/${vegIndent.id}/approve`);
    expect(r.body.status).toBe('approved');
    const deliveries = (await f.people.watchman.get(`/deliveries?outletId=${f.outlet.id}&date=2026-10-20`)).body;
    expect(deliveries).toHaveLength(1);
    delivery = deliveries[0].id;
  });

  it('what is already on order is not ordered again', async () => {
    await f.people.manager.post('/indents/build', { outletId: f.outlet.id, forDate: '2026-10-21' });
    const list = (await f.people.manager.get(`/indents?outletId=${f.outlet.id}&forDate=2026-10-21`)).body;
    expect(list.find((i: any) => i.vendorId === veg)).toBeUndefined(); // 1 kg + 9 kg on order = par
  });

  it('produces the vendor PDF and records every send attempt', async () => {
    const pdf = await f.people.manager.get(`/indents/${vegIndent.id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    await f.people.manager.post(`/indents/${vegIndent.id}/sends`, { channel: 'manual_share', method: 'share', ok: false, detail: 'share cancelled' });
    const r = (await f.people.manager.post(`/indents/${vegIndent.id}/sends`, { channel: 'manual_share', method: 'share', ok: true })).body;
    expect(r.status).toBe('sent');
    expect(r.sends.map((s: any) => [s.channel, s.result, s.user])).toEqual([
      ['manual_share', 'ok', 'manager'],
      ['manual_share', 'failed', 'manager'],
    ]);
  });

  it('gate check: the watchman sees quantities, never rates, and checks one line at a time', async () => {
    const d = (await f.people.watchman.get(`/deliveries/${delivery}`)).body;
    expect(d.lines.every((l: any) => l.billedRate === null)).toBe(true);
    const line = (id: string) => d.lines.find((l: any) => l.stockItemId === id).id;
    expect((await f.people.watchman.put(`/deliveries/${delivery}/gate/${line(f.s.corn)}`, { status: 'rejected' })).status).toBe(400);
    await f.people.watchman.put(`/deliveries/${delivery}/gate/${line(f.s.tomato)}`, { status: 'accepted' });
    await f.people.watchman.put(`/deliveries/${delivery}/gate/${line(f.s.corn)}`, { status: 'short', qty: '4' });
    // The watchman cannot do the staff re-check, and the cashier cannot gate check.
    expect((await f.people.watchman.put(`/deliveries/${delivery}/recheck/${line(f.s.tomato)}`, { acceptedQty: '9' })).status).toBe(403);
    expect((await f.people.cashier.put(`/deliveries/${delivery}/gate/${line(f.s.tomato)}`, { status: 'accepted' })).status).toBe(403);
    const done = (await f.people.watchman.post(`/deliveries/${delivery}/gate/complete`)).body;
    expect(done.status).toBe('gate_checked');
  });

  it('stores gate photos privately; the watchman cannot open the vendor bill photo', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const up = (who: any, purpose: string) =>
      who.post('/attachments').field('entity', 'receipt_check').field('entityId', delivery).field('purpose', purpose).attach('file', png, { filename: 'p.png', contentType: 'image/png' });
    const gate = await up(f.people.watchman, 'gate_photo');
    expect(gate.status).toBe(201);
    expect((await f.people.watchman.get(`/attachments/${gate.body.id}`)).status).toBe(200);
    const bill = await up(f.people.store, 'vendor_bill');
    expect((await f.people.watchman.get(`/attachments/${bill.body.id}`)).status).toBe(403);
    expect((await f.people.store.get(`/attachments/${bill.body.id}`)).status).toBe(200);
  });

  it('staff re-check: rejects spoiled stock with a reason, enters weights, expiry and the billed rate', async () => {
    const d = (await f.people.store.get(`/deliveries/${delivery}`)).body;
    const line = (id: string) => d.lines.find((l: any) => l.stockItemId === id).id;
    expect((await f.people.store.put(`/deliveries/${delivery}/recheck/${line(f.s.tomato)}`, { acceptedQty: '9', rejectedQty: '1', billedRate: '22' })).status).toBe(400); // more than came
    expect((await f.people.store.put(`/deliveries/${delivery}/recheck/${line(f.s.tomato)}`, { acceptedQty: '8.5', rejectedQty: '0.5', billedRate: '22' })).status).toBe(400); // no reason
    await f.people.store.put(`/deliveries/${delivery}/recheck/${line(f.s.tomato)}`, { acceptedQty: '8.5', rejectedQty: '0.5', reason: 'spoiled', measuredQty: '8.5', billedRate: '22', expiresOn: '2026-10-24' });
    expect((await f.people.store.post(`/deliveries/${delivery}/recheck/complete`, {})).status).toBe(400); // corn has no rate yet
    await f.people.store.put(`/deliveries/${delivery}/recheck/${line(f.s.corn)}`, { acceptedQty: '4', billedRate: '80' });
    const r = (await f.people.store.post(`/deliveries/${delivery}/recheck/complete`, { vendorBillNo: 'VB-1001' })).body;
    grn1 = r.grnId;
    const g = (await f.people.accounts.get(`/grns/${grn1}`)).body;
    // Bill = (8.5 + 0.5) × 22 + 4 × 80 = 518; the 0.5 kg returned (₹11) comes off the payable.
    expect(g).toMatchObject({ status: 'awaiting_signoff', amountGross: '518.00', returnDeduction: '11.00', amountPayable: '507.00', vendorBillNo: 'VB-1001' });
    expect(g.returns[0]).toMatchObject({ name: 'Tomato', qty: '0.500', reason: 'spoiled', amount: '11.00' });
  });

  it('nothing enters stock until both the watchman and the staff member sign', async () => {
    expect((await f.people.store.post(`/grns/${grn1}/confirm`, { as: 'staff' })).body.status).toBe('awaiting_signoff');
    expect(await f.balance('tomato')).toBe('1000.000');
    // The watchman's view of the note has no amounts.
    const seen = (await f.people.watchman.get(`/grns/${grn1}`)).body;
    expect(seen.amountPayable).toBeUndefined();
    expect(seen.lines[0].billedRate).toBeUndefined();
    expect((await f.people.watchman.post(`/grns/${grn1}/confirm`, { as: 'watchman' })).body.status).toBe('approved');
    expect(await f.balance('tomato')).toBe('9500.000');
    expect(await f.balance('corn')).toBe('5000.000');
    const [tomato] = await f.db.select().from(t.stockItem).where(eq(t.stockItem.id, f.s.tomato));
    expect(tomato.currentCost).toBe('0.022000'); // ₹22 / kg is now the latest billed rate
    const rates = (await f.owner.get(`/vendor-rates?stockItemId=${f.s.tomato}`)).body;
    expect(rates[0]).toMatchObject({ rate: '22.00', vendor: 'Veg supplier' });
    // Re-costed: 250 g × ₹0.022 + ₹33 base = ₹38.50
    const recipe = (await f.owner.get(`/menu-items/${f.m.tomatoSoup}/recipe`)).body;
    expect(recipe.portionCost).toBe('38.500000');
  });

  it('a billed rate far above the last one holds the note for a manager; accounts cannot pay it yet', async () => {
    await f.people.manager.post('/indents/build', { outletId: f.outlet.id, forDate: '2026-10-22' });
    // 9.5 kg on hand: 0.5 kg short → 1 kg
    const ind = (await f.people.manager.get(`/indents?outletId=${f.outlet.id}&forDate=2026-10-22`)).body.find((i: any) => i.vendorId === veg);
    await f.people.manager.post(`/indents/${ind.id}/approve`);
    const d2 = (await f.people.watchman.get(`/deliveries?outletId=${f.outlet.id}&date=2026-10-22`)).body.find((x: any) => x.vendorId === veg);
    const lines = (await f.people.watchman.get(`/deliveries/${d2.id}`)).body.lines;
    for (const l of lines) await f.people.watchman.put(`/deliveries/${d2.id}/gate/${l.id}`, { status: 'accepted' });
    await f.people.watchman.post(`/deliveries/${d2.id}/gate/complete`);
    for (const l of lines) await f.people.store.put(`/deliveries/${d2.id}/recheck/${l.id}`, { acceptedQty: l.orderedQty, billedRate: '50' });
    const { grnId } = (await f.people.store.post(`/deliveries/${d2.id}/recheck/complete`, {})).body;
    await f.people.watchman.post(`/grns/${grnId}/confirm`, { as: 'watchman' });
    expect((await f.people.store.post(`/grns/${grnId}/confirm`, { as: 'staff' })).body.status).toBe('held_rate');
    expect((await f.people.accounts.post(`/grns/${grnId}/payments`, { paidOn: '2026-10-23', mode: 'upi', amount: '50' })).status).toBe(409);
    const [req] = await f.db.select().from(t.approvalRequest).where(and(eq(t.approvalRequest.type, 'grn_rate_hold'), eq(t.approvalRequest.entityId, grnId)));
    expect((await f.people.manager.post(`/approvals/${req.id}/decide`, { approve: true })).body.status).toBe('approved');
    expect((await f.people.accounts.get(`/grns/${grnId}`)).body.status).toBe('approved');
  });

  it('the activity feed says when a delivery went into stock and when one was held', async () => {
    const feed = (await f.owner.get(`/activity?outletId=${f.outlet.id}`)).body.map((e: any) => e.message) as string[];
    expect(feed.some((m) => /^The delivery from Veg supplier went into stock \(GRN-TST-00001: (Tomato and Sweet corn|Sweet corn and Tomato)\)\. ₹507 is now due/.test(m))).toBe(true);
    expect(feed.some((m) => m.includes('is held for a manager: Tomato was billed ₹50, against ₹22 last time'))).toBe(true);
  });

  it('accounts records the payment and exports the notes', async () => {
    const r = (await f.people.accounts.post(`/grns/${grn1}/payments`, { paidOn: '2026-10-21', mode: 'bank_transfer', reference: 'UTR123', amount: '507' })).body;
    expect(r.status).toBe('paid');
    const csv = await f.people.accounts.get(`/grns/export/csv?outletId=${f.outlet.id}&from=2020-01-01&to=2030-01-01`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Veg supplier');
    expect(csv.text).toContain('UTR123');
  });

  it('the scheduler builds the nightly indent once, at the cut-off', async () => {
    const ctx = Ctx.system(f.cust.customer.id, f.db, 'test');
    await f.owner.put('/settings', { outletId: f.outlet.id, key: 'indent.cutoff', value: '22:30' });
    await tickCustomer(ctx, new Date('2026-10-24T22:00:00+05:30')); // before the cut-off
    expect(await f.db.select().from(t.jobRun).where(eq(t.jobRun.job, 'indent'))).toHaveLength(0);
    await tickCustomer(ctx, new Date('2026-10-24T22:31:00+05:30'));
    await tickCustomer(ctx, new Date('2026-10-24T22:32:00+05:30'));
    const runs = await f.db.select().from(t.jobRun).where(eq(t.jobRun.job, 'indent'));
    expect(runs.map((r) => r.key)).toEqual(['2026-10-25']);
  });
});

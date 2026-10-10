import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { unzipSync, strFromU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { businessDate } from '@fnb/shared';
import { backupCustomer, listBackups, restoreCustomer } from '../src/data.js';
import { closeAll } from '../src/db/index.js';
import { setupFixture, type Fixture } from './fixture.js';
import { startApp } from './helpers.js';

// Phase 6 main flow: paid bills roll up into the summary tables and every dashboard block,
// report and export reads from them; backups and data export work per customer.

let app: INestApplication;
let f: Fixture;
const today = businessDate(new Date());
let q: string;
let cancelId: string;

const sell = async (lines: { menuItemId: string; qty: string }[], minutesAgo: number, spent: number) => {
  const bill = randomUUID();
  const r = (
    await f.people.cashier.post('/pos/orders', {
      outletId: f.outlet.id, bill: { clientId: bill, kind: 'takeaway' },
      order: { clientId: randomUUID(), placedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(), lines },
    })
  ).body;
  // Paid `spent` minutes after the first order.
  return (
    await f.people.cashier.post('/pos/payments', {
      billClientId: bill, paidAt: new Date(Date.now() - (minutesAgo - spent) * 60_000).toISOString(),
      payments: [{ clientId: randomUUID(), mode: 'cash', amount: r.total }],
    })
  ).body;
};

beforeAll(async () => {
  app = await startApp();
  f = await setupFixture(app, 'p6');
  q = `outletId=${f.outlet.id}&from=${today}&to=${today}`;
  await f.opening('kitchen', { tomato: '5000', corn: '5000', tomatoBase: '50', cornBase: '50' });
  await f.opening('bar', { whiskyA: '3000', whiskyB: '3000' });
  await sell([{ menuItemId: f.m.tomatoSoup, qty: '2' }, { menuItemId: f.m.whiskyA, qty: '1' }], 120, 40); // ₹320 food, ₹320 liquor
  await sell([{ menuItemId: f.m.tomatoSoup, qty: '1' }, { menuItemId: f.m.cornSoup, qty: '1' }], 90, 20); // ₹320 food
  cancelId = (await sell([{ menuItemId: f.m.whiskyB, qty: '2' }], 60, 30)).id; // ₹720 liquor, cancelled below
  await f.people.chef.post('/inventory/movements', { storeId: f.store('kitchen'), stockItemId: f.s.tomato, qty: '100', movement: 'wastage', reason: 'Bruised' });
});

afterAll(async () => {
  await f?.drop();
  await app?.close();
  await closeAll();
});

describe('phase 6: dashboard and reports', () => {
  it('sales, bills, average bill and the food / beverage split come from the summaries', async () => {
    const d = (await f.owner.get(`/reports/dashboard?${q}`)).body;
    expect(d.sales).toMatchObject({ revenue: '1680.00', bills: 3, averageBill: '560.00' });
    expect(d.sales.byDepartment.food).toMatchObject({ revenue: '640.00' });
    expect(d.sales.byDepartment.beverage).toMatchObject({ revenue: '1040.00' });
    expect(d.totals).toMatchObject({ plates: 4, alcoholLitres: '0.18' }); // 60 + 120 ml
  });

  it('a cancelled paid bill leaves the dashboard', async () => {
    const c = (await f.people.cashier.post(`/pos/bills/${cancelId}/cancel`, { reason: 'Entered on the wrong counter' })).body;
    await f.people.manager.post(`/approvals/${c.id}/decide`, { approve: true });
    const d = (await f.owner.get(`/reports/dashboard?${q}`)).body;
    expect(d.sales).toMatchObject({ revenue: '960.00', bills: 2 });
    expect(d.totals.alcoholLitres).toBe('0.06');
  });

  it('margins by dish and course use the price charged and the cost at the time of sale', async () => {
    const d = (await f.owner.get(`/reports/dashboard?${q}`)).body;
    const soup = d.margins.dishes.find((x: any) => x.id === f.m.tomatoSoup);
    expect(soup).toMatchObject({ units: 3, revenue: '480.00', cost: '114.00', marginAmount: '366.00', marginPct: '76.25' });
    expect(d.margins.courses.find((c: any) => c.category === 'Soups and salads')).toMatchObject({ revenue: '640.00' });
  });

  it('filters by Food or Beverage', async () => {
    const d = (await f.owner.get(`/reports/dashboard?${q}&department=food`)).body;
    expect(d.sales.revenue).toBe('640.00');
    expect(d.margins.dishes.every((x: any) => x.department === 'food')).toBe(true);
  });

  it('weekday-by-hour demand for an item, top sellers, and time spent by hour', async () => {
    const d = (await f.owner.get(`/reports/dashboard?${q}&itemId=${f.m.tomatoSoup}`)).body;
    expect(d.demand.reduce((a: number, g: any) => a + g.units, 0)).toBe(3);
    expect(d.demand[0].weekday).toBe(new Date(`${today}T12:00:00+05:30`).getDay() || 7);
    expect(d.top.dishesByUnits[0]).toMatchObject({ name: 'Tomato Soup', units: 3 });
    const minutes = d.timeSpent.reduce((a: number, h: any) => a + h.averageMinutes * h.bills, 0) / d.timeSpent.reduce((a: number, h: any) => a + h.bills, 0);
    expect(minutes).toBe(30); // (40 + 20) / 2
  });

  it('stock value for Food and Beverage, wastage, and low or out items', async () => {
    const d = (await f.owner.get(`/reports/dashboard?${q}`)).body;
    expect(Number(d.stock.value.food)).toBeGreaterThan(0);
    expect(Number(d.stock.value.beverage)).toBeGreaterThan(0);
    expect(d.stock.wastage).toEqual([{ department: 'food', movement: 'wastage', value: '2.00', entries: 1 }]);
    expect(d.stock.lowOut.some((x: any) => x.name === 'Whisky C 60 ml' && x.status === 'out')).toBe(true);
  });

  it('the monthly menu engineering report sorts dishes into four groups; pour cost for the bar', async () => {
    const r = (await f.owner.get(`/reports/menu-engineering?outletId=${f.outlet.id}&month=${today.slice(0, 7)}`)).body;
    expect(r.food.map((x: any) => x.class).every((c: string) => ['star', 'plowhorse', 'puzzle', 'dog'].includes(c))).toBe(true);
    expect(r.food.find((x: any) => x.name === 'Tomato Soup')).toMatchObject({ units: 3, popular: true });
    // Whisky A: cost ₹100 per peg, sold at ₹320 → 31.25%
    expect(r.pourCost).toMatchObject({ liquorCost: '100.00', liquorSales: '320.00', pct: '31.25' });
  });

  it('day-close totals, stock variance and the liquor register export as CSV', async () => {
    await f.people.manager.post('/pos/day-close', { outletId: f.outlet.id, businessDate: today, cashCounted: '1000' });
    const day = await f.owner.get(`/reports/day-close?${q}&format=csv`);
    expect(day.headers['content-type']).toMatch(/text\/csv/);
    expect(day.text.split('\n')[0]).toContain('food_sales');
    expect(day.text).toContain(',8.00,'); // counted ₹1000 against ₹992 cash taken
    const variance = await f.owner.get(`/reports/stock-variance?outletId=${f.outlet.id}&from=2026-01-01&to=2030-01-01&format=csv`);
    expect(variance.text).toContain('Opening stock');
    const reg = await f.owner.get(`/reports/liquor-register?outletId=${f.outlet.id}&from=${today}&format=csv`);
    expect(reg.text).toContain('Whisky A 750 ml');
    expect((await f.people.cashier.get(`/reports/dashboard?${q}`)).status).toBe(403);
  });

  it('the owner can download all of the business data; hashes are left out', async () => {
    const r = await f.owner.get('/data/export').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.headers['content-type']).toBe('application/zip');
    const files = unzipSync(new Uint8Array(r.body as Buffer));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['bill.csv', 'stock_ledger.csv', 'app_user.csv', 'README.txt']));
    expect(strFromU8(files['app_user.csv'])).not.toContain('password_hash');
    expect((await f.people.manager.get('/data/export')).status).toBe(403);
  });

  const hasPgDump = (() => {
    try {
      execFileSync('pg_dump', ['--version']);
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!hasPgDump)('backs up and restores one customer database', async () => {
    const r = await backupCustomer(f.cust.customer);
    expect((await listBackups(f.cust.code)).map((b) => b.key)).toContain(r.key);
    expect(await restoreCustomer(f.cust.code)).toBe(r.key);
  });
});

import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAll, resolveCustomer } from '../src/db/index.js';
import { client, signIn, startApp, tempCustomer } from './helpers.js';

// Settings at business and outlet level, and the append-only history tables.

let app: INestApplication;
let A: Awaited<ReturnType<typeof tempCustomer>>;
let ownerA: ReturnType<typeof client>;
let outletId: string;
let otherOutletId: string;

beforeAll(async () => {
  app = await startApp();
  A = await tempCustomer('s');
  ownerA = client(app, await signIn(app, A.login, A.password));
  outletId = (await ownerA.post('/outlets', { name: 'Koramangala', code: 'KOR', state: 'Karnataka' })).body.id;
  otherOutletId = (await ownerA.post('/outlets', { name: 'Jayanagar', code: 'JAY', state: 'Karnataka' })).body.id;
  await ownerA.post('/stock-items', { name: 'Tomato', department: 'food', baseUnit: 'g', currentCost: '0.02', units: [], levels: [] });
});

afterAll(async () => {
  await A?.drop();
  await app?.close();
  await closeAll();
});

describe('settings and history', () => {
  it('settings: indent cut-off defaults to 23:00 and can be set per customer and per outlet', async () => {
    expect((await ownerA.get('/settings')).body.effective['indent.cutoff']).toBe('23:00');
    await ownerA.put('/settings', { outletId: null, key: 'indent.cutoff', value: '22:30' });
    expect((await ownerA.get(`/settings?outletId=${outletId}`)).body.effective['indent.cutoff']).toBe('22:30');
    await ownerA.put('/settings', { outletId, key: 'indent.cutoff', value: '23:15' });
    expect((await ownerA.get(`/settings?outletId=${outletId}`)).body.effective['indent.cutoff']).toBe('23:15');
    expect((await ownerA.get(`/settings?outletId=${otherOutletId}`)).body.effective['indent.cutoff']).toBe('22:30');
    expect((await ownerA.put('/settings', { outletId, key: 'indent.cutoff', value: '25:00' })).status).toBe(400);
    // The liquor offer switch is per outlet, off by default.
    expect((await ownerA.get(`/settings?outletId=${outletId}`)).body.effective['offers.liquorEnabled']).toBe(false);
    expect((await ownerA.put('/settings', { outletId: null, key: 'offers.liquorEnabled', value: true })).status).toBe(400);
  });

  it('the stock ledger and audit log refuse edits and deletes', async () => {
    const { db } = (await resolveCustomer(A.customer.id))!;
    const [store] = (await db.execute(sql`select id from store limit 1`)).rows as any[];
    const [item] = (await db.execute(sql`select id from stock_item limit 1`)).rows as any[];
    await db.execute(sql`insert into stock_ledger (outlet_id, store_id, stock_item_id, qty, unit_cost, movement)
      values (${outletId}, ${store.id}, ${item.id}, 1000, 0.02, 'opening')`);
    await expect(db.execute(sql`update stock_ledger set qty = 5`)).rejects.toThrow();
    await expect(db.execute(sql`delete from stock_ledger`)).rejects.toThrow();
    await expect(db.execute(sql`delete from audit_log`)).rejects.toThrow();
  });
});

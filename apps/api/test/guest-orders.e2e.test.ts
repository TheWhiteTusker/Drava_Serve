import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAll, tenantSchema as t } from '../src/db/index.js';
import { publicCache } from '../src/pricing.controller.js';
import { setupFixture, type Fixture } from './fixture.js';
import { client, startApp } from './helpers.js';

// Ordering from the table QR menu: a guest's order waits for a cashier, who accepts it onto the
// table's bill (priced and stock-checked like any order) or turns it down with a reason.

let app: INestApplication;
let f: Fixture;
let guest: ReturnType<typeof client>;
let base: string;
let t1: string;
let t2: string;

const send = (tableId: string, lines: { menuItemId: string; qty: number }[], clientId = randomUUID()) =>
  guest.post(`/public/orders/${base}`, { clientId, tableId, lines });

beforeAll(async () => {
  app = await startApp();
  f = await setupFixture(app, 'go');
  guest = client(app);
  base = `${f.cust.code}/${f.outlet.code}`;
  await f.opening('kitchen', { tomato: '1000', tomatoBase: '10' }); // no corn: Sweet Corn Soup is sold out
  [{ id: t1 }, { id: t2 }] = await f.db.insert(t.diningTable).values([{ outletId: f.outlet.id, name: 'T1' }, { outletId: f.outlet.id, name: 'T2' }]).returning();
});

afterAll(async () => {
  await f?.drop();
  await app?.close();
  await closeAll();
});

describe('guest ordering from the table QR menu', () => {
  it('only a table QR code can order; the outlet QR code is the menu alone', async () => {
    expect((await guest.get(`/public/menu/${base}?table=${t1}`)).body).toMatchObject({ table: { id: t1, name: 'T1' }, ordering: true });
    expect((await guest.get(`/public/menu/${base}`)).body).toMatchObject({ table: null, ordering: false });
    expect((await guest.get(`/public/menu/${base}?table=${randomUUID()}`)).body.ordering).toBe(false);
    expect((await send(randomUUID(), [{ menuItemId: f.m.tomatoSoup, qty: 1 }])).status).toBe(404);
  });

  let first: string;
  it('an order waits for staff, and a resend is stored once', async () => {
    const clientId = randomUUID();
    const r = await send(t1, [{ menuItemId: f.m.tomatoSoup, qty: 2 }], clientId);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('pending');
    first = r.body.id;
    expect((await send(t1, [{ menuItemId: f.m.tomatoSoup, qty: 2 }], clientId)).body.id).toBe(first);
    const list = (await f.people.cashier.get(`/pos/guest-orders?outletId=${f.outlet.id}`)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: first, table: 'T1', lines: [{ menuItemId: f.m.tomatoSoup, qty: 2 }] });
    expect((await f.people.watchman.get(`/pos/guest-orders?outletId=${f.outlet.id}`)).status).toBe(403);
  });

  it('sold-out items and silly quantities are refused', async () => {
    const r = await send(t2, [{ menuItemId: f.m.cornSoup, qty: 1 }]);
    expect(r.status).toBe(409);
    expect(r.body.soldOut).toEqual([f.m.cornSoup]);
    expect((await send(t2, [{ menuItemId: f.m.tomatoSoup, qty: 500 }])).status).toBe(400);
  });

  let bill: any;
  it('accepting opens the table bill at today\'s price; the guest sees it confirmed', async () => {
    const r = await f.people.cashier.post(`/pos/guest-orders/${first}/accept`, { bill: { clientId: randomUUID() } });
    expect(r.status).toBe(201);
    bill = r.body;
    expect(bill).toMatchObject({ status: 'open', table: 'T1', kind: 'dine_in', foodSubtotal: '320.00', total: '336.00' });
    expect(bill.number).toMatch(/^TST-\d{8}-S\d{3}$/); // numbered by the server
    expect((await guest.get(`/public/orders/${base}/${first}`)).body).toMatchObject({ status: 'accepted', reason: null });
    expect((await f.people.cashier.post(`/pos/guest-orders/${first}/accept`, { bill: { clientId: randomUUID() } })).status).toBe(409);
  });

  it('a later order from the same table joins its running bill', async () => {
    const g = (await send(t1, [{ menuItemId: f.m.tomatoSoup, qty: 1 }])).body.id;
    const r = await f.people.cashier.post(`/pos/guest-orders/${g}/accept`, { bill: { clientId: bill.clientId, number: bill.number } });
    expect(r.body).toMatchObject({ id: bill.id, foodSubtotal: '480.00' });
    expect(r.body.lines).toHaveLength(2);
    // ...but never another table's bill.
    const other = (await send(t2, [{ menuItemId: f.m.tomatoSoup, qty: 1 }])).body.id;
    expect((await f.people.cashier.post(`/pos/guest-orders/${other}/accept`, { bill: { clientId: bill.clientId } })).status).toBe(400);
    await f.people.cashier.post(`/pos/guest-orders/${other}/reject`, {});
  });

  it('turning an order down tells the guest why', async () => {
    const g = (await send(t2, [{ menuItemId: f.m.tomatoSoup, qty: 1 }])).body.id;
    expect((await f.people.cashier.post(`/pos/guest-orders/${g}/reject`, { reason: 'Kitchen closes at 11' })).status).toBe(201);
    expect((await guest.get(`/public/orders/${base}/${g}`)).body).toMatchObject({ status: 'rejected', reason: 'Kitchen closes at 11' });
    expect((await f.people.cashier.post(`/pos/guest-orders/${g}/accept`, { bill: { clientId: randomUUID() } })).status).toBe(409);
  });

  it('a table can have only a few orders waiting', async () => {
    for (let i = 0; i < 3; i++) expect((await send(t2, [{ menuItemId: f.m.tomatoSoup, qty: 1 }])).status).toBe(201);
    expect((await send(t2, [{ menuItemId: f.m.tomatoSoup, qty: 1 }])).status).toBe(429);
  });

  it('the demo switch lets the outlet menu offer its tables; it is off unless turned on', async () => {
    expect((await guest.get(`/public/menu/${base}`)).body.tables).toBeUndefined();
    await f.owner.put('/settings', { outletId: f.outlet.id, key: 'guest.pickTable', value: true });
    publicCache.clear();
    expect((await guest.get(`/public/menu/${base}`)).body).toMatchObject({ pickTable: true, tables: [{ id: t1, name: 'T1' }, { id: t2, name: 'T2' }] });
    expect((await guest.get(`/public/menu/${base}?table=${t1}`)).body).toMatchObject({ pickTable: true, ordering: true, table: { name: 'T1' } });
  });

  it('the outlet can switch ordering off', async () => {
    await f.owner.put('/settings', { outletId: f.outlet.id, key: 'guest.ordering', value: false });
    publicCache.clear(); // otherwise it applies within 15 s
    expect((await guest.get(`/public/menu/${base}?table=${t1}`)).body.ordering).toBe(false);
    expect((await send(t1, [{ menuItemId: f.m.tomatoSoup, qty: 1 }])).status).toBe(403);
    expect((await guest.get(`/public/menu/${base}`)).body.tables).toBeUndefined(); // no picking when ordering is off
  });
});

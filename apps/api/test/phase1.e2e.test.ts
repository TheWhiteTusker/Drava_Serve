import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAll, migrateAll, resolveCustomer } from '../src/db/index.js';
import { outbox } from '../src/mail.js';
import { client, signIn, startApp, tempCustomer } from './helpers.js';

// Phase 1 main flow: a customer sets up outlets, people, roles and the catalog, and every
// rule around separation, permissions, versions and audit holds.

let app: INestApplication;
let A: Awaited<ReturnType<typeof tempCustomer>>;
let B: Awaited<ReturnType<typeof tempCustomer>>;
let ownerA: ReturnType<typeof client>;
let ownerB: ReturnType<typeof client>;
let outletId: string;
let otherOutletId: string;
let menuItemId: string;

beforeAll(async () => {
  app = await startApp();
  [A, B] = [await tempCustomer('a'), await tempCustomer('b')];
  ownerA = client(app, await signIn(app, A.login, A.password), 'tablet-1');
  ownerB = client(app, await signIn(app, B.login, B.password));
});

afterAll(async () => {
  await A?.drop();
  await B?.drop();
  await app?.close();
  await closeAll();
});

describe('phase 1: foundation', () => {
  it('migrates every customer database with one call', async () => {
    expect(await migrateAll(() => {})).toBeGreaterThanOrEqual(2);
  });

  it('creates an outlet with main, kitchen and bar stores', async () => {
    const r = await ownerA.post('/outlets', { name: 'Koramangala', code: 'KOR', state: 'Karnataka', fssaiNumber: '12345678901234' });
    expect(r.status).toBe(201);
    outletId = r.body.id;
    const stores = await ownerA.get(`/outlets/${outletId}/stores`);
    expect(stores.body.map((s: any) => s.kind).sort()).toEqual(['bar', 'kitchen', 'main']);
    otherOutletId = (await ownerA.post('/outlets', { name: 'Jayanagar', code: 'JAY', state: 'Karnataka' })).body.id;
  });

  it('rejects an FSSAI number that is not 14 digits', async () => {
    const r = await ownerA.post('/outlets', { name: 'Bad', code: 'BAD', fssaiNumber: '123' });
    expect(r.status).toBe(400);
  });

  it('new customers start with the seed roles, courses, liquor tree and tax classes', async () => {
    const roles = await ownerA.get('/roles');
    expect(roles.body.map((r: any) => r.name)).toEqual(
      expect.arrayContaining(['Owner / admin', 'Outlet manager', 'Watchman', 'Storekeeper / kitchen staff', 'Chef / bar manager', 'Cashier', 'Accounts']),
    );
    const watchman = roles.body.find((r: any) => r.name === 'Watchman');
    expect(watchman.permissions).toEqual(['receiving.gate']);
    const tree = (await ownerA.get('/catalog/liquor-tree')).body;
    expect(tree.find((x: any) => x.name === 'Whisky').subtypes.map((s: any) => s.name)).toContain('Single malt');
    const cats = (await ownerA.get('/categories')).body.filter((c: any) => c.kind === 'course');
    expect(cats.map((c: any) => c.name)).toEqual([
      'Starters', 'Appetizers', 'Soups and salads', 'Main course', 'Breads and rice', 'Sides', 'Desserts',
    ]);
    // Beverages: alcoholic on the liquor tree, non-alcoholic under drink types.
    const drinks = (await ownerA.get('/categories')).body.filter((c: any) => c.kind === 'drink_type');
    expect(drinks.map((c: any) => c.name)).toEqual(['Soft drinks', 'Juices and shakes', 'Mocktails', 'Tea and coffee', 'Water']);
  });

  it('stock items hold base units, purchase-unit conversions and per-outlet levels', async () => {
    const r = await ownerA.post('/stock-items', {
      name: 'Tomato', department: 'food', baseUnit: 'g', perishable: true, currentCost: '0.02',
      units: [{ name: 'kg', factor: '1000', isDefault: true }],
      levels: [{ outletId, parLevel: '10000', reorderLevel: '5000', criticalLevel: '2000' }],
    });
    expect(r.status).toBe(201);
    const item = (await ownerA.get(`/stock-items/${r.body.id}`)).body;
    expect(item.units[0]).toMatchObject({ name: 'kg', factor: '1000.000' });
    expect(item.levels[0]).toMatchObject({ outletId, parLevel: '10000.000' });
    // Money and quantities come back exactly, as decimals in strings.
    expect(item.currentCost).toBe('0.020000');
  });

  it('food items need a diet type; tax class is set on the item', async () => {
    const course = (await ownerA.get('/categories')).body.find((c: any) => c.name === 'Soups and salads');
    const tax = (await ownerA.get('/tax-classes')).body.find((x: any) => x.code === 'FOOD_GST5');
    const base = { outletId, name: 'Tomato Soup', department: 'food', categoryId: course.id, sellingPrice: '160', taxClassId: tax.id };
    expect((await ownerA.post('/menu-items', base)).status).toBe(400);
    const r = await ownerA.post('/menu-items', { ...base, dietType: 'veg', allergens: ['milk'], tags: ['cuisine:Continental'] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ sellingPrice: '160.00', version: 1, allergens: ['milk'] });
    menuItemId = r.body.id;
  });

  it('beverages are alcoholic (liquor tree) or non-alcoholic (drink type), never under a food course', async () => {
    const cats = (await ownerA.get('/categories')).body;
    const tax = (await ownerA.get('/tax-classes')).body.find((x: any) => x.code === 'FOOD_GST5');
    const base = { outletId, name: 'Fresh Lime Soda', department: 'beverage', sellingPrice: '110', taxClassId: tax.id };
    expect((await ownerA.post('/menu-items', { ...base, categoryId: cats.find((c: any) => c.name === 'Desserts').id })).status).toBe(400);
    expect((await ownerA.post('/menu-items', { ...base, categoryId: cats.find((c: any) => c.name === 'Soft drinks').id })).status).toBe(201);
  });

  it('stops two people overwriting each other (version check)', async () => {
    const item = (await ownerA.get(`/menu-items/${menuItemId}`)).body;
    const first = await ownerA.put(`/menu-items/${menuItemId}`, { ...item, sellingPrice: '170' });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(2);
    const stale = await ownerA.put(`/menu-items/${menuItemId}`, { ...item, sellingPrice: '180' });
    expect(stale.status).toBe(409);
  });

  it('records who, when, which device, before and after', async () => {
    const log = (await ownerA.get(`/audit?entity=menu_item&entityId=${menuItemId}`)).body;
    const update = log.find((l: any) => l.action === 'update');
    expect(update.before.selling_price).toBe(160);
    expect(update.after.selling_price).toBe(170);
    expect(update.deviceId).toBe('tablet-1');
    expect(update.userName).toBe('Test owner');
    expect(update.outletId).toBe(outletId);
  });

  describe('permissions are enforced in the API and scoped to outlets', () => {
    let staff: ReturnType<typeof client>;

    beforeAll(async () => {
      const roles = (await ownerA.get('/roles')).body;
      const editor = await ownerA.post('/roles', { name: 'Menu editor (no prices)', permissions: ['catalog.view', 'catalog.manage'] });
      const cashier = roles.find((r: any) => r.name === 'Cashier');
      const u = await ownerA.post('/users', {
        name: 'Staff One', login: `staff@${A.code}.test`, password: 'Passw0rd!', pin: '4321',
        roles: [{ roleId: editor.body.id, outletId }, { roleId: cashier.id, outletId }],
      });
      expect(u.status).toBe(201);
      staff = client(app, await signIn(app, `staff@${A.code}.test`, 'Passw0rd!'));
    });

    it('cannot manage users without the permission', async () => {
      expect((await staff.get('/users')).status).toBe(403);
      expect((await staff.post('/roles', { name: 'Sneaky', permissions: ['users.manage'] })).status).toBe(403);
    });

    it('only sees and edits its own outlet', async () => {
      const list = (await staff.get('/menu-items')).body;
      expect(list.every((m: any) => m.outletId === outletId)).toBe(true);
      expect((await staff.get(`/menu-items?outletId=${otherOutletId}`)).status).toBe(403);
      const item = (await staff.get(`/menu-items/${menuItemId}`)).body;
      expect((await staff.put(`/menu-items/${menuItemId}`, { ...item, outletId: otherOutletId })).status).toBe(403);
    });

    it('can edit an item but not change its price without prices.manage', async () => {
      const item = (await staff.get(`/menu-items/${menuItemId}`)).body;
      expect((await staff.put(`/menu-items/${menuItemId}`, { ...item, sellingPrice: '999' })).status).toBe(403);
      expect((await staff.put(`/menu-items/${menuItemId}`, { ...item, description: 'Fresh tomatoes' })).status).toBe(200);
    });

    it('switches user on a shared device with a PIN', async () => {
      const names = (await ownerA.get(`/auth/pin-users?outletId=${outletId}`)).body;
      const target = names.find((n: any) => n.name === 'Staff One');
      expect((await ownerA.post(`/auth/pin?outletId=${outletId}`, { userId: target.id, pin: '0000' })).status).toBe(401);
      const ok = await ownerA.post(`/auth/pin?outletId=${outletId}`, { userId: target.id, pin: '4321' });
      expect(ok.status).toBe(201);
      expect(ok.body.user.name).toBe('Staff One');
      // Staff One does not work at the other outlet.
      expect((await ownerA.post(`/auth/pin?outletId=${otherOutletId}`, { userId: target.id, pin: '4321' })).status).toBe(403);
    });
  });

  it('locks a login for 15 minutes after 5 wrong passwords', async () => {
    const roles = (await ownerA.get('/roles')).body;
    await ownerA.post('/users', {
      name: 'Lock Test', login: `lock@${A.code}.test`, password: 'Passw0rd!',
      roles: [{ roleId: roles.find((r: any) => r.name === 'Cashier').id, outletId }],
    });
    for (let i = 0; i < 5; i++) await client(app).post('/auth/login', { login: `lock@${A.code}.test`, password: 'nope' });
    const r = await client(app).post('/auth/login', { login: `lock@${A.code}.test`, password: 'Passw0rd!' });
    expect(r.status).toBe(401);
    expect(r.body.message).toMatch(/Too many attempts/);
  });

  describe('passwords', () => {
    const login = () => `pw@${A.code}.test`;
    beforeAll(async () => {
      const roles = (await ownerA.get('/roles')).body;
      const cashier = roles.find((r: any) => r.name === 'Cashier');
      expect((await ownerA.post('/users', { name: 'Pat Word', login: login(), password: 'First-pass1', roles: [{ roleId: cashier.id, outletId }] })).status).toBe(201);
    });

    it('a user changes their own password after giving the current one', async () => {
      const me = client(app, await signIn(app, login(), 'First-pass1'));
      expect((await me.post('/auth/password', { currentPassword: 'wrong', newPassword: 'Second-pass2' })).status).toBe(401);
      expect((await me.post('/auth/password', { currentPassword: 'First-pass1', newPassword: 'short' })).status).toBe(400);
      expect((await me.post('/auth/password', { currentPassword: 'First-pass1', newPassword: 'Second-pass2' })).status).toBe(201);
      expect((await client(app).post('/auth/login', { login: login(), password: 'First-pass1' })).status).toBe(401);
      await signIn(app, login(), 'Second-pass2');
    });

    it('forgot password emails a one-time link that is never a session', async () => {
      outbox.length = 0;
      const answer = (await client(app).post('/auth/forgot', { login: login().toUpperCase() })).body;
      expect((await client(app).post('/auth/forgot', { login: 'nobody@nowhere.test' })).body).toEqual(answer); // no hint who exists
      expect(outbox.map((m) => m.to)).toEqual([login()]);
      const token = /token=([\w.-]+)/.exec(outbox[0].text)![1];
      expect((await client(app, token).get('/auth/me')).status).toBe(401);
      expect((await client(app).post('/auth/reset', { token, password: 'Third-pass3' })).status).toBe(201);
      expect((await client(app).post('/auth/reset', { token, password: 'Fourth-pass4' })).status).toBe(400); // used once
      await signIn(app, login(), 'Third-pass3');
    });
  });

  describe('customers never see each other', () => {
    it('lists only their own outlets and items', async () => {
      expect((await ownerB.get('/outlets')).body).toEqual([]);
      expect((await ownerB.get('/menu-items')).body).toEqual([]);
      expect((await ownerB.get(`/menu-items/${menuItemId}`)).status).toBe(404);
    });

    it('a sign-in name belongs to one customer only', async () => {
      const r = await ownerB.post('/users', { name: 'Copy', login: `staff@${A.code}.test`, password: 'Passw0rd!' });
      expect(r.status).toBe(409);
    });

    it('each customer has its own database', async () => {
      const a = await resolveCustomer(A.customer.id);
      const b = await resolveCustomer(B.customer.id);
      expect(a!.customer.dbName).not.toBe(b!.customer.dbName);
      const rows = await b!.db.execute(sql`select count(*)::int as n from menu_item`);
      expect(rows.rows[0].n).toBe(0);
    });
  });

});

import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { resolveCustomer, tenantSchema as t } from '../src/db/index.js';
import { client, signIn, tempCustomer } from './helpers.js';

// A small outlet that mirrors the handoff's worked examples:
// - Tomato Soup and Sweet Corn Soup, both ₹160, costing ₹38 and ₹42 (6.10)
// - Whiskies A–E as 60 ml serves at ₹320 / 360 / 340 / 380 / 420 with serve costs 100 / 110 / 95 / 170 / 100 (6.9)

export type Fixture = Awaited<ReturnType<typeof setupFixture>>;

export async function setupFixture(app: INestApplication, prefix: string) {
  const cust = await tempCustomer(prefix);
  const ownerToken = await signIn(app, cust.login, cust.password);
  const owner = client(app, ownerToken, 'owner-device');
  const { db } = (await resolveCustomer(cust.customer.id))!;

  const outlet = (await owner.post('/outlets', { name: 'Test outlet', code: 'TST', state: 'Karnataka', fssaiNumber: '12345678901234' })).body;
  const stores = (await owner.get(`/outlets/${outlet.id}/stores`)).body as any[];
  const store = (kind: string) => stores.find((s) => s.kind === kind).id as string;
  const cats = (await owner.get('/categories')).body as any[];
  const cat = (name: string, parent?: string) =>
    cats.find((c: any) => c.name === name && (!parent || c.parentId === cats.find((p: any) => p.name === parent && p.kind === 'liquor_type').id)).id as string;
  const taxes = (await owner.get('/tax-classes')).body as any[];
  const tax = (code: string) => taxes.find((x: any) => x.code === code).id as string;

  const item = async (body: any) => {
    const r = await owner.post('/stock-items', { units: [], levels: [], ...body });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return r.body.id as string;
  };
  const s = {
    tomato: await item({
      name: 'Tomato', department: 'food', baseUnit: 'g', perishable: true, shelfLifeDays: 3, currentCost: '0.02',
      units: [{ name: 'kg', factor: '1000', isDefault: true }],
      levels: [{ outletId: outlet.id, parLevel: '10000', reorderLevel: '5000', criticalLevel: '2000' }],
    }),
    corn: await item({ name: 'Sweet corn', department: 'food', baseUnit: 'g', currentCost: '0.08', units: [{ name: 'kg', factor: '1000', isDefault: true }], levels: [{ outletId: outlet.id, parLevel: '4000', reorderLevel: '2000', criticalLevel: '1000' }] }),
    tomatoBase: await item({ name: 'Tomato soup base', department: 'food', baseUnit: 'pc', currentCost: '33' }),
    cornBase: await item({ name: 'Corn soup base', department: 'food', baseUnit: 'pc', currentCost: '26' }),
  } as Record<string, string>;
  const whiskyCost: Record<string, string> = { A: '100', B: '110', C: '95', D: '170', E: '100' };
  for (const w of Object.keys(whiskyCost)) {
    s[`whisky${w}`] = await item({
      name: `Whisky ${w} 750 ml`, department: 'beverage', baseUnit: 'ml', bottleSizeMl: '750', abvPct: '42.8', categoryId: cat('Indian', 'Whisky'),
      currentCost: (Number(whiskyCost[w]) / 60).toFixed(6), units: [{ name: 'bottle', factor: '750', isDefault: true }],
      levels: [{ outletId: outlet.id, parLevel: '4500', reorderLevel: '2250', criticalLevel: '750' }],
    });
  }

  const menu = async (body: any, recipe: [string, number][]) => {
    const r = await owner.post('/menu-items', { outletId: outlet.id, ...body });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    await db.insert(t.recipeLine).values(recipe.map(([k, q]) => ({ menuItemId: r.body.id, stockItemId: s[k], quantity: String(q) })));
    return r.body.id as string;
  };
  const m: Record<string, string> = {
    tomatoSoup: await menu({ name: 'Tomato Soup', department: 'food', categoryId: cat('Soups and salads'), dietType: 'veg', sellingPrice: '160', taxClassId: tax('FOOD_GST5') }, [['tomato', 250], ['tomatoBase', 1]]),
    cornSoup: await menu({ name: 'Sweet Corn Soup', department: 'food', categoryId: cat('Soups and salads'), dietType: 'veg', sellingPrice: '160', taxClassId: tax('FOOD_GST5') }, [['corn', 200], ['cornBase', 1]]),
  };
  const prices: Record<string, string> = { A: '320', B: '360', C: '340', D: '380', E: '420' };
  for (const w of Object.keys(prices)) {
    m[`whisky${w}`] = await menu(
      { name: `Whisky ${w} 60 ml`, department: 'beverage', categoryId: cat('Indian', 'Whisky'), serveSizeMl: '60', sellingPrice: prices[w], taxClassId: tax('LIQUOR') },
      [[`whisky${w}`, 60]],
    );
  }

  // People at this outlet, one per seed role.
  const roles = (await owner.get('/roles')).body as any[];
  const people: Record<string, ReturnType<typeof client>> = {};
  const ids: Record<string, string> = {};
  for (const [key, role] of [
    ['manager', 'Outlet manager'], ['store', 'Storekeeper / kitchen staff'], ['chef', 'Chef / bar manager'],
    ['cashier', 'Cashier'], ['watchman', 'Watchman'], ['accounts', 'Accounts'],
  ] as const) {
    const login = `${key}@${cust.code}.test`;
    const r = await owner.post('/users', { name: key, login, password: 'Passw0rd!', pin: '1234', roles: [{ roleId: roles.find((x) => x.name === role).id, outletId: outlet.id }] });
    ids[key] = r.body.id;
    people[key] = client(app, await signIn(app, login, 'Passw0rd!'), `${key}-device`);
  }

  // Opening stock through a stock count, the way a new customer would start.
  const opening = async (storeKind: string, qtys: Record<string, string>) => {
    const c = (await owner.post('/inventory/counts', { storeId: store(storeKind), scheduledFor: '2026-10-01' })).body;
    await owner.post(`/inventory/counts/${c.id}/start`);
    await owner.put(`/inventory/counts/${c.id}/lines`, Object.entries(qtys).map(([k, q]) => ({ stockItemId: s[k], countedQty: q, cause: 'Opening stock' })));
    const r = await owner.post(`/inventory/counts/${c.id}/submit`);
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  };
  const balance = async (k: string, storeKind = 'kitchen') => {
    const rows = await db.select().from(t.stockBalance).where(eq(t.stockBalance.stockItemId, s[k]));
    return rows.find((r) => r.storeId === store(storeKind))?.qty ?? '0';
  };

  return { cust, owner, ownerToken, db, outlet, store, s, m, people, ids, opening, balance, cat, tax, drop: cust.drop };
}

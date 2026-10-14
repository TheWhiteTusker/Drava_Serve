import { and, eq } from 'drizzle-orm';
import { dec, rupees } from '@fnb/shared';
import { createOutlet } from '../bootstrap.js';
import { hashSecret } from '../secrets.js';
import { controlDb, controlSchema, tenantSchema as t } from '../db/index.js';
import { BAR_MENU, DEMO, FOOD, FOOD_MENU, LIQUOR, STAFF, VENDORS, istDate } from './data.js';
import type { Tx } from '../db/index.js';


export type Outlet = typeof t.outlet.$inferSelect;
export type Menus = Map<string, Map<string, { item: typeof t.menuItem.$inferSelect; cost: string }>>;

// Two sample outlets and one person per role.
export async function seedPeople(tx: Tx, customerId: string) {
  const outlets = [
    await createOutlet(tx, {
      name: 'Indiranagar, Bengaluru (sample)', code: 'BLR1', state: 'Karnataka', address: '100 Feet Road, Indiranagar, Bengaluru (sample address)',
      gstin: '29AAAAA0000A1Z5', fssaiNumber: '10000000000001', exciseLicence: 'SAMPLE-CL9-0001', active: true,
    }),
    await createOutlet(tx, {
      name: 'Mysuru (sample)', code: 'MYS1', state: 'Karnataka', address: 'Sayyaji Rao Road, Mysuru (sample address)',
      gstin: '29AAAAA0000A1Z5', fssaiNumber: '10000000000002', exciseLicence: 'SAMPLE-CL9-0002', active: true,
    }),
  ];
  const roles = await tx.select().from(t.role);
  const roleId = (n: string) => roles.find((r) => r.name === n)!.id;
  for (const [login, name, role, pin, scope] of STAFF) {
    await controlDb().insert(controlSchema.loginRoute).values({ login, customerId });
    const [u] = await tx
      .insert(t.appUser)
      .values({ login, name, passwordHash: await hashSecret(DEMO.password), pinHash: await hashSecret(pin) })
      .returning();
    await tx.insert(t.userRole).values({ userId: u.id, roleId: roleId(role), outletId: scope === 'all' ? null : outlets[0].id });
  }

  return outlets;
}

// Stock items with their pars at both outlets, and the categories and taxes the menus use.
export async function seedStock(tx: Tx, outlets: Outlet[]) {
  const cats = await tx.select().from(t.category);
  const cat = (name: string, parent?: string) =>
    cats.find((c) => c.name === name && (!parent || c.parentId === cats.find((p) => p.name === parent && p.kind === 'liquor_type')?.id))!;
  const brands = await tx.select().from(t.brand);
  const taxes = await tx.select().from(t.taxClass);
  const food = taxes.find((x) => x.code === 'FOOD_GST5')!;
  const liquorTax = taxes.find((x) => x.code === 'LIQUOR')!;
  const [vegGroup, bevGroup] = await tx
    .insert(t.category)
    .values([{ name: 'Kitchen ingredients', kind: 'stock' }, { name: 'Bar mixers', kind: 'stock' }])
    .returning();

  const items = new Map<string, typeof t.stockItem.$inferSelect>();
  const pars = new Map<string, number>();
  for (const [name, department, baseUnit, cost, unit, factor, par, perishable] of FOOD) {
    const [s] = await tx
      .insert(t.stockItem)
      .values({ name, department, baseUnit, currentCost: cost, perishable, categoryId: department === 'food' ? vegGroup.id : bevGroup.id, shelfLifeDays: perishable ? 3 : null })
      .returning();
    await tx.insert(t.stockItemUnit).values({ stockItemId: s.id, name: unit, factor, isDefault: true });
    items.set(name, s);
    pars.set(name, par);
  }
  for (const [name, type, sub, brand, ml, abv, origin, tier, cost, parBottles] of LIQUOR) {
    const [s] = await tx
      .insert(t.stockItem)
      .values({
        name, department: 'beverage', baseUnit: 'ml', currentCost: cost, bottleSizeMl: String(ml), abvPct: abv, origin, priceTier: tier,
        categoryId: cat(sub ?? type, type).id, brandId: brands.find((b) => b.name === brand)!.id,
      })
      .returning();
    await tx.insert(t.stockItemUnit).values([
      { stockItemId: s.id, name: 'bottle', factor: String(ml), isDefault: true },
      { stockItemId: s.id, name: `case of 12`, factor: String(ml * 12) },
    ]);
    items.set(name, s);
    pars.set(name, parBottles * ml);
  }
  for (const o of outlets) {
    await tx.insert(t.stockLevel).values(
      [...items.values()].map((s) => {
        const par = pars.get(s.name)!;
        return { stockItemId: s.id, outletId: o.id, parLevel: String(par), reorderLevel: String(par * 0.5), criticalLevel: String(par * 0.2) };
      }),
    );
  }

  return { items, pars, cat, food, liquorTax };
}
export type Stock = Awaited<ReturnType<typeof seedStock>>;

// Vendors, what they supply and a first rate in the price history.
export async function seedVendors(tx: Tx, items: Stock['items'], firstDay: Date) {
  for (const [name, department, supplies] of VENDORS) {
    const [v] = await tx.insert(t.vendor).values({ name, department, contactName: 'Sample contact', phone: '+91 90000 00000' }).returning();
    for (const itemName of supplies) {
      const s = items.get(itemName)!;
      const [u] = await tx.select().from(t.stockItemUnit).where(and(eq(t.stockItemUnit.stockItemId, s.id), eq(t.stockItemUnit.isDefault, true)));
      await tx.insert(t.vendorItem).values({ vendorId: v.id, stockItemId: s.id, unitId: u.id, packSize: '1' });
      await tx.insert(t.vendorRate).values({
        vendorId: v.id, stockItemId: s.id, unitId: u.id, rate: rupees(dec(s.currentCost).times(u.factor)), ratePerBase: s.currentCost, billedOn: istDate(firstDay),
      });
    }
  }

}

// Menu items and recipes, the same menu at both outlets, plus tables and a margin target.
export async function seedMenus(tx: Tx, outlets: Outlet[], { items, cat, food, liquorTax }: Stock) {
  const menus = new Map<string, Map<string, { item: typeof t.menuItem.$inferSelect; cost: string }>>();
  for (const o of outlets) {
    const m = new Map();
    const add = async (values: typeof t.menuItem.$inferInsert, recipe: [string, number][]) => {
      const [mi] = await tx.insert(t.menuItem).values(values).returning();
      await tx.insert(t.recipeLine).values(recipe.map(([s, q]) => ({ menuItemId: mi.id, stockItemId: items.get(s)!.id, quantity: String(q) })));
      const cost = recipe.reduce((a, [s, q]) => a.plus(dec(items.get(s)!.currentCost).times(q)), dec(0));
      const margin = dec(mi.sellingPrice).minus(cost);
      await tx.insert(t.menuItemCost).values({
        menuItemId: mi.id, portionCost: cost.toFixed(6), sellingPrice: mi.sellingPrice, marginAmount: margin.toFixed(6),
        marginPct: margin.div(mi.sellingPrice).times(100).toFixed(2), reason: 'sample data',
      });
      m.set(mi.name, { item: mi, cost: cost.toFixed(6) });
    };
    for (const [name, course, dietType, price, recipe, allergens, tags] of FOOD_MENU) {
      await add({ outletId: o.id, name, department: 'food', categoryId: cat(course).id, dietType, sellingPrice: price, taxClassId: food.id, allergens: allergens ?? [], tags: tags ?? [] }, recipe);
    }
    for (const [name, product, ml, price] of BAR_MENU) {
      const s = items.get(product)!;
      await add({ outletId: o.id, name, department: 'beverage', categoryId: s.categoryId!, brandId: s.brandId, serveSizeMl: String(ml), sellingPrice: price, taxClassId: liquorTax.id }, [[product, ml]]);
    }
    await add(
      { outletId: o.id, name: 'Cuba Libre', department: 'beverage', categoryId: cat('Cocktails').id, serveSizeMl: '210', sellingPrice: '380', taxClassId: liquorTax.id },
      [['Bacardi Carta Blanca 750 ml', 60], ['Cola', 150], ['Lemon', 0.5]],
    );
    menus.set(o.id, m);

    await tx.insert(t.diningTable).values(Array.from({ length: 10 }, (_, i) => ({ outletId: o.id, name: `T${i + 1}`, sortOrder: i })));
    await tx.insert(t.marginTarget).values({ outletId: o.id, targetPct: '65' });
  }
  return menus;
}

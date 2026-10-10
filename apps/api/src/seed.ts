import { and, eq } from 'drizzle-orm';
import { billTotals, dec, rupees, TIME_ZONE, type DietType } from '@fnb/shared';
import { addOwner, asSystem, bootstrapCustomer, createOutlet } from './bootstrap.js';
import { Ctx, hashSecret } from './common.js';
import { rerankOutlet, runOffers } from './pricing.js';
import { approveIndent, buildIndents } from './purchasing.controller.js';
import { controlDb, controlSchema, createCustomer, dropCustomer, tenantSchema as t } from './db/index.js';

// SAMPLE DATA ONLY. Every name, price, cost and licence number below is made up for trying the
// system out. Nothing here is a real price, a real vendor or a real licence.

export const DEMO = { code: 'demo', password: 'Demo@1234' };

// [name, department, base unit, ₹ per base unit, purchase unit, factor, par per outlet, perishable]
type StockRow = [string, 'food' | 'beverage', 'g' | 'ml' | 'pc', string, string, string, number, boolean];
const FOOD: StockRow[] = [
  ['Tomato', 'food', 'g', '0.020', 'kg', '1000', 10000, true],
  ['Onion', 'food', 'g', '0.030', 'kg', '1000', 15000, true],
  ['Potato', 'food', 'g', '0.025', 'kg', '1000', 10000, true],
  ['Sweet corn', 'food', 'g', '0.080', 'kg', '1000', 4000, true],
  ['Paneer', 'food', 'g', '0.360', 'kg', '1000', 5000, true],
  ['Chicken boneless', 'food', 'g', '0.280', 'kg', '1000', 10000, true],
  ['Eggs', 'food', 'pc', '6.00', 'tray of 30', '30', 90, true],
  ['Milk', 'food', 'ml', '0.056', 'litre', '1000', 10000, true],
  ['Fresh cream', 'food', 'ml', '0.220', 'litre', '1000', 4000, true],
  ['Butter', 'food', 'g', '0.520', '500 g pack', '500', 3000, true],
  ['Cooking oil', 'food', 'ml', '0.150', '15 litre tin', '15000', 15000, false],
  ['Basmati rice', 'food', 'g', '0.110', '25 kg bag', '25000', 25000, false],
  ['Maida', 'food', 'g', '0.045', '25 kg bag', '25000', 25000, false],
  ['Ginger garlic paste', 'food', 'g', '0.120', 'kg', '1000', 2000, true],
  ['Mixed spices', 'food', 'g', '0.600', 'kg', '1000', 2000, false],
  ['Capsicum', 'food', 'g', '0.060', 'kg', '1000', 3000, true],
  ['Lemon', 'food', 'pc', '4.00', 'dozen', '12', 120, true],
  ['Mint leaves', 'food', 'g', '0.200', 'kg', '1000', 1000, true],
  ['Sugar', 'food', 'g', '0.045', 'kg', '1000', 10000, false],
  ['Vanilla ice cream', 'food', 'ml', '0.250', '4 litre tub', '4000', 8000, true],
  ['Dark chocolate', 'food', 'g', '0.700', 'kg', '1000', 2000, false],
  ['Soda water', 'beverage', 'ml', '0.040', 'crate of 24 x 300 ml', '7200', 14400, false],
  ['Cola', 'beverage', 'ml', '0.060', 'crate of 24 x 300 ml', '7200', 14400, false],
];

// [product name, type, sub-type, brand, bottle ml, abv %, origin, tier, ₹ per ml, par bottles]
type LiquorRow = [string, string, string | null, string, number, string, 'indian' | 'imported', string, string, number];
const LIQUOR: LiquorRow[] = [
  ['Royal Stag 750 ml', 'Whisky', 'Indian', 'Royal Stag', 750, '42.8', 'indian', 'standard', '1.20', 12],
  ['Blenders Pride 750 ml', 'Whisky', 'Indian', 'Blenders Pride', 750, '42.8', 'indian', 'premium', '1.60', 8],
  ['Johnnie Walker Black Label 750 ml', 'Whisky', 'Blended Scotch', 'Johnnie Walker', 750, '40', 'imported', 'luxury', '4.40', 4],
  ['Glenfiddich 12 750 ml', 'Whisky', 'Single malt', 'Glenfiddich', 750, '40', 'imported', 'luxury', '6.00', 3],
  ['Old Monk 750 ml', 'Rum', 'Dark', 'Old Monk', 750, '42.8', 'indian', 'economy', '0.70', 10],
  ['Bacardi Carta Blanca 750 ml', 'Rum', 'White', 'Bacardi', 750, '37.5', 'indian', 'standard', '1.30', 8],
  ['Smirnoff 750 ml', 'Vodka', 'Plain', 'Smirnoff', 750, '37.5', 'indian', 'standard', '1.10', 8],
  ['Bombay Sapphire 750 ml', 'Gin', 'London dry', 'Bombay Sapphire', 750, '40', 'imported', 'premium', '3.20', 4],
  ['Kingfisher Premium 650 ml', 'Beer', 'Lager', 'Kingfisher', 650, '4.8', 'indian', 'economy', '0.25', 48],
  ['Sula Shiraz 750 ml', 'Wine', 'Red', 'Sula', 750, '13', 'indian', 'standard', '1.10', 6],
];

// [menu item, course, diet, price, recipe [stock item, qty]]
type FoodMenu = [string, string, DietType, string, [string, number][], string[]?, string[]?];
const FOOD_MENU: FoodMenu[] = [
  // Tomato and sweet corn soup mirror the worked example in handoff 6.10: same price, tomato soup
  // costs about ₹38 and sweet corn about ₹41, so tomato soup ranks first until tomato rises.
  ['Tomato Soup', 'Soups and salads', 'veg', '160', [['Tomato', 250], ['Onion', 50], ['Butter', 20], ['Fresh cream', 75], ['Mixed spices', 5], ['Sugar', 10], ['Ginger garlic paste', 10]], ['milk'], ['cuisine:Continental']],
  ['Sweet Corn Soup', 'Soups and salads', 'veg', '160', [['Sweet corn', 200], ['Butter', 15], ['Fresh cream', 50], ['Mixed spices', 5], ['Maida', 20], ['Onion', 30], ['Sugar', 10], ['Ginger garlic paste', 10]], ['milk', 'gluten'], ['cuisine:Chinese']],
  ['Paneer Tikka', 'Starters', 'veg', '280', [['Paneer', 200], ['Capsicum', 50], ['Onion', 50], ['Mixed spices', 10], ['Cooking oil', 20], ['Lemon', 0.5]], ['milk'], ['cuisine:North Indian', 'spice:medium']],
  ['Chicken 65', 'Starters', 'non_veg', '300', [['Chicken boneless', 200], ['Ginger garlic paste', 15], ['Mixed spices', 10], ['Cooking oil', 60], ['Eggs', 0.5]], ['egg'], ['cuisine:South Indian', 'spice:hot', "chef's special"]],
  ['Masala Omelette', 'Appetizers', 'egg', '120', [['Eggs', 3], ['Onion', 30], ['Cooking oil', 10], ['Mixed spices', 3]], ['egg'], []],
  ['Potato Wedges', 'Appetizers', 'veg', '180', [['Potato', 250], ['Cooking oil', 80], ['Mixed spices', 5]], [], ['jain']],
  ['Butter Chicken', 'Main course', 'non_veg', '380', [['Chicken boneless', 250], ['Butter', 30], ['Fresh cream', 60], ['Tomato', 150], ['Mixed spices', 10], ['Ginger garlic paste', 15]], ['milk'], ['cuisine:North Indian', "chef's special"]],
  ['Paneer Butter Masala', 'Main course', 'veg', '320', [['Paneer', 200], ['Butter', 30], ['Fresh cream', 50], ['Tomato', 150], ['Mixed spices', 10]], ['milk'], ['cuisine:North Indian']],
  ['Veg Biryani', 'Breads and rice', 'veg', '260', [['Basmati rice', 180], ['Potato', 50], ['Capsicum', 40], ['Onion', 80], ['Cooking oil', 30], ['Mixed spices', 10], ['Mint leaves', 5]], [], ['spice:medium']],
  ['Chicken Biryani', 'Breads and rice', 'non_veg', '340', [['Basmati rice', 180], ['Chicken boneless', 200], ['Onion', 80], ['Cooking oil', 30], ['Mixed spices', 12], ['Mint leaves', 5]], [], ['spice:medium']],
  ['Butter Naan', 'Breads and rice', 'veg', '70', [['Maida', 100], ['Butter', 10], ['Milk', 20]], ['gluten', 'milk'], []],
  ['Jeera Rice', 'Breads and rice', 'veg', '180', [['Basmati rice', 150], ['Butter', 10], ['Mixed spices', 3]], ['milk'], []],
  ['Brownie with Ice Cream', 'Desserts', 'egg', '220', [['Dark chocolate', 60], ['Maida', 30], ['Butter', 30], ['Sugar', 40], ['Eggs', 1], ['Vanilla ice cream', 60]], ['egg', 'gluten', 'milk'], []],
  ['Vanilla Ice Cream', 'Desserts', 'veg', '120', [['Vanilla ice cream', 120]], ['milk'], []],
  ['Fresh Lime Soda', 'Soft beverages', 'veg', '110', [['Lemon', 1], ['Soda water', 250], ['Sugar', 20]], [], []],
  ['Virgin Mojito', 'Soft beverages', 'veg', '180', [['Lemon', 1], ['Mint leaves', 10], ['Sugar', 25], ['Soda water', 200]], [], []],
];

// [menu item, product, serve ml, price]; one bottle sells as several items.
const BAR_MENU: [string, string, number, string][] = [
  ['Royal Stag 30 ml', 'Royal Stag 750 ml', 30, '150'],
  ['Royal Stag 60 ml', 'Royal Stag 750 ml', 60, '280'],
  ['Royal Stag bottle', 'Royal Stag 750 ml', 750, '3200'],
  ['Blenders Pride 60 ml', 'Blenders Pride 750 ml', 60, '340'],
  ['Johnnie Walker Black Label 60 ml', 'Johnnie Walker Black Label 750 ml', 60, '720'],
  ['Glenfiddich 12 60 ml', 'Glenfiddich 12 750 ml', 60, '950'],
  ['Old Monk 60 ml', 'Old Monk 750 ml', 60, '200'],
  ['Bacardi Carta Blanca 60 ml', 'Bacardi Carta Blanca 750 ml', 60, '260'],
  ['Smirnoff 60 ml', 'Smirnoff 750 ml', 60, '260'],
  ['Bombay Sapphire 60 ml', 'Bombay Sapphire 750 ml', 60, '520'],
  ['Kingfisher Premium bottle', 'Kingfisher Premium 650 ml', 650, '350'],
  ['Sula Shiraz glass', 'Sula Shiraz 750 ml', 150, '450'],
  ['Sula Shiraz bottle', 'Sula Shiraz 750 ml', 750, '2200'],
];

const VENDORS: [string, 'food' | 'beverage', string[]][] = [
  ['Sample Vegetable Supplier', 'food', ['Tomato', 'Onion', 'Potato', 'Sweet corn', 'Capsicum', 'Lemon', 'Mint leaves', 'Ginger garlic paste']],
  ['Sample Dairy and Poultry', 'food', ['Paneer', 'Chicken boneless', 'Eggs', 'Milk', 'Fresh cream', 'Butter', 'Vanilla ice cream']],
  ['Sample Grocery Wholesale', 'food', ['Cooking oil', 'Basmati rice', 'Maida', 'Mixed spices', 'Sugar', 'Dark chocolate']],
  ['Sample Beverage Distributor', 'beverage', ['Soda water', 'Cola']],
  ['Sample Liquor Distributor', 'beverage', LIQUOR.map((l) => l[0])],
];

const STAFF: [string, string, string, string, 'outlet1' | 'all'][] = [
  // [login, name, role, PIN, scope]
  ['manager@demo.test', 'Asha (Outlet manager, sample)', 'Outlet manager', '2222', 'outlet1'],
  ['watchman@demo.test', 'Raju (Watchman, sample)', 'Watchman', '3333', 'outlet1'],
  ['store@demo.test', 'Kiran (Storekeeper, sample)', 'Storekeeper / kitchen staff', '4444', 'outlet1'],
  ['chef@demo.test', 'Meera (Chef, sample)', 'Chef / bar manager', '5555', 'outlet1'],
  ['cashier@demo.test', 'Vinay (Cashier, sample)', 'Cashier', '6666', 'outlet1'],
  ['accounts@demo.test', 'Farah (Accounts, sample)', 'Accounts', '7777', 'all'],
];

// Stock left today, fixed for the demo: at Indiranagar (offers on) Royal Stag is down to four
// 60 ml pegs, so Blenders Pride (priced just above it, plenty in stock) is on offer.
const LEFT_TODAY: Record<string, Record<string, number>> = {
  BLR1: { 'Royal Stag 750 ml': 240, 'Blenders Pride 750 ml': 4500 },
};

// Repeatable "random" numbers so the sample week is the same every time.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const istDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(d);

export async function seedDemo(opts: { reset?: boolean; log?: (s: string) => void } = {}) {
  const log = opts.log ?? console.log;
  if (opts.reset) await dropCustomer(DEMO.code);
  const [exists] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.code, DEMO.code));
  if (exists) {
    log('Demo customer already exists. Use "seed --reset" to rebuild it.');
    return;
  }
  const { customer, db } = await createCustomer({ code: DEMO.code, name: 'Demo Restaurants (SAMPLE DATA)' });
  await bootstrapCustomer(db);
  await addOwner(customer.id, db, { login: 'owner@demo.test', name: 'Owner (sample)', password: DEMO.password, pin: '1111' });

  await asSystem(db, 'system:seed', async (tx) => {
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
      await controlDb().insert(controlSchema.loginRoute).values({ login, customerId: customer.id });
      const [u] = await tx
        .insert(t.appUser)
        .values({ login, name, passwordHash: await hashSecret(DEMO.password), pinHash: await hashSecret(pin) })
        .returning();
      await tx.insert(t.userRole).values({ userId: u.id, roleId: roleId(role), outletId: scope === 'all' ? null : outlets[0].id });
    }

    // Catalog
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

    // Vendors, what they supply and a first rate in the price history
    const days = 7;
    const firstDay = new Date(Date.now() - days * 86_400_000);
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

    // Menu items and recipes, the same menu at both outlets
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
    // Liquor offers switched on at the first sample outlet only, to show both states.
    await tx.insert(t.setting).values({ outletId: outlets[0].id, key: 'offers.liquorEnabled', value: true });

    // A week of sample bills, then opening stock a week earlier sized so that what is left today
    // ranges from about 10% to 130% of par: some items healthy, some to reorder, a few low.
    const stores = await tx.select().from(t.store);
    const storeOf = (outletId: string, kind: 'kitchen' | 'bar') => stores.find((s) => s.outletId === outletId && s.kind === kind)!;
    const cashier = (await tx.select().from(t.appUser).where(eq(t.appUser.login, 'cashier@demo.test')))[0];
    const ledger: (typeof t.stockLedger.$inferInsert)[] = [];
    const rand = rng(42);
    const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    let billCount = 0;
    for (const o of outlets) {
      const menu = [...menus.get(o.id)!.values()];
      const tables = await tx.select().from(t.diningTable).where(eq(t.diningTable.outletId, o.id));
      for (let d = days - 1; d >= 0; d--) {
        const date = istDate(new Date(Date.now() - d * 86_400_000));
        const weekend = [0, 5, 6].includes(new Date(`${date}T12:00:00+05:30`).getDay());
        const n = Math.floor((weekend ? 30 : 18) + rand() * 10);
        for (let b = 0; b < n; b++) {
          const hour = pick([12, 13, 13, 14, 15, 19, 20, 20, 21, 21, 22]);
          const opened = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00+05:30`);
          const paid = new Date(opened.getTime() + (30 + rand() * 75) * 60_000);
          if (paid > new Date()) continue;
          const chosen = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(menu));
          const lines = chosen.map((c) => ({ c, qty: rand() < 0.25 ? 2 : 1, tax: c.item.taxClassId === food.id ? food : liquorTax }));
          const totals = billTotals(lines.map((l) => ({ qty: l.qty, unitPrice: l.c.item.sellingPrice, taxClass: l.tax })));
          const takeaway = rand() < 0.15;
          const [bill] = await tx
            .insert(t.bill)
            .values({
              outletId: o.id, number: `${o.code}-${date.replaceAll('-', '')}-${String(b + 1).padStart(3, '0')}`, kind: takeaway ? 'takeaway' : 'dine_in',
              tableId: takeaway ? null : pick(tables).id, status: 'paid', openedAt: opened, paidAt: paid, businessDate: date,
              openedBy: cashier.id, closedBy: cashier.id, deviceId: 'system:seed',
              foodSubtotal: totals.food.subtotal, foodTax: rupees(dec(totals.food.total).minus(totals.food.subtotal)),
              liquorSubtotal: totals.liquor.subtotal, liquorTax: rupees(dec(totals.liquor.total).minus(totals.liquor.subtotal)),
              taxes: totals, roundOff: totals.roundOff, total: totals.grandTotal,
            })
            .returning();
          const [order] = await tx.insert(t.billOrder).values({ billId: bill.id, placedAt: opened, placedBy: cashier.id }).returning();
          for (const l of lines) {
            await tx.insert(t.orderLine).values({
              billId: bill.id, orderId: order.id, menuItemId: l.c.item.id, name: l.c.item.name, department: l.c.item.department,
              taxClassId: l.tax.id, taxKind: l.tax.kind, qty: String(l.qty), menuPrice: l.c.item.sellingPrice, priceCharged: l.c.item.sellingPrice,
              costAtSale: l.c.cost, createdAt: opened,
            });
            const recipe = await tx.select().from(t.recipeLine).where(eq(t.recipeLine.menuItemId, l.c.item.id));
            for (const r of recipe) {
              const s = [...items.values()].find((x) => x.id === r.stockItemId)!;
              ledger.push({
                outletId: o.id, storeId: storeOf(o.id, s.department === 'food' ? 'kitchen' : 'bar').id, stockItemId: s.id,
                qty: dec(r.quantity).times(l.qty).neg().toFixed(3), unitCost: s.currentCost, movement: 'sale', refType: 'bill', refId: bill.id, at: paid,
              });
            }
          }
          await tx.insert(t.payment).values({ billId: bill.id, mode: pick(['cash', 'upi', 'upi', 'card'] as const), amount: totals.grandTotal, receivedAt: paid, receivedBy: cashier.id });
          billCount++;
        }
      }
    }
    const opening: (typeof t.stockLedger.$inferInsert)[] = [];
    for (const o of outlets) {
      for (const s of items.values()) {
        const storeId = storeOf(o.id, s.department === 'food' ? 'kitchen' : 'bar').id;
        const used = ledger.filter((l) => l.storeId === storeId && l.stockItemId === s.id).reduce((a, l) => a.minus(l.qty), dec(0));
        const left = LEFT_TODAY[o.code]?.[s.name] != null ? dec(LEFT_TODAY[o.code][s.name]) : dec(pars.get(s.name)!).times(0.1 + rand() * 1.2);
        opening.push({ outletId: o.id, storeId, stockItemId: s.id, qty: used.plus(left).toFixed(0), unitCost: s.currentCost, movement: 'opening', reason: 'Sample opening stock', at: firstDay });
      }
    }
    ledger.unshift(...opening);
    for (let i = 0; i < ledger.length; i += 500) await tx.insert(t.stockLedger).values(ledger.slice(i, i + 500));
    // Balances are the sum of the ledger; average cost is the sample cost.
    await tx.execute(`
      insert into stock_balance (store_id, stock_item_id, qty, avg_cost)
      select l.store_id, l.stock_item_id, sum(l.qty), max(s.current_cost)
      from stock_ledger l join stock_item s on s.id = l.stock_item_id
      group by l.store_id, l.stock_item_id`);
    log(`Sample data: 2 outlets, ${items.size} stock items, ${FOOD_MENU.length + BAR_MENU.length + 1} menu items per outlet, ${billCount} bills over ${days} days`);
  });
  // Menu order and offers as they would be after a normal day, and this morning's vegetable
  // delivery waiting at the Indiranagar gate for the receiving app.
  const sys = Ctx.system(customer.id, db, 'system:seed');
  const outlets = await db.select().from(t.outlet).orderBy(t.outlet.code);
  for (const o of outlets) {
    await rerankOutlet(sys, o.id);
    await runOffers(sys, o.id);
  }
  const blr = outlets.find((o) => o.code === 'BLR1')!;
  const today = istDate(new Date());
  await buildIndents(sys, blr.id, today);
  const [veg] = await db
    .select({ id: t.indent.id })
    .from(t.indent)
    .innerJoin(t.vendor, eq(t.vendor.id, t.indent.vendorId))
    .where(and(eq(t.indent.outletId, blr.id), eq(t.indent.forDate, today), eq(t.vendor.name, 'Sample Vegetable Supplier')));
  if (veg) await sys.tx((tx) => approveIndent(sys, tx, veg.id));
  log(`Demo customer ready. Sign in as owner@demo.test / ${DEMO.password}`);
}

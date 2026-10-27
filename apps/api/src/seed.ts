import { and, eq } from 'drizzle-orm';
import { addOwner, asSystem, bootstrapCustomer } from './bootstrap.js';
import { Ctx } from './common.js';
import { rerankOutlet } from './pricing/ranking.js';
import { runOffers } from './pricing/offers.js';
import { rebuildRollups } from './reports/rollup.js';
import { approveIndent, buildIndents } from './purchasing/indents.js';
import { controlDb, controlSchema, createCustomer, dropCustomer, tenantSchema as t } from './db/index.js';
import { BAR_MENU, COCKTAILS, DEMO, FOOD_MENU, SOFT_MENU, istDate } from './seed/data.js';
import { seedMenus, seedPeople, seedStock, seedVendors } from './seed/setup.js';
import { seedSales } from './seed/sales.js';
import { seedExtras } from './seed/extras.js';

export async function seedDemo(opts: { reset?: boolean; log?: (s: string) => void } = {}) {
  const log = opts.log ?? console.log;
  if (opts.reset) await dropCustomer(DEMO.code);
  const [exists] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.code, DEMO.code));
  if (exists) {
    log('Demo customer already exists. Use "seed --reset" to rebuild it.');
    return;
  }
  const { customer, db } = await createCustomer({ code: DEMO.code, name: 'The White Tusker Hospitality' });
  await bootstrapCustomer(db);
  await addOwner(customer.id, db, { login: 'owner@demo.test', name: 'Vikramaditya Singhania', password: DEMO.password, pin: '1111' });

  await asSystem(db, 'system:seed', async (tx) => {
    const outlets = await seedPeople(tx, customer.id);
    const stock = await seedStock(tx, outlets);
    const days = 14;
    const firstDay = new Date(Date.now() - days * 86_400_000);
    await seedVendors(tx, stock.items, firstDay);
    const menus = await seedMenus(tx, outlets, stock);

    // Liquor offers switched on at the first sample outlet only, to show both states.
    await tx.insert(t.setting).values({ outletId: outlets[0].id, key: 'offers.liquorEnabled', value: true });
    await tx.insert(t.setting).values({ outletId: outlets[0].id, key: 'guest.pickTable', value: true }); // demo: pick a table on the guest menu

    const billCount = await seedSales(tx, outlets, stock, menus, days, firstDay);
    log(`Seeded data: 2 outlets, ${stock.items.size} stock items, ${FOOD_MENU.length + SOFT_MENU.length + BAR_MENU.length + COCKTAILS.length} menu items per outlet, ${billCount} bills over ${days} days`);
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
    .where(and(eq(t.indent.outletId, blr.id), eq(t.indent.forDate, today), eq(t.vendor.name, 'Green Valley Agro & Fresh Produce Ltd')));
  if (veg) await sys.tx((tx) => approveIndent(sys, tx, veg.id));
  await sys.tx((tx) => rebuildRollups(tx)); // the rollups on the dashboard
  await asSystem(db, 'system:seed', (tx) => seedExtras(tx, log));
  log(`Demo customer ready. Sign in as owner@demo.test / ${DEMO.password}`);
}

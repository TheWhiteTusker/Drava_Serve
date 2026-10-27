import { eq } from 'drizzle-orm';
import { billTotals, dec, rupees } from '@fnb/shared';
import { tenantSchema as t } from '../db/index.js';
import { LEFT_TODAY, istDate, rng } from './data.js';
import type { Tx } from '../db/index.js';
import type { Menus, Outlet, Stock } from './setup.js';

// A week of sample bills, then opening stock a week earlier sized so that what is left today
// ranges from about 10% to 130% of par: some items healthy, some to reorder, a few low.
export async function seedSales(tx: Tx, outlets: Outlet[], stock: Stock, menus: Menus, days: number, firstDay: Date) {
  const { items, pars, food, liquorTax } = stock;
  const stores = await tx.select().from(t.store);
  const storeOf = (outletId: string, kind: 'kitchen' | 'bar') => stores.find((s) => s.outletId === outletId && s.kind === kind)!;
  const cashier = (await tx.select().from(t.appUser).where(eq(t.appUser.login, 'cashier@demo.test')))[0];
  const ledger: (typeof t.stockLedger.$inferInsert)[] = [];
  const rand = rng(42);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

  // Pre-fetch all recipes into memory to avoid thousands of roundtrips to remote Postgres
  const allRecipes = await tx.select().from(t.recipeLine);
  const recipesByItem = new Map<string, (typeof t.recipeLine.$inferSelect)[]>();
  for (const r of allRecipes) {
    const list = recipesByItem.get(r.menuItemId) ?? [];
    list.push(r);
    recipesByItem.set(r.menuItemId, list);
  }

  const orderLinesToInsert: (typeof t.orderLine.$inferInsert)[] = [];
  const paymentsToInsert: (typeof t.payment.$inferInsert)[] = [];
  let billCount = 0;
  for (const o of outlets) {
    const menu = [...menus.get(o.id)!.values()];
    const tables = await tx.select().from(t.diningTable).where(eq(t.diningTable.outletId, o.id));
    for (let d = days - 1; d >= 0; d--) {
      const date = istDate(new Date(Date.now() - d * 86_400_000));
      const weekend = [0, 5, 6].includes(new Date(`${date}T12:00:00+05:30`).getDay());
      const n = Math.floor((weekend ? 22 : 14) + rand() * 8);
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
          orderLinesToInsert.push({
            billId: bill.id, orderId: order.id, menuItemId: l.c.item.id, name: l.c.item.name, department: l.c.item.department,
            taxClassId: l.tax.id, taxKind: l.tax.kind, qty: String(l.qty), menuPrice: l.c.item.sellingPrice, priceCharged: l.c.item.sellingPrice,
            costAtSale: l.c.cost, createdAt: opened, readyAt: paid,
          });
          const recipe = recipesByItem.get(l.c.item.id) ?? [];
          for (const r of recipe) {
            const s = [...items.values()].find((x) => x.id === r.stockItemId)!;
            ledger.push({
              outletId: o.id, storeId: storeOf(o.id, s.department === 'food' ? 'kitchen' : 'bar').id, stockItemId: s.id,
              qty: dec(r.quantity).times(l.qty).neg().toFixed(3), unitCost: s.currentCost, movement: 'sale', refType: 'bill', refId: bill.id, at: paid,
            });
          }
        }
        paymentsToInsert.push({ billId: bill.id, mode: pick(['cash', 'upi', 'upi', 'card'] as const), amount: totals.grandTotal, receivedAt: paid, receivedBy: cashier.id });
        billCount++;
      }
    }
  }
  for (let i = 0; i < orderLinesToInsert.length; i += 400) {
    await tx.insert(t.orderLine).values(orderLinesToInsert.slice(i, i + 400));
  }
  for (let i = 0; i < paymentsToInsert.length; i += 400) {
    await tx.insert(t.payment).values(paymentsToInsert.slice(i, i + 400));
  }
  const opening: (typeof t.stockLedger.$inferInsert)[] = [];
  for (const o of outlets) {
    for (const s of items.values()) {
      const storeId = storeOf(o.id, s.department === 'food' ? 'kitchen' : 'bar').id;
      const used = ledger.filter((l) => l.storeId === storeId && l.stockItemId === s.id).reduce((a, l) => a.minus(l.qty), dec(0));
      const left = LEFT_TODAY[o.code]?.[s.name] != null ? dec(LEFT_TODAY[o.code][s.name]) : dec(pars.get(s.name)!).times(0.1 + rand() * 1.2);
      opening.push({ outletId: o.id, storeId, stockItemId: s.id, qty: used.plus(left).toFixed(0), unitCost: s.currentCost, movement: 'opening', reason: 'Opening stock count', at: firstDay });
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
  return billCount;
}

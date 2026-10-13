import { and, eq, inArray, sql } from 'drizzle-orm';
import { dec, grossQty, istHour, rupees } from '@fnb/shared';
import { tenantSchema as t, type Q, type Tx } from '../db/index.js';

// Dashboard and reports (handoff 6.11). Every paid bill is rolled up into hourly and daily
// summary tables in the same transaction; the dashboard reads those, never raw bills.

// ---------- Roll-up ----------

// sign = 1 when a bill is paid, −1 when a paid bill is cancelled.
export async function rollupBill(tx: Tx, bill: typeof t.bill.$inferSelect, sign: 1 | -1) {
  const lines = await tx.select().from(t.orderLine).where(and(eq(t.orderLine.billId, bill.id), eq(t.orderLine.status, 'active')));
  if (!lines.length) return;
  const keep = dec(1).minus(dec(bill.manualDiscountPct).div(100)); // revenue after any approved discount
  const liquorMl = await alcoholMlPerPortion(tx, [...new Set(lines.map((l) => l.menuItemId))]);
  const byItemHour = new Map<string, { hour: number; menuItemId: string; units: ReturnType<typeof dec>; revenue: ReturnType<typeof dec>; cost: ReturnType<typeof dec> }>();
  const byDept = new Map<string, { revenue: ReturnType<typeof dec>; cost: ReturnType<typeof dec>; ml: ReturnType<typeof dec> }>();
  for (const l of lines) {
    const hour = istHour(l.createdAt); // demand by the hour the order was given
    const key = `${hour}|${l.menuItemId}`;
    const units = dec(l.qty).times(sign);
    const revenue = dec(l.qty).times(l.priceCharged).times(keep).times(sign);
    const cost = dec(l.qty).times(l.costAtSale ?? 0).times(sign);
    const row = byItemHour.get(key) ?? { hour, menuItemId: l.menuItemId, units: dec(0), revenue: dec(0), cost: dec(0) };
    byItemHour.set(key, { ...row, units: row.units.plus(units), revenue: row.revenue.plus(revenue), cost: row.cost.plus(cost) });
    const d = byDept.get(l.department) ?? { revenue: dec(0), cost: dec(0), ml: dec(0) };
    byDept.set(l.department, { revenue: d.revenue.plus(revenue), cost: d.cost.plus(cost), ml: d.ml.plus(dec(liquorMl.get(l.menuItemId) ?? 0).times(units)) });
  }
  for (const r of byItemHour.values()) {
    await tx
      .insert(t.salesHourly)
      .values({ outletId: bill.outletId, businessDate: bill.businessDate, hour: r.hour, menuItemId: r.menuItemId, units: r.units.toFixed(3), revenue: rupees(r.revenue), cost: rupees(r.cost) })
      .onConflictDoUpdate({
        target: [t.salesHourly.outletId, t.salesHourly.businessDate, t.salesHourly.hour, t.salesHourly.menuItemId],
        set: { units: sql`${t.salesHourly.units} + excluded.units`, revenue: sql`${t.salesHourly.revenue} + excluded.revenue`, cost: sql`${t.salesHourly.cost} + excluded.cost` },
      });
  }
  for (const [department, d] of byDept) {
    await tx
      .insert(t.salesDaily)
      .values({ outletId: bill.outletId, businessDate: bill.businessDate, department: department as any, bills: sign, revenue: rupees(d.revenue), cost: rupees(d.cost), alcoholMl: d.ml.toFixed(3) })
      .onConflictDoUpdate({
        target: [t.salesDaily.outletId, t.salesDaily.businessDate, t.salesDaily.department],
        set: {
          bills: sql`${t.salesDaily.bills} + excluded.bills`, revenue: sql`${t.salesDaily.revenue} + excluded.revenue`,
          cost: sql`${t.salesDaily.cost} + excluded.cost`, alcoholMl: sql`${t.salesDaily.alcoholMl} + excluded.alcohol_ml`,
        },
      });
  }
  const minutes = bill.paidAt ? Math.max(0, Math.round((bill.paidAt.getTime() - bill.openedAt.getTime()) / 60_000)) : 0;
  const net = [...byDept.values()].reduce((a, d) => a.plus(d.revenue), dec(0));
  await tx
    .insert(t.billHourly)
    .values({ outletId: bill.outletId, businessDate: bill.businessDate, hour: istHour(bill.openedAt), bills: sign, revenue: rupees(net), minutesSpent: minutes * sign })
    .onConflictDoUpdate({
      target: [t.billHourly.outletId, t.billHourly.businessDate, t.billHourly.hour],
      set: { bills: sql`${t.billHourly.bills} + excluded.bills`, revenue: sql`${t.billHourly.revenue} + excluded.revenue`, minutesSpent: sql`${t.billHourly.minutesSpent} + excluded.minutes_spent` },
    });
}

// Millilitres of liquor (stock with alcohol %) in one portion of each menu item.
async function alcoholMlPerPortion(q: Q, menuItemIds: string[]) {
  const rows = await q
    .select({ menuItemId: t.recipeLine.menuItemId, qty: t.recipeLine.quantity, yieldPct: t.recipeLine.yieldPct })
    .from(t.recipeLine)
    .innerJoin(t.stockItem, eq(t.stockItem.id, t.recipeLine.stockItemId))
    .where(and(inArray(t.recipeLine.menuItemId, menuItemIds), sql`${t.stockItem.abvPct} > 0`, eq(t.stockItem.baseUnit, 'ml')));
  const out = new Map<string, string>();
  for (const r of rows) out.set(r.menuItemId, dec(out.get(r.menuItemId) ?? 0).plus(grossQty(r.qty, r.yieldPct)).toString());
  return out;
}

// Rebuilds the summaries from scratch (after importing history, or to repair).
export async function rebuildRollups(tx: Tx) {
  await tx.delete(t.salesHourly);
  await tx.delete(t.salesDaily);
  await tx.delete(t.billHourly);
  const bills = await tx.select().from(t.bill).where(inArray(t.bill.status, ['paid', 'refunded']));
  for (const b of bills) await rollupBill(tx, b, 1);
  return bills.length;
}

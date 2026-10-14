import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { billTotals, dec, grossQty, istDate, rupees, zMoney, zQty, PAYMENT_MODES } from '@fnb/shared';
import { z } from 'zod';
import { Ctx, findOr404 } from '../common.js';
import { tenantSchema as t, type Q, type Tx } from '../db/index.js';
import { publish } from '../events.js';
import { issuingStores } from '../stock/availability.js';

// Billing POS (handoff 6.11). A bill opens at the first order; later orders join it; payment
// deducts stock per recipe in one transaction. Every write carries the device's own ids, so a
// bill saved offline and sent later is stored exactly once.

export const zLine = z.object({
  menuItemId: z.uuid(),
  qty: zQty.refine((v) => dec(v).gt(0), 'Quantity must be more than zero'),
  priceCharged: zMoney.optional(), // only trusted for orders taken offline
  activeDiscountId: z.uuid().nullish(),
});
export const zOrder = z.object({
  outletId: z.uuid(),
  bill: z.object({
    clientId: z.uuid(),
    kind: z.enum(['dine_in', 'takeaway']),
    tableId: z.uuid().nullish(),
    number: z.string().trim().max(40).nullish(),
  }),
  order: z.object({ clientId: z.uuid(), placedAt: z.iso.datetime({ offset: true }), lines: z.array(zLine).min(1) }),
  offline: z.boolean().default(false),
});
export const zPay = z.object({
  billClientId: z.uuid(),
  paidAt: z.iso.datetime({ offset: true }),
  payments: z.array(z.object({ clientId: z.uuid(), mode: z.enum(PAYMENT_MODES), amount: zMoney, reference: z.string().max(80).nullish() })).min(1),
  offline: z.boolean().default(false),
});

// Bill totals from its active lines: food and liquor separately, each with its own taxes.
export async function recomputeBill(tx: Tx, billId: string) {
  const [bill] = await tx.select().from(t.bill).where(eq(t.bill.id, billId));
  const lines = await tx
    .select({ l: t.orderLine, components: t.taxClass.components })
    .from(t.orderLine)
    .innerJoin(t.taxClass, eq(t.taxClass.id, t.orderLine.taxClassId))
    .where(and(eq(t.orderLine.billId, billId), eq(t.orderLine.status, 'active')));
  const totals = billTotals(
    lines.map((x) => ({ qty: x.l.qty, unitPrice: x.l.priceCharged, taxClass: { kind: x.l.taxKind, components: x.components } })),
    { discountPct: bill.manualDiscountPct },
  );
  const tax = (d: typeof totals.food) => rupees(dec(d.total).minus(d.subtotal).plus(d.discount));
  const [row] = await tx
    .update(t.bill)
    .set({
      foodSubtotal: totals.food.subtotal, foodTax: tax(totals.food), liquorSubtotal: totals.liquor.subtotal, liquorTax: tax(totals.liquor),
      manualDiscount: totals.discount, taxes: totals, roundOff: totals.roundOff, total: totals.grandTotal, updatedAt: new Date(),
    })
    .where(eq(t.bill.id, billId))
    .returning();
  return row;
}

// Everything the POS shows for a bill, including what the receipt prints.
export async function billView(q: Q, billId: string) {
  const bill = await findOr404(q.select().from(t.bill).where(eq(t.bill.id, billId)));
  const lines = await q
    .select({ l: t.orderLine, dietType: t.menuItem.dietType })
    .from(t.orderLine)
    .innerJoin(t.menuItem, eq(t.menuItem.id, t.orderLine.menuItemId))
    .where(eq(t.orderLine.billId, billId))
    .orderBy(asc(t.orderLine.createdAt));
  const payments = await q.select().from(t.payment).where(eq(t.payment.billId, billId)).orderBy(t.payment.receivedAt);
  const table = bill.tableId ? (await q.select({ name: t.diningTable.name }).from(t.diningTable).where(eq(t.diningTable.id, bill.tableId)))[0]?.name : null;
  // The receipt shows only the price charged: no menu price, no offer line.
  return {
    ...bill,
    table,
    lines: lines.map(({ l, dietType }) => ({
      id: l.id, orderId: l.orderId, menuItemId: l.menuItemId, name: l.name, department: l.department, taxKind: l.taxKind, dietType,
      qty: l.qty, price: l.priceCharged, amount: rupees(dec(l.qty).times(l.priceCharged)), status: l.status, voidReason: l.voidReason, at: l.createdAt,
    })),
    payments,
  };
}

// Every counter gets the changed bill in the event itself, so none of them has to ask for it.
// Sent in the background: the cashier's own response does not wait for it.
export function publishBill(ctx: Ctx, outletId: string, billId: string) {
  billView(ctx.db, billId)
    .then((bill) => publish(ctx.customerId, outletId, 'bill', { id: billId, bill }))
    .catch((e) => console.error('bill event failed', e));
}

export async function nextNumber(tx: Tx, outlet: typeof t.outlet.$inferSelect, at: Date) {
  const day = istDate(at).replaceAll('-', '');
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`bill:${outlet.id}:${day}`}))`);
  const [{ n }] = (await tx.execute(sql`select count(*)::int + 1 as n from bill where outlet_id = ${outlet.id} and number like ${`${outlet.code}-${day}-S%`}`)).rows as any[];
  return `${outlet.code}-${day}-S${String(n).padStart(3, '0')}`;
}

// Stock moves for a bill's active lines: recipe quantity × portions, from the issuing store.
export async function saleMoves(tx: Tx, bill: typeof t.bill.$inferSelect, sign: 1 | -1) {
  const lines = await tx.select().from(t.orderLine).where(and(eq(t.orderLine.billId, bill.id), eq(t.orderLine.status, 'active')));
  if (!lines.length) return [];
  const recipe = await tx
    .select({ r: t.recipeLine, department: t.stockItem.department })
    .from(t.recipeLine)
    .innerJoin(t.stockItem, eq(t.stockItem.id, t.recipeLine.stockItemId))
    .where(inArray(t.recipeLine.menuItemId, [...new Set(lines.map((l) => l.menuItemId))]));
  const stores = await issuingStores(tx, bill.outletId);
  const need = new Map<string, { storeId: string; stockItemId: string; qty: ReturnType<typeof dec> }>();
  for (const l of lines) {
    for (const { r, department } of recipe.filter((x) => x.r.menuItemId === l.menuItemId)) {
      const storeId = (department === 'food' ? stores.food : stores.beverage)!.id;
      const key = `${storeId}|${r.stockItemId}`;
      const prev = need.get(key)?.qty ?? dec(0);
      need.set(key, { storeId, stockItemId: r.stockItemId, qty: prev.plus(grossQty(r.quantity, r.yieldPct).times(l.qty)) });
    }
  }
  return [...need.values()].map((n) => ({
    storeId: n.storeId, stockItemId: n.stockItemId, qty: n.qty.times(-sign).toFixed(3),
    movement: (sign === 1 ? 'sale' : 'reversal') as 'sale' | 'reversal', refType: 'bill', refId: bill.id,
  }));
}

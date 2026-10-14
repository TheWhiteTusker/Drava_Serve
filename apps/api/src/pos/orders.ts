import { BadRequestException, ConflictException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { businessDate, dec, grossQty } from '@fnb/shared';
import { z } from 'zod';
import { getSettings } from '../access/settings.js';
import { Ctx, findOr404 } from '../common.js';
import { tenantSchema as t, type Tx } from '../db/index.js';
import { costOf } from '../pricing/costing.js';
import { currentOffers } from '../pricing/offers.js';
import { availability, issuingStores, refreshAvailability, reservedByOpenBills } from '../stock/availability.js';
import { nextNumber, publishBill, recomputeBill, zLine, zOrder } from './bills.js';

// ---------- Placing an order (the counter, and accepted guest orders) ----------

export function placeOrder(ctx: Ctx, o: z.infer<typeof zOrder>, guest?: (tx: Tx, bill: typeof t.bill.$inferSelect) => Promise<void>) {
  const placedAt = new Date(o.order.placedAt);
  return ctx.tx(async (tx) => {
    const outlet = await findOr404(tx.select().from(t.outlet).where(eq(t.outlet.id, o.outletId)));
    // Exactly once: the same order sent twice returns the bill as it is.
    const [seen] = await tx.select({ billId: t.billOrder.billId }).from(t.billOrder).where(eq(t.billOrder.clientId, o.order.clientId));
    if (seen) return seen.billId;

    let [bill] = await tx.select().from(t.bill).where(eq(t.bill.clientId, o.bill.clientId)).for('update');
    if (!bill) {
      const settings = (await getSettings(tx, o.outletId)).effective;
      [bill] = await tx
        .insert(t.bill)
        .values({
          outletId: o.outletId, clientId: o.bill.clientId, kind: o.bill.kind, tableId: o.bill.kind === 'dine_in' ? (o.bill.tableId ?? null) : null,
          number: o.bill.number ?? (await nextNumber(tx, outlet, placedAt)), status: 'open', openedAt: placedAt,
          businessDate: businessDate(placedAt, settings['business.dayStart'] as string), openedBy: ctx.userId!, deviceId: ctx.deviceId,
        })
        .returning();
    }
    if (bill.outletId !== o.outletId) throw new BadRequestException('This bill belongs to another outlet');
    if (bill.status !== 'open') throw new ConflictException(`This bill is already ${bill.status}`);
    await guest?.(tx, bill);

    const ids = [...new Set(o.order.lines.map((l) => l.menuItemId))];
    const items = await tx
      .select({ m: t.menuItem, taxKind: t.taxClass.kind })
      .from(t.menuItem)
      .innerJoin(t.taxClass, eq(t.taxClass.id, t.menuItem.taxClassId))
      .where(and(inArray(t.menuItem.id, ids), eq(t.menuItem.outletId, o.outletId)));
    if (items.length !== ids.length) throw new BadRequestException('An item is not on this outlet\'s menu');
    if (!o.offline) await checkStock(tx, o.outletId, o.order.lines, items.map((i) => i.m));

    const offers = await currentOffers(tx, o.outletId, bill.openedAt);
    const costs = await costOf(tx, ids);
    const [order] = await tx.insert(t.billOrder).values({ billId: bill.id, clientId: o.order.clientId, placedAt, placedBy: ctx.userId! }).returning();
    await tx.insert(t.orderLine).values(
      o.order.lines.map((l) => {
        const { m, taxKind } = items.find((i) => i.m.id === l.menuItemId)!;
        const offer = offers.get(m.id);
        // Online: today's price (an offer's, if one is running). Offline: what the device charged.
        const price = o.offline && l.priceCharged ? l.priceCharged : (offer?.offerPrice ?? m.sellingPrice);
        const discountId = o.offline ? (l.activeDiscountId ?? null) : (offer?.id ?? null);
        return {
          billId: bill.id, orderId: order.id, menuItemId: m.id, name: m.name, department: m.department, taxClassId: m.taxClassId, taxKind,
          qty: l.qty, menuPrice: m.sellingPrice, priceCharged: price, activeDiscountId: discountId, costAtSale: costs.get(m.id) ?? null, createdAt: placedAt,
        };
      }),
    );
    await recomputeBill(tx, bill.id);
    ctx.afterCommit(async () => {
      await refreshAvailability(ctx, o.outletId); // ordered portions are now reserved
      publishBill(ctx, o.outletId, bill.id);
    });
    return bill.id;
  });
}

// Locks the stock rows the order needs, then checks what is left after other open bills.
async function checkStock(tx: Tx, outletId: string, lines: z.infer<typeof zLine>[], items: (typeof t.menuItem.$inferSelect)[]) {
  const recipe = await tx
    .select({ r: t.recipeLine, department: t.stockItem.department, name: t.stockItem.name })
    .from(t.recipeLine)
    .innerJoin(t.stockItem, eq(t.stockItem.id, t.recipeLine.stockItemId))
    .where(inArray(t.recipeLine.menuItemId, items.map((i) => i.id)));
  if (!recipe.length) return;
  const stores = await issuingStores(tx, outletId);
  const storeOf = (dept: string) => (dept === 'food' ? stores.food : stores.beverage)!.id;
  const pairs = [...new Map(recipe.map((x) => [`${storeOf(x.department)}|${x.r.stockItemId}`, { storeId: storeOf(x.department), stockItemId: x.r.stockItemId }])).values()].sort((a, b) =>
    `${a.storeId}|${a.stockItemId}`.localeCompare(`${b.storeId}|${b.stockItemId}`),
  );
  const balances = await tx
    .select()
    .from(t.stockBalance)
    .where(sql`(${t.stockBalance.storeId}, ${t.stockBalance.stockItemId}) in (${sql.join(pairs.map((p) => sql`(${p.storeId}::uuid, ${p.stockItemId}::uuid)`), sql`, `)})`)
    .orderBy(t.stockBalance.storeId, t.stockBalance.stockItemId)
    .for('update');
  const reserved = await reservedByOpenBills(tx, outletId);
  const need = new Map<string, ReturnType<typeof dec>>();
  for (const l of lines) {
    for (const x of recipe.filter((r) => r.r.menuItemId === l.menuItemId)) {
      need.set(x.r.stockItemId, (need.get(x.r.stockItemId) ?? dec(0)).plus(grossQty(x.r.quantity, x.r.yieldPct).times(l.qty)));
    }
  }
  const short: string[] = [];
  for (const [stockItemId, qty] of need) {
    const x = recipe.find((r) => r.r.stockItemId === stockItemId)!;
    const bal = balances.find((b) => b.stockItemId === stockItemId && b.storeId === storeOf(x.department))?.qty ?? '0';
    if (dec(bal).minus(reserved.get(stockItemId) ?? 0).lt(qty)) short.push(stockItemId);
  }
  if (short.length) {
    const soldOut = items.filter((i) => recipe.some((r) => r.r.menuItemId === i.id && short.includes(r.r.stockItemId)));
    const left = await availability(tx, outletId, soldOut.map((s) => s.id));
    throw new ConflictException({
      statusCode: 409,
      message: `Just sold out: ${soldOut.map((s) => `${s.name} (${left.get(s.id)?.portions ?? 0} left)`).join(', ')}`,
      soldOut: soldOut.map((s) => ({ menuItemId: s.id, portions: left.get(s.id)?.portions ?? 0 })),
    });
  }
}

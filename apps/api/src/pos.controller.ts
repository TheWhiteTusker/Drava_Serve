import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { billTotals, businessDate, dec, grossQty, istDate, rupees, zMoney, zPct, zQty, PAYMENT_MODES } from '@fnb/shared';
import { z } from 'zod';
import { getSettings } from './access.controller.js';
import { logActivity, money } from './activity.js';
import { proposeOrApply, registerApproval } from './approvals.js';
import { C, Ctx, findOr404, parse } from './common.js';
import { tenantSchema as t, type Q, type Tx } from './db/index.js';
import { publish, publishGuest } from './events.js';
import { liquorRegister } from './inventory.controller.js';
import { costOf, currentOffers, endOffersForDay, menuForSale } from './pricing.js';
import { rollupBill } from './reports.js';
import { availability, issuingStores, refreshAvailability, reservedByOpenBills, stockTx, type Post as PostStock } from './stock.js';

// Billing POS (handoff 6.11). A bill opens at the first order; later orders join it; payment
// deducts stock per recipe in one transaction. Every write carries the device's own ids, so a
// bill saved offline and sent later is stored exactly once.

const zLine = z.object({
  menuItemId: z.uuid(),
  qty: zQty.refine((v) => dec(v).gt(0), 'Quantity must be more than zero'),
  priceCharged: zMoney.optional(), // only trusted for orders taken offline
  activeDiscountId: z.uuid().nullish(),
});
const zOrder = z.object({
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
const zPay = z.object({
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
function publishBill(ctx: Ctx, outletId: string, billId: string) {
  billView(ctx.db, billId)
    .then((bill) => publish(ctx.customerId, outletId, 'bill', { id: billId, bill }))
    .catch((e) => console.error('bill event failed', e));
}

async function nextNumber(tx: Tx, outlet: typeof t.outlet.$inferSelect, at: Date) {
  const day = istDate(at).replaceAll('-', '');
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`bill:${outlet.id}:${day}`}))`);
  const [{ n }] = (await tx.execute(sql`select count(*)::int + 1 as n from bill where outlet_id = ${outlet.id} and number like ${`${outlet.code}-${day}-S%`}`)).rows as any[];
  return `${outlet.code}-${day}-S${String(n).padStart(3, '0')}`;
}

// Stock moves for a bill's active lines: recipe quantity × portions, from the issuing store.
async function saleMoves(tx: Tx, bill: typeof t.bill.$inferSelect, sign: 1 | -1) {
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

// ---------- Approval handlers ----------

registerApproval('bill_cancel', 'Cancel a bill', async (ctx, tx, req, post) => {
  const [bill] = await tx.select().from(t.bill).where(eq(t.bill.id, req.entityId!)).for('update');
  if (!['open', 'paid'].includes(bill.status)) throw new ConflictException(`This bill is already ${bill.status}`);
  if (bill.status === 'paid') {
    // Stock comes back and the sale leaves the dashboard.
    await post(await saleMoves(tx, bill, -1), { allowNegative: true });
    await rollupBill(tx, bill, -1);
  }
  await tx.update(t.bill).set({ status: 'cancelled', cancelReason: req.reason, approvalId: req.id, updatedAt: new Date() }).where(eq(t.bill.id, bill.id));
  ctx.afterCommit(() => publishBill(ctx, bill.outletId, bill.id));
});

registerApproval('refund', 'Refund on a paid bill', async (ctx, tx, req) => {
  const p = req.proposed as { amount: string; mode: string; reference?: string };
  const [bill] = await tx.select().from(t.bill).where(eq(t.bill.id, req.entityId!)).for('update');
  if (bill.status !== 'paid') throw new ConflictException('Only a paid bill can be refunded');
  await tx.insert(t.payment).values({ billId: bill.id, mode: p.mode as any, amount: dec(p.amount).neg().toFixed(2), reference: p.reference ?? `refund: ${req.reason ?? ''}`, receivedBy: ctx.userId ?? bill.closedBy! });
  const [{ net }] = (await tx.execute(sql`select coalesce(sum(amount), 0) as net from payment where bill_id = ${bill.id}`)).rows as any[];
  if (dec(net).lte(0)) await tx.update(t.bill).set({ status: 'refunded', approvalId: req.id, updatedAt: new Date() }).where(eq(t.bill.id, bill.id));
});

registerApproval('manual_discount', 'Manual discount on a bill', async (ctx, tx, req) => {
  const p = req.proposed as { discountPct: string };
  const [bill] = await tx.select().from(t.bill).where(eq(t.bill.id, req.entityId!)).for('update');
  if (bill.status !== 'open') throw new ConflictException('Discounts apply to open bills only');
  await tx.update(t.bill).set({ manualDiscountPct: p.discountPct, approvalId: req.id }).where(eq(t.bill.id, bill.id));
  await recomputeBill(tx, bill.id);
  ctx.afterCommit(() => publishBill(ctx, bill.outletId, bill.id));
});

registerApproval('line_void', 'Remove an item from a bill', async (ctx, tx, req) => {
  const p = req.proposed as { lineId: string };
  const [bill] = await tx.select().from(t.bill).where(eq(t.bill.id, req.entityId!)).for('update');
  if (bill.status !== 'open') throw new ConflictException('Items can be removed from open bills only');
  await tx.update(t.orderLine).set({ status: 'voided', voidReason: req.reason }).where(and(eq(t.orderLine.id, p.lineId), eq(t.orderLine.billId, bill.id)));
  await recomputeBill(tx, bill.id);
  ctx.afterCommit(async () => {
    await refreshAvailability(ctx, bill.outletId);
    publishBill(ctx, bill.outletId, bill.id);
  });
});

// ---------- Controller ----------

@Controller('pos')
export class PosController {
  // Everything the POS needs to bill, cached on the device for offline use. No costs or margins.
  @Get('catalog')
  async catalog(@C() ctx: Ctx, @Query('outletId') outletId: string) {
    ctx.assert('pos.bill', outletId);
    const outlet = await findOr404(ctx.db.select().from(t.outlet).where(eq(t.outlet.id, outletId)));
    const [menu, taxClasses, tables, settings] = await Promise.all([
      menuForSale(ctx.db, outletId),
      ctx.db.select({ id: t.taxClass.id, kind: t.taxClass.kind, components: t.taxClass.components }).from(t.taxClass),
      ctx.db.select().from(t.diningTable).where(and(eq(t.diningTable.outletId, outletId), eq(t.diningTable.active, true))).orderBy(t.diningTable.sortOrder),
      getSettings(ctx.db, outletId),
    ]);
    return {
      outlet: { id: outlet.id, name: outlet.name, code: outlet.code, address: outlet.address, gstin: outlet.gstin, fssaiNumber: outlet.fssaiNumber },
      dayStart: settings.effective['business.dayStart'],
      menu, taxClasses, tables, syncedAt: new Date().toISOString(),
    };
  }

  @Get('bills')
  async bills(@C() ctx: Ctx, @Query('outletId') outletId: string, @Query('status') status = 'open', @Query('date') date?: string) {
    ctx.assert('pos.bill', outletId);
    const rows = await ctx.db
      .select({ id: t.bill.id })
      .from(t.bill)
      .where(and(eq(t.bill.outletId, outletId), eq(t.bill.status, status as any), date ? eq(t.bill.businessDate, date) : undefined))
      .orderBy(desc(t.bill.openedAt))
      .limit(100);
    return Promise.all(rows.map((r) => billView(ctx.db, r.id)));
  }

  @Get('bills/:id')
  async bill(@C() ctx: Ctx, @Param('id') id: string) {
    const b = await billView(ctx.db, id);
    ctx.assert('pos.bill', b.outletId);
    return b;
  }

  // An order: opens the bill if this is the first one, otherwise adds to it. Online orders
  // check stock under a lock so two counters cannot both sell the last portion; orders taken
  // offline are accepted as priced on the device, and any shortfall shows in the ledger.
  @Post('orders')
  async order(@C() ctx: Ctx, @Body() body: unknown) {
    const o = parse(zOrder, body);
    ctx.assert('pos.bill', o.outletId);
    return billView(ctx.db, await this.place(ctx, o));
  }

  private place(ctx: Ctx, o: z.infer<typeof zOrder>, guest?: (tx: Tx, bill: typeof t.bill.$inferSelect) => Promise<void>) {
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
      if (!o.offline) await this.checkStock(tx, o.outletId, o.order.lines, items.map((i) => i.m));

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

  // ---------- Orders guests sent from the table QR menu ----------

  @Get('guest-orders')
  async guestOrders(@C() ctx: Ctx, @Query('outletId') outletId: string) {
    ctx.assert('pos.bill', outletId);
    return ctx.db
      .select({ g: t.guestOrder, table: t.diningTable.name })
      .from(t.guestOrder)
      .innerJoin(t.diningTable, eq(t.diningTable.id, t.guestOrder.tableId))
      .where(and(eq(t.guestOrder.outletId, outletId), eq(t.guestOrder.status, 'pending')))
      .orderBy(asc(t.guestOrder.createdAt))
      .then((rows) => rows.map(({ g, table }) => ({ ...g, table })));
  }

  // Accepting puts the guest's items on the table's bill exactly as a cashier's order would:
  // today's prices and a stock check under lock. The bill is the table's open one, or a new one.
  @Post('guest-orders/:id/accept')
  async acceptGuest(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ bill: z.object({ clientId: z.uuid(), number: z.string().trim().max(40).nullish() }) }), body);
    const g = await findOr404(ctx.db.select().from(t.guestOrder).where(eq(t.guestOrder.id, id)));
    ctx.assert('pos.bill', g.outletId);
    const o = {
      outletId: g.outletId,
      bill: { clientId: b.bill.clientId, kind: 'dine_in' as const, tableId: g.tableId, number: b.bill.number },
      order: { clientId: randomUUID(), placedAt: new Date().toISOString(), lines: g.lines.map((l) => ({ menuItemId: l.menuItemId, qty: String(l.qty) })) },
      offline: false,
    };
    const billId = await this.place(ctx, o, async (tx, bill) => {
      const [locked] = await tx.select().from(t.guestOrder).where(eq(t.guestOrder.id, id)).for('update');
      if (locked.status !== 'pending') throw new ConflictException(`This order was already ${locked.status === 'accepted' ? 'accepted' : 'turned down'}`);
      if (bill.tableId !== g.tableId) throw new BadRequestException('That bill is for another table');
      await tx.update(t.guestOrder).set({ status: 'accepted', billId: bill.id, decidedBy: ctx.userId, decidedAt: new Date() }).where(eq(t.guestOrder.id, id));
    });
    this.guestDecided(ctx, g.outletId, id, 'accepted');
    return billView(ctx.db, billId);
  }

  @Post('guest-orders/:id/reject')
  async rejectGuest(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(z.object({ reason: z.string().trim().max(200).nullish() }), body);
    const g = await findOr404(ctx.db.select().from(t.guestOrder).where(eq(t.guestOrder.id, id)));
    ctx.assert('pos.bill', g.outletId);
    const [row] = await ctx.tx((tx) =>
      tx
        .update(t.guestOrder)
        .set({ status: 'rejected', reason: reason || null, decidedBy: ctx.userId, decidedAt: new Date() })
        .where(and(eq(t.guestOrder.id, id), eq(t.guestOrder.status, 'pending')))
        .returning(),
    );
    if (!row) throw new ConflictException('This order was already decided');
    this.guestDecided(ctx, g.outletId, id, 'rejected', row.reason);
    return { id, status: 'rejected' };
  }

  // Tells the other counters to drop it from their list, and the guest's phone how it went.
  private guestDecided(ctx: Ctx, outletId: string, id: string, status: string, reason: string | null = null) {
    publish(ctx.customerId, outletId, 'guestOrder', { id, status });
    publishGuest(id, { status, reason });
  }

  // Locks the stock rows the order needs, then checks what is left after other open bills.
  private async checkStock(tx: Tx, outletId: string, lines: z.infer<typeof zLine>[], items: (typeof t.menuItem.$inferSelect)[]) {
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

  // Payment closes the bill and deducts stock per recipe in the same transaction.
  @Post('payments')
  async pay(@C() ctx: Ctx, @Body() body: unknown) {
    const p = parse(zPay, body);
    const billId = await stockTx(ctx, async (tx, post) => {
      const [bill] = await tx.select().from(t.bill).where(eq(t.bill.clientId, p.billClientId)).for('update');
      if (!bill) throw new BadRequestException('Unknown bill. Send its orders first.');
      ctx.assert('pos.bill', bill.outletId);
      const known = await tx.select({ clientId: t.payment.clientId }).from(t.payment).where(inArray(t.payment.clientId, p.payments.map((x) => x.clientId)));
      if (bill.status === 'paid' && known.length === p.payments.length) return bill.id; // sent twice: already done
      if (bill.status !== 'open') throw new ConflictException(`This bill is already ${bill.status}`);
      const fresh = p.payments.filter((x) => !known.some((k) => k.clientId === x.clientId));
      const total = fresh.reduce((a, x) => a.plus(x.amount), dec(0));
      if (total.lt(bill.total)) throw new BadRequestException(`Payments ${rupees(total)} are less than the bill ${rupees(bill.total)}`);
      const paidAt = new Date(p.paidAt);
      if (fresh.length) await tx.insert(t.payment).values(fresh.map((x) => ({ billId: bill.id, clientId: x.clientId, mode: x.mode, amount: x.amount, reference: x.reference ?? null, receivedAt: paidAt, receivedBy: ctx.userId! })));
      const settings = (await getSettings(tx, bill.outletId)).effective;
      const [paid] = await tx
        .update(t.bill)
        .set({ status: 'paid', paidAt, closedBy: ctx.userId, businessDate: businessDate(paidAt, settings['business.dayStart'] as string), updatedAt: new Date() })
        .where(eq(t.bill.id, bill.id))
        .returning();
      // Stock deducts now. A shortfall (sold offline after it ran out) is recorded, never refused.
      await post(await saleMoves(tx, paid, 1), { allowNegative: true });
      await rollupBill(tx, paid, 1);
      ctx.afterCommit(() => publishBill(ctx, bill.outletId, bill.id));
      return bill.id;
    });
    return billView(ctx.db, billId);
  }

  // Cancelling, refunding, removing an item or discounting needs a manager's approval.
  @Post('bills/:id/cancel')
  async cancel(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Give a reason') }), body);
    return this.request(ctx, id, 'bill_cancel', { summary: 'Cancel the bill' }, reason);
  }

  @Post('bills/:id/refund')
  async refund(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ amount: zMoney, mode: z.enum(PAYMENT_MODES), reason: z.string().trim().min(3, 'Give a reason') }), body);
    const bill = await findOr404(ctx.db.select().from(t.bill).where(eq(t.bill.id, id)));
    if (dec(b.amount).gt(bill.total)) throw new BadRequestException('A refund cannot be more than the bill');
    return this.request(ctx, id, 'refund', { amount: b.amount, mode: b.mode }, b.reason);
  }

  @Post('bills/:id/discount')
  async discount(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ discountPct: zPct.refine((v) => dec(v).gt(0), 'More than zero'), reason: z.string().trim().min(3, 'Give a reason') }), body);
    return this.request(ctx, id, 'manual_discount', { discountPct: b.discountPct }, b.reason);
  }

  @Post('bills/:id/void')
  async voidLine(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ lineId: z.uuid(), reason: z.string().trim().min(3, 'Give a reason') }), body);
    const [line] = await ctx.db.select().from(t.orderLine).where(and(eq(t.orderLine.id, b.lineId), eq(t.orderLine.billId, id)));
    if (!line) throw new BadRequestException('That item is not on this bill');
    return this.request(ctx, id, 'line_void', { lineId: b.lineId, summary: `Remove ${dec(line.qty).toString()} × ${line.name}` }, b.reason);
  }

  private async request(ctx: Ctx, billId: string, type: string, proposed: Record<string, unknown>, reason: string) {
    const bill = await findOr404(ctx.db.select().from(t.bill).where(eq(t.bill.id, billId)));
    ctx.assert('pos.bill', bill.outletId);
    const r = await stockTx(ctx, (tx, post: PostStock) =>
      proposeOrApply(ctx, tx, post, { outletId: bill.outletId, type, entity: 'bill', entityId: billId, current: { number: bill.number, total: bill.total }, proposed: { ...proposed, summary: `${proposed.summary ?? type} on bill ${bill.number}` }, reason }),
    );
    return { ...r, bill: await billView(ctx.db, billId) };
  }

  // ---------- Day close ----------

  @Get('day-close')
  async dayPreview(@C() ctx: Ctx, @Query('outletId') outletId: string, @Query('date') date: string) {
    ctx.assert('pos.dayClose', outletId);
    const [closed] = await ctx.db.select().from(t.dayClose).where(and(eq(t.dayClose.outletId, outletId), eq(t.dayClose.businessDate, date)));
    return { closed: closed ?? null, totals: closed?.totals ?? (await dayTotals(ctx.db, outletId, date)) };
  }

  // Totals the day's sales and cash and closes the liquor register for the day.
  @Post('day-close')
  async closeDay(@C() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ outletId: z.uuid(), businessDate: z.iso.date(), cashCounted: zMoney.nullish(), notes: z.string().max(500).nullish() }), body);
    ctx.assert('pos.dayClose', b.outletId);
    const totals = await dayTotals(ctx.db, b.outletId, b.businessDate);
    if (totals.openBills > 0) throw new ConflictException(`${totals.openBills} bill(s) from this day are still open. Settle or cancel them first.`);
    const register = await liquorRegister(ctx.db, b.outletId, b.businessDate);
    const full = {
      ...totals,
      cashCounted: b.cashCounted ?? null,
      cashDifference: b.cashCounted != null ? rupees(dec(b.cashCounted).minus(totals.byMode.cash ?? 0)) : null,
      liquorRegister: register.rows.map((r: any) => ({ name: r.name, closingMl: r.ml.closing, closingBottles: r.bottles.closing, salesMl: r.ml.sales })),
    };
    const [row] = await ctx.tx((tx) =>
      tx.insert(t.dayClose).values({ outletId: b.outletId, businessDate: b.businessDate, closedBy: ctx.userId!, totals: full, cashCounted: b.cashCounted ?? null, notes: b.notes ?? null }).returning(),
    );
    await logActivity(ctx, ctx.db, {
      outletId: b.outletId, kind: 'day_closed', title: 'Day closed',
      message: `${b.businessDate} was closed: ${totals.bills} bills, ${money(totals.total)} in total${full.cashDifference && Number(full.cashDifference) !== 0 ? `, cash ${Number(full.cashDifference) > 0 ? 'over' : 'short'} by ${money(Math.abs(Number(full.cashDifference)))}` : ''}.`,
      data: { businessDate: b.businessDate },
    });
    await endOffersForDay(ctx, b.outletId);
    return row;
  }
}

export async function dayTotals(q: Q, outletId: string, date: string) {
  const bills = await q.select().from(t.bill).where(and(eq(t.bill.outletId, outletId), eq(t.bill.businessDate, date)));
  const paid = bills.filter((b) => b.status === 'paid' || b.status === 'refunded');
  const sumOf = (k: 'foodSubtotal' | 'foodTax' | 'liquorSubtotal' | 'liquorTax' | 'manualDiscount' | 'roundOff' | 'total') =>
    rupees(paid.reduce((a, b) => a.plus(b[k]), dec(0)));
  const payments = paid.length ? await q.select().from(t.payment).where(inArray(t.payment.billId, paid.map((b) => b.id))) : [];
  const byMode: Record<string, string> = {};
  for (const p of payments) byMode[p.mode] = rupees(dec(byMode[p.mode] ?? 0).plus(p.amount));
  return {
    businessDate: date,
    bills: paid.length,
    openBills: bills.filter((b) => b.status === 'open').length,
    cancelled: bills.filter((b) => b.status === 'cancelled').length,
    refunded: bills.filter((b) => b.status === 'refunded').length,
    foodSales: sumOf('foodSubtotal'),
    foodTax: sumOf('foodTax'),
    liquorSales: sumOf('liquorSubtotal'),
    liquorTax: sumOf('liquorTax'),
    discounts: sumOf('manualDiscount'),
    roundOff: sumOf('roundOff'),
    total: sumOf('total'),
    byMode,
    collected: rupees(payments.reduce((a, p) => a.plus(p.amount), dec(0))),
  };
}

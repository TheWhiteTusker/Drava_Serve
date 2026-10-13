import './approvals.js'; // registers the bill approval handlers
import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { businessDate, dec, rupees, zMoney, zPct, PAYMENT_MODES } from '@fnb/shared';
import { z } from 'zod';
import { getSettings } from '../access/settings.js';
import { proposeOrApply } from '../approvals.js';
import { C, Ctx, findOr404, parse } from '../common.js';
import { tenantSchema as t } from '../db/index.js';
import { menuForSale } from '../pricing/menu.js';
import { rollupBill } from '../reports/rollup.js';
import { stockTx, type Post as PostStock } from '../stock/ledger.js';
import { billView, publishBill, saleMoves, zOrder, zPay } from './bills.js';
import { placeOrder } from './orders.js';

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
    return billView(ctx.db, await placeOrder(ctx, o));
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
}

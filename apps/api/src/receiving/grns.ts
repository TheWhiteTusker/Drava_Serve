import { Body, ConflictException, Controller, ForbiddenException, Get, Param, Post, Query, Res } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { dec, zMoney } from '@fnb/shared';
import { z } from 'zod';
import { getSettings } from '../access/settings.js';
import { proposeOrApply } from '../approvals.js';
import { C, Ctx, findOr404, parse } from '../common.js';
import { tenantSchema as t } from '../db/index.js';
import { stockTx } from '../stock/ledger.js';
import { logActivity, money } from '../activity.js';
import { listOf } from '../pricing/offers.js';
import { receiveGrn } from './shared.js';
import { toCsv } from '../csv.js';

// ---------- Goods received notes and accounts ----------

@Controller('grns')
export class GrnsController {
  @Get()
  async list(@C() ctx: Ctx, @Query('outletId') outletId: string, @Query('status') status?: string) {
    ctx.assert('rates.view', outletId);
    const rows = await ctx.db
      .select({ g: t.goodsReceivedNote, vendor: t.vendor.name, paid: sql<string>`coalesce((select sum(amount) from vendor_payment p where p.grn_id = ${t.goodsReceivedNote.id}), 0)` })
      .from(t.goodsReceivedNote)
      .innerJoin(t.vendor, eq(t.vendor.id, t.goodsReceivedNote.vendorId))
      .where(and(eq(t.goodsReceivedNote.outletId, outletId), status ? inArray(t.goodsReceivedNote.status, status.split(',') as any) : undefined))
      .orderBy(desc(t.goodsReceivedNote.createdAt))
      .limit(300);
    return rows.map((r) => ({ ...r.g, vendor: r.vendor, paid: String(r.paid) }));
  }

  @Get(':id')
  async get(@C() ctx: Ctx, @Param('id') id: string) {
    const g = await findOr404(ctx.db.select().from(t.goodsReceivedNote).where(eq(t.goodsReceivedNote.id, id)));
    const showRates = ctx.can('rates.view', g.outletId);
    if (!showRates && !ctx.can('receiving.gate', g.outletId) && !ctx.can('receiving.recheck', g.outletId)) ctx.assert('rates.view', g.outletId);
    const lines = await ctx.db
      .select({ l: t.grnLine, name: t.stockItem.name, unit: t.stockItemUnit.name, baseUnit: t.stockItem.baseUnit })
      .from(t.grnLine)
      .innerJoin(t.stockItem, eq(t.stockItem.id, t.grnLine.stockItemId))
      .leftJoin(t.stockItemUnit, eq(t.stockItemUnit.id, t.grnLine.unitId))
      .where(eq(t.grnLine.grnId, id))
      .orderBy(t.stockItem.name);
    const returns = await ctx.db
      .select({ r: t.returnNote, name: t.stockItem.name })
      .from(t.returnNote)
      .innerJoin(t.stockItem, eq(t.stockItem.id, t.returnNote.stockItemId))
      .where(eq(t.returnNote.grnId, id));
    const payments = showRates ? await ctx.db.select().from(t.vendorPayment).where(eq(t.vendorPayment.grnId, id)).orderBy(t.vendorPayment.paidOn) : [];
    const vendor = await findOr404(ctx.db.select({ name: t.vendor.name }).from(t.vendor).where(eq(t.vendor.id, g.vendorId)));
    const check = await findOr404(ctx.db.select().from(t.receiptCheck).where(eq(t.receiptCheck.id, g.receiptCheckId)));
    const strip = <T extends Record<string, any>>(o: T, keys: string[]) => (showRates ? o : Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))));
    return {
      ...strip(g, ['amountGross', 'returnDeduction', 'amountPayable']),
      vendor: vendor.name,
      vendorBillNo: check.vendorBillNo,
      lines: lines.map((x) => strip({ ...x.l, name: x.name, unit: x.unit ?? x.baseUnit }, ['billedRate', 'ratePerBase', 'lastRatePerBase', 'amount'])),
      returns: returns.map((x) => strip({ ...x.r, name: x.name }, ['amount'])),
      payments,
    };
  }

  // Both the watchman and the staff member sign; then the note goes into stock, unless a billed
  // rate is above the last rate paid by more than the tolerance, which holds it for a manager.
  @Post(':id/confirm')
  async confirm(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { as } = parse(z.object({ as: z.enum(['watchman', 'staff']) }), body);
    const g = await findOr404(ctx.db.select().from(t.goodsReceivedNote).where(eq(t.goodsReceivedNote.id, id)));
    ctx.assert(as === 'watchman' ? 'receiving.gate' : 'receiving.recheck', g.outletId);
    const tolerance = Number((await getSettings(ctx.db, g.outletId)).effective['receiving.rateTolerancePct']);
    return stockTx(ctx, async (tx, post) => {
      const [locked] = await tx.select().from(t.goodsReceivedNote).where(eq(t.goodsReceivedNote.id, id)).for('update');
      if (locked.status !== 'awaiting_signoff') throw new ConflictException(`This note is already ${locked.status.replace('_', ' ')}`);
      const other = as === 'watchman' ? locked.staffConfirmedBy : locked.watchmanConfirmedBy;
      if (other === ctx.userId) throw new ForbiddenException('The watchman and the staff member must be two different people');
      const patch = as === 'watchman' ? { watchmanConfirmedBy: ctx.userId, watchmanConfirmedAt: new Date() } : { staffConfirmedBy: ctx.userId, staffConfirmedAt: new Date() };
      const [now] = await tx.update(t.goodsReceivedNote).set({ ...patch, updatedAt: new Date() }).where(eq(t.goodsReceivedNote.id, id)).returning();
      if (!now.watchmanConfirmedBy || !now.staffConfirmedBy) return { status: 'awaiting_signoff' };

      const lines = await tx.select({ l: t.grnLine, name: t.stockItem.name }).from(t.grnLine).innerJoin(t.stockItem, eq(t.stockItem.id, t.grnLine.stockItemId)).where(eq(t.grnLine.grnId, id));
      const risen = lines.filter((x) => x.l.lastRatePerBase && dec(x.l.ratePerBase).gt(dec(x.l.lastRatePerBase).times(1 + tolerance / 100)));
      if (risen.length) {
        await tx.update(t.goodsReceivedNote).set({ status: 'held_rate' }).where(eq(t.goodsReceivedNote.id, id));
        await logActivity(ctx, tx, {
          outletId: g.outletId, kind: 'delivery_held', title: 'Delivery held',
          message: `${g.number} is held for a manager: ${listOf(risen.map((x) => `${x.name} was billed ${money(x.l.billedRate)}, against ${money(dec(x.l.lastRatePerBase!).times(dec(x.l.billedRate).div(x.l.ratePerBase)).toString())} last time`))}, more than ${tolerance}% higher.`,
          data: { grnId: id },
        });
        await proposeOrApply(
          ctx, tx, post,
          {
            outletId: g.outletId, type: 'grn_rate_hold', entity: 'goods_received_note', entityId: id,
            proposed: { summary: risen.map((x) => `${x.name}: ₹${dec(x.l.ratePerBase).toFixed(4)} per unit vs last ₹${dec(x.l.lastRatePerBase!).toFixed(4)}`).join('; ') },
            reason: `Billed rate above the last rate by more than ${tolerance}%`,
          },
          { forceQueue: true },
        );
        return { status: 'held_rate' };
      }
      await receiveGrn(ctx, tx, post, id);
      return { status: 'approved' };
    });
  }

  @Post(':id/payments')
  async pay(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const p = parse(z.object({ paidOn: z.iso.date(), mode: z.enum(['bank_transfer', 'cheque', 'upi', 'cash']), reference: z.string().trim().max(100).nullish(), amount: zMoney }), body);
    const g = await findOr404(ctx.db.select().from(t.goodsReceivedNote).where(eq(t.goodsReceivedNote.id, id)));
    ctx.assert('accounts.pay', g.outletId);
    if (g.status !== 'approved') throw new ConflictException(g.status === 'held_rate' ? 'This note is held for a rate difference until a manager releases it' : `This note is ${g.status.replace('_', ' ')}`);
    await ctx.tx(async (tx) => {
      await tx.insert(t.vendorPayment).values({ grnId: id, ...p, recordedBy: ctx.userId! });
      const [{ paid }] = (await tx.execute(sql`select coalesce(sum(amount), 0) as paid from vendor_payment where grn_id = ${id}`)).rows as any[];
      if (dec(paid).gte(g.amountPayable)) await tx.update(t.goodsReceivedNote).set({ status: 'paid', updatedAt: new Date() }).where(eq(t.goodsReceivedNote.id, id));
    });
    return this.get(ctx, id);
  }

  // CSV for the accounts team.
  @Get('export/csv')
  async export(@C() ctx: Ctx, @Query('outletId') outletId: string, @Query('from') from: string, @Query('to') to: string, @Res() res: any) {
    if (!ctx.can('accounts.pay', outletId)) ctx.assert('reports.export', outletId);
    const r = await ctx.db.execute(sql`
      select g.number, g.created_at::date as received_on, v.name as vendor, c.vendor_bill_no, g.status,
        g.amount_gross, g.return_deduction, g.amount_payable,
        coalesce((select sum(p.amount) from vendor_payment p where p.grn_id = g.id), 0) as paid,
        (select string_agg(p.paid_on || ' ' || p.mode || coalesce(' ' || p.reference, ''), '; ') from vendor_payment p where p.grn_id = g.id) as payments
      from goods_received_note g join vendor v on v.id = g.vendor_id join receipt_check c on c.id = g.receipt_check_id
      where g.outlet_id = ${outletId} and g.created_at::date between ${from}::date and ${to}::date
      order by g.created_at`);
    res.set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="goods-received-${from}-to-${to}.csv"` }).send(toCsv(r.rows as any[]));
  }
}

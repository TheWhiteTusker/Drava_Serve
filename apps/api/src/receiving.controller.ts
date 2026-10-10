import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Param, Post, Put, Query, Res,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { dec, istDate, rupees, zMoney, zQty } from '@fnb/shared';
import { z } from 'zod';
import { getSettings } from './access.controller.js';
import { proposeOrApply, registerApproval } from './approvals.js';
import { C, Ctx, findOr404, parse } from './common.js';
import { controlDb, controlSchema, tenantSchema as t, type Q, type Tx } from './db/index.js';
import { lastRates } from './purchasing.controller.js';
import { issuingStores, stockTx, type Post as PostStock } from './stock.js';
import { getObject, putObject } from './storage.js';
import { recostAfterReceipt } from './pricing.js';

// Two-stage receiving (handoff 6.8): the watchman's gate check at 5:00 am, then the staff
// re-check with weights, photos and the billed rate. Only what both accepted enters stock.

const GATE_REASONS = ['not_fresh', 'spoiled', 'wrong_item', 'damaged', 'short_weight', 'other'] as const;
const RECHECK_REASONS = ['spoiled', 'expired', 'unusable'] as const;

async function check(q: Q, id: string) {
  return findOr404(q.select().from(t.receiptCheck).where(eq(t.receiptCheck.id, id)));
}

// Rates and amounts are removed for anyone without rates.view (the watchman).
async function deliveryView(ctx: Ctx, id: string) {
  const c = await check(ctx.db, id);
  if (!['receiving.gate', 'receiving.recheck', 'indent.manage', 'rates.view'].some((p) => ctx.can(p as any, c.outletId))) {
    throw new ForbiddenException('You do not have permission: receiving');
  }
  const vendor = await findOr404(ctx.db.select({ name: t.vendor.name, phone: t.vendor.phone }).from(t.vendor).where(eq(t.vendor.id, c.vendorId)));
  const lines = await ctx.db
    .select({ l: t.receiptCheckLine, name: t.stockItem.name, baseUnit: t.stockItem.baseUnit, perishable: t.stockItem.perishable, unit: t.stockItemUnit.name, factor: t.stockItemUnit.factor })
    .from(t.receiptCheckLine)
    .innerJoin(t.stockItem, eq(t.stockItem.id, t.receiptCheckLine.stockItemId))
    .leftJoin(t.stockItemUnit, eq(t.stockItemUnit.id, t.receiptCheckLine.unitId))
    .where(eq(t.receiptCheckLine.receiptCheckId, id))
    .orderBy(t.stockItem.name);
  const [grn] = await ctx.db.select().from(t.goodsReceivedNote).where(eq(t.goodsReceivedNote.receiptCheckId, id));
  const showRates = ctx.can('rates.view', c.outletId);
  const photos = await ctx.db.select().from(t.attachment).where(and(eq(t.attachment.entity, 'receipt_check'), eq(t.attachment.entityId, id)));
  return {
    ...c,
    vendor,
    lines: lines.map((x) => ({
      ...x.l, billedRate: showRates ? x.l.billedRate : null, name: x.name, unit: x.unit ?? x.baseUnit, baseUnit: x.baseUnit, factor: x.factor ?? '1', perishable: x.perishable,
    })),
    photos: photos.filter((p) => showRates || p.purpose !== 'vendor_bill').map((p) => ({ id: p.id, purpose: p.purpose, lineId: p.objectKey.split('/')[2] ?? null })),
    grn: grn ? grnSummary(grn, showRates) : null,
  };
}

const grnSummary = (g: typeof t.goodsReceivedNote.$inferSelect, showRates: boolean) => ({
  id: g.id, number: g.number, status: g.status, watchmanConfirmedAt: g.watchmanConfirmedAt, staffConfirmedAt: g.staffConfirmedAt,
  ...(showRates ? { amountGross: g.amountGross, returnDeduction: g.returnDeduction, amountPayable: g.amountPayable } : {}),
});

// ---------- Posting a goods received note into stock ----------

// Accepted quantities enter the item's issuing store at the billed rate; the rate joins the
// vendor's price history; ingredient cost becomes the latest billed rate and recipes are re-costed.
export async function receiveGrn(ctx: Ctx, tx: Tx, post: PostStock, grnId: string) {
  const grn = (await tx.select().from(t.goodsReceivedNote).where(eq(t.goodsReceivedNote.id, grnId)).for('update'))[0];
  const lines = await tx.select().from(t.grnLine).where(eq(t.grnLine.grnId, grnId));
  const today = istDate(new Date());
  await post(
    lines
      .filter((l) => dec(l.acceptedBaseQty).gt(0))
      .map((l) => ({ storeId: l.storeId, stockItemId: l.stockItemId, qty: l.acceptedBaseQty, unitCost: l.ratePerBase, movement: 'goods_receipt' as const, expiresOn: l.expiresOn, refType: 'grn', refId: grnId })),
  );
  for (const l of lines) {
    await tx.insert(t.vendorRate).values({ vendorId: grn.vendorId, stockItemId: l.stockItemId, unitId: l.unitId, rate: l.billedRate, ratePerBase: l.ratePerBase, billedOn: today, grnId });
    await tx.update(t.stockItem).set({ currentCost: l.ratePerBase, updatedAt: new Date() }).where(eq(t.stockItem.id, l.stockItemId));
  }
  await tx.update(t.goodsReceivedNote).set({ status: 'approved', approvedAt: new Date(), updatedAt: new Date() }).where(eq(t.goodsReceivedNote.id, grnId));
  await tx.update(t.receiptCheck).set({ status: 'closed', updatedAt: new Date() }).where(eq(t.receiptCheck.id, grn.receiptCheckId));
  await recostAfterReceipt(ctx, tx, lines.map((l) => l.stockItemId));
}

registerApproval('grn_rate_hold', 'Release a goods received note held for a rate rise', async (ctx, tx, req, post) => {
  await tx.update(t.goodsReceivedNote).set({ releasedBy: ctx.userId, releasedAt: new Date() }).where(eq(t.goodsReceivedNote.id, req.entityId!));
  await receiveGrn(ctx, tx, post, req.entityId!);
});

// ---------- Deliveries (receiving app) ----------

@Controller('deliveries')
export class DeliveriesController {
  // Today's expected deliveries for the receiving app (ready from the nightly indent, before 5:00 am).
  @Get()
  async list(@C() ctx: Ctx, @Query('outletId') outletId: string, @Query('date') date?: string, @Query('open') open?: string) {
    if (!['receiving.gate', 'receiving.recheck', 'indent.manage', 'rates.view'].some((p) => ctx.can(p as any, outletId))) ctx.assert('receiving.gate', outletId);
    const rows = await ctx.db
      .select({ c: t.receiptCheck, vendor: t.vendor.name, lines: sql<number>`(select count(*)::int from receipt_check_line l where l.receipt_check_id = ${t.receiptCheck.id})` })
      .from(t.receiptCheck)
      .innerJoin(t.vendor, eq(t.vendor.id, t.receiptCheck.vendorId))
      .where(
        and(
          eq(t.receiptCheck.outletId, outletId),
          date ? eq(t.receiptCheck.expectedOn, date) : undefined,
          open ? sql`${t.receiptCheck.status} <> 'closed'` : undefined,
        ),
      )
      .orderBy(desc(t.receiptCheck.expectedOn), t.vendor.name)
      .limit(100);
    const grns = rows.length ? await ctx.db.select().from(t.goodsReceivedNote).where(inArray(t.goodsReceivedNote.receiptCheckId, rows.map((r) => r.c.id))) : [];
    const showRates = ctx.can('rates.view', outletId);
    return rows.map((r) => {
      const g = grns.find((x) => x.receiptCheckId === r.c.id);
      return { ...r.c, vendor: r.vendor, lineCount: r.lines, grn: g ? grnSummary(g, showRates) : null };
    });
  }

  @Get(':id')
  get(@C() ctx: Ctx, @Param('id') id: string) {
    return deliveryView(ctx, id);
  }

  // Watchman, one line at a time: accept, short (with the quantity that came) or reject (with a reason).
  @Put(':id/gate/:lineId')
  async gateLine(@C() ctx: Ctx, @Param('id') id: string, @Param('lineId') lineId: string, @Body() body: unknown) {
    const b = parse(
      z.object({ status: z.enum(['accepted', 'short', 'rejected']), qty: zQty.nullish(), reason: z.enum(GATE_REASONS).nullish(), note: z.string().max(300).nullish() }),
      body,
    );
    const c = await check(ctx.db, id);
    ctx.assert('receiving.gate', c.outletId);
    if (c.status !== 'expected') throw new ConflictException('The gate check for this delivery is finished');
    const line = await findOr404(ctx.db.select().from(t.receiptCheckLine).where(and(eq(t.receiptCheckLine.id, lineId), eq(t.receiptCheckLine.receiptCheckId, id))));
    if (b.status === 'short' && (!b.qty || dec(b.qty).gte(line.orderedQty))) throw new BadRequestException('Enter the quantity that came, less than ordered');
    if (b.status === 'rejected' && !b.reason) throw new BadRequestException('Choose why it was rejected');
    const gateQty = b.status === 'accepted' ? line.orderedQty : b.status === 'short' ? b.qty! : '0';
    await ctx.tx((tx) =>
      tx
        .update(t.receiptCheckLine)
        .set({ gateStatus: b.status, gateQty, gateReason: b.status === 'accepted' ? null : [b.reason, b.note].filter(Boolean).join(': ') || null })
        .where(eq(t.receiptCheckLine.id, lineId)),
    );
    return deliveryView(ctx, id);
  }

  @Post(':id/gate/complete')
  async gateDone(@C() ctx: Ctx, @Param('id') id: string) {
    const c = await check(ctx.db, id);
    ctx.assert('receiving.gate', c.outletId);
    if (c.status !== 'expected') throw new ConflictException('Already done');
    const pending = await ctx.db.select().from(t.receiptCheckLine).where(and(eq(t.receiptCheckLine.receiptCheckId, id), eq(t.receiptCheckLine.gateStatus, 'pending')));
    if (pending.length) throw new BadRequestException(`${pending.length} line(s) still to check`);
    await ctx.tx((tx) => tx.update(t.receiptCheck).set({ status: 'gate_checked', gateBy: ctx.userId, gateAt: new Date(), updatedAt: new Date() }).where(eq(t.receiptCheck.id, id)));
    return deliveryView(ctx, id);
  }

  // Staff re-check of a line: what is usable, what is not (and why), the measured weight or
  // count, the expiry date and the rate on the vendor's bill.
  @Put(':id/recheck/:lineId')
  async recheckLine(@C() ctx: Ctx, @Param('id') id: string, @Param('lineId') lineId: string, @Body() body: unknown) {
    const b = parse(
      z.object({
        acceptedQty: zQty,
        rejectedQty: zQty.default('0'),
        reason: z.enum(RECHECK_REASONS).nullish(),
        measuredQty: zQty.nullish(),
        billedRate: zMoney.nullish(),
        expiresOn: z.iso.date().nullish(),
      }),
      body,
    );
    const c = await check(ctx.db, id);
    ctx.assert('receiving.recheck', c.outletId);
    if (c.status !== 'gate_checked') throw new ConflictException(c.status === 'expected' ? 'The gate check is not finished yet' : 'The re-check is finished');
    const line = await findOr404(ctx.db.select().from(t.receiptCheckLine).where(and(eq(t.receiptCheckLine.id, lineId), eq(t.receiptCheckLine.receiptCheckId, id))));
    if (dec(b.acceptedQty).plus(b.rejectedQty).gt(line.gateQty ?? 0)) throw new BadRequestException(`Only ${dec(line.gateQty ?? 0).toString()} came through the gate`);
    if (dec(b.rejectedQty).gt(0) && !b.reason) throw new BadRequestException('Say why the rejected quantity is unusable');
    await ctx.tx((tx) =>
      tx
        .update(t.receiptCheckLine)
        .set({ recheckAcceptedQty: b.acceptedQty, recheckRejectedQty: b.rejectedQty, recheckReason: b.reason ?? null, measuredQty: b.measuredQty ?? null, billedRate: b.billedRate ?? null, expiresOn: b.expiresOn ?? null })
        .where(eq(t.receiptCheckLine.id, lineId)),
    );
    return deliveryView(ctx, id);
  }

  // Finishing the re-check raises return notes for what staff rejected and the goods received
  // note for what both accepted, waiting for both signatures.
  @Post(':id/recheck/complete')
  async recheckDone(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { vendorBillNo } = parse(z.object({ vendorBillNo: z.string().trim().max(60).nullish() }), body ?? {});
    const c = await check(ctx.db, id);
    ctx.assert('receiving.recheck', c.outletId);
    if (c.status !== 'gate_checked') throw new ConflictException('This delivery is not waiting for a re-check');
    return ctx.tx(async (tx) => {
      const lines = await tx
        .select({ l: t.receiptCheckLine, item: t.stockItem, factor: t.stockItemUnit.factor })
        .from(t.receiptCheckLine)
        .innerJoin(t.stockItem, eq(t.stockItem.id, t.receiptCheckLine.stockItemId))
        .leftJoin(t.stockItemUnit, eq(t.stockItemUnit.id, t.receiptCheckLine.unitId))
        .where(eq(t.receiptCheckLine.receiptCheckId, id));
      const through = lines.filter((x) => dec(x.l.gateQty ?? 0).gt(0));
      const missing = through.filter((x) => x.l.recheckAcceptedQty == null || x.l.billedRate == null);
      if (missing.length) throw new BadRequestException(`Re-check and enter the billed rate for: ${missing.map((x) => x.item.name).join(', ')}`);
      const stores = await issuingStores(tx, c.outletId);
      const last = await lastRates(tx, through.map((x) => x.l.stockItemId));
      const outlet = await findOr404(tx.select().from(t.outlet).where(eq(t.outlet.id, c.outletId)));
      const [{ n }] = (await tx.execute(sql`select count(*)::int + 1 as n from goods_received_note where outlet_id = ${c.outletId}`)).rows as any[];
      let gross = dec(0);
      let deduction = dec(0);
      const grnLines: (typeof t.grnLine.$inferInsert)[] = [];
      for (const { l, item, factor } of through) {
        const f = factor ?? '1';
        const accepted = dec(l.recheckAcceptedQty!);
        const rejected = dec(l.recheckRejectedQty ?? 0);
        gross = gross.plus(accepted.plus(rejected).times(l.billedRate!));
        deduction = deduction.plus(rejected.times(l.billedRate!));
        if (rejected.gt(0)) {
          await tx.insert(t.returnNote).values({
            outletId: c.outletId, receiptCheckId: id, vendorId: c.vendorId, stockItemId: item.id, qty: rejected.toString(),
            reason: l.recheckReason ?? 'unusable', amount: rupees(rejected.times(l.billedRate!)), createdBy: ctx.userId!,
          });
        }
        grnLines.push({
          grnId: '', stockItemId: item.id, storeId: (item.department === 'food' ? stores.food : stores.beverage)!.id, unitId: l.unitId,
          acceptedQty: accepted.toString(), acceptedBaseQty: accepted.times(f).toString(), billedRate: l.billedRate!,
          ratePerBase: dec(l.billedRate!).div(f).toFixed(6), lastRatePerBase: last.get(item.id)?.ratePerBase ?? null,
          amount: rupees(accepted.times(l.billedRate!)), expiresOn: l.expiresOn,
        });
      }
      const [grn] = await tx
        .insert(t.goodsReceivedNote)
        .values({
          outletId: c.outletId, receiptCheckId: id, vendorId: c.vendorId, number: `GRN-${outlet.code}-${String(n).padStart(5, '0')}`, status: 'awaiting_signoff',
          amountGross: rupees(gross), returnDeduction: rupees(deduction), amountPayable: rupees(gross.minus(deduction)),
        })
        .returning();
      if (grnLines.length) await tx.insert(t.grnLine).values(grnLines.map((g) => ({ ...g, grnId: grn.id })));
      await tx.update(t.returnNote).set({ grnId: grn.id }).where(eq(t.returnNote.receiptCheckId, id));
      await tx
        .update(t.receiptCheck)
        .set({ status: 'rechecked', recheckBy: ctx.userId, recheckAt: new Date(), vendorBillNo: vendorBillNo ?? null, updatedAt: new Date() })
        .where(eq(t.receiptCheck.id, id));
      return { grnId: grn.id, number: grn.number };
    });
  }
}

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

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

// ---------- Photos and documents ----------

@Controller('attachments')
export class AttachmentsController {
  // Photo from the gate check or re-check, or the vendor's bill. Stored privately per customer.
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(@C() ctx: Ctx, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown) {
    const b = parse(
      z.object({ entity: z.enum(['receipt_check', 'menu_item']), entityId: z.uuid(), lineId: z.uuid().nullish(), purpose: z.enum(['gate_photo', 'recheck_photo', 'vendor_bill', 'menu_photo']) }),
      body,
    );
    if (!file) throw new BadRequestException('Attach a photo or PDF');
    if (!/^image\/|^application\/pdf$/.test(file.mimetype)) throw new BadRequestException('Only photos or PDFs');
    const outletId = await outletOf(ctx.db, b.entity, b.entityId);
    if (b.entity === 'menu_item') ctx.assert('catalog.manage', outletId);
    else ctx.assert(b.purpose === 'gate_photo' ? 'receiving.gate' : 'receiving.recheck', outletId);
    const [cust] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.id, ctx.customerId));
    const ext = file.mimetype === 'application/pdf' ? 'pdf' : (file.mimetype.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
    const key = `${b.entity}/${b.entityId}/${b.lineId ?? 'all'}/${randomUUID()}.${ext}`;
    await putObject(cust.code, key, file.buffer, file.mimetype);
    const [a] = await ctx.tx((tx) =>
      tx.insert(t.attachment).values({ entity: b.entity, entityId: b.entityId, purpose: b.purpose, objectKey: key, contentType: file.mimetype, takenBy: ctx.userId }).returning(),
    );
    if (b.entity === 'menu_item') await ctx.tx((tx) => tx.update(t.menuItem).set({ photoKey: a.id }).where(eq(t.menuItem.id, b.entityId)));
    return { id: a.id };
  }

  @Get(':id')
  async file(@C() ctx: Ctx, @Param('id') id: string, @Res() res: any) {
    const a = await findOr404(ctx.db.select().from(t.attachment).where(eq(t.attachment.id, id)));
    const outletId = await outletOf(ctx.db, a.entity, a.entityId);
    if (a.purpose === 'vendor_bill') ctx.assert('rates.view', outletId);
    else if (!['receiving.gate', 'receiving.recheck', 'rates.view', 'catalog.view', 'approvals.decide'].some((p) => ctx.can(p as any, outletId))) ctx.assert('rates.view', outletId);
    const [cust] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.id, ctx.customerId));
    res.set({ 'content-type': a.contentType, 'cache-control': 'private, max-age=3600' }).send(await getObject(cust.code, a.objectKey));
  }
}

async function outletOf(q: Q, entity: string, entityId: string) {
  const table = entity === 'menu_item' ? t.menuItem : t.receiptCheck;
  const row = await findOr404(q.select({ outletId: table.outletId }).from(table).where(eq(table.id, entityId)));
  return row.outletId;
}

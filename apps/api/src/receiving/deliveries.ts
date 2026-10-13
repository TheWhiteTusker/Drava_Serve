import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { dec, rupees, zMoney, zQty } from '@fnb/shared';
import { z } from 'zod';
import { C, Ctx, findOr404, parse } from '../common.js';
import { tenantSchema as t } from '../db/index.js';
import { lastRates } from '../purchasing/vendors.js';
import { issuingStores } from '../stock/availability.js';
import { GATE_REASONS, RECHECK_REASONS, check, deliveryView, grnSummary } from './shared.js';

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

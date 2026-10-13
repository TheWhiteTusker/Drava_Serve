import { ForbiddenException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { dec, istDate } from '@fnb/shared';
import { registerApproval } from '../approvals.js';
import { Ctx, findOr404 } from '../common.js';
import { tenantSchema as t, type Q, type Tx } from '../db/index.js';
import type { Post as PostStock } from '../stock/ledger.js';
import { logActivity, money } from '../activity.js';
import { listOf } from '../pricing/offers.js';
import { recostAfterReceipt } from '../pricing/costing.js';

// Two-stage receiving (handoff 6.8): the watchman's gate check at 5:00 am, then the staff
// re-check with weights, photos and the billed rate. Only what both accepted enters stock.

export const GATE_REASONS = ['not_fresh', 'spoiled', 'wrong_item', 'damaged', 'short_weight', 'other'] as const;
export const RECHECK_REASONS = ['spoiled', 'expired', 'unusable'] as const;

export async function check(q: Q, id: string) {
  return findOr404(q.select().from(t.receiptCheck).where(eq(t.receiptCheck.id, id)));
}

// Rates and amounts are removed for anyone without rates.view (the watchman).
export async function deliveryView(ctx: Ctx, id: string) {
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

export const grnSummary = (g: typeof t.goodsReceivedNote.$inferSelect, showRates: boolean) => ({
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
  const [vendor] = await tx.select({ name: t.vendor.name }).from(t.vendor).where(eq(t.vendor.id, grn.vendorId));
  const names = await tx.select({ id: t.stockItem.id, name: t.stockItem.name }).from(t.stockItem).where(inArray(t.stockItem.id, lines.map((l) => l.stockItemId)));
  await logActivity(ctx, tx, {
    outletId: grn.outletId, kind: 'delivery', title: 'Delivery in stock',
    message: `The delivery from ${vendor?.name} went into stock (${grn.number}: ${listOf(names.map((n) => n.name))}). ${money(grn.amountPayable)} is now due to the vendor, and dishes using these items were re-costed.`,
    data: { grnId, vendorId: grn.vendorId },
  });
}

registerApproval('grn_rate_hold', 'Release a goods received note held for a rate rise', async (ctx, tx, req, post) => {
  await tx.update(t.goodsReceivedNote).set({ releasedBy: ctx.userId, releasedAt: new Date() }).where(eq(t.goodsReceivedNote.id, req.entityId!));
  await receiveGrn(ctx, tx, post, req.entityId!);
});

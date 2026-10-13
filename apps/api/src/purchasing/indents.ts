import { ConflictException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { dec, indentQuantity, istDate, istTime } from '@fnb/shared';
import { getSettings } from '../access/settings.js';
import { Ctx } from '../common.js';
import { controlDb, controlSchema, tenantSchema as t, type Q, type Tx } from '../db/index.js';
import { lastRates } from './vendors.js';
import { indentPdf } from './pdf.js';

// ---------- Nightly indent ----------

// The delivery date an indent built now is for: the next 5:00 am.
export const deliveryDateFor = (now: Date) => (istTime(now) >= '05:00' ? istDate(new Date(now.getTime() + 86_400_000)) : istDate(now));

// Suggested quantity = par − on hand − on order, rounded up to the vendor's pack size, one
// indent per vendor. Rebuilding replaces a vendor's indent while it is still awaiting approval.
export async function buildIndents(ctx: Ctx, outletId: string, forDate: string) {
  const settings = (await getSettings(ctx.db, outletId)).effective;
  return ctx.tx(async (tx) => {
    const levels = await tx
      .select({ l: t.stockLevel, item: t.stockItem })
      .from(t.stockLevel)
      .innerJoin(t.stockItem, eq(t.stockItem.id, t.stockLevel.stockItemId))
      .where(and(eq(t.stockLevel.outletId, outletId), eq(t.stockItem.active, true), sql`${t.stockLevel.parLevel} > 0`));
    const ids = levels.map((x) => x.item.id);
    if (!ids.length) return { indents: [], unassigned: [] };
    const onHand = await sumBy(tx, sql`
      select b.stock_item_id as id, sum(b.qty) as qty from stock_balance b join store s on s.id = b.store_id
      where s.outlet_id = ${outletId} group by b.stock_item_id`);
    // On order: approved deliveries not yet gate checked, plus other days' indents awaiting approval.
    const onOrder = await sumBy(tx, sql`
      select id, sum(qty) as qty from (
        select l.stock_item_id as id, l.ordered_qty * coalesce(u.factor, 1) as qty
        from receipt_check_line l join receipt_check c on c.id = l.receipt_check_id
        left join stock_item_unit u on u.id = l.unit_id
        where c.outlet_id = ${outletId} and c.status = 'expected'
        union all
        select l.stock_item_id, l.suggested_qty * coalesce(u.factor, 1)
        from indent_line l join indent i on i.id = l.indent_id
        left join stock_item_unit u on u.id = l.unit_id
        where i.outlet_id = ${outletId} and i.status = 'pending_approval' and i.for_date <> ${forDate}
      ) x group by id`);
    const vendorItems = await tx
      .select({ vi: t.vendorItem, factor: t.stockItemUnit.factor, vendorActive: t.vendor.active })
      .from(t.vendorItem)
      .innerJoin(t.vendor, eq(t.vendor.id, t.vendorItem.vendorId))
      .leftJoin(t.stockItemUnit, eq(t.stockItemUnit.id, t.vendorItem.unitId))
      .where(and(inArray(t.vendorItem.stockItemId, ids), eq(t.vendor.active, true)))
      .orderBy(desc(t.vendorItem.preferred));

    const byVendor = new Map<string, (typeof t.indentLine.$inferInsert & { vendorId: string })[]>();
    const unassigned: string[] = [];
    for (const { l, item } of levels) {
      const vi = vendorItems.find((v) => v.vi.stockItemId === item.id);
      const qty = indentQuantity({
        par: l.parLevel,
        onHand: onHand.get(item.id) ?? 0,
        onOrder: onOrder.get(item.id) ?? 0,
        unitFactor: vi?.factor ?? 1,
        packSize: vi?.vi.packSize ?? 1,
      });
      if (dec(qty).lte(0)) continue;
      if (!vi) {
        unassigned.push(item.name);
        continue;
      }
      const lines = byVendor.get(vi.vi.vendorId) ?? [];
      lines.push({
        vendorId: vi.vi.vendorId, indentId: '', stockItemId: item.id, unitId: vi.vi.unitId, parQty: l.parLevel,
        onHandQty: String(onHand.get(item.id) ?? 0), onOrderQty: String(onOrder.get(item.id) ?? 0), suggestedQty: qty,
      });
      byVendor.set(vi.vi.vendorId, lines);
    }

    const out: string[] = [];
    for (const [vendorId, lines] of byVendor) {
      const rates = await lastRates(tx, lines.map((l) => l.stockItemId), vendorId);
      const [existing] = await tx.select().from(t.indent).where(and(eq(t.indent.outletId, outletId), eq(t.indent.vendorId, vendorId), eq(t.indent.forDate, forDate)));
      if (existing && existing.status !== 'pending_approval') continue;
      let indentId = existing?.id;
      if (existing) await tx.delete(t.indentLine).where(eq(t.indentLine.indentId, existing.id));
      else indentId = (await tx.insert(t.indent).values({ outletId, vendorId, forDate, status: 'pending_approval' }).returning())[0].id;
      await tx.insert(t.indentLine).values(lines.map(({ vendorId: _v, ...l }) => ({ ...l, indentId: indentId!, lastRate: rates.get(l.stockItemId)?.rate ?? null })));
      out.push(indentId!);
      if (settings['indent.mode'] === 'auto') await approveIndent(ctx, tx, indentId!);
    }
    return { indents: out, unassigned };
  });
}

async function sumBy(q: Q, query: ReturnType<typeof sql>) {
  const r = await q.execute(query);
  return new Map(r.rows.map((x: any) => [x.id as string, String(x.qty)]));
}

// Approval turns the indent into tomorrow's expected delivery for the receiving app.
export async function approveIndent(ctx: Ctx, tx: Tx, indentId: string) {
  const [ind] = await tx.select().from(t.indent).where(eq(t.indent.id, indentId)).for('update');
  if (ind.status !== 'pending_approval') throw new ConflictException(`This indent is already ${ind.status}`);
  const lines = await tx.select().from(t.indentLine).where(eq(t.indentLine.indentId, indentId));
  await tx.update(t.indent).set({ status: 'approved', approvedBy: ctx.userId, approvedAt: new Date(), updatedAt: new Date() }).where(eq(t.indent.id, indentId));
  await createDelivery(tx, ind, lines);
}

// The expected delivery the watchman checks at the gate.
export async function createDelivery(tx: Tx, ind: typeof t.indent.$inferSelect, lines?: (typeof t.indentLine.$inferSelect)[]) {
  lines ??= await tx.select().from(t.indentLine).where(eq(t.indentLine.indentId, ind.id));
  const ordered = lines.filter((l) => dec(l.approvedQty ?? l.suggestedQty).gt(0));
  if (!ordered.length) return;
  const [check] = await tx.insert(t.receiptCheck).values({ outletId: ind.outletId, indentId: ind.id, vendorId: ind.vendorId, expectedOn: ind.forDate }).returning();
  await tx.insert(t.receiptCheckLine).values(
    ordered.map((l) => ({ receiptCheckId: check.id, stockItemId: l.stockItemId, unitId: l.unitId, orderedQty: l.approvedQty ?? l.suggestedQty })),
  );
}

// ---------- Sending the order: delivery channels ----------

// A delivery channel gets a vendor order to the vendor. "Manual share" is the launch channel:
// the manager shares the PDF from their phone (WhatsApp via the share sheet), downloads or
// prints it, and the app records the attempt. An automatic channel (WhatsApp Business) is a
// second implementation with automatic = true; approval then sends without anyone tapping Share.
export interface DeliveryChannel {
  id: string;
  label: string;
  automatic: boolean;
  send(order: { customerCode: string; indentId: string; vendor: typeof t.vendor.$inferSelect; pdf: Buffer }): Promise<{ ok: boolean; detail?: string }>;
}

const manualShare: DeliveryChannel = {
  id: 'manual_share',
  label: 'Shared, downloaded or printed by a person',
  automatic: false,
  // The person does the sending; the API only records what they report.
  send: async () => ({ ok: true }),
};

export const deliveryChannels: DeliveryChannel[] = [manualShare];

export async function recordSend(tx: Tx, ctx: Ctx, indentId: string, channel: string, ok: boolean, detail?: string | null) {
  await tx.insert(t.deliverySend).values({ indentId, channel, userId: ctx.userId, result: ok ? 'ok' : 'failed', detail: detail ?? null });
  if (ok) await tx.update(t.indent).set({ status: 'sent', updatedAt: new Date() }).where(and(eq(t.indent.id, indentId), eq(t.indent.status, 'approved')));
}

// Sends through every automatic channel (none at launch). Called after approval.
export async function sendAutomatically(ctx: Ctx, indentId: string) {
  const auto = deliveryChannels.filter((c) => c.automatic);
  if (!auto.length) return;
  const { indent, vendor, pdf } = await indentPdf(ctx.db, indentId);
  const [cust] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.id, ctx.customerId));
  for (const ch of auto) {
    const r = await ch.send({ customerCode: cust.code, indentId: indent.id, vendor, pdf }).catch((e) => ({ ok: false, detail: String(e) }));
    await ctx.tx((tx) => recordSend(tx, ctx, indentId, ch.id, r.ok, r.detail));
  }
}

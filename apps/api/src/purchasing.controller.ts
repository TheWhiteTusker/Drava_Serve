import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { dec, indentQuantity, istDate, istTime } from '@fnb/shared';
import { z } from 'zod';
import { getSettings } from './access.controller.js';
import { C, Ctx, findOr404, parse, Permit } from './common.js';
import { controlDb, controlSchema, tenantSchema as t, type Q, type Tx } from './db/index.js';
import { crud } from './catalog.controller.js';
import { putObject } from './storage.js';

// ---------- Vendors ----------

const zVendor = z.object({
  name: z.string().trim().min(1),
  department: z.enum(['food', 'beverage', 'both']),
  contactName: z.string().trim().nullish(),
  phone: z.string().trim().nullish(),
  email: z.string().trim().nullish(),
  gstin: z.string().trim().nullish(),
  address: z.string().trim().nullish(),
  active: z.boolean().default(true),
});

export const VendorsController = crud({
  path: 'vendors',
  table: t.vendor,
  schema: zVendor,
  view: 'vendors.manage',
  manage: 'vendors.manage',
  orderBy: (v) => [asc(v.department), asc(v.name)],
});

@Controller('vendors')
export class VendorItemsController {
  // What a vendor supplies, in which purchase unit and pack size, with the last rate paid.
  @Get(':id/items')
  @Permit('vendors.manage')
  async items(@C() ctx: Ctx, @Param('id') id: string) {
    const rows = await ctx.db
      .select({ vi: t.vendorItem, name: t.stockItem.name, baseUnit: t.stockItem.baseUnit, unitName: t.stockItemUnit.name, factor: t.stockItemUnit.factor })
      .from(t.vendorItem)
      .innerJoin(t.stockItem, eq(t.stockItem.id, t.vendorItem.stockItemId))
      .leftJoin(t.stockItemUnit, eq(t.stockItemUnit.id, t.vendorItem.unitId))
      .where(eq(t.vendorItem.vendorId, id))
      .orderBy(t.stockItem.name);
    const showRates = ctx.can('rates.view');
    const last = showRates ? await lastRates(ctx.db, rows.map((r) => r.vi.stockItemId), id) : new Map();
    return rows.map((r) => ({ ...r.vi, name: r.name, baseUnit: r.baseUnit, unitName: r.unitName, factor: r.factor, lastRate: last.get(r.vi.stockItemId) ?? null }));
  }

  @Put(':id/items')
  @Permit('vendors.manage')
  async setItems(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const items = parse(
      z.array(z.object({ stockItemId: z.uuid(), unitId: z.uuid().nullish(), packSize: z.string().regex(/^\d+(\.\d{1,3})?$/).default('1'), preferred: z.boolean().default(true) })),
      body,
    );
    await ctx.tx(async (tx) => {
      await tx.delete(t.vendorItem).where(and(eq(t.vendorItem.vendorId, id), items.length ? notInArray(t.vendorItem.stockItemId, items.map((i) => i.stockItemId)) : undefined));
      for (const i of items) {
        await tx
          .insert(t.vendorItem)
          .values({ ...i, vendorId: id })
          .onConflictDoUpdate({ target: [t.vendorItem.vendorId, t.vendorItem.stockItemId], set: { unitId: i.unitId, packSize: i.packSize, preferred: i.preferred } });
      }
    });
    return this.items(ctx, id);
  }
}

// Latest billed rate per stock item (optionally from one vendor).
export async function lastRates(q: Q, stockItemIds: string[], vendorId?: string) {
  if (!stockItemIds.length) return new Map<string, { rate: string; ratePerBase: string; billedOn: string; vendorId: string }>();
  const rows = await q
    .selectDistinctOn([t.vendorRate.stockItemId])
    .from(t.vendorRate)
    .where(and(inArray(t.vendorRate.stockItemId, stockItemIds), vendorId ? eq(t.vendorRate.vendorId, vendorId) : undefined))
    .orderBy(t.vendorRate.stockItemId, desc(t.vendorRate.billedOn), desc(t.vendorRate.createdAt));
  return new Map(rows.map((r) => [r.stockItemId, { rate: r.rate, ratePerBase: r.ratePerBase, billedOn: r.billedOn, vendorId: r.vendorId }]));
}

@Controller('vendor-rates')
export class VendorRatesController {
  // Running price history, newest first: Food and Beverage parts by department.
  @Get()
  @Permit('rates.view')
  async list(@C() ctx: Ctx, @Query('stockItemId') stockItemId?: string, @Query('vendorId') vendorId?: string, @Query('department') department?: string) {
    return ctx.db
      .select({ r: t.vendorRate, item: t.stockItem.name, department: t.stockItem.department, vendor: t.vendor.name, unit: t.stockItemUnit.name })
      .from(t.vendorRate)
      .innerJoin(t.stockItem, eq(t.stockItem.id, t.vendorRate.stockItemId))
      .innerJoin(t.vendor, eq(t.vendor.id, t.vendorRate.vendorId))
      .leftJoin(t.stockItemUnit, eq(t.stockItemUnit.id, t.vendorRate.unitId))
      .where(
        and(
          stockItemId ? eq(t.vendorRate.stockItemId, stockItemId) : undefined,
          vendorId ? eq(t.vendorRate.vendorId, vendorId) : undefined,
          department ? eq(t.stockItem.department, department as any) : undefined,
        ),
      )
      .orderBy(desc(t.vendorRate.billedOn), desc(t.vendorRate.createdAt))
      .limit(300)
      .then((rows) => rows.map((x) => ({ ...x.r, item: x.item, department: x.department, vendor: x.vendor, unit: x.unit })));
  }
}

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

async function recordSend(tx: Tx, ctx: Ctx, indentId: string, channel: string, ok: boolean, detail?: string | null) {
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

// ---------- The vendor order PDF ----------

export async function indentPdf(q: Q, indentId: string) {
  const indent = await findOr404(q.select().from(t.indent).where(eq(t.indent.id, indentId)));
  const vendor = await findOr404(q.select().from(t.vendor).where(eq(t.vendor.id, indent.vendorId)));
  const outlet = await findOr404(q.select().from(t.outlet).where(eq(t.outlet.id, indent.outletId)));
  const lines = await q
    .select({ l: t.indentLine, name: t.stockItem.name, unit: t.stockItemUnit.name, baseUnit: t.stockItem.baseUnit })
    .from(t.indentLine)
    .innerJoin(t.stockItem, eq(t.stockItem.id, t.indentLine.stockItemId))
    .leftJoin(t.stockItemUnit, eq(t.stockItemUnit.id, t.indentLine.unitId))
    .where(eq(t.indentLine.indentId, indentId))
    .orderBy(t.stockItem.name);

  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const number = `PO-${outlet.code}-${indent.forDate.replaceAll('-', '')}-${indent.id.slice(0, 4).toUpperCase()}`;
  doc.fontSize(18).text('Purchase order', { continued: false });
  doc.moveDown(0.3).fontSize(10).fillColor('#444').text(number);
  doc.moveDown();
  doc.fillColor('#000').fontSize(11).text(`From: ${outlet.name}`);
  if (outlet.address) doc.text(outlet.address);
  if (outlet.gstin) doc.text(`GSTIN: ${outlet.gstin}`);
  doc.moveDown(0.5).text(`To: ${vendor.name}`);
  if (vendor.phone) doc.text(vendor.phone);
  doc.moveDown(0.5).text(`Deliver on: ${indent.forDate}, by 5:00 am`);
  doc.moveDown();
  const x = { item: 48, qty: 360, unit: 430 };
  const header = doc.y;
  doc.font('Helvetica-Bold').text('Item', x.item, header).text('Quantity', x.qty, header).text('Unit', x.unit, header);
  doc.font('Helvetica').moveTo(48, doc.y + 4).lineTo(547, doc.y + 4).stroke();
  doc.moveDown(0.6);
  for (const { l, name, unit, baseUnit } of lines) {
    const qty = l.approvedQty ?? l.suggestedQty;
    if (dec(qty).lte(0)) continue;
    const y = doc.y;
    doc.text(name, x.item, y, { width: 300 }).text(dec(qty).toString(), x.qty, y).text(unit ?? baseUnit, x.unit, y);
    doc.moveDown(0.4);
  }
  doc.moveDown(2).fontSize(9).fillColor('#666').text('Please send your bill with the delivery. Items not fresh or not as ordered will be returned at the gate.', 48);
  doc.end();
  return { indent, vendor, outlet, pdf: await done, number };
}

// ---------- Indent endpoints ----------

@Controller('indents')
export class IndentsController {
  @Get()
  async list(@C() ctx: Ctx, @Query('outletId') outletId: string, @Query('forDate') forDate?: string) {
    ctx.assert('indent.manage', outletId);
    const rows = await ctx.db
      .select({ i: t.indent, vendor: t.vendor.name, phone: t.vendor.phone, lines: sql<number>`(select count(*)::int from indent_line l where l.indent_id = ${t.indent.id})` })
      .from(t.indent)
      .innerJoin(t.vendor, eq(t.vendor.id, t.indent.vendorId))
      .where(and(eq(t.indent.outletId, outletId), forDate ? eq(t.indent.forDate, forDate) : undefined, ne(t.indent.status, 'cancelled')))
      .orderBy(desc(t.indent.forDate), t.vendor.name)
      .limit(200);
    return rows.map((r) => ({ ...r.i, vendor: r.vendor, vendorPhone: r.phone, lineCount: r.lines }));
  }

  @Get(':id')
  async get(@C() ctx: Ctx, @Param('id') id: string) {
    const ind = await findOr404(ctx.db.select().from(t.indent).where(eq(t.indent.id, id)));
    ctx.assert('indent.manage', ind.outletId);
    const vendor = await findOr404(ctx.db.select().from(t.vendor).where(eq(t.vendor.id, ind.vendorId)));
    const lines = await ctx.db
      .select({ l: t.indentLine, name: t.stockItem.name, baseUnit: t.stockItem.baseUnit, unit: t.stockItemUnit.name })
      .from(t.indentLine)
      .innerJoin(t.stockItem, eq(t.stockItem.id, t.indentLine.stockItemId))
      .leftJoin(t.stockItemUnit, eq(t.stockItemUnit.id, t.indentLine.unitId))
      .where(eq(t.indentLine.indentId, id))
      .orderBy(t.stockItem.name);
    const sends = await ctx.db
      .select({ s: t.deliverySend, user: t.appUser.name })
      .from(t.deliverySend)
      .leftJoin(t.appUser, eq(t.appUser.id, t.deliverySend.userId))
      .where(eq(t.deliverySend.indentId, id))
      .orderBy(desc(t.deliverySend.attemptedAt));
    const showRates = ctx.can('rates.view', ind.outletId);
    return {
      ...ind,
      vendor,
      lines: lines.map((x) => ({ ...x.l, lastRate: showRates ? x.l.lastRate : null, name: x.name, unit: x.unit ?? x.baseUnit, baseUnit: x.baseUnit })),
      sends: sends.map((x) => ({ ...x.s, user: x.user })),
    };
  }

  // Build now for an outlet (the nightly job does the same at the cut-off time).
  @Post('build')
  async build(@C() ctx: Ctx, @Body() body: unknown) {
    const { outletId, forDate } = parse(z.object({ outletId: z.uuid(), forDate: z.iso.date().optional() }), body);
    ctx.assert('indent.manage', outletId);
    return buildIndents(ctx, outletId, forDate ?? deliveryDateFor(new Date()));
  }

  @Put(':id/lines')
  async editLines(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const lines = parse(z.array(z.object({ id: z.uuid(), approvedQty: z.string().regex(/^\d+(\.\d{1,3})?$/) })), body);
    const ind = await findOr404(ctx.db.select().from(t.indent).where(eq(t.indent.id, id)));
    ctx.assert('indent.manage', ind.outletId);
    if (ind.status !== 'pending_approval') throw new ConflictException('Only an indent awaiting approval can be changed');
    await ctx.tx(async (tx) => {
      for (const l of lines) await tx.update(t.indentLine).set({ approvedQty: l.approvedQty }).where(and(eq(t.indentLine.id, l.id), eq(t.indentLine.indentId, id)));
    });
    return this.get(ctx, id);
  }

  @Post(':id/approve')
  async approve(@C() ctx: Ctx, @Param('id') id: string) {
    const ind = await findOr404(ctx.db.select().from(t.indent).where(eq(t.indent.id, id)));
    ctx.assert('indent.manage', ind.outletId);
    await ctx.tx((tx) => approveIndent(ctx, tx, id));
    await sendAutomatically(ctx, id);
    return this.get(ctx, id);
  }

  @Post(':id/cancel')
  async cancel(@C() ctx: Ctx, @Param('id') id: string) {
    const ind = await findOr404(ctx.db.select().from(t.indent).where(eq(t.indent.id, id)));
    ctx.assert('indent.manage', ind.outletId);
    if (ind.status !== 'pending_approval') throw new ConflictException('Only an indent awaiting approval can be cancelled');
    await ctx.tx((tx) => tx.update(t.indent).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(t.indent.id, id)));
    return { ok: true };
  }

  // The order PDF, for Share / Download / Print. A copy is kept in the customer's storage.
  @Get(':id/pdf')
  async pdf(@C() ctx: Ctx, @Param('id') id: string, @Res() res: any) {
    const ind = await findOr404(ctx.db.select().from(t.indent).where(eq(t.indent.id, id)));
    ctx.assert('indent.manage', ind.outletId);
    if (ind.status === 'pending_approval') throw new BadRequestException('Approve the indent before sending it to the vendor');
    const { pdf, number } = await indentPdf(ctx.db, id);
    const [cust] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.id, ctx.customerId));
    const key = `indents/${id}.pdf`;
    if (!ind.pdfKey) {
      await putObject(cust.code, key, pdf, 'application/pdf');
      await ctx.tx((tx) => tx.update(t.indent).set({ pdfKey: key }).where(eq(t.indent.id, id)));
    }
    res.set({ 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${number}.pdf"` }).send(pdf);
  }

  // Records a send attempt: which channel, who, when and whether it worked.
  @Post(':id/sends')
  async send(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(
      z.object({ channel: z.enum(deliveryChannels.map((c) => c.id) as [string]), method: z.enum(['share', 'download', 'print']), ok: z.boolean(), detail: z.string().max(500).nullish() }),
      body,
    );
    const ind = await findOr404(ctx.db.select().from(t.indent).where(eq(t.indent.id, id)));
    ctx.assert('indent.manage', ind.outletId);
    if (ind.status === 'pending_approval' || ind.status === 'cancelled') throw new ConflictException('Approve the indent first');
    await ctx.tx((tx) => recordSend(tx, ctx, id, b.channel, b.ok, [b.method, b.detail].filter(Boolean).join(': ')));
    return this.get(ctx, id);
  }
}


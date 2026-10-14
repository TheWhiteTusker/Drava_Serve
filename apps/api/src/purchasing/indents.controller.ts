import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { C, Ctx, findOr404, parse } from '../common.js';
import { controlDb, controlSchema, tenantSchema as t } from '../db/index.js';
import { putObject } from '../storage.js';
import { approveIndent, buildIndents, deliveryChannels, deliveryDateFor, recordSend, sendAutomatically } from './indents.js';
import { indentPdf } from './pdf.js';

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

import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { dec, zPct } from '@fnb/shared';
import { z } from 'zod';
import { alias } from 'drizzle-orm/pg-core';
import { C, Ctx, findOr404, parse, Permit } from '../common.js';
import { tenantSchema as t } from '../db/index.js';
import { menuForSale } from './menu.js';
import { recost } from './costing.js';
import { rerankOutlet } from './ranking.js';
import { runOffers } from './offers.js';
import { proposer } from './recipes.js';

// Margin targets, menu placement, beverage offer rules and the price-change queue.
@Controller()
export class PricingRulesController {
  @Get('margin-targets')
  async targets(@C() ctx: Ctx, @Query('outletId') outletId: string) {
    ctx.assert('rates.view', outletId);
    return ctx.db.select().from(t.marginTarget).where(eq(t.marginTarget.outletId, outletId));
  }

  // Outlet target (categoryId null) or a course / category target. targetPct null removes it.
  @Put('margin-targets')
  async setTarget(@C() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ outletId: z.uuid(), categoryId: z.uuid().nullable(), targetPct: zPct.nullable() }), body);
    ctx.assert('pricing.rules', b.outletId);
    await ctx.tx(async (tx) => {
      const where = and(eq(t.marginTarget.outletId, b.outletId), b.categoryId ? eq(t.marginTarget.categoryId, b.categoryId) : isNull(t.marginTarget.categoryId));
      if (b.targetPct == null) await tx.delete(t.marginTarget).where(where);
      else
        await tx
          .insert(t.marginTarget)
          .values({ outletId: b.outletId, categoryId: b.categoryId, targetPct: b.targetPct })
          .onConflictDoUpdate({ target: [t.marginTarget.outletId, t.marginTarget.categoryId], set: { targetPct: b.targetPct, updatedAt: new Date() } });
      const items = await tx.select({ id: t.menuItem.id }).from(t.menuItem).where(eq(t.menuItem.outletId, b.outletId));
      await recost(ctx, tx, items.map((i) => i.id), 'new margin target');
    });
    return this.targets(ctx, b.outletId);
  }

  // Manager pins (a position inside the course) and offer exclusions.
  @Put('menu-items/:id/placement')
  async placement(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ pinPosition: z.number().int().min(1).nullable(), offerExcluded: z.boolean() }), body);
    const item = await findOr404(ctx.db.select().from(t.menuItem).where(eq(t.menuItem.id, id)));
    ctx.assert('menu.pins', item.outletId);
    await ctx.tx((tx) => tx.update(t.menuItem).set({ ...b, version: sql`${t.menuItem.version} + 1`, updatedAt: new Date() }).where(eq(t.menuItem.id, id)));
    await rerankOutlet(ctx, item.outletId);
    await runOffers(ctx, item.outletId);
    return { ok: true };
  }

  // ---------- Offer rules and the offers log ----------

  @Get('price-rules')
  async rules(@C() ctx: Ctx, @Query('outletId') outletId: string) {
    if (!ctx.can('pricing.rules', outletId)) ctx.assert('menu.pins', outletId);
    return ctx.db.select().from(t.priceRule).where(eq(t.priceRule.outletId, outletId));
  }

  @Put('price-rules')
  async setRule(@C() ctx: Ctx, @Body() body: unknown) {
    const b = parse(
      z.object({
        id: z.uuid().optional(),
        version: z.number().int().optional(),
        outletId: z.uuid(),
        name: z.string().trim().min(1),
        active: z.boolean(),
        triggerServes: z.number().int().min(0),
        discountPct: zPct,
        bandMinPct: zPct,
        bandMaxPct: zPct,
        matchScope: z.enum(['type_and_serve', 'subtype_and_serve']),
        marginFloorPct: zPct,
        minSubstituteServes: z.number().int().min(0),
        maxItems: z.number().int().min(1).max(20),
        releaseBufferServes: z.number().int().min(0),
      }),
      body,
    );
    ctx.assert('pricing.rules', b.outletId);
    if (dec(b.bandMinPct).gt(b.bandMaxPct)) throw new BadRequestException('The band minimum must be below the maximum');
    const { id, version, ...data } = b;
    await ctx.tx(async (tx) => {
      if (id) {
        const rows = await tx.update(t.priceRule).set({ ...data, version: sql`${t.priceRule.version} + 1`, updatedAt: new Date() }).where(and(eq(t.priceRule.id, id), eq(t.priceRule.version, version ?? -1))).returning();
        if (!rows.length) throw new ConflictException('Someone else changed this rule after you opened it. Reload and try again.');
      } else await tx.insert(t.priceRule).values(data);
    });
    await runOffers(ctx, b.outletId);
    return this.rules(ctx, b.outletId);
  }

  @Get('offers')
  async offers(@C() ctx: Ctx, @Query('outletId') outletId: string, @Query('status') status?: string) {
    ctx.assert('rates.view', outletId);
    const trigger = alias(t.menuItem, 'trigger');
    return ctx.db
      .select({ o: t.activeDiscount, item: t.menuItem.name, trigger: trigger.name })
      .from(t.activeDiscount)
      .innerJoin(t.menuItem, eq(t.menuItem.id, t.activeDiscount.menuItemId))
      .innerJoin(trigger, eq(trigger.id, t.activeDiscount.triggerMenuItemId))
      .where(and(eq(t.activeDiscount.outletId, outletId), status ? eq(t.activeDiscount.status, status as any) : undefined))
      .orderBy(desc(t.activeDiscount.startedAt))
      .limit(200)
      .then((rows) => rows.map((r) => ({ ...r.o, item: r.item, trigger: r.trigger })));
  }

  @Post('offers/run')
  async run(@C() ctx: Ctx, @Body() body: unknown) {
    const { outletId } = parse(z.object({ outletId: z.uuid() }), body);
    if (!ctx.can('pricing.rules', outletId)) ctx.assert('menu.pins', outletId);
    await rerankOutlet(ctx, outletId);
    await runOffers(ctx, outletId);
    return this.offers(ctx, outletId, 'active');
  }

  // Ranked menu with availability and current prices (no margins): the POS and admin preview.
  @Get('menu/ranked')
  async ranked(@C() ctx: Ctx, @Query('outletId') outletId: string) {
    if (!ctx.can('pos.bill', outletId)) ctx.assert('catalog.view', outletId);
    return menuForSale(ctx.db, outletId);
  }

  // Price-change requests waiting, with who asked (for the approvals screen).
  @Get('price-requests')
  @Permit('approvals.decide')
  async priceRequests(@C() ctx: Ctx) {
    return ctx.db
      .select({ r: t.approvalRequest, by: proposer.name })
      .from(t.approvalRequest)
      .leftJoin(proposer, eq(proposer.id, t.approvalRequest.proposedBy))
      .where(and(eq(t.approvalRequest.type, 'price_change'), eq(t.approvalRequest.status, 'pending')));
  }
}

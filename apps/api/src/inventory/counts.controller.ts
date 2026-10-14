import { Body, ConflictException, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { dec, zQty } from '@fnb/shared';
import { z } from 'zod';
import { proposeOrApply } from '../approvals.js';
import { C, Ctx, findOr404, parse, Permit } from '../common.js';
import { tenantSchema as t } from '../db/index.js';
import { availability } from '../stock/availability.js';
import { stockTx } from '../stock/ledger.js';
import { storeOf, zId } from './approvals.js';
import { liquorRegister } from './liquor-register.js';

// ---------- Stock counts, availability and the liquor register ----------

@Controller('inventory')
export class InventoryCountsController {

  @Post('counts')
  async scheduleCount(@C() ctx: Ctx, @Body() body: unknown) {
    const x = parse(z.object({ storeId: zId, scheduledFor: z.iso.date() }), body);
    const store = await storeOf(ctx.db, x.storeId);
    ctx.assert('inventory.count', store.outletId);
    return ctx.tx(async (tx) => (await tx.insert(t.stockCount).values({ outletId: store.outletId, storeId: store.id, scheduledFor: x.scheduledFor }).returning())[0]);
  }

  @Get('counts')
  async counts(@C() ctx: Ctx, @Query('outletId') outletId: string) {
    ctx.assert('inventory.view', outletId);
    return ctx.db
      .select({ c: t.stockCount, store: t.store.name })
      .from(t.stockCount)
      .innerJoin(t.store, eq(t.store.id, t.stockCount.storeId))
      .where(eq(t.stockCount.outletId, outletId))
      .orderBy(desc(t.stockCount.scheduledFor))
      .then((r) => r.map((x) => ({ ...x.c, store: x.store })));
  }

  // Starting a count snapshots what the books say is in the store right now.
  @Post('counts/:id/start')
  async startCount(@C() ctx: Ctx, @Param('id') id: string) {
    const count = await findOr404(ctx.db.select().from(t.stockCount).where(eq(t.stockCount.id, id)));
    ctx.assert('inventory.count', count.outletId);
    if (count.status !== 'scheduled') throw new ConflictException('This count has already started');
    await ctx.tx(async (tx) => {
      const bal = await tx.select().from(t.stockBalance).where(eq(t.stockBalance.storeId, count.storeId));
      const items = await tx.select({ id: t.stockItem.id }).from(t.stockItem).where(eq(t.stockItem.active, true));
      const ids = new Set([...bal.filter((b) => !dec(b.qty).isZero()).map((b) => b.stockItemId)]);
      const levels = await tx.select().from(t.stockLevel).where(eq(t.stockLevel.outletId, count.outletId));
      levels.forEach((l) => items.some((i) => i.id === l.stockItemId) && ids.add(l.stockItemId));
      if (ids.size) {
        await tx.insert(t.stockCountLine).values([...ids].map((stockItemId) => ({ countId: id, stockItemId, expectedQty: bal.find((b) => b.stockItemId === stockItemId)?.qty ?? '0' })));
      }
      await tx.update(t.stockCount).set({ status: 'counting', updatedAt: new Date() }).where(eq(t.stockCount.id, id));
    });
    return this.count(ctx, id);
  }

  // Count with variance by item and cause, valued at average cost.
  @Get('counts/:id')
  async count(@C() ctx: Ctx, @Param('id') id: string) {
    const count = await findOr404(ctx.db.select().from(t.stockCount).where(eq(t.stockCount.id, id)));
    ctx.assert('inventory.view', count.outletId);
    const lines = await ctx.db
      .select({ l: t.stockCountLine, name: t.stockItem.name, unit: t.stockItem.baseUnit, avgCost: t.stockBalance.avgCost })
      .from(t.stockCountLine)
      .innerJoin(t.stockItem, eq(t.stockItem.id, t.stockCountLine.stockItemId))
      .leftJoin(t.stockBalance, and(eq(t.stockBalance.stockItemId, t.stockCountLine.stockItemId), eq(t.stockBalance.storeId, count.storeId)))
      .where(eq(t.stockCountLine.countId, id))
      .orderBy(t.stockItem.name);
    const showCost = ctx.can('rates.view', count.outletId);
    return {
      ...count,
      lines: lines.map(({ l, name, unit, avgCost }) => {
        const variance = l.countedQty == null ? null : dec(l.countedQty).minus(l.expectedQty);
        return { ...l, name, unit, variance: variance?.toFixed(3) ?? null, varianceValue: showCost && variance ? variance.times(avgCost ?? 0).toFixed(2) : null };
      }),
    };
  }

  @Put('counts/:id/lines')
  async enterCount(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const lines = parse(z.array(z.object({ stockItemId: zId, countedQty: zQty.nullable(), cause: z.string().max(200).nullish() })), body);
    const count = await findOr404(ctx.db.select().from(t.stockCount).where(eq(t.stockCount.id, id)));
    ctx.assert('inventory.count', count.outletId);
    if (count.status !== 'counting') throw new ConflictException('Start the count first; a submitted count cannot be changed');
    await ctx.tx(async (tx) => {
      for (const l of lines) {
        // An item found on the shelf that was not on the count sheet gets a line, expecting what the books say now.
        const [bal] = await tx
          .select({ qty: t.stockBalance.qty })
          .from(t.stockBalance)
          .where(and(eq(t.stockBalance.storeId, count.storeId), eq(t.stockBalance.stockItemId, l.stockItemId)));
        await tx
          .insert(t.stockCountLine)
          .values({ countId: id, stockItemId: l.stockItemId, expectedQty: bal?.qty ?? '0', countedQty: l.countedQty, cause: l.cause ?? null })
          .onConflictDoUpdate({
            target: [t.stockCountLine.countId, t.stockCountLine.stockItemId],
            set: { countedQty: l.countedQty, cause: l.cause ?? null },
          });
      }
    });
    return this.count(ctx, id);
  }

  // Corrections are always approved by a manager (directly if the counter is one).
  @Post('counts/:id/submit')
  async submitCount(@C() ctx: Ctx, @Param('id') id: string) {
    const count = await findOr404(ctx.db.select().from(t.stockCount).where(eq(t.stockCount.id, id)));
    ctx.assert('inventory.count', count.outletId);
    if (count.status !== 'counting') throw new ConflictException('This count is not open');
    return stockTx(ctx, async (tx, post) => {
      await tx.update(t.stockCount).set({ status: 'submitted', submittedBy: ctx.userId, submittedAt: new Date(), updatedAt: new Date() }).where(eq(t.stockCount.id, id));
      return proposeOrApply(ctx, tx, post, { outletId: count.outletId, type: 'count_correction', entity: 'stock_count', entityId: id, proposed: { countId: id }, reason: 'Stock count variance' });
    });
  }

  // Portions each menu item can still make, with its status (available, low, out).
  @Get('availability')
  async availability(@C() ctx: Ctx, @Query('outletId') outletId: string) {
    if (!ctx.can('pos.bill', outletId)) ctx.assert('catalog.view', outletId);
    const a = await availability(ctx.db, outletId);
    return [...a].map(([menuItemId, x]) => ({ menuItemId, ...x }));
  }

  // ---------- Liquor register ----------

  @Get('liquor-register')
  @Permit('inventory.view')
  async liquorRegister(@C() ctx: Ctx, @Query('outletId') outletId: string, @Query('date') date: string) {
    ctx.assert('inventory.view', outletId);
    return liquorRegister(ctx.db, outletId, parse(z.iso.date(), date));
  }
}

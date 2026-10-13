import { BadRequestException, Body, ConflictException, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { dec, margin, portionCost, suggestedPrice, zPct, zQty } from '@fnb/shared';
import { z } from 'zod';
import { alias } from 'drizzle-orm/pg-core';
import { proposeOrApply } from '../approvals.js';
import { C, Ctx, findOr404, parse } from '../common.js';
import { tenantSchema as t, type Tx } from '../db/index.js';
import { costOf, targetsFor } from './costing.js';
import { afterMenuChange } from './approvals.js';

const zRecipeLine = z.object({
  stockItemId: z.uuid(),
  quantity: zQty.refine((v) => dec(v).gt(0), 'Must be more than zero'),
  yieldPct: zPct.refine((v) => dec(v).gt(0), 'Must be more than zero').default('100'),
});
export type RecipeLineInput = z.infer<typeof zRecipeLine>;

export async function writeRecipe(ctx: Ctx, tx: Tx, item: typeof t.menuItem.$inferSelect, lines: RecipeLineInput[]) {
  await tx.delete(t.recipeLine).where(eq(t.recipeLine.menuItemId, item.id));
  if (lines.length) await tx.insert(t.recipeLine).values(lines.map((l) => ({ ...l, menuItemId: item.id })));
  await tx.update(t.menuItem).set({ recipeVersion: sql`${t.menuItem.recipeVersion} + 1`, updatedAt: new Date() }).where(eq(t.menuItem.id, item.id));
  afterMenuChange(ctx, item, 'recipe change');
}

export const proposer = alias(t.appUser, 'proposer');

@Controller()
export class PricingController {
  // ---------- Recipes ----------

  @Get('menu-items/:id/recipe')
  async recipe(@C() ctx: Ctx, @Param('id') id: string) {
    const item = await findOr404(ctx.db.select().from(t.menuItem).where(eq(t.menuItem.id, id)));
    ctx.assert('catalog.view', item.outletId);
    const lines = await ctx.db
      .select({ l: t.recipeLine, name: t.stockItem.name, baseUnit: t.stockItem.baseUnit, unitCost: t.stockItem.currentCost })
      .from(t.recipeLine)
      .innerJoin(t.stockItem, eq(t.stockItem.id, t.recipeLine.stockItemId))
      .where(eq(t.recipeLine.menuItemId, id))
      .orderBy(t.stockItem.name);
    const showCost = ctx.can('rates.view', item.outletId);
    const cost = portionCost(lines.map((x) => ({ qty: x.l.quantity, yieldPct: x.l.yieldPct, unitCost: x.unitCost })));
    const target = (await targetsFor(ctx.db, [item])).get(id);
    return {
      menuItemId: id,
      recipeVersion: item.recipeVersion,
      lines: lines.map((x) => ({
        ...x.l, name: x.name, baseUnit: x.baseUnit,
        unitCost: showCost ? x.unitCost : null,
        lineCost: showCost ? portionCost([{ qty: x.l.quantity, yieldPct: x.l.yieldPct, unitCost: x.unitCost }]) : null,
      })),
      ...(showCost
        ? { portionCost: cost, sellingPrice: item.sellingPrice, margin: margin(item.sellingPrice, cost), targetPct: target, suggestedPrice: target ? suggestedPrice(cost, target) : null }
        : {}),
    };
  }

  // Entered once per menu item. A change that takes the margin under target needs approval
  // from someone who can approve (handoff 6.12: chef / bar manager).
  @Put('menu-items/:id/recipe')
  async setRecipe(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { recipeVersion, lines } = parse(z.object({ recipeVersion: z.number().int(), lines: z.array(zRecipeLine) }), body);
    const item = await findOr404(ctx.db.select().from(t.menuItem).where(eq(t.menuItem.id, id)));
    ctx.assert('recipes.manage', item.outletId);
    if (new Set(lines.map((l) => l.stockItemId)).size !== lines.length) throw new BadRequestException('Each ingredient once, please');
    if (item.recipeVersion !== recipeVersion) throw new ConflictException('Someone else changed this recipe after you opened it. Reload and try again.');
    const units = await ctx.db.select({ id: t.stockItem.id, cost: t.stockItem.currentCost }).from(t.stockItem).where(inArray(t.stockItem.id, lines.map((l) => l.stockItemId).concat(id)));
    const cost = portionCost(lines.map((l) => ({ qty: l.quantity, yieldPct: l.yieldPct, unitCost: units.find((u) => u.id === l.stockItemId)?.cost ?? '0' })));
    const target = (await targetsFor(ctx.db, [item])).get(id);
    const under = target != null && dec(margin(item.sellingPrice, cost).pct).lt(target);
    return ctx.tx(async (tx) => {
      if (under) {
        const r = await proposeOrApply(ctx, tx, null, {
          outletId: item.outletId, type: 'recipe_change', entity: 'menu_item', entityId: id, proposed: { menuItemId: id, lines, summary: `${item.name}: new portion cost ₹${dec(cost).toFixed(2)}` },
          reason: `Margin would be ${margin(item.sellingPrice, cost).pct}%, under the ${target}% target`,
        });
        return { status: r.status, approvalId: r.id };
      }
      await writeRecipe(ctx, tx, item, lines);
      return { status: 'applied' };
    });
  }

  // ---------- Costing and margins (admin only; never on the POS or guest menu) ----------

  @Get('costing')
  async costing(@C() ctx: Ctx, @Query('outletId') outletId: string) {
    ctx.assert('rates.view', outletId);
    const items = await ctx.db
      .select({ m: t.menuItem, cat: t.category.name, rank: t.menuRank.position, portions: t.menuRank.availablePortions })
      .from(t.menuItem)
      .innerJoin(t.category, eq(t.category.id, t.menuItem.categoryId))
      .leftJoin(t.menuRank, eq(t.menuRank.menuItemId, t.menuItem.id))
      .where(eq(t.menuItem.outletId, outletId));
    const costs = await costOf(ctx.db, items.map((i) => i.m.id));
    const targets = await targetsFor(ctx.db, items.map((i) => i.m));
    const offers = await ctx.db.select().from(t.activeDiscount).where(and(eq(t.activeDiscount.outletId, outletId), eq(t.activeDiscount.status, 'active')));
    return items
      .map(({ m, cat, rank, portions }) => {
        const cost = costs.get(m.id)!;
        const mg = margin(m.sellingPrice, cost);
        const target = targets.get(m.id);
        const offer = offers.find((o) => o.menuItemId === m.id);
        return {
          id: m.id, name: m.name, department: m.department, category: cat, dietType: m.dietType, sellingPrice: m.sellingPrice, portionCost: cost,
          marginAmount: mg.amount, marginPct: mg.pct, targetPct: target, underTarget: target != null && dec(mg.pct).lt(target),
          suggestedPrice: target && dec(cost).gt(0) ? suggestedPrice(cost, target) : null, rank, portions, pinPosition: m.pinPosition,
          offerExcluded: m.offerExcluded, offerPrice: offer?.offerPrice ?? null, version: m.version, active: m.active,
        };
      })
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  }

  // Margin history for one item: what each re-costing found.
  @Get('menu-items/:id/costs')
  async costs(@C() ctx: Ctx, @Param('id') id: string) {
    const item = await findOr404(ctx.db.select().from(t.menuItem).where(eq(t.menuItem.id, id)));
    ctx.assert('rates.view', item.outletId);
    return ctx.db.select().from(t.menuItemCost).where(eq(t.menuItemCost.menuItemId, id)).orderBy(desc(t.menuItemCost.calculatedAt)).limit(50);
  }
}

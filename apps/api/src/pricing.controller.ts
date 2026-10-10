import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { dec, margin, portionCost, suggestedPrice, zPct, zQty } from '@fnb/shared';
import { z } from 'zod';
import { alias } from 'drizzle-orm/pg-core';
import { proposeOrApply, registerApproval } from './approvals.js';
import { C, Ctx, findOr404, parse, Permit, Public } from './common.js';
import { controlDb, controlSchema, tenantDb, tenantSchema as t, type Tx } from './db/index.js';
import { costOf, menuForSale, recost, rerankOutlet, runOffers, targetsFor } from './pricing.js';

// After a price or recipe changes: new cost row now; order and offers once committed.
export function afterMenuChange(ctx: Ctx, item: { id: string; outletId: string }, reason: string) {
  ctx.afterCommit(async () => {
    await ctx.tx((tx) => recost(ctx, tx, [item.id], reason));
    await rerankOutlet(ctx, item.outletId);
    await runOffers(ctx, item.outletId);
  });
}

registerApproval('price_change', 'Menu price change', async (ctx, tx, req) => {
  const p = req.proposed as { menuItemId: string; sellingPrice: string };
  const [item] = await tx
    .update(t.menuItem)
    .set({ sellingPrice: p.sellingPrice, version: sql`${t.menuItem.version} + 1`, updatedAt: new Date() })
    .where(eq(t.menuItem.id, p.menuItemId))
    .returning();
  afterMenuChange(ctx, item, 'price change');
});

registerApproval('recipe_change', 'Recipe change that takes margin under target', async (ctx, tx, req) => {
  const p = req.proposed as { menuItemId: string; lines: RecipeLineInput[] };
  const item = await findOr404(tx.select().from(t.menuItem).where(eq(t.menuItem.id, p.menuItemId)));
  await writeRecipe(ctx, tx, item, p.lines);
});

const zRecipeLine = z.object({
  stockItemId: z.uuid(),
  quantity: zQty.refine((v) => dec(v).gt(0), 'Must be more than zero'),
  yieldPct: zPct.refine((v) => dec(v).gt(0), 'Must be more than zero').default('100'),
});
type RecipeLineInput = z.infer<typeof zRecipeLine>;

async function writeRecipe(ctx: Ctx, tx: Tx, item: typeof t.menuItem.$inferSelect, lines: RecipeLineInput[]) {
  await tx.delete(t.recipeLine).where(eq(t.recipeLine.menuItemId, item.id));
  if (lines.length) await tx.insert(t.recipeLine).values(lines.map((l) => ({ ...l, menuItemId: item.id })));
  await tx.update(t.menuItem).set({ recipeVersion: sql`${t.menuItem.recipeVersion} + 1`, updatedAt: new Date() }).where(eq(t.menuItem.id, item.id));
  afterMenuChange(ctx, item, 'recipe change');
}

const proposer = alias(t.appUser, 'proposer');

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

// ---------- Guest QR menu (no sign-in, collects nothing about guests) ----------

const publicCache = new Map<string, { at: number; body: unknown }>();

@Controller('public')
export class PublicMenuController {
  @Public()
  @Get('menu/:customer/:outlet')
  async menu(@Param('customer') customerCode: string, @Param('outlet') outletCode: string) {
    const key = `${customerCode}/${outletCode}`;
    const hit = publicCache.get(key);
    if (hit && Date.now() - hit.at < 15_000) return hit.body;
    const [c] = await controlDb().select().from(controlSchema.customer).where(eq(controlSchema.customer.code, customerCode));
    if (!c || c.status !== 'active') throw new NotFoundException('Menu not found');
    const db = tenantDb(c.dbName);
    const [outlet] = await db.select().from(t.outlet).where(and(eq(t.outlet.code, outletCode.toUpperCase()), eq(t.outlet.active, true)));
    if (!outlet) throw new NotFoundException('Menu not found');
    const items = await menuForSale(db, outlet.id);
    const body = {
      outlet: { name: outlet.name, address: outlet.address, fssaiNumber: outlet.fssaiNumber },
      items: items.map(({ taxClassId: _t, activeDiscountId: _d, portions, ...i }) => ({ ...i, fewLeft: i.status === 'low' ? portions : null })),
    };
    publicCache.set(key, { at: Date.now(), body });
    return body;
  }
}


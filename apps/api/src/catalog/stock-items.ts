import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { withVersion, zStockItem, type StockItemInput } from '@fnb/shared';
import { C, Ctx, findOr404, parse, Permit, updateVersioned } from '../common.js';
import { tenantSchema as t, type Tx } from '../db/index.js';

// ---------- Stock items (with purchase units and per-outlet levels) ----------

@Controller('stock-items')
export class StockItemsController {
  @Get()
  @Permit('catalog.view')
  async list(@C() ctx: Ctx, @Query('department') department?: 'food' | 'beverage') {
    const items = await ctx.db
      .select()
      .from(t.stockItem)
      .where(department ? eq(t.stockItem.department, department) : undefined)
      .orderBy(t.stockItem.department, t.stockItem.name);
    const ids = items.map((i) => i.id);
    const [units, levels] = ids.length
      ? await Promise.all([
          ctx.db.select().from(t.stockItemUnit).where(inArray(t.stockItemUnit.stockItemId, ids)),
          ctx.db.select().from(t.stockLevel).where(inArray(t.stockLevel.stockItemId, ids)),
        ])
      : [[], []];
    const outlets = ctx.outletsWith('catalog.view');
    return items.map((i) => ({
      ...i,
      units: units.filter((u) => u.stockItemId === i.id),
      levels: levels.filter((l) => l.stockItemId === i.id && (outlets === 'all' || outlets.includes(l.outletId))),
    }));
  }

  @Get(':id')
  @Permit('catalog.view')
  async get(@C() ctx: Ctx, @Param('id') id: string) {
    const item = await findOr404(ctx.db.select().from(t.stockItem).where(eq(t.stockItem.id, id)));
    const units = await ctx.db.select().from(t.stockItemUnit).where(eq(t.stockItemUnit.stockItemId, id));
    const levels = await ctx.db.select().from(t.stockLevel).where(eq(t.stockLevel.stockItemId, id));
    return { ...item, units, levels };
  }

  @Post()
  @Permit('catalog.manage')
  create(@C() ctx: Ctx, @Body() body: unknown) {
    const { units, levels, ...data } = parse(zStockItem, body);
    return ctx.tx(async (tx) => {
      const [item] = await tx.insert(t.stockItem).values(data).returning();
      await saveChildren(ctx, tx, item.id, units, levels);
      return item;
    });
  }

  @Put(':id')
  @Permit('catalog.manage')
  update(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { units, levels, version, ...data } = parse(withVersion(zStockItem), body);
    return ctx.tx(async (tx) => {
      const item = await updateVersioned(tx, t.stockItem, id, version, data);
      await saveChildren(ctx, tx, id, units, levels);
      return item;
    });
  }
}

async function saveChildren(
  ctx: Ctx,
  tx: Tx,
  stockItemId: string,
  units: (StockItemInput['units'][number] & { id?: string })[],
  levels: StockItemInput['levels'],
) {
  // Units: keep ids stable because vendor rates and orders point at them.
  const existing = await tx.select().from(t.stockItemUnit).where(eq(t.stockItemUnit.stockItemId, stockItemId));
  for (const old of existing) {
    const next = units.find((u) => u.name === old.name);
    if (!next) await tx.delete(t.stockItemUnit).where(eq(t.stockItemUnit.id, old.id));
    else if (next.factor !== old.factor || next.isDefault !== old.isDefault) {
      await tx.update(t.stockItemUnit).set({ factor: next.factor, isDefault: next.isDefault }).where(eq(t.stockItemUnit.id, old.id));
    }
  }
  const fresh = units.filter((u) => !existing.some((e) => e.name === u.name));
  if (fresh.length) await tx.insert(t.stockItemUnit).values(fresh.map((u) => ({ stockItemId, name: u.name, factor: u.factor, isDefault: u.isDefault })));
  // Levels: only for outlets this user manages.
  for (const l of levels) {
    ctx.assert('catalog.manage', l.outletId);
    await tx
      .insert(t.stockLevel)
      .values({ ...l, stockItemId })
      .onConflictDoUpdate({
        target: [t.stockLevel.stockItemId, t.stockLevel.outletId],
        set: { parLevel: l.parLevel, reorderLevel: l.reorderLevel, criticalLevel: l.criticalLevel },
      });
  }
}

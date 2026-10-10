import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  dec, withVersion, zBrand, zCategory, zMenuItem, zStockItem, zTaxClass, type Permission, type StockItemInput,
} from '@fnb/shared';
import type { ZodType } from 'zod';
import { getSettings } from './access.controller.js';
import { proposeOrApply } from './approvals.js';
import { C, Ctx, findOr404, parse, Permit, updateVersioned } from './common.js';
import { afterMenuChange } from './pricing.controller.js';
import { tenantSchema as t, type Tx } from './db/index.js';

interface CrudOpts {
  path: string;
  table: any;
  schema: ZodType<any>;
  view: Permission;
  manage: Permission;
  outletScoped?: boolean; // rows carry outletId and users only see their outlets
  orderBy: (table: any) => any[];
  // Validates, may adjust data, and may return extra fields for the response.
  check?: (ctx: Ctx, tx: Tx, data: any, before?: any) => Promise<Record<string, unknown> | void>;
  after?: (ctx: Ctx, row: any) => void;
}

// List / get / create / update for simple tables. Customer-wide tables (no outletId) need the
// permission at any outlet; outlet tables need it at the row's outlet.
export function crud(o: CrudOpts) {
  @Controller(o.path)
  class CrudController {
    @Get()
    @Permit(o.view)
    list(@C() ctx: Ctx, @Query('outletId') outletId?: string) {
      let where;
      if (o.outletScoped) {
        if (outletId) ctx.assert(o.view, outletId);
        const allowed = ctx.outletsWith(o.view);
        where = outletId ? eq(o.table.outletId, outletId) : allowed === 'all' ? undefined : inArray(o.table.outletId, allowed);
      }
      return ctx.db.select().from(o.table).where(where).orderBy(...o.orderBy(o.table));
    }

    @Get(':id')
    @Permit(o.view)
    async get(@C() ctx: Ctx, @Param('id') id: string) {
      const row = await findOr404(ctx.db.select().from(o.table).where(eq(o.table.id, id)));
      if (o.outletScoped) ctx.assert(o.view, row.outletId);
      return row;
    }

    @Post()
    @Permit(o.manage)
    create(@C() ctx: Ctx, @Body() body: unknown) {
      const data = parse(o.schema, body);
      if (o.outletScoped) ctx.assert(o.manage, data.outletId);
      return ctx.tx(async (tx) => {
        await o.check?.(ctx, tx, data);
        const [row] = (await tx.insert(o.table).values(data).returning()) as any[];
        o.after?.(ctx, row);
        return row;
      });
    }

    @Put(':id')
    @Permit(o.manage)
    update(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
      const { version, ...data } = parse(withVersion(o.schema), body);
      return ctx.tx(async (tx) => {
        const before = await findOr404(tx.select().from(o.table).where(eq(o.table.id, id)));
        if (o.outletScoped) {
          ctx.assert(o.manage, before.outletId);
          ctx.assert(o.manage, data.outletId);
        }
        const extra = await o.check?.(ctx, tx, data, before);
        const row = await updateVersioned(tx, o.table, id, version, data);
        o.after?.(ctx, row);
        return { ...row, ...extra };
      });
    }
  }
  Object.defineProperty(CrudController, 'name', { value: `${o.path.replace(/\W/g, '_')}Controller` });
  return CrudController;
}

export const CategoriesController = crud({
  path: 'categories',
  table: t.category,
  schema: zCategory,
  view: 'catalog.view',
  manage: 'catalog.manage',
  orderBy: (c) => [asc(c.kind), asc(c.sortOrder), asc(c.name)],
  // Liquor sub-types sit under a liquor type; nothing else nests.
  async check(_ctx, tx, data) {
    const parent = data.parentId
      ? (await tx.select().from(t.category).where(eq(t.category.id, data.parentId)))[0]
      : undefined;
    if (data.kind === 'liquor_subtype' && parent?.kind !== 'liquor_type') {
      throw new BadRequestException('A liquor sub-type must sit under a liquor type');
    }
    if (data.kind !== 'liquor_subtype' && data.kind !== 'stock' && parent) {
      throw new BadRequestException('Only liquor sub-types and stock groups can have a parent');
    }
  },
});

export const BrandsController = crud({
  path: 'brands',
  table: t.brand,
  schema: zBrand,
  view: 'catalog.view',
  manage: 'catalog.manage',
  orderBy: (b) => [asc(b.name)],
});

export const TaxClassesController = crud({
  path: 'tax-classes',
  table: t.taxClass,
  schema: zTaxClass,
  view: 'catalog.view',
  manage: 'tax.manage',
  orderBy: (x) => [asc(x.kind), asc(x.code)],
});

export const MenuItemsController = crud({
  path: 'menu-items',
  table: t.menuItem,
  schema: zMenuItem,
  view: 'catalog.view',
  manage: 'catalog.manage',
  outletScoped: true,
  orderBy: (m) => [asc(m.department), asc(m.name)],
  async check(ctx, tx, data, before) {
    const [cat] = await tx.select().from(t.category).where(eq(t.category.id, data.categoryId));
    const ok = data.department === 'food' ? cat?.kind === 'course' : cat?.kind === 'liquor_type' || cat?.kind === 'liquor_subtype';
    if (!ok) {
      throw new BadRequestException(
        data.department === 'food' ? 'Food items go under a course' : 'Beverage items go under a liquor type or sub-type',
      );
    }
    if (!before || dec(before.sellingPrice).eq(data.sellingPrice)) return;
    // Changing a price is its own permission. A change bigger than the limit waits for approval
    // unless the person sets pricing rules (the owner); the rest of the edit saves now.
    ctx.assert('prices.manage', data.outletId);
    const limit = Number((await getSettings(tx, data.outletId)).effective['approvals.priceChangeLimitPct']);
    const changePct = dec(data.sellingPrice).minus(before.sellingPrice).abs().div(dec(before.sellingPrice).gt(0) ? before.sellingPrice : 1).times(100);
    if (changePct.gt(limit) && !ctx.can('pricing.rules', data.outletId)) {
      const r = await proposeOrApply(
        ctx, tx, null,
        {
          outletId: data.outletId, type: 'price_change', entity: 'menu_item', entityId: before.id,
          current: { sellingPrice: before.sellingPrice }, proposed: { menuItemId: before.id, sellingPrice: data.sellingPrice },
          reason: `Price change of ${changePct.toFixed(1)}% is above the ${limit}% limit`,
        },
        { forceQueue: true },
      );
      data.sellingPrice = before.sellingPrice;
      return { priceApproval: r.id };
    }
  },
  after: (ctx, row) => afterMenuChange(ctx, row, 'menu item saved'),
});

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

// ---------- Liquor tree: type → sub-type → brand → product ----------

@Controller('catalog')
export class LiquorTreeController {
  @Get('liquor-tree')
  @Permit('catalog.view')
  async tree(@C() ctx: Ctx) {
    const cats = await ctx.db
      .select()
      .from(t.category)
      .where(inArray(t.category.kind, ['liquor_type', 'liquor_subtype']))
      .orderBy(t.category.sortOrder, t.category.name);
    const products = await ctx.db
      .select({ item: t.stockItem, brandName: t.brand.name })
      .from(t.stockItem)
      .leftJoin(t.brand, eq(t.brand.id, t.stockItem.brandId))
      .where(and(eq(t.stockItem.department, 'beverage')))
      .orderBy(t.brand.name, t.stockItem.bottleSizeMl);
    const brandsUnder = (catId: string) => {
      const mine = products.filter((p) => p.item.categoryId === catId);
      const names = [...new Map(mine.map((p) => [p.item.brandId ?? '', p.brandName ?? 'No brand'])).entries()];
      return names.map(([brandId, name]) => ({
        id: brandId || null,
        name,
        products: mine.filter((p) => (p.item.brandId ?? '') === brandId).map((p) => p.item),
      }));
    };
    return cats
      .filter((c) => c.kind === 'liquor_type')
      .map((type) => ({
        ...type,
        brands: brandsUnder(type.id), // products filed directly under the type
        subtypes: cats.filter((s) => s.parentId === type.id).map((s) => ({ ...s, brands: brandsUnder(s.id) })),
      }));
  }
}

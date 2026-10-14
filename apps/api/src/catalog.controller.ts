import { BadRequestException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { dec, zBrand, zCategory, zDiningTable, zMenuItem, zTaxClass } from '@fnb/shared';
import { getSettings } from './access/settings.js';
import { proposeOrApply } from './approvals.js';
import { afterMenuChange } from './pricing/approvals.js';
import { tenantSchema as t } from './db/index.js';
import { publish } from './events.js';
import { crud } from './crud.js';

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
// Tables at an outlet. Each has its own QR code; a guest ordering from it orders for that table.
export const DiningTablesController = crud({
  path: 'tables',
  table: t.diningTable,
  schema: zDiningTable,
  view: 'pos.bill',
  manage: 'outlets.manage',
  outletScoped: true,
  orderBy: (d) => [asc(d.sortOrder), asc(d.name)],
  after: (ctx, row) => ctx.afterCommit(() => publish(ctx.customerId, row.outletId, 'menu', {})), // POS reloads its table list
});

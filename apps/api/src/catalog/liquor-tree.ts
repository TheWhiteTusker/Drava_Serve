import { Controller, Get } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { C, Ctx, Permit } from '../common.js';
import { tenantSchema as t } from '../db/index.js';

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

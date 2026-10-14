import { and, eq } from 'drizzle-orm';
import { tenantSchema as t, type Q } from '../db/index.js';
import { availability } from '../stock/availability.js';
import { currentOffers } from './offers.js';

// ---------- The menu as guests and cashiers see it ----------

// Ranked, with availability and current prices. No costs or margins, ever.
export async function menuForSale(q: Q, outletId: string) {
  const items = await q
    .select({ m: t.menuItem, cat: t.category, rank: t.menuRank.position, brand: t.brand.name, taxKind: t.taxClass.kind })
    .from(t.menuItem)
    .innerJoin(t.category, eq(t.category.id, t.menuItem.categoryId))
    .innerJoin(t.taxClass, eq(t.taxClass.id, t.menuItem.taxClassId))
    .leftJoin(t.menuRank, eq(t.menuRank.menuItemId, t.menuItem.id))
    .leftJoin(t.brand, eq(t.brand.id, t.menuItem.brandId))
    .where(and(eq(t.menuItem.outletId, outletId), eq(t.menuItem.active, true)));
  const cats = await q.select().from(t.category);
  const avail = await availability(q, outletId);
  const offers = await currentOffers(q, outletId);
  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? null;
  const list = items
    .map(({ m, cat, rank, brand, taxKind }) => {
      const a = avail.get(m.id);
      const offer = offers.get(m.id);
      return {
        id: m.id, name: m.name, code: m.code, department: m.department, description: m.description,
        categoryId: cat.id, category: cat.name, course: m.department === 'food' ? cat.name : null,
        type: m.department === 'beverage' ? (catName(cat.parentId) ?? cat.name) : null,
        subtype: m.department === 'beverage' && cat.parentId ? cat.name : null,
        categoryOrder: cat.sortOrder, brand, dietType: m.dietType, allergens: m.allergens, tags: m.tags, calories: m.calories,
        serveSizeMl: m.serveSizeMl, taxClassId: m.taxClassId, taxKind, photoId: m.photoKey,
        price: offer?.offerPrice ?? m.sellingPrice, // silent: just the price to charge now
        activeDiscountId: offer?.id ?? null,
        portions: a?.portions ?? null, status: a?.status ?? 'available', rank: rank ?? 999_999,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return list;
}

import { and, eq, sql } from 'drizzle-orm';
import { margin, rankCourse } from '@fnb/shared';
import type { Ctx } from '../common.js';
import { tenantSchema as t } from '../db/index.js';
import { publish } from '../events.js';
import { availability, type Availability } from '../stock/availability.js';
import { costOf } from './costing.js';

// ---------- Ranking ----------

// Food: inside each course, available first, margin % high to low, ties by units sold in the
// last 30 days, manager pins first. Beverages keep type and brand order. Positions are global
// per outlet so one sort gives the whole menu.
export async function rerankOutlet(ctx: Ctx, outletId: string, avail?: Map<string, Availability>) {
  const db = ctx.db;
  const items = await db
    .select({ m: t.menuItem, cat: t.category, parent: sql<string | null>`(select p.sort_order from category p where p.id = ${t.category.parentId})` })
    .from(t.menuItem)
    .innerJoin(t.category, eq(t.category.id, t.menuItem.categoryId))
    .where(and(eq(t.menuItem.outletId, outletId), eq(t.menuItem.active, true)));
  avail ??= await availability(db, outletId);
  const costs = await costOf(db, items.map((i) => i.m.id));
  const sold = new Map(
    (
      await db.execute(sql`
        select l.menu_item_id, sum(l.qty) as units from order_line l join bill b on b.id = l.bill_id
        where b.outlet_id = ${outletId} and b.status = 'paid' and b.paid_at >= now() - interval '30 days' and l.status = 'active'
        group by l.menu_item_id`)
    ).rows.map((r: any) => [r.menu_item_id as string, String(r.units)]),
  );
  const brands = new Map((await db.select().from(t.brand)).map((b) => [b.id, b.name]));
  const positions = new Map<string, number>();

  const food = items.filter((i) => i.m.department === 'food');
  const courses = [...new Map(food.map((i) => [i.cat.id, i.cat])).values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  courses.forEach((course, ci) => {
    const ranked = rankCourse(
      food
        .filter((i) => i.cat.id === course.id)
        .map((i) => ({
          id: i.m.id, name: i.m.name, pin: i.m.pinPosition,
          available: (avail!.get(i.m.id)?.portions ?? 1) > 0,
          marginPct: margin(i.m.sellingPrice, costs.get(i.m.id) ?? '0').pct,
          units30d: sold.get(i.m.id) ?? '0',
        })),
    );
    ranked.forEach((id, idx) => positions.set(id, ci * 1000 + idx));
  });
  const bev = items
    .filter((i) => i.m.department === 'beverage')
    .sort(
      (a, b) =>
        Number(a.parent ?? a.cat.sortOrder) - Number(b.parent ?? b.cat.sortOrder) ||
        (a.parent != null ? a.cat.sortOrder : -1) - (b.parent != null ? b.cat.sortOrder : -1) ||
        (brands.get(a.m.brandId ?? '') ?? '').localeCompare(brands.get(b.m.brandId ?? '') ?? '') ||
        Number(a.m.serveSizeMl ?? 0) - Number(b.m.serveSizeMl ?? 0) ||
        a.m.name.localeCompare(b.m.name),
    );
  bev.forEach((i, idx) => positions.set(i.m.id, 100_000 + idx));

  for (const [menuItemId, position] of positions) {
    const p = avail.get(menuItemId)?.portions;
    const portions = p == null ? null : String(p);
    await db
      .insert(t.menuRank)
      .values({ menuItemId, outletId, position, availablePortions: portions, computedAt: new Date() })
      .onConflictDoUpdate({ target: t.menuRank.menuItemId, set: { position, availablePortions: portions, computedAt: new Date() } });
  }
  publish(ctx.customerId, outletId, 'menu', { reason: 'rank' });
}

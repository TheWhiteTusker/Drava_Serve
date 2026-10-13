import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { dec, grossQty, menuStatus, portionsAvailable, SETTING_DEFAULTS, type MenuStatus } from '@fnb/shared';
import type { Ctx } from '../common.js';
import { tenantSchema as t, type Q } from '../db/index.js';
import { publish } from '../events.js';
import { logActivity } from '../activity.js';
import { namesOf, runOffers } from '../pricing/offers.js';
import { rerankOutlet } from '../pricing/ranking.js';
import type { Changed } from './ledger.js';

// ---------- Availability ----------

// Sales draw from the outlet's kitchen store (food stock) or bar store (beverage stock).
export async function issuingStores(q: Q, outletId: string) {
  const stores = await q.select().from(t.store).where(and(eq(t.store.outletId, outletId), eq(t.store.active, true)));
  const pick = (kind: string) => stores.find((s) => s.kind === kind) ?? stores.find((s) => s.kind === 'main') ?? stores[0];
  return { food: pick('kitchen'), beverage: pick('bar'), all: stores };
}

export async function lowThresholdDefault(q: Q, outletId: string): Promise<number> {
  const rows = await q
    .select()
    .from(t.setting)
    .where(and(eq(t.setting.key, 'menu.lowThresholdServes'), or(sql`${t.setting.outletId} is null`, eq(t.setting.outletId, outletId))));
  const v = rows.find((r) => r.outletId === outletId)?.value ?? rows.find((r) => !r.outletId)?.value;
  return (v as number) ?? SETTING_DEFAULTS['menu.lowThresholdServes'];
}

export interface Availability {
  portions: number | null; // null: no recipe, so not tracked
  status: MenuStatus;
  lowThreshold: number;
}

// Portions each menu item can still make from the issuing store, after what open bills have
// already ordered but not yet paid for.
export async function availability(q: Q, outletId: string, menuItemIds?: string[]): Promise<Map<string, Availability>> {
  const menu = await q
    .select({ id: t.menuItem.id, lowThreshold: t.menuItem.lowThreshold })
    .from(t.menuItem)
    .where(and(eq(t.menuItem.outletId, outletId), menuItemIds ? inArray(t.menuItem.id, menuItemIds) : undefined));
  const out = new Map<string, Availability>();
  if (!menu.length) return out;
  const lines = await q
    .select({ menuItemId: t.recipeLine.menuItemId, stockItemId: t.recipeLine.stockItemId, quantity: t.recipeLine.quantity, yieldPct: t.recipeLine.yieldPct, department: t.stockItem.department })
    .from(t.recipeLine)
    .innerJoin(t.stockItem, eq(t.stockItem.id, t.recipeLine.stockItemId))
    .where(inArray(t.recipeLine.menuItemId, menu.map((m) => m.id)));
  const stores = await issuingStores(q, outletId);
  const stockIds = [...new Set(lines.map((l) => l.stockItemId))];
  const balances = stockIds.length
    ? await q.select().from(t.stockBalance).where(and(inArray(t.stockBalance.stockItemId, stockIds), inArray(t.stockBalance.storeId, [stores.food?.id, stores.beverage?.id].filter(Boolean) as string[])))
    : [];
  const reserved = await reservedByOpenBills(q, outletId);
  const low = await lowThresholdDefault(q, outletId);

  for (const m of menu) {
    const mine = lines.filter((l) => l.menuItemId === m.id);
    const threshold = m.lowThreshold ?? low;
    if (!mine.length) {
      out.set(m.id, { portions: null, status: 'available', lowThreshold: threshold });
      continue;
    }
    const portions = portionsAvailable(
      mine.map((l) => {
        const storeId = (l.department === 'food' ? stores.food : stores.beverage)?.id;
        const onHand = balances.find((b) => b.storeId === storeId && b.stockItemId === l.stockItemId)?.qty ?? '0';
        return { perPortion: grossQty(l.quantity, l.yieldPct), free: dec(onHand).minus(reserved.get(l.stockItemId) ?? 0) };
      }),
    );
    out.set(m.id, { portions, status: menuStatus(portions, threshold), lowThreshold: threshold });
  }
  return out;
}

export async function reservedByOpenBills(q: Q, outletId: string) {
  const r = await q.execute(sql`
    select r.stock_item_id, sum(l.qty * r.quantity / (r.yield_pct / 100)) as qty
    from order_line l
    join bill b on b.id = l.bill_id
    join recipe_line r on r.menu_item_id = l.menu_item_id
    where b.outlet_id = ${outletId} and b.status = 'open' and l.status = 'active'
    group by r.stock_item_id`);
  return new Map(r.rows.map((x: any) => [x.stock_item_id as string, String(x.qty)]));
}

// After stock moves: recompute the affected menu items, store their portions and tell every
// device at the outlet. Returns the items whose sold-out state flipped.
export async function afterStock(ctx: Ctx, changed: Changed[]) {
  const byOutlet = new Map<string, Set<string>>();
  for (const c of changed) {
    byOutlet.set(c.outletId, (byOutlet.get(c.outletId) ?? new Set()).add(c.stockItemId));
    publish(ctx.customerId, c.outletId, 'stock', c);
  }
  const beverage = new Set(
    (await ctx.db.select({ id: t.stockItem.id }).from(t.stockItem).where(and(inArray(t.stockItem.id, changed.map((c) => c.stockItemId)), eq(t.stockItem.department, 'beverage')))).map((x) => x.id),
  );
  for (const [outletId, stockIds] of byOutlet) {
    const { flipped } = await refreshAvailability(ctx, outletId, [...stockIds]);
    // Sold out or back in: the course order changes. Any beverage movement: check offers.
    if (flipped.length) await rerankOutlet(ctx, outletId);
    if ([...stockIds].some((id) => beverage.has(id))) await runOffers(ctx, outletId);
  }
}

export async function refreshAvailability(ctx: Ctx, outletId: string, stockItemIds?: string[]) {
  const db = ctx.db;
  const affected = stockItemIds
    ? (
        await db
          .selectDistinct({ id: t.recipeLine.menuItemId })
          .from(t.recipeLine)
          .innerJoin(t.menuItem, eq(t.menuItem.id, t.recipeLine.menuItemId))
          .where(and(eq(t.menuItem.outletId, outletId), inArray(t.recipeLine.stockItemId, stockItemIds)))
      ).map((r) => r.id)
    : undefined;
  if (affected && !affected.length) return { flipped: [] as string[], avail: new Map<string, Availability>() };
  const avail = await availability(db, outletId, affected);
  const before = new Map(
    (await db.select().from(t.menuRank).where(and(eq(t.menuRank.outletId, outletId), affected ? inArray(t.menuRank.menuItemId, affected) : undefined))).map((r) => [
      r.menuItemId,
      r.availablePortions,
    ]),
  );
  const flipped: string[] = [];
  for (const [id, a] of avail) {
    const prev = before.get(id);
    const wasOut = prev != null && dec(prev).lte(0);
    const isOut = a.portions != null && a.portions <= 0;
    if (before.has(id) && wasOut !== isOut) flipped.push(id);
    const portions = a.portions == null ? null : String(a.portions);
    await db
      .insert(t.menuRank)
      .values({ menuItemId: id, outletId, position: 9999, availablePortions: portions })
      .onConflictDoUpdate({ target: t.menuRank.menuItemId, set: { availablePortions: portions } });
  }
  if (flipped.length) {
    const names = await namesOf(db, flipped);
    for (const id of flipped) {
      const p = avail.get(id)?.portions ?? 0;
      await logActivity(ctx, db, p <= 0
        ? { outletId, kind: 'sold_out', title: 'Sold out', message: `${names.get(id)} has sold out. It is greyed out on the POS and the guest menu.`, data: { menuItemId: id } }
        : { outletId, kind: 'back_in_stock', title: 'Back in stock', message: `${names.get(id)} is available again (${p} ${p === 1 ? 'portion' : 'portions'}).`, data: { menuItemId: id, portions: p } });
    }
  }
  publish(ctx.customerId, outletId, 'availability', {
    items: [...avail].map(([menuItemId, a]) => ({ menuItemId, portions: a.portions, status: a.status })),
  });
  return { flipped, avail };
}

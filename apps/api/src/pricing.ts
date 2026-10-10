import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  dec, isLow, margin, portionCost, rankCourse, resolveTarget, selectOffers, shouldRelease, suggestedPrice, type OfferRule,
} from '@fnb/shared';
import { getSettings } from './access.controller.js';
import { queueSystemRequest } from './approvals.js';
import type { Ctx } from './common.js';
import { tenantSchema as t, type Q, type Tx } from './db/index.js';
import { publish } from './events.js';
import { availability, type Availability } from './stock.js';

// Costing, menu ranking and beverage offers (handoff 6.9, 6.10). All money is decimal strings.

// ---------- Costing ----------

// Portion cost from the latest billed rate of each ingredient (stock_item.current_cost).
export async function costOf(q: Q, menuItemIds: string[]) {
  const out = new Map<string, string>();
  if (!menuItemIds.length) return out;
  const lines = await q
    .select({ menuItemId: t.recipeLine.menuItemId, qty: t.recipeLine.quantity, yieldPct: t.recipeLine.yieldPct, unitCost: t.stockItem.currentCost })
    .from(t.recipeLine)
    .innerJoin(t.stockItem, eq(t.stockItem.id, t.recipeLine.stockItemId))
    .where(inArray(t.recipeLine.menuItemId, menuItemIds));
  for (const id of menuItemIds) out.set(id, portionCost(lines.filter((l) => l.menuItemId === id)));
  return out;
}

// Most specific target: the item's own, then outlet + category, then outlet.
export async function targetsFor(q: Q, items: { id: string; outletId: string; categoryId: string; targetMarginPct: string | null }[]) {
  const outletIds = [...new Set(items.map((i) => i.outletId))];
  const targets = outletIds.length ? await q.select().from(t.marginTarget).where(inArray(t.marginTarget.outletId, outletIds)) : [];
  return new Map(
    items.map((i) => [
      i.id,
      resolveTarget({
        item: i.targetMarginPct,
        category: targets.find((x) => x.outletId === i.outletId && x.categoryId === i.categoryId)?.targetPct,
        outlet: targets.find((x) => x.outletId === i.outletId && !x.categoryId)?.targetPct,
      }) as string | null,
    ]),
  );
}

// Writes a cost row for every item whose cost or price moved; flags dishes that fell under
// target (by more than the tolerance) with a suggested price for a manager to approve.
export async function recost(ctx: Ctx, tx: Tx, menuItemIds: string[], reason: string) {
  if (!menuItemIds.length) return [];
  const items = await tx.select().from(t.menuItem).where(inArray(t.menuItem.id, menuItemIds));
  const costs = await costOf(tx, menuItemIds);
  const targets = await targetsFor(tx, items);
  const last = new Map(
    (await tx.selectDistinctOn([t.menuItemCost.menuItemId]).from(t.menuItemCost).where(inArray(t.menuItemCost.menuItemId, menuItemIds)).orderBy(t.menuItemCost.menuItemId, desc(t.menuItemCost.calculatedAt))).map((c) => [c.menuItemId, c]),
  );
  const flagged: string[] = [];
  const tolerances = new Map<string, number>();
  for (const item of items) {
    const cost = costs.get(item.id)!;
    const m = margin(item.sellingPrice, cost);
    const prev = last.get(item.id);
    if (!prev || !dec(prev.portionCost).eq(cost) || !dec(prev.sellingPrice).eq(item.sellingPrice)) {
      await tx.insert(t.menuItemCost).values({ menuItemId: item.id, portionCost: cost, sellingPrice: item.sellingPrice, marginAmount: m.amount, marginPct: m.pct, reason });
    }
    const target = targets.get(item.id);
    if (!tolerances.has(item.outletId)) tolerances.set(item.outletId, Number((await getSettings(tx, item.outletId)).effective['pricing.flagTolerancePct']));
    if (target && dec(m.pct).lt(dec(target).minus(tolerances.get(item.outletId)!)) && dec(cost).gt(0)) {
      flagged.push(item.id);
      await queueSystemRequest(tx, {
        outletId: item.outletId, type: 'price_change', entity: 'menu_item', entityId: item.id, proposedBy: ctx.userId,
        current: { sellingPrice: item.sellingPrice, marginPct: m.pct, portionCost: cost },
        proposed: { menuItemId: item.id, sellingPrice: suggestedPrice(cost, target), summary: `${item.name}: margin ${m.pct}% is under the ${target}% target` },
        reason: `Margin fell to ${m.pct}% after ${reason}`,
      });
    }
  }
  return flagged;
}

// After a goods received note: every recipe using the received items is re-costed, then each
// outlet affected is re-ranked once the transaction commits.
export async function recostAfterReceipt(ctx: Ctx, tx: Tx, stockItemIds: string[]) {
  const affected = await tx
    .selectDistinct({ id: t.menuItem.id, outletId: t.menuItem.outletId })
    .from(t.recipeLine)
    .innerJoin(t.menuItem, eq(t.menuItem.id, t.recipeLine.menuItemId))
    .where(inArray(t.recipeLine.stockItemId, stockItemIds));
  await recost(ctx, tx, affected.map((a) => a.id), 'new purchase rates');
  for (const outletId of new Set(affected.map((a) => a.outletId))) ctx.afterCommit(() => rerankOutlet(ctx, outletId));
}

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

// ---------- Beverage offers ----------

// Runs on every beverage stock movement. Respects the owner's per-outlet switch. Offers are
// silent price changes for guests; the records keep the full story for the owner's reports.
export async function runOffers(ctx: Ctx, outletId: string, avail?: Map<string, Availability>) {
  const db = ctx.db;
  const settings = (await getSettings(db, outletId)).effective;
  const active = await db.select().from(t.activeDiscount).where(and(eq(t.activeDiscount.outletId, outletId), eq(t.activeDiscount.status, 'active')));
  const end = async (ids: string[], why: string) => {
    if (!ids.length) return;
    await db.update(t.activeDiscount).set({ status: 'ended', endedAt: new Date(), endReason: why }).where(inArray(t.activeDiscount.id, ids));
  };
  const [rule] = await db.select().from(t.priceRule).where(and(eq(t.priceRule.outletId, outletId), eq(t.priceRule.active, true))).limit(1);
  if (!settings['offers.liquorEnabled'] || !rule) {
    await end(active.map((a) => a.id), settings['offers.liquorEnabled'] ? 'no active rule' : 'offers switched off');
    if (active.length) publish(ctx.customerId, outletId, 'menu', { reason: 'offers' });
    return;
  }
  const r: OfferRule = {
    triggerServes: rule.triggerServes, discountPct: rule.discountPct, bandMinPct: rule.bandMinPct, bandMaxPct: rule.bandMaxPct,
    marginFloorPct: rule.marginFloorPct, minSubstituteServes: rule.minSubstituteServes, maxItems: rule.maxItems, releaseBufferServes: rule.releaseBufferServes,
  };
  const bev = await db
    .select({ m: t.menuItem, cat: t.category })
    .from(t.menuItem)
    .innerJoin(t.category, eq(t.category.id, t.menuItem.categoryId))
    .where(and(eq(t.menuItem.outletId, outletId), eq(t.menuItem.department, 'beverage'), eq(t.menuItem.active, true)));
  avail ??= await availability(db, outletId, bev.map((b) => b.m.id));
  const costs = await costOf(db, bev.map((b) => b.m.id));
  const serves = (id: string) => avail!.get(id)?.portions ?? null;
  // Same beverage type (or sub-type, if the rule says so) and the same serve size.
  const scopeKey = (b: (typeof bev)[number]) =>
    `${rule.matchScope === 'subtype_and_serve' ? b.cat.id : (b.cat.parentId ?? b.cat.id)}|${dec(b.m.serveSizeMl ?? 0).toString()}`;

  let changed = false;
  // Release: the low item is back above trigger + buffer, or a substitute is itself running low.
  const release = active.filter((a) => {
    const s = serves(a.triggerMenuItemId);
    return s != null && shouldRelease(s, r);
  });
  const tired = active.filter((a) => !release.includes(a) && (serves(a.menuItemId) ?? Infinity) < r.minSubstituteServes);
  await end(release.map((a) => a.id), 'restocked');
  await end(tired.map((a) => a.id), 'substitute running low');
  changed ||= release.length + tired.length > 0;

  const stillActive = active.filter((a) => !release.includes(a) && !tired.includes(a));
  const onOffer = new Set(stillActive.map((a) => a.menuItemId));
  const triggered = new Set(stillActive.map((a) => a.triggerMenuItemId));
  for (const low of bev) {
    const s = serves(low.m.id);
    if (s == null || !isLow(s, r) || triggered.has(low.m.id)) continue;
    const candidates = bev
      .filter((b) => b.m.id !== low.m.id && scopeKey(b) === scopeKey(low) && !onOffer.has(b.m.id) && serves(b.m.id) != null)
      .map((b) => ({ id: b.m.id, price: b.m.sellingPrice, serveCost: costs.get(b.m.id) ?? '0', serves: serves(b.m.id)!, excluded: b.m.offerExcluded }));
    const picked = selectOffers(low.m.sellingPrice, candidates, r);
    for (const p of picked) {
      const item = bev.find((b) => b.m.id === p.id)!;
      await db.insert(t.activeDiscount).values({
        outletId, menuItemId: p.id, priceRuleId: rule.id, triggerMenuItemId: low.m.id, discountPct: rule.discountPct,
        menuPrice: item.m.sellingPrice, offerPrice: p.offerPrice,
      });
      onOffer.add(p.id);
      changed = true;
    }
    triggered.add(low.m.id);
  }
  if (changed) publish(ctx.customerId, outletId, 'menu', { reason: 'offers' });
}

// End of the business day: every offer started before the new day began ends.
export async function endOffersForDay(ctx: Ctx, outletId: string, dayBegan = new Date()) {
  const ended = await ctx.db
    .update(t.activeDiscount)
    .set({ status: 'ended', endedAt: new Date(), endReason: 'end of day' })
    .where(and(eq(t.activeDiscount.outletId, outletId), eq(t.activeDiscount.status, 'active'), sql`${t.activeDiscount.startedAt} < ${dayBegan}`))
    .returning({ id: t.activeDiscount.id });
  if (ended.length) publish(ctx.customerId, outletId, 'menu', { reason: 'offers' });
  return ended.length;
}

// The price a new bill pays right now: the offer price when an offer is running, otherwise
// the menu price. Offers apply to bills opened after the offer started.
export async function currentOffers(q: Q, outletId: string, billOpenedAt?: Date) {
  const rows = await q
    .select()
    .from(t.activeDiscount)
    .where(
      and(
        eq(t.activeDiscount.outletId, outletId),
        eq(t.activeDiscount.status, 'active'),
        isNull(t.activeDiscount.endedAt),
        billOpenedAt ? sql`${t.activeDiscount.startedAt} <= ${billOpenedAt}` : undefined,
      ),
    );
  return new Map(rows.map((r) => [r.menuItemId, r]));
}

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

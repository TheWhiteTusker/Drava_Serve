import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { dec, isLow, selectOffers, shouldRelease, type OfferRule } from '@fnb/shared';
import { getSettings } from '../access/settings.js';
import { left, logActivity, money } from '../activity.js';
import type { Ctx } from '../common.js';
import { tenantSchema as t, type Q } from '../db/index.js';
import { publish } from '../events.js';
import { availability, type Availability } from '../stock/availability.js';
import { costOf } from './costing.js';

// ---------- Beverage offers ----------

export async function namesOf(q: Q, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await q.select({ id: t.menuItem.id, name: t.menuItem.name }).from(t.menuItem).where(inArray(t.menuItem.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// "A", "A and B", "A, B and C"
export const listOf = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

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
    if (active.length) {
      const names = await namesOf(db, active.map((a) => a.menuItemId));
      await logActivity(ctx, db, {
        outletId, kind: 'offer_ended', title: active.length === 1 ? 'Offer ended' : 'Offers ended',
        message: `${settings['offers.liquorEnabled'] ? 'The beverage offer rule was turned off' : 'Beverage offers were switched off for this outlet'}, so ${listOf(active.map((a) => `${names.get(a.menuItemId)} (back to ${money(a.menuPrice)})`))} ${active.length === 1 ? 'is' : 'are'} at the menu price again.`,
        data: { reason: settings['offers.liquorEnabled'] ? 'no active rule' : 'switched off', offers: active.map((a) => a.id) },
      });
      publish(ctx.customerId, outletId, 'menu', { reason: 'offers' });
    }
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
  const name = (id: string) => bev.find((b) => b.m.id === id)?.m.name ?? 'A drink';
  for (const triggerId of new Set(release.map((a) => a.triggerMenuItemId))) {
    const mine = release.filter((a) => a.triggerMenuItemId === triggerId);
    await logActivity(ctx, db, {
      outletId, kind: 'offer_ended', title: mine.length === 1 ? 'Offer ended' : 'Offers ended',
      message: `${name(triggerId)} was restocked${left(serves(triggerId))}, so ${listOf(mine.map((a) => `${name(a.menuItemId)} is back to ${money(a.menuPrice)}`))}.`,
      data: { reason: 'restocked', trigger: triggerId, triggerServes: serves(triggerId), offers: mine.map((a) => a.id) },
    });
  }
  for (const a of tired) {
    await logActivity(ctx, db, {
      outletId, kind: 'offer_ended', title: 'Offer ended',
      message: `${name(a.menuItemId)} is itself running low${left(serves(a.menuItemId))}, so its offer ended and it is back to ${money(a.menuPrice)}.`,
      data: { reason: 'substitute running low', offer: a.id },
    });
  }

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
    if (picked.length) {
      const items = picked.map((p) => ({ id: p.id, name: name(p.id), menuPrice: bev.find((b) => b.m.id === p.id)!.m.sellingPrice, offerPrice: p.offerPrice }));
      await logActivity(ctx, db, {
        outletId, kind: 'offer_started', title: items.length === 1 ? 'Offer started' : 'Offers started',
        message:
          items.length === 1
            ? `${low.m.name} is running low${left(s)}, so ${items[0].name} is now ${money(items[0].offerPrice)} instead of ${money(items[0].menuPrice)} (${Number(rule.discountPct)}% off).`
            : `${low.m.name} is running low${left(s)}, so ${items.length} similar drinks are ${Number(rule.discountPct)}% off: ${listOf(items.map((i) => `${i.name} ${money(i.menuPrice)} → ${money(i.offerPrice)}`))}.`,
        data: { trigger: low.m.id, triggerName: low.m.name, triggerServes: s, discountPct: rule.discountPct, items },
      });
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
    .returning({ id: t.activeDiscount.id, menuItemId: t.activeDiscount.menuItemId, menuPrice: t.activeDiscount.menuPrice });
  if (ended.length) {
    const names = await namesOf(ctx.db, ended.map((e) => e.menuItemId));
    await logActivity(ctx, ctx.db, {
      outletId, kind: 'offer_ended', title: ended.length === 1 ? 'Offer ended' : 'Offers ended',
      message: `The business day ended, so ${listOf(ended.map((e) => `${names.get(e.menuItemId)} (back to ${money(e.menuPrice)})`))} ${ended.length === 1 ? 'is' : 'are'} at the menu price again.`,
      data: { reason: 'end of day', offers: ended.map((e) => e.id) },
    });
    publish(ctx.customerId, outletId, 'menu', { reason: 'offers' });
  }
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

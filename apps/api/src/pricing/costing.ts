import { desc, eq, inArray } from 'drizzle-orm';
import { dec, margin, portionCost, resolveTarget, suggestedPrice } from '@fnb/shared';
import { getSettings } from '../access/settings.js';
import { logActivity, money } from '../activity.js';
import { queueSystemRequest } from '../approvals.js';
import type { Ctx } from '../common.js';
import { tenantSchema as t, type Q, type Tx } from '../db/index.js';
import { rerankOutlet } from './ranking.js';

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
      const created = await queueSystemRequest(tx, {
        outletId: item.outletId, type: 'price_change', entity: 'menu_item', entityId: item.id, proposedBy: ctx.userId,
        current: { sellingPrice: item.sellingPrice, marginPct: m.pct, portionCost: cost },
        proposed: { menuItemId: item.id, sellingPrice: suggestedPrice(cost, target), summary: `${item.name}: margin ${m.pct}% is under the ${target}% target` },
        reason: `Margin fell to ${m.pct}% after ${reason}`,
      });
      if (created.created) {
        await logActivity(ctx, tx, {
          outletId: item.outletId, kind: 'price_flag', title: 'Price suggestion',
          message: `${item.name}'s margin fell to ${m.pct}% (target ${Number(target)}%) after ${reason}, so a new price of ${money(suggestedPrice(cost, target))} (now ${money(item.sellingPrice)}) is waiting for a manager's approval.`,
          data: { menuItemId: item.id, marginPct: m.pct, targetPct: target, suggestedPrice: suggestedPrice(cost, target) },
        });
      }
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

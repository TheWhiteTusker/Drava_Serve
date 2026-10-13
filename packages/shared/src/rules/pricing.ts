import Decimal from 'decimal.js';
import type { Num } from '../money';
import { D, fix } from './num';
import { grossQty } from './stock';

// ---------- Costing and margins (handoff 6.10) ----------

export function portionCost(lines: { qty: Num; yieldPct: Num; unitCost: Num }[]): string {
  return fix(lines.reduce((a, l) => a.plus(grossQty(l.qty, l.yieldPct).times(l.unitCost)), D(0)), 6);
}

export function margin(priceBeforeTax: Num, cost: Num) {
  const p = D(priceBeforeTax);
  const amount = p.minus(cost);
  return { amount: fix(amount, 2), pct: p.isZero() ? '0.00' : fix(amount.div(p).times(100), 2) };
}

// Portion cost ÷ (1 − target margin), rounded up to the next whole rupee.
export function suggestedPrice(cost: Num, targetPct: Num): string {
  const t = D(targetPct).div(100);
  if (t.gte(1)) throw new Error('Target margin must be under 100%');
  return D(cost).div(D(1).minus(t)).ceil().toFixed(2);
}

// Most specific wins: item, then category, then outlet.
export const resolveTarget = (t: { item?: Num | null; category?: Num | null; outlet?: Num | null }) =>
  t.item ?? t.category ?? t.outlet ?? null;

// ---------- Menu ranking inside a course (handoff 6.10) ----------

export interface RankInput {
  id: string;
  available: boolean;
  marginPct: Num;
  units30d: Num;
  pin: number | null;
  name?: string;
}

// Pinned items first (by pin number); then available before sold out; then margin % high to
// low; ties by units sold in the last 30 days; then name, so the order is stable.
export function rankCourse(items: RankInput[]): string[] {
  return [...items]
    .sort(
      (a, b) =>
        (a.pin ?? Infinity) - (b.pin ?? Infinity) ||
        Number(b.available) - Number(a.available) ||
        D(b.marginPct).cmp(a.marginPct) ||
        D(b.units30d).cmp(a.units30d) ||
        (a.name ?? a.id).localeCompare(b.name ?? b.id),
    )
    .map((i) => i.id);
}

// ---------- Beverage offers (handoff 6.9) ----------

export interface OfferRule {
  triggerServes: number;
  discountPct: Num;
  bandMinPct: Num;
  bandMaxPct: Num;
  marginFloorPct: Num;
  minSubstituteServes: number;
  maxItems: number;
  releaseBufferServes: number;
}
export interface OfferCandidate {
  id: string;
  price: Num; // menu price before tax
  serveCost: Num;
  serves: number;
  excluded?: boolean;
}

export const isLow = (serves: number, rule: OfferRule) => serves <= rule.triggerServes;
export const shouldRelease = (serves: number, rule: OfferRule) => serves > rule.triggerServes + rule.releaseBufferServes;

export function priceBand(price: Num, rule: OfferRule) {
  return {
    min: D(price).times(D(1).plus(D(rule.bandMinPct).div(100))),
    max: D(price).times(D(1).plus(D(rule.bandMaxPct).div(100))),
  };
}

// Candidates already share the low item's type and serve size. Keep those priced inside the
// band with plenty of stock, drop any whose discounted margin falls under the floor, rank by
// margin after discount and keep the top few.
export function selectOffers(triggerPrice: Num, candidates: OfferCandidate[], rule: OfferRule) {
  const band = priceBand(triggerPrice, rule);
  const factor = D(1).minus(D(rule.discountPct).div(100));
  return candidates
    .filter((c) => !c.excluded && D(c.price).gte(band.min) && D(c.price).lte(band.max) && c.serves >= rule.minSubstituteServes)
    .map((c) => {
      const offerPrice = D(c.price).times(factor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      return { id: c.id, offerPrice: offerPrice.toFixed(2), marginAfter: margin(offerPrice, c.serveCost).pct };
    })
    .filter((c) => D(c.marginAfter).gte(rule.marginFloorPct))
    .sort((a, b) => D(b.marginAfter).cmp(a.marginAfter))
    .slice(0, rule.maxItems);
}

// ---------- Menu engineering (handoff 6.10) ----------

export type MenuClass = 'star' | 'plowhorse' | 'puzzle' | 'dog';

// High margin: margin per plate above the menu's average (total margin ÷ total plates).
// Popular: share of plates above (1 ÷ number of items) × 70%.
export function menuEngineering(items: { id: string; units: Num; marginAmount: Num }[]) {
  const totalUnits = items.reduce((a, i) => a.plus(i.units), D(0));
  const totalMargin = items.reduce((a, i) => a.plus(D(i.marginAmount).times(i.units)), D(0));
  const avgMargin = totalUnits.isZero() ? D(0) : totalMargin.div(totalUnits);
  const popularShare = items.length ? D(1).div(items.length).times(0.7) : D(0);
  return items.map((i) => {
    const share = totalUnits.isZero() ? D(0) : D(i.units).div(totalUnits);
    const high = D(i.marginAmount).gt(avgMargin);
    const popular = share.gt(popularShare);
    const cls: MenuClass = high ? (popular ? 'star' : 'puzzle') : popular ? 'plowhorse' : 'dog';
    return { id: i.id, share: fix(share.times(100), 2), high, popular, class: cls, avgMargin: fix(avgMargin, 2) };
  });
}

// Pour cost: cost of liquor used ÷ liquor sales (bars typically aim for about 20%).
export const pourCostPct = (liquorCost: Num, liquorSales: Num) =>
  D(liquorSales).isZero() ? '0.00' : fix(D(liquorCost).div(liquorSales).times(100), 2);

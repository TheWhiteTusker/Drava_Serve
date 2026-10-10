import Decimal from 'decimal.js';
import { dec, type Num } from './money';
import { TIME_ZONE } from './constants';

// Every rule with a number in it lives here as a plain function, so the API, the POS and the
// tests all use the same arithmetic. Inputs and outputs are decimals as strings.

const D = (v: Num) => dec(v);
const fix = (d: Decimal, places: number) => d.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);

// ---------- Stock balance and weighted average cost (handoff 6.7, 6.10) ----------

export interface Balance {
  qty: string;
  avgCost: string;
}

// Receipts move the weighted average; issues leave it alone. A negative balance (shortfall
// from offline bills) does not drag the average: new stock is averaged only with stock on hand.
export function applyMovement(bal: Balance, qty: Num, unitCost: Num): Balance {
  const q = D(qty);
  const next = D(bal.qty).plus(q);
  if (q.lte(0)) return { qty: fix(next, 3), avgCost: bal.avgCost };
  const onHand = Decimal.max(D(bal.qty), 0);
  const avg = onHand.plus(q).isZero() ? D(unitCost) : onHand.times(bal.avgCost).plus(q.times(unitCost)).div(onHand.plus(q));
  return { qty: fix(next, 3), avgCost: fix(avg, 6) };
}

// ---------- Earliest expiry first ----------

export interface Lot {
  id: string;
  remaining: string;
  expiresOn: string | null;
  receivedOn: string;
}

// Splits an issue across lots, earliest expiry first (no expiry last, then oldest receipt).
// Anything the lots cannot cover comes back with lotId null: a shortfall, still recorded.
export function fefoSplit(lots: Lot[], need: Num): { lotId: string | null; qty: string }[] {
  const order = [...lots]
    .filter((l) => D(l.remaining).gt(0))
    .sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999') || a.receivedOn.localeCompare(b.receivedOn));
  let left = D(need);
  const out: { lotId: string | null; qty: string }[] = [];
  for (const l of order) {
    if (left.lte(0)) break;
    const take = Decimal.min(left, l.remaining);
    out.push({ lotId: l.id, qty: fix(take, 3) });
    left = left.minus(take);
  }
  if (left.gt(0)) out.push({ lotId: null, qty: fix(left, 3) });
  return out;
}

// ---------- Recipes, availability and status ----------

// Recipe quantity is what ends up in the dish; yield % says how much of what is drawn
// from stock survives preparation. 250 g at 80% yield draws 312.5 g.
export const grossQty = (qty: Num, yieldPct: Num = 100) => D(qty).div(D(yieldPct).div(100));

// Portions current stock can still make: the smallest stock ÷ recipe quantity across ingredients.
export function portionsAvailable(lines: { perPortion: Num; free: Num }[]): number {
  if (!lines.length) return 0;
  return Math.max(0, Math.min(...lines.map((l) => D(l.free).div(l.perPortion).floor().toNumber())));
}

export type StockStatus = 'healthy' | 'reorder' | 'critical' | 'out';
export function stockStatus(qty: Num, levels: { reorderLevel: Num; criticalLevel: Num }): StockStatus {
  const q = D(qty);
  if (q.lte(0)) return 'out';
  if (q.lte(levels.criticalLevel)) return 'critical';
  if (q.lte(levels.reorderLevel)) return 'reorder';
  return 'healthy';
}

export type MenuStatus = 'available' | 'low' | 'out';
export const menuStatus = (portions: number, lowThreshold: number): MenuStatus =>
  portions <= 0 ? 'out' : portions <= lowThreshold ? 'low' : 'available';

// ---------- Nightly indent (handoff 6.8) ----------

// par − on hand − on order, in base units, converted to purchase units and rounded up to the pack.
export function indentQuantity(i: { par: Num; onHand: Num; onOrder: Num; unitFactor: Num; packSize: Num }): string {
  const short = D(i.par).minus(i.onHand).minus(i.onOrder);
  if (short.lte(0)) return '0';
  const units = short.div(i.unitFactor);
  const pack = D(i.packSize).gt(0) ? D(i.packSize) : D(1);
  return units.div(pack).ceil().times(pack).toString();
}

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

// ---------- Business day ----------

// A business day runs from dayStart (India time) to dayStart the next day, so a bar bill paid
// at 1:30 am belongs to the evening before.
export function businessDate(at: Date, dayStart = '05:00'): string {
  const [h, m] = dayStart.split(':').map(Number);
  const shifted = new Date(at.getTime() - (h * 60 + m) * 60_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(shifted);
}

// Hour of the day (0–23) in India time.
export const istHour = (at: Date) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hour12: false }).format(at)) % 24;

export const istDate = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(at);

export const istTime = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);

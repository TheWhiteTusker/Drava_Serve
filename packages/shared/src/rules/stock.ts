import Decimal from 'decimal.js';
import type { Num } from '../money';
import { D, fix } from './num';

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

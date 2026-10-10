import { ConflictException, Logger } from '@nestjs/common';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  applyMovement, dec, fefoSplit, grossQty, istDate, menuStatus, portionsAvailable, SETTING_DEFAULTS,
  type MenuStatus, type MovementType, type Num,
} from '@fnb/shared';
import type { Ctx } from './common.js';
import { tenantSchema as t, type Q, type Tx } from './db/index.js';
import { publish } from './events.js';
import { rerankOutlet, runOffers } from './pricing.js';

// The only way stock changes. Every movement is a ledger row; the balance row is locked,
// updated and written in the same transaction, so two counters can never both take the last
// portion, and the balance always equals the sum of the ledger.

export interface Move {
  storeId: string;
  stockItemId: string;
  qty: Num; // signed, base units
  movement: MovementType;
  unitCost?: Num; // receipts: the billed rate per base unit; others use the average cost
  reason?: string | null;
  refType?: string;
  refId?: string;
  expiresOn?: string | null; // receipts of perishables
  lotId?: string | null; // force a lot (reversals); otherwise earliest expiry first
  reversesId?: number;
  approvalId?: string;
  at?: Date;
}
export interface Changed {
  outletId: string;
  storeId: string;
  stockItemId: string;
  qty: string;
}
export type Post = (moves: Move[], opts?: { allowNegative?: boolean }) => Promise<{ changed: Changed[]; rows: (typeof t.stockLedger.$inferSelect)[] }>;

const RECEIVING: MovementType[] = ['goods_receipt', 'transfer_in', 'opening'];

export async function postMoves(tx: Tx, ctx: Pick<Ctx, 'userId' | 'deviceId'>, moves: Move[], opts: { allowNegative?: boolean } = {}) {
  if (!moves.length) return { changed: [], rows: [] };
  const key = (m: { storeId: string; stockItemId: string }) => `${m.storeId}|${m.stockItemId}`;
  const pairs = [...new Map(moves.map((m) => [key(m), m])).values()].sort((a, b) => key(a).localeCompare(key(b)));

  // Lock every balance row this posting touches, always in the same order (no deadlocks).
  for (const p of pairs) {
    await tx.insert(t.stockBalance).values({ storeId: p.storeId, stockItemId: p.stockItemId }).onConflictDoNothing();
  }
  const locked = await tx
    .select()
    .from(t.stockBalance)
    .where(or(...pairs.map((p) => and(eq(t.stockBalance.storeId, p.storeId), eq(t.stockBalance.stockItemId, p.stockItemId)))))
    .orderBy(t.stockBalance.storeId, t.stockBalance.stockItemId)
    .for('update');
  const bal = new Map(locked.map((b) => [key(b), { qty: b.qty, avgCost: b.avgCost }]));
  const items = new Map(
    (await tx.select().from(t.stockItem).where(inArray(t.stockItem.id, [...new Set(moves.map((m) => m.stockItemId))]))).map((i) => [i.id, i]),
  );
  const stores = new Map(
    (await tx.select().from(t.store).where(inArray(t.store.id, [...new Set(moves.map((m) => m.storeId))]))).map((s) => [s.id, s]),
  );

  const rows: (typeof t.stockLedger.$inferSelect)[] = [];
  for (const m of moves) {
    const item = items.get(m.stockItemId)!;
    const store = stores.get(m.storeId)!;
    const b = bal.get(key(m))!;
    const q = dec(m.qty);
    const avg = dec(b.avgCost).gt(0) ? b.avgCost : item.currentCost;
    const cost = String(q.gt(0) && m.unitCost != null ? m.unitCost : avg);

    const next = applyMovement(b, q, cost);
    if (!opts.allowNegative && q.lt(0) && dec(next.qty).lt(0)) {
      throw new ConflictException(`Not enough ${item.name} in ${store.name}: ${dec(b.qty).toString()} ${item.baseUnit} left`);
    }

    // Which lot(s) the movement touches.
    let parts: { lotId: string | null; qty: string }[] = [{ lotId: m.lotId ?? null, qty: q.toString() }];
    if (item.perishable && m.lotId === undefined) {
      if (q.gt(0) && RECEIVING.includes(m.movement)) {
        const today = istDate(new Date());
        const expires = m.expiresOn ?? (item.shelfLifeDays ? istDate(new Date(Date.now() + item.shelfLifeDays * 86_400_000)) : null);
        const [lot] = await tx.insert(t.stockLot).values({ stockItemId: item.id, storeId: store.id, receivedOn: today, expiresOn: expires }).returning();
        parts = [{ lotId: lot.id, qty: q.toString() }];
      } else if (q.lt(0)) {
        const lots = await lotsOf(tx, store.id, item.id);
        // Stock that predates lot tracking (opening balances) is issued as one lot with no expiry.
        const tracked = lots.reduce((a, l) => a.plus(l.remaining), dec(0));
        const untracked = dec(b.qty).minus(tracked);
        if (untracked.gt(0)) lots.push({ id: '', remaining: untracked.toString(), expiresOn: null, receivedOn: '0000-00-00' });
        parts = fefoSplit(lots, q.neg()).map((p) => ({ lotId: p.lotId || null, qty: dec(p.qty).neg().toString() }));
      }
    }
    for (const p of parts) {
      const [row] = await tx
        .insert(t.stockLedger)
        .values({
          outletId: store.outletId, storeId: store.id, stockItemId: item.id, lotId: p.lotId, qty: p.qty, unitCost: cost,
          movement: m.movement, reason: m.reason ?? null, refType: m.refType, refId: m.refId, reversesId: m.reversesId,
          approvalId: m.approvalId, userId: ctx.userId, deviceId: ctx.deviceId, at: m.at,
        })
        .returning();
      rows.push(row);
    }
    bal.set(key(m), next);
  }

  const changed: Changed[] = [];
  for (const p of pairs) {
    const b = bal.get(key(p))!;
    await tx
      .update(t.stockBalance)
      .set({ qty: b.qty, avgCost: b.avgCost, updatedAt: new Date() })
      .where(and(eq(t.stockBalance.storeId, p.storeId), eq(t.stockBalance.stockItemId, p.stockItemId)));
    changed.push({ outletId: stores.get(p.storeId)!.outletId, storeId: p.storeId, stockItemId: p.stockItemId, qty: b.qty });
  }
  return { changed, rows };
}

async function lotsOf(q: Q, storeId: string, stockItemId: string) {
  const r = await q.execute(sql`
    select l.id, l.expires_on, l.received_on, coalesce(sum(g.qty), 0) as remaining
    from stock_lot l left join stock_ledger g on g.lot_id = l.id
    where l.store_id = ${storeId} and l.stock_item_id = ${stockItemId}
    group by l.id having coalesce(sum(g.qty), 0) > 0`);
  return r.rows.map((x: any) => ({ id: x.id, remaining: String(x.remaining), expiresOn: x.expires_on, receivedOn: x.received_on }));
}

// Runs a transaction that may post stock, then pushes availability updates once it has committed.
export async function stockTx<T>(ctx: Ctx, fn: (tx: Tx, post: Post) => Promise<T>): Promise<T> {
  const changed: Changed[] = [];
  const result = await ctx.tx((tx) =>
    fn(tx, async (moves, opts) => {
      const r = await postMoves(tx, ctx, moves, opts);
      changed.push(...r.changed);
      return r;
    }),
  );
  if (changed.length) await afterStock(ctx, changed).catch((e) => new Logger('Stock').error(e));
  return result;
}

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
  publish(ctx.customerId, outletId, 'availability', {
    items: [...avail].map(([menuItemId, a]) => ({ menuItemId, portions: a.portions, status: a.status })),
  });
  return { flipped, avail };
}

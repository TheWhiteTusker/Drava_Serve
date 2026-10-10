import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { dec, stockStatus, zQty } from '@fnb/shared';
import { z } from 'zod';
import { getSettings } from './access.controller.js';
import { proposeOrApply, registerApproval } from './approvals.js';
import { C, Ctx, findOr404, parse, Permit } from './common.js';
import { tenantSchema as t, type Q } from './db/index.js';
import { availability, stockTx } from './stock.js';

const zId = z.uuid();
const WRITE_OFFS = ['wastage', 'spillage', 'breakage'] as const;
const GIVEAWAYS = ['complimentary', 'staff_meal'] as const;

async function storeOf(q: Q, storeId: string) {
  return findOr404(q.select().from(t.store).where(eq(t.store.id, storeId)));
}

// ---------- Approval handlers ----------

// proposed: { storeId, stockItemId, qty (positive), movement, reason }
registerApproval('stock_out', 'Wastage, spillage, breakage, complimentary or staff meal', async (ctx, _tx, req, post) => {
  const p = req.proposed as any;
  await post([{ storeId: p.storeId, stockItemId: p.stockItemId, qty: dec(p.qty).neg().toString(), movement: p.movement, reason: p.reason, refType: 'approval', refId: req.id, approvalId: req.id }]);
});

// proposed: { ledgerId, reason }
registerApproval('stock_reversal', 'Reverse a stock entry', async (_ctx, tx, req, post) => {
  const p = req.proposed as any;
  const [row] = await tx.select().from(t.stockLedger).where(eq(t.stockLedger.id, p.ledgerId));
  const [already] = await tx.select({ id: t.stockLedger.id }).from(t.stockLedger).where(eq(t.stockLedger.reversesId, p.ledgerId));
  if (already) throw new ConflictException('This entry has already been reversed');
  await post(
    [{ storeId: row.storeId, stockItemId: row.stockItemId, qty: dec(row.qty).neg().toString(), unitCost: row.unitCost, lotId: row.lotId, movement: 'reversal', reason: p.reason, reversesId: row.id, refType: 'approval', refId: req.id, approvalId: req.id }],
    { allowNegative: true },
  );
});

// proposed: { countId }. Posts counted − expected for every counted line.
registerApproval('count_correction', 'Stock count correction', async (_ctx, tx, req, post) => {
  const { countId } = req.proposed as any;
  const count = await findOr404(tx.select().from(t.stockCount).where(eq(t.stockCount.id, countId)));
  const lines = await tx.select().from(t.stockCountLine).where(eq(t.stockCountLine.countId, countId));
  await post(
    lines
      .filter((l) => l.countedQty != null && !dec(l.countedQty).eq(l.expectedQty))
      .map((l) => ({
        storeId: count.storeId, stockItemId: l.stockItemId, qty: dec(l.countedQty!).minus(l.expectedQty).toString(),
        movement: 'count_correction' as const, reason: l.cause ?? 'Stock count', refType: 'stock_count', refId: countId, approvalId: req.id,
      })),
    { allowNegative: true },
  );
  await tx.update(t.stockCount).set({ status: 'approved', approvalId: req.id, updatedAt: new Date() }).where(eq(t.stockCount.id, countId));
});

// ---------- Controller ----------

@Controller('inventory')
export class InventoryController {
  // Stock on hand for an outlet: each store, the outlet total, value at average cost and status.
  @Get('stock')
  async stock(@C() ctx: Ctx, @Query('outletId') outletId: string, @Query('department') department?: string) {
    ctx.assert('inventory.view', outletId);
    const stores = await ctx.db.select().from(t.store).where(eq(t.store.outletId, outletId)).orderBy(t.store.kind);
    const items = await ctx.db
      .select()
      .from(t.stockItem)
      .where(and(eq(t.stockItem.active, true), department ? eq(t.stockItem.department, department as any) : undefined))
      .orderBy(t.stockItem.department, t.stockItem.name);
    const balances = await ctx.db.select().from(t.stockBalance).where(inArray(t.stockBalance.storeId, stores.map((s) => s.id)));
    const levels = await ctx.db.select().from(t.stockLevel).where(eq(t.stockLevel.outletId, outletId));
    const showCost = ctx.can('rates.view', outletId);
    return {
      stores,
      items: items.map((i) => {
        const mine = balances.filter((b) => b.stockItemId === i.id);
        const total = mine.reduce((a, b) => a.plus(b.qty), dec(0));
        const value = mine.reduce((a, b) => a.plus(dec(b.qty).times(b.avgCost)), dec(0));
        const lv = levels.find((l) => l.stockItemId === i.id);
        return {
          id: i.id, name: i.name, department: i.department, baseUnit: i.baseUnit, bottleSizeMl: i.bottleSizeMl, perishable: i.perishable,
          byStore: Object.fromEntries(mine.map((b) => [b.storeId, b.qty])),
          total: total.toFixed(3),
          value: showCost ? value.toFixed(2) : null,
          levels: lv ?? null,
          status: lv ? stockStatus(total, lv) : total.lte(0) ? 'out' : 'healthy',
        };
      }),
    };
  }

  @Get('ledger')
  async ledger(
    @C() ctx: Ctx,
    @Query('outletId') outletId: string,
    @Query('stockItemId') stockItemId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    ctx.assert('inventory.view', outletId);
    const rows = await ctx.db
      .select({ l: t.stockLedger, item: t.stockItem.name, unit: t.stockItem.baseUnit, store: t.store.name, user: t.appUser.name })
      .from(t.stockLedger)
      .innerJoin(t.stockItem, eq(t.stockItem.id, t.stockLedger.stockItemId))
      .innerJoin(t.store, eq(t.store.id, t.stockLedger.storeId))
      .leftJoin(t.appUser, eq(t.appUser.id, t.stockLedger.userId))
      .where(
        and(
          eq(t.stockLedger.outletId, outletId),
          stockItemId ? eq(t.stockLedger.stockItemId, stockItemId) : undefined,
          from ? gte(t.stockLedger.at, new Date(`${from}T00:00:00+05:30`)) : undefined,
          to ? lte(t.stockLedger.at, new Date(`${to}T23:59:59+05:30`)) : undefined,
        ),
      )
      .orderBy(desc(t.stockLedger.id))
      .limit(500);
    const showCost = ctx.can('rates.view', outletId);
    return rows.map((r) => ({ ...r.l, unitCost: showCost ? r.l.unitCost : null, item: r.item, unit: r.unit, store: r.store, user: r.user }));
  }

  // Wastage, spillage, breakage (reason required), complimentary or staff meal (approver required).
  @Post('movements')
  async movement(@C() ctx: Ctx, @Body() body: unknown) {
    const m = parse(
      z.object({
        storeId: zId,
        stockItemId: zId,
        qty: zQty.refine((v) => dec(v).gt(0), 'Must be more than zero'),
        movement: z.enum([...WRITE_OFFS, ...GIVEAWAYS]),
        reason: z.string().trim().min(3, 'Give a reason'),
      }),
      body,
    );
    const store = await storeOf(ctx.db, m.storeId);
    ctx.assert('inventory.wastage', store.outletId);
    // Write-offs go straight in for roles allowed to (chef, bar manager, manager); giveaways
    // always need an approver, who may be the person recording it if they can approve.
    const direct = (WRITE_OFFS as readonly string[]).includes(m.movement) && ctx.can('inventory.writeOff', store.outletId);
    return stockTx(ctx, async (tx, post) => {
      if (direct) {
        await post([{ ...m, qty: dec(m.qty).neg().toString() }]);
        return { status: 'applied' };
      }
      return proposeOrApply(ctx, tx, post, { outletId: store.outletId, type: 'stock_out', entity: 'stock_item', entityId: m.stockItemId, proposed: m, reason: m.reason });
    });
  }

  @Post('reversals')
  async reverse(@C() ctx: Ctx, @Body() body: unknown) {
    const { ledgerId, reason } = parse(z.object({ ledgerId: z.number().int(), reason: z.string().trim().min(3) }), body);
    const row = await findOr404(ctx.db.select().from(t.stockLedger).where(eq(t.stockLedger.id, ledgerId)));
    ctx.assert('inventory.wastage', row.outletId);
    if (row.movement === 'sale' || row.movement === 'reversal') throw new BadRequestException('Sales are reversed by cancelling the bill; reversals cannot be reversed');
    return stockTx(ctx, (tx, post) =>
      proposeOrApply(ctx, tx, post, { outletId: row.outletId, type: 'stock_reversal', entity: 'stock_ledger', entityId: String(ledgerId), current: row, proposed: { ledgerId, reason }, reason }),
    );
  }

  // ---------- Transfers ----------

  @Post('transfers')
  async transfer(@C() ctx: Ctx, @Body() body: unknown) {
    const x = parse(
      z.object({
        fromStoreId: zId,
        toStoreId: zId,
        note: z.string().max(500).optional(),
        lines: z.array(z.object({ stockItemId: zId, qty: zQty.refine((v) => dec(v).gt(0), 'Must be more than zero') })).min(1),
      }),
      body,
    );
    const [from, to] = [await storeOf(ctx.db, x.fromStoreId), await storeOf(ctx.db, x.toStoreId)];
    if (from.outletId !== to.outletId) throw new BadRequestException('Transfers stay inside one outlet');
    if (from.id === to.id) throw new BadRequestException('Choose two different stores');
    ctx.assert('inventory.transfer', from.outletId);
    return stockTx(ctx, async (tx, post) => {
      const [tr] = await tx.insert(t.stockTransfer).values({ outletId: from.outletId, fromStoreId: from.id, toStoreId: to.id, note: x.note, createdBy: ctx.userId! }).returning();
      const out = await post(x.lines.map((l) => ({ storeId: from.id, stockItemId: l.stockItemId, qty: dec(l.qty).neg().toString(), movement: 'transfer_out' as const, refType: 'transfer', refId: tr.id })));
      // Stock arrives at the same cost and, for perishables, keeps its expiry date.
      const lotIds = out.rows.map((r) => r.lotId).filter(Boolean) as string[];
      const lots = new Map(
        (lotIds.length ? await tx.select().from(t.stockLot).where(inArray(t.stockLot.id, lotIds)) : []).map((l) => [l.id, l.expiresOn]),
      );
      await post(
        out.rows.map((r) => ({
          storeId: to.id, stockItemId: r.stockItemId, qty: dec(r.qty).neg().toString(), unitCost: r.unitCost, movement: 'transfer_in' as const,
          expiresOn: r.lotId ? (lots.get(r.lotId) ?? null) : null, refType: 'transfer', refId: tr.id,
        })),
      );
      return tr;
    });
  }

  @Get('transfers')
  async transfers(@C() ctx: Ctx, @Query('outletId') outletId: string) {
    ctx.assert('inventory.view', outletId);
    const rows = await ctx.db
      .select({ tr: t.stockTransfer, by: t.appUser.name })
      .from(t.stockTransfer)
      .innerJoin(t.appUser, eq(t.appUser.id, t.stockTransfer.createdBy))
      .where(eq(t.stockTransfer.outletId, outletId))
      .orderBy(desc(t.stockTransfer.createdAt))
      .limit(100);
    const lines = rows.length
      ? await ctx.db
          .select({ refId: t.stockLedger.refId, item: t.stockItem.name, unit: t.stockItem.baseUnit, qty: t.stockLedger.qty })
          .from(t.stockLedger)
          .innerJoin(t.stockItem, eq(t.stockItem.id, t.stockLedger.stockItemId))
          .where(and(eq(t.stockLedger.refType, 'transfer'), eq(t.stockLedger.movement, 'transfer_in'), inArray(t.stockLedger.refId, rows.map((r) => r.tr.id))))
      : [];
    return rows.map((r) => ({ ...r.tr, by: r.by, lines: lines.filter((l) => l.refId === r.tr.id) }));
  }

  // ---------- Stock counts ----------

  @Post('counts')
  async scheduleCount(@C() ctx: Ctx, @Body() body: unknown) {
    const x = parse(z.object({ storeId: zId, scheduledFor: z.iso.date() }), body);
    const store = await storeOf(ctx.db, x.storeId);
    ctx.assert('inventory.count', store.outletId);
    return ctx.tx(async (tx) => (await tx.insert(t.stockCount).values({ outletId: store.outletId, storeId: store.id, scheduledFor: x.scheduledFor }).returning())[0]);
  }

  @Get('counts')
  async counts(@C() ctx: Ctx, @Query('outletId') outletId: string) {
    ctx.assert('inventory.view', outletId);
    return ctx.db
      .select({ c: t.stockCount, store: t.store.name })
      .from(t.stockCount)
      .innerJoin(t.store, eq(t.store.id, t.stockCount.storeId))
      .where(eq(t.stockCount.outletId, outletId))
      .orderBy(desc(t.stockCount.scheduledFor))
      .then((r) => r.map((x) => ({ ...x.c, store: x.store })));
  }

  // Starting a count snapshots what the books say is in the store right now.
  @Post('counts/:id/start')
  async startCount(@C() ctx: Ctx, @Param('id') id: string) {
    const count = await findOr404(ctx.db.select().from(t.stockCount).where(eq(t.stockCount.id, id)));
    ctx.assert('inventory.count', count.outletId);
    if (count.status !== 'scheduled') throw new ConflictException('This count has already started');
    await ctx.tx(async (tx) => {
      const bal = await tx.select().from(t.stockBalance).where(eq(t.stockBalance.storeId, count.storeId));
      const items = await tx.select({ id: t.stockItem.id }).from(t.stockItem).where(eq(t.stockItem.active, true));
      const ids = new Set([...bal.filter((b) => !dec(b.qty).isZero()).map((b) => b.stockItemId)]);
      const levels = await tx.select().from(t.stockLevel).where(eq(t.stockLevel.outletId, count.outletId));
      levels.forEach((l) => items.some((i) => i.id === l.stockItemId) && ids.add(l.stockItemId));
      if (ids.size) {
        await tx.insert(t.stockCountLine).values([...ids].map((stockItemId) => ({ countId: id, stockItemId, expectedQty: bal.find((b) => b.stockItemId === stockItemId)?.qty ?? '0' })));
      }
      await tx.update(t.stockCount).set({ status: 'counting', updatedAt: new Date() }).where(eq(t.stockCount.id, id));
    });
    return this.count(ctx, id);
  }

  // Count with variance by item and cause, valued at average cost.
  @Get('counts/:id')
  async count(@C() ctx: Ctx, @Param('id') id: string) {
    const count = await findOr404(ctx.db.select().from(t.stockCount).where(eq(t.stockCount.id, id)));
    ctx.assert('inventory.view', count.outletId);
    const lines = await ctx.db
      .select({ l: t.stockCountLine, name: t.stockItem.name, unit: t.stockItem.baseUnit, avgCost: t.stockBalance.avgCost })
      .from(t.stockCountLine)
      .innerJoin(t.stockItem, eq(t.stockItem.id, t.stockCountLine.stockItemId))
      .leftJoin(t.stockBalance, and(eq(t.stockBalance.stockItemId, t.stockCountLine.stockItemId), eq(t.stockBalance.storeId, count.storeId)))
      .where(eq(t.stockCountLine.countId, id))
      .orderBy(t.stockItem.name);
    const showCost = ctx.can('rates.view', count.outletId);
    return {
      ...count,
      lines: lines.map(({ l, name, unit, avgCost }) => {
        const variance = l.countedQty == null ? null : dec(l.countedQty).minus(l.expectedQty);
        return { ...l, name, unit, variance: variance?.toFixed(3) ?? null, varianceValue: showCost && variance ? variance.times(avgCost ?? 0).toFixed(2) : null };
      }),
    };
  }

  @Put('counts/:id/lines')
  async enterCount(@C() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const lines = parse(z.array(z.object({ stockItemId: zId, countedQty: zQty.nullable(), cause: z.string().max(200).nullish() })), body);
    const count = await findOr404(ctx.db.select().from(t.stockCount).where(eq(t.stockCount.id, id)));
    ctx.assert('inventory.count', count.outletId);
    if (count.status !== 'counting') throw new ConflictException('Start the count first; a submitted count cannot be changed');
    await ctx.tx(async (tx) => {
      for (const l of lines) {
        // An item found on the shelf that was not on the count sheet gets a line, expecting what the books say now.
        const [bal] = await tx
          .select({ qty: t.stockBalance.qty })
          .from(t.stockBalance)
          .where(and(eq(t.stockBalance.storeId, count.storeId), eq(t.stockBalance.stockItemId, l.stockItemId)));
        await tx
          .insert(t.stockCountLine)
          .values({ countId: id, stockItemId: l.stockItemId, expectedQty: bal?.qty ?? '0', countedQty: l.countedQty, cause: l.cause ?? null })
          .onConflictDoUpdate({
            target: [t.stockCountLine.countId, t.stockCountLine.stockItemId],
            set: { countedQty: l.countedQty, cause: l.cause ?? null },
          });
      }
    });
    return this.count(ctx, id);
  }

  // Corrections are always approved by a manager (directly if the counter is one).
  @Post('counts/:id/submit')
  async submitCount(@C() ctx: Ctx, @Param('id') id: string) {
    const count = await findOr404(ctx.db.select().from(t.stockCount).where(eq(t.stockCount.id, id)));
    ctx.assert('inventory.count', count.outletId);
    if (count.status !== 'counting') throw new ConflictException('This count is not open');
    return stockTx(ctx, async (tx, post) => {
      await tx.update(t.stockCount).set({ status: 'submitted', submittedBy: ctx.userId, submittedAt: new Date(), updatedAt: new Date() }).where(eq(t.stockCount.id, id));
      return proposeOrApply(ctx, tx, post, { outletId: count.outletId, type: 'count_correction', entity: 'stock_count', entityId: id, proposed: { countId: id }, reason: 'Stock count variance' });
    });
  }

  // Portions each menu item can still make, with its status (available, low, out).
  @Get('availability')
  async availability(@C() ctx: Ctx, @Query('outletId') outletId: string) {
    if (!ctx.can('pos.bill', outletId)) ctx.assert('catalog.view', outletId);
    const a = await availability(ctx.db, outletId);
    return [...a].map(([menuItemId, x]) => ({ menuItemId, ...x }));
  }

  // ---------- Liquor register ----------

  @Get('liquor-register')
  @Permit('inventory.view')
  async liquorRegister(@C() ctx: Ctx, @Query('outletId') outletId: string, @Query('date') date: string) {
    ctx.assert('inventory.view', outletId);
    return liquorRegister(ctx.db, outletId, parse(z.iso.date(), date));
  }
}

// Daily per-label register: opening, receipts, sales, other movements and closing, in ml and
// in bottles. One business day runs from the business day start (default 05:00) to the next.
export async function liquorRegister(q: Q, outletId: string, date: string) {
  const dayStart = (await getSettings(q, outletId)).effective['business.dayStart'] as string;
  const r = await q.execute(sql`
    with l as (
      select stock_item_id, qty, movement, (at - ${dayStart}::interval)::date as d
      from stock_ledger where outlet_id = ${outletId}
    )
    select s.id, s.name, s.bottle_size_ml, s.abv_pct, b.name as brand, c.name as category, p.name as type,
      coalesce(sum(l.qty) filter (where l.d < ${date}::date), 0) as opening,
      coalesce(sum(l.qty) filter (where l.d = ${date}::date and l.movement in ('goods_receipt', 'opening')), 0) as receipts,
      coalesce(-sum(l.qty) filter (where l.d = ${date}::date and l.movement = 'sale'), 0) as sales,
      coalesce(sum(l.qty) filter (where l.d = ${date}::date and l.movement not in ('goods_receipt', 'opening', 'sale', 'transfer_in', 'transfer_out')), 0) as other,
      coalesce(sum(l.qty) filter (where l.d <= ${date}::date), 0) as closing
    from stock_item s
    left join l on l.stock_item_id = s.id
    left join brand b on b.id = s.brand_id
    left join category c on c.id = s.category_id
    left join category p on p.id = c.parent_id
    where s.department = 'beverage' and s.abv_pct > 0
    group by s.id, b.name, c.name, p.name
    order by coalesce(p.name, c.name), b.name, s.name`);
  const bottles = (ml: string, size: string | null) => (size ? dec(ml).div(size).toDecimalPlaces(2).toFixed(2) : null);
  return {
    outletId,
    date,
    dayStart,
    rows: r.rows.map((x: any) => {
      const row = { opening: String(x.opening), receipts: String(x.receipts), sales: String(x.sales), other: String(x.other), closing: String(x.closing) };
      return {
        stockItemId: x.id, name: x.name, brand: x.brand, type: x.type ?? x.category, subtype: x.type ? x.category : null,
        bottleSizeMl: x.bottle_size_ml, abvPct: x.abv_pct, ml: row,
        bottles: Object.fromEntries(Object.entries(row).map(([k, v]) => [k, bottles(v, x.bottle_size_ml)])),
      };
    }),
  };
}

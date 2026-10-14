import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { dec, stockStatus, zQty } from '@fnb/shared';
import { z } from 'zod';
import { proposeOrApply } from '../approvals.js';
import { C, Ctx, findOr404, parse } from '../common.js';
import { tenantSchema as t } from '../db/index.js';
import { stockTx } from '../stock/ledger.js';
import { GIVEAWAYS, WRITE_OFFS, storeOf, zId } from './approvals.js';

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
}

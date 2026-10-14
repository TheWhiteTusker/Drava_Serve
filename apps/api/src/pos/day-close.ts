import { Body, ConflictException, Controller, Get, Post, Query } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { dec, rupees, zMoney } from '@fnb/shared';
import { z } from 'zod';
import { logActivity, money } from '../activity.js';
import { C, Ctx, parse } from '../common.js';
import { tenantSchema as t, type Q } from '../db/index.js';
import { liquorRegister } from '../inventory/liquor-register.js';
import { endOffersForDay } from '../pricing/offers.js';

// ---------- Day close ----------

@Controller('pos/day-close')
export class DayCloseController {
  @Get()
  async dayPreview(@C() ctx: Ctx, @Query('outletId') outletId: string, @Query('date') date: string) {
    ctx.assert('pos.dayClose', outletId);
    const [closed] = await ctx.db.select().from(t.dayClose).where(and(eq(t.dayClose.outletId, outletId), eq(t.dayClose.businessDate, date)));
    return { closed: closed ?? null, totals: closed?.totals ?? (await dayTotals(ctx.db, outletId, date)) };
  }

  // Totals the day's sales and cash and closes the liquor register for the day.
  @Post()
  async closeDay(@C() ctx: Ctx, @Body() body: unknown) {
    const b = parse(z.object({ outletId: z.uuid(), businessDate: z.iso.date(), cashCounted: zMoney.nullish(), notes: z.string().max(500).nullish() }), body);
    ctx.assert('pos.dayClose', b.outletId);
    const totals = await dayTotals(ctx.db, b.outletId, b.businessDate);
    if (totals.openBills > 0) throw new ConflictException(`${totals.openBills} bill(s) from this day are still open. Settle or cancel them first.`);
    const register = await liquorRegister(ctx.db, b.outletId, b.businessDate);
    const full = {
      ...totals,
      cashCounted: b.cashCounted ?? null,
      cashDifference: b.cashCounted != null ? rupees(dec(b.cashCounted).minus(totals.byMode.cash ?? 0)) : null,
      liquorRegister: register.rows.map((r: any) => ({ name: r.name, closingMl: r.ml.closing, closingBottles: r.bottles.closing, salesMl: r.ml.sales })),
    };
    const [row] = await ctx.tx((tx) =>
      tx.insert(t.dayClose).values({ outletId: b.outletId, businessDate: b.businessDate, closedBy: ctx.userId!, totals: full, cashCounted: b.cashCounted ?? null, notes: b.notes ?? null }).returning(),
    );
    await logActivity(ctx, ctx.db, {
      outletId: b.outletId, kind: 'day_closed', title: 'Day closed',
      message: `${b.businessDate} was closed: ${totals.bills} bills, ${money(totals.total)} in total${full.cashDifference && Number(full.cashDifference) !== 0 ? `, cash ${Number(full.cashDifference) > 0 ? 'over' : 'short'} by ${money(Math.abs(Number(full.cashDifference)))}` : ''}.`,
      data: { businessDate: b.businessDate },
    });
    await endOffersForDay(ctx, b.outletId);
    return row;
  }
}

export async function dayTotals(q: Q, outletId: string, date: string) {
  const bills = await q.select().from(t.bill).where(and(eq(t.bill.outletId, outletId), eq(t.bill.businessDate, date)));
  const paid = bills.filter((b) => b.status === 'paid' || b.status === 'refunded');
  const sumOf = (k: 'foodSubtotal' | 'foodTax' | 'liquorSubtotal' | 'liquorTax' | 'manualDiscount' | 'roundOff' | 'total') =>
    rupees(paid.reduce((a, b) => a.plus(b[k]), dec(0)));
  const payments = paid.length ? await q.select().from(t.payment).where(inArray(t.payment.billId, paid.map((b) => b.id))) : [];
  const byMode: Record<string, string> = {};
  for (const p of payments) byMode[p.mode] = rupees(dec(byMode[p.mode] ?? 0).plus(p.amount));
  return {
    businessDate: date,
    bills: paid.length,
    openBills: bills.filter((b) => b.status === 'open').length,
    cancelled: bills.filter((b) => b.status === 'cancelled').length,
    refunded: bills.filter((b) => b.status === 'refunded').length,
    foodSales: sumOf('foodSubtotal'),
    foodTax: sumOf('foodTax'),
    liquorSales: sumOf('liquorSubtotal'),
    liquorTax: sumOf('liquorTax'),
    discounts: sumOf('manualDiscount'),
    roundOff: sumOf('roundOff'),
    total: sumOf('total'),
    byMode,
    collected: rupees(payments.reduce((a, p) => a.plus(p.amount), dec(0))),
  };
}

import { Controller, Get, Query, Res } from '@nestjs/common';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { dec, menuEngineering, pourCostPct, rupees } from '@fnb/shared';
import { z } from 'zod';
import { C, Ctx, parse } from '../common.js';
import { tenantSchema as t } from '../db/index.js';
import { liquorRegister } from '../inventory/liquor-register.js';
import { toCsv } from '../csv.js';
import { filterFor } from './filter.js';
import { dashboard } from './dashboard.js';

@Controller('reports')
export class ReportsController {
  @Get('dashboard')
  async dash(@C() ctx: Ctx, @Query() q: Record<string, string>) {
    return dashboard(ctx, await filterFor(ctx, q), { itemId: q.itemId || undefined, categoryId: q.categoryId || undefined });
  }

  // Monthly menu engineering: four groups by margin and popularity; and the bar's pour cost.
  @Get('menu-engineering')
  async menuEng(@C() ctx: Ctx, @Query() q: Record<string, string>) {
    const month = parse(z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM'), q.month);
    const from = `${month}-01`;
    const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
    const f = await filterFor(ctx, { ...q, from, to });
    const rows = (
      await ctx.db.execute(sql`
        select m.id, m.name, m.department, c.name as category, tc.kind as tax_kind, sum(s.units) as units, sum(s.revenue) as revenue, sum(s.cost) as cost
        from sales_hourly s join menu_item m on m.id = s.menu_item_id join category c on c.id = m.category_id join tax_class tc on tc.id = m.tax_class_id
        where s.outlet_id in ${f.outlets} and s.business_date between ${from}::date and ${to}::date
        group by m.id, m.name, m.department, c.name, tc.kind having sum(s.units) > 0`)
    ).rows as any[];
    const classify = (list: any[]) => {
      const cls = menuEngineering(list.map((r) => ({ id: r.id, units: r.units, marginAmount: dec(r.revenue).minus(r.cost).div(r.units).toFixed(2) })));
      return list.map((r) => ({
        id: r.id, name: r.name, category: r.category, units: Number(r.units), revenue: rupees(r.revenue),
        marginPerUnit: rupees(dec(r.revenue).minus(r.cost).div(r.units)), ...cls.find((c) => c.id === r.id),
      }));
    };
    const liquor = rows.filter((r) => r.tax_kind === 'liquor');
    const liquorCost = liquor.reduce((a, r) => a.plus(r.cost), dec(0));
    const liquorSales = liquor.reduce((a, r) => a.plus(r.revenue), dec(0));
    return {
      month,
      food: classify(rows.filter((r) => r.department === 'food')),
      beverage: classify(rows.filter((r) => r.department === 'beverage')),
      pourCost: { liquorCost: rupees(liquorCost), liquorSales: rupees(liquorSales), pct: pourCostPct(liquorCost, liquorSales), typicalTargetPct: '20' },
    };
  }

  // Reports with CSV export: day-close totals, stock variance, liquor register.
  @Get('day-close')
  async dayClose(@C() ctx: Ctx, @Query() q: Record<string, string>, @Res({ passthrough: true }) res: any) {
    const f = await filterFor(ctx, q, q.format === 'csv' ? 'reports.export' : 'reports.view');
    const rows = await ctx.db
      .select({ d: t.dayClose, outlet: t.outlet.name, by: t.appUser.name })
      .from(t.dayClose)
      .innerJoin(t.outlet, eq(t.outlet.id, t.dayClose.outletId))
      .innerJoin(t.appUser, eq(t.appUser.id, t.dayClose.closedBy))
      .where(and(inArray(t.dayClose.outletId, f.outlets), gte(t.dayClose.businessDate, f.from), lte(t.dayClose.businessDate, f.to)))
      .orderBy(t.dayClose.businessDate);
    const flat = rows.map(({ d, outlet, by }) => {
      const x = d.totals as any;
      return {
        outlet, business_date: d.businessDate, closed_by: by, bills: x.bills, food_sales: x.foodSales, food_tax: x.foodTax, liquor_sales: x.liquorSales, liquor_tax: x.liquorTax,
        discounts: x.discounts, round_off: x.roundOff, total: x.total, cash: x.byMode?.cash ?? '0.00', upi: x.byMode?.upi ?? '0.00', card: x.byMode?.card ?? '0.00',
        cash_counted: d.cashCounted, cash_difference: x.cashDifference, cancelled: x.cancelled, refunded: x.refunded,
      };
    });
    return csvOr(res, q, flat, `day-close-${f.from}-to-${f.to}.csv`);
  }

  @Get('stock-variance')
  async variance(@C() ctx: Ctx, @Query() q: Record<string, string>, @Res({ passthrough: true }) res: any) {
    const f = await filterFor(ctx, q, q.format === 'csv' ? 'reports.export' : 'reports.view');
    const rows = (
      await ctx.db.execute(sql`
        select o.name as outlet, s.name as store, c.scheduled_for as count_date, c.status, i.name as item, i.base_unit as unit,
          l.expected_qty, l.counted_qty, (l.counted_qty - l.expected_qty) as variance,
          round((l.counted_qty - l.expected_qty) * coalesce(b.avg_cost, i.current_cost), 2) as variance_value, l.cause
        from stock_count_line l join stock_count c on c.id = l.count_id join store s on s.id = c.store_id join outlet o on o.id = c.outlet_id
        join stock_item i on i.id = l.stock_item_id left join stock_balance b on b.store_id = c.store_id and b.stock_item_id = l.stock_item_id
        where c.outlet_id in ${f.outlets} and c.scheduled_for between ${f.from}::date and ${f.to}::date and l.counted_qty is not null
          and l.counted_qty <> l.expected_qty and (${f.department} = 'all' or i.department = ${f.department})
        order by c.scheduled_for, o.name, i.name`)
    ).rows as any[];
    return csvOr(res, q, rows, `stock-variance-${f.from}-to-${f.to}.csv`);
  }

  @Get('liquor-register')
  async register(@C() ctx: Ctx, @Query() q: Record<string, string>, @Res({ passthrough: true }) res: any) {
    const f = await filterFor(ctx, { ...q, to: q.to ?? q.from }, q.format === 'csv' ? 'reports.export' : 'reports.view');
    const out: any[] = [];
    for (const outletId of f.outlets) {
      const [o] = await ctx.db.select({ name: t.outlet.name }).from(t.outlet).where(eq(t.outlet.id, outletId));
      const reg = await liquorRegister(ctx.db, outletId, f.from);
      for (const r of reg.rows as any[]) {
        out.push({
          outlet: o.name, business_date: f.from, label: r.name, brand: r.brand, type: r.type, bottle_ml: r.bottleSizeMl,
          opening_bottles: r.bottles.opening, receipts_bottles: r.bottles.receipts, sales_bottles: r.bottles.sales, other_bottles: r.bottles.other, closing_bottles: r.bottles.closing,
          opening_ml: r.ml.opening, receipts_ml: r.ml.receipts, sales_ml: r.ml.sales, other_ml: r.ml.other, closing_ml: r.ml.closing,
        });
      }
    }
    return csvOr(res, q, out, `liquor-register-${f.from}.csv`);
  }
}

function csvOr(res: any, q: Record<string, string>, rows: any[], filename: string) {
  if (q.format !== 'csv') return rows;
  res.set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"` });
  return toCsv(rows);
}

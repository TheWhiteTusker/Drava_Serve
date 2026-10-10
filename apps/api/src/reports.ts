import { Controller, Get, Query, Res } from '@nestjs/common';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { dec, grossQty, istHour, menuEngineering, pourCostPct, rupees } from '@fnb/shared';
import { z } from 'zod';
import { getSettings } from './access.controller.js';
import { C, Ctx, parse } from './common.js';
import { tenantSchema as t, type Q, type Tx } from './db/index.js';
import { liquorRegister } from './inventory.controller.js';
import { toCsv } from './receiving.controller.js';
import { availability } from './stock.js';

// Dashboard and reports (handoff 6.11). Every paid bill is rolled up into hourly and daily
// summary tables in the same transaction; the dashboard reads those, never raw bills.

// ---------- Roll-up ----------

// sign = 1 when a bill is paid, −1 when a paid bill is cancelled.
export async function rollupBill(tx: Tx, bill: typeof t.bill.$inferSelect, sign: 1 | -1) {
  const lines = await tx.select().from(t.orderLine).where(and(eq(t.orderLine.billId, bill.id), eq(t.orderLine.status, 'active')));
  if (!lines.length) return;
  const keep = dec(1).minus(dec(bill.manualDiscountPct).div(100)); // revenue after any approved discount
  const liquorMl = await alcoholMlPerPortion(tx, [...new Set(lines.map((l) => l.menuItemId))]);
  const byItemHour = new Map<string, { hour: number; menuItemId: string; units: ReturnType<typeof dec>; revenue: ReturnType<typeof dec>; cost: ReturnType<typeof dec> }>();
  const byDept = new Map<string, { revenue: ReturnType<typeof dec>; cost: ReturnType<typeof dec>; ml: ReturnType<typeof dec> }>();
  for (const l of lines) {
    const hour = istHour(l.createdAt); // demand by the hour the order was given
    const key = `${hour}|${l.menuItemId}`;
    const units = dec(l.qty).times(sign);
    const revenue = dec(l.qty).times(l.priceCharged).times(keep).times(sign);
    const cost = dec(l.qty).times(l.costAtSale ?? 0).times(sign);
    const row = byItemHour.get(key) ?? { hour, menuItemId: l.menuItemId, units: dec(0), revenue: dec(0), cost: dec(0) };
    byItemHour.set(key, { ...row, units: row.units.plus(units), revenue: row.revenue.plus(revenue), cost: row.cost.plus(cost) });
    const d = byDept.get(l.department) ?? { revenue: dec(0), cost: dec(0), ml: dec(0) };
    byDept.set(l.department, { revenue: d.revenue.plus(revenue), cost: d.cost.plus(cost), ml: d.ml.plus(dec(liquorMl.get(l.menuItemId) ?? 0).times(units)) });
  }
  for (const r of byItemHour.values()) {
    await tx
      .insert(t.salesHourly)
      .values({ outletId: bill.outletId, businessDate: bill.businessDate, hour: r.hour, menuItemId: r.menuItemId, units: r.units.toFixed(3), revenue: rupees(r.revenue), cost: rupees(r.cost) })
      .onConflictDoUpdate({
        target: [t.salesHourly.outletId, t.salesHourly.businessDate, t.salesHourly.hour, t.salesHourly.menuItemId],
        set: { units: sql`${t.salesHourly.units} + excluded.units`, revenue: sql`${t.salesHourly.revenue} + excluded.revenue`, cost: sql`${t.salesHourly.cost} + excluded.cost` },
      });
  }
  for (const [department, d] of byDept) {
    await tx
      .insert(t.salesDaily)
      .values({ outletId: bill.outletId, businessDate: bill.businessDate, department: department as any, bills: sign, revenue: rupees(d.revenue), cost: rupees(d.cost), alcoholMl: d.ml.toFixed(3) })
      .onConflictDoUpdate({
        target: [t.salesDaily.outletId, t.salesDaily.businessDate, t.salesDaily.department],
        set: {
          bills: sql`${t.salesDaily.bills} + excluded.bills`, revenue: sql`${t.salesDaily.revenue} + excluded.revenue`,
          cost: sql`${t.salesDaily.cost} + excluded.cost`, alcoholMl: sql`${t.salesDaily.alcoholMl} + excluded.alcohol_ml`,
        },
      });
  }
  const minutes = bill.paidAt ? Math.max(0, Math.round((bill.paidAt.getTime() - bill.openedAt.getTime()) / 60_000)) : 0;
  const net = [...byDept.values()].reduce((a, d) => a.plus(d.revenue), dec(0));
  await tx
    .insert(t.billHourly)
    .values({ outletId: bill.outletId, businessDate: bill.businessDate, hour: istHour(bill.openedAt), bills: sign, revenue: rupees(net), minutesSpent: minutes * sign })
    .onConflictDoUpdate({
      target: [t.billHourly.outletId, t.billHourly.businessDate, t.billHourly.hour],
      set: { bills: sql`${t.billHourly.bills} + excluded.bills`, revenue: sql`${t.billHourly.revenue} + excluded.revenue`, minutesSpent: sql`${t.billHourly.minutesSpent} + excluded.minutes_spent` },
    });
}

// Millilitres of liquor (stock with alcohol %) in one portion of each menu item.
async function alcoholMlPerPortion(q: Q, menuItemIds: string[]) {
  const rows = await q
    .select({ menuItemId: t.recipeLine.menuItemId, qty: t.recipeLine.quantity, yieldPct: t.recipeLine.yieldPct })
    .from(t.recipeLine)
    .innerJoin(t.stockItem, eq(t.stockItem.id, t.recipeLine.stockItemId))
    .where(and(inArray(t.recipeLine.menuItemId, menuItemIds), sql`${t.stockItem.abvPct} > 0`, eq(t.stockItem.baseUnit, 'ml')));
  const out = new Map<string, string>();
  for (const r of rows) out.set(r.menuItemId, dec(out.get(r.menuItemId) ?? 0).plus(grossQty(r.qty, r.yieldPct)).toString());
  return out;
}

// Rebuilds the summaries from scratch (after importing history, or to repair).
export async function rebuildRollups(tx: Tx) {
  await tx.delete(t.salesHourly);
  await tx.delete(t.salesDaily);
  await tx.delete(t.billHourly);
  const bills = await tx.select().from(t.bill).where(inArray(t.bill.status, ['paid', 'refunded']));
  for (const b of bills) await rollupBill(tx, b, 1);
  return bills.length;
}

// ---------- Filters ----------

const zFilter = z.object({
  outletId: z.uuid().optional(),
  from: z.iso.date(),
  to: z.iso.date(),
  department: z.enum(['food', 'beverage', 'all']).default('all'),
});
type Filter = z.infer<typeof zFilter> & { outlets: string[] };

async function filterFor(ctx: Ctx, query: unknown, perm: 'reports.view' | 'reports.export' = 'reports.view'): Promise<Filter> {
  const f = parse(zFilter, query);
  if (f.outletId) {
    ctx.assert(perm, f.outletId);
    return { ...f, outlets: [f.outletId] };
  }
  const allowed = ctx.outletsWith(perm);
  const outlets = allowed === 'all' ? (await ctx.db.select({ id: t.outlet.id }).from(t.outlet)).map((o) => o.id) : allowed;
  if (!outlets.length) ctx.assert(perm);
  return { ...f, outlets };
}

const n = (v: unknown) => Number(v ?? 0);

// ---------- Dashboard ----------

export async function dashboard(ctx: Ctx, f: Filter, opts: { itemId?: string; categoryId?: string } = {}) {
  const db = ctx.db;
  const dept = f.department === 'all' ? sql`true` : sql`m.department = ${f.department}`;
  const range = sql`s.outlet_id in ${f.outlets} and s.business_date between ${f.from}::date and ${f.to}::date`;
  const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as any[];

  // Sales: takings before tax, bills, average bill, food / beverage split
  const daily = await rows(sql`
    select s.department, sum(s.bills)::int as bills, sum(s.revenue) as revenue, sum(s.cost) as cost, sum(s.alcohol_ml) as ml
    from sales_daily s where ${range} and (${f.department} = 'all' or s.department = ${f.department}) group by s.department`);
  const billsByHour = await rows(sql`
    select s.hour, sum(s.bills)::int as bills, sum(s.revenue) as revenue, sum(s.minutes_spent)::int as minutes
    from bill_hourly s where ${range} group by s.hour order by s.hour`);
  const totalBills = billsByHour.reduce((a, r) => a + n(r.bills), 0);
  const revenue = daily.reduce((a, r) => a.plus(r.revenue), dec(0));
  const byDept = Object.fromEntries(daily.map((r) => [r.department, { bills: n(r.bills), revenue: rupees(r.revenue), cost: rupees(r.cost) }]));

  // Margins by dish and by course, from what was actually charged
  const items = await rows(sql`
    select m.id, m.name, m.department, c.name as category, coalesce(p.name, c.name) as type, b.name as brand, tc.kind as tax_kind,
      sum(s.units) as units, sum(s.revenue) as revenue, sum(s.cost) as cost
    from sales_hourly s join menu_item m on m.id = s.menu_item_id join category c on c.id = m.category_id
    left join category p on p.id = c.parent_id left join brand b on b.id = m.brand_id join tax_class tc on tc.id = m.tax_class_id
    where ${range} and ${dept}
    group by m.id, m.name, m.department, c.name, p.name, b.name, tc.kind`);
  const withMargin = items.map((i) => {
    const r = dec(i.revenue);
    const mg = r.minus(i.cost);
    return { id: i.id, name: i.name, department: i.department, category: i.category, type: i.type, brand: i.brand, taxKind: i.tax_kind, units: n(i.units), revenue: rupees(r), cost: rupees(i.cost), marginAmount: rupees(mg), marginPct: r.isZero() ? '0.00' : mg.div(r).times(100).toFixed(2) };
  });
  const courses = [...new Set(withMargin.map((i) => i.category))].map((c) => {
    const mine = withMargin.filter((i) => i.category === c);
    const r = mine.reduce((a, i) => a.plus(i.revenue), dec(0));
    const mg = mine.reduce((a, i) => a.plus(i.marginAmount), dec(0));
    return { category: c, department: mine[0].department, revenue: rupees(r), marginAmount: rupees(mg), marginPct: r.isZero() ? '0.00' : mg.div(r).times(100).toFixed(2) };
  }).sort((a, b) => Number(b.marginPct) - Number(a.marginPct));

  // Dishes whose margin fell after an ingredient price change (latest re-costing vs the one before)
  const drops = await rows(sql`
    with c as (
      select x.*, row_number() over (partition by x.menu_item_id order by x.calculated_at desc) as rn
      from menu_item_cost x join menu_item m on m.id = x.menu_item_id
      where m.outlet_id in ${f.outlets} and ${dept}
    )
    select m.name, m.department, a.margin_pct as now_pct, b.margin_pct as before_pct, a.portion_cost as now_cost, b.portion_cost as before_cost, a.reason, a.calculated_at
    from c a join c b on b.menu_item_id = a.menu_item_id and b.rn = 2 join menu_item m on m.id = a.menu_item_id
    where a.rn = 1 and a.margin_pct < b.margin_pct and a.calculated_at::date between ${f.from}::date and ${f.to}::date
    order by a.margin_pct - b.margin_pct limit 20`);

  // Stock: value now (weighted average), wastage in the range, low and out items, deliveries waiting
  const stockValue = await rows(sql`
    select i.department, sum(b.qty * b.avg_cost) as value from stock_balance b join stock_item i on i.id = b.stock_item_id
    join store s on s.id = b.store_id where s.outlet_id in ${f.outlets} and b.qty > 0 group by i.department`);
  const wastage = await rows(sql`
    select i.department, l.movement, sum(-l.qty * l.unit_cost) as value, count(*)::int as entries
    from stock_ledger l join stock_item i on i.id = l.stock_item_id
    where l.outlet_id in ${f.outlets} and l.movement in ('wastage', 'spillage', 'breakage')
      and (l.at at time zone 'Asia/Kolkata')::date between ${f.from}::date and ${f.to}::date
      and not exists (select 1 from stock_ledger r where r.reverses_id = l.id)
    group by i.department, l.movement`);
  const lowOut: any[] = [];
  for (const outletId of f.outlets) {
    const avail = await availability(db, outletId);
    const names = await db.select({ id: t.menuItem.id, name: t.menuItem.name, department: t.menuItem.department, active: t.menuItem.active }).from(t.menuItem).where(eq(t.menuItem.outletId, outletId));
    for (const m of names) {
      const a = avail.get(m.id);
      if (m.active && a && a.status !== 'available' && (f.department === 'all' || m.department === f.department)) lowOut.push({ outletId, menuItemId: m.id, name: m.name, department: m.department, portions: a.portions, status: a.status });
    }
  }
  const awaitingGrn = await rows(sql`
    select c.id, v.name as vendor, c.expected_on, c.status, g.number, g.status as grn_status
    from receipt_check c join vendor v on v.id = c.vendor_id left join goods_received_note g on g.receipt_check_id = c.id
    where c.outlet_id in ${f.outlets} and (c.status <> 'closed' or g.status in ('awaiting_signoff', 'held_rate'))
    order by c.expected_on`);

  // Demand by weekday and hour for an item or a category (or everything)
  const target = opts.itemId ? sql`s.menu_item_id = ${opts.itemId}` : opts.categoryId ? sql`(m.category_id = ${opts.categoryId} or c.parent_id = ${opts.categoryId})` : sql`true`;
  const grid = await rows(sql`
    select extract(isodow from s.business_date)::int as weekday, s.hour, sum(s.units) as units
    from sales_hourly s join menu_item m on m.id = s.menu_item_id join category c on c.id = m.category_id
    where ${range} and ${dept} and ${target} group by 1, 2`);

  // Top sellers
  const top = (list: typeof withMargin, by: 'units' | 'revenue') => [...list].sort((a, b) => Number(b[by]) - Number(a[by])).slice(0, 10);
  const food = withMargin.filter((i) => i.department === 'food');
  const drinks = withMargin.filter((i) => i.department === 'beverage');
  const liquor = drinks.filter((i) => i.taxKind === 'liquor' && i.brand);
  const brands = [...new Set(liquor.map((i) => i.brand))].map((brand) => {
    const mine = liquor.filter((i) => i.brand === brand);
    return { brand, units: mine.reduce((a, i) => a + i.units, 0), revenue: rupees(mine.reduce((a, i) => a.plus(i.revenue), dec(0))) };
  });

  // Offers: running now, and what each one sold before and during
  const settings = (await getSettings(db, f.outlets[0])).effective;
  const dayStartHour = Number(String(settings['business.dayStart']).split(':')[0]);
  const offerRows = await rows(sql`
    select a.id, a.outlet_id, m.name as item, tr.name as trigger, a.menu_price, a.offer_price, a.discount_pct, a.started_at, a.ended_at, a.status, a.end_reason, a.menu_item_id
    from active_discount a join menu_item m on m.id = a.menu_item_id join menu_item tr on tr.id = a.trigger_menu_item_id
    where a.outlet_id in ${f.outlets} and (a.status = 'active' or a.started_at::date between ${f.from}::date and ${f.to}::date)
    order by a.started_at desc limit 50`);
  const offers = [];
  for (const o of offerRows) {
    const start = new Date(o.started_at);
    const end = o.ended_at ? new Date(o.ended_at) : new Date();
    const span = end.getTime() - start.getTime();
    // Each summary row's real clock hour: business date + hour, a day later for hours before the
    // day starts. Hourly buckets: "before" ends where the offer's starting hour begins.
    const startHour = new Date(Math.floor(start.getTime() / 3600_000) * 3600_000);
    const window = async (from: Date, to: Date, toInclusive: boolean) =>
      (
        await rows(sql`
        select coalesce(sum(units), 0) as units, coalesce(sum(revenue), 0) as revenue from sales_hourly
        where menu_item_id = ${o.menu_item_id} and outlet_id = ${o.outlet_id}
          and (business_date + make_interval(hours => hour + case when hour < ${dayStartHour} then 24 else 0 end)) at time zone 'Asia/Kolkata' >= ${from}
          and (business_date + make_interval(hours => hour + case when hour < ${dayStartHour} then 24 else 0 end)) at time zone 'Asia/Kolkata' ${toInclusive ? sql`<=` : sql`<`} ${to}`)
      )[0];
    const [before, during] = [await window(new Date(startHour.getTime() - span), startHour, false), await window(startHour, end, true)];
    offers.push({
      id: o.id, item: o.item, trigger: o.trigger, menuPrice: o.menu_price, offerPrice: o.offer_price, discountPct: o.discount_pct, startedAt: o.started_at, endedAt: o.ended_at,
      status: o.status, endReason: o.end_reason, before: { units: n(before.units), revenue: rupees(before.revenue) }, during: { units: n(during.units), revenue: rupees(during.revenue) },
    });
  }

  return {
    filter: { from: f.from, to: f.to, department: f.department, outlets: f.outlets },
    sales: {
      revenue: rupees(revenue),
      bills: totalBills,
      averageBill: totalBills ? rupees(revenue.div(totalBills)) : '0.00',
      byDepartment: byDept,
    },
    margins: { dishes: [...withMargin].sort((a, b) => Number(b.marginAmount) - Number(a.marginAmount)), courses, drops },
    stock: {
      value: Object.fromEntries(stockValue.map((r) => [r.department, rupees(r.value)])),
      wastage: wastage.map((w) => ({ department: w.department, movement: w.movement, value: rupees(w.value), entries: w.entries })),
      lowOut,
      awaitingGrn,
    },
    demand: grid.map((g) => ({ weekday: g.weekday, hour: g.hour, units: n(g.units) })),
    top: { dishesByUnits: top(food, 'units'), dishesByRevenue: top(food, 'revenue'), drinksByUnits: top(drinks, 'units'), drinksByRevenue: top(drinks, 'revenue'), brands: brands.sort((a, b) => b.units - a.units).slice(0, 10) },
    totals: {
      foodRevenue: byDept.food?.revenue ?? '0.00',
      beverageRevenue: byDept.beverage?.revenue ?? '0.00',
      plates: food.reduce((a, i) => a + i.units, 0),
      alcoholLitres: (daily.reduce((a, r) => a + n(r.ml), 0) / 1000).toFixed(2),
    },
    timeSpent: billsByHour.map((h) => ({ hour: h.hour, bills: n(h.bills), averageMinutes: n(h.bills) ? Math.round(n(h.minutes) / n(h.bills)) : 0, revenue: rupees(h.revenue) })),
    offers,
  };
}

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

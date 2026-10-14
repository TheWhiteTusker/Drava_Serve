import { eq, sql } from 'drizzle-orm';
import { dec, rupees } from '@fnb/shared';
import { getSettings } from '../access/settings.js';
import { Ctx } from '../common.js';
import { tenantSchema as t } from '../db/index.js';
import { availability } from '../stock/availability.js';
import { n, type Filter } from './filter.js';

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

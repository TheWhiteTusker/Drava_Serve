import { sql } from 'drizzle-orm';
import { dec } from '@fnb/shared';
import { getSettings } from '../access/settings.js';
import type { Q } from '../db/index.js';

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

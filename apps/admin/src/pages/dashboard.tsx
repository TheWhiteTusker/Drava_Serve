import { useState, type ReactNode } from 'react';
import { businessDate, istDate } from '@fnb/shared';
import { apiBlob, can, saveBlob, useApi, useCurrentOutlet, useSession } from '../api';
import { useLive } from '../live';
import { Badge, ErrorNote, Page, rupee } from '../ui';

// Dashboard (handoff 6.11). Every block reads the hourly and daily summary tables and follows
// the same filters: dates, outlet, Food or Beverage. Charts use the --chart-* theme tokens.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const days = (n: number) => istDate(new Date(Date.now() - n * 86_400_000));
const PRESETS: [string, () => [string, string]][] = [
  ['Today', () => [businessDate(new Date()), businessDate(new Date())]],
  ['Last 7 days', () => [days(6), businessDate(new Date())]],
  ['Last 30 days', () => [days(29), businessDate(new Date())]],
  ['This month', () => [`${businessDate(new Date()).slice(0, 8)}01`, businessDate(new Date())]],
];
const num = (v: number | string) => Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// ---------- Small chart pieces ----------

function Tip({ tip }: { tip: { x: number; y: number; text: ReactNode } | null }) {
  return tip ? (
    <div className="chart-tip" role="status" style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  ) : null;
}

// Ranked list with thin bars: one series, so no legend; the value sits in text beside it.
function BarList({ rows, label }: { rows: { name: ReactNode; value: number; display: string; key: string }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="muted">No sales in this range.</p>;
  return (
    <ol className="barlist" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <span className="barlist-name">{r.name}</span>
          <span className="barlist-track" aria-hidden>
            <span className="barlist-bar" style={{ width: `${(Math.max(0, r.value) / max) * 100}%` }} />
          </span>
          <span className="barlist-value">{r.display}</span>
        </li>
      ))}
    </ol>
  );
}

// Columns by hour of the day, with a hover / focus tooltip per column.
function HourColumns({ rows, unit, label }: { rows: { hour: number; value: number; detail: string }[]; label: string; unit: string }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: ReactNode } | null>(null);
  const hours = rows.length ? Array.from({ length: Math.max(...rows.map((r) => r.hour)) - Math.min(...rows.map((r) => r.hour)) + 1 }, (_, i) => Math.min(...rows.map((r) => r.hour)) + i) : [];
  const max = Math.max(1, ...rows.map((r) => r.value));
  const peak = rows.reduce((a, r) => (r.value > (a?.value ?? -1) ? r : a), null as (typeof rows)[number] | null);
  if (!rows.length) return <p className="muted">No bills in this range.</p>;
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <div className="columns" role="img" aria-label={label}>
        {hours.map((h) => {
          const r = rows.find((x) => x.hour === h);
          const show = (e: React.MouseEvent | React.FocusEvent) => {
            const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const host = (e.currentTarget as HTMLElement).closest('.chart')!.getBoundingClientRect();
            setTip({ x: box.left - host.left + box.width / 2, y: box.top - host.top, text: r ? `${String(h).padStart(2, '0')}:00 · ${r.detail}` : `${String(h).padStart(2, '0')}:00 · none` });
          };
          return (
            <div key={h} className="col" tabIndex={0} onMouseEnter={show} onFocus={show} onBlur={() => setTip(null)}>
              {r && r === peak && <span className="col-label">{num(r.value)}</span>}
              <span className="col-bar" style={{ height: `${((r?.value ?? 0) / max) * 100}%` }} />
              <span className="col-hour">{h}</span>
            </div>
          );
        })}
      </div>
      <p className="muted axis-note">Hour of the day · {unit}</p>
      <Tip tip={tip} />
    </div>
  );
}

// Weekday × hour grid: one hue, light to dark with the number of units.
function Heatmap({ cells }: { cells: { weekday: number; hour: number; units: number }[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: ReactNode } | null>(null);
  const [table, setTable] = useState(false);
  if (!cells.length) return <p className="muted">No sales in this range.</p>;
  const hours = Array.from({ length: Math.max(...cells.map((c) => c.hour)) - Math.min(...cells.map((c) => c.hour)) + 1 }, (_, i) => Math.min(...cells.map((c) => c.hour)) + i);
  const max = Math.max(...cells.map((c) => c.units));
  const at = (d: number, h: number) => cells.find((c) => c.weekday === d && c.hour === h)?.units ?? 0;
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <button className="ghost" onClick={() => setTable(!table)} style={{ float: 'right' }}>
        {table ? 'Show grid' : 'Show as table'}
      </button>
      {table ? (
        <div className="table-wrap" style={{ clear: 'both' }}>
          <table>
            <thead>
              <tr>
                <th>Day</th>
                {hours.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((d, i) => (
                <tr key={d}>
                  <td>{d}</td>
                  {hours.map((h) => (
                    <td key={h}>{at(i + 1, h) || ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="heat" style={{ gridTemplateColumns: `3rem repeat(${hours.length}, minmax(22px, 1fr))` }} role="img" aria-label="Units sold by weekday and hour">
          <span />
          {hours.map((h) => (
            <span key={h} className="heat-hour">
              {h}
            </span>
          ))}
          {WEEKDAYS.map((d, i) => (
            <div key={d} style={{ display: 'contents' }}>
              <span className="heat-day">{d}</span>
              {hours.map((h) => {
                const u = at(i + 1, h);
                const show = (e: React.MouseEvent | React.FocusEvent) => {
                  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const host = (e.currentTarget as HTMLElement).closest('.chart')!.getBoundingClientRect();
                  setTip({ x: box.left - host.left + box.width / 2, y: box.top - host.top, text: `${d} ${String(h).padStart(2, '0')}:00 · ${num(u)} sold` });
                };
                return (
                  <span
                    key={h}
                    className="heat-cell"
                    tabIndex={0}
                    onMouseEnter={show}
                    onFocus={show}
                    onBlur={() => setTip(null)}
                    style={{ background: u ? `color-mix(in oklab, var(--chart-seq-high) ${Math.round(15 + (u / max) * 85)}%, var(--chart-seq-low))` : 'var(--brand-surface-2)' }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
      <p className="muted axis-note">Darker = more sold. Busiest: {num(max)} in an hour.</p>
      <Tip tip={tip} />
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="tile">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      {note && <small className="muted">{note}</small>}
    </div>
  );
}

function Block({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`card block${wide ? ' wide' : ''}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

// ---------- Dashboard ----------

export function DashboardPage() {
  const s = useSession();
  const current = useCurrentOutlet();
  const [range, setRange] = useState<[string, string]>(PRESETS[1][1]());
  const [outlet, setOutlet] = useState<string>(current ?? '');
  const [dept, setDept] = useState('all');
  const [demandFor, setDemandFor] = useState('');
  const [topBy, setTopBy] = useState<'units' | 'revenue'>('units');
  const cats = useApi<any[]>('/categories');
  const query = `from=${range[0]}&to=${range[1]}&department=${dept}${outlet ? `&outletId=${outlet}` : ''}`;
  const demandQ = demandFor.startsWith('i:') ? `&itemId=${demandFor.slice(2)}` : demandFor.startsWith('c:') ? `&categoryId=${demandFor.slice(2)}` : '';
  const d = useApi<any>(`/reports/dashboard?${query}${demandQ}`);
  useLive(['bill', 'stock', 'menu'], () => d.reload());
  const x = d.data;
  const value = (r: any) => (topBy === 'units' ? r.units : Number(r.revenue));
  const shown = (r: any) => (topBy === 'units' ? num(r.units) : rupee(r.revenue));

  return (
    <Page title="Dashboard" intro="Figures before tax, from the summary tables that every paid bill updates. Updates live while you watch.">
      <div className="filters card">
        <div className="row">
          {PRESETS.map(([label, fn]) => {
            const [a, b] = fn();
            return (
              <button key={label} className={range[0] === a && range[1] === b ? '' : 'secondary'} onClick={() => setRange([a, b])}>
                {label}
              </button>
            );
          })}
          <input type="date" aria-label="From" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} />
          <input type="date" aria-label="To" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} />
          <select aria-label="Outlet" value={outlet} onChange={(e) => setOutlet(e.target.value)}>
            <option value="">All my outlets</option>
            {(s?.outlets ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select aria-label="Food or Beverage" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="all">Food and Beverage</option>
            <option value="food">Food</option>
            <option value="beverage">Beverage</option>
          </select>
        </div>
      </div>
      <ErrorNote error={d.error} />
      {x && (
        <>
          <div className="tiles">
            <Tile label="Sales" value={rupee(x.sales.revenue)} note={`${range[0] === range[1] ? range[0] : `${range[0]} to ${range[1]}`}`} />
            <Tile label="Bills" value={num(x.sales.bills)} />
            <Tile label="Average bill" value={rupee(x.sales.averageBill)} />
            <Tile label="Food" value={rupee(x.totals.foodRevenue)} note={`${num(x.totals.plates)} plates`} />
            <Tile label="Beverage" value={rupee(x.totals.beverageRevenue)} note={`${x.totals.alcoholLitres} litres of alcohol`} />
            <Tile label="Stock value now" value={rupee(Number(x.stock.value.food ?? 0) + Number(x.stock.value.beverage ?? 0))} note={`Food ${rupee(x.stock.value.food ?? 0)} · Beverage ${rupee(x.stock.value.beverage ?? 0)}`} />
            <Tile label="Wastage" value={rupee(x.stock.wastage.reduce((a: number, w: any) => a + Number(w.value), 0))} note={x.stock.wastage.map((w: any) => `${w.movement} ${rupee(w.value)}`).join(' · ') || 'none'} />
          </div>

          <div className="blocks">
            <Block title="Margin by course or drink type">
              <BarList
                label="Margin % by course"
                rows={x.margins.courses.map((c: any) => ({ key: c.category, name: c.category, value: Number(c.marginPct), display: `${c.marginPct}% · ${rupee(c.marginAmount)}` }))}
              />
            </Block>
            <Block title="Margin by dish">
              <div className="table-wrap scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Dish</th>
                      <th>Sold</th>
                      <th>Margin ₹</th>
                      <th>Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {x.margins.dishes.slice(0, 15).map((m: any) => (
                      <tr key={m.id}>
                        <td>{m.name}</td>
                        <td>{num(m.units)}</td>
                        <td>{rupee(m.marginAmount)}</td>
                        <td>{m.marginPct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <small className="muted">A cheap dish with a high margin % can earn fewer rupees per plate than one lower on the list; both figures are shown.</small>
            </Block>
            <Block title="Margins that fell after a price change">
              {x.margins.drops.length === 0 ? (
                <p className="muted">None in this range.</p>
              ) : (
                <ul className="plain">
                  {x.margins.drops.map((m: any, i: number) => (
                    <li key={i}>
                      <strong>{m.name}</strong>: {Number(m.before_pct).toFixed(1)}% → {Number(m.now_pct).toFixed(1)}% <span className="muted">(cost {rupee(m.before_cost)} → {rupee(m.now_cost)})</span>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
            <Block title="Low and out right now">
              {x.stock.lowOut.length === 0 ? (
                <p className="muted">Everything is in stock.</p>
              ) : (
                <ul className="plain">
                  {x.stock.lowOut.map((m: any) => (
                    <li key={`${m.outletId}${m.menuItemId}`}>
                      {m.status === 'out' ? <Badge tone="danger">Out</Badge> : <Badge tone="warning">{m.portions} left</Badge>} {m.name}
                    </li>
                  ))}
                </ul>
              )}
            </Block>
            <Block title="Deliveries waiting for a goods received note">
              {x.stock.awaitingGrn.length === 0 ? (
                <p className="muted">None.</p>
              ) : (
                <ul className="plain">
                  {x.stock.awaitingGrn.map((g: any) => (
                    <li key={g.id}>
                      {g.vendor} · {g.expected_on} · {g.grn_status ? `${g.number} ${g.grn_status.replace('_', ' ')}` : g.status.replace('_', ' ')}
                    </li>
                  ))}
                </ul>
              )}
            </Block>
            <Block title="Demand by weekday and hour" wide>
              <select aria-label="Show demand for" value={demandFor} onChange={(e) => setDemandFor(e.target.value)} style={{ maxWidth: 320, marginBottom: '0.5rem' }}>
                <option value="">Everything</option>
                <optgroup label="Courses and types">
                  {(cats.data ?? [])
                    .filter((c) => c.kind === 'course' || c.kind === 'liquor_type')
                    .map((c) => (
                      <option key={c.id} value={`c:${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Items">
                  {x.margins.dishes.map((m: any) => (
                    <option key={m.id} value={`i:${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              </select>
              <Heatmap cells={x.demand} />
            </Block>
            <Block title={`Top dishes by ${topBy}`}>
              <div className="tabs" role="tablist">
                {(['units', 'revenue'] as const).map((k) => (
                  <button key={k} role="tab" aria-selected={topBy === k} className={topBy === k ? '' : 'ghost'} onClick={() => setTopBy(k)}>
                    {k === 'units' ? 'Units' : 'Revenue'}
                  </button>
                ))}
              </div>
              <BarList label="Top dishes" rows={(topBy === 'units' ? x.top.dishesByUnits : x.top.dishesByRevenue).map((r: any) => ({ key: r.id, name: r.name, value: value(r), display: shown(r) }))} />
            </Block>
            <Block title={`Top drinks by ${topBy}`}>
              <BarList label="Top drinks" rows={(topBy === 'units' ? x.top.drinksByUnits : x.top.drinksByRevenue).map((r: any) => ({ key: r.id, name: r.name, value: value(r), display: shown(r) }))} />
            </Block>
            <Block title="Top liquor brands">
              <BarList label="Top liquor brands by units" rows={x.top.brands.map((r: any) => ({ key: r.brand, name: r.brand, value: r.units, display: `${num(r.units)} · ${rupee(r.revenue)}` }))} />
            </Block>
            <Block title="Average time from first order to payment">
              <HourColumns
                label="Average minutes per bill by hour opened"
                unit="average minutes per bill, by the hour the bill opened"
                rows={x.timeSpent.filter((h: any) => h.bills > 0).map((h: any) => ({ hour: h.hour, value: h.averageMinutes, detail: `${h.averageMinutes} min average over ${h.bills} bills` }))}
              />
            </Block>
            <Block title="Beverage offers" wide>
              {x.offers.length === 0 ? (
                <p className="muted">No offers in this range.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>On offer</th>
                        <th>Triggered by</th>
                        <th>Menu price</th>
                        <th>Charged</th>
                        <th>Sold before</th>
                        <th>Sold during</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {x.offers.map((o: any) => (
                        <tr key={o.id}>
                          <td>{o.item}</td>
                          <td>{o.trigger}</td>
                          <td>{rupee(o.menuPrice)}</td>
                          <td>{rupee(o.offerPrice)}</td>
                          <td>
                            {num(o.before.units)} · {rupee(o.before.revenue)}
                          </td>
                          <td>
                            {num(o.during.units)} · {rupee(o.during.revenue)}
                          </td>
                          <td>{o.status === 'active' ? <Badge tone="success">running</Badge> : <span className="muted">{o.endReason}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <small className="muted">"Before" covers the same length of time just before the offer started.</small>
                </div>
              )}
            </Block>
          </div>
        </>
      )}
    </Page>
  );
}

// ---------- Reports ----------

const CLASS: Record<string, [string, string]> = {
  star: ['Star', 'High margin, popular: keep and feature'],
  plowhorse: ['Plowhorse', 'Popular, low margin: look at cost or price'],
  puzzle: ['Puzzle', 'High margin, not popular: promote or reposition'],
  dog: ['Dog', 'Low margin, not popular: consider removing'],
};

export function ReportsPage() {
  const s = useSession();
  const current = useCurrentOutlet();
  const [month, setMonth] = useState(businessDate(new Date()).slice(0, 7));
  const [range, setRange] = useState<[string, string]>([days(29), businessDate(new Date())]);
  const [regDate, setRegDate] = useState(businessDate(new Date()));
  const me = useApi<any>(current ? `/reports/menu-engineering?outletId=${current}&month=${month}` : null);
  const q = `outletId=${current}&from=${range[0]}&to=${range[1]}`;
  const closes = useApi<any[]>(current ? `/reports/day-close?${q}` : null);
  const variance = useApi<any[]>(current ? `/reports/stock-variance?${q}` : null);
  const [error, setError] = useState<string | null>(null);
  const download = (path: string, name: string) =>
    apiBlob(path)
      .then((b) => saveBlob(b, name))
      .catch((e) => setError(e.message));
  if (!current) return null;
  const exportOk = can(s, 'reports.export', current);
  const group = (list: any[]) =>
    ['star', 'plowhorse', 'puzzle', 'dog'].map((c) => (
      <div key={c} className="card">
        <h3>
          {CLASS[c][0]} <span className="muted">· {CLASS[c][1]}</span>
        </h3>
        <ul className="plain">
          {list
            .filter((i) => i.class === c)
            .map((i) => (
              <li key={i.id}>
                {i.name} <span className="muted">· {num(i.units)} sold ({i.share}%) · {rupee(i.marginPerUnit)} per plate</span>
              </li>
            ))}
          {!list.some((i) => i.class === c) && <li className="muted">None this month.</li>}
        </ul>
      </div>
    ));
  return (
    <Page title="Reports" intro="Monthly menu engineering, bar pour cost, day-close totals, stock variance and the liquor register, with CSV export.">
      <ErrorNote error={error} />
      <section className="card">
        <div className="row between">
          <h2>Menu engineering</h2>
          <input type="month" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 200 }} />
        </div>
        <p className="muted">
          "High margin" = margin per plate above the menu's average ({me.data?.food?.[0] ? rupee(me.data.food[0].avgMargin) : '—'} for food). "Popular" = share of plates above
          (1 ÷ number of items) × 70%.
        </p>
        <ErrorNote error={me.error} />
        {me.data && (
          <>
            <h3>Food</h3>
            <div className="cards">{group(me.data.food)}</div>
            <h3>Beverage</h3>
            <div className="cards">{group(me.data.beverage)}</div>
            <div className="tiles">
              <Tile label="Bar pour cost" value={`${me.data.pourCost.pct}%`} note={`Liquor cost ${rupee(me.data.pourCost.liquorCost)} ÷ liquor sales ${rupee(me.data.pourCost.liquorSales)}. Bars typically aim for about 20%.`} />
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h2>Day close and stock variance</h2>
          <div className="row">
            <input type="date" aria-label="From" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} />
            <input type="date" aria-label="To" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} />
          </div>
        </div>
        <div className="row between">
          <h3>Day-close totals</h3>
          {exportOk && (
            <button className="secondary" onClick={() => download(`/reports/day-close?${q}&format=csv`, `day-close-${range[0]}-to-${range[1]}.csv`)}>
              Export CSV
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Bills</th>
                <th>Food</th>
                <th>Liquor</th>
                <th>Total</th>
                <th>Cash</th>
                <th>UPI</th>
                <th>Card</th>
                <th>Cash difference</th>
              </tr>
            </thead>
            <tbody>
              {(closes.data ?? []).map((c) => (
                <tr key={c.business_date}>
                  <td>{c.business_date}</td>
                  <td>{c.bills}</td>
                  <td>{rupee(c.food_sales)}</td>
                  <td>{rupee(c.liquor_sales)}</td>
                  <td>{rupee(c.total)}</td>
                  <td>{rupee(c.cash)}</td>
                  <td>{rupee(c.upi)}</td>
                  <td>{rupee(c.card)}</td>
                  <td>{c.cash_difference == null ? '—' : rupee(c.cash_difference)}</td>
                </tr>
              ))}
              {closes.data?.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    No days closed in this range. Days are closed from the POS.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="row between">
          <h3>Stock variance from counts</h3>
          {exportOk && (
            <button className="secondary" onClick={() => download(`/reports/stock-variance?${q}&format=csv`, `stock-variance-${range[0]}-to-${range[1]}.csv`)}>
              Export CSV
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Count</th>
                <th>Store</th>
                <th>Item</th>
                <th>Books</th>
                <th>Counted</th>
                <th>Variance</th>
                <th>Value</th>
                <th>Cause</th>
              </tr>
            </thead>
            <tbody>
              {(variance.data ?? []).map((v, i) => (
                <tr key={i}>
                  <td>{String(v.count_date).slice(0, 10)}</td>
                  <td>{v.store}</td>
                  <td>{v.item}</td>
                  <td>
                    {num(v.expected_qty)} {v.unit}
                  </td>
                  <td>{num(v.counted_qty)}</td>
                  <td>{num(v.variance)}</td>
                  <td>{rupee(v.variance_value)}</td>
                  <td>{v.cause}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Liquor register</h2>
        <div className="row">
          <input type="date" aria-label="Business day" value={regDate} onChange={(e) => setRegDate(e.target.value)} style={{ maxWidth: 200 }} />
          {exportOk && (
            <button className="secondary" onClick={() => download(`/reports/liquor-register?outletId=${current}&from=${regDate}&format=csv`, `liquor-register-${regDate}.csv`)}>
              Export CSV
            </button>
          )}
          <a href="/liquor-register">Open the printable register</a>
        </div>
      </section>

      {can(s, 'data.export', null) && (
        <section className="card">
          <h2>All business data</h2>
          <p className="muted">Every table as a CSV file in one zip: the business's right to take its data. Password and PIN hashes are left out.</p>
          <button className="secondary" onClick={() => download('/data/export', `${s?.customer.code}-export.zip`)}>
            Download everything
          </button>
        </section>
      )}
    </Page>
  );
}

import { useState } from 'react';
import { businessDate } from '@fnb/shared';
import { apiBlob, can, saveBlob, useApi, useCurrentOutlet, useSession } from '../../api';
import { ErrorNote, Page, rupee } from '../../ui';
import { days, num } from './shared';
import { Tile } from './charts';

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

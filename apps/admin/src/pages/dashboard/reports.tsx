import { useState } from 'react';
import { Link } from 'react-router-dom';
import { businessDate } from '@fnb/shared';
import { apiBlob, can, saveBlob, useApi, useCurrentOutlet, useSession } from '../../api';
import { ErrorNote, Page, rupee } from '../../ui';
import { days, num } from './shared';
import { Tile } from './charts';

// ---------- Reports ----------

const CLASS: Record<string, [string, string]> = {
  star: ['Top Performer', 'High margin, high volume: protect and feature'],
  plowhorse: ['Volume Driver', 'High volume, lower margin: optimize cost or review pricing'],
  puzzle: ['High Potential', 'High margin, low volume: promote and reposition'],
  dog: ['Underperformer', 'Low margin, low volume: review for removal or reformulate'],
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
      <div key={c} className="card quadrant">
        <h4>{CLASS[c][0]}</h4>
        <p>{CLASS[c][1]}</p>
        <ul className="clean">
          {list
            .filter((i) => i.class === c)
            .map((i) => (
              <li key={i.id}>
                <span>{i.name}</span>
                <span className="muted">
                  {num(i.units)} sold · {i.share}% · {rupee(i.marginPerUnit)} per plate
                </span>
              </li>
            ))}
          {!list.some((i) => i.class === c) && <li className="muted">None this month.</li>}
        </ul>
      </div>
    ));
  return (
    <Page title="Reports" intro="Which dishes make money, how much the bar spends on liquor, each day's totals, what stock went missing and the liquor log. Every table can be downloaded.">
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
            <h3 className="section-label">Food</h3>
            <div className="cards quadrants">{group(me.data.food)}</div>
            <h3 className="section-label">Beverage</h3>
            <div className="cards quadrants">{group(me.data.beverage)}</div>
            <div className="tiles single">
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
                <th style={{ textAlign: 'right' }}>Bills</th>
                <th style={{ textAlign: 'right' }}>Food</th>
                <th style={{ textAlign: 'right' }}>Liquor</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Cash</th>
                <th style={{ textAlign: 'right' }}>UPI</th>
                <th style={{ textAlign: 'right' }}>Card</th>
                <th style={{ textAlign: 'right' }}>Cash diff</th>
              </tr>
            </thead>
            <tbody>
              {(closes.data ?? []).map((c) => (
                <tr key={c.business_date}>
                  <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{c.business_date}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.bills}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rupee(c.food_sales)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rupee(c.liquor_sales)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>{rupee(c.total)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rupee(c.cash)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rupee(c.upi)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rupee(c.card)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: Number(c.cash_difference) < 0 ? 'var(--brand-danger)' : undefined }}>
                    {c.cash_difference == null ? '—' : rupee(c.cash_difference)}
                  </td>
                </tr>
              ))}
              {closes.data?.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted" style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                    No days closed in this range. Days are closed from the POS.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="row between" style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>
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
                <th>Count date</th>
                <th>Store</th>
                <th>Item</th>
                <th style={{ textAlign: 'right' }}>Books</th>
                <th style={{ textAlign: 'right' }}>Counted</th>
                <th style={{ textAlign: 'right' }}>Variance</th>
                <th style={{ textAlign: 'right' }}>Value</th>
                <th>Cause</th>
              </tr>
            </thead>
            <tbody>
              {(variance.data ?? []).map((v, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{String(v.count_date).slice(0, 10)}</td>
                  <td>{v.store}</td>
                  <td><strong>{v.item}</strong></td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {num(v.expected_qty)} {v.unit}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{num(v.counted_qty)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: Number(v.variance) < 0 ? 'var(--brand-danger)' : 'var(--brand-success)' }}>
                    {num(v.variance)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>{rupee(v.variance_value)}</td>
                  <td>{v.cause || '—'}</td>
                </tr>
              ))}
              {variance.data?.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                    No variance records found in this range.
                  </td>
                </tr>
              )}
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
          <Link to="/liquor-register" className="link">
            Open printable register
          </Link>
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

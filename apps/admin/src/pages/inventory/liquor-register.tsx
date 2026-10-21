import { useState } from 'react';
import { businessDate } from '@fnb/shared';
import { useApi, useCurrentOutlet, useSession } from '../../api';
import { ErrorNote, Page } from '../../ui';

// ---------- Liquor register ----------

export function LiquorRegisterPage() {
  const outletId = useCurrentOutlet();
  const s = useSession();
  const [date, setDate] = useState(businessDate(new Date()));
  const reg = useApi<any>(outletId ? `/inventory/liquor-register?outletId=${outletId}&date=${date}` : null);
  const outlet = s?.outlets.find((o) => o.id === outletId);
  const cols = ['opening', 'receipts', 'sales', 'other', 'closing'] as const;
  return (
    <Page
      title="Liquor register"
      intro="Daily register per label: opening stock, receipts, sales, other movements and closing stock, in bottles and ml. The format must be checked with an excise consultant."
      actions={
        <>
          <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="secondary" onClick={() => window.print()}>
            Print register
          </button>
        </>
      }
    >
      <ErrorNote error={reg.error} />
      <div className="print-only">
        <h2>Daily liquor register · {outlet?.name}</h2>
        <p>
          Business day {date} (from {reg.data?.dayStart})
        </p>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Type</th>
              {cols.map((c) => (
                <th key={c}>{c[0].toUpperCase() + c.slice(1)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(reg.data?.rows ?? []).map((r: any) => (
              <tr key={r.stockItemId}>
                <td>
                  {r.name}
                  <div className="muted">{r.brand}</div>
                </td>
                <td>{[r.type, r.subtype].filter(Boolean).join(' › ')}</td>
                {cols.map((c) => (
                  <td key={c}>
                    <strong>{r.bottles[c] ?? '—'}</strong>
                    <div className="muted">{Number(r.ml[c]).toLocaleString('en-IN')} ml</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

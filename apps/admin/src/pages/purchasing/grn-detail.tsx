import { useEffect, useState } from 'react';
import { istDate } from '@fnb/shared';
import { api, apiBlob, can, useApi, useSession } from '../../api';
import { Badge, ErrorNote, rupee, toast } from '../../ui';
import { GRN_STATUS, qty } from './shared';

// Photo behind sign-in.
function AuthImage({ id, alt }: { id: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    apiBlob(`/attachments/${id}`)
      .then((b) => setSrc((url = URL.createObjectURL(b))))
      .catch(() => {});
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return src ? <img src={src} alt={alt} style={{ maxWidth: 160, maxHeight: 160, borderRadius: 'var(--brand-radius-small)' }} /> : null;
}

export function GrnDetail({ id }: { id: string }) {
  const s = useSession();
  const g = useApi<any>(`/grns/${id}`);
  const photos = useApi<any>(g.data ? `/deliveries/${g.data.receiptCheckId}` : null);
  const [pay, setPay] = useState<any>({ paidOn: istDate(new Date()), mode: 'bank_transfer' });
  const [error, setError] = useState<string | null>(null);
  const x = g.data;
  if (!x) return <ErrorNote error={g.error} />;
  const paid = x.payments.reduce((a: number, p: any) => a + Number(p.amount), 0);
  async function record(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/grns/${id}/payments`, { body: { ...pay, amount: pay.amount ?? (Number(x.amountPayable) - paid).toFixed(2) } });
      toast('Payment recorded');
      g.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <>
      <p>
        <strong>{x.number}</strong> · {x.vendor} · vendor bill {x.vendorBillNo ?? '—'} · <Badge tone={GRN_STATUS[x.status]?.[1]}>{GRN_STATUS[x.status]?.[0]}</Badge>
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Accepted</th>
              <th>Billed rate</th>
              <th>Last rate (per base unit)</th>
              <th>Amount</th>
              <th>Expiry</th>
            </tr>
          </thead>
          <tbody>
            {x.lines.map((l: any) => {
              const rise = l.lastRatePerBase && Number(l.ratePerBase) > Number(l.lastRatePerBase);
              return (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td>
                    {qty(l.acceptedQty)} {l.unit}
                  </td>
                  <td>{rupee(l.billedRate)}</td>
                  <td style={rise ? { color: 'var(--brand-danger)' } : undefined}>
                    {l.lastRatePerBase ? `₹${Number(l.lastRatePerBase).toFixed(4)} → ₹${Number(l.ratePerBase).toFixed(4)}` : 'first purchase'}
                  </td>
                  <td>{rupee(l.amount)}</td>
                  <td>{l.expiresOn ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {x.returns.length > 0 && (
        <>
          <h3>Return note (rejected after the delivery person left)</h3>
          <ul className="plain">
            {x.returns.map((r: any) => (
              <li key={r.id}>
                {r.name}: {qty(r.qty)} · {r.reason} · − {rupee(r.amount)}
              </li>
            ))}
          </ul>
        </>
      )}
      <p>
        Bill {rupee(x.amountGross)} − returns {rupee(x.returnDeduction)} = <strong>payable {rupee(x.amountPayable)}</strong> · paid {rupee(paid)}
      </p>
      {photos.data?.photos?.length > 0 && (
        <>
          <h3>Photos</h3>
          <div className="row">
            {photos.data.photos.map((p: any) => (
              <figure key={p.id} style={{ margin: 0 }}>
                <AuthImage id={p.id} alt={p.purpose.replace('_', ' ')} />
                <figcaption className="muted">{p.purpose.replace('_', ' ')}</figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
      {x.payments.length > 0 && (
        <>
          <h3>Payments</h3>
          <ul className="plain">
            {x.payments.map((p: any) => (
              <li key={p.id}>
                {p.paidOn} · {p.mode.replace('_', ' ')} · {p.reference ?? '—'} · {rupee(p.amount)}
              </li>
            ))}
          </ul>
        </>
      )}
      {x.status === 'approved' && can(s, 'accounts.pay', x.outletId) && (
        <form className="card" onSubmit={record}>
          <h3>Record payment</h3>
          <div className="grid">
            <label className="field">
              Date
              <input type="date" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} />
            </label>
            <label className="field">
              Mode
              <select value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>
                <option value="bank_transfer">Bank transfer</option>
                <option value="upi">UPI</option>
                <option value="cheque">Cheque</option>
                <option value="cash">Cash</option>
              </select>
            </label>
            <label className="field">
              Reference
              <input value={pay.reference ?? ''} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
            </label>
            <label className="field">
              Amount (₹)
              <input inputMode="decimal" placeholder={(Number(x.amountPayable) - paid).toFixed(2)} value={pay.amount ?? ''} onChange={(e) => setPay({ ...pay, amount: e.target.value || undefined })} />
            </label>
          </div>
          <ErrorNote error={error} />
          <button>Save payment</button>
        </form>
      )}
    </>
  );
}

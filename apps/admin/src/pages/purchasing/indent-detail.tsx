import { useState } from 'react';
import { api, apiBlob, saveBlob, useApi } from '../../api';
import { Badge, ErrorNote, rupee } from '../../ui';
import { fmtQty } from '../inventory/format';
import { qty } from './shared';

export function IndentDetail({ id }: { id: string }) {
  const ind = useApi<any>(`/indents/${id}`);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const i = ind.data;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
      await ind.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const pdfName = () => `order-${i.vendor.name.replace(/\W+/g, '-')}-${i.forDate}.pdf`;
  const record = (method: string, ok: boolean, detail?: string) => api(`/indents/${id}/sends`, { body: { channel: 'manual_share', method, ok, detail } });

  // Share sheet on phones (WhatsApp, email…); falls back to download where sharing files is not supported.
  async function share() {
    const blob = await apiBlob(`/indents/${id}/pdf`);
    const file = new File([blob], pdfName(), { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Order for ${i.forDate}`, text: `Order from us for delivery on ${i.forDate}` });
        await record('share', true);
      } catch (e) {
        await record('share', false, (e as Error).name === 'AbortError' ? 'cancelled' : (e as Error).message);
      }
    } else {
      saveBlob(blob, pdfName());
      await record('download', true, 'share not available on this device');
    }
  }
  async function download() {
    saveBlob(await apiBlob(`/indents/${id}/pdf`), pdfName());
    await record('download', true);
  }
  async function print() {
    const url = URL.createObjectURL(await apiBlob(`/indents/${id}/pdf`));
    const w = window.open(url);
    if (w) setTimeout(() => w.print(), 600);
    await record('print', !!w, w ? undefined : 'pop-up blocked');
  }

  if (!i) return <ErrorNote error={ind.error} />;
  const editable = i.status === 'pending_approval';
  return (
    <>
      <p>
        <strong>{i.vendor.name}</strong> {i.vendor.phone && <span className="muted">· {i.vendor.phone}</span>} · delivery {i.forDate} ·{' '}
        <Badge>{i.status.replace('_', ' ')}</Badge>
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Par</th>
              <th>On hand</th>
              <th>On order</th>
              <th>Suggested</th>
              <th>Order</th>
              <th>Last rate</th>
            </tr>
          </thead>
          <tbody>
            {i.lines.map((l: any) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>{fmtQty(l.parQty, l.baseUnit)}</td>
                <td>{fmtQty(l.onHandQty, l.baseUnit)}</td>
                <td>{fmtQty(l.onOrderQty, l.baseUnit)}</td>
                <td>
                  {qty(l.suggestedQty)} {l.unit}
                </td>
                <td>
                  {editable ? (
                    <input aria-label={`Order quantity for ${l.name}`} inputMode="decimal" defaultValue={qty(l.approvedQty ?? l.suggestedQty)} onChange={(e) => setEdits({ ...edits, [l.id]: e.target.value })} style={{ maxWidth: 100 }} />
                  ) : (
                    `${qty(l.approvedQty ?? l.suggestedQty)} ${l.unit}`
                  )}
                </td>
                <td>{l.lastRate ? rupee(l.lastRate) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorNote error={error} />
      <footer className="row end">
        {editable ? (
          <>
            <button className="ghost" onClick={() => run(() => api(`/indents/${id}/cancel`, { method: 'POST' }))}>
              Cancel order
            </button>
            {Object.keys(edits).length > 0 && (
              <button className="secondary" onClick={() => run(() => api(`/indents/${id}/lines`, { method: 'PUT', body: Object.entries(edits).map(([lid, q]) => ({ id: lid, approvedQty: q })) }))}>
                Save quantities
              </button>
            )}
            <button onClick={() => run(async () => (Object.keys(edits).length && (await api(`/indents/${id}/lines`, { method: 'PUT', body: Object.entries(edits).map(([lid, q]) => ({ id: lid, approvedQty: q })) })), api(`/indents/${id}/approve`, { method: 'POST' })))}>
              Approve
            </button>
          </>
        ) : (
          i.status !== 'cancelled' && (
            <>
              <button className="secondary" onClick={() => run(print)}>
                Print
              </button>
              <button className="secondary" onClick={() => run(download)}>
                Download
              </button>
              <button onClick={() => run(share)}>Share</button>
            </>
          )
        )}
      </footer>
      {i.sends.length > 0 && (
        <>
          <h3>Sent</h3>
          <ul className="plain">
            {i.sends.map((s: any) => (
              <li key={s.id}>
                {new Date(s.attemptedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })} · {s.detail ?? s.channel} · {s.user ?? 'system'} ·{' '}
                {s.result === 'ok' ? <Badge tone="success">ok</Badge> : <Badge tone="danger">failed</Badge>}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

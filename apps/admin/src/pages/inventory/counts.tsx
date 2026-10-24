import { useState } from 'react';
import { businessDate } from '@fnb/shared';
import { api, can, useApi, useCurrentOutlet, useSession } from '../../api';
import { useRecordPath } from '../../routing';
import { BackButton, Badge, ErrorNote, Page } from '../../ui';
import { CountSheet } from './count-sheet';

// ---------- Stock counts ----------

// /counts lists counts; /counts/<id> is one count sheet.

export function CountsPage() {
  const s = useSession();
  const outletId = useCurrentOutlet();
  const counts = useApi<any[]>(outletId ? `/inventory/counts?outletId=${outletId}` : null);
  const stores = useApi<any[]>(outletId ? `/outlets/${outletId}/stores` : null);
  const rec = useRecordPath();
  const [form, setForm] = useState<any>({ scheduledFor: businessDate(new Date()) });
  const [error, setError] = useState<string | null>(null);
  if (!outletId) return null;
  if (rec.slug) {
    return (
      <Page eyebrow="Stock counts" title="Stock count" actions={<BackButton onClick={() => (rec.close(), counts.reload())} label="All counts" />}>
        <CountSheet id={rec.slug} />
      </Page>
    );
  }
  async function schedule(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/inventory/counts', { body: { storeId: form.storeId ?? stores.data?.[0]?.id, scheduledFor: form.scheduledFor } });
      counts.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Page title="Stock counts" intro="Pick a day, count what is on the shelves, and the app shows what is missing or extra. A manager approves any correction.">
      {can(s, 'inventory.count', outletId) && (
        <form className="card row" onSubmit={schedule}>
          <label className="field" style={{ margin: 0 }}>
            Store
            <select value={form.storeId ?? ''} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
              {(stores.data ?? []).map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ margin: 0 }}>
            Date
            <input type="date" value={form.scheduledFor} onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })} />
          </label>
          <button className="gold" style={{ alignSelf: 'flex-end' }}>Schedule count</button>
        </form>
      )}
      <ErrorNote error={error ?? counts.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Store</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {(counts.data ?? []).map((c) => (
              <tr key={c.id}>
                <td><strong>{c.scheduledFor}</strong></td>
                <td>{c.store}</td>
                <td>
                  <Badge tone={c.status === 'approved' ? 'success' : c.status === 'submitted' ? 'warning' : 'neutral'}>{c.status}</Badge>
                </td>
                <td className="actions">
                  <button className="link" onClick={() => rec.open(c.id)}>
                    Open count
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

import { useState } from 'react';
import { api, useApi, useCurrentOutlet } from '../../api';
import { useRecordPath } from '../../routing';
import { BackButton, Badge, Empty, ErrorNote, Page, toast } from '../../ui';
import { nextDelivery } from './shared';
import { IndentDetail } from './indent-detail';

// ---------- Nightly indent ----------

// /indents lists the vendor orders for a delivery date; /indents/<id> is one order.

export function IndentsPage() {
  const outletId = useCurrentOutlet();
  const [date, setDate] = useState(nextDelivery());
  const list = useApi<any[]>(outletId ? `/indents?outletId=${outletId}&forDate=${date}` : null);
  const rec = useRecordPath();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!outletId) return null;
  async function build() {
    try {
      const r = await api('/indents/build', { body: { outletId, forDate: date } });
      toast(`${r.indents.length} vendor order${r.indents.length === 1 ? '' : 's'} built`);
      setMsg(r.unassigned.length ? `No vendor is set for: ${r.unassigned.join(', ')}. Add them under Suppliers and prices.` : null);
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (rec.slug) {
    return (
      <Page eyebrow="Nightly indent" title="Vendor order" actions={<BackButton onClick={() => (rec.close(), list.reload())} label="All orders" />}>
        <IndentDetail id={rec.slug} />
      </Page>
    );
  }
  return (
    <Page
      title="Order from vendors"
      intro="Every night the app works out what to buy: what you should keep, minus what you have, minus what is already ordered. Check the list, approve it, then send it to the supplier."
      actions={
        <>
          <input type="date" aria-label="Delivery date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="secondary" onClick={build}>
            Build now
          </button>
        </>
      }
    >
      <ErrorNote error={error ?? list.error} />
      {msg && <p className="note">{msg}</p>}
      <div className="cards">
        {(list.data ?? []).map((i) => (
          <article key={i.id} className="card">
            <header className="row between">
              <h3>{i.vendor}</h3>
              <Badge tone={i.status === 'sent' ? 'success' : i.status === 'approved' ? 'warning' : 'neutral'}>{i.status.replace('_', ' ')}</Badge>
            </header>
            <p className="muted">
              {i.lineCount} items · for {i.forDate}
            </p>
            <button className="secondary" onClick={() => rec.open(i.id)}>
              View order
            </button>
          </article>
        ))}
        {list.data?.length === 0 && <Empty title="No orders for this date">Click 'Build now' to generate vendor orders from par shortages, or pick a different delivery date.</Empty>}
      </div>
    </Page>
  );
}

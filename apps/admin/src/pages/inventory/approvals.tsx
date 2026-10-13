import { useState } from 'react';
import { api, useApi, useCurrentOutlet } from '../../api';
import { useLiveReload } from '../../live';
import { Badge, ErrorNote, Page, rupee, toast } from '../../ui';
import { MOVE_LABEL } from './ledger';

// ---------- Approvals ----------

export function ApprovalsPage() {
  const outletId = useCurrentOutlet();
  const [status, setStatus] = useState('pending');
  const list = useApi<any[]>(`/approvals?status=${status}${outletId ? `&outletId=${outletId}` : ''}`);
  const [error, setError] = useState<string | null>(null);
  useLiveReload(['approval'], list.reload);
  async function decide(id: string, approve: boolean) {
    try {
      setError(null);
      await api(`/approvals/${id}/decide`, { body: { approve } });
      toast(approve ? 'Approved' : 'Rejected');
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Page title="Approvals" intro="Write-offs, count corrections, price changes, bill cancellations, refunds and discounts wait here. The person who asked cannot approve their own request.">
      <div className="tabs" role="tablist">
        {['pending', 'approved', 'rejected', 'all'].map((x) => (
          <button key={x} role="tab" aria-selected={status === x} className={status === x ? '' : 'ghost'} onClick={() => setStatus(x)}>
            {x[0].toUpperCase() + x.slice(1)}
          </button>
        ))}
      </div>
      <ErrorNote error={error ?? list.error} />
      <div className="cards">
        {(list.data ?? []).map((r) => (
          <article key={r.id} className="card">
            <header className="row between">
              <h3>{r.label}</h3>
              <Badge tone={r.status === 'approved' ? 'success' : r.status === 'pending' ? 'warning' : 'neutral'}>{r.status}</Badge>
            </header>
            <p className="muted">
              {r.proposedByName} · {new Date(r.proposedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}
              {r.outletName && ` · ${r.outletName}`}
            </p>
            {r.reason && <p>“{r.reason}”</p>}
            <Proposed r={r} />
            {r.decidedByName && <p className="muted">Decided by {r.decidedByName}</p>}
            {r.status === 'pending' && (
              <footer className="row end">
                <button className="ghost" onClick={() => decide(r.id, false)}>
                  Reject
                </button>
                <button onClick={() => decide(r.id, true)}>Approve</button>
              </footer>
            )}
          </article>
        ))}
        {list.data?.length === 0 && <p className="muted">Nothing here.</p>}
      </div>
    </Page>
  );
}

// A readable summary of what a request would change.
function Proposed({ r }: { r: any }) {
  const p = r.proposed ?? {};
  const items = useApi<any[]>(p.stockItemId ? '/stock-items' : null);
  const name = items.data?.find((i) => i.id === p.stockItemId)?.name;
  const out: string[] = [];
  if (p.movement) out.push(`${MOVE_LABEL[p.movement] ?? p.movement}: ${name ?? 'item'} ${p.qty}`);
  if (p.sellingPrice) out.push(`New price ${rupee(p.sellingPrice)}${r.current?.sellingPrice ? ` (now ${rupee(r.current.sellingPrice)})` : ''}`);
  if (p.amount) out.push(`Amount ${rupee(p.amount)}`);
  if (p.discountPct) out.push(`Discount ${p.discountPct}%`);
  if (p.ledgerId) out.push(`Reverse stock entry #${p.ledgerId}`);
  if (p.countId) out.push('Post the counted variance');
  if (p.summary) out.push(p.summary);
  return (
    <ul className="plain">
      {out.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

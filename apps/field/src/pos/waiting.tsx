// What waits for someone at the counter: orders from tables, and requests for a manager.
import { useCallback, useEffect, useState } from 'react';
import { dec } from '@fnb/shared';
import { DietMark, rupee } from '../lib/ui';
import type { Catalog, GuestOrder } from './types';
import { session, since } from './device';
import { Dialog } from './dialog';

export function GuestOrders(props: {
  orders: GuestOrder[];
  cat: Catalog;
  online: boolean;
  onAccept: (g: GuestOrder) => Promise<void>;
  onReject: (g: GuestOrder, reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    await fn();
    setBusy(null);
  };
  return (
    <Dialog title="Orders from tables" onClose={props.onClose} wide>
      {props.orders.length === 0 && <p className="muted">Nothing waiting.</p>}
      {!props.online && <p className="note danger">Offline: table orders can be accepted once the connection is back.</p>}
      {props.orders.map((g) => {
        const lines = g.lines.map((l) => ({ ...l, item: props.cat.menu.find((m) => m.id === l.menuItemId) }));
        const sum = lines.reduce((a, l) => a.plus(dec(l.item?.price ?? 0).times(l.qty)), dec(0));
        return (
          <div key={g.id} className="card">
            <div className="row">
              <strong style={{ flex: 3 }}>Table {g.table}</strong>
              <span className="muted">{since(g.createdAt)} ago</span>
            </div>
            <ul className="lines">
              {lines.map((l) => (
                <li key={l.menuItemId} className={l.item?.status === 'out' ? 'voided' : ''}>
                  <span>
                    <DietMark diet={l.item?.dietType ?? null} size={12} /> {l.item?.name ?? 'Item no longer on the menu'}
                    {l.item?.status === 'out' && <span className="badge danger"> Sold out</span>}
                  </span>
                  <span>× {l.qty}</span>
                  <span>{l.item ? rupee(dec(l.item.price).times(l.qty).toString()) : ''}</span>
                </li>
              ))}
            </ul>
            <p className="muted">{rupee(sum.toString())} before tax</p>
            <input
              aria-label="Reason for the guest"
              placeholder="Reason, if turning it down (the guest sees this)"
              value={reasons[g.id] ?? ''}
              onChange={(e) => setReasons({ ...reasons, [g.id]: e.target.value })}
            />
            <div className="row" style={{ marginTop: '0.5rem' }}>
              <button className="secondary" disabled={busy === g.id} onClick={() => run(g.id, () => props.onReject(g, reasons[g.id] ?? ''))}>
                Turn down
              </button>
              <button className="gold" disabled={busy === g.id || !props.online} onClick={() => run(g.id, () => props.onAccept(g))}>
                Accept onto the bill
              </button>
            </div>
          </div>
        );
      })}
    </Dialog>
  );
}

export function Approvals({ outletId, onClose }: { outletId: string; onClose: () => void }) {
  const [list, setList] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => session.api<any[]>(`/approvals?status=pending&outletId=${outletId}`).then(setList).catch((e) => setError(e.message)), [outletId]);
  useEffect(() => {
    load();
  }, [load]);
  const decide = (id: string, approve: boolean) =>
    session
      .api(`/approvals/${id}/decide`, { body: { approve } })
      .then(load)
      .catch((e) => setError(e.message));
  return (
    <Dialog title="Waiting for approval" onClose={onClose} wide>
      {list.length === 0 && <p className="muted">Nothing waiting.</p>}
      {list.map((r) => (
        <div key={r.id} className="card">
          <strong>{r.label}</strong> · {r.proposedByName}
          <p>{r.proposed?.summary}</p>
          {r.reason && <p className="muted">“{r.reason}”</p>}
          <div className="row">
            <button className="secondary" onClick={() => decide(r.id, false)}>
              Reject
            </button>
            <button onClick={() => decide(r.id, true)}>Approve</button>
          </div>
        </div>
      ))}
      {error && <p className="note danger">{error}</p>}
    </Dialog>
  );
}

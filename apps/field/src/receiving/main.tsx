import '@fnb/theme/theme.css';
import '../lib/field.css';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { istDate } from '@fnb/shared';
import { shrinkPhoto } from '../lib/image';
import { createQueue, useWhenSynced } from '../lib/queue';
import { createSession } from '../lib/session';
import { ArrowLeft, ArrowRight, Camera, Check, ChevronRight, LogOut, Minus, PackageCheck, RefreshCw, Truck, X } from 'lucide-react';
import { initials, Login, OfflineBar, registerWorker, toast, Toasts } from '../lib/ui';

// Receiving app (phone): today's deliveries, the watchman's gate check, the staff re-check
// with photos and the billed rate, and the goods received note sign-off. Works offline.

const session = createSession('receiving');
const queue = createQueue('receiving', session);
registerWorker('/receiving/sw.js');

const GATE_REASONS: [string, string][] = [
  ['not_fresh', 'Not fresh'], ['spoiled', 'Spoiled'], ['wrong_item', 'Wrong item'], ['damaged', 'Damaged'], ['short_weight', 'Short weight'], ['other', 'Other'],
];
const RECHECK_REASONS: [string, string][] = [['spoiled', 'Spoiled'], ['expired', 'Expired'], ['unusable', 'Unusable']];
const n = (v: string | null | undefined) => (v == null ? '' : String(Number(v)));

// Last known copy of each screen, for opening it without a connection.
const cache = {
  get: <T,>(k: string): T | null => {
    try {
      return JSON.parse(localStorage.getItem(`fnb.receiving.cache.${k}`) ?? 'null');
    } catch {
      return null;
    }
  },
  set: (k: string, v: unknown) => localStorage.setItem(`fnb.receiving.cache.${k}`, JSON.stringify(v)),
};

function useLoad<T>(key: string, path: string | null) {
  const [data, setData] = useState<T | null>(() => cache.get<T>(key));
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await session.api<T>(path);
      setData(d);
      cache.set(key, d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [key, path]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, setData: (d: T) => (setData(d), cache.set(key, d)), error, load };
}

function PhotoButton({ deliveryId, lineId, purpose, label = 'Photo' }: { deliveryId: string; lineId?: string; purpose: string; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const picked = e.target.files?.[0];
          if (!picked) return;
          // Shrunk on the phone first: smaller to keep offline and quicker to send on a weak signal.
          const { file, filename } = await shrinkPhoto(picked);
          await queue.add({
            kind: 'upload', path: '/attachments', label: `Photo (${purpose.replace('_', ' ')})`, file, filename: filename || 'photo.jpg',
            fields: { entity: 'receipt_check', entityId: deliveryId, purpose, ...(lineId ? { lineId } : {}) },
          });
          setCount((c) => c + 1);
          e.target.value = '';
        }}
      />
      <button type="button" className="secondary" onClick={() => input.current?.click()}>
        <Camera className="icon" aria-hidden /> {label}
        {count > 0 && <span className="badge gold">{count} taken</span>}
      </button>
    </>
  );
}

// ---------- Gate check (watchman) ----------

function Gate({ d, save }: { d: any; save: (d: any) => void }) {
  const firstOpen = d.lines.findIndex((l: any) => l.gateStatus === 'pending');
  const [i, setI] = useState(firstOpen === -1 ? 0 : firstOpen);
  const [mode, setMode] = useState<null | 'short' | 'reject'>(null);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const line = d.lines[i];
  const done = d.lines.filter((l: any) => l.gateStatus !== 'pending').length;

  async function decide(status: 'accepted' | 'short' | 'rejected') {
    const body = { status, qty: status === 'short' ? qty : null, reason: status === 'accepted' ? null : status === 'short' ? 'short_weight' : reason };
    const gateQty = status === 'accepted' ? line.orderedQty : status === 'short' ? qty : '0';
    save({ ...d, lines: d.lines.map((l: any, j: number) => (j === i ? { ...l, gateStatus: status, gateQty } : l)) });
    await queue.add({ kind: 'json', method: 'PUT', path: `/deliveries/${d.id}/gate/${line.id}`, body, label: `Gate: ${line.name}` });
    setMode(null);
    setQty('');
    setReason(null);
    if (i < d.lines.length - 1) setI(i + 1);
  }

  return (
    <div className="stack">
      <div className="progress" aria-label={`${done} of ${d.lines.length} checked`}>
        <span style={{ width: `${(done / d.lines.length) * 100}%` }} />
      </div>
      <p className="muted">
        Line {i + 1} of {d.lines.length}
      </p>
      <div className="card stack">
        <div className="big">{line.name}</div>
        <div>
          Ordered: <strong>{n(line.orderedQty)} {line.unit}</strong>
        </div>
        {line.gateStatus !== 'pending' && (
          <div className="badge">
            {line.gateStatus === 'short' ? `Short: ${n(line.gateQty)} ${line.unit} came` : line.gateStatus === 'accepted' ? 'Accepted' : 'Rejected'}
          </div>
        )}
        {!mode && (
          <div className="stack">
            <button className="good huge" onClick={() => decide('accepted')} style={{ width: '100%' }}>
              <Check className="icon" aria-hidden /> All here and good
            </button>
            <div className="row">
              <button className="warn huge" onClick={() => setMode('short')}>
                <Minus className="icon" aria-hidden /> Short
              </button>
              <button className="bad huge" onClick={() => setMode('reject')}>
                <X className="icon" aria-hidden /> Send back
              </button>
            </div>
          </div>
        )}
        {mode === 'short' && (
          <div className="stack">
            <label className="field">
              How much came? ({line.unit})
              <input inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            <div className="row">
              <button className="secondary" onClick={() => setMode(null)}>
                Back
              </button>
              <button className="warn" disabled={!qty || Number(qty) >= Number(line.orderedQty)} onClick={() => decide('short')}>
                Save short
              </button>
            </div>
          </div>
        )}
        {mode === 'reject' && (
          <div className="stack">
            <p>Why is it going back?</p>
            <div className="chips">
              {GATE_REASONS.map(([k, label]) => (
                <button key={k} className="secondary" aria-pressed={reason === k} onClick={() => setReason(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="row">
              <button className="secondary" onClick={() => setMode(null)}>
                Back
              </button>
              <button className="bad" disabled={!reason} onClick={() => decide('rejected')}>
                Reject
              </button>
            </div>
          </div>
        )}
        <PhotoButton deliveryId={d.id} lineId={line.id} purpose="gate_photo" />
      </div>
      <div className="row">
        <button className="secondary" disabled={i === 0} onClick={() => setI(i - 1)}>
          <ArrowLeft className="icon" aria-hidden /> Previous
        </button>
        <button className="secondary" disabled={i === d.lines.length - 1} onClick={() => setI(i + 1)}>
          Next <ArrowRight className="icon" aria-hidden />
        </button>
      </div>
      <button
        className="huge gold"
        style={{ width: '100%' }}
        disabled={done < d.lines.length}
        onClick={async () => {
          save({ ...d, status: 'gate_checked' });
          await queue.add({ kind: 'json', method: 'POST', path: `/deliveries/${d.id}/gate/complete`, label: 'Finish gate check' });
          toast('Gate check done. Staff will re-check it next.');
        }}
      >
        <PackageCheck className="icon" aria-hidden /> Finish gate check ({done}/{d.lines.length})
      </button>
    </div>
  );
}

// ---------- Staff re-check ----------

function Recheck({ d, save, showRates }: { d: any; save: (d: any) => void; showRates: boolean }) {
  const lines = d.lines.filter((l: any) => Number(l.gateQty ?? 0) > 0);
  const [i, setI] = useState(0);
  const [billNo, setBillNo] = useState(d.vendorBillNo ?? '');
  const line = lines[i];
  const [v, setV] = useState<any>({});
  useEffect(() => {
    if (!line) return;
    setV({
      acceptedQty: n(line.recheckAcceptedQty ?? line.gateQty), rejectedQty: n(line.recheckRejectedQty ?? '0'), reason: line.recheckReason,
      measuredQty: n(line.measuredQty), billedRate: n(line.billedRate), expiresOn: line.expiresOn ?? '',
    });
  }, [line?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const doneCount = lines.filter((l: any) => l.recheckAcceptedQty != null && l.billedRate != null).length;
  if (!lines.length) return <p>Nothing came through the gate.</p>;

  async function saveLine() {
    const body = {
      acceptedQty: v.acceptedQty || '0', rejectedQty: v.rejectedQty || '0', reason: Number(v.rejectedQty) > 0 ? v.reason : null,
      measuredQty: v.measuredQty || null, billedRate: v.billedRate || null, expiresOn: v.expiresOn || null,
    };
    save({
      ...d,
      lines: d.lines.map((l: any) =>
        l.id === line.id ? { ...l, recheckAcceptedQty: body.acceptedQty, recheckRejectedQty: body.rejectedQty, recheckReason: body.reason, measuredQty: body.measuredQty, billedRate: body.billedRate, expiresOn: body.expiresOn } : l,
      ),
    });
    await queue.add({ kind: 'json', method: 'PUT', path: `/deliveries/${d.id}/recheck/${line.id}`, body, label: `Re-check: ${line.name}` });
    if (i < lines.length - 1) setI(i + 1);
  }
  const over = Number(v.acceptedQty || 0) + Number(v.rejectedQty || 0) > Number(line.gateQty);

  return (
    <div className="stack">
      <p className="muted">
        Line {i + 1} of {lines.length} · {doneCount} done
      </p>
      <div className="card stack">
        <div className="big">{line.name}</div>
        <div>
          Through the gate: <strong>{n(line.gateQty)} {line.unit}</strong>
        </div>
        <div className="row">
          <label className="field">
            Usable ({line.unit})
            <input inputMode="decimal" value={v.acceptedQty ?? ''} onChange={(e) => setV({ ...v, acceptedQty: e.target.value })} />
          </label>
          <label className="field">
            Not usable ({line.unit})
            <input inputMode="decimal" value={v.rejectedQty ?? ''} onChange={(e) => setV({ ...v, rejectedQty: e.target.value })} />
          </label>
        </div>
        {Number(v.rejectedQty) > 0 && (
          <div className="chips">
            {RECHECK_REASONS.map(([k, label]) => (
              <button key={k} className="secondary" aria-pressed={v.reason === k} onClick={() => setV({ ...v, reason: k })}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="row">
          <label className="field">
            Weighed / counted
            <input inputMode="decimal" value={v.measuredQty ?? ''} onChange={(e) => setV({ ...v, measuredQty: e.target.value })} />
          </label>
          {line.perishable && (
            <label className="field">
              Expiry date
              <input type="date" value={v.expiresOn ?? ''} onChange={(e) => setV({ ...v, expiresOn: e.target.value })} />
            </label>
          )}
        </div>
        {showRates && (
          <label className="field">
            Rate on the vendor's bill (₹ per {line.unit})
            <input inputMode="decimal" value={v.billedRate ?? ''} onChange={(e) => setV({ ...v, billedRate: e.target.value })} />
          </label>
        )}
        {over && <p className="note danger">More than came through the gate.</p>}
        <div className="row">
          <PhotoButton deliveryId={d.id} lineId={line.id} purpose="recheck_photo" />
          <button disabled={over || !v.acceptedQty || (Number(v.rejectedQty) > 0 && !v.reason) || (showRates && !v.billedRate)} onClick={saveLine}>
            Save line
          </button>
        </div>
      </div>
      <div className="row">
        <button className="secondary" disabled={i === 0} onClick={() => setI(i - 1)}>
          <ArrowLeft className="icon" aria-hidden /> Previous
        </button>
        <button className="secondary" disabled={i === lines.length - 1} onClick={() => setI(i + 1)}>
          Next <ArrowRight className="icon" aria-hidden />
        </button>
      </div>
      <div className="card stack">
        <h3>Vendor's bill</h3>
        <label className="field">
          Bill number
          <input value={billNo} onChange={(e) => setBillNo(e.target.value)} />
        </label>
        <PhotoButton deliveryId={d.id} purpose="vendor_bill" label="Photo of the bill" />
      </div>
      <button
        className="huge gold"
        style={{ width: '100%' }}
        disabled={doneCount < lines.length}
        onClick={async () => {
          save({ ...d, status: 'rechecked', vendorBillNo: billNo });
          await queue.add({ kind: 'json', method: 'POST', path: `/deliveries/${d.id}/recheck/complete`, body: { vendorBillNo: billNo || null }, label: 'Finish re-check' });
          toast('Re-check done. Now both of you sign the goods received note.');
        }}
      >
        <PackageCheck className="icon" aria-hidden /> Finish re-check ({doneCount}/{lines.length})
      </button>
    </div>
  );
}

// ---------- Goods received note sign-off ----------

function SignOff({ d, outletId, reload }: { d: any; outletId: string; reload: () => void }) {
  const grn = useLoad<any>(`grn.${d.grn?.id}`, d.grn ? `/grns/${d.grn.id}` : null);
  const g = grn.data;
  if (!d.grn) return <p className="muted">The goods received note appears here once the re-check has reached the server.</p>;
  const confirm = async (as: 'watchman' | 'staff') => {
    await queue.add({ kind: 'json', method: 'POST', path: `/grns/${d.grn.id}/confirm`, body: { as }, label: `Confirm as ${as}` });
    setTimeout(() => (grn.load(), reload()), 600);
  };
  return (
    <div className="stack">
      <div className="card stack">
        <h2>{d.grn.number}</h2>
        <p>
          Status: <span className="badge">{(g?.status ?? d.grn.status).replace('_', ' ')}</span>
        </p>
        <ul>
          {(g?.lines ?? []).map((l: any) => (
            <li key={l.id}>
              {l.name}: {n(l.acceptedQty)} {l.unit}
            </li>
          ))}
        </ul>
        {g?.returns?.length > 0 && (
          <>
            <h3>Going back to the vendor</h3>
            <ul>
              {g.returns.map((r: any) => (
                <li key={r.id}>
                  {r.name}: {n(r.qty)} ({r.reason})
                </li>
              ))}
            </ul>
          </>
        )}
        <p>
          Watchman: {g?.watchmanConfirmedAt ? '✓ signed' : 'not yet'} · Staff: {g?.staffConfirmedAt ? '✓ signed' : 'not yet'}
        </p>
      </div>
      {g?.status === 'awaiting_signoff' && (
        <div className="row">
          {session.can('receiving.gate', outletId) && !g.watchmanConfirmedAt && (
            <button className="good huge" onClick={() => confirm('watchman')}>
              <Check className="icon" aria-hidden /> Sign as watchman
            </button>
          )}
          {session.can('receiving.recheck', outletId) && !g.staffConfirmedAt && (
            <button className="good huge" onClick={() => confirm('staff')}>
              <Check className="icon" aria-hidden /> Sign as staff
            </button>
          )}
        </div>
      )}
      {g?.status === 'held_rate' && <p className="note">A billed rate is well above the last one. A manager needs to release this note.</p>}
      {g?.status === 'approved' && (
        <p className="note success">
          <PackageCheck className="icon" aria-hidden /> All done: the goods are in stock and the note has gone to accounts.
        </p>
      )}
    </div>
  );
}

// ---------- Screens ----------

function DeliveryScreen({ id, outletId, back }: { id: string; outletId: string; back: () => void }) {
  const d = useLoad<any>(`delivery.${id}`, `/deliveries/${id}`);
  const q = queue.use();
  useWhenSynced(q.pending, d.load);
  const delivery = d.data;
  if (!delivery) return <p className="wrap">{d.error ?? 'Loading…'}</p>;
  const canGate = session.can('receiving.gate', outletId);
  const canRecheck = session.can('receiving.recheck', outletId);
  return (
    <div className="wrap stack">
      <button className="ghost" onClick={back} style={{ paddingLeft: 0 }}>
        <ArrowLeft className="icon" aria-hidden /> All deliveries
      </button>
      <div>
        <div className="muted" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
          {STEP[delivery.status] ?? ''}
        </div>
        <h1>{delivery.vendor.name}</h1>
        <p className="muted" style={{ margin: 0 }}>
          Expected {delivery.expectedOn}
        </p>
      </div>
      {delivery.status === 'expected' &&
        (canGate ? <Gate d={delivery} save={d.setData} /> : <p className="note">Waiting for the watchman's gate check.</p>)}
      {delivery.status === 'gate_checked' &&
        (canRecheck ? <Recheck d={delivery} save={d.setData} showRates={session.can('rates.view', outletId)} /> : <p className="note">Gate check done. Waiting for the staff re-check.</p>)}
      {['rechecked', 'closed'].includes(delivery.status) && <SignOff d={delivery} outletId={outletId} reload={d.load} />}
    </div>
  );
}

const STATUS: Record<string, [string, string]> = {
  expected: ['Waiting at the gate', 'warning'],
  gate_checked: ['Ready for staff re-check', 'gold'],
  rechecked: ['Waiting for signatures', 'gold'],
  closed: ['Done', 'success'],
};
const STEP: Record<string, string> = { expected: 'Step 1 of 3 · Gate check', gate_checked: 'Step 2 of 3 · Staff re-check', rechecked: 'Step 3 of 3 · Sign the note', closed: 'Finished' };

function Home() {
  const s = session.use()!;
  const outletId = session.outletId()!;
  const today = istDate(new Date());
  const list = useLoad<any[]>(`list.${outletId}`, `/deliveries?outletId=${outletId}&open=1`);
  const [open, setOpen] = useState<string | null>(null);
  const q = queue.use();
  useWhenSynced(q.pending, list.load);
  return (
    <>
      <header className="bar">
        <span className="logo" role="img" aria-label="Logo" />
        <span className="spacer" />
        {s.outlets.length > 1 && (
          <select aria-label="Outlet" value={outletId} onChange={(e) => session.setOutlet(e.target.value)} style={{ width: 'auto' }}>
            {s.outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <button className="ghost" onClick={() => session.set(null)} title="Sign out">
          <span className="avatar">{initials(s.user.name)}</span>
          <LogOut className="icon" aria-hidden />
          <span className="sr-only">Sign out</span>
        </button>
      </header>
      <OfflineBar q={q} />
      {open ? (
        <DeliveryScreen id={open} outletId={outletId} back={() => (setOpen(null), list.load())} />
      ) : (
        <main className="wrap">
          <div className="row" style={{ marginBottom: '0.9rem' }}>
            <div style={{ flex: 3 }}>
              <div className="muted" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Hello, {s.user.name.replace(/\s*\(.*\)/, '')}
              </div>
              <h1>Deliveries</h1>
            </div>
            <button className="secondary icon-only" onClick={list.load} aria-label="Refresh" style={{ flex: '0 0 auto' }}>
              <RefreshCw className="icon" />
            </button>
          </div>
          {list.error && <p className="note danger">{list.error}</p>}
          {(list.data ?? []).map((d) => (
            <button key={d.id} className="tap" onClick={() => setOpen(d.id)}>
              <span className="tap-icon" aria-hidden>
                <Truck className="icon" />
              </span>
              <span className="tap-body">
                <strong style={{ display: 'block', fontSize: '1.1rem' }}>{d.vendor}</strong>
                <span className="muted">
                  {d.expectedOn === today ? 'Today' : d.expectedOn} · {d.lineCount} items
                </span>
                <span style={{ display: 'block', marginTop: '0.35rem' }}>
                  <span className={`badge ${STATUS[d.status]?.[1] ?? ''}`}>{STATUS[d.status]?.[0] ?? d.status}</span>
                </span>
              </span>
              <ChevronRight className="icon muted" aria-hidden />
            </button>
          ))}
          {list.data?.length === 0 && (
            <div className="card" style={{ textAlign: 'center' }}>
              <PackageCheck className="icon" aria-hidden style={{ width: 36, height: 36, color: 'var(--brand-accent-strong)' }} />
              <h2>All caught up</h2>
              <p className="muted">No deliveries are waiting. New ones appear here before 5:00 am.</p>
            </div>
          )}
        </main>
      )}
    </>
  );
}

function App() {
  const s = session.use();
  if (!s) return <Login session={session} title="Receiving" subtitle="For the gate check and the morning re-check of deliveries." />;
  if (!s.outlets.length) return <p className="wrap">You are not assigned to an outlet.</p>;
  return <Home />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toasts />
  </StrictMode>,
);

import { useState } from 'react';
import { businessDate } from '@fnb/shared';
import { api, can, useApi, useCurrentOutlet, useSession } from '../api';
import { useLive } from '../live';
import { AskDialog, Badge, ErrorNote, Modal, Page, rupee, toast } from '../ui';

// Base units read better as kg / L once they are large.
export function fmtQty(q: string | number | null | undefined, unit: string) {
  if (q == null) return '—';
  const n = Number(q);
  if ((unit === 'g' || unit === 'ml') && Math.abs(n) >= 1000) return `${(n / 1000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${unit === 'g' ? 'kg' : 'L'}`;
  return `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${unit}`;
}

const STATUS_TONE = { healthy: 'success', reorder: 'warning', critical: 'danger', out: 'danger' } as const;
const STATUS_LABEL = { healthy: 'Healthy', reorder: 'Reorder', critical: 'Critical', out: 'Out' } as const;

export function StockPage() {
  const s = useSession();
  const outletId = useCurrentOutlet();
  const [dept, setDept] = useState<'food' | 'beverage'>('food');
  const [filter, setFilter] = useState('');
  const stock = useApi<any>(outletId ? `/inventory/stock?outletId=${outletId}&department=${dept}` : null);
  const [dialog, setDialog] = useState<null | 'wastage' | 'transfer' | { ledger: any }>(null);
  useLive(['stock'], () => stock.reload());
  if (!outletId) return null;
  const items = (stock.data?.items ?? []).filter((i: any) => i.name.toLowerCase().includes(filter.toLowerCase()));
  const stores = stock.data?.stores ?? [];
  const totalValue = items.reduce((a: number, i: any) => a + Number(i.value ?? 0), 0);

  return (
    <Page
      title="Stock"
      intro="Live stock by store. Every change is a ledger entry; open an item to see its movements. Updates arrive as they happen."
      actions={
        <>
          {can(s, 'inventory.wastage', outletId) && (
            <button className="secondary" onClick={() => setDialog('wastage')}>
              Record wastage
            </button>
          )}
          {can(s, 'inventory.transfer', outletId) && <button onClick={() => setDialog('transfer')}>Transfer</button>}
        </>
      }
    >
      <div className="row" style={{ marginBottom: '1rem' }}>
        <div className="tabs" role="tablist" style={{ margin: 0 }}>
          {(['food', 'beverage'] as const).map((d) => (
            <button key={d} role="tab" aria-selected={dept === d} className={dept === d ? '' : 'ghost'} onClick={() => setDept(d)}>
              {d === 'food' ? 'Food' : 'Beverage'}
            </button>
          ))}
        </div>
        <input aria-label="Search" placeholder="Search items" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 280 }} />
        {stock.data?.items.some((i: any) => i.value != null) && <strong>Stock value: {rupee(totalValue)}</strong>}
      </div>
      <ErrorNote error={stock.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              {stores.map((st: any) => (
                <th key={st.id}>{st.name}</th>
              ))}
              <th>Total</th>
              <th>Par</th>
              <th>Status</th>
              {items.some((i: any) => i.value != null) && <th>Value</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((i: any) => (
              <tr key={i.id}>
                <td>
                  <button className="ghost" style={{ padding: 0, minHeight: 0 }} onClick={() => setDialog({ ledger: i })}>
                    {i.name}
                  </button>
                </td>
                {stores.map((st: any) => (
                  <td key={st.id}>{i.byStore[st.id] ? fmtQty(i.byStore[st.id], i.baseUnit) : <span className="muted">—</span>}</td>
                ))}
                <td>
                  <strong>{fmtQty(i.total, i.baseUnit)}</strong>
                  {i.bottleSizeMl && <div className="muted">{(Number(i.total) / Number(i.bottleSizeMl)).toFixed(2)} bottles</div>}
                </td>
                <td>{i.levels ? fmtQty(i.levels.parLevel, i.baseUnit) : '—'}</td>
                <td>
                  <Badge tone={STATUS_TONE[i.status as keyof typeof STATUS_TONE]}>{STATUS_LABEL[i.status as keyof typeof STATUS_LABEL]}</Badge>
                </td>
                {i.value != null && <td>{rupee(i.value)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={dialog === 'wastage'} title="Record wastage" onClose={() => setDialog(null)}>
        <WastageForm outletId={outletId} stores={stores} onDone={() => (setDialog(null), stock.reload())} />
      </Modal>
      <Modal open={dialog === 'transfer'} title="Transfer between stores" onClose={() => setDialog(null)} wide>
        <TransferForm stores={stores} onDone={() => (setDialog(null), stock.reload())} />
      </Modal>
      <Modal open={!!dialog && typeof dialog === 'object'} title={typeof dialog === 'object' && dialog ? `Movements: ${dialog.ledger.name}` : ''} onClose={() => setDialog(null)} wide>
        {typeof dialog === 'object' && dialog && <Ledger outletId={outletId} item={dialog.ledger} />}
      </Modal>
    </Page>
  );
}

function useStockItems() {
  return useApi<any[]>('/stock-items');
}

function WastageForm({ outletId, stores, onDone }: { outletId: string; stores: any[]; onDone: () => void }) {
  const s = useSession();
  const items = useStockItems();
  const [v, setV] = useState<any>({ movement: 'wastage', storeId: stores.find((x) => x.kind === 'kitchen')?.id });
  const [error, setError] = useState<string | null>(null);
  const unit = items.data?.find((i) => i.id === v.stockItemId)?.baseUnit ?? '';
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api('/inventory/movements', { body: v });
      toast(r.status === 'pending' ? 'Sent to a manager for approval' : 'Wastage recorded');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form onSubmit={save}>
      <div className="grid">
        <div className="field">
          <label htmlFor="w-type">What happened</label>
          <select id="w-type" value={v.movement} onChange={(e) => setV({ ...v, movement: e.target.value })}>
            <option value="wastage">Wastage</option>
            <option value="spillage">Spillage</option>
            <option value="breakage">Breakage</option>
            <option value="complimentary">Complimentary</option>
            <option value="staff_meal">Staff meal</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="w-store">Store</label>
          <select id="w-store" value={v.storeId ?? ''} onChange={(e) => setV({ ...v, storeId: e.target.value })}>
            {stores.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="w-item">Item</label>
          <select id="w-item" required value={v.stockItemId ?? ''} onChange={(e) => setV({ ...v, stockItemId: e.target.value })}>
            <option value="">Choose…</option>
            {(items.data ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="w-qty">Quantity {unit && `(${unit})`}</label>
          <input id="w-qty" inputMode="decimal" required value={v.qty ?? ''} onChange={(e) => setV({ ...v, qty: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="w-reason">Reason</label>
        <input id="w-reason" required minLength={3} value={v.reason ?? ''} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </div>
      <p className="muted">
        {['complimentary', 'staff_meal'].includes(v.movement) || !can(s, 'inventory.writeOff', outletId)
          ? 'This will go to a manager for approval before stock changes.'
          : 'This changes stock straight away.'}
      </p>
      <ErrorNote error={error} />
      <footer className="row end">
        <button>Save</button>
      </footer>
    </form>
  );
}

function TransferForm({ stores, onDone }: { stores: any[]; onDone: () => void }) {
  const items = useStockItems();
  const [from, setFrom] = useState(stores.find((s) => s.kind === 'main')?.id ?? '');
  const [to, setTo] = useState(stores.find((s) => s.kind === 'kitchen')?.id ?? '');
  const [lines, setLines] = useState<{ stockItemId: string; qty: string }[]>([{ stockItemId: '', qty: '' }]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/inventory/transfers', { body: { fromStoreId: from, toStoreId: to, note, lines: lines.filter((l) => l.stockItemId) } });
      toast('Transfer done');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const storeSelect = (id: string, value: string, set: (v: string) => void, label: string) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => set(e.target.value)}>
        {stores.map((st) => (
          <option key={st.id} value={st.id}>
            {st.name}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <form onSubmit={save}>
      <div className="grid">
        {storeSelect('t-from', from, setFrom, 'From')}
        {storeSelect('t-to', to, setTo, 'To')}
        <div className="field">
          <label htmlFor="t-note">Note</label>
          <input id="t-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <fieldset className="field">
        <legend>Items</legend>
        {lines.map((l, i) => (
          <div key={i} className="row">
            <select aria-label="Item" value={l.stockItemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, stockItemId: e.target.value } : x)))}>
              <option value="">Choose…</option>
              {(items.data ?? []).map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name} ({it.baseUnit})
                </option>
              ))}
            </select>
            <input aria-label="Quantity" inputMode="decimal" placeholder="Quantity" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} style={{ maxWidth: 140 }} />
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => setLines([...lines, { stockItemId: '', qty: '' }])}>
          Add item
        </button>
      </fieldset>
      <ErrorNote error={error} />
      <footer className="row end">
        <button>Transfer</button>
      </footer>
    </form>
  );
}

const MOVE_LABEL: Record<string, string> = {
  opening: 'Opening', goods_receipt: 'Goods receipt', sale: 'Sale', transfer_out: 'Transfer out', transfer_in: 'Transfer in',
  wastage: 'Wastage', spillage: 'Spillage', breakage: 'Breakage', complimentary: 'Complimentary', staff_meal: 'Staff meal',
  count_correction: 'Count correction', return_to_vendor: 'Return to vendor', reversal: 'Reversal',
};

function Ledger({ outletId, item }: { outletId: string; item: any }) {
  const s = useSession();
  const rows = useApi<any[]>(`/inventory/ledger?outletId=${outletId}&stockItemId=${item.id}`);
  const [error, setError] = useState<string | null>(null);
  const [reversing, setReversing] = useState<number | null>(null);
  async function reverse(id: number, reason: string) {
    setReversing(null);
    try {
      const r = await api('/inventory/reversals', { body: { ledgerId: id, reason } });
      toast(r.status === 'pending' ? 'Reversal sent for approval' : 'Entry reversed');
      rows.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <ErrorNote error={error ?? rows.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Movement</th>
              <th>Store</th>
              <th>Quantity</th>
              <th>Cost / unit</th>
              <th>By</th>
              <th>Reason</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {(rows.data ?? []).map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{MOVE_LABEL[r.movement] ?? r.movement}</td>
                <td>{r.store}</td>
                <td style={{ color: Number(r.qty) < 0 ? 'var(--brand-danger)' : 'var(--brand-success)' }}>{fmtQty(r.qty, r.unit)}</td>
                <td>{r.unitCost ? `₹${Number(r.unitCost).toFixed(4)}` : '—'}</td>
                <td>{r.user ?? <span className="muted">system</span>}</td>
                <td>{r.reason}</td>
                <td>
                  {can(s, 'inventory.wastage', outletId) && !['sale', 'reversal'].includes(r.movement) && (
                    <button className="link" onClick={() => setReversing(r.id)}>
                      Reverse
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AskDialog
        open={reversing != null}
        title="Reverse this entry"
        label="Why? (for example: entered twice)"
        confirm="Reverse"
        onAnswer={(reason) => reverse(reversing!, reason)}
        onClose={() => setReversing(null)}
      />
    </>
  );
}

// ---------- Stock counts ----------

export function CountsPage() {
  const s = useSession();
  const outletId = useCurrentOutlet();
  const counts = useApi<any[]>(outletId ? `/inventory/counts?outletId=${outletId}` : null);
  const stores = useApi<any[]>(outletId ? `/outlets/${outletId}/stores` : null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ scheduledFor: businessDate(new Date()) });
  const [error, setError] = useState<string | null>(null);
  if (!outletId) return null;
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
    <Page title="Stock counts" intro="Schedule a count, count the shelves, and the gap to the books is shown as variance by item and cause. Corrections post once a manager approves.">
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
          <button style={{ alignSelf: 'flex-end' }}>Schedule count</button>
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
                <td>{c.scheduledFor}</td>
                <td>{c.store}</td>
                <td>
                  <Badge tone={c.status === 'approved' ? 'success' : c.status === 'submitted' ? 'warning' : 'neutral'}>{c.status}</Badge>
                </td>
                <td className="actions">
                  <button className="ghost" onClick={() => setOpen(c.id)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!open} title="Stock count" onClose={() => (setOpen(null), counts.reload())} wide>
        {open && <CountSheet id={open} />}
      </Modal>
    </Page>
  );
}

function CountSheet({ id }: { id: string }) {
  const count = useApi<any>(`/inventory/counts/${id}`);
  const [edits, setEdits] = useState<Record<string, { countedQty: string; cause: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const c = count.data;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
      await count.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = () =>
    run(() =>
      api(`/inventory/counts/${id}/lines`, {
        method: 'PUT',
        body: Object.entries(edits).map(([stockItemId, v]) => ({ stockItemId, countedQty: v.countedQty === '' ? null : v.countedQty, cause: v.cause || null })),
      }),
    );
  if (!c) return <ErrorNote error={count.error} />;
  return (
    <>
      <p>
        {c.scheduledFor} · <Badge>{c.status}</Badge>
      </p>
      {c.status === 'scheduled' && <button onClick={() => run(() => api(`/inventory/counts/${id}/start`, { method: 'POST' }))}>Start counting</button>}
      {c.lines.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Books say</th>
                <th>Counted</th>
                <th>Variance</th>
                <th>Cause</th>
              </tr>
            </thead>
            <tbody>
              {c.lines.map((l: any) => (
                <tr key={l.stockItemId}>
                  <td>{l.name}</td>
                  <td>{fmtQty(l.expectedQty, l.unit)}</td>
                  <td>
                    {c.status === 'counting' ? (
                      <input
                        aria-label={`Counted ${l.name}`}
                        inputMode="decimal"
                        defaultValue={l.countedQty ?? ''}
                        onChange={(e) => setEdits({ ...edits, [l.stockItemId]: { cause: edits[l.stockItemId]?.cause ?? l.cause ?? '', countedQty: e.target.value } })}
                      />
                    ) : (
                      fmtQty(l.countedQty, l.unit)
                    )}
                  </td>
                  <td>
                    {l.variance != null && Number(l.variance) !== 0 ? (
                      <span style={{ color: 'var(--brand-danger)' }}>
                        {fmtQty(l.variance, l.unit)} {l.varianceValue && `(${rupee(l.varianceValue)})`}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {c.status === 'counting' ? (
                      <input
                        aria-label={`Cause for ${l.name}`}
                        defaultValue={l.cause ?? ''}
                        onChange={(e) => setEdits({ ...edits, [l.stockItemId]: { countedQty: edits[l.stockItemId]?.countedQty ?? l.countedQty ?? '', cause: e.target.value } })}
                      />
                    ) : (
                      l.cause
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ErrorNote error={error} />
      {c.status === 'counting' && (
        <footer className="row end">
          <button className="secondary" onClick={save}>
            Save counts
          </button>
          <button onClick={() => run(async () => (await save(), api(`/inventory/counts/${id}/submit`, { method: 'POST' })))}>Submit for approval</button>
        </footer>
      )}
    </>
  );
}

// ---------- Approvals ----------

export function ApprovalsPage() {
  const outletId = useCurrentOutlet();
  const [status, setStatus] = useState('pending');
  const list = useApi<any[]>(`/approvals?status=${status}${outletId ? `&outletId=${outletId}` : ''}`);
  const [error, setError] = useState<string | null>(null);
  useLive(['approval'], () => list.reload());
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
          <button onClick={() => window.print()}>Print</button>
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

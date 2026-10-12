import { useEffect, useState } from 'react';
import { businessDate, istDate } from '@fnb/shared';
import { api, apiBlob, can, saveBlob, useApi, useCurrentOutlet, useSession } from '../api';
import { useLive } from '../live';
import { Badge, CrudPage, ErrorNote, Modal, Page, rupee, toast, yesNo } from '../ui';
import { fmtQty } from './inventory';

const qty = (v: string | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
// The next 5:00 am delivery.
const nextDelivery = () => {
  const now = new Date();
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  return hhmm >= '05:00' ? istDate(new Date(now.getTime() + 86_400_000)) : istDate(now);
};

// ---------- Vendors and rate history ----------

export function VendorsPage() {
  const s = useSession();
  const [items, setItems] = useState<any | null>(null);
  const [tab, setTab] = useState<'vendors' | 'rates'>('vendors');
  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'vendors'} className={tab === 'vendors' ? '' : 'ghost'} onClick={() => setTab('vendors')}>
          Vendors
        </button>
        {can(s, 'rates.view') && (
          <button role="tab" aria-selected={tab === 'rates'} className={tab === 'rates' ? '' : 'ghost'} onClick={() => setTab('rates')}>
            Rate history
          </button>
        )}
      </div>
      {tab === 'vendors' ? (
        <CrudPage
          singular="vendor"
          title="Vendors"
          intro="Who supplies what. Each vendor's items set the purchase unit and pack size the nightly indent rounds up to."
          path="/vendors"
          canManage={can(s, 'vendors.manage')}
          columns={[
            { label: 'Name', render: (r: any) => r.name },
            { label: 'Part', render: (r: any) => ({ food: 'Food', beverage: 'Beverage', both: 'Both' })[r.department as string] },
            { label: 'Contact', render: (r: any) => [r.contactName, r.phone].filter(Boolean).join(' · ') || '—' },
            {
              label: 'Supplies',
              render: (r: any) => (
                <button className="ghost" onClick={() => setItems(r)}>
                  Items
                </button>
              ),
            },
            { label: 'Status', render: (r: any) => yesNo(r.active) },
          ]}
          defaults={{ department: 'food', active: true }}
          fields={[
            { name: 'name', label: 'Name', required: true },
            { name: 'department', label: 'Part', type: 'select', required: true, options: [{ value: 'food', label: 'Food' }, { value: 'beverage', label: 'Beverage' }, { value: 'both', label: 'Both' }] },
            { name: 'contactName', label: 'Contact person' },
            { name: 'phone', label: 'Phone (for WhatsApp)' },
            { name: 'email', label: 'Email' },
            { name: 'gstin', label: 'GSTIN' },
            { name: 'address', label: 'Address', type: 'textarea' },
            { name: 'active', label: 'Active', type: 'checkbox' },
          ]}
        />
      ) : (
        <RateHistory />
      )}
      <Modal open={!!items} title={`What ${items?.name ?? ''} supplies`} onClose={() => setItems(null)} wide>
        {items && <VendorItems vendor={items} onDone={() => setItems(null)} />}
      </Modal>
    </>
  );
}

function VendorItems({ vendor, onDone }: { vendor: any; onDone: () => void }) {
  const current = useApi<any[]>(`/vendors/${vendor.id}/items`);
  const stock = useApi<any[]>('/stock-items');
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (current.data && !rows) setRows(current.data.map((r) => ({ stockItemId: r.stockItemId, unitId: r.unitId, packSize: qty(r.packSize), preferred: r.preferred, lastRate: r.lastRate })));
  }, [current.data, rows]);
  const set = (i: number, k: string, v: any) => setRows(rows!.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  async function save() {
    try {
      await api(`/vendors/${vendor.id}/items`, { method: 'PUT', body: rows!.filter((r) => r.stockItemId).map(({ lastRate: _l, ...r }) => r) });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!rows) return <p className="muted">Loading…</p>;
  const options = (stock.data ?? []).filter((i) => vendor.department === 'both' || i.department === vendor.department);
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Bought as</th>
              <th>Pack size</th>
              <th>Preferred</th>
              <th>Last rate</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const units = stock.data?.find((x) => x.id === r.stockItemId)?.units ?? [];
              return (
                <tr key={i}>
                  <td>
                    <select aria-label="Item" value={r.stockItemId ?? ''} onChange={(e) => set(i, 'stockItemId', e.target.value)}>
                      <option value="">Choose…</option>
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select aria-label="Purchase unit" value={r.unitId ?? ''} onChange={(e) => set(i, 'unitId', e.target.value || null)}>
                      <option value="">Base unit</option>
                      {units.map((u: any) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input aria-label="Pack size" inputMode="decimal" value={r.packSize} onChange={(e) => set(i, 'packSize', e.target.value)} style={{ maxWidth: 100 }} />
                  </td>
                  <td>
                    <input type="checkbox" aria-label="Preferred vendor" checked={r.preferred} onChange={(e) => set(i, 'preferred', e.target.checked)} />
                  </td>
                  <td>{r.lastRate ? `${rupee(r.lastRate.rate)} on ${r.lastRate.billedOn}` : '—'}</td>
                  <td>
                    <button className="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button className="secondary" onClick={() => setRows([...rows, { stockItemId: '', unitId: null, packSize: '1', preferred: true }])} style={{ marginTop: '0.5rem' }}>
        Add item
      </button>
      <ErrorNote error={error} />
      <footer className="row end">
        <button onClick={save}>Save</button>
      </footer>
    </>
  );
}

function RateHistory() {
  const [dept, setDept] = useState('food');
  const rates = useApi<any[]>(`/vendor-rates?department=${dept}`);
  return (
    <Page title="Rate history" intro="Every billed rate from vendors' bills, newest first. The latest rate drives menu costing.">
      <div className="tabs" role="tablist">
        {['food', 'beverage'].map((d) => (
          <button key={d} role="tab" aria-selected={dept === d} className={dept === d ? '' : 'ghost'} onClick={() => setDept(d)}>
            {d === 'food' ? 'Food' : 'Beverage'}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Item</th>
              <th>Vendor</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {(rates.data ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.billedOn}</td>
                <td>{r.item}</td>
                <td>{r.vendor}</td>
                <td>
                  {rupee(r.rate)} <span className="muted">/ {r.unit ?? 'unit'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

// ---------- Nightly indent ----------

export function IndentsPage() {
  const outletId = useCurrentOutlet();
  const [date, setDate] = useState(nextDelivery());
  const list = useApi<any[]>(outletId ? `/indents?outletId=${outletId}&forDate=${date}` : null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!outletId) return null;
  async function build() {
    try {
      const r = await api('/indents/build', { body: { outletId, forDate: date } });
      toast(`${r.indents.length} vendor order${r.indents.length === 1 ? '' : 's'} built`);
      setMsg(r.unassigned.length ? `No vendor is set for: ${r.unassigned.join(', ')}. Add them under Vendors and rates.` : null);
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Page
      title="Nightly indent"
      intro="Built every night at the cut-off: par level − stock on hand − already on order, rounded up to each vendor's pack size. Approve, then share the PDF with the vendor."
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
            <button onClick={() => setOpen(i.id)}>Open</button>
          </article>
        ))}
        {list.data?.length === 0 && <p className="muted">No orders for this date yet.</p>}
      </div>
      <Modal open={!!open} title="Vendor order" onClose={() => (setOpen(null), list.reload())} wide>
        {open && <IndentDetail id={open} />}
      </Modal>
    </Page>
  );
}

function IndentDetail({ id }: { id: string }) {
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

// ---------- Deliveries and goods received notes ----------

const GRN_STATUS: Record<string, [string, 'neutral' | 'success' | 'warning' | 'danger']> = {
  awaiting_signoff: ['Awaiting signatures', 'neutral'],
  held_rate: ['Held: rate rise', 'danger'],
  approved: ['Awaiting payment', 'warning'],
  paid: ['Paid', 'success'],
  cancelled: ['Cancelled', 'neutral'],
};

export function DeliveriesPage() {
  const outletId = useCurrentOutlet();
  const [date, setDate] = useState(businessDate(new Date()));
  const list = useApi<any[]>(outletId ? `/deliveries?outletId=${outletId}&date=${date}` : null);
  const [grn, setGrn] = useState<string | null>(null);
  useLive(['stock'], () => list.reload());
  return (
    <Page
      title="Deliveries"
      intro="This morning's deliveries as they move through the gate check, the staff re-check and the goods received note. The watchman and staff use the receiving app on their phones at /receiving/."
      actions={<input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />}
    >
      <ErrorNote error={list.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Items</th>
              <th>Stage</th>
              <th>Goods received note</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((d) => (
              <tr key={d.id}>
                <td>{d.vendor}</td>
                <td>{d.lineCount}</td>
                <td>{{ expected: 'At the gate', gate_checked: 'Re-check', rechecked: 'Signatures', closed: 'Done' }[d.status as string]}</td>
                <td>
                  {d.grn ? (
                    <button className="ghost" onClick={() => setGrn(d.grn.id)}>
                      {d.grn.number} · {GRN_STATUS[d.grn.status]?.[0]}
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No deliveries on this date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Modal open={!!grn} title="Goods received note" onClose={() => setGrn(null)} wide>
        {grn && <GrnDetail id={grn} />}
      </Modal>
    </Page>
  );
}

export function GrnsPage() {
  const s = useSession();
  const outletId = useCurrentOutlet();
  const [status, setStatus] = useState('approved');
  const list = useApi<any[]>(outletId ? `/grns?outletId=${outletId}&status=${status}` : null);
  const [open, setOpen] = useState<string | null>(null);
  const [range, setRange] = useState({ from: istDate(new Date(Date.now() - 30 * 86_400_000)), to: istDate(new Date()) });
  if (!outletId) return null;
  async function exportCsv() {
    saveBlob(await apiBlob(`/grns/export/csv?outletId=${outletId}&from=${range.from}&to=${range.to}`), `goods-received-${range.from}-to-${range.to}.csv`);
  }
  return (
    <Page
      title="Accounts: goods received notes"
      intro="Notes reach accounts once the watchman and staff have both signed. A note held for a rate rise cannot be paid until a manager releases it."
      actions={
        <>
          <input type="date" aria-label="From" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <input type="date" aria-label="To" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          <button className="secondary" onClick={exportCsv}>
            Export CSV
          </button>
        </>
      }
    >
      <div className="tabs" role="tablist">
        {['approved', 'held_rate', 'awaiting_signoff', 'paid'].map((x) => (
          <button key={x} role="tab" aria-selected={status === x} className={status === x ? '' : 'ghost'} onClick={() => setStatus(x)}>
            {GRN_STATUS[x][0]}
          </button>
        ))}
      </div>
      <ErrorNote error={list.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Note</th>
              <th>Received</th>
              <th>Vendor</th>
              <th>Bill</th>
              <th>Returns</th>
              <th>Payable</th>
              <th>Paid</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((g) => (
              <tr key={g.id}>
                <td>{g.number}</td>
                <td>{istDate(new Date(g.createdAt))}</td>
                <td>{g.vendor}</td>
                <td>{rupee(g.amountGross)}</td>
                <td>{Number(g.returnDeduction) ? `− ${rupee(g.returnDeduction)}` : '—'}</td>
                <td>
                  <strong>{rupee(g.amountPayable)}</strong>
                </td>
                <td>{rupee(g.paid)}</td>
                <td className="actions">
                  <button className="ghost" onClick={() => setOpen(g.id)}>
                    {can(s, 'accounts.pay', outletId) && g.status === 'approved' ? 'Record payment' : 'Open'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!open} title="Goods received note" onClose={() => (setOpen(null), list.reload())} wide>
        {open && <GrnDetail id={open} />}
      </Modal>
    </Page>
  );
}

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

function GrnDetail({ id }: { id: string }) {
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

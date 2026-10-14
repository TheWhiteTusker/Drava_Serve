import { useState } from 'react';
import { api, can, useApi, useSession } from '../../api';
import { ErrorNote, toast } from '../../ui';

function useStockItems() {
  return useApi<any[]>('/stock-items');
}

export function WastageForm({ outletId, stores, onDone }: { outletId: string; stores: any[]; onDone: () => void }) {
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

export function TransferForm({ stores, onDone }: { stores: any[]; onDone: () => void }) {
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

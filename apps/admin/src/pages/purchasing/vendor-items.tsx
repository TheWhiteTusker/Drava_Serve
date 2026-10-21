import { useEffect, useState } from 'react';
import { api, useApi } from '../../api';
import { ErrorNote, rupee } from '../../ui';
import { qty } from './shared';

export function VendorItems({ vendor, onDone }: { vendor: any; onDone: () => void }) {
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
                    <input aria-label="Pack size" inputMode="decimal" placeholder="1" value={r.packSize} onChange={(e) => set(i, 'packSize', e.target.value)} style={{ maxWidth: 100 }} />
                  </td>
                  <td>
                    <input type="checkbox" aria-label="Preferred vendor" checked={r.preferred} onChange={(e) => set(i, 'preferred', e.target.checked)} />
                  </td>
                  <td className="num">{r.lastRate ? `${rupee(r.lastRate.rate)} on ${r.lastRate.billedOn}` : '—'}</td>
                  <td>
                    <button className="ghost danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
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
        <button type="button" className="secondary" onClick={onDone}>
          Cancel
        </button>
        <button className="gold" onClick={save}>
          Save items
        </button>
      </footer>
    </>
  );
}

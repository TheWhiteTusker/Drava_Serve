import { useEffect, useState } from 'react';
import { margin, portionCost } from '@fnb/shared';
import { api, useApi } from '../../api';
import { ErrorNote, rupee, toast } from '../../ui';

export function RecipeEditor({ item, onDone }: { item: any; onDone: () => void }) {
  const recipe = useApi<any>(`/menu-items/${item.id}/recipe`);
  const stock = useApi<any[]>('/stock-items');
  const [lines, setLines] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (recipe.data && !lines) setLines(recipe.data.lines.map((l: any) => ({ stockItemId: l.stockItemId, quantity: String(Number(l.quantity)), yieldPct: String(Number(l.yieldPct)) })));
  }, [recipe.data, lines]);
  if (!lines || !recipe.data) return <ErrorNote error={recipe.error} />;
  const costOf = (id: string) => stock.data?.find((x) => x.id === id)?.currentCost ?? '0';
  const valid = lines.filter((l) => l.stockItemId && Number(l.quantity) > 0 && Number(l.yieldPct) > 0);
  const cost = portionCost(valid.map((l) => ({ qty: l.quantity, yieldPct: l.yieldPct, unitCost: costOf(l.stockItemId) })));
  const m = margin(item.sellingPrice, cost);
  const set = (i: number, k: string, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  async function save() {
    try {
      const r = await api(`/menu-items/${item.id}/recipe`, { method: 'PUT', body: { recipeVersion: recipe.data.recipeVersion, lines: valid } });
      if (r.status === 'pending') setMsg('This takes the margin under target, so it has gone to a manager for approval.');
      else {
        toast('Recipe saved and re-costed');
        onDone();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <p className="muted">
        Enter each ingredient once, in base units (grams, ml or pieces) as it goes into one portion. Yield is how much survives preparation: 250 g at 80% yield draws 312.5 g from
        stock. For a 60 ml peg, one line of 60 ml of the bottle.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Quantity</th>
              <th>Yield %</th>
              <th>Cost</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const unit = stock.data?.find((x) => x.id === l.stockItemId)?.baseUnit ?? '';
              return (
                <tr key={i}>
                  <td>
                    <select aria-label="Ingredient" value={l.stockItemId} onChange={(e) => set(i, 'stockItemId', e.target.value)}>
                      <option value="">Choose…</option>
                      {(stock.data ?? []).map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className="row tight">
                      <input aria-label="Quantity" inputMode="decimal" value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} style={{ maxWidth: 110 }} /> {unit}
                    </span>
                  </td>
                  <td>
                    <input aria-label="Yield %" inputMode="decimal" value={l.yieldPct} onChange={(e) => set(i, 'yieldPct', e.target.value)} style={{ maxWidth: 80 }} />
                  </td>
                  <td>{l.stockItemId && Number(l.quantity) > 0 ? rupee(portionCost([{ qty: l.quantity, yieldPct: l.yieldPct || 100, unitCost: costOf(l.stockItemId) }])) : '—'}</td>
                  <td>
                    <button className="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button className="secondary" onClick={() => setLines([...lines, { stockItemId: '', quantity: '', yieldPct: '100' }])} style={{ marginTop: '0.5rem' }}>
        Add ingredient
      </button>
      <p>
        Portion cost <strong>{rupee(cost)}</strong> · price {rupee(item.sellingPrice)} · margin <strong>{m.pct}%</strong> ({rupee(m.amount)})
        {recipe.data.targetPct && ` · target ${Number(recipe.data.targetPct)}%`}
      </p>
      <ErrorNote error={error} />
      {msg && <p className="note">{msg}</p>}
      <footer className="row end">
        <button onClick={save}>Save recipe</button>
      </footer>
    </>
  );
}

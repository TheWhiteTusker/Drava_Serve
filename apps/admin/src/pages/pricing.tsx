import { useEffect, useState } from 'react';
import { margin, portionCost } from '@fnb/shared';
import { api, can, useApi, useCurrentOutlet, useSession } from '../api';
import { useLiveReload } from '../live';
import { Badge, DietMark, ErrorNote, Modal, Page, rupee, toast } from '../ui';

// ---------- Menu costs, margins and order ----------

export function CostingPage() {
  const s = useSession();
  const outletId = useCurrentOutlet();
  const [dept, setDept] = useState<'food' | 'beverage'>('food');
  const rows = useApi<any[]>(outletId ? `/costing?outletId=${outletId}` : null);
  const [recipe, setRecipe] = useState<any | null>(null);
  const [place, setPlace] = useState<any | null>(null);
  useLiveReload(['menu', 'availability'], rows.reload);
  if (!outletId) return null;
  const list = (rows.data ?? []).filter((r) => r.department === dept);
  const groups = [...new Set(list.map((r) => r.category))];
  return (
    <Page
      title="Menu costs and order"
      intro={
        <>
          Portion cost comes from each recipe and the latest billed rates. Inside each course, dishes are listed by margin %, highest first (sold-out dishes drop to the end; pinned
          dishes stay on top). Note: a cheap dish with a high margin % can rank above one that earns more rupees per plate, so both figures are shown. Margins never appear on the
          POS or the guest menu.
        </>
      }
    >
      <div className="tabs" role="tablist">
        {(['food', 'beverage'] as const).map((d) => (
          <button key={d} role="tab" aria-selected={dept === d} className={dept === d ? '' : 'ghost'} onClick={() => setDept(d)}>
            {d === 'food' ? 'Food' : 'Beverage'}
          </button>
        ))}
      </div>
      <ErrorNote error={rows.error} />
      {groups.map((g) => (
        <section key={g} style={{ marginBottom: '1.25rem' }}>
          <h2>{g}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th>Price</th>
                  <th>Portion cost</th>
                  <th>Margin</th>
                  <th>Target</th>
                  <th>Left</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list
                  .filter((r) => r.category === g)
                  .map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td>
                        <span className="row tight">
                          <DietMark diet={r.dietType} /> {r.name}
                          {r.pinPosition && <Badge>pinned #{r.pinPosition}</Badge>}
                          {r.offerExcluded && <Badge>no offers</Badge>}
                        </span>
                      </td>
                      <td>
                        {rupee(r.sellingPrice)}
                        {r.offerPrice && <div className="muted">charging {rupee(r.offerPrice)} (offer)</div>}
                      </td>
                      <td>{rupee(r.portionCost)}</td>
                      <td>
                        <strong>{r.marginPct}%</strong> <span className="muted">· {rupee(r.marginAmount)}</span>
                      </td>
                      <td>
                        {r.targetPct ? `${Number(r.targetPct)}%` : '—'}
                        {r.underTarget && (
                          <div>
                            <Badge tone="danger">under target</Badge> <span className="muted">suggest {rupee(r.suggestedPrice)}</span>
                          </div>
                        )}
                      </td>
                      <td>{r.portions == null ? '—' : Number(r.portions) <= 0 ? <Badge tone="danger">Out</Badge> : Number(r.portions)}</td>
                      <td className="actions">
                        {can(s, 'recipes.manage', outletId) && (
                          <button className="ghost" onClick={() => setRecipe(r)}>
                            Recipe
                          </button>
                        )}
                        {can(s, 'menu.pins', outletId) && (
                          <button className="ghost" onClick={() => setPlace(r)}>
                            Pin / offers
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <Modal open={!!recipe} title={`Recipe: ${recipe?.name ?? ''}`} onClose={() => (setRecipe(null), rows.reload())} wide>
        {recipe && <RecipeEditor item={recipe} onDone={() => (setRecipe(null), rows.reload())} />}
      </Modal>
      <Modal open={!!place} title={`Placement: ${place?.name ?? ''}`} onClose={() => setPlace(null)}>
        {place && <Placement item={place} onDone={() => (setPlace(null), rows.reload())} />}
      </Modal>
    </Page>
  );
}

function RecipeEditor({ item, onDone }: { item: any; onDone: () => void }) {
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

function Placement({ item, onDone }: { item: any; onDone: () => void }) {
  const [pin, setPin] = useState(item.pinPosition ? String(item.pinPosition) : '');
  const [excluded, setExcluded] = useState(!!item.offerExcluded);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <div className="field">
        <label htmlFor="pin">Pin at position (blank = ranked by margin)</label>
        <input id="pin" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
      </div>
      {item.department === 'beverage' && (
        <label className="check">
          <input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} /> Never put this beverage on offer
        </label>
      )}
      <ErrorNote error={error} />
      <footer className="row end">
        <button
          onClick={() =>
            api(`/menu-items/${item.id}/placement`, { method: 'PUT', body: { pinPosition: pin ? Number(pin) : null, offerExcluded: excluded } })
              .then(onDone)
              .catch((e) => setError(e.message))
          }
        >
          Save
        </button>
      </footer>
    </>
  );
}

// ---------- Margin targets ----------

export function MarginTargetsPage() {
  const s = useSession();
  const outletId = useCurrentOutlet();
  const targets = useApi<any[]>(outletId ? `/margin-targets?outletId=${outletId}` : null);
  const cats = useApi<any[]>('/categories');
  const [error, setError] = useState<string | null>(null);
  if (!outletId) return null;
  const manage = can(s, 'pricing.rules', outletId);
  const value = (categoryId: string | null) => targets.data?.find((x) => x.categoryId === categoryId)?.targetPct ?? '';
  const save = (categoryId: string | null, v: string) =>
    api('/margin-targets', { method: 'PUT', body: { outletId, categoryId, targetPct: v === '' ? null : v } })
      .then(() => targets.reload())
      .catch((e) => setError(e.message));
  const rows = [{ id: null, name: 'Whole outlet (default)' }, ...(cats.data ?? []).filter((c) => c.kind === 'course' || c.kind === 'liquor_type')];
  return (
    <Page title="Margin targets" intro="The most specific target wins: a dish's own target, then its course or type, then the outlet. Dishes that fall under target after a price rise are flagged with a suggested price for a manager to approve.">
      <ErrorNote error={error ?? targets.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Applies to</th>
              <th>Target margin %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id ?? 'outlet'}>
                <td>{r.name}</td>
                <td>
                  <input
                    aria-label={`Target for ${r.name}`}
                    inputMode="decimal"
                    disabled={!manage}
                    defaultValue={value(r.id)}
                    key={`${r.id}-${value(r.id)}`}
                    onBlur={(e) => e.target.value !== String(value(r.id)) && save(r.id, e.target.value)}
                    style={{ maxWidth: 120 }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

// ---------- Beverage offer rules and log ----------

const RULE_FIELDS: [string, string, string][] = [
  ['triggerServes', 'Low-stock trigger (serves or fewer)', 'When a beverage counts as low'],
  ['discountPct', 'Discount %', 'Taken off similar beverages'],
  ['bandMinPct', 'Price band from (% above the low item)', '"Higher, but not too high"'],
  ['bandMaxPct', 'Price band to (% above the low item)', ''],
  ['marginFloorPct', 'Margin floor % after discount', 'Never discounted below this'],
  ['minSubstituteServes', 'Substitute needs at least (serves)', 'Never promote something itself running low'],
  ['maxItems', 'At most (items per low beverage)', 'Keeps the menu readable'],
  ['releaseBufferServes', 'Release buffer (serves above the trigger)', 'Stops offers switching on and off'],
];

export function OffersPage() {
  const s = useSession();
  const outletId = useCurrentOutlet();
  const rules = useApi<any[]>(outletId ? `/price-rules?outletId=${outletId}` : null);
  const settings = useApi<any>(outletId ? `/settings?outletId=${outletId}` : null);
  const [status, setStatus] = useState('active');
  const offers = useApi<any[]>(outletId ? `/offers?outletId=${outletId}&status=${status}` : null);
  const [rule, setRule] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  useLiveReload(['menu'], offers.reload);
  useEffect(() => {
    if (rules.data?.[0]) setRule({ ...rules.data[0] });
  }, [rules.data]);
  if (!outletId) return null;
  const manage = can(s, 'pricing.rules', outletId);
  const on = settings.data?.effective['offers.liquorEnabled'];
  async function save() {
    try {
      const { createdAt: _c, updatedAt: _u, ...body } = rule;
      for (const [k] of RULE_FIELDS) if (['triggerServes', 'minSubstituteServes', 'maxItems', 'releaseBufferServes'].includes(k)) body[k] = Number(body[k]);
      await api('/price-rules', { method: 'PUT', body });
      toast('Offer rule saved');
      rules.reload();
      offers.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Page
      title="Beverage offers"
      intro="When a beverage runs low, similar beverages priced slightly above it get a set discount so guests switch to stock the outlet has plenty of. Guests and the POS see only the new price; every offer is recorded here."
    >
      <section className="card">
        <p>
          Offers at this outlet are <Badge tone={on ? 'success' : 'neutral'}>{on ? 'on' : 'off'}</Badge> (owner's switch, under Settings). Rules on alcohol promotions differ by
          state and licence; check with an excise consultant.
        </p>
        {rule && (
          <>
            <div className="grid">
              {RULE_FIELDS.map(([k, label, help]) => (
                <div key={k} className="field">
                  <label htmlFor={`r-${k}`}>{label}</label>
                  <input id={`r-${k}`} inputMode="decimal" disabled={!manage} value={String(rule[k] ?? '')} onChange={(e) => setRule({ ...rule, [k]: e.target.value })} />
                  {help && <small className="muted">{help}</small>}
                </div>
              ))}
              <div className="field">
                <label htmlFor="r-scope">What counts as similar</label>
                <select id="r-scope" disabled={!manage} value={rule.matchScope} onChange={(e) => setRule({ ...rule, matchScope: e.target.value })}>
                  <option value="type_and_serve">Same type (e.g. whisky) and serve size</option>
                  <option value="subtype_and_serve">Same sub-type (e.g. single malt) and serve size</option>
                </select>
              </div>
            </div>
            <label className="check">
              <input type="checkbox" disabled={!manage} checked={rule.active} onChange={(e) => setRule({ ...rule, active: e.target.checked })} /> Rule active
            </label>
            <ErrorNote error={error} />
            {manage && (
              <footer className="row end">
                <button onClick={save}>Save rule</button>
              </footer>
            )}
          </>
        )}
      </section>
      <div className="tabs" role="tablist">
        {['active', 'ended'].map((x) => (
          <button key={x} role="tab" aria-selected={status === x} className={status === x ? '' : 'ghost'} onClick={() => setStatus(x)}>
            {x === 'active' ? 'Running now' : 'Ended'}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>On offer</th>
              <th>Because this ran low</th>
              <th>Menu price</th>
              <th>Charging</th>
              <th>Started</th>
              <th>Ended</th>
            </tr>
          </thead>
          <tbody>
            {(offers.data ?? []).map((o) => (
              <tr key={o.id}>
                <td>{o.item}</td>
                <td>{o.trigger}</td>
                <td>{rupee(o.menuPrice)}</td>
                <td>
                  {rupee(o.offerPrice)} <span className="muted">(−{Number(o.discountPct)}%)</span>
                </td>
                <td>{new Date(o.startedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{o.endedAt ? `${new Date(o.endedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })} · ${o.endReason}` : '—'}</td>
              </tr>
            ))}
            {offers.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  None.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

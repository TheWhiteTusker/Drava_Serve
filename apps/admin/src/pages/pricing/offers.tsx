import { useEffect, useState } from 'react';
import { api, can, useApi, useCurrentOutlet, useSession } from '../../api';
import { useLiveReload } from '../../live';
import { Badge, ErrorNote, Page, rupee, toast } from '../../ui';

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

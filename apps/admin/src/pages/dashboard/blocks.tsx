import { Badge, rupee } from '../../ui';
import { num } from './shared';
import { BarList, Block, Heatmap } from './charts';

// ---------- Dashboard blocks ----------

export function MarginBlocks({ x }: { x: any }) {
  return (
    <>
        <Block title="Margin by course or drink type">
          <BarList
            label="Margin % by course"
            rows={x.margins.courses.map((c: any) => ({ key: c.category, name: c.category, value: Number(c.marginPct), display: `${c.marginPct}% · ${rupee(c.marginAmount)}` }))}
          />
        </Block>
        <Block title="Margin by dish">
          <div className="table-wrap scroll">
            <table>
              <thead>
                <tr>
                  <th>Dish</th>
                  <th style={{ textAlign: 'right' }}>Sold</th>
                  <th style={{ textAlign: 'right' }}>Margin ₹</th>
                  <th style={{ textAlign: 'right' }}>Margin %</th>
                </tr>
              </thead>
              <tbody>
                {x.margins.dishes.slice(0, 15).map((m: any) => (
                  <tr key={m.id}>
                    <td><strong>{m.name}</strong></td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{num(m.units)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rupee(m.marginAmount)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{m.marginPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small className="muted">A cheap dish with a high margin % can earn fewer rupees per plate than one lower on the list; both figures are shown.</small>
        </Block>
        <Block title="Margins that fell after a price change">
          {x.margins.drops.length === 0 ? (
            <p className="muted">None in this range.</p>
          ) : (
            <ul className="plain">
              {x.margins.drops.map((m: any, i: number) => (
                <li key={i}>
                  <strong>{m.name}</strong>: {Number(m.before_pct).toFixed(1)}% → {Number(m.now_pct).toFixed(1)}% <span className="muted">(cost {rupee(m.before_cost)} → {rupee(m.now_cost)})</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
    </>
  );
}

export function StockBlocks({ x }: { x: any }) {
  return (
    <>
        <Block title="Low and out right now">
          {x.stock.lowOut.length === 0 ? (
            <p className="muted">Everything is in stock.</p>
          ) : (
            <ul className="plain">
              {x.stock.lowOut.map((m: any) => (
                <li key={`${m.outletId}${m.menuItemId}`}>
                  {m.status === 'out' ? <Badge tone="danger">Out</Badge> : <Badge tone="warning">{m.portions} left</Badge>} {m.name}
                </li>
              ))}
            </ul>
          )}
        </Block>
        <Block title="Deliveries waiting for a goods received note">
          {x.stock.awaitingGrn.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <ul className="plain">
              {x.stock.awaitingGrn.map((g: any) => (
                <li key={g.id}>
                  {g.vendor} · {g.expected_on} · {g.grn_status ? `${g.number} ${g.grn_status.replace('_', ' ')}` : g.status.replace('_', ' ')}
                </li>
              ))}
            </ul>
          )}
        </Block>
    </>
  );
}

export function DemandBlock({ x, cats, demandFor, setDemandFor }: { x: any; cats: any[] | null; demandFor: string; setDemandFor: (v: string) => void }) {
  return (
      <Block title="Demand by weekday and hour" wide>
        <select aria-label="Show demand for" value={demandFor} onChange={(e) => setDemandFor(e.target.value)} style={{ maxWidth: 320, marginBottom: '0.5rem' }}>
          <option value="">Everything</option>
          <optgroup label="Courses and types">
            {(cats ?? [])
              .filter((c) => c.kind === 'course' || c.kind === 'liquor_type' || c.kind === 'drink_type')
              .map((c) => (
                <option key={c.id} value={`c:${c.id}`}>
                  {c.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="Items">
            {x.margins.dishes.map((m: any) => (
              <option key={m.id} value={`i:${m.id}`}>
                {m.name}
              </option>
            ))}
          </optgroup>
        </select>
        <Heatmap cells={x.demand} />
      </Block>
  );
}

export function TopBlocks({ x, topBy, setTopBy }: { x: any; topBy: 'units' | 'revenue'; setTopBy: (v: 'units' | 'revenue') => void }) {
  const value = (r: any) => (topBy === 'units' ? r.units : Number(r.revenue));
  const shown = (r: any) => (topBy === 'units' ? num(r.units) : rupee(r.revenue));
  return (
    <>
        <Block title={`Top dishes by ${topBy}`}>
          <div className="tabs" role="tablist">
            {(['units', 'revenue'] as const).map((k) => (
              <button key={k} role="tab" aria-selected={topBy === k} className={topBy === k ? '' : 'ghost'} onClick={() => setTopBy(k)}>
                {k === 'units' ? 'Units' : 'Revenue'}
              </button>
            ))}
          </div>
          <BarList label="Top dishes" rows={(topBy === 'units' ? x.top.dishesByUnits : x.top.dishesByRevenue).map((r: any) => ({ key: r.id, name: r.name, value: value(r), display: shown(r) }))} />
        </Block>
        <Block title={`Top drinks by ${topBy}`}>
          <BarList label="Top drinks" rows={(topBy === 'units' ? x.top.drinksByUnits : x.top.drinksByRevenue).map((r: any) => ({ key: r.id, name: r.name, value: value(r), display: shown(r) }))} />
        </Block>
        <Block title="Top liquor brands">
          <BarList label="Top liquor brands by units" rows={x.top.brands.map((r: any) => ({ key: r.brand, name: r.brand, value: r.units, display: `${num(r.units)} · ${rupee(r.revenue)}` }))} />
        </Block>
    </>
  );
}

export function OffersBlock({ x }: { x: any }) {
  return (
      <Block title="Beverage offers" wide>
        {x.offers.length === 0 ? (
          <p className="muted">No offers in this range.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>On offer</th>
                  <th>Triggered by</th>
                  <th style={{ textAlign: 'right' }}>Menu price</th>
                  <th style={{ textAlign: 'right' }}>Charged</th>
                  <th style={{ textAlign: 'right' }}>Sold before</th>
                  <th style={{ textAlign: 'right' }}>Sold during</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {x.offers.map((o: any) => (
                  <tr key={o.id}>
                    <td><strong>{o.item}</strong></td>
                    <td>{o.trigger}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rupee(o.menuPrice)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{rupee(o.offerPrice)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {num(o.before.units)} · {rupee(o.before.revenue)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 650, color: 'var(--brand-accent-strong)' }}>
                      {num(o.during.units)} · {rupee(o.during.revenue)}
                    </td>
                    <td>{o.status === 'active' ? <Badge tone="success">running</Badge> : <span className="muted">{o.endReason}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <small className="muted">"Before" covers the same length of time just before the offer started.</small>
          </div>
        )}
      </Block>
  );
}

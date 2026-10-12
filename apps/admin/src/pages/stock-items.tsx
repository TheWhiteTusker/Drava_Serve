import { useState } from 'react';
import { ORIGINS, PRICE_TIERS } from '@fnb/shared';
import { can, useApi, useSession } from '../api';
import { CrudPage, opts, yesNo } from '../ui';

const UNIT_LABEL = { g: 'grams', ml: 'millilitres', pc: 'pieces' } as Record<string, string>;

export function StockItemsPage() {
  const s = useSession();
  const [dept, setDept] = useState<'food' | 'beverage'>('food');
  const cats = useApi<any[]>('/categories');
  const brands = useApi<any[]>('/brands');
  const catName = (id: string) => cats.data?.find((c) => c.id === id)?.name ?? '';
  const catOpts = (cats.data ?? [])
    .filter((c) => (dept === 'food' ? c.kind === 'stock' : c.kind === 'stock' || c.kind === 'liquor_type' || c.kind === 'liquor_subtype'))
    .map((c) => ({ value: c.id, label: c.parentId ? `${catName(c.parentId)} › ${c.name}` : c.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <CrudPage
        before={
          <div className="tabs" role="tablist">
            {(['food', 'beverage'] as const).map((d) => (
              <button key={d} role="tab" aria-selected={dept === d} className={dept === d ? '' : 'ghost'} onClick={() => setDept(d)}>
                {d === 'food' ? 'Food' : 'Beverage'}
              </button>
            ))}
          </div>
        }
        singular="stock item"
        key={dept}
        title={dept === 'food' ? 'Food stock items' : 'Beverage stock items'}
        intro="Stock is held in a base unit (grams, millilitres or pieces). Purchase units convert what vendors sell into base units. For liquor, each bottle size of a label is one item, held in ml."
        path="/stock-items"
        query={`?department=${dept}`}
        canManage={can(s, 'catalog.manage')}
        columns={[
          { label: 'Name', render: (r: any) => r.name },
          { label: 'Group', render: (r: any) => catName(r.categoryId) },
          { label: 'Base unit', render: (r: any) => UNIT_LABEL[r.baseUnit] },
          { label: 'Bought as', render: (r: any) => r.units.map((u: any) => `${u.name} = ${Number(u.factor)} ${r.baseUnit}`).join('; ') || '—' },
          ...(dept === 'beverage' ? [{ label: 'ABV', render: (r: any) => (r.abvPct ? `${Number(r.abvPct)}%` : '—') }] : []),
          { label: 'Perishable', render: (r: any) => (r.perishable ? 'Yes' : 'No') },
          { label: 'Status', render: (r: any) => yesNo(r.active) },
        ]}
        defaults={{ department: dept, baseUnit: dept === 'food' ? 'g' : 'ml', perishable: false, active: true, units: [], levels: [], currentCost: '0' }}
        fields={[
          { name: 'name', label: 'Name', required: true, placeholder: dept === 'beverage' ? 'e.g. Royal Stag 750 ml' : 'e.g. Tomato' },
          { name: 'categoryId', label: dept === 'food' ? 'Group' : 'Liquor sub-type (or group)', type: 'select', options: catOpts },
          { name: 'baseUnit', label: 'Base unit', type: 'select', required: true, options: Object.entries(UNIT_LABEL).map(([value, label]) => ({ value, label })) },
          ...(dept === 'beverage'
            ? [
                { name: 'brandId', label: 'Brand', type: 'select' as const, options: opts(brands.data) },
                { name: 'bottleSizeMl', label: 'Bottle size (ml)', type: 'decimal' as const },
                { name: 'abvPct', label: 'Alcohol %', type: 'decimal' as const },
                { name: 'origin', label: 'Origin', type: 'select' as const, options: ORIGINS.map((o) => ({ value: o, label: o === 'indian' ? 'Indian-made' : 'Imported' })) },
                { name: 'priceTier', label: 'Price tier', type: 'select' as const, options: PRICE_TIERS.map((p) => ({ value: p, label: p })) },
              ]
            : []),
          { name: 'sku', label: 'SKU / code' },
          { name: 'currentCost', label: 'Current cost per base unit (₹)', type: 'decimal', help: 'Set automatically from vendor bills once receiving is live' },
          { name: 'perishable', label: 'Perishable (track expiry, issue earliest expiry first)', type: 'checkbox' },
          { name: 'shelfLifeDays', label: 'Shelf life (days)', type: 'number', show: (v) => v.perishable },
          { name: 'active', label: 'Active', type: 'checkbox' },
        ]}
        extra={(v, set) => (
          <>
            <Units value={v.units} baseUnit={v.baseUnit} onChange={(u) => set('units', u)} />
            <Levels value={v.levels} baseUnit={v.baseUnit} onChange={(l) => set('levels', l)} outlets={s?.outlets ?? []} />
          </>
        )}
      />
  );
}

function Units({ value, baseUnit, onChange }: { value: any[]; baseUnit: string; onChange: (v: any[]) => void }) {
  const update = (i: number, k: string, val: any) => onChange(value.map((u, j) => (j === i ? { ...u, [k]: val } : u)));
  return (
    <fieldset className="field">
      <legend>Purchase units</legend>
      <small className="muted">How vendors sell it. For example "kg" = 1000 {baseUnit}, "case of 12" = 9000 ml.</small>
      {value.map((u, i) => (
        <div key={i} className="row">
          <input aria-label="Unit name" placeholder="kg, bottle, case of 12" value={u.name} onChange={(e) => update(i, 'name', e.target.value)} />
          <span>=</span>
          <input aria-label={`${baseUnit} per unit`} inputMode="decimal" value={u.factor} onChange={(e) => update(i, 'factor', e.target.value)} style={{ maxWidth: 120 }} />
          <span>{baseUnit}</span>
          <label className="check">
            <input type="checkbox" checked={u.isDefault} onChange={(e) => update(i, 'isDefault', e.target.checked)} /> default
          </label>
          <button type="button" className="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => onChange([...value, { name: '', factor: '', isDefault: value.length === 0 }])}>
        Add purchase unit
      </button>
    </fieldset>
  );
}

function Levels({ value, baseUnit, outlets, onChange }: { value: any[]; baseUnit: string; outlets: { id: string; name: string }[]; onChange: (v: any[]) => void }) {
  const row = (outletId: string) => value.find((l) => l.outletId === outletId) ?? { outletId, parLevel: '0', reorderLevel: '0', criticalLevel: '0' };
  const update = (outletId: string, k: string, val: string) => {
    const next = { ...row(outletId), [k]: val };
    onChange([...value.filter((l) => l.outletId !== outletId), next].filter((l) => [l.parLevel, l.reorderLevel, l.criticalLevel].some((x) => Number(x) > 0)));
  };
  return (
    <fieldset className="field">
      <legend>Stock levels per outlet ({baseUnit})</legend>
      <small className="muted">Par is the level the nightly indent tops up to. Reorder raises a purchase suggestion. Critical is the lower warning.</small>
      <table>
        <thead>
          <tr>
            <th>Outlet</th>
            <th>Par</th>
            <th>Reorder</th>
            <th>Critical</th>
          </tr>
        </thead>
        <tbody>
          {outlets.map((o) => (
            <tr key={o.id}>
              <td>{o.name}</td>
              {(['parLevel', 'reorderLevel', 'criticalLevel'] as const).map((k) => (
                <td key={k}>
                  <input aria-label={`${k} for ${o.name}`} inputMode="decimal" value={row(o.id)[k] ?? ''} onChange={(e) => update(o.id, k, e.target.value)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}

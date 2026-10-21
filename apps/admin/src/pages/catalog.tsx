import { useState } from 'react';
import { can, useApi, useSession } from '../api';
import { Badge, CrudPage, ErrorNote, Page, yesNo } from '../ui';

const KIND_LABEL: Record<string, string> = {
  course: 'Food course',
  liquor_type: 'Liquor type',
  liquor_subtype: 'Liquor sub-type',
  drink_type: 'Non-alcoholic drink type',
  stock: 'Stock group',
};

export function CategoriesPage() {
  const s = useSession();
  const cats = useApi<any[]>('/categories');
  const types = (cats.data ?? []).filter((c) => c.kind === 'liquor_type');
  const name = (id: string | null) => cats.data?.find((c) => c.id === id)?.name ?? '';
  const [kind, setKind] = useState('course');
  return (
    <CrudPage
        before={
          <div className="tabs" role="tablist">
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? '' : 'ghost'} onClick={() => setKind(k)}>
                {label}s
              </button>
            ))}
          </div>
        }
        singular="category"
        key={kind}
        title={`${KIND_LABEL[kind]}s`}
        intro={kind === 'course' ? 'Food courses, in the order they appear on the menu. Diet type is a separate field on each dish.' : undefined}
        path="/categories"
        filter={(r: any) => r.kind === kind}
        canManage={can(s, 'catalog.manage')}
        columns={[
          { label: 'Order', render: (r: any) => r.sortOrder },
          { label: 'Name', render: (r: any) => r.name },
          ...(kind === 'liquor_subtype' ? [{ label: 'Type', render: (r: any) => name(r.parentId) }] : []),
          { label: 'Status', render: (r: any) => yesNo(r.active) },
        ]}
        defaults={{ kind, sortOrder: 0, active: true, parentId: null }}
        fields={[
          { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Starters, Main Course, Single Malt' },
          ...(kind === 'liquor_subtype'
            ? [{ name: 'parentId', label: 'Liquor type', type: 'select' as const, required: true, options: types.map((t) => ({ value: t.id, label: t.name })) }]
            : []),
          { name: 'sortOrder', label: 'Order', type: 'number', placeholder: '0', help: 'Lower numbers come first' },
          { name: 'active', label: 'Active', type: 'checkbox' },
        ]}
      />
  );
}

export function BrandsPage() {
  const s = useSession();
  return (
    <CrudPage
      singular="brand"
      title="Brands"
      intro="Liquor and packaged-goods brands. A brand's products (bottle sizes) are stock items."
      path="/brands"
      canManage={can(s, 'catalog.manage')}
      columns={[
        { label: 'Name', render: (r: any) => r.name },
        { label: 'Status', render: (r: any) => yesNo(r.active) },
      ]}
      defaults={{ active: true }}
      fields={[
        { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Glenfiddich, Kingfisher, Amrut' },
        { name: 'active', label: 'Active', type: 'checkbox' },
      ]}
    />
  );
}

export function TaxClassesPage() {
  const s = useSession();
  return (
    <CrudPage
      singular="tax class"
      title="Tax classes"
      intro={
        <>
          Each menu item carries one tax class; food and liquor are totalled separately on every bill. Rates here are
          placeholders and <strong>must be confirmed with a CA</strong> before going live.
        </>
      }
      path="/tax-classes"
      canManage={can(s, 'tax.manage')}
      columns={[
        { label: 'Code', render: (r: any) => <code>{r.code}</code> },
        { label: 'Name', render: (r: any) => r.name },
        { label: 'Totalled as', render: (r: any) => (r.kind === 'food' ? 'Food' : 'Liquor') },
        { label: 'Rates', render: (r: any) => r.components.map((c: any) => `${c.name} ${c.ratePct}%`).join(' + ') || 'None' },
        { label: 'Status', render: (r: any) => yesNo(r.active) },
      ]}
      defaults={{ kind: 'food', components: [], active: true }}
      fields={[
        { name: 'code', label: 'Code', required: true, placeholder: 'e.g. GST_FOOD_5, VAT_LIQ_18' },
        { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Food GST 5%, Liquor VAT 20%' },
        { name: 'kind', label: 'Totalled as', type: 'select', required: true, options: [{ value: 'food', label: 'Food' }, { value: 'liquor', label: 'Liquor' }] },
        { name: 'active', label: 'Active', type: 'checkbox' },
      ]}
      extra={(v, set) => <TaxComponents value={v.components} onChange={(c) => set('components', c)} />}
    />
  );
}

function TaxComponents({ value, onChange }: { value: { name: string; ratePct: string }[]; onChange: (v: any[]) => void }) {
  const update = (i: number, k: string, val: string) => onChange(value.map((c, j) => (j === i ? { ...c, [k]: val } : c)));
  return (
    <fieldset className="field">
      <legend>Tax components</legend>
      {value.map((c, i) => (
        <div key={i} className="row">
          <input aria-label="Tax name" placeholder="e.g. CGST" value={c.name} onChange={(e) => update(i, 'name', e.target.value)} />
          <input aria-label="Rate %" inputMode="decimal" placeholder="2.5" value={c.ratePct} onChange={(e) => update(i, 'ratePct', e.target.value)} style={{ maxWidth: 100 }} />
          <button type="button" className="ghost danger" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => onChange([...value, { name: '', ratePct: '' }])}>
        Add component
      </button>
    </fieldset>
  );
}

// Type → sub-type → brand → product (one bottle size of one label). Products are added on Stock items.
export function LiquorTreePage() {
  const tree = useApi<any[]>('/catalog/liquor-tree');
  const brandRows = (brands: any[]) =>
    brands.map((b) => (
      <li key={b.id ?? 'none'}>
        <strong>{b.name}</strong>
        <ul>
          {b.products.map((p: any) => (
            <li key={p.id}>
              {p.name} <span className="muted">· {Number(p.bottleSizeMl)} ml · {p.abvPct ? `${Number(p.abvPct)}%` : '—'} · {p.origin === 'imported' ? 'Imported' : 'Indian-made'}</span>
              {p.priceTier && <Badge>{p.priceTier}</Badge>}
            </li>
          ))}
        </ul>
      </li>
    ));
  return (
    <Page title="Liquor tree" intro="Stock is held per product in ml, so part bottles count. Reports roll up to brand and type. Add products under Stock items (department Beverage, base unit ml).">
      <ErrorNote error={tree.error} />
      <div className="tree">
        {(tree.data ?? []).map((type) => (
          <details key={type.id} open={type.subtypes.some((s: any) => s.brands.length) || type.brands.length > 0}>
            <summary>
              {type.name} <span className="muted">({type.subtypes.length} sub-types)</span>
            </summary>
            {type.brands.length > 0 && <ul>{brandRows(type.brands)}</ul>}
            <ul>
              {type.subtypes.map((s: any) => (
                <li key={s.id}>
                  {s.name}
                  {s.brands.length > 0 ? <ul>{brandRows(s.brands)}</ul> : <span className="muted"> · no products yet</span>}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </Page>
  );
}

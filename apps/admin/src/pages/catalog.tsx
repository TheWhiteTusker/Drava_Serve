import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { slugify } from '@fnb/shared';
import { api, can, useApi, useSession } from '../api';
import { AskDialog, Badge, CrudPage, ErrorNote, Modal, Page, rupee, toast, yesNo } from '../ui';

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
      title="Taxes"
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

// Type → sub-type → varieties (one bottle size of one label). Varieties are stock items, so
// adding or editing one opens it under Ingredients and bottles. Categories are never deleted,
// only switched off, so past bills and counts keep their names.
export function LiquorTreePage() {
  const s = useSession();
  const manage = can(s, 'catalog.manage');
  const tree = useApi<any[]>('/catalog/liquor-tree');
  const go = useNavigate();
  const [ask, setAsk] = useState<null | { title: string; label: string; confirm: string; initial?: string; save: (name: string) => void }>(null);
  const [moving, setMoving] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const types = tree.data ?? [];

  async function run(fn: () => Promise<unknown>, done: string) {
    try {
      setError(null);
      await fn();
      toast(done);
      await tree.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const put = (c: any, change: Record<string, unknown>) =>
    api(`/categories/${c.id}`, { method: 'PUT', body: { name: c.name, kind: c.kind, parentId: c.parentId, sortOrder: c.sortOrder, active: c.active, version: c.version, ...change } });
  const rename = (c: any) => setAsk({ title: `Rename ${c.name}`, label: 'New name', confirm: 'Rename', initial: c.name, save: (name) => run(() => put(c, { name }), 'Renamed') });
  const toggle = (c: any) => run(() => put(c, { active: !c.active }), c.active ? `${c.name} switched off` : `${c.name} switched on`);
  const addSubtype = (type: any) =>
    setAsk({
      title: `Add a sub-type to ${type.name}`, label: 'Sub-type name', confirm: 'Add sub-type',
      save: (name) => run(() => api('/categories', { body: { name, kind: 'liquor_subtype', parentId: type.id, sortOrder: type.subtypes.length, active: true } }), 'Sub-type added'),
    });
  const addType = () =>
    setAsk({
      title: 'Add a liquor type', label: 'Type name', confirm: 'Add type',
      save: (name) => run(() => api('/categories', { body: { name, kind: 'liquor_type', parentId: null, sortOrder: types.length, active: true } }), 'Type added'),
    });
  const addVariety = (c: any) => go(`/stock-items/new?department=beverage&category=${c.id}`);
  // A button inside a summary must not also open or close it.
  const act = (fn: () => void) => (e: React.MouseEvent) => (e.preventDefault(), e.stopPropagation(), fn());

  return (
    <Page
      title="Liquor tree"
      intro="Type → sub-type → varieties. A variety is one bottle size of one label; stock is held per variety in ml, so part bottles count. Reports roll up to brand and type."
      actions={
        manage && (
          <button onClick={addType}>
            <Plus className="icon" aria-hidden /> Add type
          </button>
        )
      }
    >
      <ErrorNote error={error ?? tree.error} />
      <div className="tree">
        {types.map((type) => {
          const own = varieties(type);
          const subs = type.subtypes.length;
          return (
            <details key={type.id} className="tree-type" open={own.length > 0 || type.subtypes.some((x: any) => varieties(x).length)}>
              <summary>
                <ChevronRight className="icon chev" aria-hidden />
                <span className="tree-name">{type.name}</span>
                <Badge>
                  {subs} sub-type{subs === 1 ? '' : 's'}
                </Badge>
                {!type.active && <Badge tone="warning">Off</Badge>}
                {manage && (
                  <span className="tree-actions">
                    <button className="secondary" onClick={act(() => rename(type))}>
                      Rename
                    </button>
                    <button className="secondary" onClick={act(() => addSubtype(type))}>
                      <Plus className="icon" aria-hidden /> Add sub-type
                    </button>
                    <button className={type.active ? 'ghost danger' : 'ghost'} onClick={act(() => toggle(type))}>
                      {type.active ? 'Switch off' : 'Switch on'}
                    </button>
                  </span>
                )}
              </summary>
              {(own.length > 0 || !subs) && (
                <details className="tree-sub" open>
                  <summary>
                    <ChevronRight className="icon chev" aria-hidden />
                    <span>Filed under {type.name}</span>
                    <span className="muted">({count(own.length)})</span>
                    {manage && (
                      <span className="tree-actions">
                        <button className="ghost" onClick={act(() => addVariety(type))}>
                          <Plus className="icon" aria-hidden /> Add variety
                        </button>
                      </span>
                    )}
                  </summary>
                  <Varieties rows={own} manage={manage} />
                </details>
              )}
              {type.subtypes.map((sub: any) => {
                const rows = varieties(sub);
                return (
                  <details key={sub.id} className="tree-sub">
                    <summary>
                      <ChevronRight className="icon chev" aria-hidden />
                      <span>
                        Sub-type: <strong>{sub.name}</strong>
                      </span>
                      <span className="muted">({count(rows.length)})</span>
                      {!sub.active && <Badge tone="warning">Off</Badge>}
                      {manage && (
                        <span className="tree-actions">
                          <button className="ghost" onClick={act(() => addVariety(sub))}>
                            <Plus className="icon" aria-hidden /> Add variety
                          </button>
                          <button className="ghost" onClick={act(() => setMoving(sub))}>
                            Move
                          </button>
                          <button className="ghost" onClick={act(() => rename(sub))}>
                            Rename
                          </button>
                          <button className={sub.active ? 'ghost danger' : 'ghost'} onClick={act(() => toggle(sub))}>
                            {sub.active ? 'Switch off' : 'Switch on'}
                          </button>
                        </span>
                      )}
                    </summary>
                    <Varieties rows={rows} manage={manage} />
                  </details>
                );
              })}
            </details>
          );
        })}
      </div>
      <AskDialog
        key={ask?.title}
        open={!!ask}
        title={ask?.title ?? ''}
        label={ask?.label ?? ''}
        confirm={ask?.confirm ?? ''}
        initial={ask?.initial}
        onAnswer={(name) => (ask!.save(name.trim()), setAsk(null))}
        onClose={() => setAsk(null)}
      />
      <Modal open={!!moving} title={`Move ${moving?.name ?? ''}`} onClose={() => setMoving(null)}>
        <div className="field">
          <label htmlFor="move-to">Move under</label>
          <select
            id="move-to"
            value={moving?.parentId ?? ''}
            onChange={(e) => {
              const sub = moving;
              setMoving(null);
              run(() => put(sub, { parentId: e.target.value }), `${sub.name} moved`);
            }}
          >
            {types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
      </Modal>
    </Page>
  );
}

const count = (n: number) => `${n} ${n === 1 ? 'variety' : 'varieties'}`;
// Every product under a type or sub-type, with its brand.
const varieties = (c: any): any[] => c.brands.flatMap((b: any) => b.products.map((p: any) => ({ ...p, brand: b.name })));

function Varieties({ rows, manage }: { rows: any[]; manage: boolean }) {
  if (!rows.length) return <p className="muted">No varieties yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Variety</th>
            <th>Brand</th>
            <th className="num">Bottle</th>
            <th className="num">Alcohol</th>
            <th>Origin</th>
            <th>Tier</th>
            <th className="num">Cost per bottle</th>
            <th>Status</th>
            {manage && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>
                <strong>{p.name}</strong>
              </td>
              <td>{p.brand}</td>
              <td className="num">{p.bottleSizeMl ? `${Number(p.bottleSizeMl)} ml` : '—'}</td>
              <td className="num">{p.abvPct ? `${Number(p.abvPct)}%` : '—'}</td>
              <td>{p.origin === 'imported' ? 'Imported' : p.origin ? 'Indian-made' : '—'}</td>
              <td>{p.priceTier ?? '—'}</td>
              <td className="num">{p.bottleSizeMl ? rupee(Number(p.currentCost) * Number(p.bottleSizeMl)) : '—'}</td>
              <td>{yesNo(p.active)}</td>
              {manage && (
                <td className="actions">
                  <Link className="link" to={`/stock-items/${slugify(p.name)}?department=beverage`}>
                    Edit
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

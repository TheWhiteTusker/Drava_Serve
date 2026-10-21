import { useState, type ReactNode } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { slugify } from '@fnb/shared';
import { api, useApi } from '../api';
import { useRecordPath } from '../routing';
import { Empty, ErrorNote, Page, SkeletonRows } from './basics';
import { toast } from './toasts';
import { Fields, SearchBox, type FieldSpec } from './fields';

// ---------- List + edit pages for simple records ----------

export interface Column<T> {
  label: string;
  render: (row: T) => ReactNode;
}

interface Props<T> {
  title: string;
  singular?: string; // "menu item", for "Add menu item"
  eyebrow?: string;
  intro?: ReactNode;
  path: string; // API collection path
  query?: string; // extra list query, e.g. ?outletId=
  columns: Column<T>[];
  fields: FieldSpec[];
  defaults: Record<string, any>;
  canManage: boolean;
  filter?: (row: T) => boolean;
  searchText?: (row: T) => string;
  extra?: (values: Record<string, any>, set: (k: string, v: any) => void) => ReactNode;
  before?: ReactNode; // shown above the table, e.g. tabs
  slugOf?: (row: T) => string; // the record's address; its name by default
  aside?: (row: T) => ReactNode; // shown under an existing record's form, e.g. its QR code
  subPages?: Record<string, (row: T) => ReactNode>; // /<record>/<name> pages, e.g. a vendor's items
}

// The list lives at the screen's own address; /new and /<record> open the form as a page.
export function CrudPage<T extends { id: string; version?: number }>(props: Props<T>) {
  const list = useApi<T[]>(`${props.path}${props.query ?? ''}`);
  const rec = useRecordPath();
  const [q, setQ] = useState('');
  const noun = props.singular ?? props.title.toLowerCase();
  const slugs = slugMap(list.data ?? [], props.slugOf ?? ((r: any) => slugify(String(r.name ?? r.id))));
  const slugOf = (r: T) => slugs.get(r.id)!;

  if (rec.slug) {
    const row = rec.slug === 'new' ? null : (list.data?.find((r) => slugOf(r) === rec.slug) ?? null);
    if (rec.slug !== 'new' && !row) {
      return (
        <Page title={props.title} actions={<BackButton onClick={rec.close} label={`All ${props.title.toLowerCase()}`} />}>
          {list.data ? <Empty title={`No ${noun} at this address`}>It may have been renamed. Pick it from the list.</Empty> : <p className="muted">Loading…</p>}
        </Page>
      );
    }
    const sub = rec.sub && row ? props.subPages?.[rec.sub] : undefined;
    if (sub) return sub(row!);
    return (
      <RecordForm
        key={rec.slug}
        props={props}
        noun={noun}
        row={row}
        onClose={rec.close}
        onSaved={async () => {
          await list.reload();
          rec.close();
        }}
      />
    );
  }

  const text = props.searchText ?? ((r: any) => String(r.name ?? ''));
  const rows = (list.data ?? []).filter(props.filter ?? (() => true)).filter((r) => !q || text(r).toLowerCase().includes(q.toLowerCase()));
  const add = props.canManage && (
    <button onClick={() => rec.open('new')}>
      <Plus className="icon" aria-hidden /> Add {noun}
    </button>
  );
  return (
    <Page title={props.title} eyebrow={props.eyebrow} intro={props.intro} actions={add}>
      {props.before}
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={`Search ${props.title.toLowerCase()}…`} />
        {list.data && (
          <span className="badge" style={{ marginLeft: 'auto', fontSize: '0.82rem', padding: '0.25rem 0.75rem' }}>
            {rows.length} {rows.length === 1 ? 'item' : 'items'}
          </span>
        )}
      </div>
      <ErrorNote error={list.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {props.columns.map((c) => (
                <th key={c.label}>{c.label}</th>
              ))}
              {props.canManage && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {!list.data && list.loading && <SkeletonRows cols={props.columns.length + 1} />}
            {rows.map((r) => (
              <tr key={r.id} className={props.canManage ? 'clickable' : ''} onClick={props.canManage ? () => rec.open(slugOf(r)) : undefined}>
                {props.columns.map((c) => (
                  <td key={c.label}>{c.render(r)}</td>
                ))}
                {props.canManage && (
                  <td className="actions">
                    <a className="link" href={`${rec.base}/${slugOf(r)}`} onClick={(e) => (e.preventDefault(), e.stopPropagation(), rec.open(slugOf(r)))}>
                      Edit
                    </a>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && !rows.length && (
          <Empty title={q ? 'Nothing matches that search' : `No ${props.title.toLowerCase()} yet`} action={!q && add}>
            {q ? 'Try a different search word.' : props.canManage ? `Add your first ${noun} to get started.` : null}
          </Empty>
        )}
      </div>
    </Page>
  );
}

// Each record's address. Two records that would share one (same name) both get a short id suffix.
function slugMap<T extends { id: string }>(rows: T[], slugOf: (r: T) => string) {
  const count = new Map<string, number>();
  for (const r of rows) count.set(slugOf(r), (count.get(slugOf(r)) ?? 0) + 1);
  return new Map(rows.map((r) => [r.id, count.get(slugOf(r))! > 1 ? `${slugOf(r)}-${r.id.slice(0, 6)}` : slugOf(r)]));
}

export function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="secondary" onClick={onClick} style={{ minHeight: '38px', padding: '0.4rem 0.85rem' }}>
      <ArrowLeft className="icon" aria-hidden /> {label}
    </button>
  );
}

function RecordForm<T extends { id: string }>({ props, noun, row, onClose, onSaved }: { props: Props<T>; noun: string; row: T | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [values, setValues] = useState<Record<string, any>>(() => ({ ...(row ?? props.defaults) }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setValues((e) => ({ ...e, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { id, createdAt: _c, updatedAt: _u, ...body } = values;
      const r = await api(id ? `${props.path}/${id}` : props.path, { method: id ? 'PUT' : 'POST', body });
      toast(r?.priceApproval ? 'Saved. The new price has gone to a manager for approval.' : id ? 'Changes saved' : `${noun[0].toUpperCase()}${noun.slice(1)} added`);
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page eyebrow={props.title} title={row ? String((row as any).name ?? `Edit ${noun}`) : `Add ${noun}`} actions={<BackButton onClick={onClose} label={`All ${props.title.toLowerCase()}`} />}>
      <form className="card" onSubmit={save}>
        {/* Without permission to edit, the record is shown but every field is read-only. */}
        <fieldset disabled={!props.canManage} className="bare">
          <Fields specs={props.fields} values={values} set={set} />
          {props.extra?.(values, set)}
        </fieldset>
        <ErrorNote error={error} />
        <footer className="row end form-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          {props.canManage && <button className="gold" disabled={busy}>{busy ? 'Saving…' : row ? 'Save changes' : `Add ${noun}`}</button>}
        </footer>
      </form>
      {row && props.aside?.(row)}
    </Page>
  );
}

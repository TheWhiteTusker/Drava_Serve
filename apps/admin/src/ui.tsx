import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Inbox, Plus, Search, X } from 'lucide-react';
import { api, useApi } from './api';

// ---------- Small pieces ----------

export function Page({ title, eyebrow, intro, actions, children }: { title: ReactNode; eyebrow?: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {intro && <p className="muted">{intro}</p>}
        </div>
        <div className="row">{actions}</div>
      </header>
      {children}
    </section>
  );
}

export function ErrorNote({ error }: { error?: string | null }) {
  return error ? (
    <p className="note danger" role="alert">
      <AlertCircle className="icon" aria-hidden /> {error}
    </p>
  ) : null;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden>
        <Inbox className="icon" />
      </span>
      <strong>{title}</strong>
      {children && <div>{children}</div>}
      {action && <div style={{ marginTop: '1rem' }}>{action}</div>}
    </div>
  );
}

export function SkeletonRows({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} aria-hidden>
          {Array.from({ length: cols }, (_, j) => (
            <td key={j}>
              <div className="skeleton" style={{ width: `${50 + ((i * 7 + j * 13) % 40)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ---------- Toasts: short confirmations instead of pop-ups ----------

type Toast = { id: number; text: string; tone: 'ok' | 'danger' };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
export function toast(text: string, tone: Toast['tone'] = 'ok') {
  const t = { id: Date.now() + Math.random(), text, tone };
  toasts = [...toasts, t];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListeners.forEach((l) => l());
  }, 3800);
}
export function Toasts() {
  const list = useSyncExternalStore(
    (l) => (toastListeners.add(l), () => toastListeners.delete(l)),
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone === 'danger' ? 'danger' : ''}`}>
          {t.tone === 'danger' ? <AlertCircle className="icon" aria-hidden /> : <CheckCircle2 className="icon" aria-hidden />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

// Native <dialog>: focus trapping, Escape to close and a backdrop come with the platform.
export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d?.open) {
      d?.showModal();
      // Start in the first field, not on the close button.
      setTimeout(() => d?.querySelector<HTMLElement>('.dialog-body input:not([type=checkbox]), .dialog-body select, .dialog-body textarea')?.focus(), 0);
    }
    if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={wide ? 'wide' : ''} onClose={onClose} aria-labelledby="dialog-title">
      <header className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <button type="button" className="ghost icon-only" onClick={onClose} aria-label="Close">
          <X className="icon" />
        </button>
      </header>
      <div className="dialog-body">{open && children}</div>
    </dialog>
  );
}

// A question with a typed answer (used instead of the browser's prompt box).
export function AskDialog({ open, title, label, confirm, onAnswer, onClose }: { open: boolean; title: string; label: string; confirm: string; onAnswer: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState('');
  return (
    <Modal open={open} title={title} onClose={() => (setV(''), onClose())}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAnswer(v);
          setV('');
        }}
      >
        <div className="field">
          <label htmlFor="ask">{label}</label>
          <input id="ask" autoFocus required minLength={3} value={v} onChange={(e) => setV(e.target.value)} />
        </div>
        <footer className="row end">
          <button type="button" className="ghost" onClick={() => (setV(''), onClose())}>
            Cancel
          </button>
          <button>{confirm}</button>
        </footer>
      </form>
    </Modal>
  );
}

// FSSAI marks: veg = green circle in a green square; non-veg (and egg) = brown triangle in a
// brown square. Shape carries the meaning, not colour alone, and there is a text label for screen readers.
export function DietMark({ diet }: { diet?: string | null }) {
  if (!diet) return null;
  const veg = diet === 'veg';
  const label = veg ? 'Veg' : diet === 'egg' ? 'Contains egg (non-veg)' : 'Non-veg';
  const color = veg ? 'var(--mark-veg)' : 'var(--mark-nonveg)';
  return (
    <svg className="diet-mark" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label={label}>
      <title>{label}</title>
      <rect x="1" y="1" width="14" height="14" fill="none" stroke={color} strokeWidth="1.6" rx="2" />
      {veg ? <circle cx="8" cy="8" r="3.6" fill={color} /> : <path d="M8 3.8 12.2 11.6H3.8Z" fill={color} />}
    </svg>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'gold' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

// ---------- Forms ----------

export interface FieldSpec {
  name: string;
  label: string;
  type?: 'text' | 'decimal' | 'number' | 'select' | 'checkbox' | 'checks' | 'tags' | 'textarea' | 'password' | 'time';
  options?: { value: string; label: string }[];
  help?: string;
  required?: boolean;
  placeholder?: string;
  show?: (v: Record<string, any>) => boolean;
}

export function Field({ spec, value, onChange }: { spec: FieldSpec; value: any; onChange: (v: any) => void }) {
  const id = `f-${spec.name}`;
  const help = spec.help && <small className="muted">{spec.help}</small>;
  if (spec.type === 'checkbox') {
    return (
      <label className="check">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {spec.label}
        {help}
      </label>
    );
  }
  if (spec.type === 'checks') {
    const set = new Set<string>(value ?? []);
    return (
      <fieldset className="field">
        <legend>{spec.label}</legend>
        <div className="checks">
          {spec.options!.map((o) => (
            <label key={o.value} className="check">
              <input
                type="checkbox"
                checked={set.has(o.value)}
                onChange={(e) => {
                  e.target.checked ? set.add(o.value) : set.delete(o.value);
                  onChange([...set]);
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
        {help}
      </fieldset>
    );
  }
  let input: ReactNode;
  if (spec.type === 'select') {
    input = (
      <select id={id} value={value ?? ''} required={spec.required} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{spec.required ? 'Choose…' : '—'}</option>
        {spec.options!.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (spec.type === 'textarea') {
    input = <textarea id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={3} />;
  } else if (spec.type === 'tags') {
    input = (
      <input
        id={id}
        value={(value ?? []).join(', ')}
        placeholder={spec.placeholder}
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
      />
    );
  } else {
    input = (
      <input
        id={id}
        type={spec.type === 'password' ? 'password' : spec.type === 'time' ? 'time' : 'text'}
        inputMode={spec.type === 'decimal' ? 'decimal' : spec.type === 'number' ? 'numeric' : undefined}
        value={value ?? ''}
        required={spec.required}
        placeholder={spec.placeholder}
        autoComplete={spec.type === 'password' ? 'new-password' : 'off'}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
    );
  }
  return (
    <div className="field">
      <label htmlFor={id}>
        {spec.label}
        {spec.required && <span aria-hidden style={{ color: 'var(--brand-accent-strong)' }}> *</span>}
      </label>
      {input}
      {help}
    </div>
  );
}

export function Fields({ specs, values, set }: { specs: FieldSpec[]; values: Record<string, any>; set: (k: string, v: any) => void }) {
  return (
    <div className="grid">
      {specs
        .filter((s) => !s.show || s.show(values))
        .map((s) => (
          <Field key={s.name} spec={s} value={values[s.name]} onChange={(v) => set(s.name, v)} />
        ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="searchbox">
      <Search className="icon" aria-hidden />
      <span className="sr-only">{placeholder}</span>
      <input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// ---------- List + edit page for simple records ----------

export interface Column<T> {
  label: string;
  render: (row: T) => ReactNode;
}

export function CrudPage<T extends { id: string; version?: number }>(props: {
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
}) {
  const list = useApi<T[]>(`${props.path}${props.query ?? ''}`);
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const noun = props.singular ?? props.title.toLowerCase();
  const text = props.searchText ?? ((r: any) => String(r.name ?? ''));
  const rows = (list.data ?? []).filter(props.filter ?? (() => true)).filter((r) => !q || text(r).toLowerCase().includes(q.toLowerCase()));
  const open = (r: Record<string, any>) => {
    setError(null);
    setEditing({ ...r });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { id, createdAt, updatedAt, ...body } = editing!;
      const r = await api(id ? `${props.path}/${id}` : props.path, { method: id ? 'PUT' : 'POST', body });
      setEditing(null);
      toast(r?.priceApproval ? 'Saved. The new price has gone to a manager for approval.' : id ? 'Changes saved' : `${noun[0].toUpperCase()}${noun.slice(1)} added`);
      await list.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const add = props.canManage && (
    <button onClick={() => open({ ...props.defaults })}>
      <Plus className="icon" aria-hidden /> Add {noun}
    </button>
  );
  return (
    <Page title={props.title} eyebrow={props.eyebrow} intro={props.intro} actions={add}>
      {props.before}
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={`Search ${props.title.toLowerCase()}`} />
        <span className="muted">{list.data ? `${rows.length} shown` : ''}</span>
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
              <tr key={r.id} className={props.canManage ? 'clickable' : ''} onClick={props.canManage ? () => open(r) : undefined}>
                {props.columns.map((c) => (
                  <td key={c.label}>{c.render(r)}</td>
                ))}
                {props.canManage && (
                  <td className="actions">
                    <button className="link" onClick={(e) => (e.stopPropagation(), open(r))}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && !rows.length && (
          <Empty title={q ? 'Nothing matches that search' : `No ${props.title.toLowerCase()} yet`} action={!q && add}>
            {q ? 'Try a different word.' : props.canManage ? `Add your first ${noun} to get started.` : null}
          </Empty>
        )}
      </div>
      <Modal open={!!editing} title={editing?.id ? `Edit ${noun}` : `Add ${noun}`} onClose={() => setEditing(null)} wide>
        {editing && (
          <form onSubmit={save}>
            <Fields specs={props.fields} values={editing} set={(k, v) => setEditing((e) => ({ ...e!, [k]: v }))} />
            {props.extra?.(editing, (k, v) => setEditing((e) => ({ ...e!, [k]: v })))}
            <ErrorNote error={error} />
            <footer className="row end">
              <button type="button" className="ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button disabled={busy}>{busy ? 'Saving…' : editing.id ? 'Save changes' : `Add ${noun}`}</button>
            </footer>
          </form>
        )}
      </Modal>
    </Page>
  );
}

export const opts = (rows: { id: string; name: string }[] | null | undefined) => (rows ?? []).map((r) => ({ value: r.id, label: r.name }));
export const yesNo = (b: boolean) => (b ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>);
export const rupee = (v: string | number | null | undefined) =>
  v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

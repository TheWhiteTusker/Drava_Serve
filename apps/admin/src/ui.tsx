import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, useApi } from './api';

// ---------- Small pieces ----------

export function Page({ title, intro, actions, children }: { title: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
      <header className="page-head">
        <div>
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
      {error}
    </p>
  ) : null;
}

// Native <dialog>: focus trapping, Escape to close and a backdrop come with the platform.
export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d?.open) d?.showModal();
    if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={wide ? 'wide' : ''} onClose={onClose} aria-labelledby="dialog-title">
      <header className="row between">
        <h2 id="dialog-title">{title}</h2>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      {open && children}
    </dialog>
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
      <rect x="1" y="1" width="14" height="14" fill="none" stroke={color} strokeWidth="1.6" />
      {veg ? <circle cx="8" cy="8" r="3.6" fill={color} /> : <path d="M8 3.8 12.2 11.6H3.8Z" fill={color} />}
    </svg>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
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
        {spec.required && <span aria-hidden> *</span>}
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

// ---------- List + edit page for simple records ----------

export interface Column<T> {
  label: string;
  render: (row: T) => ReactNode;
}

export function CrudPage<T extends { id: string; version?: number }>(props: {
  title: string;
  intro?: ReactNode;
  path: string; // API collection path
  query?: string; // extra list query, e.g. ?outletId=
  columns: Column<T>[];
  fields: FieldSpec[];
  defaults: Record<string, any>;
  canManage: boolean;
  filter?: (row: T) => boolean;
  extra?: (values: Record<string, any>, set: (k: string, v: any) => void) => ReactNode;
}) {
  const list = useApi<T[]>(`${props.path}${props.query ?? ''}`);
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = (list.data ?? []).filter(props.filter ?? (() => true));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { id, createdAt, updatedAt, ...body } = editing!;
      await api(id ? `${props.path}/${id}` : props.path, { method: id ? 'PUT' : 'POST', body });
      setEditing(null);
      await list.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title={props.title}
      intro={props.intro}
      actions={
        props.canManage && (
          <button
            onClick={() => {
              setError(null);
              setEditing({ ...props.defaults });
            }}
          >
            Add
          </button>
        )
      }
    >
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
            {rows.map((r) => (
              <tr key={r.id}>
                {props.columns.map((c) => (
                  <td key={c.label}>{c.render(r)}</td>
                ))}
                {props.canManage && (
                  <td className="actions">
                    <button
                      className="ghost"
                      onClick={() => {
                        setError(null);
                        setEditing({ ...r });
                      }}
                    >
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && !list.loading && (
              <tr>
                <td colSpan={props.columns.length + 1} className="muted">
                  Nothing here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Modal open={!!editing} title={editing?.id ? `Edit ${props.title.toLowerCase()}` : `Add ${props.title.toLowerCase()}`} onClose={() => setEditing(null)} wide>
        {editing && (
          <form onSubmit={save}>
            <Fields specs={props.fields} values={editing} set={(k, v) => setEditing((e) => ({ ...e!, [k]: v }))} />
            {props.extra?.(editing, (k, v) => setEditing((e) => ({ ...e!, [k]: v })))}
            <ErrorNote error={error} />
            <footer className="row end">
              <button type="button" className="ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
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

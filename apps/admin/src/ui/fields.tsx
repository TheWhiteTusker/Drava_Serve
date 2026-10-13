import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

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

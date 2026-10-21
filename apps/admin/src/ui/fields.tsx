import { useState, type ReactNode } from 'react';
import { Eye, EyeOff, Search, X } from 'lucide-react';

// ---------- Forms ----------

export interface FieldSpec {
  name: string;
  label: string;
  type?: 'text' | 'decimal' | 'number' | 'select' | 'checkbox' | 'checks' | 'tags' | 'textarea' | 'password' | 'time';
  options?: { value: string; label: string }[];
  help?: string;
  required?: boolean;
  placeholder?: string;
  span?: 1 | 2 | 'full';
  show?: (v: Record<string, any>) => boolean;
}

export function Field({ spec, value, onChange }: { spec: FieldSpec; value: any; onChange: (v: any) => void }) {
  const [showPassword, setShowPassword] = useState(false);
  const id = `f-${spec.name}`;
  const help = spec.help && <small className="muted">{spec.help}</small>;
  const spanClass = spec.span === 'full' ? ' span-full' : spec.span === 2 ? ' span-2' : spec.type === 'textarea' || spec.type === 'checks' ? ' span-2' : '';

  if (spec.type === 'checkbox') {
    return (
      <div className={`field${spanClass}`}>
        <label className="check">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <span>{spec.label}</span>
        </label>
        {help}
      </div>
    );
  }
  if (spec.type === 'checks') {
    const set = new Set<string>(value ?? []);
    return (
      <fieldset className={`field${spanClass}`}>
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
              <span>{o.label}</span>
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
    input = <textarea id={id} value={value ?? ''} placeholder={spec.placeholder} onChange={(e) => onChange(e.target.value)} rows={3} />;
  } else if (spec.type === 'tags') {
    input = (
      <input
        id={id}
        value={(value ?? []).join(', ')}
        placeholder={spec.placeholder}
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
      />
    );
  } else if (spec.type === 'password') {
    input = (
      <div className="password-wrap">
        <input
          id={id}
          type={showPassword ? 'text' : 'password'}
          value={value ?? ''}
          required={spec.required}
          placeholder={spec.placeholder}
          autoComplete="new-password"
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setShowPassword((prev) => !prev)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          title={showPassword ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {showPassword ? <EyeOff className="icon" aria-hidden /> : <Eye className="icon" aria-hidden />}
        </button>
      </div>
    );
  } else {
    input = (
      <input
        id={id}
        type={spec.type === 'time' ? 'time' : 'text'}
        inputMode={spec.type === 'decimal' ? 'decimal' : spec.type === 'number' ? 'numeric' : undefined}
        value={value ?? ''}
        required={spec.required}
        placeholder={spec.placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
    );
  }
  return (
    <div className={`field${spanClass}`}>
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
    <div className="searchbox">
      <Search className="icon" aria-hidden />
      <span className="sr-only">{placeholder}</span>
      <input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button
          type="button"
          className="search-clear"
          onClick={() => onChange('')}
          aria-label="Clear search"
          title="Clear search"
        >
          <X className="icon" style={{ width: 14, height: 14 }} />
        </button>
      )}
    </div>
  );
}

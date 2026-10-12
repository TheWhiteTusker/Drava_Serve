import { useState, useSyncExternalStore } from 'react';
import { AlertCircle, CheckCircle2, CloudOff, RefreshCw } from 'lucide-react';
import type { Session, SessionStore } from './session';

export function Login({ session, title, subtitle }: { session: SessionStore; title: string; subtitle?: string }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      session.set(await session.api<Session>('/auth/login', { body: { login, password } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="signin">
      <form onSubmit={submit} className="stack">
        <span className="logo" role="img" aria-label="Logo" />
        <div className="eyebrow">{title}</div>
        <h1 style={{ marginTop: 0 }}>Sign in</h1>
        {subtitle && <p className="muted" style={{ marginTop: 0 }}>{subtitle}</p>}
        <label className="field">
          Email or phone
          <input autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p className="note danger" role="alert">
            <AlertCircle className="icon" aria-hidden /> {error}
          </p>
        )}
        <button className="huge" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

export function OfflineBar({ q }: { q: { pending: number; online: boolean; failed: { label: string; message: string }[] } }) {
  if (q.online && !q.pending && !q.failed.length) return null;
  return (
    <div role="status" aria-live="polite">
      {(!q.online || q.pending > 0) && (
        <div className={`offline ${q.online ? 'ok' : ''}`}>
          {q.online ? <RefreshCw className="icon" aria-hidden /> : <CloudOff className="icon" aria-hidden />}
          {q.online
            ? `Sending ${q.pending} saved change${q.pending === 1 ? '' : 's'}…`
            : `No connection. ${q.pending} change${q.pending === 1 ? '' : 's'} saved on this device; they will send by themselves.`}
        </div>
      )}
      {q.failed.map((f, i) => (
        <div key={i} className="note danger" style={{ margin: '0.5rem' }}>
          <AlertCircle className="icon" aria-hidden /> Not accepted: {f.label} — {f.message}
        </div>
      ))}
    </div>
  );
}

// FSSAI marks by shape: veg = circle in a square (green), non-veg and egg = triangle in a square (brown).
export function DietMark({ diet, size = 16 }: { diet?: string | null; size?: number }) {
  if (!diet) return null;
  const veg = diet === 'veg';
  const label = veg ? 'Veg' : diet === 'egg' ? 'Contains egg (non-veg)' : 'Non-veg';
  const color = veg ? 'var(--mark-veg)' : 'var(--mark-nonveg)';
  return (
    <svg className="diet-mark" viewBox="0 0 16 16" width={size} height={size} role="img" aria-label={label}>
      <title>{label}</title>
      <rect x="1" y="1" width="14" height="14" fill="none" stroke={color} strokeWidth="1.6" rx="2" />
      {veg ? <circle cx="8" cy="8" r="3.6" fill={color} /> : <path d="M8 3.8 12.2 11.6H3.8Z" fill={color} />}
    </svg>
  );
}

export const rupee = (v: string | number | null | undefined) =>
  v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const rupeeShort = (v: string | number) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const initials = (name: string) =>
  name
    .replace(/\(.*\)/, '')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

// Short confirmations at the bottom of the screen.
type Toast = { id: number; text: string; tone: 'ok' | 'danger' };
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
export function toast(text: string, tone: Toast['tone'] = 'ok') {
  const t = { id: Date.now() + Math.random(), text, tone };
  toasts = [...toasts, t];
  listeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    listeners.forEach((l) => l());
  }, 4500);
}
export function Toasts() {
  const list = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => toasts,
  );
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone === 'danger' ? 'danger' : ''}`}>
          {t.tone === 'danger' ? <AlertCircle className="icon" aria-hidden /> : <CheckCircle2 className="icon" aria-hidden />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

// Registers the page's service worker so it opens without a connection.
export function registerWorker(path: string) {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register(path).catch(() => {});
  }
}

import logoDark from '@fnb/theme/logo-dark.svg';
import { ShieldCheck, Sparkles, Truck } from 'lucide-react';
import { useState } from 'react';
import { api, setSession, type Session } from '../api';
import { ErrorNote } from '../ui';

// ---------- Sign in ----------

export function Login() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setSession(await api<Session>('/auth/login', { body: { login, password } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="login-brand">
        <img src={logoDark} alt="F&B Manager" />
        <div>
          <h1>Run the kitchen, the bar and the books in one place.</h1>
          <p>Live stock, nightly orders, costed recipes, a menu that ranks itself by margin, and billing that keeps working offline.</p>
          <ul>
            <li>
              <Sparkles className="icon" aria-hidden /> Menu order follows your margins, every morning
            </li>
            <li>
              <Truck className="icon" aria-hidden /> Vendor orders built at closing, checked at the gate
            </li>
            <li>
              <ShieldCheck className="icon" aria-hidden /> Every change recorded: who, when and on which device
            </li>
          </ul>
        </div>
        <small style={{ color: '#9f927d' }}>White Tusker Private Limited</small>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <div className="eyebrow">Welcome back</div>
          <h2>Sign in</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Use the email or phone number your owner set up for you.
          </p>
          <div className="field">
            <label htmlFor="login">Email or phone</label>
            <input id="login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <ErrorNote error={error} />
          <button className="big" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Forgot your password? Ask your owner or manager to set a new one under Users.
          </p>
        </form>
      </section>
    </main>
  );
}

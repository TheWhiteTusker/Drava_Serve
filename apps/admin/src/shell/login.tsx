import logoDark from '@fnb/theme/logo-dark.svg';
import { Eye, EyeOff, ShieldCheck, Sparkles, Truck } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, setSession, type Session } from '../api';
import { ErrorNote } from '../ui';
import { ForgotPassword, ResetPassword } from './password';

// ---------- Sign in ----------

export function Login() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The emailed reset link opens /reset-password?token=…
  const location = useLocation();
  const navigate = useNavigate();
  const token = location.pathname === '/reset-password' ? new URLSearchParams(location.search).get('token') : null;
  const [forgot, setForgot] = useState(false);
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
        <img src={logoDark} alt="Drava Serve" />
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
        {token ? (
          <ResetPassword token={token} onDone={() => navigate('/', { replace: true })} />
        ) : forgot ? (
          <ForgotPassword onBack={() => setForgot(false)} />
        ) : (
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
            <div className="password-wrap">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
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
          </div>
          <ErrorNote error={error} />
          <button className="big" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            <button type="button" className="link" onClick={() => setForgot(true)}>
              Forgot your password?
            </button>{' '}
            If you sign in with a phone number, ask your owner to set a new one under Users.
          </p>
        </form>
        )}
      </section>
    </main>
  );
}

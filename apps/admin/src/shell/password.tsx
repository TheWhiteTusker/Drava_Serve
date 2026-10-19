import { useState } from 'react';
import { api } from '../api';
import { ErrorNote, Modal, toast } from '../ui';

// ---------- Passwords: ask for a reset link, set one from the link, change your own ----------

// A form that shows the API's error and blocks double submits.
function useSubmit(run: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { submit, error, setError, busy };
}

function NewPassword({ value, again, onChange, onAgain }: { value: string; again: string; onChange: (v: string) => void; onAgain: (v: string) => void }) {
  return (
    <>
      <div className="field">
        <label htmlFor="new-password">New password</label>
        <input id="new-password" type="password" autoComplete="new-password" minLength={8} required value={value} onChange={(e) => onChange(e.target.value)} />
        <small className="muted">At least 8 characters</small>
      </div>
      <div className="field">
        <label htmlFor="new-password-again">New password again</label>
        <input id="new-password-again" type="password" autoComplete="new-password" required value={again} onChange={(e) => onAgain(e.target.value)} />
      </div>
    </>
  );
}

const MISMATCH = 'The two new passwords are not the same';

// Sends a reset link by email. The answer is the same whether or not the sign-in exists.
export function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [login, setLogin] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const f = useSubmit(async () => setSent((await api<{ message: string }>('/auth/forgot', { body: { login } })).message));
  return (
    <form onSubmit={f.submit}>
      <div className="eyebrow">Forgot password</div>
      <h2>Get a new password</h2>
      {sent ? (
        <p>{sent} Check your inbox and spam folder; the link works for 30 minutes.</p>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Enter the email you sign in with and we'll send you a link. If you sign in with a phone number, ask your owner to set a new password under Users.
          </p>
          <div className="field">
            <label htmlFor="forgot-login">Email</label>
            <input id="forgot-login" type="email" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
          </div>
          <ErrorNote error={f.error} />
          <button className="big" disabled={f.busy}>
            {f.busy ? 'Sending…' : 'Send the link'}
          </button>
        </>
      )}
      <button type="button" className="link" onClick={onBack}>
        Back to sign in
      </button>
    </form>
  );
}

// Opened from the emailed link (/reset-password?token=…).
export function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const f = useSubmit(async () => {
    if (password !== again) return f.setError(MISMATCH);
    await api('/auth/reset', { body: { token, password } });
    toast('New password set. Sign in with it now.');
    onDone();
  });
  return (
    <form onSubmit={f.submit}>
      <div className="eyebrow">Forgot password</div>
      <h2>Choose a new password</h2>
      <NewPassword value={password} again={again} onChange={setPassword} onAgain={setAgain} />
      <ErrorNote error={f.error} />
      <button className="big" disabled={f.busy}>
        {f.busy ? 'Saving…' : 'Set the new password'}
      </button>
      <button type="button" className="link" onClick={onDone}>
        Back to sign in
      </button>
    </form>
  );
}

// From the account menu. Five wrong current passwords lock the account, as at sign-in.
export function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const close = () => (setCurrent(''), setPassword(''), setAgain(''), onClose());
  const f = useSubmit(async () => {
    if (password !== again) return f.setError(MISMATCH);
    await api('/auth/password', { body: { currentPassword: current, newPassword: password } });
    toast('Password changed');
    close();
  });
  return (
    <Modal open={open} title="Change password" onClose={close}>
      <form onSubmit={f.submit}>
        <div className="field">
          <label htmlFor="current-password">Current password</label>
          <input id="current-password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <NewPassword value={password} again={again} onChange={setPassword} onAgain={setAgain} />
        <ErrorNote error={f.error} />
        <footer className="row end">
          <button type="button" className="ghost" onClick={close}>
            Cancel
          </button>
          <button disabled={f.busy}>{f.busy ? 'Saving…' : 'Change password'}</button>
        </footer>
      </form>
    </Modal>
  );
}

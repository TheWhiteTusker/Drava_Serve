import { useState } from 'react';
import { api, setSession, useApi, useCurrentOutlet, type Session } from '../api';
import { ErrorNote, Modal } from '../ui';

// ---------- Switch user with a PIN (shared devices) ----------

export function PinSwitch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const outletId = useCurrentOutlet();
  const people = useApi<{ id: string; name: string }[]>(open ? `/auth/pin-users${outletId ? `?outletId=${outletId}` : ''}` : null);
  const [who, setWho] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const press = (d: string) => setPin((p) => (p + d).slice(0, 6));
  async function go() {
    try {
      setSession(await api<Session>(`/auth/pin${outletId ? `?outletId=${outletId}` : ''}`, { body: { userId: who, pin } }));
      setPin('');
      setWho(null);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setPin('');
    }
  }
  return (
    <Modal open={open} title="Switch user" onClose={onClose}>
      {!who ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Who is taking over this device?
          </p>
          <div className="people">
            {(people.data ?? []).map((p) => (
              <button key={p.id} className="secondary" onClick={() => setWho(p.id)}>
                <span className="avatar">{initials(p.name)}</span>
                {p.name.replace(/\s*\(.*\)/, '')}
              </button>
            ))}
            {people.data?.length === 0 && <p className="muted">No one at this outlet has a PIN yet. Set PINs under Users.</p>}
          </div>
        </>
      ) : (
        <div
          className="pinpad"
          onKeyDown={(e) => {
            if (/^\d$/.test(e.key)) press(e.key);
            if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
            if (e.key === 'Enter' && pin.length >= 4) go();
          }}
        >
          <p style={{ textAlign: 'center' }}>
            Enter the PIN for <strong>{people.data?.find((p) => p.id === who)?.name}</strong>
          </p>
          <output aria-live="polite" className="pin-dots">
            {'●'.repeat(pin.length) || ' '}
          </output>
          <div className="keys">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} className="secondary big" onClick={() => press(d)}>
                {d}
              </button>
            ))}
            <button className="ghost big" onClick={() => setWho(null)}>
              Back
            </button>
            <button className="secondary big" onClick={() => press('0')}>
              0
            </button>
            <button className="big gold" disabled={pin.length < 4} onClick={go}>
              OK
            </button>
          </div>
          <ErrorNote error={error} />
        </div>
      )}
    </Modal>
  );
}

export const initials = (name: string) =>
  name
    .replace(/\(.*\)/, '')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

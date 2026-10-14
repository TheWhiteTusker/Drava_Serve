import { useEffect, useRef, useState } from 'react';
import type { Session } from '../lib/session';
import { session } from './device';

// ---------- Small dialogs ----------

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className={wide ? 'wide' : ''} onClose={onClose} aria-label={title}>
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <h2 style={{ flex: 4 }}>{title}</h2>
        <button className="ghost" onClick={onClose} aria-label="Close" style={{ flex: 0 }}>
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function PinSwitch({ outletId, onClose }: { outletId: string; onClose: () => void }) {
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [who, setWho] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    session.api(`/auth/pin-users?outletId=${outletId}`).then(setPeople).catch((e) => setError(e.message));
  }, [outletId]);
  async function go() {
    try {
      session.set(await session.api<Session>(`/auth/pin?outletId=${outletId}`, { body: { userId: who, pin } }));
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setPin('');
    }
  }
  return (
    <Dialog title="Switch user" onClose={onClose}>
      {!who ? (
        <div className="grid-buttons">
          {people.map((p) => (
            <button key={p.id} className="secondary" onClick={() => setWho(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="stack" onKeyDown={(e) => (/^\d$/.test(e.key) ? setPin((p) => (p + e.key).slice(0, 6)) : e.key === 'Enter' && pin.length >= 4 && go())}>
          <p>PIN for {people.find((p) => p.id === who)?.name}</p>
          <output className="big" aria-live="polite">
            {'●'.repeat(pin.length) || ' '}
          </output>
          <div className="keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} className="secondary huge" onClick={() => setPin((p) => (p + d).slice(0, 6))}>
                {d}
              </button>
            ))}
            <button className="ghost huge" onClick={() => setWho(null)}>
              Back
            </button>
            <button className="secondary huge" onClick={() => setPin((p) => (p + '0').slice(0, 6))}>
              0
            </button>
            <button className="huge" disabled={pin.length < 4} onClick={go}>
              OK
            </button>
          </div>
        </div>
      )}
      {error && <p className="note danger">{error}</p>}
    </Dialog>
  );
}

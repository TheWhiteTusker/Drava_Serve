import '@fnb/theme/theme.css';
import '../lib/field.css';
import './kitchen.css';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { Check, ChefHat, LogOut, RotateCcw, Wine } from 'lucide-react';
import { createSession } from '../lib/session';
import { initials, Login, toast, Toasts } from '../lib/ui';

// Kitchen screen (a tablet on the pass or at the bar): every order the counter places, and every
// guest order a cashier accepts, appears here at once. Tap "Ready" when it goes out.

const session = createSession('kitchen');
type Station = 'food' | 'beverage';
interface Ticket {
  id: string;
  billNumber: string | null;
  kind: 'dine_in' | 'takeaway';
  table: string | null;
  placedAt: string;
  placedBy: string | null;
  readyAt: string | null;
  lines: { id: string; name: string; qty: string; voided: boolean; readyAt: string | null }[];
}

const minutes = (at: string) => Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 60_000));
const qty = (q: string) => String(Number(q));

// A short two-note chime when a new ticket arrives, so nobody has to watch the screen.
function chime() {
  try {
    const ac = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.25, ac.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + i * 0.18 + 0.3);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + i * 0.18);
      o.stop(ac.currentTime + i * 0.18 + 0.32);
    });
  } catch {
    // no sound on this device
  }
}

function Board() {
  const s = session.use()!;
  const outletId = session.outletId()!;
  const [station, setStation] = useState<Station>(() => (localStorage.getItem('fnb.kitchen.station') as Station) ?? 'food');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [online, setOnline] = useState(true);
  const [, tick] = useState(0);
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await session.api<Ticket[]>(`/kitchen?outletId=${outletId}&station=${station}`);
      const fresh = list.filter((t) => !t.readyAt && seen.current && !seen.current.has(t.id));
      if (fresh.length) chime();
      seen.current = new Set(list.map((t) => t.id));
      setTickets(list);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, [outletId, station]);

  useEffect(() => {
    seen.current = null; // no chime for what is already waiting when the screen opens
    load();
    const sock = io({ path: '/api/socket', auth: { token: s.token }, transports: ['websocket'] });
    sock.on('bill', load);
    sock.on('kitchen', load);
    sock.on('connect', load);
    sock.on('disconnect', () => setOnline(false));
    const timer = setInterval(() => tick((n) => n + 1), 30_000); // ticket ages
    const poll = setInterval(load, 60_000); // in case a live update was missed
    return () => (sock.close(), clearInterval(timer), clearInterval(poll));
  }, [s.token, load]);

  const pick = (st: Station) => (localStorage.setItem('fnb.kitchen.station', st), setStation(st));
  async function mark(t: Ticket, ready: boolean) {
    setTickets((list) => list.map((x) => (x.id === t.id ? { ...x, readyAt: ready ? new Date().toISOString() : null } : x)));
    try {
      await session.api(`/kitchen/${t.id}/ready`, { body: { station, ready } });
    } catch (e) {
      toast((e as Error).message, 'danger');
      load();
    }
  }

  const waiting = tickets.filter((t) => !t.readyAt);
  const done = tickets.filter((t) => t.readyAt).reverse();
  return (
    <>
      <header className="bar">
        <span className="logo" role="img" aria-label="Logo" />
        <div className="kds-stations" role="tablist" aria-label="Station">
          <button role="tab" aria-selected={station === 'food'} className={station === 'food' ? '' : 'ghost'} onClick={() => pick('food')}>
            <ChefHat className="icon" aria-hidden /> Kitchen
          </button>
          <button role="tab" aria-selected={station === 'beverage'} className={station === 'beverage' ? '' : 'ghost'} onClick={() => pick('beverage')}>
            <Wine className="icon" aria-hidden /> Bar
          </button>
        </div>
        <span className="spacer" />
        {!online && <span className="badge danger">Offline</span>}
        {s.outlets.length > 1 && (
          <select aria-label="Outlet" value={outletId} onChange={(e) => session.setOutlet(e.target.value)} style={{ width: 'auto' }}>
            {s.outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <button className="ghost" onClick={() => session.set(null)} title="Sign out">
          <span className="avatar">{initials(s.user.name)}</span>
          <LogOut className="icon" aria-hidden />
          <span className="sr-only">Sign out</span>
        </button>
      </header>
      <main className="kds">
        <h1 className="kds-title">
          {waiting.length ? `${waiting.length} to make` : 'Nothing waiting'}
        </h1>
        {waiting.length === 0 && <p className="muted">New orders from the counter and from tables appear here with a chime.</p>}
        <div className="kds-grid">
          {waiting.map((t) => {
            const age = minutes(t.placedAt);
            return (
              <article key={t.id} className={`kds-ticket ${age >= 20 ? 'late' : age >= 10 ? 'slow' : ''}`}>
                <header>
                  <strong>{t.kind === 'takeaway' ? 'Takeaway' : `Table ${t.table ?? '-'}`}</strong>
                  <span className="kds-age">{age} min</span>
                </header>
                <div className="muted kds-meta">
                  {t.billNumber} · {new Date(t.placedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  {t.placedBy ? ` · ${t.placedBy}` : ''}
                </div>
                <ul>
                  {t.lines.map((l) => (
                    <li key={l.id} className={l.voided ? 'voided' : ''}>
                      <span className="kds-qty">{qty(l.qty)}×</span> {l.name}
                      {l.voided && <span className="badge danger">Cancelled</span>}
                    </li>
                  ))}
                </ul>
                <button className="gold huge" onClick={() => mark(t, true)}>
                  <Check className="icon" aria-hidden /> Ready
                </button>
              </article>
            );
          })}
        </div>
        {done.length > 0 && (
          <>
            <h2 className="kds-done-title">Just done</h2>
            <div className="kds-done">
              {done.map((t) => (
                <button key={t.id} className="secondary" onClick={() => mark(t, false)} title="Put it back on the board">
                  <RotateCcw className="icon" aria-hidden />
                  {t.kind === 'takeaway' ? 'Takeaway' : `Table ${t.table ?? '-'}`} · {t.lines.filter((l) => !l.voided).map((l) => `${qty(l.qty)}× ${l.name}`).join(', ')}
                </button>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}

function App() {
  const s = session.use();
  if (!s) return <Login session={session} title="Kitchen" subtitle="Orders for the kitchen and the bar, as they come in." />;
  if (!s.outlets.length) return <p className="wrap">You are not assigned to an outlet.</p>;
  if (!session.can('kitchen.view', session.outletId())) return <p className="wrap">Your role cannot see the kitchen screen. Ask the owner to add "kitchen" to it under Roles.</p>;
  return <Board />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toasts />
  </StrictMode>,
);

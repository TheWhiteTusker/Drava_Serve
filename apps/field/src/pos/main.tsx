import '@fnb/theme/theme.css';
import '../lib/field.css';
import './pos.css';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Login, registerWorker, Toasts } from '../lib/ui';
import { session } from './device';
import { Till } from './till/till';

// Billing POS for a counter tablet or desktop. Touch, mouse and keyboard; keeps billing offline.
// Margins never reach this screen: the API sends prices and order only.

registerWorker('/pos/sw.js');

function App() {
  const s = session.use();
  const [outletId, setOutletId] = useState<string | null>(() => session.outletId());
  if (!s) return <Login session={session} title="Billing counter" subtitle="Sign in once; after that, staff switch with their PIN." />;
  const allowed = s.outlets.filter((o) => session.can('pos.bill', o.id));
  if (!allowed.length) return <p className="wrap">You do not have billing access at any outlet.</p>;
  if (allowed.length === 1) return <Till key={`${allowed[0].id}-${s.user.id}`} outletId={allowed[0].id} />;
  if (!outletId || !allowed.some((o) => o.id === outletId)) {
    return (
      <main className="wrap stack">
        <h1>Which outlet is this counter at?</h1>
        {allowed.map((o) => (
          <button key={o.id} className="huge" onClick={() => (session.setOutlet(o.id), setOutletId(o.id))}>
            {o.name}
          </button>
        ))}
      </main>
    );
  }
  return <Till key={`${outletId}-${s.user.id}`} outletId={outletId} />;
}

function Root() {
  return (
    <>
      <App />
      <Toasts />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

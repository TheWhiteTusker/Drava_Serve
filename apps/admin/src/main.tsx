import '@fnb/theme/theme.css';
import './app.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import type { Permission } from '@fnb/shared';
import { api, can, setCurrentOutlet, setSession, useApi, useCurrentOutlet, useSession, type Session } from './api';
import { ErrorNote, Modal } from './ui';
import { AuditPage } from './pages/audit';
import { ApprovalsPage, CountsPage, LiquorRegisterPage, StockPage } from './pages/inventory';
import { BrandsPage, CategoriesPage, LiquorTreePage, TaxClassesPage } from './pages/catalog';
import { MenuItemsPage } from './pages/menu-items';
import { CostingPage, MarginTargetsPage, OffersPage } from './pages/pricing';
import { DeliveriesPage, GrnsPage, IndentsPage, VendorsPage } from './pages/purchasing';
import { OutletsPage, SettingsPage } from './pages/outlets';
import { StockItemsPage } from './pages/stock-items';
import { RolesPage, UsersPage } from './pages/users';

// ---------- Theme: follows the device, or a remembered light / dark choice ----------

type ThemeChoice = 'system' | 'light' | 'dark';
function useTheme(): [ThemeChoice, () => void] {
  const [choice, setChoice] = useState<ThemeChoice>(() => (localStorage.getItem('fnb.theme') as ThemeChoice) ?? 'system');
  useEffect(() => {
    if (choice === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', choice);
    localStorage.setItem('fnb.theme', choice);
  }, [choice]);
  const next = { system: 'light', light: 'dark', dark: 'system' } as const;
  return [choice, () => setChoice((c) => next[c])];
}

// ---------- Sign in ----------

function Login() {
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
      <form onSubmit={submit} className="card">
        <span className="logo" role="img" aria-label="Logo" />
        <h1>Sign in</h1>
        <div className="field">
          <label htmlFor="login">Email or phone</label>
          <input id="login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <ErrorNote error={error} />
        <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}

// ---------- Switch user with a PIN (shared devices) ----------

function PinSwitch({ open, onClose }: { open: boolean; onClose: () => void }) {
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
        <div className="people">
          {(people.data ?? []).map((p) => (
            <button key={p.id} className="secondary big" onClick={() => setWho(p.id)}>
              {p.name}
            </button>
          ))}
          {people.data?.length === 0 && <p className="muted">No one at this outlet has a PIN yet. Set PINs under Users.</p>}
        </div>
      ) : (
        <div className="pinpad">
          <p>
            PIN for <strong>{people.data?.find((p) => p.id === who)?.name}</strong>
          </p>
          <output aria-live="polite" className="pin-dots">
            {'●'.repeat(pin.length) || ' '}
          </output>
          <div
            className="keys"
            onKeyDown={(e) => {
              if (/^\d$/.test(e.key)) press(e.key);
              if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
              if (e.key === 'Enter' && pin.length >= 4) go();
            }}
          >
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
            <button className="big" disabled={pin.length < 4} onClick={go}>
              OK
            </button>
          </div>
          <ErrorNote error={error} />
        </div>
      )}
    </Modal>
  );
}

// ---------- Layout ----------

const NAV: { to: string; label: string; perm?: Permission; group: string; page: () => React.JSX.Element | null }[] = [
  { to: '/outlets', label: 'Outlets', group: 'Business', page: OutletsPage },
  { to: '/settings', label: 'Settings', group: 'Business', perm: 'settings.manage', page: SettingsPage },
  { to: '/users', label: 'Users', group: 'Business', perm: 'users.manage', page: UsersPage },
  { to: '/roles', label: 'Roles', group: 'Business', perm: 'users.manage', page: RolesPage },
  { to: '/audit', label: 'Change history', group: 'Business', perm: 'audit.view', page: AuditPage },
  { to: '/approvals', label: 'Approvals', group: 'Business', page: ApprovalsPage },
  { to: '/stock', label: 'Stock', group: 'Inventory', perm: 'inventory.view', page: StockPage },
  { to: '/counts', label: 'Stock counts', group: 'Inventory', perm: 'inventory.view', page: CountsPage },
  { to: '/liquor-register', label: 'Liquor register', group: 'Inventory', perm: 'inventory.view', page: LiquorRegisterPage },
  { to: '/indents', label: 'Nightly indent', group: 'Purchasing', perm: 'indent.manage', page: IndentsPage },
  { to: '/deliveries', label: 'Deliveries', group: 'Purchasing', perm: 'indent.manage', page: DeliveriesPage },
  { to: '/vendors', label: 'Vendors and rates', group: 'Purchasing', perm: 'vendors.manage', page: VendorsPage },
  { to: '/accounts', label: 'Accounts', group: 'Purchasing', perm: 'rates.view', page: GrnsPage },
  { to: '/costing', label: 'Menu costs and order', group: 'Pricing', perm: 'rates.view', page: CostingPage },
  { to: '/margin-targets', label: 'Margin targets', group: 'Pricing', perm: 'rates.view', page: MarginTargetsPage },
  { to: '/offers', label: 'Beverage offers', group: 'Pricing', perm: 'rates.view', page: OffersPage },
  { to: '/menu-items', label: 'Menu items', group: 'Catalog', perm: 'catalog.view', page: MenuItemsPage },
  { to: '/stock-items', label: 'Stock items', group: 'Catalog', perm: 'catalog.view', page: StockItemsPage },
  { to: '/liquor', label: 'Liquor tree', group: 'Catalog', perm: 'catalog.view', page: LiquorTreePage },
  { to: '/categories', label: 'Courses and categories', group: 'Catalog', perm: 'catalog.view', page: CategoriesPage },
  { to: '/brands', label: 'Brands', group: 'Catalog', perm: 'catalog.view', page: BrandsPage },
  { to: '/tax-classes', label: 'Tax classes', group: 'Catalog', perm: 'catalog.view', page: TaxClassesPage },
];


function Shell({ s }: { s: Session }) {
  const [theme, cycleTheme] = useTheme();
  const [pinOpen, setPinOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const outletId = useCurrentOutlet();
  const nav = NAV.filter((n) => !n.perm || can(s, n.perm));
  const groups = [...new Set(nav.map((n) => n.group))];

  return (
    <div className="shell">
      <header className="topbar">
        <button className="ghost menu-toggle" aria-expanded={menuOpen} aria-controls="sidenav" onClick={() => setMenuOpen((o) => !o)}>
          ☰<span className="sr-only">Menu</span>
        </button>
        <span className="logo" role="img" aria-label="Logo" />
        <span className="muted customer">{s.customer.name}</span>
        <span className="spacer" />
        {s.outlets.length > 0 && (
          <label className="outlet-pick">
            <span className="sr-only">Outlet</span>
            <select value={outletId ?? ''} onChange={(e) => setCurrentOutlet(e.target.value)}>
              {s.outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="ghost" onClick={cycleTheme} title="Light, dark or follow the device">
          Theme: {theme}
        </button>
        <button className="ghost" onClick={() => setPinOpen(true)}>
          {s.user.name} · Switch
        </button>
        <button className="ghost" onClick={() => setSession(null)}>
          Sign out
        </button>
      </header>
      <nav id="sidenav" className={menuOpen ? 'open' : ''} onClick={() => setMenuOpen(false)}>
        {groups.map((g) => (
          <div key={g}>
            <h2>{g}</h2>
            {nav
              .filter((n) => n.group === g)
              .map((n) => (
                <NavLink key={n.to} to={n.to}>
                  {n.label}
                </NavLink>
              ))}
          </div>
        ))}
      </nav>
      {/* Keyed by user: after a PIN switch every page reloads with the new person's access. */}
      <main className="content" key={s.user.id}>
        <Routes>
          {nav.map((n) => (
            <Route key={n.to} path={n.to} element={<n.page />} />
          ))}
          <Route path="*" element={<Navigate to={nav.find((n) => n.to === '/menu-items')?.to ?? nav[0].to} replace />} />
        </Routes>
      </main>
      <PinSwitch open={pinOpen} onClose={() => setPinOpen(false)} />
    </div>
  );
}

function App() {
  const s = useSession();
  // Refresh outlets and permissions on load, in case an admin changed them.
  useEffect(() => {
    if (s) api('/auth/me').then((me) => setSession({ ...s, ...me })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.token]);
  return s ? <Shell s={s} /> : <Login />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

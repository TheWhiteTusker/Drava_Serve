import '@fnb/theme/theme.css';
import './app.css';
import logoDark from '@fnb/theme/logo-dark.svg';
import {
  Activity as ActivityIcon, Beer, BookOpen, Boxes, ChartColumn, ChefHat, ClipboardCheck, ClipboardList, FileBarChart, Gauge, History, Laptop, LayoutGrid,
  LogOut, Menu, Moon, Percent, QrCode, Receipt, Scale, Search, Settings, ShieldCheck, ShoppingBasket, Sparkles, Store, Sun, Tag, Tags,
  Truck, UserCog, Users, Wallet, Wine,
  type LucideIcon,
} from 'lucide-react';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Permission } from '@fnb/shared';
import { api, can, setCurrentOutlet, setSession, useApi, useCurrentOutlet, useSession, type Session } from './api';
import { ErrorNote, Modal, Toasts } from './ui';
import { ActivityPage } from './pages/activity';
import { AuditPage } from './pages/audit';
import { DashboardPage, ReportsPage } from './pages/dashboard';
import { ApprovalsPage, CountsPage, LiquorRegisterPage, StockPage } from './pages/inventory';
import { BrandsPage, CategoriesPage, LiquorTreePage, TaxClassesPage } from './pages/catalog';
import { MenuItemsPage } from './pages/menu-items';
import { CostingPage, MarginTargetsPage, OffersPage } from './pages/pricing';
import { DeliveriesPage, GrnsPage, IndentsPage, VendorsPage } from './pages/purchasing';
import { OutletsPage, SettingsPage, TablesPage } from './pages/outlets';
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
const THEME_ICON = { system: Laptop, light: Sun, dark: Moon };
const THEME_LABEL = { system: 'Theme: follows this device', light: 'Theme: light', dark: 'Theme: dark' };

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

const initials = (name: string) =>
  name
    .replace(/\(.*\)/, '')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

// ---------- Navigation ----------

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: Permission;
  group: string;
  page: () => React.JSX.Element | null;
  keywords?: string;
}
const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: Gauge, group: 'Overview', perm: 'reports.view', page: DashboardPage, keywords: 'sales today home' },
  { to: '/reports', label: 'Reports', icon: FileBarChart, group: 'Overview', perm: 'reports.view', page: ReportsPage, keywords: 'menu engineering pour cost csv export day close' },
  { to: '/activity', label: 'Activity', icon: ActivityIcon, group: 'Overview', perm: 'reports.view', page: ActivityPage, keywords: 'offers log history sold out what happened' },
  { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, group: 'Overview', page: ApprovalsPage, keywords: 'approve reject pending' },
  { to: '/menu-items', label: 'Menu items', icon: BookOpen, group: 'Menu', perm: 'catalog.view', page: MenuItemsPage, keywords: 'dishes drinks prices food' },
  { to: '/costing', label: 'Costs and order', icon: ChartColumn, group: 'Menu', perm: 'rates.view', page: CostingPage, keywords: 'recipes margin ranking pin' },
  { to: '/offers', label: 'Beverage offers', icon: Percent, group: 'Menu', perm: 'rates.view', page: OffersPage, keywords: 'discount liquor rule' },
  { to: '/margin-targets', label: 'Margin targets', icon: Scale, group: 'Menu', perm: 'rates.view', page: MarginTargetsPage },
  { to: '/stock', label: 'Stock', icon: Boxes, group: 'Inventory', perm: 'inventory.view', page: StockPage, keywords: 'wastage transfer ledger' },
  { to: '/counts', label: 'Stock counts', icon: ClipboardList, group: 'Inventory', perm: 'inventory.view', page: CountsPage, keywords: 'variance opening stock' },
  { to: '/liquor-register', label: 'Liquor register', icon: Wine, group: 'Inventory', perm: 'inventory.view', page: LiquorRegisterPage, keywords: 'excise bottles' },
  { to: '/indents', label: 'Nightly indent', icon: ShoppingBasket, group: 'Purchasing', perm: 'indent.manage', page: IndentsPage, keywords: 'order vendor pdf whatsapp' },
  { to: '/deliveries', label: 'Deliveries', icon: Truck, group: 'Purchasing', perm: 'indent.manage', page: DeliveriesPage, keywords: 'gate receiving grn' },
  { to: '/vendors', label: 'Vendors and rates', icon: Store, group: 'Purchasing', perm: 'vendors.manage', page: VendorsPage, keywords: 'suppliers rate history' },
  { to: '/accounts', label: 'Accounts', icon: Wallet, group: 'Purchasing', perm: 'rates.view', page: GrnsPage, keywords: 'payments goods received notes' },
  { to: '/stock-items', label: 'Stock items', icon: ChefHat, group: 'Catalog', perm: 'catalog.view', page: StockItemsPage, keywords: 'ingredients bottles units par' },
  { to: '/liquor', label: 'Liquor tree', icon: Beer, group: 'Catalog', perm: 'catalog.view', page: LiquorTreePage },
  { to: '/categories', label: 'Courses and categories', icon: LayoutGrid, group: 'Catalog', perm: 'catalog.view', page: CategoriesPage },
  { to: '/brands', label: 'Brands', icon: Tag, group: 'Catalog', perm: 'catalog.view', page: BrandsPage },
  { to: '/tax-classes', label: 'Tax classes', icon: Receipt, group: 'Catalog', perm: 'catalog.view', page: TaxClassesPage, keywords: 'gst vat' },
  { to: '/outlets', label: 'Outlets', icon: Store, group: 'Business', page: OutletsPage, keywords: 'qr code fssai' },
  { to: '/tables', label: 'Tables', icon: QrCode, group: 'Business', perm: 'pos.bill', page: TablesPage, keywords: 'qr code table ordering guest' },
  { to: '/users', label: 'Users', icon: Users, group: 'Business', perm: 'users.manage', page: UsersPage, keywords: 'staff pin password' },
  { to: '/roles', label: 'Roles', icon: UserCog, group: 'Business', perm: 'users.manage', page: RolesPage, keywords: 'permissions' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'Business', perm: 'settings.manage', page: SettingsPage, keywords: 'cut-off tolerance offers switch' },
  { to: '/audit', label: 'Change history', icon: History, group: 'Business', perm: 'audit.view', page: AuditPage, keywords: 'audit log' },
];

// Jump anywhere: Ctrl+K (⌘K on a Mac), type a few letters, Enter.
function CommandPalette({ open, onClose, nav }: { open: boolean; onClose: () => void; nav: NavItem[] }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const go = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return nav.filter((n) => words.every((w) => `${n.label} ${n.group} ${n.keywords ?? ''}`.toLowerCase().includes(w)));
  }, [q, nav]);
  useEffect(() => {
    const d = ref.current;
    if (open && !d?.open) d?.showModal();
    if (!open && d?.open) d.close();
    setQ('');
    setI(0);
  }, [open]);
  const pick = (n: NavItem) => {
    go(n.to);
    onClose();
  };
  return (
    <dialog ref={ref} className="palette" onClose={onClose} aria-label="Go to">
      <input
        autoFocus
        placeholder="Where to? Try “stock”, “offers” or “vendors”"
        value={q}
        onChange={(e) => (setQ(e.target.value), setI(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setI((x) => Math.min(x + 1, hits.length - 1));
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setI((x) => Math.max(x - 1, 0));
          }
          if (e.key === 'Enter' && hits[i]) pick(hits[i]);
        }}
      />
      <ul role="listbox">
        {hits.map((n, j) => (
          <li key={n.to}>
            <button role="option" aria-selected={j === i} onMouseEnter={() => setI(j)} onClick={() => pick(n)}>
              <n.icon className="icon" aria-hidden /> {n.label}
              <span className="muted">{n.group}</span>
            </button>
          </li>
        ))}
        {!hits.length && <li className="muted" style={{ padding: '1rem' }}>Nothing found.</li>}
      </ul>
    </dialog>
  );
}

function Shell({ s }: { s: Session }) {
  const [theme, cycleTheme] = useTheme();
  const [pinOpen, setPinOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const outletId = useCurrentOutlet();
  const location = useLocation();
  const nav = NAV.filter((n) => !n.perm || can(s, n.perm));
  const groups = [...new Set(nav.map((n) => n.group))];
  const ThemeIcon = THEME_ICON[theme];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="shell">
      <header className="topbar">
        <button className="ghost icon-only menu-toggle" aria-expanded={menuOpen} aria-controls="sidenav" onClick={() => setMenuOpen((o) => !o)}>
          <Menu className="icon" />
          <span className="sr-only">Menu</span>
        </button>
        <span className="logo" role="img" aria-label="F&B Manager" />
        <span className="customer">{s.customer.name}</span>
        <span className="spacer" />
        <button className="secondary search-trigger" onClick={() => setPaletteOpen(true)}>
          <Search className="icon" aria-hidden /> <span>Go to…</span> <kbd>Ctrl K</kbd>
        </button>
        {s.outlets.length > 0 && (
          <label className="pill">
            <Store className="icon" aria-hidden />
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
        <button className="ghost icon-only" onClick={cycleTheme} title={THEME_LABEL[theme]} aria-label={THEME_LABEL[theme]}>
          <ThemeIcon className="icon" />
        </button>
        <details className="usermenu">
          <summary aria-label="Account">
            <span className="avatar">{initials(s.user.name)}</span>
          </summary>
          <div className="menu">
            <div className="who">
              <strong>{s.user.name}</strong>
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                {s.user.login}
              </div>
            </div>
            <button className="ghost" onClick={() => setPinOpen(true)}>
              <Users className="icon" aria-hidden /> Switch user (PIN)
            </button>
            <button className="ghost" onClick={() => setSession(null)}>
              <LogOut className="icon" aria-hidden /> Sign out
            </button>
          </div>
        </details>
      </header>
      <nav id="sidenav" className={menuOpen ? 'open' : ''} aria-label="Main">
        {groups.map((g) => (
          <div key={g}>
            <h2>{g}</h2>
            {nav
              .filter((n) => n.group === g)
              .map((n) => (
                <NavLink key={n.to} to={n.to}>
                  <n.icon className="icon" aria-hidden /> {n.label}
                </NavLink>
              ))}
          </div>
        ))}
        <h2>Other apps</h2>
        <a href="/pos/" target="_blank" rel="noreferrer">
          <Receipt className="icon" aria-hidden /> Billing POS
        </a>
        <a href="/receiving/" target="_blank" rel="noreferrer">
          <Truck className="icon" aria-hidden /> Receiving app
        </a>
        <a href={`/m/${s.customer.code}/${s.outlets.find((o) => o.id === outletId)?.code ?? ''}`} target="_blank" rel="noreferrer">
          <Tags className="icon" aria-hidden /> Guest menu
        </a>
      </nav>
      {/* Keyed by user: after a PIN switch every page reloads with the new person's access. */}
      <main className="content" key={s.user.id}>
        <Routes>
          {nav.map((n) => (
            <Route key={n.to} path={n.to} element={<n.page />} />
          ))}
          <Route path="*" element={<Navigate to={(nav.find((n) => n.to === '/dashboard') ?? nav.find((n) => n.to === '/menu-items') ?? nav.find((n) => n.to === '/outlets')!).to} replace />} />
        </Routes>
      </main>
      <PinSwitch open={pinOpen} onClose={() => setPinOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} nav={nav} />
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
  return (
    <>
      {s ? <Shell s={s} /> : <Login />}
      <Toasts />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

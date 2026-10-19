import { KeyRound, LogOut, Menu, Receipt, Search, Store, Tags, Truck, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { guestMenuPath } from '@fnb/shared';
import { can, setCurrentOutlet, setSession, useCurrentOutlet, type Session } from '../api';
import { THEME_ICON, THEME_LABEL, useTheme } from './theme';
import { ChangePassword } from './password';
import { PinSwitch, initials } from './pin-switch';
import { NAV } from './nav';
import { CommandPalette } from './palette';

export function Shell({ s }: { s: Session }) {
  const [theme, cycleTheme] = useTheme();
  const [pinOpen, setPinOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
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
      <a className="skip-link" href="#content">
        Skip to content
      </a>
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
            <button className="ghost" onClick={() => setPasswordOpen(true)}>
              <KeyRound className="icon" aria-hidden /> Change password
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
        <a href={guestMenuPath(s.customer.code, s.outlets.find((o) => o.id === outletId)?.code ?? '')} target="_blank" rel="noreferrer">
          <Tags className="icon" aria-hidden /> Guest menu
        </a>
      </nav>
      {/* Keyed by user: after a PIN switch every page reloads with the new person's access. */}
      <main id="content" tabIndex={-1} className="content" key={s.user.id}>
        <Routes>
          {nav.map((n) => (
            <Route key={n.to} path={`${n.to}/*`} element={<n.page />} />
          ))}
          <Route path="*" element={<Navigate to={(nav.find((n) => n.to === '/dashboard') ?? nav.find((n) => n.to === '/menu-items') ?? nav.find((n) => n.to === '/outlets')!).to} replace />} />
        </Routes>
      </main>
      <PinSwitch open={pinOpen} onClose={() => setPinOpen(false)} />
      <ChangePassword open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} nav={nav} />
    </div>
  );
}

import '@fnb/theme/theme.css';
import './app.css';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { api, setSession, useSession } from './api';
import { Toasts } from './ui';
import { Login } from './shell/login';
import { Shell } from './shell/shell';

function App() {
  const s = useSession();
  const resetLink = useLocation().pathname === '/reset-password';
  // Refresh outlets and permissions on load, in case an admin changed them.
  useEffect(() => {
    if (s) api('/auth/me').then((me) => setSession({ ...s, ...me })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.token]);
  return (
    <>
      {s && !resetLink ? <Shell s={s} /> : <Login />}
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

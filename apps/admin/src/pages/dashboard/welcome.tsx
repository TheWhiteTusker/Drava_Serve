import { useState } from 'react';
import { Check, ClipboardCheck, Receipt, ShoppingBasket, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { can, useApi, useSession } from '../../api';

// ---------- Welcome: greeting, setup checklist, quick links ----------

export function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// The steps a new business takes before its first service, ticked off as they happen.
export function Welcome({ outletId }: { outletId: string | null }) {
  const s = useSession();
  const owner = can(s, 'users.manage', null);
  const [hidden, setHidden] = useState(() => localStorage.getItem('fnb.setupHidden') === '1');
  const show = owner && !hidden;
  const outlets = useApi<any[]>(show ? '/outlets' : null);
  const users = useApi<any[]>(show ? '/users' : null);
  const items = useApi<any[]>(show ? '/stock-items' : null);
  const vendors = useApi<any[]>(show ? '/vendors' : null);
  const costing = useApi<any[]>(show && outletId ? `/costing?outletId=${outletId}` : null);
  const counts = useApi<any[]>(show && outletId ? `/inventory/counts?outletId=${outletId}` : null);
  const targets = useApi<any[]>(show && outletId ? `/margin-targets?outletId=${outletId}` : null);
  const steps: [string, boolean, string][] = [
    ['Add your restaurant or bar, with its FSSAI and licence numbers', !!outlets.data?.length, '/outlets'],
    ['Add your staff and give each a job and a PIN', (users.data?.length ?? 0) > 1, '/users'],
    ['List what you buy and how much you like to keep', !!items.data?.some((i) => i.levels.length), '/stock-items'],
    ['Add your dishes and drinks and what goes in each', !!costing.data?.some((c) => Number(c.portionCost) > 0), '/costing'],
    ['Add your suppliers and what they sell you', !!vendors.data?.length, '/vendors'],
    ['Count what is on the shelves today', !!counts.data?.some((c) => c.status === 'approved'), '/counts'],
    ['Set how much profit you want on each dish', !!targets.data?.length, '/margin-targets'],
  ];
  const done = steps.filter((x) => x[1]).length;
  const next = steps.find((x) => !x[1]);
  const loading = [outlets, users, items, vendors].some((x) => !x.data);
  const quick = (
    <div className="card">
      <h2>Quick links</h2>
      <div className="quick">
        <a href="/pos/" target="_blank" rel="noreferrer">
          <Receipt className="icon" aria-hidden /> Open the POS
        </a>
        <Link to="/stock">
          <Trash2 className="icon" aria-hidden /> Record wasted stock
        </Link>
        <Link to="/indents">
          <ShoppingBasket className="icon" aria-hidden /> Tonight's order list
        </Link>
        <Link to="/approvals">
          <ClipboardCheck className="icon" aria-hidden /> Approvals
        </Link>
      </div>
    </div>
  );
  if (!show || loading || done === steps.length) return owner || can(s, 'pos.bill') ? <div style={{ marginBottom: '1.25rem' }}>{quick}</div> : null;
  return (
    <div className="welcome">
      <div className="card">
        <div className="row between">
          <h2>Getting started</h2>
          <button className="ghost icon-only" aria-label="Hide the checklist" onClick={() => (localStorage.setItem('fnb.setupHidden', '1'), setHidden(true))}>
            <X className="icon" />
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {done} of {steps.length} done. Each step takes a few minutes; do them in order.
        </p>
        <div className="progress" aria-hidden>
          <span style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        {next && (
          <Link className="link" to={next[2]} style={{ margin: '0.75rem 0' }}>
            Next: {next[0]}
          </Link>
        )}
        <ul className="checklist">
          {steps.map(([label, ok, to]) => (
            <li key={label} className={ok ? 'done' : ''}>
              <span className="tick">{ok && <Check className="icon" style={{ width: 14, height: 14 }} aria-hidden />}</span>
              <span className="label">{label}</span>
              {!ok && <Link to={to}>Start</Link>}
            </li>
          ))}
        </ul>
      </div>
      {quick}
    </div>
  );
}

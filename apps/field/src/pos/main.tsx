import '@fnb/theme/theme.css';
import '../lib/field.css';
import './pos.css';
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { billTotals, dec, istDate, type BillTotals } from '@fnb/shared';
import { createQueue } from '../lib/queue';
import { createSession, deviceId, type Session } from '../lib/session';
import {
  Banknote, BellRing, CalendarCheck, ClipboardCheck, CreditCard, Keyboard, MoreHorizontal, PauseCircle, Plus, Printer, ReceiptText, Send, Share2,
  ShoppingBag, Smartphone, Split, Wallet,
} from 'lucide-react';
import { DietMark, initials, Login, OfflineBar, registerWorker, rupee, rupeeShort, toast, Toasts } from '../lib/ui';
import { printReceipt } from './printing';

// Billing POS for a counter tablet or desktop. Touch, mouse and keyboard; keeps billing offline.
// Margins never reach this screen: the API sends prices and order only.

const session = createSession('pos');
const queue = createQueue('pos', session);
registerWorker('/pos/sw.js');

interface MenuItem {
  id: string;
  name: string;
  department: 'food' | 'beverage';
  course: string | null;
  type: string | null;
  brand: string | null;
  dietType: string | null;
  serveSizeMl: string | null;
  taxClassId: string;
  taxKind: 'food' | 'liquor';
  price: string;
  activeDiscountId: string | null;
  portions: number | null;
  status: 'available' | 'low' | 'out';
  rank: number;
  code: string | null;
}
interface Catalog {
  outlet: { id: string; name: string; code: string; address: string | null; gstin: string | null; fssaiNumber: string | null };
  dayStart: string;
  menu: MenuItem[];
  taxClasses: { id: string; kind: 'food' | 'liquor'; components: { name: string; ratePct: string }[] }[];
  tables: { id: string; name: string }[];
  syncedAt: string;
}
interface Line {
  id?: string;
  menuItemId: string;
  name: string;
  qty: string;
  price: string;
  dietType: string | null;
  taxClassId?: string;
  status?: string;
  activeDiscountId?: string | null;
}
interface GuestOrder {
  id: string;
  tableId: string;
  table: string;
  createdAt: string;
  lines: { menuItemId: string; qty: number }[];
}
interface LocalBill {
  clientId: string;
  id?: string; // server id once known
  number: string;
  kind: 'dine_in' | 'takeaway';
  tableId: string | null;
  table: string | null;
  openedAt: string | null;
  lines: Line[]; // sent to the kitchen / counter
  cart: Line[]; // not sent yet
  status: 'open' | 'paid' | 'cancelled' | 'refunded';
  totals?: BillTotals;
  total?: string;
  paidAt?: string;
  payments?: { mode: string; amount: string }[];
  manualDiscountPct?: string;
  unsent?: boolean; // changes saved on this device, not yet on the server
}

const store = {
  get<T>(k: string, fallback: T): T {
    try {
      return JSON.parse(localStorage.getItem(`fnb.pos.${k}`) ?? 'null') ?? fallback;
    } catch {
      return fallback;
    }
  },
  set: (k: string, v: unknown) => localStorage.setItem(`fnb.pos.${k}`, JSON.stringify(v)),
};

// Bill numbers come from the device so a bill can be numbered offline: OUTLET-YYMMDD-<tag><seq>.
function nextBillNumber(outletCode: string) {
  const tag = store.get<string>('deviceTag', deviceId.slice(0, 2).toUpperCase());
  const day = istDate(new Date()).slice(2).replaceAll('-', '');
  const key = `seq.${day}`;
  const n = store.get<number>(key, 0) + 1;
  store.set(key, n);
  return `${outletCode}-${day}-${tag}${String(n).padStart(3, '0')}`;
}

function totalsFor(bill: LocalBill, cat: Catalog, withCart = true): BillTotals {
  const lines = [...bill.lines.filter((l) => l.status !== 'voided'), ...(withCart ? bill.cart : [])];
  return billTotals(
    lines.map((l) => {
      const item = cat.menu.find((m) => m.id === l.menuItemId);
      const tc = cat.taxClasses.find((x) => x.id === (l.taxClassId ?? item?.taxClassId)) ?? { kind: 'food' as const, components: [] };
      return { qty: l.qty, unitPrice: l.price, taxClass: tc };
    }),
    { discountPct: bill.manualDiscountPct ?? 0 },
  );
}

// ---------- Receipt ----------

function Mark({ diet }: { diet: string | null }) {
  if (!diet) return null;
  const veg = diet === 'veg';
  const c = veg ? '#1a8a3a' : '#7b3f12';
  const label = veg ? 'Veg' : 'Non-veg';
  return (
    <svg className="mark" width="11" height="11" viewBox="0 0 16 16" role="img" aria-label={label}>
      <rect x="1" y="1" width="14" height="14" fill="none" stroke={c} strokeWidth="2" />
      {veg ? <circle cx="8" cy="8" r="3.8" fill={c} /> : <path d="M8 3.5 12.5 12H3.5Z" fill={c} />}
    </svg>
  );
}

// The receipt shows the price charged for each item and nothing about offers.
function Receipt({ bill, cat, cashier }: { bill: LocalBill; cat: Catalog; cashier: string }) {
  const t = bill.totals ?? totalsFor(bill, cat, false);
  const lines = bill.lines.filter((l) => l.status !== 'voided');
  const taxLines = (d: BillTotals['food']) =>
    d.taxes.map((x) => (
      <div key={x.name + x.ratePct} className="row">
        <span>
          {x.name} {x.ratePct}%
        </span>
        <span>{dec(x.amount).toFixed(2)}</span>
      </div>
    ));
  return (
    <div className="receipt" id="receipt">
      <h1>{cat.outlet.name}</h1>
      {cat.outlet.address && <p className="center">{cat.outlet.address}</p>}
      {cat.outlet.gstin && <p className="center">GSTIN {cat.outlet.gstin}</p>}
      {cat.outlet.fssaiNumber && <p className="center">FSSAI Lic. No. {cat.outlet.fssaiNumber}</p>}
      <hr />
      <div className="row">
        <span>Bill {bill.number}</span>
        <span>{bill.kind === 'takeaway' ? 'Takeaway' : `Table ${bill.table ?? ''}`}</span>
      </div>
      <div className="row">
        <span>{new Date(bill.paidAt ?? Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</span>
        <span>{cashier}</span>
      </div>
      <hr />
      {lines.map((l, i) => (
        <div key={l.id ?? i} className="row">
          <span>
            <Mark diet={l.dietType} />
            {l.name} × {dec(l.qty).toString()}
          </span>
          <span>{dec(l.qty).times(l.price).toFixed(2)}</span>
        </div>
      ))}
      <hr />
      {dec(t.food.subtotal).gt(0) && (
        <>
          <div className="row">
            <span>Food</span>
            <span>{t.food.subtotal}</span>
          </div>
          {dec(t.food.discount).gt(0) && (
            <div className="row">
              <span>Discount</span>
              <span>−{t.food.discount}</span>
            </div>
          )}
          {taxLines(t.food)}
          <div className="row">
            <span>Food total</span>
            <span>{t.food.total}</span>
          </div>
          <hr />
        </>
      )}
      {dec(t.liquor.subtotal).gt(0) && (
        <>
          <div className="row">
            <span>Liquor</span>
            <span>{t.liquor.subtotal}</span>
          </div>
          {dec(t.liquor.discount).gt(0) && (
            <div className="row">
              <span>Discount</span>
              <span>−{t.liquor.discount}</span>
            </div>
          )}
          {taxLines(t.liquor)}
          <div className="row">
            <span>Liquor total</span>
            <span>{t.liquor.total}</span>
          </div>
          <hr />
        </>
      )}
      {!dec(t.roundOff).isZero() && (
        <div className="row">
          <span>Round off</span>
          <span>{t.roundOff}</span>
        </div>
      )}
      <div className="row total">
        <span>TOTAL ₹</span>
        <span>{t.grandTotal}</span>
      </div>
      {(bill.payments ?? []).map((p, i) => (
        <div key={i} className="row">
          <span>Paid by {p.mode.toUpperCase()}</span>
          <span>{dec(p.amount).toFixed(2)}</span>
        </div>
      ))}
      <hr />
      <p className="center">
        <Mark diet="veg" /> Veg &nbsp; <Mark diet="non_veg" /> Non-veg
      </p>
      <p className="center">Thank you!</p>
    </div>
  );
}

function receiptText(bill: LocalBill, cat: Catalog) {
  const t = bill.totals ?? totalsFor(bill, cat, false);
  const lines = bill.lines.filter((l) => l.status !== 'voided').map((l) => `${l.dietType === 'veg' ? '(Veg) ' : l.dietType ? '(Non-veg) ' : ''}${l.name} x ${dec(l.qty)}  ₹${dec(l.qty).times(l.price).toFixed(2)}`);
  return [
    cat.outlet.name, cat.outlet.fssaiNumber ? `FSSAI Lic. No. ${cat.outlet.fssaiNumber}` : '', `Bill ${bill.number}`, '', ...lines, '',
    dec(t.food.subtotal).gt(0) ? `Food ₹${t.food.subtotal} + taxes = ₹${t.food.total}` : '',
    dec(t.liquor.subtotal).gt(0) ? `Liquor ₹${t.liquor.subtotal} + taxes = ₹${t.liquor.total}` : '',
    `TOTAL ₹${t.grandTotal}`,
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------- Small dialogs ----------

function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
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

function PinSwitch({ outletId, onClose }: { outletId: string; onClose: () => void }) {
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

// ---------- The till ----------

function Till({ outletId }: { outletId: string }) {
  const s = session.use()!;
  const q = queue.use();
  const [cat, setCat] = useState<Catalog | null>(() => store.get(`catalog.${outletId}`, null));
  const [bills, setBills] = useState<LocalBill[]>(() => store.get(`bills.${outletId}`, []));
  const [current, setCurrent] = useState<string | null>(() => store.get(`current.${outletId}`, null));
  const [dept, setDept] = useState<'food' | 'beverage'>('food');
  const [group, setGroup] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<null | 'new' | 'open' | 'pay' | 'receipt' | 'more' | 'pin' | 'close' | 'approvals' | 'help' | 'guest'>(null);
  const [guest, setGuest] = useState<GuestOrder[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const bill = bills.find((b) => b.clientId === current) ?? null;

  const saveBills = useCallback(
    (fn: (b: LocalBill[]) => LocalBill[]) =>
      setBills((prev) => {
        const next = fn(prev).filter((b) => b.status === 'open' || (b.paidAt && Date.now() - new Date(b.paidAt).getTime() < 86_400_000));
        store.set(`bills.${outletId}`, next);
        return next;
      }),
    [outletId],
  );
  const update = (clientId: string, patch: Partial<LocalBill> | ((b: LocalBill) => Partial<LocalBill>)) =>
    saveBills((all) => all.map((b) => (b.clientId === clientId ? { ...b, ...(typeof patch === 'function' ? patch(b) : patch) } : b)));
  const select = (id: string | null) => {
    setCurrent(id);
    store.set(`current.${outletId}`, id);
  };
  const flash = (m: string) => toast(m, 'danger');

  // Catalog: from the server when online, from the device otherwise.
  const loadCatalog = useCallback(async () => {
    try {
      const c = await session.api<Catalog>(`/pos/catalog?outletId=${outletId}`);
      setCat(c);
      store.set(`catalog.${outletId}`, c);
    } catch {
      /* offline: keep the last copy */
    }
  }, [outletId]);
  // Bills opened on other counters.
  const loadServerBills = useCallback(async () => {
    try {
      const open = await session.api<any[]>(`/pos/bills?outletId=${outletId}&status=open`);
      saveBills((all) => {
        const mine = all.map((b) => {
          const srv = open.find((o) => o.clientId === b.clientId);
          return srv && b.status === 'open' ? { ...b, ...fromServer(srv), cart: b.cart } : b;
        });
        const others = open.filter((o) => !all.some((b) => b.clientId === o.clientId)).map((o) => ({ ...fromServer(o), cart: [] }));
        return [...mine, ...others];
      });
    } catch {
      /* offline */
    }
  }, [outletId, saveBills]);
  // One bill from a live event. A bill with changes still waiting on this device keeps its own copy.
  const mergeServerBill = useCallback(
    (srv: any) =>
      saveBills((all) => {
        const b = all.find((x) => x.clientId === srv.clientId);
        if (b) return b.unsent ? all : all.map((x) => (x === b ? { ...x, ...fromServer(srv), cart: x.cart } : x));
        return srv.status === 'open' ? [...all, { ...fromServer(srv), cart: [] }] : all;
      }),
    [saveBills],
  );
  const loadGuestOrders = useCallback(
    () =>
      session
        .api<GuestOrder[]>(`/pos/guest-orders?outletId=${outletId}`)
        .then(setGuest)
        .catch(() => {}),
    [outletId],
  );
  useEffect(() => {
    loadCatalog();
    loadServerBills();
    loadGuestOrders();
    const timer = setInterval(loadCatalog, 120_000);
    const sock = io({ path: '/api/socket', auth: { token: s.token }, transports: ['websocket'] });
    sock.on('availability', (d: { items: { menuItemId: string; portions: number | null; status: MenuItem['status'] }[] }) =>
      setCat((c) => {
        if (!c) return c;
        const next = { ...c, menu: c.menu.map((m) => ({ ...m, ...(d.items.find((i) => i.menuItemId === m.id) ? { portions: d.items.find((i) => i.menuItemId === m.id)!.portions, status: d.items.find((i) => i.menuItemId === m.id)!.status } : {}) })) };
        store.set(`catalog.${outletId}`, next);
        return next;
      }),
    );
    sock.on('menu', loadCatalog);
    // Events carry the bill or the guest's order itself, so no counter has to ask the server.
    sock.on('bill', (d: { bill?: any }) => (d.bill ? mergeServerBill(d.bill) : loadServerBills()));
    sock.on('guestOrder', (d: { order?: GuestOrder; id?: string }) => {
      if (d.order) {
        setGuest((list) => (list.some((g) => g.id === d.order!.id) ? list : [...list, d.order!]));
        toast(`New order from table ${d.order.table}`);
      } else setGuest((list) => list.filter((g) => g.id !== d.id));
    });
    // Anything missed while the connection was down.
    sock.io.on('reconnect', () => {
      loadServerBills();
      loadGuestOrders();
    });
    return () => {
      clearInterval(timer);
      sock.close();
    };
  }, [s.token, outletId, loadCatalog, loadServerBills, mergeServerBill, loadGuestOrders]);

  // Once everything saved on the device has reached the server, nothing is unsent any more.
  useEffect(() => {
    if (q.pending === 0 && bills.some((b) => b.unsent)) {
      saveBills((all) => all.map((b) => ({ ...b, unsent: false })));
      loadServerBills();
    }
  }, [q.pending, bills, saveBills, loadServerBills]);

  // ---------- Items ----------
  const menu = useMemo(() => (cat?.menu ?? []).filter((m) => m.department === dept), [cat, dept]);
  const groups = useMemo(() => [...new Set(menu.map((m) => (dept === 'food' ? m.course : m.type) ?? 'Other'))], [menu, dept]);
  const visible = menu.filter(
    (m) => (!group || (dept === 'food' ? m.course : m.type) === group) && (!search || m.name.toLowerCase().includes(search.toLowerCase()) || m.code?.toLowerCase() === search.toLowerCase()),
  );

  function newBill(kind: LocalBill['kind'], table?: { id: string; name: string }) {
    const b: LocalBill = { clientId: crypto.randomUUID(), number: nextBillNumber(cat!.outlet.code), kind, tableId: table?.id ?? null, table: table?.name ?? null, openedAt: null, lines: [], cart: [], status: 'open' };
    saveBills((all) => [...all, b]);
    select(b.clientId);
    setDialog(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  function add(item: MenuItem) {
    if (item.status === 'out') return;
    if (!bill) {
      setDialog('new');
      return;
    }
    update(bill.clientId, (b) => {
      const existing = b.cart.find((l) => l.menuItemId === item.id);
      const cart = existing
        ? b.cart.map((l) => (l === existing ? { ...l, qty: dec(l.qty).plus(1).toString() } : l))
        : [...b.cart, { menuItemId: item.id, name: item.name, qty: '1', price: item.price, dietType: item.dietType, taxClassId: item.taxClassId, activeDiscountId: item.activeDiscountId }];
      return { cart };
    });
  }

  // Talk to the server directly only when online with nothing older still waiting, so the
  // server always receives a bill's changes in the order they were made.
  const direct = () => queue.state().online && queue.state().pending === 0;

  // Send the cart as one order. Online: the server prices it and checks stock under a lock.
  // Offline (or with older changes still waiting): saved on the device and sent in order later.
  async function sendOrder() {
    if (!bill || !bill.cart.length) return;
    const placedAt = new Date().toISOString();
    const order = { clientId: crypto.randomUUID(), placedAt, lines: bill.cart.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty, priceCharged: l.price, activeDiscountId: l.activeDiscountId })) };
    const body = (offline: boolean) => ({ outletId, bill: { clientId: bill.clientId, kind: bill.kind, tableId: bill.tableId, number: bill.number }, order, offline });
    const local = (b: LocalBill) => ({ lines: [...b.lines, ...b.cart], cart: [], openedAt: b.openedAt ?? placedAt });
    if (direct()) {
      try {
        const srv = await session.api('/pos/orders', { body: body(false) });
        update(bill.clientId, { ...fromServer(srv), cart: [] });
        return;
      } catch (e: any) {
        if (e.status === 409 && e.data?.soldOut) {
          const out = e.data.soldOut.map((x: any) => x.menuItemId);
          update(bill.clientId, (b) => ({ cart: b.cart.filter((l) => !out.includes(l.menuItemId)) }));
          setCat((c) => c && { ...c, menu: c.menu.map((m) => (out.includes(m.id) ? { ...m, status: 'out', portions: 0 } : m)) });
          flash(e.message);
          return;
        }
        if (e.status && e.status < 500) {
          flash(e.message);
          return;
        }
      }
    }
    await queue.add({ kind: 'json', method: 'POST', path: '/pos/orders', body: body(true), label: `Order on bill ${bill.number}` });
    update(bill.clientId, (b) => ({ ...local(b), unsent: true }));
  }

  async function pay(payments: { mode: string; amount: string; reference?: string }[]) {
    if (!bill) return;
    if (bill.cart.length) await sendOrder();
    const paidAt = new Date().toISOString();
    const body = (offline: boolean) => ({ billClientId: bill.clientId, paidAt, payments: payments.map((p) => ({ ...p, clientId: crypto.randomUUID() })), offline });
    let done = false;
    if (direct()) {
      try {
        const srv = await session.api('/pos/payments', { body: body(false) });
        update(bill.clientId, { ...fromServer(srv), cart: [] });
        done = true;
      } catch (e: any) {
        if (e.status && e.status < 500) {
          flash(e.message);
          return;
        }
      }
    }
    if (!done) {
      await queue.add({ kind: 'json', method: 'POST', path: '/pos/payments', body: body(true), label: `Payment on bill ${bill.number}` });
      update(bill.clientId, (b) => ({ status: 'paid', paidAt, payments, totals: totalsFor(b, cat!, false), unsent: true }));
    }
    toast(`Bill ${bill.number} paid`);
    setDialog('receipt');
  }

  // A guest's order joins the table's running bill, or opens one the server numbers. Online only:
  // the server prices it and checks stock under a lock, as for any order.
  async function acceptGuest(g: GuestOrder) {
    const open = openBills.find((b) => b.tableId === g.tableId);
    try {
      const srv = await session.api(`/pos/guest-orders/${g.id}/accept`, { body: { bill: { clientId: open?.clientId ?? crypto.randomUUID(), number: open?.number ?? null } } });
      saveBills((all) => (all.some((b) => b.clientId === srv.clientId) ? all.map((b) => (b.clientId === srv.clientId ? { ...b, ...fromServer(srv), cart: b.cart } : b)) : [...all, { ...fromServer(srv), cart: [] }]));
      setGuest((list) => list.filter((x) => x.id !== g.id));
      toast(`Table ${g.table}: added to the bill`);
    } catch (e: any) {
      flash(e.message);
      if (e.status === 409 && !e.data?.soldOut) setGuest((list) => list.filter((x) => x.id !== g.id)); // decided at another counter
    }
  }

  async function rejectGuest(g: GuestOrder, reason: string) {
    try {
      await session.api(`/pos/guest-orders/${g.id}/reject`, { body: { reason } });
    } catch (e) {
      flash((e as Error).message);
    }
    setGuest((list) => list.filter((x) => x.id !== g.id));
  }

  async function request(kind: 'cancel' | 'discount' | 'void', extra: Record<string, string>) {
    if (!bill?.id) {
      flash('This bill has not reached the server yet. Try again when online.');
      return;
    }
    try {
      const r = await session.api(`/pos/bills/${bill.id}/${kind}`, { body: extra });
      update(bill.clientId, { ...fromServer(r.bill), cart: bill.cart });
      flash(r.status === 'pending' ? 'Sent to a manager for approval.' : 'Done.');
      setDialog(null);
    } catch (e) {
      flash((e as Error).message);
    }
  }

  // ---------- Keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      const keys: Record<string, (() => void) | false> = {
        F2: () => setDialog('new'),
        F4: () => setDialog('open'),
        F8: !!bill && (() => setDialog('pay')),
        F9: () => void sendOrder(),
        F1: () => setDialog('help'),
        '/': !typing && (() => searchRef.current?.focus()),
      };
      const action = e.altKey && e.key.toLowerCase() === 'n' ? keys.F2 : keys[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!cat) return <p className="wrap">Loading the menu… (needs a connection the first time)</p>;
  const totals = bill ? totalsFor(bill, cat) : null;
  const openBills = bills.filter((b) => b.status === 'open');
  const unsentBills = bills.filter((b) => b.unsent).length;

  return (
    <div className="till">
      <header className="bar">
        <span className="logo" role="img" aria-label="Logo" />
        <span className="outlet-name">{cat.outlet.name}</span>
        <span className={`status ${q.online ? '' : 'off'}`}>{q.online ? 'Online' : 'Offline'}</span>
        {unsentBills > 0 && (
          <span className="status wait">
            {unsentBills} unsent bill{unsentBills === 1 ? '' : 's'}
          </span>
        )}
        <span className="spacer" />
        {guest.length > 0 && (
          <button className="gold" onClick={() => setDialog('guest')}>
            <BellRing className="icon" aria-hidden /> Table orders <span className="count">{guest.length}</span>
          </button>
        )}
        <button className="secondary" onClick={() => setDialog('open')}>
          <ReceiptText className="icon" aria-hidden /> Open bills <span className="count">{openBills.length}</span>
        </button>
        {session.can('approvals.decide', outletId) && (
          <button className="secondary" onClick={() => setDialog('approvals')}>
            <ClipboardCheck className="icon" aria-hidden /> Approvals
          </button>
        )}
        {session.can('pos.dayClose', outletId) && (
          <button className="secondary" onClick={() => setDialog('close')}>
            <CalendarCheck className="icon" aria-hidden /> Day close
          </button>
        )}
        <button className="ghost icon-only" onClick={() => setDialog('help')} aria-label="Keyboard shortcuts (F1)" title="Keyboard shortcuts (F1)">
          <Keyboard className="icon" />
        </button>
        <button className="ghost" onClick={() => setDialog('pin')} title="Switch user">
          <span className="avatar">{initials(s.user.name)}</span>
          <span className="who">{s.user.name.replace(/\s*\(.*\)/, '')}</span>
        </button>
      </header>
      <OfflineBar q={q} />
      <main className="till-body">
        <section className="items" aria-label="Menu">
          <div className="row tight-row">
            <div className="tabs" role="tablist">
              {(['food', 'beverage'] as const).map((d) => (
                <button key={d} role="tab" aria-selected={dept === d} className={dept === d ? '' : 'secondary'} onClick={() => (setDept(d), setGroup(null))}>
                  {d === 'food' ? 'Food' : 'Beverage'}
                </button>
              ))}
            </div>
            <input ref={searchRef} aria-label="Search items" placeholder="Search ( / )" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const first = visible.find((m) => m.status !== 'out');
                if (first) {
                  add(first);
                  setSearch('');
                }
              }
              if (e.key === 'Escape') setSearch('');
            }} />
          </div>
          <div className="chips" role="tablist" aria-label={dept === 'food' ? 'Courses' : 'Types'}>
            <button className="secondary" aria-pressed={!group} onClick={() => setGroup(null)}>
              All
            </button>
            {groups.map((g) => (
              <button key={g} className="secondary" aria-pressed={group === g} onClick={() => setGroup(g)}>
                {g}
              </button>
            ))}
          </div>
          {(group ? [group] : groups).map((g) => {
            const list = visible.filter((m) => ((dept === 'food' ? m.course : m.type) ?? 'Other') === g);
            if (!list.length) return null;
            return (
              <div key={g}>
                <h3 className="group-title">{g}</h3>
                <div className="grid-items">
                  {list.map((m) => (
                    <button key={m.id} className={`item ${m.status}`} disabled={m.status === 'out'} onClick={() => add(m)} aria-label={`${m.name}, ₹${m.price}${m.status === 'out' ? ', sold out' : m.status === 'low' ? `, ${m.portions} left` : ''}`}>
                      <span className="item-name">
                        <DietMark diet={m.dietType} size={14} />
                        <span>{m.name}</span>
                      </span>
                      <span className="item-meta">
                        <span className="item-price">{rupeeShort(m.price)}</span>
                        {m.status === 'out' ? (
                          <span className="badge danger">Sold out</span>
                        ) : m.status === 'low' ? (
                          <span className="badge warning">{m.portions} left</span>
                        ) : m.serveSizeMl ? (
                          <span className="muted">{Number(m.serveSizeMl)} ml</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        <aside className="ticket" aria-label="Current bill">
          {!bill ? (
            <div className="ticket-empty">
              <span className="ticket-empty-icon" aria-hidden>
                <ReceiptText className="icon" />
              </span>
              <h2>Ready for the next guest</h2>
              <p className="muted">Start a bill for a table or a takeaway, then tap dishes to add them.</p>
              <button className="huge gold" onClick={() => setDialog('new')} style={{ width: '100%' }}>
                <Plus className="icon" aria-hidden /> New bill <kbd>F2</kbd>
              </button>
            </div>
          ) : (
            <>
              <div className="row">
                <div style={{ flex: 3 }}>
                  <h2 style={{ margin: 0 }}>{bill.kind === 'takeaway' ? 'Takeaway' : `Table ${bill.table}`}</h2>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>
                    {bill.number} {bill.openedAt && `· since ${new Date(bill.openedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                </div>
                <button className="secondary" onClick={() => select(null)} style={{ flex: '0 0 auto' }} title="Keep this bill open and start another">
                  <PauseCircle className="icon" aria-hidden /> Park
                </button>
              </div>
              <ul className="lines">
                {bill.lines.map((l, i) => (
                  <li key={l.id ?? `s${i}`} className={l.status === 'voided' ? 'voided' : ''}>
                    <span>
                      <DietMark diet={l.dietType} size={12} /> {l.name}
                    </span>
                    <span>× {dec(l.qty).toString()}</span>
                    <span>{rupee(dec(l.qty).times(l.price).toString())}</span>
                  </li>
                ))}
                {bill.cart.map((l) => (
                  <li key={l.menuItemId} className="cart">
                    <span>
                      <DietMark diet={l.dietType} size={12} /> {l.name}
                    </span>
                    <span className="qty">
                      <button className="secondary" aria-label={`One less ${l.name}`} onClick={() => update(bill.clientId, (b) => ({ cart: b.cart.flatMap((c) => (c.menuItemId !== l.menuItemId ? [c] : dec(c.qty).gt(1) ? [{ ...c, qty: dec(c.qty).minus(1).toString() }] : [])) }))}>
                        −
                      </button>
                      {dec(l.qty).toString()}
                      <button className="secondary" aria-label={`One more ${l.name}`} onClick={() => update(bill.clientId, (b) => ({ cart: b.cart.map((c) => (c.menuItemId === l.menuItemId ? { ...c, qty: dec(c.qty).plus(1).toString() } : c)) }))}>
                        +
                      </button>
                    </span>
                    <span>{rupee(dec(l.qty).times(l.price).toString())}</span>
                  </li>
                ))}
              </ul>
              {totals && (
                <div className="totals">
                  {dec(totals.food.subtotal).gt(0) && (
                    <div className="row">
                      <span>Food (incl. {totals.food.taxes.map((x) => x.name).join(' + ') || 'tax'})</span>
                      <span>{rupee(totals.food.total)}</span>
                    </div>
                  )}
                  {dec(totals.liquor.subtotal).gt(0) && (
                    <div className="row">
                      <span>Liquor (incl. {totals.liquor.taxes.map((x) => x.name).join(' + ') || 'tax'})</span>
                      <span>{rupee(totals.liquor.total)}</span>
                    </div>
                  )}
                  {dec(totals.discount).gt(0) && (
                    <div className="row">
                      <span>Discount (approved)</span>
                      <span>−{rupee(totals.discount)}</span>
                    </div>
                  )}
                  <div className="row big">
                    <span>Total</span>
                    <span>{rupee(totals.grandTotal)}</span>
                  </div>
                </div>
              )}
              <div className="row">
                <button className="secondary huge" disabled={!bill.cart.length} onClick={sendOrder}>
                  <Send className="icon" aria-hidden /> Send <kbd>F9</kbd>
                </button>
                <button className="huge gold" disabled={!bill.lines.length && !bill.cart.length} onClick={() => setDialog('pay')}>
                  <Wallet className="icon" aria-hidden /> Pay <kbd>F8</kbd>
                </button>
              </div>
              <button className="ghost" onClick={() => setDialog('more')}>
                <MoreHorizontal className="icon" aria-hidden /> Discount, remove an item or cancel
              </button>
            </>
          )}
        </aside>
      </main>

      {dialog === 'new' && (
        <Dialog title="New bill" onClose={() => setDialog(null)} wide>
          <button className="huge gold" autoFocus onClick={() => newBill('takeaway')} style={{ width: '100%', marginBottom: '1rem' }}>
            <ShoppingBag className="icon" aria-hidden /> Takeaway
          </button>
          <p className="muted" style={{ margin: '0 0 0.6rem' }}>
            Or pick a table. A table with a bill running shows its total and how long the guests have been seated.
          </p>
          <div className="tables">
            {cat.tables.map((tb) => {
              const open = openBills.find((b) => b.tableId === tb.id);
              return (
                <button
                  key={tb.id}
                  className={`table ${open ? 'busy' : ''}`}
                  onClick={() => {
                    if (open) select(open.clientId);
                    else newBill('dine_in', tb);
                    setDialog(null);
                  }}
                >
                  <span className="table-name">{tb.name}</span>
                  <span className="table-meta">
                    {open
                      ? `${rupeeShort(totalsFor(open, cat).grandTotal)} · ${open.openedAt ? since(open.openedAt) : 'new'}`
                      : 'Free'}
                  </span>
                </button>
              );
            })}
          </div>
        </Dialog>
      )}
      {dialog === 'open' && (
        <Dialog title="Open bills" onClose={() => setDialog(null)} wide>
          {openBills.length === 0 && <p className="muted">No open bills.</p>}
          <div className="tables">
            {openBills.map((b) => (
              <button
                key={b.clientId}
                className={`table busy ${b.clientId === current ? 'current' : ''}`}
                onClick={() => {
                  select(b.clientId);
                  setDialog(null);
                }}
              >
                <span className="table-name">{b.kind === 'takeaway' ? 'Takeaway' : b.table}</span>
                <span className="table-meta">
                  {rupeeShort(totalsFor(b, cat).grandTotal)} · #{b.number.split('-').pop()}
                </span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {dialog === 'pay' && bill && totals && <PayDialog total={totals.grandTotal} onPay={pay} onClose={() => setDialog(null)} />}
      {dialog === 'receipt' && bill && (
        <Dialog title="Receipt" onClose={() => (setDialog(null), select(null))}>
          <Receipt bill={bill} cat={cat} cashier={s.user.name} />
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <button className="secondary" onClick={() => printReceipt(document.getElementById('receipt')!)}>
              <Printer className="icon" aria-hidden /> Print
            </button>
            {'share' in navigator && (
              <button className="secondary" onClick={() => navigator.share({ title: `Bill ${bill.number}`, text: receiptText(bill, cat) }).catch(() => {})}>
                <Share2 className="icon" aria-hidden /> Send
              </button>
            )}
            <button
              className="gold"
              onClick={() => {
                select(null);
                setDialog('new');
              }}
            >
              <Plus className="icon" aria-hidden /> New bill
            </button>
          </div>
        </Dialog>
      )}
      {dialog === 'more' && bill && <MoreDialog bill={bill} onRequest={request} onClose={() => setDialog(null)} />}
      {dialog === 'guest' && <GuestOrders orders={guest} cat={cat} online={q.online} onAccept={acceptGuest} onReject={rejectGuest} onClose={() => setDialog(null)} />}
      {dialog === 'pin' && <PinSwitch outletId={outletId} onClose={() => setDialog(null)} />}
      {dialog === 'close' && <DayClose outletId={outletId} onClose={() => setDialog(null)} />}
      {dialog === 'approvals' && <Approvals outletId={outletId} onClose={() => (setDialog(null), loadServerBills())} />}
      {dialog === 'help' && (
        <Dialog title="Keyboard shortcuts" onClose={() => setDialog(null)}>
          <ul>
            <li>
              <kbd>F2</kbd> or <kbd>Alt</kbd>+<kbd>N</kbd> new bill
            </li>
            <li>
              <kbd>/</kbd> search; <kbd>Enter</kbd> adds the first match
            </li>
            <li>
              <kbd>F9</kbd> send the order
            </li>
            <li>
              <kbd>F8</kbd> pay
            </li>
            <li>
              <kbd>F4</kbd> open bills
            </li>
            <li>
              <kbd>Esc</kbd> close a window
            </li>
          </ul>
        </Dialog>
      )}
    </div>
  );
}

// How long a table has been seated: "25 min", "1 h 40 min", "2 days".
function since(at: string) {
  const min = Math.max(1, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
  return `${Math.floor(min / 1440)} day${min >= 2880 ? 's' : ''}`;
}

function fromServer(srv: any): LocalBill {
  return {
    clientId: srv.clientId, id: srv.id, number: srv.number, kind: srv.kind, tableId: srv.tableId, table: srv.table, openedAt: srv.openedAt,
    lines: srv.lines.map((l: any) => ({ id: l.id, menuItemId: l.menuItemId, name: l.name, qty: l.qty, price: l.price, dietType: l.dietType, status: l.status })),
    cart: [], status: srv.status, totals: srv.taxes ?? undefined, total: srv.total, paidAt: srv.paidAt ?? undefined,
    payments: srv.payments?.map((p: any) => ({ mode: p.mode, amount: p.amount })), manualDiscountPct: srv.manualDiscountPct,
  };
}

function PayDialog({ total, onPay, onClose }: { total: string; onPay: (p: { mode: string; amount: string; reference?: string }[]) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'cash' | 'upi' | 'card' | 'split'>('cash');
  const [tendered, setTendered] = useState('');
  const [split, setSplit] = useState({ cash: '', upi: '', card: '' });
  const splitSum = dec(split.cash || 0).plus(split.upi || 0).plus(split.card || 0);
  const change = tendered ? dec(tendered).minus(total) : null;
  const ok = mode === 'split' ? splitSum.eq(total) : mode !== 'cash' || !tendered || dec(tendered).gte(total);
  function confirm() {
    if (mode === 'split') onPay((['cash', 'upi', 'card'] as const).filter((k) => split[k] && dec(split[k]).gt(0)).map((k) => ({ mode: k, amount: dec(split[k]).toFixed(2) })));
    else onPay([{ mode, amount: dec(total).toFixed(2) }]);
  }
  return (
    <Dialog title={`Pay ${rupee(total)}`} onClose={onClose}>
      <div className="pay-modes">
        {(
          [
            ['cash', 'Cash', Banknote],
            ['upi', 'UPI', Smartphone],
            ['card', 'Card', CreditCard],
            ['split', 'Split', Split],
          ] as const
        ).map(([m, label, Icon]) => (
          <button key={m} className={`pay-mode ${mode === m ? 'on' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
            <Icon className="icon" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      {mode === 'cash' && (
        <div className="stack" style={{ marginTop: '1rem' }}>
          <label className="field">
            Cash received (optional)
            <input inputMode="decimal" autoFocus value={tendered} onChange={(e) => setTendered(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && confirm()} />
          </label>
          <div className="quick-cash">
            {[...new Set([Math.ceil(Number(total)), Math.ceil(Number(total) / 100) * 100, Math.ceil(Number(total) / 500) * 500, Math.ceil(Number(total) / 2000) * 2000])].map((v) => (
              <button key={v} className="secondary" onClick={() => setTendered(String(v))}>
                {v === Math.ceil(Number(total)) ? 'Exact' : rupeeShort(v)}
              </button>
            ))}
          </div>
          {change && change.gte(0) && (
            <div className="change">
              <span>Give back</span>
              <strong>{rupee(change.toString())}</strong>
            </div>
          )}
        </div>
      )}
      {mode === 'split' && (
        <div className="stack" style={{ marginTop: '0.75rem' }}>
          {(['cash', 'upi', 'card'] as const).map((k) => (
            <label key={k} className="field">
              {k === 'upi' ? 'UPI' : k[0].toUpperCase() + k.slice(1)}
              <input inputMode="decimal" value={split[k]} onChange={(e) => setSplit({ ...split, [k]: e.target.value })} />
            </label>
          ))}
          <p className={splitSum.eq(total) ? '' : 'note danger'}>
            {rupee(splitSum.toString())} of {rupee(total)}
          </p>
        </div>
      )}
      <button className="huge gold" disabled={!ok} onClick={confirm} style={{ width: '100%', marginTop: '1rem' }}>
        Confirm {mode === 'split' ? 'split payment' : `${mode === 'upi' ? 'UPI' : mode} payment`}
      </button>
    </Dialog>
  );
}

function MoreDialog({ bill, onRequest, onClose }: { bill: LocalBill; onRequest: (k: 'cancel' | 'discount' | 'void', extra: Record<string, string>) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [pct, setPct] = useState('');
  const [line, setLine] = useState('');
  return (
    <Dialog title="Needs a manager's approval" onClose={onClose}>
      <div className="stack">
        <label className="field">
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="row">
          <label className="field" style={{ flex: 2 }}>
            Discount %
            <input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
          </label>
          <button disabled={!pct || reason.length < 3} onClick={() => onRequest('discount', { discountPct: pct, reason })}>
            Ask for discount
          </button>
        </div>
        <div className="row">
          <select aria-label="Item to remove" value={line} onChange={(e) => setLine(e.target.value)} style={{ flex: 2 }}>
            <option value="">Item to remove…</option>
            {bill.lines
              .filter((l) => l.id && l.status !== 'voided')
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} × {dec(l.qty).toString()}
                </option>
              ))}
          </select>
          <button disabled={!line || reason.length < 3} onClick={() => onRequest('void', { lineId: line, reason })}>
            Ask to remove
          </button>
        </div>
        <button className="bad" disabled={reason.length < 3} onClick={() => onRequest('cancel', { reason })}>
          Ask to cancel the whole bill
        </button>
      </div>
    </Dialog>
  );
}

function DayClose({ outletId, onClose }: { outletId: string; onClose: () => void }) {
  const [date, setDate] = useState(() => {
    const d = new Date(Date.now() - 5 * 3600_000);
    return istDate(d);
  });
  const [data, setData] = useState<any>(null);
  const [cash, setCash] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    session.api(`/pos/day-close?outletId=${outletId}&date=${date}`).then(setData).catch((e) => setError(e.message));
  }, [outletId, date]);
  const t = data?.totals;
  async function close() {
    try {
      const r = await session.api('/pos/day-close', { body: { outletId, businessDate: date, cashCounted: cash || null } });
      setData({ closed: r, totals: r.totals });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog title="Day close" onClose={onClose}>
      <label className="field">
        Business day
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {t && (
        <table className="sums">
          <tbody>
            <tr><td>Bills</td><td>{t.bills}</td></tr>
            <tr><td>Food sales</td><td>{rupee(t.foodSales)}</td></tr>
            <tr><td>Food tax</td><td>{rupee(t.foodTax)}</td></tr>
            <tr><td>Liquor sales</td><td>{rupee(t.liquorSales)}</td></tr>
            <tr><td>Liquor tax</td><td>{rupee(t.liquorTax)}</td></tr>
            <tr><td>Discounts</td><td>{rupee(t.discounts)}</td></tr>
            <tr><td><strong>Total</strong></td><td><strong>{rupee(t.total)}</strong></td></tr>
            {Object.entries(t.byMode).map(([k, v]) => (
              <tr key={k}><td>{k.toUpperCase()}</td><td>{rupee(v as string)}</td></tr>
            ))}
            <tr><td>Cancelled / refunded</td><td>{t.cancelled} / {t.refunded}</td></tr>
            {t.openBills > 0 && <tr><td colSpan={2} className="note danger">{t.openBills} bill(s) still open</td></tr>}
            {t.cashDifference && <tr><td>Cash difference</td><td>{rupee(t.cashDifference)}</td></tr>}
          </tbody>
        </table>
      )}
      {data?.closed ? (
        <p className="note">Closed. The liquor register for the day is closed too.</p>
      ) : (
        <div className="stack">
          <label className="field">
            Cash counted in the drawer
            <input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
          </label>
          <button className="huge" onClick={close} disabled={t?.openBills > 0}>
            Close the day
          </button>
        </div>
      )}
      {error && <p className="note danger">{error}</p>}
    </Dialog>
  );
}

// Orders guests sent from the QR code at their table. Nothing is on a bill until accepted here.
function GuestOrders(props: {
  orders: GuestOrder[];
  cat: Catalog;
  online: boolean;
  onAccept: (g: GuestOrder) => Promise<void>;
  onReject: (g: GuestOrder, reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    await fn();
    setBusy(null);
  };
  return (
    <Dialog title="Orders from tables" onClose={props.onClose} wide>
      {props.orders.length === 0 && <p className="muted">Nothing waiting.</p>}
      {!props.online && <p className="note danger">Offline: table orders can be accepted once the connection is back.</p>}
      {props.orders.map((g) => {
        const lines = g.lines.map((l) => ({ ...l, item: props.cat.menu.find((m) => m.id === l.menuItemId) }));
        const sum = lines.reduce((a, l) => a.plus(dec(l.item?.price ?? 0).times(l.qty)), dec(0));
        return (
          <div key={g.id} className="card">
            <div className="row">
              <strong style={{ flex: 3 }}>Table {g.table}</strong>
              <span className="muted">{since(g.createdAt)} ago</span>
            </div>
            <ul className="lines">
              {lines.map((l) => (
                <li key={l.menuItemId} className={l.item?.status === 'out' ? 'voided' : ''}>
                  <span>
                    <DietMark diet={l.item?.dietType ?? null} size={12} /> {l.item?.name ?? 'Item no longer on the menu'}
                    {l.item?.status === 'out' && <span className="badge danger"> Sold out</span>}
                  </span>
                  <span>× {l.qty}</span>
                  <span>{l.item ? rupee(dec(l.item.price).times(l.qty).toString()) : ''}</span>
                </li>
              ))}
            </ul>
            <p className="muted">{rupee(sum.toString())} before tax</p>
            <input
              aria-label="Reason for the guest"
              placeholder="Reason, if turning it down (the guest sees this)"
              value={reasons[g.id] ?? ''}
              onChange={(e) => setReasons({ ...reasons, [g.id]: e.target.value })}
            />
            <div className="row" style={{ marginTop: '0.5rem' }}>
              <button className="secondary" disabled={busy === g.id} onClick={() => run(g.id, () => props.onReject(g, reasons[g.id] ?? ''))}>
                Turn down
              </button>
              <button className="gold" disabled={busy === g.id || !props.online} onClick={() => run(g.id, () => props.onAccept(g))}>
                Accept onto the bill
              </button>
            </div>
          </div>
        );
      })}
    </Dialog>
  );
}

function Approvals({ outletId, onClose }: { outletId: string; onClose: () => void }) {
  const [list, setList] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => session.api<any[]>(`/approvals?status=pending&outletId=${outletId}`).then(setList).catch((e) => setError(e.message)), [outletId]);
  useEffect(() => {
    load();
  }, [load]);
  const decide = (id: string, approve: boolean) =>
    session
      .api(`/approvals/${id}/decide`, { body: { approve } })
      .then(load)
      .catch((e) => setError(e.message));
  return (
    <Dialog title="Waiting for approval" onClose={onClose} wide>
      {list.length === 0 && <p className="muted">Nothing waiting.</p>}
      {list.map((r) => (
        <div key={r.id} className="card">
          <strong>{r.label}</strong> · {r.proposedByName}
          <p>{r.proposed?.summary}</p>
          {r.reason && <p className="muted">“{r.reason}”</p>}
          <div className="row">
            <button className="secondary" onClick={() => decide(r.id, false)}>
              Reject
            </button>
            <button onClick={() => decide(r.id, true)}>Approve</button>
          </div>
        </div>
      ))}
      {error && <p className="note danger">{error}</p>}
    </Dialog>
  );
}

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

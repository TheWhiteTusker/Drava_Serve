import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { dec } from '@fnb/shared';
import {
  BellRing, CalendarCheck, ClipboardCheck, Keyboard, MoreHorizontal, PauseCircle, Plus, Printer, ReceiptText, Send, Share2, ShoppingBag, Wallet,
} from 'lucide-react';
import { DietMark, initials, OfflineBar, rupee, rupeeShort, toast } from '../../lib/ui';
import { printReceipt } from '../printing';
import type { Catalog, GuestOrder, LocalBill, MenuItem } from '../types';
import { fromServer, nextBillNumber, queue, session, since, store, totalsFor } from '../device';
import { Receipt, receiptText } from '../receipt';
import { Dialog, PinSwitch } from '../dialog';
import { MoreDialog, PayDialog } from '../pay-dialogs';
import { DayClose } from '../day-close';
import { Approvals, GuestOrders } from '../waiting';

// ---------- The till ----------

export function Till({ outletId }: { outletId: string }) {
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

import '@fnb/theme/theme.css';
import './menu.css';

// Guest QR menu: no sign-in, no cookies, nothing about the guest is collected.
// URL: /m/<business code>/<outlet code>, e.g. /m/demo/BLR1 (printed as a QR code per outlet): read-only.
// /m/<business code>/<outlet code>/<table id> (a QR code per table): the guest can also send an
// order, which waits for staff to accept it at the counter.
//
// Requests are kept few: one for the menu, a refresh each minute only while the screen is on,
// one to send an order, and a live connection only while an order waits for staff.

interface Item {
  id: string;
  name: string;
  department: 'food' | 'beverage';
  description: string | null;
  course: string | null;
  type: string | null;
  subtype: string | null;
  brand: string | null;
  dietType: string | null;
  allergens: string[];
  tags: string[];
  calories: number | null;
  serveSizeMl: string | null;
  price: string;
  status: 'available' | 'low' | 'out';
}
interface Sent {
  id: string;
  summary: string;
  status: 'pending' | 'accepted' | 'rejected';
  reason: string | null;
}

const [, , customer, outlet, table] = location.pathname.split('/');
const params = new URLSearchParams(location.search);
const code = { customer: customer || params.get('c'), outlet: outlet || params.get('o'), table: table || params.get('t') };
const base = `${encodeURIComponent(code.customer ?? '')}/${encodeURIComponent(code.outlet ?? '')}`;
const root = document.getElementById('root')!;
const ui = { tab: 'food' as 'food' | 'beverage', vegOnly: false, q: '' };
let data: {
  outlet: { name: string; address: string | null; fssaiNumber: string | null };
  items: Item[];
  table: { id: string; name: string; slug: string } | null;
  ordering: boolean;
  pickTable: boolean; // demo switch: the outlet menu lists tables to pick from
  tables?: { id: string; name: string; slug: string }[];
} | null = null;
let loadedAt = 0;
const cart = new Map<string, number>(); // menu item id → quantity, only in this page's memory
const sent: Sent[] = [];
let clientId: string | null = null; // kept while a send is retried, so the order is stored once
const MAX_QTY = 20;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const price = (v: string | number) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const itemById = (id: string) => data?.items.find((i) => i.id === id);
// The same menu for one table (or for none), in whichever address form this page was opened with.
const tableHref = (slug: string | null) =>
  customer ? `/m/${base}${slug ? `/${slug}` : ''}` : `?c=${encodeURIComponent(code.customer!)}&o=${encodeURIComponent(code.outlet!)}${slug ? `&t=${slug}` : ''}`;
// randomUUID needs HTTPS; the fallback covers a menu opened over plain http on the restaurant's network.
const uuid = () =>
  crypto.randomUUID?.() ?? '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16));

// FSSAI marks by shape: veg = circle in a square, non-veg (and egg) = triangle in a square.
function mark(diet: string | null) {
  if (!diet) return '';
  const veg = diet === 'veg';
  const label = veg ? 'Veg' : diet === 'egg' ? 'Contains egg (non-veg)' : 'Non-veg';
  const c = veg ? 'var(--mark-veg)' : 'var(--mark-nonveg)';
  return `<svg class="mark" viewBox="0 0 16 16" width="15" height="15" role="img" aria-label="${label}"><title>${label}</title><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="${c}" stroke-width="1.6"/>${veg ? `<circle cx="8" cy="8" r="3.6" fill="${c}"/>` : `<path d="M8 3.8 12.2 11.6H3.8Z" fill="${c}"/>`}</svg>`;
}

function qtyHtml(i: Item) {
  const n = cart.get(i.id) ?? 0;
  if (!n) return `<button class="add" data-more="${i.id}" aria-label="Add ${esc(i.name)}">Add</button>`;
  return `<span class="qty"><button data-less="${i.id}" aria-label="One less ${esc(i.name)}">−</button><output aria-live="polite">${n}</output><button data-more="${i.id}" aria-label="One more ${esc(i.name)}" ${n >= MAX_QTY ? 'disabled' : ''}>+</button></span>`;
}

function itemHtml(i: Item) {
  const out = i.status === 'out';
  const notes = [
    i.serveSizeMl ? `${Number(i.serveSizeMl)} ml` : '',
    i.calories ? `${i.calories} kcal` : '',
    ...i.tags.filter((t) => !t.startsWith('cuisine:')).map((t) => (t.startsWith('spice:') ? `${t.slice(6)} spice` : t)),
  ].filter(Boolean);
  return `<li class="item${out ? ' out' : ''}">
    <div class="line">${mark(i.dietType)}<span class="name">${esc(i.name)}</span><span class="dots" aria-hidden="true"></span><span class="price">${out ? 'Sold out' : price(i.price)}</span></div>
    ${i.description ? `<p class="desc">${esc(i.description)}</p>` : ''}
    ${notes.length || i.allergens.length ? `<p class="meta">${notes.map((n) => `<span>${esc(n)}</span>`).join('')}${i.allergens.length ? `<span class="allergen">Contains ${esc(i.allergens.join(', '))}</span>` : ''}</p>` : ''}
    ${data?.ordering && !out ? `<div class="order-control">${qtyHtml(i)}</div>` : ''}
  </li>`;
}

function groups(items: Item[], key: (i: Item) => string) {
  const out = new Map<string, Item[]>();
  for (const i of items) out.set(key(i), [...(out.get(key(i)) ?? []), i]);
  return out;
}

function sectionsHtml() {
  if (!data) return '';
  const q = ui.q.trim().toLowerCase();
  const items = data.items.filter(
    (i) => i.department === ui.tab && (!ui.vegOnly || i.dietType === 'veg') && (!q || `${i.name} ${i.description ?? ''} ${i.brand ?? ''}`.toLowerCase().includes(q)),
  );
  if (!items.length) return `<p class="empty">${q ? 'Nothing matches that search.' : 'Nothing here right now.'}</p>`;
  const top = groups(items, (i) => (ui.tab === 'food' ? i.course : i.type) ?? 'More');
  return [...top]
    .map(([name, list]) => {
      const body =
        ui.tab === 'food'
          ? `<ul>${list.map(itemHtml).join('')}</ul>`
          : [...groups(list, (i) => i.brand ?? i.subtype ?? '')].map(([b, l]) => `${b ? `<h3>${esc(b)}</h3>` : ''}<ul>${l.map(itemHtml).join('')}</ul>`).join('');
      return `<section id="s-${slug(name)}"><h2><span>${esc(name)}</span></h2>${body}</section>`;
    })
    .join('');
}

// ---------- Ordering ----------

function cartLines() {
  return [...cart].flatMap(([id, qty]) => {
    const item = itemById(id);
    return item ? [{ item, qty }] : [];
  });
}

const STATUS: Record<Sent['status'], string> = {
  pending: 'Sent. Waiting for staff to confirm…',
  accepted: 'Confirmed by staff. It is on its way.',
  rejected: 'Staff could not take this order.',
};

function barHtml() {
  if (!data?.ordering) return '';
  const lines = cartLines();
  const count = lines.reduce((a, l) => a + l.qty, 0);
  const total = lines.reduce((a, l) => a + Number(l.item.price) * l.qty, 0);
  const status = sent
    .slice(-3)
    .map((o) => `<p class="sent ${o.status}" role="status"><strong>${STATUS[o.status]}</strong> ${esc(o.summary)}${o.reason ? `<br>${esc(o.reason)}` : ''}</p>`)
    .join('');
  return `${status}${count ? `<button class="cta" data-review>Review order · ${count} item${count === 1 ? '' : 's'} · ${price(total)}</button>` : ''}`;
}

function reviewHtml(error = '') {
  const lines = cartLines();
  const total = lines.reduce((a, l) => a + Number(l.item.price) * l.qty, 0);
  return `<h2><span>Your order · Table ${esc(data?.table?.name ?? '')}</span></h2>
    ${lines.length ? `<ul>${lines.map((l) => `<li class="item"><div class="line">${mark(l.item.dietType)}<span class="name">${esc(l.item.name)}</span><span class="dots" aria-hidden="true"></span><span class="price">${price(Number(l.item.price) * l.qty)}</span></div><div class="order-control">${qtyHtml(l.item)}</div></li>`).join('')}</ul>` : '<p class="empty">Nothing added yet.</p>'}
    <p class="review-total"><span>Total before taxes</span><strong>${price(total)}</strong></p>
    <p class="muted">Staff confirm every order. Please tell your server about any allergies.</p>
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    <div class="review-actions">
      <button class="ghost" data-close>Keep browsing</button>
      <button class="cta" data-send ${lines.length ? '' : 'disabled'}>Send to staff</button>
    </div>`;
}

// Redraw only what the cart touches; the guest's scroll position and search stay as they are.
function refresh() {
  const sections = root.querySelector('#sections');
  if (sections) sections.innerHTML = sectionsHtml();
  const bar = root.querySelector('#bar');
  if (bar) bar.innerHTML = barHtml();
  const review = root.querySelector<HTMLDialogElement>('#review');
  if (review?.open) review.innerHTML = reviewHtml();
}

async function send(button: HTMLButtonElement) {
  if (!data?.table) return;
  const lines = [...cart].map(([menuItemId, qty]) => ({ menuItemId, qty }));
  const review = root.querySelector<HTMLDialogElement>('#review')!;
  clientId ??= uuid();
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const res = await fetch(`/api/public/orders/${base}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, tableId: data.table.id, lines }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      for (const id of body.soldOut ?? []) {
        cart.delete(id);
        const item = itemById(id);
        if (item) item.status = 'out';
      }
      clientId = null;
      refresh();
      review.innerHTML = reviewHtml(body.message ?? 'The order could not be sent. Please ask your server.');
      return;
    }
    sent.push({ id: body.id, summary: cartLines().map((l) => `${l.qty} × ${l.item.name}`).join(', '), status: body.status, reason: null });
    cart.clear();
    clientId = null;
    review.close();
    refresh();
    if (body.status === 'pending') watch(body.id);
  } catch {
    // Same clientId on the next try, so an order that did arrive is not stored twice.
    review.innerHTML = reviewHtml('No connection. Check your signal and send again.');
  }
}

// A live connection while the order waits: staff's decision arrives at once, with no repeated
// requests from the phone. It closes as soon as the order is decided.
async function watch(id: string) {
  const { io } = await import('socket.io-client');
  const sock = io({ path: '/api/socket', auth: { guestOrder: id }, transports: ['websocket'] });
  const done = (d: { status: Sent['status']; reason: string | null }) => {
    const o = sent.find((x) => x.id === id);
    if (o) Object.assign(o, { status: d.status, reason: d.reason });
    refresh();
    if (d.status !== 'pending') sock.close();
  };
  const check = () =>
    fetch(`/api/public/orders/${base}/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && done(d))
      .catch(() => {});
  sock.on('guestOrder', done);
  // After a dropped connection, one request catches a decision made while it was down.
  sock.io.on('reconnect', check);
  // Without a live connection (some hosts cannot keep one open), ask every 10 seconds instead.
  const poll = setInterval(() => (sent.find((x) => x.id === id)?.status !== 'pending' ? clearInterval(poll) : !sock.connected && check()), 10_000);
}

// One listener for every add, remove and button on the page.
root.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!el || !data) return;
  if (el.dataset.more) cart.set(el.dataset.more, Math.min(MAX_QTY, (cart.get(el.dataset.more) ?? 0) + 1));
  else if (el.dataset.less) {
    const n = (cart.get(el.dataset.less) ?? 0) - 1;
    if (n > 0) cart.set(el.dataset.less, n);
    else cart.delete(el.dataset.less);
  } else if ('review' in el.dataset) {
    const review = root.querySelector<HTMLDialogElement>('#review')!;
    review.innerHTML = reviewHtml();
    review.showModal();
    return;
  } else if ('close' in el.dataset) {
    root.querySelector<HTMLDialogElement>('#review')!.close();
    return;
  } else if ('send' in el.dataset) {
    void send(el);
    return;
  } else return;
  clientId = null; // a different order now
  refresh();
});

function render() {
  if (!data) return;
  const names = [...new Set(data.items.filter((i) => i.department === ui.tab).map((i) => (ui.tab === 'food' ? i.course : i.type) ?? 'More'))];
  document.body.classList.toggle('ordering', data.ordering);
  root.innerHTML = `
    <header class="hero">
      <span class="logo" role="img" aria-label="Logo"></span>
      <h1>${esc(data.outlet.name)}</h1>
      ${data.outlet.address ? `<p>${esc(data.outlet.address)}</p>` : ''}
      ${data.ordering && data.table ? `<p class="table-tag">Table ${esc(data.table.name)} · add dishes and send your order to staff${data.pickTable ? ` · <a href="${tableHref(null)}">change table</a>` : ''}</p>` : ''}
      ${data.tables?.length ? `<nav class="pick-table" aria-label="Pick your table"><p>Ordering? Pick your table</p>${data.tables.map((tb) => `<a href="${tableHref(tb.slug)}">${esc(tb.name)}</a>`).join('')}</nav>` : ''}
      <div class="ornament" aria-hidden="true"><span></span>◆<span></span></div>
    </header>
    <div class="sticky">
      <nav class="tabs" role="tablist">
        <button role="tab" aria-selected="${ui.tab === 'food'}" data-tab="food">Food</button>
        <button role="tab" aria-selected="${ui.tab === 'beverage'}" data-tab="beverage">Drinks</button>
      </nav>
      <div class="tools">
        <input id="q" type="search" placeholder="Search the menu" value="${esc(ui.q)}" aria-label="Search the menu" />
        ${ui.tab === 'food' ? `<label class="veg"><input id="veg" type="checkbox" ${ui.vegOnly ? 'checked' : ''} /> ${mark('veg')} Veg only</label>` : ''}
      </div>
      <nav class="jump" aria-label="Sections">${names.map((n) => `<a href="#s-${slug(n)}">${esc(n)}</a>`).join('')}</nav>
    </div>
    <div id="sections">${sectionsHtml()}</div>
    <footer>
      <p class="legend">${mark('veg')} Veg &nbsp;&nbsp; ${mark('non_veg')} Non-veg (includes egg)</p>
      <p>Prices are before taxes. Please tell your server about any allergies.</p>
      ${data.outlet.fssaiNumber ? `<p>FSSAI Lic. No. ${esc(data.outlet.fssaiNumber)}</p>` : ''}
    </footer>
    <div id="bar" class="bar">${barHtml()}</div>
    <dialog id="review" aria-label="Your order"></dialog>`;
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.tab = b.dataset.tab as typeof ui.tab;
      render();
      window.scrollTo({ top: 0 });
    }),
  );
  const q = root.querySelector<HTMLInputElement>('#q')!;
  q.addEventListener('input', () => {
    ui.q = q.value;
    root.querySelector('#sections')!.innerHTML = sectionsHtml();
  });
  root.querySelector<HTMLInputElement>('#veg')?.addEventListener('change', (e) => {
    ui.vegOnly = (e.target as HTMLInputElement).checked;
    root.querySelector('#sections')!.innerHTML = sectionsHtml();
  });
}

async function load() {
  if (!code.customer || !code.outlet) {
    root.innerHTML = '<p class="empty">Scan the QR code on your table to see the menu.</p>';
    return;
  }
  try {
    const url = `/api/public/menu/${base}${code.table ? `?table=${encodeURIComponent(code.table)}` : ''}`;
    let res = await fetch(url);
    if (res.status >= 500) res = await fetch(url); // a cold or dropped server: ask once more
    if (!res.ok) throw new Error();
    const first = !data;
    data = await res.json();
    loadedAt = Date.now();
    for (const [id] of cart) if (itemById(id)?.status !== 'available' && itemById(id)?.status !== 'low') cart.delete(id); // sold out since
    document.title = `Menu · ${data!.outlet.name}`;
    // Keep the guest's place: only redraw the item list after the first load.
    if (first) render();
    else refresh();
  } catch {
    if (!data) root.innerHTML = '<p class="empty">The menu could not be loaded. Please ask your server.</p>';
  }
}

// Sold-out marks and prices stay current, but a phone in a pocket or a closed tab asks for nothing.
const stale = () => document.visibilityState === 'visible' && Date.now() - loadedAt >= 60_000;
load();
setInterval(() => stale() && load(), 60_000);
document.addEventListener('visibilitychange', () => stale() && load());

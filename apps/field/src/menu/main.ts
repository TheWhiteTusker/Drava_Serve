import '@fnb/theme/theme.css';
import './menu.css';

// Guest QR menu: read-only, no sign-in, no cookies, nothing about the guest is collected.
// URL: /m/<business code>/<outlet code>, e.g. /m/demo/BLR1 (printed as a QR code per outlet).

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

const [, , customer, outlet] = location.pathname.split('/');
const params = new URLSearchParams(location.search);
const code = { customer: customer || params.get('c'), outlet: outlet || params.get('o') };
const root = document.getElementById('root')!;
const ui = { tab: 'food' as 'food' | 'beverage', vegOnly: false, q: '' };
let data: { outlet: { name: string; address: string | null; fssaiNumber: string | null }; items: Item[] } | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const price = (v: string) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// FSSAI marks by shape: veg = circle in a square, non-veg (and egg) = triangle in a square.
function mark(diet: string | null) {
  if (!diet) return '';
  const veg = diet === 'veg';
  const label = veg ? 'Veg' : diet === 'egg' ? 'Contains egg (non-veg)' : 'Non-veg';
  const c = veg ? 'var(--mark-veg)' : 'var(--mark-nonveg)';
  return `<svg class="mark" viewBox="0 0 16 16" width="15" height="15" role="img" aria-label="${label}"><title>${label}</title><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="${c}" stroke-width="1.6"/>${veg ? `<circle cx="8" cy="8" r="3.6" fill="${c}"/>` : `<path d="M8 3.8 12.2 11.6H3.8Z" fill="${c}"/>`}</svg>`;
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

function render() {
  if (!data) return;
  const names = [...new Set(data.items.filter((i) => i.department === ui.tab).map((i) => (ui.tab === 'food' ? i.course : i.type) ?? 'More'))];
  root.innerHTML = `
    <header class="hero">
      <span class="logo" role="img" aria-label="Logo"></span>
      <h1>${esc(data.outlet.name)}</h1>
      ${data.outlet.address ? `<p>${esc(data.outlet.address)}</p>` : ''}
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
    </footer>`;
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
    const res = await fetch(`/api/public/menu/${encodeURIComponent(code.customer)}/${encodeURIComponent(code.outlet)}`);
    if (!res.ok) throw new Error();
    const first = !data;
    data = await res.json();
    document.title = `Menu · ${data!.outlet.name}`;
    // Keep the guest's place: only redraw the item list after the first load.
    if (first) render();
    else root.querySelector('#sections')!.innerHTML = sectionsHtml();
  } catch {
    if (!data) root.innerHTML = '<p class="empty">The menu could not be loaded. Please ask your server.</p>';
  }
}

load();
setInterval(load, 60_000); // sold-out marks and prices stay current

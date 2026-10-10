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
let tab: 'food' | 'beverage' = 'food';
let data: { outlet: { name: string; address: string | null; fssaiNumber: string | null }; items: Item[] } | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const price = (v: string) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// FSSAI marks by shape: veg = circle in a square, non-veg (and egg) = triangle in a square.
function mark(diet: string | null) {
  if (!diet) return '';
  const veg = diet === 'veg';
  const label = veg ? 'Veg' : diet === 'egg' ? 'Contains egg (non-veg)' : 'Non-veg';
  const c = veg ? 'var(--mark-veg)' : 'var(--mark-nonveg)';
  return `<svg class="mark" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="${label}"><title>${label}</title><rect x="1" y="1" width="14" height="14" fill="none" stroke="${c}" stroke-width="1.6"/>${veg ? `<circle cx="8" cy="8" r="3.6" fill="${c}"/>` : `<path d="M8 3.8 12.2 11.6H3.8Z" fill="${c}"/>`}</svg>`;
}

function itemHtml(i: Item) {
  const out = i.status === 'out';
  const meta = [
    i.serveSizeMl ? `${Number(i.serveSizeMl)} ml` : '',
    i.allergens.length ? `Contains: ${i.allergens.join(', ')}` : '',
    i.calories ? `${i.calories} kcal` : '',
    ...i.tags.filter((t) => !t.startsWith('cuisine:')).map((t) => t.replace('spice:', 'Spice: ')),
  ].filter(Boolean);
  return `<li class="item${out ? ' out' : ''}">
    <div class="line">${mark(i.dietType)}<span class="name">${esc(i.name)}</span><span class="price">${out ? 'Sold out' : price(i.price)}</span></div>
    ${i.description ? `<p>${esc(i.description)}</p>` : ''}
    ${meta.length ? `<p class="meta">${meta.map(esc).join(' · ')}</p>` : ''}
  </li>`;
}

function groups(items: Item[], key: (i: Item) => string) {
  const out = new Map<string, Item[]>();
  for (const i of items) out.set(key(i), [...(out.get(key(i)) ?? []), i]);
  return out;
}

function render() {
  if (!data) return;
  const items = data.items.filter((i) => i.department === tab);
  const sections =
    tab === 'food'
      ? [...groups(items, (i) => i.course ?? 'Other')].map(([course, list]) => `<section><h2>${esc(course)}</h2><ul>${list.map(itemHtml).join('')}</ul></section>`)
      : [...groups(items, (i) => i.type ?? 'Other')].map(
          ([type, list]) =>
            `<section><h2>${esc(type)}</h2>${[...groups(list, (i) => i.brand ?? i.subtype ?? '')]
              .map(([brand, l]) => `${brand ? `<h3>${esc(brand)}</h3>` : ''}<ul>${l.map(itemHtml).join('')}</ul>`)
              .join('')}</section>`,
        );
  root.innerHTML = `
    <header><span class="logo" role="img" aria-label="Logo"></span><h1>${esc(data.outlet.name)}</h1></header>
    <nav role="tablist">
      <button role="tab" aria-selected="${tab === 'food'}" data-tab="food">Food</button>
      <button role="tab" aria-selected="${tab === 'beverage'}" data-tab="beverage">Drinks</button>
    </nav>
    ${sections.join('') || '<p class="muted">Nothing here right now.</p>'}
    <footer>
      <p>${mark('veg')} Veg &nbsp; ${mark('non_veg')} Non-veg (includes egg)</p>
      <p>Prices are before taxes. Please tell your server about any allergies.</p>
      ${data.outlet.fssaiNumber ? `<p>FSSAI licence no. ${esc(data.outlet.fssaiNumber)}</p>` : ''}
    </footer>`;
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab as typeof tab;
      render();
    }),
  );
}

async function load() {
  if (!code.customer || !code.outlet) {
    root.innerHTML = '<p class="muted">Scan the QR code on your table to see the menu.</p>';
    return;
  }
  try {
    const res = await fetch(`/api/public/menu/${encodeURIComponent(code.customer)}/${encodeURIComponent(code.outlet)}`);
    if (!res.ok) throw new Error();
    data = await res.json();
    document.title = `Menu · ${data!.outlet.name}`;
    render();
  } catch {
    if (!data) root.innerHTML = '<p class="muted">The menu could not be loaded. Please ask your server.</p>';
  }
}

load();
setInterval(load, 60_000); // sold-out marks and prices stay current

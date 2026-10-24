// Keeps the admin app on the device so repeat visits open at once. Built files have hashed names, so
// a copy never goes out of date: it is served from the device and fetched once. The page itself is
// network first, so a new release shows up on the next visit. Data (/api) is never cached here;
// the app keeps its own cache for that. The other apps (POS, receiving, guest menu) have their own workers.
const CACHE = 'fnb-admin-v1';
const OTHER_APPS = ['/pos/', '/receiving/', '/m/', '/menu/', '/field-assets/'];
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (OTHER_APPS.some((p) => url.pathname.startsWith(p))) return;
  const keep = (res) => {
    if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
    return res;
  };
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request).then(keep)));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(keep)
      .catch(() => caches.match(e.request).then((hit) => hit ?? caches.match('/'))),
  );
});

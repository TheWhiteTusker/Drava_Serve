// Keeps the app shell on the device so it opens without a connection. API calls are never
// cached here: offline changes are queued by the app itself and sent when back online.
const CACHE = 'fnb-shell-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first, falling back to the last copy we saw.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit ?? caches.match(`${self.registration.scope}index.html`)).then((hit) => hit ?? caches.match(self.registration.scope))),
  );
});

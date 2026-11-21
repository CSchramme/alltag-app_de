// Service Worker (Alltag): immer zuerst frisch vom eigenen Server, offline der letzte Stand. Dazu Push-Mitteilungen.
const CACHE = 'alltag-v4'; // hochzählen, wenn sich Dateien der App-Hülle ändern (z. B. Icons)
const SHELL = ['/', '/app.css', '/app.js', '/recur.js', '/theme.js', '/manifest.webmanifest', '/icon-192.png', '/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/data') return;
  // Netz zuerst: der Server steht zu Hause, neue Versionen sollen sofort ankommen
  const key = e.request.mode === 'navigate' ? '/' : url.pathname;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((res) => { // immer beim Server nachfragen (ETag), nie eine alte Kopie aus dem Browser-Cache
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key).then((r) => r || Response.error())));
});

self.addEventListener('push', (e) => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(d.title || 'Alltag', {
    body: d.body || '', tag: d.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list[0];
    if (!c) return self.clients.openWindow(url);
    c.postMessage({ url });
    return c.focus();
  }));
});

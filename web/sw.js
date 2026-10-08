/* ThirdPerspective service worker: cache the app shell only, never the backend.
   Also acts as the display layer for reminders, so notifications survive the page
   being closed (see web/notify.js for how they are scheduled).

   Strategy: NETWORK-FIRST for everything on this origin. A deploy must be picked
   up on the very next load — the old stale-while-revalidate copy kept serving a
   broken app.js (dead buttons) on devices that had already visited the site.
   The cache is only the offline fallback now. */
const CACHE_NAME = 'thirdperspective-v14';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './bodymap.js',
  './notify.js',
  './sound.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('thirdperspective-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // The Apps Script backend must always hit the network, untouched.
  if (url.hostname === 'script.google.com' || url.hostname.endsWith('.googleusercontent.com')) return;
  // Third-party CDNs (fonts, Tailwind, Chart.js, lucide) are not ours to cache.
  if (url.origin !== self.location.origin) return;

  // Same origin: try the network first, keep the cache as the offline fallback.
  // Navigations fall back to the cached shell so the app opens without a network.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))
      )
  );
});

/* Tapping a reminder focuses an existing tab, or opens the app on the tab the
   reminder came from. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = (event.notification && event.notification.data) || {};
  const target = data.url || './';
  const tab = target.indexOf('?tab=') >= 0
    ? target.slice(target.indexOf('?tab=') + 5)
    : '';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          if (tab && 'postMessage' in client) {
            client.postMessage({ type: 'tp-goto', tab: tab });
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

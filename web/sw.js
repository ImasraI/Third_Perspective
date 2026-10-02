/* ThirdPerspective service worker: cache the app shell only, never the backend.
   Also acts as the display layer for reminders, so notifications survive the page
   being closed (see web/notify.js for how they are scheduled). */
const CACHE_NAME = 'thirdperspective-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './bodymap.js',
  './notify.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // The Apps Script backend must always hit the network.
  if (url.includes('script.google.com') || url.includes('googleusercontent.com')) return;
  if (e.request.method !== 'GET') return;

  // Navigations: network first, fall back to the cached shell when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }

  // Everything else: stale-while-revalidate.
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
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
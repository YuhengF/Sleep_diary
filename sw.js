// sw.js — network-first service worker.
// Online: always fetch the latest app shell (no stale cached modules after a deploy).
// Offline: fall back to the last cached copy. Only same-origin GETs are handled;
// cross-origin calls (Chart.js CDN, GitHub API, Open-Meteo) pass straight through.
const CACHE = 'sleep-diary-shell';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // don't touch CDN / API traffic

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache a copy of successful responses for offline use.
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

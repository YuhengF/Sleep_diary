// sw.js — network-first, bypassing the HTTP cache so a deploy is picked up immediately
// (prevents "new HTML + stale JS" version skew). Offline falls back to the last cache.
// Only same-origin GETs are handled; cross-origin (Chart.js CDN, GitHub API, Open-Meteo)
// passes straight through.
const CACHE = 'sleep-diary-shell-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // don't touch CDN / API traffic

  event.respondWith(
    // Force a real network hit (bypass the browser HTTP cache) so code is always fresh.
    fetch(req.url, { cache: 'no-store' })
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req)) // offline: serve last known good
  );
});

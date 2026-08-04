const CACHE = 'bcp-v13';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './game.js',
  './fx.js',
  './solver.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Serve from cache for instant offline play, but refresh each asset in the
// background so a new version is picked up on the next launch.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });

      const network = fetch(req)
        .then(res => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      if (hit) {
        event.waitUntil(network);
        return hit;
      }

      return (await network) || cache.match('./index.html');
    })
  );
});

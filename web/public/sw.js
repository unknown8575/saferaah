// Offline support: the app shell and map data are cached after first load,
// so planning a safe route works with no signal. API calls always go to the network.
const CACHE = 'saferaah-v1';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg',
  'data/graph.bin', 'data/pois.json', 'data/search.json', 'data/basemap.bin', 'data/version.json',
  'fonts/noto/0-255.pbf', 'fonts/noto/256-511.pbf'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  // network first (fresh data when online), cache fallback (offline)
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});

// Conservative service worker: HTML is never cached (the feed is dynamic and
// auth-gated), static assets are stale-while-revalidate, and photos — which
// are immutable and randomly named — are cache-first with a size cap.
const VERSION = 'v2';
const STATIC_CACHE = `static-${VERSION}`;
const IMG_CACHE = 'images-v1';
const MAX_IMAGES = 300;
const STATIC_ASSETS = ['/css/style.css', '/js/app.js', '/js/crop.js', '/site.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      // cache: 'reload' skips the HTTP cache so a new SW never precaches
      // the very files it was updated to replace.
      .then((c) => c.addAll(STATIC_ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== STATIC_CACHE && k !== IMG_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_IMAGES) {
    await Promise.all(keys.slice(0, keys.length - MAX_IMAGES).map((k) => cache.delete(k)));
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.startsWith('/img/')) {
    e.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      // Guard against caching a login redirect that resolved to HTML.
      if (res.ok && (res.headers.get('Content-Type') || '').startsWith('image/')) {
        cache.put(e.request, res.clone());
        trimCache(cache);
      }
      return res;
    })());
    return;
  }

  if (['/css/', '/js/', '/icons/'].some((p) => url.pathname.startsWith(p))
      || url.pathname === '/site.webmanifest') {
    e.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(e.request);
      // no-cache forces revalidation against the server rather than the
      // HTTP cache, so the background refresh actually picks up deploys.
      const refresh = fetch(e.request, { cache: 'no-cache' }).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || refresh;
    })());
  }
  // Everything else (pages, form posts): straight to the network.
});

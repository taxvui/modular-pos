// The build replaces this marker with a hash of every precached asset.
const CACHE = 'modular-pos-shell-__BUILD_ID__';
const ASSETS = ['/account.html', '/app-config.js', '/assets/account.mjs',
  '/assets/auth-client.mjs', '/assets/sales.mjs', '/assets/offline-store.mjs', '/assets/offline-review.mjs', '/assets/staff-access.mjs', '/assets/order-history.mjs', '/assets/order-save.mjs', '/assets/shift-history.mjs', '/assets/pwa.mjs'];
const PAGES = new Set(['/', '/account', '/account.html', '/login', '/admin', '/pos']);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const entries = await Promise.all(ASSETS.map(async url => {
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (response.status !== 200) throw new Error('SHELL_UNAVAILABLE');
        // Vercel clean URLs may redirect account.html to /account. Navigation
        // requests cannot use a cached Response whose redirected flag is set.
        const headers = new Headers(response.headers);
        headers.delete('content-encoding'); headers.delete('content-length');
        return [url, new Response(await response.arrayBuffer(), { status: 200, headers })];
      }));
      const cache = await caches.open(CACHE);
      await Promise.all(entries.map(([url, response]) => cache.put(url, response)));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
  // Wait for existing tabs to close; never replace code underneath a live cart.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('modular-pos-shell-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // API responses, Auth tokens, orders and customer details never enter Cache Storage.
  const path = request.mode === 'navigate' && PAGES.has(url.pathname)
    ? '/account.html' : ASSETS.includes(url.pathname) ? url.pathname : null;
  if (!path) return;
  event.respondWith((async () => {
    const cached = await (await caches.open(CACHE)).match(path);
    return cached || fetch(request);
  })());
});

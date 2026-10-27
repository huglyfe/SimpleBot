export {};
declare const self: ServiceWorkerGlobalScope;
declare const BUILD: { revision: string; assets: string[] };

// The build supplies an exact public-asset allowlist. Private requests pass
// straight through: no runtime caching, offline writes, or background work.
// Stable cache ownership lets new builds remove the preceding shell.
const prefix = 'simplebot-shell-';
const cacheName = prefix + BUILD.revision;
const assets = new Set(
  BUILD.assets.map((path) => new URL(path, self.location.origin).href),
);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) =>
        cache.addAll(
          BUILD.assets.map((path) => new Request(path, { cache: 'reload' })),
        ),
      ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(prefix) && key !== cacheName)
          await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data === 'activate') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const shell =
    request.mode === 'navigate' &&
    (url.pathname === '/' || url.pathname === '/index.html');
  if (!shell && !assets.has(url.href)) return;
  event.respondWith(
    (async () => {
      const cached = await (
        await caches.open(cacheName)
      ).match(shell ? '/index.html' : request);
      return cached ?? fetch(request);
    })(),
  );
});

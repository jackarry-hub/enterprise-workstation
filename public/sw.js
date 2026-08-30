const STATIC_CACHE = "quantxy-static-v1";
const STATIC_PATH = /^\/_next\/static\//;
const SAFE_PUBLIC_PATH = /^\/(?:brand|dashboard)\/.*\.(?:png|jpg|jpeg|webp|svg|ico)$/i;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name !== STATIC_CACHE).map((name) => caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener("message", (event) => {
  if (event.data?.type === "PURGE_SENSITIVE_CACHES") event.waitUntil(caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name)))));
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const request = event.request; const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || request.mode === "navigate" || (!STATIC_PATH.test(url.pathname) && !SAFE_PUBLIC_PATH.test(url.pathname))) return;
  event.respondWith(caches.open(STATIC_CACHE).then(async (cache) => {
    const cached = await cache.match(request);
    const network = fetch(request).then((response) => { if (response.ok && response.type === "basic") void cache.put(request, response.clone()); return response; });
    return cached ?? network;
  }));
});

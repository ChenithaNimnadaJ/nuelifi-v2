const CACHE_NAME = "neulifi-static-v3";
const APP_SHELL = "/index.html";
const STATIC_DESTINATIONS = new Set(["script", "style", "image", "font", "manifest"]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(APP_SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("neulifi-static-") && key !== CACHE_NAME).map((key) => caches.delete(key)))));
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(APP_SHELL, response.clone());
        return response;
      } catch {
        return (await cache.match(APP_SHELL)) || Response.error();
      }
    })());
    return;
  }

  if (!STATIC_DESTINATIONS.has(request.destination)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request, { cache: "no-store" });
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      return (await cache.match(request)) || Response.error();
    }
  })());
});

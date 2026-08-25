const CACHE_NAME = "neulifi-static-v4";
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

self.addEventListener("notificationclick", (event) => { event.notification.close(); event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => { const target = new URL("/app", self.location.origin).href; const existing = clientList.find((client) => "focus" in client); if (existing) { void existing.focus(); if ("navigate" in existing) return existing.navigate(target); return existing; } return self.clients.openWindow(target); })); });

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Cloudflare challenge assets must stay on the network; caching/intercepting them can surface a false backend outage.
  if (url.pathname === "/cdn-cgi" || url.pathname.startsWith("/cdn-cgi/")) return;

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

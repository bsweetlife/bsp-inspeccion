const CACHE = "bsp-v2";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-180.png",
  "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Nunca cachear llamadas a la API de Anthropic
  if (url.hostname === "api.anthropic.com" || url.hostname.endsWith("supabase.co")) return;
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request)
          .then((resp) => {
            if (e.request.method === "GET" && resp.ok && (url.origin === location.origin || ["cdnjs.cloudflare.com","cdn.jsdelivr.net"].includes(url.hostname))) {
              const copia = resp.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copia));
            }
            return resp;
          })
          .catch(() => caches.match("./index.html"))
    )
  );
});

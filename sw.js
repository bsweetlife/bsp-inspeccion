const CACHE = "bsp-v26";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./bsp-icon-192.png?v=31",
  "./bsp-icon-512.png?v=31",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(
      // Los archivos propios se piden salteando la cache del navegador,
      // si no se corre el riesgo de guardar una version vieja en la cache nueva.
      SHELL.map((u) => (u.startsWith("http") ? u : new Request(u, { cache: "reload" })))
    )).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Nunca cachear llamadas a la API de Anthropic ni a Supabase
  if (url.hostname === "api.anthropic.com" || url.hostname.endsWith("supabase.co")) return;

  // Las paginas van primero a la red: asi nunca se queda una version atras.
  // Sin conexion cae a la cache y la app sigue funcionando igual.
  const esPagina = e.request.mode === "navigate" ||
    (url.origin === location.origin && url.pathname.endsWith(".html"));

  if (esPagina) {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          if (resp && resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copia));
          }
          return resp;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  // El resto (iconos, librerias de CDN) sigue siendo cache primero.
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

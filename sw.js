/* Service worker — NETWORK-FIRST : toujours la dernière version quand en ligne,
   cache uniquement en repli hors-ligne. Fini les versions figées en cache. */
const CACHE = "najah-v47";
const SHELL = [
  "index.html", "styles.css", "app.js", "config.js",
  "manifest.webmanifest", "icon.svg", "icon-maskable.svg", "icon-app.png", "icon-192.png",
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Ne jamais intercepter l'API de données (REST/fonctions Supabase) ni le webhook n8n.
  if (url.pathname.includes("/rest/v1/") || url.pathname.includes("/functions/v1/") || url.hostname.endsWith("n8n.cloud")) return;
  if (e.request.method !== "GET") return;
  // Network-first : on tente le réseau (et on met à jour le cache), repli cache si hors-ligne.
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// Bei jeder Änderung an der App-Hülle hochzählen (index.html, Schriften,
// Icons). Der activate-Handler löscht alle Caches mit abweichendem Namen —
// dadurch bekommen wiederkehrende Nutzer nach einem Deploy sofort die neue
// index.html, statt beim ersten Aufruf noch die alte aus dem Cache zu sehen.
// v2: lokale Schriften unter /fonts statt Google Fonts.
const CACHE_NAME = "quittungs-tool-v2";
const ASSETS_TO_CACHE = ["./", "./index.html", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  // API-Requests (Firma/Kunden/Quittungen aus D1) müssen immer frisch vom
  // Netzwerk kommen — sonst zeigt die App nach dem ersten Laden veraltete
  // Daten an, bis der Hintergrund-Refetch beim übernächsten Aufruf greift.
  // Das widerspricht dem Zweck der zentralen Datenbank.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch((err) => {
          // Nur auf den Cache zurückfallen, wenn dort auch wirklich etwas
          // liegt. Vorher wurde hier "cached" (also undefined) zurückgegeben,
          // sobald die Datei noch nie geladen worden war — respondWith(undefined)
          // lässt den Request mit einem generischen Netzwerkfehler scheitern
          // statt mit der normalen Offline-Meldung des Browsers.
          if (cached) return cached;
          throw err;
        });
      return cached || networkFetch;
    })
  );
});

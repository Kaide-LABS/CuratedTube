/*
 * CuratedTube service worker (Implements PHASE_3_SPEC.md §6).
 *
 * Offline SHELL cache only. It NEVER caches YouTube Data API responses or the IFrame player, and
 * it does no background sync and registers no push notifications (PHASE_3_SPEC §9). Strategy:
 *   - navigations  -> network-first, falling back to the cached offline page when offline
 *   - same-origin static assets -> cache-first
 *   - everything cross-origin (googleapis.com / youtube.com) -> not intercepted (passes through)
 */
const CACHE = "curatedtube-shell-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Only ever touch our own origin — leave the Data API and the player completely alone.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((resp) => {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return resp;
          }),
      ),
    );
  }
});

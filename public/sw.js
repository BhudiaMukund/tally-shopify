/**
 * Tally's service worker — app shell only.
 *
 * The one rule that matters more than the others (BUILD_PLAN §10, said twice
 * by the person who asked for this): catalogue lookups must always hit the
 * network. `/api/*` is a pure passthrough below — the fetch handler returns
 * without calling `respondWith()` at all for it, so the request goes straight
 * to the network exactly as if this worker did not exist. That is a stronger
 * guarantee than "network-first with a cache fallback": there is no code path
 * here that can ever serve a cached API response, stale or otherwise.
 *
 * Everything else is ordinary shell caching: navigations are network-first
 * (so anyone online always gets the current build) with a cached fallback for
 * the offline case, and `/_next/static/*` plus icons and fonts are
 * cache-first, which is safe only because their filenames are content-hashed.
 *
 * Hand-written rather than Workbox/`next-pwa`: Next's build output has no
 * fixed file list to precache — the hashes change on every build — so a
 * generated precache manifest buys nothing a cache-on-first-use strategy
 * doesn't already give for less code and less to audit.
 */

const CACHE_VERSION = "tally-shell-v1";
const OFFLINE_URL = "/scan";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  );
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_VERSION);
    void cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? (await caches.match(OFFLINE_URL));
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  const cache = await caches.open(CACHE_VERSION);
  void cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept an API call, catalogue lookups least of all — let it hit
  // the network exactly as if this worker were not installed.
  if (url.pathname.startsWith("/api/")) return;

  // Cross-origin requests (Shopify's CDN, Garage) are not the app shell.
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (event.request.method === "GET" && isStaticAsset(url)) {
    event.respondWith(cacheFirst(event.request));
  }
});

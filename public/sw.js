const CACHE_NAME = "diagassist-cache-v2";
const ASSETS_TO_CACHE = [
  "/",
  "/manifest.json",
  "/icon.svg"
];

// Install Service Worker and cache essential shells
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Service Worker] Caching application shell");
      // Use catch to prevent install failure if any single asset fails to fetch
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn("[Service Worker] Pre-cache failed, continuing anyway:", err);
      });
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate & clean old caches (crucial to kick out the old broken v1 cache)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[Service Worker] Removing old cache:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      // Take control immediately
      return self.clients.claim();
    })
  );
});

// Fetch handler with robust Network-First with Cache Fallback strategy
self.addEventListener("fetch", (event) => {
  // Only handle GET requests and local scope
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Skip caching for API calls to keep them live
  if (event.request.url.includes("/api/")) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If response is valid, cache it for offline use
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Offline: try to serve from cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fallback if the requested resource was HTML and not found
          const acceptHeader = event.request.headers.get("accept");
          if (acceptHeader && acceptHeader.includes("text/html")) {
            return caches.match("/");
          }
        });
      })
  );
});

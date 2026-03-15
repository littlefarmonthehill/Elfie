// Auto-generated version using build timestamp
// DO NOT EDIT THIS LINE - Updated automatically on each build
const BUILD_TIMESTAMP = Date.now();
const CACHE_VERSION = BUILD_TIMESTAMP;
const CACHE_NAME = `planetbrick-v${CACHE_VERSION}`;
const urlsToCache = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  // Force immediate activation of new service worker
  console.log(`[SW] Installing version ${CACHE_VERSION}`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating version ${CACHE_VERSION}`);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      // Delete all old caches
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log(`[SW] Deleting old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log(`[SW] Taking control of all pages`);
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Don't intercept API requests at all — let the browser handle them natively.
  // Intercepting via event.respondWith ties the request to the SW lifetime,
  // which causes long-running requests (e.g. inventory sync) to fail on iOS
  // with "FetchEvent.respondWith received an error: TypeError: Load failed".
  if (url.pathname.startsWith('/api/')) {
    return;
  }
  
  // Network-first strategy for non-API requests
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses (but NOT API responses)
        if (response.status === 200 && !url.pathname.startsWith('/api/')) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fall back to cache if network fails
        return caches.match(event.request);
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

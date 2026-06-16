const CACHE_VERSION = '2026.06.16.2';
const CACHE_NAME = `elfie-cache-v${CACHE_VERSION}`;
const urlsToCache = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
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
        if (response.status === 200 && !url.pathname.startsWith('/api/')) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Show a notification whenever a push arrives — works on both the lock screen
// (app in background) and the active screen (app in foreground).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'E.L.F.I.E.', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'E.L.F.I.E.';
  const options = {
    body: data.body || '',
    icon: '/elfie-robot.png',
    badge: '/icon-192.png',
    tag: data.tag || 'elfie-notification',
    renotify: true,
    silent: false,
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus or open the app when the user taps a notification banner.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

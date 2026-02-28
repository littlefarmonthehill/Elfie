import { useEffect } from 'react';

export function useServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      let newWorker: ServiceWorker | null = null;

      // Register service worker with stable URL (no dynamic timestamp)
      // The registration.update() call below handles checking for updates
      navigator.serviceWorker
        .register('/service-worker.js')
        .then((registration) => {
          console.log('✅ Service Worker registered');

          // Check for updates only when app is opened
          registration.update();

          // Listen for updates
          registration.addEventListener('updatefound', () => {
            newWorker = registration.installing;
            
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker && newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New version available - auto-update
                  console.log('🔄 New version available, updating...');
                  newWorker.postMessage({ type: 'SKIP_WAITING' });
                }
              });
            }
          });

          // Auto-reload when new service worker takes control.
          // We only reload on visibilitychange (user tabs away and comes back),
          // never mid-session — this prevents disruptive reloads during active
          // workflows like fulfillment or printing.
          let refreshing = false;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
              console.log('🔄 Update available — will apply on next tab switch.');

              const applyOnReturn = () => {
                // Reload only when the user comes BACK to the tab, not when
                // a drawer closes or any other mid-session DOM change fires.
                if (document.visibilityState === 'visible') {
                  refreshing = true;
                  console.log('🔄 Applying update on tab return...');
                  window.location.reload();
                  document.removeEventListener('visibilitychange', applyOnReturn);
                }
              };

              document.addEventListener('visibilitychange', applyOnReturn);
            }
          });
        })
        .catch((error) => {
          console.error('❌ Service Worker registration failed:', error);
        });
    }
  }, []);
}

import { useEffect } from 'react';

export function useServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      let newWorker: ServiceWorker | null = null;

      // Add timestamp to force re-check on each app load
      const timestamp = new Date().getTime();
      navigator.serviceWorker
        .register(`/service-worker.js?t=${timestamp}`)
        .then((registration) => {
          console.log('✅ Service Worker registered');

          // Check for updates on page load
          registration.update();

          // Check for updates every 60 seconds
          setInterval(() => {
            registration.update();
          }, 60000);

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

          // Auto-reload when new service worker takes control
          // BUT ONLY if the page is visible (not during camera usage)
          let refreshing = false;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
              // Don't reload if page is hidden (e.g., camera is open)
              if (document.hidden || document.visibilityState === 'hidden') {
                console.log('🔄 Update available, but waiting until page is visible...');
                
                // Wait for page to become visible again, then reload
                const visibilityHandler = () => {
                  if (!document.hidden && document.visibilityState === 'visible') {
                    console.log('🔄 Page visible again, reloading to apply update...');
                    refreshing = true;
                    window.location.reload();
                    document.removeEventListener('visibilitychange', visibilityHandler);
                  }
                };
                
                document.addEventListener('visibilitychange', visibilityHandler);
              } else {
                // Page is visible, safe to reload
                refreshing = true;
                console.log('🔄 Reloading to apply update...');
                window.location.reload();
              }
            }
          });
        })
        .catch((error) => {
          console.error('❌ Service Worker registration failed:', error);
        });
    }
  }, []);
}

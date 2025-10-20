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

          // Auto-reload when new service worker takes control
          // BUT ONLY if the page is visible and no drawers/modals are open
          let refreshing = false;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
              // Helper to check if any drawers/modals are open
              const isModalOpen = () => {
                // Check for common modal/drawer indicators
                const hasOpenDialog = document.querySelector('[role="dialog"][data-state="open"]');
                const hasOpenSheet = document.querySelector('[data-state="open"]');
                const hasAriaModal = document.querySelector('[aria-modal="true"]');
                return !!(hasOpenDialog || hasOpenSheet || hasAriaModal);
              };

              // Don't reload if page is hidden (e.g., camera is open) or if modals are open
              const shouldWait = document.hidden || document.visibilityState === 'hidden' || isModalOpen();
              
              if (shouldWait) {
                console.log('🔄 Update available, but waiting for safe moment to reload...');
                
                // Wait for a safe moment to reload
                const checkAndReload = () => {
                  if (!document.hidden && document.visibilityState === 'visible' && !isModalOpen()) {
                    console.log('🔄 Safe to reload now, applying update...');
                    refreshing = true;
                    window.location.reload();
                    document.removeEventListener('visibilitychange', visibilityCheckHandler);
                    clearInterval(modalCheckInterval);
                  }
                };
                
                const visibilityCheckHandler = () => checkAndReload();
                document.addEventListener('visibilitychange', visibilityCheckHandler);
                
                // Also check periodically if modals have closed
                const modalCheckInterval = setInterval(() => checkAndReload(), 2000);
              } else {
                // Page is visible and no modals open, safe to reload
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

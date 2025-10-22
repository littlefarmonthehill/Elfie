import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Register service worker for PWA updates with aggressive update checking for iOS
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');
      
      // Force update check immediately on iOS
      registration.update();
      
      // Check for updates every 30 seconds (iOS doesn't auto-update reliably)
      setInterval(() => {
        registration.update();
      }, 30000);
      
      // When a new service worker is waiting, activate it immediately
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker available, reload to activate
              newWorker.postMessage({ type: 'SKIP_WAITING' });
              window.location.reload();
            }
          });
        }
      });
    } catch (err) {
      // Silently fail in development
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);

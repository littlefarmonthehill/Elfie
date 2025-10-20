import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Register service worker for PWA updates
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      // Silently fail in development
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);

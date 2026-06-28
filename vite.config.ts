import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    // Auto-stamp the service worker's CACHE_VERSION with the build timestamp
    // so every deploy produces a detectably-different SW file — no manual bumping needed.
    {
      name: 'stamp-service-worker',
      writeBundle() {
        const swPath = path.resolve(import.meta.dirname, 'dist/public/service-worker.js');
        if (fs.existsSync(swPath)) {
          const version = new Date().toISOString().slice(0, 16).replace('T', '.').replace(':', '-');
          let content = fs.readFileSync(swPath, 'utf-8');
          content = content.replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = '${version}';`);
          fs.writeFileSync(swPath, content);
        }
      },
    },
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});

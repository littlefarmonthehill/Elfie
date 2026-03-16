import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({
        "Content-Type": "text/html",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  // Use process.cwd() + "dist/public" — reliable across all environments.
  // import.meta.dirname can resolve incorrectly in esbuild bundles depending
  // on the Node version / working directory at runtime.
  const distPath = path.resolve(process.cwd(), "dist", "public");

  if (!fs.existsSync(distPath)) {
    // Log clearly rather than throwing — a thrown error here is caught by the
    // outer IIFE try-catch in index.ts and silently discarded, leaving the
    // app permanently broken with "Cannot GET /".
    console.error(
      `[ServeStatic] Build directory not found: ${distPath}. Run "npm run build" first.`,
    );
    return;
  }

  console.log(`[ServeStatic] Serving static files from ${distPath}`);
  app.use(express.static(distPath));

  // Catch-all: serve index.html for SPA routes.
  // Pass /api/* to the next handler so API routes registered after this
  // middleware (i.e. by registerRoutes) still work correctly.
  // IMPORTANT: use req.originalUrl (not req.path) — Express can strip req.path
  // to "/" when mounting at "*", causing every /api/* request to receive
  // index.html instead of being forwarded to the actual route handler.
  app.use("*", (req, res, next) => {
    if (req.originalUrl.startsWith("/api")) return next();
    res.set({
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    });
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

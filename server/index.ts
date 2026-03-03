import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startInventorySyncScheduler } from "./services/inventory-sync-scheduler";
import { startPomSyncScheduler } from "./services/pom-scheduler";
import { startChannelSyncScheduler } from "./services/channel-sync-scheduler";
import { startOrderSyncScheduler } from "./services/order-sync-scheduler";
import { startEmbeddingWorker } from "./services/embedding-worker";
import { startForumSyncScheduler } from "./services/bl-forum-scheduler";
import { startService as startSegmentService, warmupSam } from "./services/segmentClient";
import { pool } from "./db";

// Suppress Vite's process.exit(1) which fires on any CSS/TS compilation error.
// By throwing instead, the error surfaces as an uncaughtException (caught below)
// so the server keeps running and serves requests normally.
const _originalExit = process.exit.bind(process);
let _allowExit = false;
(process as any).exit = (code?: number) => {
  if (_allowExit) {
    _originalExit(code);
    return;
  }
  console.log(`[EXIT SUPPRESSED] process.exit(${code}) was called — keeping server alive`);
  throw new Error(`SuppressedExit:${code}`);
};

process.on('uncaughtException', (err) => {
  if (err.message && err.message.startsWith('SuppressedExit:')) {
    console.log(`[EXIT BLOCKED] ${err.message} — server continues running`);
    return;
  }
  console.error('[CRASH] Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason: any) => {
  if (reason && reason.message && reason.message.startsWith('SuppressedExit:')) {
    console.log(`[EXIT BLOCKED via rejection] ${reason.message} — server continues running`);
    return;
  }
  console.error('[CRASH] Unhandled Rejection reason:', reason);
});
process.on('SIGTERM', () => {
  console.log('[SIGNAL] Received SIGTERM — flushing stale sync records before exit...');
  // Best-effort: clear any in_progress sync records so the next startup
  // doesn't have to wait for the first status poll to self-correct.
  const cleanup = async () => {
    try {
      const { db: dbInst } = await import('./db');
      const { syncMetadata: syncMeta } = await import('@shared/schema');
      const { sql: drizzleSql } = await import('drizzle-orm');
      const staleIds = ['bricklink_inventory', 'priceomatic_cache', 'channel_sync', 'bricklink_orders', 'brickowl_orders'];
      for (const id of staleIds) {
        await dbInst.update(syncMeta)
          .set({ lastSyncStatus: 'error', errorMessage: 'Sync interrupted by server shutdown.', updatedAt: new Date() })
          .where(drizzleSql`${syncMeta.id} = ${id} AND ${syncMeta.lastSyncStatus} = 'in_progress'`);
      }
      console.log('[SIGTERM] Stale sync records cleared');
    } catch (e: any) {
      console.error('[SIGTERM] Could not clear stale sync records:', e.message);
    }
    _allowExit = true;
    _originalExit(0);
  };
  // Give cleanup up to 5s; force-exit either way
  const timer = setTimeout(() => { _allowExit = true; _originalExit(0); }, 5000);
  cleanup().finally(() => clearTimeout(timer));
});
process.on('SIGINT', () => {
  console.log('[SIGNAL] Received SIGINT');
  _allowExit = true;
  _originalExit(0);
});
process.on('exit', (code) => {
  // This fires on ANY exit (process.exit, natural end of event loop, etc.)
  // but NOT on SIGKILL. If this fires, the exit is from code, not OS.
  console.log(`[EXIT] Process exiting with code ${code} — exiting from within code`);
});

// Periodic heartbeat every 10s — keeps Replit's pid2 process manager from
// triggering its ~15s inactivity-kill when the server is idle between requests
const _heartbeatInterval = setInterval(() => {
  const mem = process.memoryUsage();
  process.stdout.write(`[ALIVE] RSS:${Math.round(mem.rss/1024/1024)}MB Heap:${Math.round(mem.heapUsed/1024/1024)}/${Math.round(mem.heapTotal/1024/1024)}MB\n`);
}, 10000);

const app = express();
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    const server = await registerRoutes(app);

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      console.error(`[Express Error] ${status} ${message}`, err.stack || '');
      if (!res.headersSent) {
        res.status(status).json({ message });
      }
    });

    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    // Warm up the database connection before accepting traffic.
    // Neon serverless suspends compute after idle periods; this first query
    // wakes it up so user requests don't hit a slow 1-2s reconnect window
    // that can destabilize the server.
    try {
      await pool.query('SELECT 1');
      console.log('[DB] Connection warmed up successfully');
    } catch (warmupErr) {
      console.error('[DB] Warm-up query failed (continuing anyway):', warmupErr);
    }

    // Clear any stale in_progress sync records left over from a previous run
    // that was killed mid-sync (deployment, OOM, crash, etc.).
    try {
      const { db: dbInstance } = await import('./db');
      const { syncMetadata: syncMeta } = await import('@shared/schema');
      const { sql: drizzleSql } = await import('drizzle-orm');
      const staleIds = ['bricklink_inventory', 'priceomatic_cache', 'channel_sync', 'bricklink_orders', 'brickowl_orders'];
      for (const id of staleIds) {
        await dbInstance.update(syncMeta)
          .set({
            lastSyncStatus: 'error',
            errorMessage: 'Sync interrupted by server restart.',
            updatedAt: new Date(),
          })
          .where(
            drizzleSql`${syncMeta.id} = ${id} AND ${syncMeta.lastSyncStatus} = 'in_progress'`
          );
      }
      console.log('[Startup] Cleared any stale in_progress sync records');
    } catch (staleErr: any) {
      console.error('[Startup] Could not clear stale sync records (non-fatal):', staleErr.message);
    }

    // ALWAYS serve the app on the port specified in the environment variable PORT
    // Other ports are firewalled. Default to 5000 if not specified.
    // this serves both the API and the client.
    // It is the only port that is not firewalled.
    const port = parseInt(process.env.PORT || '5000', 10);
    server.listen({
      port,
      host: "0.0.0.0",
    }, () => {
      log(`serving on port ${port}`);

      // Warm up the Python segmentation service immediately so it's ready
      // before the first Brickanalyzer scan request arrives.
      startSegmentService();

      // Pre-download and load SAM model in the background so the first
      // SAM scan doesn't have to wait for a 375MB checkpoint download.
      warmupSam();

      // Start automatic inventory sync scheduler
      startInventorySyncScheduler();

      // Start standalone Price-o-Matic sync scheduler (independent of inventory sync)
      startPomSyncScheduler();

      // Start Channel Sync scheduler (Local DB → BrickOwl / other channels)
      startChannelSyncScheduler();

      // Start Order Sync scheduler (BrickLink + BrickOwl orders on a frequency interval)
      startOrderSyncScheduler().catch(error => {
        console.error('Failed to start order sync scheduler:', error);
      });
      
      // Start BrickLink forum sync scheduler
      startForumSyncScheduler().catch(error => {
        console.error('Failed to start forum sync scheduler:', error);
      });
      
      // Start background embedding worker
      startEmbeddingWorker();
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
})();

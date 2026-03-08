import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startInventorySyncScheduler } from "./services/inventory-sync-scheduler";
import { startPomSyncScheduler } from "./services/pom-scheduler";
import { startChannelSyncScheduler } from "./services/channel-sync-scheduler";
import { startOrderSyncScheduler } from "./services/order-sync-scheduler";
import { startEmbeddingWorker } from "./services/embedding-worker";
import { startForumSyncScheduler } from "./services/bl-forum-scheduler";
import { startUniversalCatalogScheduler } from "./services/universal-catalog-scheduler";
import { startService as startSegmentService, warmupClip } from "./services/segmentClient";
import { pool, db, runMigrations } from "./db";
import { blInventory, scanEmbeddings, embeddingJobs, orders } from "@shared/schema";
import { sql as drizzleSqlCount, eq, inArray } from "drizzle-orm";

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
    await runMigrations();
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

      // Also mark any brickanalyzer scans that were mid-flight as failed —
      // they were killed by the restart and will never complete.
      const { brickanalyzerScans } = await import('@shared/schema');
      const { eq: drizzleEq } = await import('drizzle-orm');
      await dbInstance.update(brickanalyzerScans)
        .set({ status: 'failed', errorMessage: 'Scan interrupted by server restart.', completedAt: new Date() })
        .where(drizzleEq(brickanalyzerScans.status, 'processing'));
      console.log('[Startup] Cleared any stale processing brickanalyzer scans');
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

      // Pre-load CLIP ViT-B/32 so the first Brick Spotter scan doesn't
      // pay the cold-start cost (downloads ~338MB weights once).
      warmupClip();

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
      
      // Start Universal CLIP Catalog auto-refresh scheduler
      startUniversalCatalogScheduler();

      // Auto-resume Universal Catalog worker after restarts.
      // Delayed 90s so the CLIP model has time to load before the first embed request.
      setTimeout(async () => {
        try {
          const {
            startUniversalWorker,
            getUniversalCatalogState,
            isUniversalImporting,
          } = await import('./services/universal-clip-catalog.js');

          if (isUniversalImporting() || getUniversalCatalogState()?.running) return;

          // Reset items that failed recently (within 3h) — these are almost always
          // transient failures from the CLIP model still warming up on the previous run.
          await db.execute(drizzleSqlCount`
            UPDATE universal_catalog_queue
            SET status = 'pending', attempted_at = NULL, error_msg = NULL
            WHERE status = 'failed'
              AND attempted_at IS NOT NULL
              AND attempted_at > NOW() - INTERVAL '3 hours'
          `);

          const [row] = await db.execute<{ cnt: string }>(
            drizzleSqlCount`SELECT COUNT(*)::text AS cnt FROM universal_catalog_queue WHERE status = 'pending'`
          ).then(r => r.rows ?? []);
          const pending = Number(row?.cnt ?? 0);

          if (pending > 0) {
            console.log(`[Universal Catalog] Auto-resuming — ${pending.toLocaleString()} pending parts to embed`);
            await startUniversalWorker();
          } else {
            console.log('[Universal Catalog] Auto-resume check — nothing pending');
          }
        } catch (e: any) {
          console.error('[Universal Catalog] Auto-resume failed (non-fatal):', e.message);
        }
      }, 90_000); // 90s: CLIP model warm-up window

      // Start BrickLink forum sync scheduler
      startForumSyncScheduler().catch(error => {
        console.error('Failed to start forum sync scheduler:', error);
      });
      
      // Start background embedding worker (async — resets any orphaned 'processing' jobs first)
      startEmbeddingWorker().catch(error => {
        console.error('Failed to start embedding worker:', error);
      });

      // Auto-resume CLIP visual catalog build if it was interrupted by a restart
      setTimeout(async () => {
        try {
          const { buildCatalogEmbeddings, getActiveBuild } = await import('./services/clip-search.js');
          if (getActiveBuild()?.running) return; // already running

          // Count inventory items vs catalog embeddings to see if build is incomplete
          const [invCount] = await db.select({ count: drizzleSqlCount`count(*)` }).from(blInventory);
          const [embCount] = await db.select({ count: drizzleSqlCount`count(*)` }).from(scanEmbeddings)
            .where(drizzleSqlCount`source = 'catalog'`);

          const total = Number((invCount as any).count);
          const done = Number((embCount as any).count);

          if (total > 0 && done < total) {
            console.log(`[CLIP Catalog] Auto-resuming build — ${done}/${total} embedded. Queuing remaining ${total - done} items...`);
            const rows = await db.select({ itemNo: blInventory.itemNo, colorId: blInventory.colorId }).from(blInventory);
            const items = rows.map(r => ({ itemNo: r.itemNo, colorId: Number(r.colorId), itemType: 'PART' }));
            buildCatalogEmbeddings(items, (p) => {
              if (p.done % 100 === 0 || p.done === p.total) {
                console.log(`[CLIP Catalog] ${p.done}/${p.total} embedded (${p.errors} errors)`);
              }
            }).then((final) => {
              console.log(`[CLIP Catalog] Auto-resume complete: ${final.done} embedded, ${final.errors} errors`);
            }).catch((e) => {
              console.error('[CLIP Catalog] Auto-resume failed:', e.message);
            });
          } else if (total > 0) {
            console.log(`[CLIP Catalog] Catalog complete (${done}/${total}) — no resume needed`);
          }
        } catch (e: any) {
          console.error('[CLIP Catalog] Auto-resume check failed (non-fatal):', e.message);
        }
      }, 15000); // 15s delay: let segment service warm up first

      // Auto-resume inventory & orders vector enrichment if items remain unembedded
      setTimeout(async () => {
        try {
          const { createEmbeddingJob } = await import('./services/embedding-worker');

          // Check for an active (pending/processing) job for each type — only create if none exists
          const activeJobs = await db
            .select({ jobType: embeddingJobs.jobType })
            .from(embeddingJobs)
            .where(inArray(embeddingJobs.status, ['pending', 'processing']));
          const activeTypes = new Set(activeJobs.map(j => j.jobType));

          // --- Inventory ---
          if (!activeTypes.has('inventory')) {
            const invResult = await db.execute(drizzleSqlCount`
              SELECT COUNT(*) AS count
              FROM bl_inventory bi
              LEFT JOIN inventory_embeddings ie ON bi.id = ie.inventory_id
              WHERE ie.inventory_id IS NULL
            `);
            const unembeddedInv = parseInt(String((invResult.rows[0] as any)?.count ?? '0'));
            if (unembeddedInv > 0) {
              await createEmbeddingJob('inventory', 'auto-resume-on-start');
              console.log(`[EmbedResume] Created inventory job — ${unembeddedInv} items need embedding`);
            }
          }

          // --- Orders ---
          if (!activeTypes.has('orders')) {
            const ordResult = await db.execute(drizzleSqlCount`
              SELECT COUNT(*) AS count
              FROM orders o
              LEFT JOIN order_embeddings oe ON o.id = oe.order_id
              WHERE oe.order_id IS NULL
            `);
            const unembeddedOrd = parseInt(String((ordResult.rows[0] as any)?.count ?? '0'));
            if (unembeddedOrd > 0) {
              await createEmbeddingJob('orders', 'auto-resume-on-start');
              console.log(`[EmbedResume] Created orders job — ${unembeddedOrd} orders need embedding`);
            }
          }
        } catch (e: any) {
          console.error('[EmbedResume] Auto-resume check failed (non-fatal):', e.message);
        }
      }, 20000); // 20s — after embedding worker has started
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
})();

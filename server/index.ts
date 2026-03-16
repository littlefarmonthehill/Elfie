import { installLogInterceptor } from "./services/server-log-buffer";
installLogInterceptor();

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startInventorySyncScheduler } from "./services/inventory-sync-scheduler";
import { startPomSyncScheduler } from "./services/pom-scheduler";
import { startCatalogDetailScheduler } from "./services/catalog-detail-scheduler";
import { startCatalogScanScheduler } from "./services/catalog-scan-scheduler";
import { startChannelSyncScheduler } from "./services/channel-sync-scheduler";
import { startOrderSyncScheduler } from "./services/order-sync-scheduler";
import { startEmbeddingWorker } from "./services/embedding-worker";
import { startForumSyncScheduler } from "./services/bl-forum-scheduler";
import { startMarketNewsSyncScheduler } from "./services/market-news-scheduler";
import { startBusinessIntelScheduler } from "./services/business-intel-scheduler";
import { startUniversalCatalogScheduler } from "./services/universal-catalog-scheduler";
import { startRebrickableSetsScheduler } from "./services/rebrickable-sets-scheduler";
import { startService as startSegmentService, warmupClip } from "./services/segmentClient";
import { pool, db, runMigrations } from "./db";
import { blInventory, blCatalogClipEmbeddings, embeddingJobs, orders } from "@shared/schema";
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
  if (err.message && err.message.includes('EADDRINUSE')) {
    console.error('[CRASH] Port in use — exiting so workflow can retry cleanly');
    _allowExit = true;
    setTimeout(() => { _originalExit(1); }, 1000);
  }
});
process.on('unhandledRejection', (reason: any) => {
  if (reason && reason.message && reason.message.startsWith('SuppressedExit:')) {
    console.log(`[EXIT BLOCKED via rejection] ${reason.message} — server continues running`);
    return;
  }
  console.error('[CRASH] Unhandled Rejection reason:', reason);
});
process.on('SIGTERM', () => {
  console.log('[SIGNAL] Received SIGTERM — stopping active syncs and flushing records...');
  const cleanup = async () => {
    try {
      const { requestPomShutdown } = await import('./services/bricklink');
      requestPomShutdown();
    } catch (_) {}
    try {
      const { db: dbInst } = await import('./db');
      const { syncMetadata: syncMeta } = await import('@shared/schema');
      const { sql: drizzleSql } = await import('drizzle-orm');
      const staleIds = ['bricklink_inventory', 'priceomatic_cache', 'catalog_detail_completion', 'catalog_scan', 'channel_sync', 'bricklink_orders', 'brickowl_orders', 'forum_sync', 'rebrickable_set_parts'];
      for (const id of staleIds) {
        await dbInst.update(syncMeta)
          .set({ lastSyncStatus: 'error', errorMessage: 'Sync interrupted by server shutdown.', lastSyncTime: new Date(0), updatedAt: new Date() })
          .where(drizzleSql`${syncMeta.id} = ${id} AND ${syncMeta.lastSyncStatus} = 'in_progress'`);
      }
      console.log('[SIGTERM] Stale sync records cleared');
    } catch (e: any) {
      console.error('[SIGTERM] Could not clear stale sync records:', e.message);
    }
    await new Promise(r => setTimeout(r, 500));
    try {
      const { db: dbInst } = await import('./db');
      const { syncMetadata: syncMeta } = await import('@shared/schema');
      const { sql: drizzleSql } = await import('drizzle-orm');
      await dbInst.update(syncMeta)
        .set({ lastSyncStatus: 'error', errorMessage: 'Sync interrupted by server shutdown.', lastSyncTime: new Date(0), updatedAt: new Date() })
        .where(drizzleSql`${syncMeta.id} = 'priceomatic_cache' AND ${syncMeta.lastSyncStatus} IN ('in_progress', 'interrupted')`);
      console.log('[SIGTERM] Final POM status check complete');
    } catch (_) {}
    _allowExit = true;
    _originalExit(0);
  };
  const timer = setTimeout(() => { _allowExit = true; _originalExit(0); }, 5000);
  cleanup().finally(() => clearTimeout(timer));
});
process.on('SIGINT', () => {
  console.log('[SIGNAL] Received SIGINT');
  _allowExit = true;
  _originalExit(0);
});
process.on('exit', (code) => {
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

// Track whether migrations have completed so routes can gate on it if needed.
let _migrationsComplete = false;

// Middleware that returns 503 for API calls that arrive before migrations finish.
// Health check (/api/health) is allowed through immediately so the deployment
// health check passes as soon as the port opens.
app.use((req, res, next) => {
  if (_migrationsComplete) return next();
  if (req.path === '/api/health') return next();
  if (!req.path.startsWith('/api')) return next(); // let Vite/static serve the SPA
  res.status(503).json({ message: 'Server is starting up, please retry in a moment.' });
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

    // Set up Vite (dev) or static file serving (prod) BEFORE listen so the
    // SPA is available immediately after the port opens.
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    // ── Open the port FIRST ──────────────────────────────────────────────────
    // This ensures the deployment health check passes within its timeout window.
    // Migrations, DB warm-up, and schedulers all run AFTER listen() fires.
    const port = parseInt(process.env.PORT || '5000', 10);
    server.listen({ port, host: "0.0.0.0" }, () => {
      log(`serving on port ${port}`);

      // Self-ping keeps the autoscale container alive.
      const externalDomain = process.env.REPLIT_DOMAINS?.split(',')[0]?.trim();
      const selfPingUrl = externalDomain
        ? `https://${externalDomain}/api/health`
        : `http://127.0.0.1:${port}/api/health`;
      console.log(`[SelfPing] URL: ${selfPingUrl}`);
      let _lastPingAt = 0;
      setInterval(async () => {
        try {
          const { syncLock } = await import('./services/sync-lock');
          const activeSyncs = syncLock.getActive();
          const intervalMs = activeSyncs.length > 0 ? 15_000 : 45_000;
          const now = Date.now();
          if (now - _lastPingAt < intervalMs) return;
          _lastPingAt = now;
          const resp = await fetch(selfPingUrl, { signal: AbortSignal.timeout(10_000) });
          if (!resp.ok) console.log(`[SelfPing] ${resp.status}`);
        } catch (e: any) {
          console.log(`[SelfPing] failed: ${e.message}`);
        }
      }, 15_000);

      // ── Run migrations + all post-boot work asynchronously ─────────────────
      // The port is already open above; this block must never block it.
      (async () => {
        try {
          // 1. Run DB migrations (44 phases — can take several seconds)
          await runMigrations();
          _migrationsComplete = true;

          // 2. Warm up the DB connection (wakes Neon serverless from idle)
          try {
            await pool.query('SELECT 1');
            console.log('[DB] Connection warmed up successfully');
          } catch (warmupErr) {
            console.error('[DB] Warm-up query failed (continuing anyway):', warmupErr);
          }

          // 3. Clear stale in_progress sync records left from a previous crash
          try {
            const { db: dbInstance } = await import('./db');
            const { syncMetadata: syncMeta } = await import('@shared/schema');
            const { sql: drizzleSql } = await import('drizzle-orm');
            const staleIds = [
              'bricklink_inventory', 'priceomatic_cache', 'catalog_detail_completion',
              'catalog_scan', 'channel_sync', 'bricklink_orders', 'brickowl_orders',
              'forum_sync', 'rebrickable_set_parts', 'market_news_sync', 'business_intel_sync',
            ];
            for (const id of staleIds) {
              await dbInstance.update(syncMeta)
                .set({
                  lastSyncStatus: 'error',
                  errorMessage: 'Sync interrupted by server restart.',
                  lastSyncTime: new Date(0),
                  updatedAt: new Date(),
                })
                .where(drizzleSql`${syncMeta.id} = ${id} AND (${syncMeta.lastSyncStatus} = 'in_progress' OR ${syncMeta.lastSyncStatus} = 'interrupted')`);
            }
            console.log('[Startup] Cleared any stale in_progress sync records');

            const { brickanalyzerScans } = await import('@shared/schema');
            const { eq: drizzleEq } = await import('drizzle-orm');
            await dbInstance.update(brickanalyzerScans)
              .set({ status: 'failed', errorMessage: 'Scan interrupted by server restart.', completedAt: new Date() })
              .where(drizzleEq(brickanalyzerScans.status, 'processing'));
            console.log('[Startup] Cleared any stale processing brickanalyzer scans');
          } catch (staleErr: any) {
            console.error('[Startup] Could not clear stale sync records (non-fatal):', staleErr.message);
          }

          // 4. Start background services & schedulers
          startSegmentService();
          warmupClip();
          startInventorySyncScheduler();
          startPomSyncScheduler();
          startCatalogDetailScheduler();
          startCatalogScanScheduler();
          startChannelSyncScheduler();
          startOrderSyncScheduler().catch(error => {
            console.error('Failed to start order sync scheduler:', error);
          });
          startUniversalCatalogScheduler();
          startRebrickableSetsScheduler().catch((err: any) => {
            console.error('Failed to start Rebrickable sets scheduler:', err);
          });
          startForumSyncScheduler().catch(error => {
            console.error('Failed to start forum sync scheduler:', error);
          });
          startMarketNewsSyncScheduler().catch(error => {
            console.error('Failed to start market news sync scheduler:', error);
          });
          startBusinessIntelScheduler().catch(error => {
            console.error('Failed to start business intel scheduler:', error);
          });
          startEmbeddingWorker().catch(error => {
            console.error('Failed to start embedding worker:', error);
          });

          // 5. Auto-resume CLIP visual catalog build (15s delay: segment service warm-up)
          setTimeout(async () => {
            try {
              const { buildCatalogEmbeddings, getActiveBuild } = await import('./services/clip-search.js');
              if (getActiveBuild()?.running) return;

              const [invCount] = await db.select({ count: drizzleSqlCount`count(*)` }).from(blInventory);
              const [embCount] = await db.select({ count: drizzleSqlCount`count(*)` }).from(blCatalogClipEmbeddings)
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
          }, 15_000);

          // 6. Auto-resume inventory & orders vector enrichment (20s delay)
          setTimeout(async () => {
            try {
              const { createEmbeddingJob } = await import('./services/embedding-worker');

              const activeJobs = await db
                .select({ jobType: embeddingJobs.jobType })
                .from(embeddingJobs)
                .where(inArray(embeddingJobs.status, ['pending', 'processing']));
              const activeTypes = new Set(activeJobs.map(j => j.jobType));

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
          }, 20_000);

          // 7. Auto-resume Universal Catalog worker (90s delay: CLIP model warm-up)
          setTimeout(async () => {
            try {
              const {
                startUniversalWorker,
                getUniversalCatalogState,
                isUniversalImporting,
              } = await import('./services/universal-clip-catalog.js');

              if (isUniversalImporting() || getUniversalCatalogState()?.running) return;

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
          }, 90_000);

        } catch (bgError: any) {
          console.error('[Startup] Background init error (non-fatal):', bgError.message);
        }
      })();
    });

  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
})();

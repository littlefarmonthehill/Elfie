import { installLogInterceptor } from "./services/server-log-buffer";
installLogInterceptor();

import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
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
import { startAgentTeamSchedulers } from "./services/agent-team-scheduler";
import { startUniversalCatalogScheduler } from "./services/universal-catalog-scheduler";
import { startRebrickableSetsScheduler } from "./services/rebrickable-sets-scheduler";
import { startBackupScheduler } from "./services/backup-scheduler";
import { startImageHarvester } from "./services/image-store";
import { startService as startSegmentService, warmupClip } from "./services/segmentClient";
import { pool, db, runMigrations } from "./db";
import { initStripeKey } from "./services/stripe";
import { blInventory, blCatalogClipEmbeddings, embeddingJobs } from "@shared/schema";
import { sql as drizzleSqlCount, inArray } from "drizzle-orm";

// Suppress Vite's process.exit(1) which fires on any CSS/TS compilation error.
const _originalExit = process.exit.bind(process);
let _allowExit = false;
// Forward-declared so signal handlers (registered below) can close the server.
let httpServer: ReturnType<typeof createServer>;
(process as any).exit = (code?: number) => {
  if (_allowExit) { _originalExit(code); return; }
  console.log(`[EXIT SUPPRESSED] process.exit(${code}) was called — keeping server alive`);
  throw new Error(`SuppressedExit:${code}`);
};

process.on('uncaughtException', (err) => {
  if (err.message?.startsWith('SuppressedExit:')) {
    console.log(`[EXIT BLOCKED] ${err.message} — server continues running`);
    return;
  }
  console.error('[CRASH] Uncaught Exception:', err.message, err.stack);
  if (err.message?.includes('EADDRINUSE')) {
    console.error('[CRASH] Port in use — exiting so workflow can retry cleanly');
    _allowExit = true;
    setTimeout(() => _originalExit(1), 1000);
  }
});
process.on('unhandledRejection', (reason: any) => {
  if (reason?.message?.startsWith('SuppressedExit:')) {
    console.log(`[EXIT BLOCKED via rejection] ${reason.message} — server continues running`);
    return;
  }
  console.error('[CRASH] Unhandled Rejection reason:', reason);
});
const _doExit = (code: number) => {
  // Close the HTTP server first so the OS releases port 5000 before the
  // new process tries to bind it. Without this, rapid restarts (workflow
  // restart, deploy, file-save HMR) reliably trigger EADDRINUSE.
  const finish = () => { _allowExit = true; _originalExit(code); };
  if (httpServer?.listening) {
    // closeAllConnections() (Node 18.2+) immediately destroys all open sockets,
    // ensuring the port is released before the new process tries to bind it.
    if (typeof (httpServer as any).closeAllConnections === 'function') {
      (httpServer as any).closeAllConnections();
    }
    httpServer.close(() => finish());
    // Hard deadline: if close() stalls (keep-alive connections), force exit.
    setTimeout(finish, 1000).unref();
  } else {
    finish();
  }
};

process.on('SIGTERM', () => {
  console.log('[SIGNAL] Received SIGTERM — stopping active syncs and flushing records...');
  // Release the port immediately so a new process can bind it while cleanup runs.
  if (httpServer?.listening) {
    if (typeof (httpServer as any).closeAllConnections === 'function') {
      (httpServer as any).closeAllConnections();
    }
    httpServer.close();
  }
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
    _doExit(0);
  };
  const timer = setTimeout(() => _doExit(0), 5000);
  cleanup().finally(() => clearTimeout(timer));
});
process.on('SIGINT', () => {
  console.log('[SIGNAL] Received SIGINT');
  _doExit(0);
});
process.on('exit', (code) => {
  console.log(`[EXIT] Process exiting with code ${code} — exiting from within code`);
});

// Periodic heartbeat
const _heartbeatInterval = setInterval(() => {
  const mem = process.memoryUsage();
  process.stdout.write(`[ALIVE] RSS:${Math.round(mem.rss/1024/1024)}MB Heap:${Math.round(mem.heapUsed/1024/1024)}/${Math.round(mem.heapTotal/1024/1024)}MB\n`);
}, 10000);

const app = express();
app.use(express.json({ limit: '50mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined;
  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      if (logLine.length > 80) logLine = logLine.slice(0, 79) + "…";
      log(logLine);
    }
  });
  next();
});

// ── Step 1: Register health check BEFORE anything else ──────────────────────
// This is the ONLY route that works before full initialization.
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ── Step 2: 503 for other API routes until server is fully initialized ────────
// Non-API routes (SPA) and the health check are always allowed through.
let _serverReady = false;
app.use((req, res, next) => {
  if (_serverReady) return next();
  if (!req.path.startsWith('/api')) return next(); // SPA routes always pass
  res.status(503).json({ message: 'Server is starting up, please retry in a moment.' });
});

// ── Step 3: Create the HTTP server and open the port NOW ─────────────────────
const isProduction = process.env.NODE_ENV !== 'development';

// ── Production static serving — registered IMMEDIATELY ───────────────────────
// Must happen before the async IIFE below so the frontend is reachable as soon
// as the port opens, not only after the ~30-second migration window completes.
// The catch-all inside serveStatic passes /api/* to next(), so API routes
// registered later by registerRoutes() still take priority.
if (isProduction) {
  serveStatic(app);
}

httpServer = createServer(app);
const port = parseInt(process.env.PORT || '5000', 10);

httpServer.listen({ port, host: "0.0.0.0" }, () => {
  log(`serving on port ${port}`);

  // Self-ping to keep autoscale container alive
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

  // ── Step 4: Full initialization runs in the background ───────────────────
  // The port is already open and health checks pass. Everything below runs
  // asynchronously so it never delays accepting connections.
  (async () => {
    // 4a. Run DB migrations (44 phases, can be slow)
    // Isolated try/catch — a partial migration failure must not prevent routes
    // and Vite from being registered (those failures would take down the whole app).
    try {
      await runMigrations();
    } catch (err: any) {
      console.error('[Startup] Background initialization error (non-fatal):', err.message);
    }

    // 4a-fix-1. One-time repair: reset workflow_status for orders stuck in an active
    // orderStatus but with workflow_status='done' (caused by return-to-queue actions
    // before the automatic reset was added to updateOrderStatus).
    try {
      const fixResult = await pool.query(`
        UPDATE orders
           SET workflow_status = 'new'
         WHERE order_status IN ('awaiting_payment', 'awaiting_shipment', 'awaiting_fulfillment')
           AND workflow_status = 'done'
      `);
      if (fixResult.rowCount && fixResult.rowCount > 0) {
        console.log(`[Startup] Fixed ${fixResult.rowCount} order(s) with stuck workflow_status='done' in active status.`);
      }
    } catch (fixErr: any) {
      console.error('[Startup] Could not fix stuck workflow_status (non-fatal):', fixErr.message);
    }

    // 4a-fix-2. Ensure is_test column exists on shipments (Phase-65 blocked by migration chain).
    try {
      await pool.query(`
        ALTER TABLE shipments
          ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false
      `);
    } catch (colErr: any) {
      console.error('[Startup] Could not add is_test to shipments (non-fatal):', colErr.message);
    }

    // 4a-fix-2b. Add warehouse naming-format columns to organizations.
    try {
      await pool.query(`
        ALTER TABLE organizations
          ADD COLUMN IF NOT EXISTS aisle_format text NOT NULL DEFAULT 'numeric',
          ADD COLUMN IF NOT EXISTS shelf_format  text NOT NULL DEFAULT 'alpha',
          ADD COLUMN IF NOT EXISTS bin_format    text NOT NULL DEFAULT 'numeric'
      `);
    } catch (colErr: any) {
      console.error('[Startup] Could not add warehouse format columns (non-fatal):', colErr.message);
    }

    // 4a-fix-3. Create POM AI settings tables (new tables, not touching app_settings).
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS pom_ai_settings (
          org_id       varchar(255) PRIMARY KEY,
          ai_enabled   boolean      NOT NULL DEFAULT false,
          ai_strategy  text,
          decision_count integer    NOT NULL DEFAULT 0,
          created_at   timestamp    NOT NULL DEFAULT now(),
          updated_at   timestamp    NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS pom_price_decisions (
          id              serial PRIMARY KEY,
          org_id          varchar(255) NOT NULL,
          item_no         text         NOT NULL,
          color_id        integer,
          new_or_used     text         NOT NULL DEFAULT 'N',
          suggested_price decimal(10,4),
          actual_price    decimal(10,4) NOT NULL,
          price_delta     decimal(10,4),
          market_snapshot jsonb,
          decision_at     timestamp    NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS pom_price_decisions_org_idx      ON pom_price_decisions(org_id);
        CREATE INDEX IF NOT EXISTS pom_price_decisions_org_item_idx ON pom_price_decisions(org_id, item_no, color_id);
      `);
    } catch (aiErr: any) {
      console.error('[Startup] Could not create POM AI tables (non-fatal):', aiErr.message);
    }

    // 4a-fix-4. Add agent_id column to business_insights for the AI agent team system.
    try {
      await pool.query(`
        ALTER TABLE business_insights ADD COLUMN IF NOT EXISTS agent_id text;
        CREATE INDEX IF NOT EXISTS business_insights_agent_id_idx ON business_insights(agent_id);
      `);
    } catch (agentFixErr: any) {
      console.error('[Startup] Could not add agent_id column (non-fatal):', agentFixErr.message);
    }

    // 4a-fix-5. Create ie_strategies table for per-agent business strategy statements.
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ie_strategies (
          org_id VARCHAR(255) PRIMARY KEY,
          pricing_strategy TEXT,
          inventory_strategy TEXT,
          orders_strategy TEXT,
          customer_strategy TEXT,
          market_strategy TEXT,
          updated_at TIMESTAMP DEFAULT NOW() NOT NULL
        )
      `);
    } catch (ieStratErr: any) {
      console.warn('[Startup] ie_strategies migration (non-fatal):', ieStratErr.message);
    }

    // 4a-fix-6. Add foundational vision/mission and success factors columns to ie_strategies.
    try {
      await pool.query(`
        ALTER TABLE ie_strategies
          ADD COLUMN IF NOT EXISTS vision_mission TEXT,
          ADD COLUMN IF NOT EXISTS success_factors TEXT
      `);
    } catch (ieStratColErr: any) {
      console.warn('[Startup] ie_strategies column migration (non-fatal):', ieStratColErr.message);
    }

    // 4a-fix-7. Add last_sync_meta_json column to sync_metadata for persisting full channel sync results.
    try {
      await pool.query(`
        ALTER TABLE sync_metadata
          ADD COLUMN IF NOT EXISTS last_sync_meta_json TEXT
      `);
    } catch (syncMetaColErr: any) {
      console.warn('[Startup] sync_metadata last_sync_meta_json column migration (non-fatal):', syncMetaColErr.message);
    }

    // 4a-fix-8. Create channel_sync_config table for per-field sync preferences (separate from app_settings).
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS channel_sync_config (
          id SERIAL PRIMARY KEY,
          org_id VARCHAR(255) NOT NULL UNIQUE,
          sync_price BOOLEAN NOT NULL DEFAULT true,
          sync_remarks BOOLEAN NOT NULL DEFAULT true,
          sync_description BOOLEAN NOT NULL DEFAULT true,
          sync_tier_price BOOLEAN NOT NULL DEFAULT true,
          sync_sale_percent BOOLEAN NOT NULL DEFAULT false,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
    } catch (cscErr: any) {
      console.warn('[Startup] channel_sync_config migration (non-fatal):', cscErr.message);
    }

    // 4a-fix-9. One-time cleanup: delete partial-refund adjustments that were incorrectly
    // created when the order-total fix corrected previously double-counted shipping amounts.
    // Safe to run repeatedly — idempotent (no matching rows after first run).
    try {
      const cleanupResult = await pool.query(`
        DELETE FROM order_adjustments oa
        USING orders o
        WHERE oa.order_id = o.id
          AND oa.external_transaction_id LIKE 'bo-%-partial-%'
          AND oa.reason = 'Partial refund'
          AND o.shipping_amount IS NOT NULL
          AND o.shipping_amount > 0
          AND ABS(ABS(oa.amount::numeric) - o.shipping_amount::numeric) < 0.02
      `);
      if (cleanupResult.rowCount && cleanupResult.rowCount > 0) {
        console.log(`[Startup] Cleaned up ${cleanupResult.rowCount} false partial-refund adjustment(s) (shipping double-count correction).`);
      }
    } catch (cleanupErr: any) {
      console.error('[Startup] False-refund cleanup failed (non-fatal):', cleanupErr.message);
    }

    // 4a-fix-10. One-time backfill: link bo-4895817 ↔ bo-8362106 via mergeGroupId.
    // These two orders share lot 9323751 (BrickOwl merged them), but the delta-creation
    // code ran against an older build that didn't set mergeGroupId.  Both orders should
    // show the "+" indicator in each other's flyout.  Idempotent — no-op if already set.
    try {
      const mergeFixResult = await pool.query(`
        UPDATE orders
        SET merge_group_id = 'bo-4895817'
        WHERE id IN ('bo-4895817', 'bo-8362106')
          AND (merge_group_id IS NULL OR merge_group_id = '')
      `);
      if (mergeFixResult.rowCount && mergeFixResult.rowCount > 0) {
        console.log(`[Startup] fix-10: linked ${mergeFixResult.rowCount} order(s) into merge group bo-4895817 (bo-4895817 ↔ bo-8362106).`);
      }
    } catch (mergeFixErr: any) {
      console.error('[Startup] fix-10: merge group backfill failed (non-fatal):', mergeFixErr.message);
    }

    // 4a-fix-11. Backfill customer_notes for bo-9061604.
    // The sync code was reading brickOwlOrderData.buyer_notes instead of order_note —
    // the correct BrickOwl API field name.  The note "can't wait to eat these" was
    // confirmed by the user from the BrickOwl UI.  Idempotent — only writes if NULL.
    try {
      const noteFixResult = await pool.query(`
        UPDATE orders
        SET customer_notes = $1
        WHERE id = 'bo-9061604'
          AND (customer_notes IS NULL OR customer_notes = '')
      `, ["can't wait to eat these"]);
      if (noteFixResult.rowCount && noteFixResult.rowCount > 0) {
        console.log(`[Startup] fix-11: backfilled customer_notes for bo-9061604.`);
      }
    } catch (noteFixErr: any) {
      console.error('[Startup] fix-11: customer_notes backfill failed (non-fatal):', noteFixErr.message);
    }

    try {

      // 4b. Warm up the DB connection (wakes Neon serverless from idle)
      try {
        await pool.query('SELECT 1');
        console.log('[DB] Connection warmed up successfully');
      } catch (warmupErr) {
        console.error('[DB] Warm-up query failed (continuing anyway):', warmupErr);
      }

      // 4b-stripe. Load Stripe secret key from platform_settings into the in-memory cache.
      // stripe.ts no longer reads process.env.STRIPE_SECRET_KEY — this is the sole source.
      try {
        const { platformSettings: platSettingsTable } = await import('@shared/schema');
        const { eq: eqOp } = await import('drizzle-orm');
        const [platRow] = await db
          .select({ stripeSecretKey: platSettingsTable.stripeSecretKey })
          .from(platSettingsTable)
          .where(eqOp(platSettingsTable.id, 'platform'))
          .limit(1);
        if (platRow?.stripeSecretKey) {
          initStripeKey(platRow.stripeSecretKey);
          console.log('[Startup] Stripe secret key loaded from platform settings.');
        } else {
          console.warn('[Startup] No Stripe secret key found in platform settings — billing features unavailable.');
        }
      } catch (stripeInitErr: any) {
        console.error('[Startup] Failed to load Stripe key (non-fatal):', stripeInitErr.message);
      }

      // 4c. Clear stale in_progress sync records from a previous crash
      try {
        const { db: dbInstance } = await import('./db');
        const { syncMetadata: syncMeta } = await import('@shared/schema');
        const { sql: drizzleSql } = await import('drizzle-orm');
        const staleIds = [
          'bricklink_inventory', 'priceomatic_cache', 'catalog_detail_completion',
          'catalog_scan', 'channel_sync', 'bricklink_orders', 'brickowl_orders',
          'forum_sync', 'rebrickable_set_parts', 'market_news_sync', 'business_intel_sync',
          'channel_sync_brickowl', 'channel_sync_ebay',
        ];
        for (const id of staleIds) {
          await dbInstance.update(syncMeta)
            .set({ lastSyncStatus: 'error', errorMessage: 'Sync interrupted by server restart.', lastSyncTime: new Date(0), updatedAt: new Date() })
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

      // 4d. Register all routes (includes seedPlanConfigsIfEmpty + setupAuth + every API route)
      //     The server it returns internally is discarded — we use httpServer above.
      await registerRoutes(app);

      // 4e. Wire up Vite dev middleware AFTER routes so the catch-all never shadows API routes.
      // NOTE: Production static serving is registered earlier (before this IIFE) so the
      // frontend is available immediately — even before migrations complete.
      if (!isProduction) {
        await setupVite(app, httpServer);
      }

      // 4f. Global error handler (must be after routes + static)
      app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        const status = err.status || err.statusCode || 500;
        const message = err.message || "Internal Server Error";
        console.error(`[Express Error] ${status} ${message}`, err.stack || '');
        if (!res.headersSent) res.status(status).json({ message });
      });

      // 4g. All routes are registered — open API traffic
      _serverReady = true;
      console.log('[Startup] Server fully initialized — all routes active');

      // 4h. Background services & schedulers
      startSegmentService();
      warmupClip();

      // Auto-sync schedulers are PRODUCTION-only.
      // The dev server shares the production database and API credentials, so running
      // scheduled syncs in dev would cause double-processing of real orders and
      // double-deducting real BrickLink inventory.  Manual syncs triggered through
      // the UI still work in dev — only the background auto-tick is suppressed.
      if (process.env.NODE_ENV === 'production') {
        startInventorySyncScheduler();
        startPomSyncScheduler();
        startCatalogDetailScheduler();
        startCatalogScanScheduler();
        startChannelSyncScheduler();
        startOrderSyncScheduler().catch(error => console.error('Failed to start order sync scheduler:', error));
        startUniversalCatalogScheduler();
        startRebrickableSetsScheduler().catch((err: any) => console.error('Failed to start Rebrickable sets scheduler:', err));
        startForumSyncScheduler().catch(error => console.error('Failed to start forum sync scheduler:', error));
        startMarketNewsSyncScheduler().catch(error => console.error('Failed to start market news sync scheduler:', error));
        startBusinessIntelScheduler().catch(error => console.error('Failed to start business intel scheduler:', error));
        startAgentTeamSchedulers();
        startBackupScheduler();
        startEmbeddingWorker().catch(error => console.error('Failed to start embedding worker:', error));
        startImageHarvester();
      } else {
        console.log('[Dev] Auto-sync schedulers suppressed — dev server shares production DB/credentials. Use manual sync buttons in the UI.');
      }

      // 4i. Auto-resume CLIP visual catalog build (15s: segment service warm-up)
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
            console.log(`[CLIP Catalog] Auto-resuming build — ${done}/${total} embedded.`);
            const rows = await db.select({ itemNo: blInventory.itemNo, colorId: blInventory.colorId }).from(blInventory);
            const items = rows.map(r => ({ itemNo: r.itemNo, colorId: Number(r.colorId), itemType: 'PART' }));
            buildCatalogEmbeddings(items, (p) => {
              if (p.done % 100 === 0 || p.done === p.total)
                console.log(`[CLIP Catalog] ${p.done}/${p.total} embedded (${p.errors} errors)`);
            }).then((final) => {
              console.log(`[CLIP Catalog] Auto-resume complete: ${final.done} embedded, ${final.errors} errors`);
            }).catch((e) => console.error('[CLIP Catalog] Auto-resume failed:', e.message));
          } else if (total > 0) {
            console.log(`[CLIP Catalog] Catalog complete (${done}/${total}) — no resume needed`);
          }
        } catch (e: any) {
          console.error('[CLIP Catalog] Auto-resume check failed (non-fatal):', e.message);
        }
      }, 15_000);

      // 4j. Auto-resume inventory & orders vector enrichment (20s)
      setTimeout(async () => {
        try {
          const { createEmbeddingJob } = await import('./services/embedding-worker');
          const activeJobs = await db.select({ jobType: embeddingJobs.jobType }).from(embeddingJobs)
            .where(inArray(embeddingJobs.status, ['pending', 'processing']));
          const activeTypes = new Set(activeJobs.map(j => j.jobType));
          if (!activeTypes.has('inventory')) {
            const invResult = await db.execute(drizzleSqlCount`
              SELECT COUNT(*) AS count FROM bl_inventory bi
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
              SELECT COUNT(*) AS count FROM orders o
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

      // 4k. Auto-resume Universal Catalog worker (90s: CLIP model warm-up)
      setTimeout(async () => {
        try {
          const { startUniversalWorker, getUniversalCatalogState, isUniversalImporting } = await import('./services/universal-clip-catalog.js');
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
      console.error('[Startup] Background initialization error (non-fatal):', bgError.message);
    }
  })();
});

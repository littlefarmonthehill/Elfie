/**
 * Universal CLIP Catalog auto-refresh scheduler.
 *
 * Runs every 6 hours and checks whether it's time to:
 *   1. Re-import the Rebrickable parts CSV (picks up newly added BrickLink parts)
 *   2. Retry stale no_image / failed items (BrickLink adds photos over time)
 *   3. Resume the embedding worker
 *
 * Frequency is configurable per-org via appSettings.universalCatalogRefreshMonths.
 * Last-run is persisted in syncMetadata so server restarts don't reset it.
 */

import { db } from '../db';
import { appSettings, syncMetadata, PLATFORM_ORG_ID } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import {
  importFromRebrickable,
  retryStaleItems,
  startUniversalWorker,
  isUniversalImporting,
  getUniversalCatalogState,
} from './universal-clip-catalog';

const ORG_ID    = PLATFORM_ORG_ID;
const META_ID   = 'universal_catalog_refresh';
const CHECK_MS  = 6 * 60 * 60 * 1000;   // check every 6 hours

export function startUniversalCatalogScheduler() {
  console.log('🌐 Universal Catalog scheduler initialized');
  // First check after a short delay so the DB is warmed up
  setTimeout(() => checkAndRun(), 30_000);
  setInterval(() => checkAndRun(), CHECK_MS);
}

async function checkAndRun() {
  try {
    const [settings] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.orgId, ORG_ID))
      .limit(1);

    if (!settings?.universalCatalogScheduleEnabled) return;

    const refreshMonths = settings.universalCatalogRefreshMonths ?? 1;
    const retryDays     = settings.universalCatalogRetryDays     ?? 30;

    // Check last run
    const [meta] = await db
      .select()
      .from(syncMetadata)
      .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, META_ID)))
      .limit(1);

    const lastRunMs  = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;
    const intervalMs = refreshMonths * 30 * 24 * 60 * 60 * 1000;   // approximate months → ms

    if (Date.now() - lastRunMs < intervalMs) return;

    // Guard against overlapping runs
    if (isUniversalImporting() || getUniversalCatalogState()?.running) {
      console.log('[Universal Catalog Scheduler] Worker already running — skipping this cycle');
      return;
    }

    console.log(`[Universal Catalog Scheduler] Scheduled refresh starting (every ${refreshMonths} month(s), retry >${retryDays}d old)`);

    // Record start
    await upsertMeta('in_progress');

    try {
      // 1. Download latest parts list (idempotent — only inserts new rows)
      const { imported } = await importFromRebrickable();
      console.log(`[Universal Catalog Scheduler] Import complete — ${imported} new parts`);

      // 2. Reset stale items so the worker retries them
      const reset = await retryStaleItems(retryDays);
      console.log(`[Universal Catalog Scheduler] Reset ${reset} stale items to 'pending'`);

      // 3. Start embedding worker (no-op if nothing is pending)
      await startUniversalWorker();
      console.log('[Universal Catalog Scheduler] Worker started');

      await upsertMeta('success', `Imported ${imported} new parts, reset ${reset} stale`);
    } catch (err: any) {
      console.error('[Universal Catalog Scheduler] Run failed:', err.message);
      await upsertMeta('error', err.message);
    }
  } catch (err: any) {
    console.error('[Universal Catalog Scheduler] Outer error:', err.message);
  }
}

async function upsertMeta(status: string, message?: string) {
  await db.insert(syncMetadata).values({
    id:              META_ID,
    orgId:           ORG_ID,
    lastSyncStatus:  status,
    lastSyncTime:    new Date(),
    recordsAdded:    0,
    recordsUpdated:  0,
    errorMessage:    message ?? null,
  }).onConflictDoUpdate({
    target: syncMetadata.id,
    set: {
      lastSyncStatus: status,
      lastSyncTime:   new Date(),
      errorMessage:   message ?? null,
      updatedAt:      new Date(),
    },
  });
}

import { db } from "../db";
import { appSettings, syncMetadata, blInventory } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { syncBricklinkData } from "./bricklink";
import { syncLock } from "./sync-lock";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";

const ORG_ID = 'org_planetbrick';

/**
 * After each successful inventory sync, embed any items that don't yet have a
 * CLIP catalog embedding.  Runs entirely in the background — fire-and-forget.
 * The build skips already-embedded items, so this is cheap on repeat runs.
 */
async function triggerClipCatalogUpdate(): Promise<void> {
  try {
    const { buildCatalogEmbeddings } = await import('./clip-search.js');
    const rows = await db.select({ itemNo: blInventory.itemNo, colorId: blInventory.colorId }).from(blInventory);
    const items = rows.map((r) => ({ itemNo: r.itemNo, colorId: Number(r.colorId), itemType: 'PART' }));
    if (items.length === 0) return;
    const result = await buildCatalogEmbeddings(items, (p) => {
      if (p.done % 100 === 0 && p.done > 0) {
        console.log(`[CLIP Auto] ${p.done}/${p.total} catalog embeddings built (${p.errors} errors)`);
      }
    });
    if (result.done > 0) {
      console.log(`[CLIP Auto] Post-sync catalog update complete: ${result.done} new embeddings, ${result.errors} errors`);
    }
  } catch (e: any) {
    console.warn('[CLIP Auto] Post-sync catalog update failed (non-fatal):', e.message);
  }
}

const SYNC_ID = 'bricklink_inventory';
const SYNC_TYPE = 'inventory_sync';
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 5 * 60 * 1000; // 5 minutes base — each retry adds another 5 min

// In-memory retry state — resets on server restart (intentional)
const retry = { count: 0, nextAt: 0 };

export async function startInventorySyncScheduler() {
  console.log('📦 Inventory sync scheduler initialized');
  setInterval(async () => { await checkAndRunInventorySync(); }, 60 * 1000);
}

async function checkAndRunInventorySync() {
  try {
    let settingsRow: any;
    try {
      [settingsRow] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
    } catch (connErr: any) {
      if (connErr.message?.includes('Connection terminated') || connErr.code === 'ECONNRESET') {
        console.log('[Inventory] DB connection blip, retrying in 3s...');
        await new Promise(r => setTimeout(r, 3000));
        [settingsRow] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
      } else throw connErr;
    }
    const settings = settingsRow;
    if (!settings?.inventorySyncEnabled) return;

    const tz = settings.timezone || 'America/Chicago';
    const now = new Date();

    // Time-of-day gate — must have reached the scheduled time in local timezone
    const localTimeStr = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const [hStr, mStr] = localTimeStr.replace(/\u202f/g, '').split(':');
    const currentTotalMinutes = parseInt(hStr) * 60 + parseInt(mStr);
    const scheduledTime = settings.inventorySyncTime || '02:00';
    const [schedH, schedM] = scheduledTime.split(':');
    const scheduledTotalMinutes = parseInt(schedH) * 60 + parseInt(schedM);
    if (currentTotalMinutes < scheduledTotalMinutes) return;

    // Fetch last run metadata
    const [meta] = await db.select().from(syncMetadata).where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, SYNC_ID))).limit(1);
    const lastRunTs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;

    if (meta?.lastSyncStatus === 'error') {
      // Retry logic: up to MAX_RETRIES with incremental delays
      if (retry.count >= MAX_RETRIES) {
        console.log(`[Inventory] All ${MAX_RETRIES} retries exhausted — waiting for next scheduled window`);
        return;
      }
      if (Date.now() < retry.nextAt) return; // Wait for retry delay
      console.log(`[Inventory] Retrying after failure (attempt ${retry.count + 1}/${MAX_RETRIES})...`);
    } else {
      // Calendar-date dedup in local timezone — only run once per calendar day
      const todayStr = now.toLocaleDateString('en-US', { timeZone: tz });
      const lastRunStr = lastRunTs ? new Date(lastRunTs).toLocaleDateString('en-US', { timeZone: tz }) : '';
      if (todayStr === lastRunStr) { retry.count = 0; return; } // Already ran today successfully
      retry.count = 0; // Fresh day, reset retries
    }

    if (syncLock.isRunning()) {
      const blocker = syncLock.getActive().join(', ');
      console.log(`⏭️ Inventory sync skipped — blocked by: ${blocker} — will retry next minute`);
      recordSyncIssue({
        syncType: SYNC_TYPE,
        platform: 'scheduler',
        issueType: 'scheduler_blocked',
        issueDescription: `Scheduled inventory sync (${scheduledTime}) is blocked by: ${blocker}. Retrying every minute until the lock clears.`,
        severity: 'medium',
        metadata: { blockedBy: blocker, scheduledTime, timestamp: new Date().toISOString() },
      });
      return;
    }

    await runAutomatedInventorySync();
  } catch (error) {
    console.error('❌ Error in inventory sync scheduler:', error);
  }
}

async function runAutomatedInventorySync() {
  console.log('\n🔄 Starting automated inventory sync (BrickLink → Local DB)...');

  await db.insert(syncMetadata).values({
    id: SYNC_ID,
    lastSyncStatus: 'in_progress',
    lastSyncTime: new Date(),
    recordsAdded: 0,
    recordsUpdated: 0,
    orgId: ORG_ID,
  }).onConflictDoUpdate({
    target: syncMetadata.id,
    set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date(), errorMessage: null },
  });

  try {
    const result = await syncBricklinkData(ORG_ID);

    console.log(`\n✨ Automated inventory sync complete!`);
    console.log(`  📊 Inventory: ${result.inventoryAdded} added, ${result.inventoryUpdated} updated`);
    console.log(`  🔗 API Calls: ${result.totalApiCalls}`);

    await db.insert(syncMetadata).values({
      id: SYNC_ID,
      lastSyncStatus: 'success',
      lastSyncTime: new Date(),
      recordsAdded: result.inventoryAdded ?? 0,
      recordsUpdated: result.inventoryUpdated ?? 0,
      errorMessage: null,
      orgId: ORG_ID,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncStatus: 'success',
        lastSyncTime: new Date(),
        updatedAt: new Date(),
        recordsAdded: result.inventoryAdded ?? 0,
        recordsUpdated: result.inventoryUpdated ?? 0,
        errorMessage: null,
      },
    });

    retry.count = 0;
    resolveSchedulerIssues(SYNC_TYPE);

    // Fire-and-forget: embed any new items that don't have CLIP catalog embeddings yet.
    // Skips items already embedded, so this is fast on days with few new items.
    triggerClipCatalogUpdate();
  } catch (error: any) {
    if (error.message === 'Inventory sync already in progress') {
      console.log(`⏭️ Inventory sync skipped — another sync is already in progress`);
      return;
    }

    retry.count++;
    retry.nextAt = Date.now() + retry.count * RETRY_BASE_MS;
    const minsUntilRetry = retry.count * 5;
    console.error(`❌ Automated inventory sync failed (attempt ${retry.count}/${MAX_RETRIES}): ${error.message}`);
    if (retry.count < MAX_RETRIES) {
      console.log(`[Inventory] Next retry in ${minsUntilRetry} minute(s)`);
    } else {
      console.log(`[Inventory] All ${MAX_RETRIES} retries exhausted`);
    }

    await db.insert(syncMetadata).values({
      id: SYNC_ID,
      lastSyncStatus: 'error',
      lastSyncTime: new Date(),
      recordsAdded: 0,
      recordsUpdated: 0,
      errorMessage: error.message,
      orgId: ORG_ID,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: { lastSyncStatus: 'error', updatedAt: new Date(), errorMessage: error.message },
    });

    recordSyncIssue({
      syncType: SYNC_TYPE,
      platform: 'scheduler',
      issueType: 'sync_failed',
      issueDescription: `Automated inventory sync failed (attempt ${retry.count}/${MAX_RETRIES}): ${error.message}`,
      severity: 'critical',
      metadata: { error: error.message, attempt: retry.count, maxRetries: MAX_RETRIES, timestamp: new Date().toISOString() },
    });
  }
}

export function stopInventorySyncScheduler() {
  console.log('🛑 Inventory sync scheduler stopped');
}

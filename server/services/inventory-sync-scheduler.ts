import { db } from "../db";
import { appSettings, syncMetadata, blInventory } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { syncBricklinkData } from "./bricklink";
import { syncLock } from "./sync-lock";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";

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

/**
 * Return all orgs that have inventory sync enabled and have passed their scheduled time today.
 */
async function getEnabledInventorySyncOrgs(now: Date): Promise<Array<{ id: string; tz: string; scheduledTime: string }>> {
  const rows = await db.select().from(appSettings);
  return rows.filter(s => {
    if (!s.inventorySyncEnabled) return false;
    const tz = s.timezone || 'America/Chicago';
    const localTimeStr = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const [hStr, mStr] = localTimeStr.replace(/\u202f/g, '').split(':');
    const currentTotalMinutes = parseInt(hStr) * 60 + parseInt(mStr);
    const scheduledTime = s.inventorySyncTime || '02:00';
    const [schedH, schedM] = scheduledTime.split(':');
    const scheduledTotalMinutes = parseInt(schedH) * 60 + parseInt(schedM);
    return currentTotalMinutes >= scheduledTotalMinutes;
  }).map(s => ({ id: s.id, tz: s.timezone || 'America/Chicago', scheduledTime: s.inventorySyncTime || '02:00' }));
}

async function checkAndRunInventorySync() {
  try {
    const now = new Date();
    let orgs: Array<{ id: string; tz: string; scheduledTime: string }>;
    try {
      orgs = await getEnabledInventorySyncOrgs(now);
    } catch (connErr: any) {
      if (connErr.message?.includes('Connection terminated') || connErr.code === 'ECONNRESET') {
        console.log('[Inventory] DB connection blip, retrying in 3s...');
        await new Promise(r => setTimeout(r, 3000));
        orgs = await getEnabledInventorySyncOrgs(now);
      } else throw connErr;
    }

    if (orgs.length === 0) return;

    // Use the first enabled org for the platform-level metadata check (dedup/retry state)
    const primaryOrg = orgs[0];
    const tz = primaryOrg.tz;
    const scheduledTime = primaryOrg.scheduledTime;

    // Fetch last run metadata (platform-level record keyed by SYNC_ID)
    const [meta] = await db.select().from(syncMetadata).where(and(eq(syncMetadata.orgId, primaryOrg.id), eq(syncMetadata.id, SYNC_ID))).limit(1);
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

    await runAutomatedInventorySync(orgs, primaryOrg.id);
  } catch (error) {
    console.error('❌ Error in inventory sync scheduler:', error);
  }
}

async function runAutomatedInventorySync(
  orgs: Array<{ id: string; tz: string; scheduledTime: string }>,
  primaryOrgId: string,
) {
  console.log(`\n🔄 Starting automated inventory sync (BrickLink → Local DB) for ${orgs.length} org(s)...`);

  await db.insert(syncMetadata).values({
    id: SYNC_ID,
    lastSyncStatus: 'in_progress',
    lastSyncTime: new Date(),
    recordsAdded: 0,
    recordsUpdated: 0,
    orgId: primaryOrgId,
  }).onConflictDoUpdate({
    target: syncMetadata.id,
    set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date(), errorMessage: null },
  });

  try {
    let totalAdded = 0;
    let totalUpdated = 0;
    let totalApiCalls = 0;

    for (const org of orgs) {
      console.log(`  [Inventory] Syncing org: ${org.id}`);
      const result = await syncBricklinkData(org.id);
      totalAdded    += result.inventoryAdded  ?? 0;
      totalUpdated  += result.inventoryUpdated ?? 0;
      totalApiCalls += result.totalApiCalls   ?? 0;
    }

    console.log(`\n✨ Automated inventory sync complete!`);
    console.log(`  📊 Inventory: ${totalAdded} added, ${totalUpdated} updated`);
    console.log(`  🔗 API Calls: ${totalApiCalls}`);

    await db.insert(syncMetadata).values({
      id: SYNC_ID,
      lastSyncStatus: 'success',
      lastSyncTime: new Date(),
      recordsAdded: totalAdded,
      recordsUpdated: totalUpdated,
      errorMessage: null,
      orgId: primaryOrgId,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncStatus: 'success',
        lastSyncTime: new Date(),
        updatedAt: new Date(),
        recordsAdded: totalAdded,
        recordsUpdated: totalUpdated,
        errorMessage: null,
      },
    });

    retry.count = 0;
    resolveSchedulerIssues(SYNC_TYPE);

    // Fire-and-forget: embed any new items that don't have CLIP catalog embeddings yet.
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
      orgId: primaryOrgId,
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

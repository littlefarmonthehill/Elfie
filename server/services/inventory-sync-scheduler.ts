import { db } from "../db";
import { appSettings, syncMetadata, blInventory } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { syncBricklinkData } from "./bricklink";
import { syncLock } from "./sync-lock";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";
import { upsertSyncMetadata, withDbRetry } from "./order-sync-helpers";

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

const SYNC_ID   = 'bricklink_inventory';
const SYNC_TYPE = 'inventory_sync';
const MAX_RETRIES   = 5;
const RETRY_BASE_MS = 5 * 60 * 1000; // 5 minutes base — each retry adds another 5 min

// In-memory retry state — resets on server restart (intentional)
const retry = { count: 0, nextAt: 0 };

export async function startInventorySyncScheduler() {
  console.log('📦 Inventory sync scheduler initialized');
  setInterval(async () => { await checkAndRunInventorySync(); }, 60 * 1000);
}

/**
 * Return all orgs that have inventory sync enabled.
 * Interval-based: runs every N hours since the last successful run.
 */
async function getEnabledInventorySyncOrgs(): Promise<Array<{ id: string; frequencyMs: number }>> {
  const rows = await db.select().from(appSettings);
  return rows
    .filter(s => s.inventorySyncEnabled && !s.channelSyncEnabled) // orgs with channel sync get BL via the unified channel scheduler
    .map(s => ({ id: s.id, frequencyMs: (s.inventorySyncFrequency ?? 24) * 60 * 60 * 1000 }));
}

async function checkAndRunInventorySync() {
  try {
    const orgs = await withDbRetry(() => getEnabledInventorySyncOrgs());

    if (orgs.length === 0) return;

    // Use the first enabled org for the platform-level metadata check (dedup/retry state)
    const primaryOrg = orgs[0];
    const frequencyMs = primaryOrg.frequencyMs;

    // Fetch last run metadata
    const [meta] = await db.select().from(syncMetadata).where(and(eq(syncMetadata.orgId, primaryOrg.id), eq(syncMetadata.id, SYNC_ID))).limit(1);
    const lastRunTs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;

    if (meta?.lastSyncStatus === 'error') {
      // Retry logic: up to MAX_RETRIES with incremental delays
      if (retry.count >= MAX_RETRIES) {
        console.log(`[Inventory] All ${MAX_RETRIES} retries exhausted — waiting for next interval`);
        return;
      }
      if (Date.now() < retry.nextAt) return; // Wait for retry delay
      console.log(`[Inventory] Retrying after failure (attempt ${retry.count + 1}/${MAX_RETRIES})...`);
    } else {
      // Interval-based dedup: only run if enough time has elapsed since last success
      const elapsed = Date.now() - lastRunTs;
      if (lastRunTs > 0 && elapsed < frequencyMs) { retry.count = 0; return; }
      retry.count = 0;
    }

    // Check if Inventory Sync is blocked by an incompatible sync already running
    const blockers = syncLock.getBlockersFor('Inventory Sync');
    if (blockers.length > 0) {
      const blocker = blockers.join(', ');
      console.log(`⏭️ Inventory sync skipped — blocked by: ${blocker} — will retry next minute`);
      recordSyncIssue({
        syncType: SYNC_TYPE,
        platform: 'scheduler',
        issueType: 'scheduler_blocked',
        issueDescription: `Scheduled inventory sync is blocked by: ${blocker}. Retrying every minute until the lock clears.`,
        severity: 'medium',
        metadata: { blockedBy: blocker, frequencyHours: Math.round(frequencyMs / 3600000), timestamp: new Date().toISOString() },
      });
      return;
    }

    await runAutomatedInventorySync(orgs, primaryOrg.id);
  } catch (error) {
    console.error('❌ Error in inventory sync scheduler:', error);
  }
}

async function runAutomatedInventorySync(
  orgs: Array<{ id: string; frequencyMs: number }>,
  primaryOrgId: string,
) {
  console.log(`\n🔄 Starting automated inventory sync (BrickLink → Local DB) for ${orgs.length} org(s)...`);

  await upsertSyncMetadata(SYNC_ID, primaryOrgId, { status: 'in_progress' });

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

    await upsertSyncMetadata(SYNC_ID, primaryOrgId, {
      status: 'success',
      recordsAdded: totalAdded,
      recordsUpdated: totalUpdated,
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

    await upsertSyncMetadata(SYNC_ID, primaryOrgId, {
      status: 'error',
      errorMessage: error.message,
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

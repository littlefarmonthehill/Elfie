import { db } from "../db";
import { appSettings, syncMetadata, channelSyncConfig } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { syncBrickLinkToBrickOwl, defaultSyncFields, SyncFieldConfig, isChannelSyncAbortRequested } from "./brickowl";
import { syncLock } from "./sync-lock";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";
import { upsertSyncMetadata, withDbRetry } from "./order-sync-helpers";

const SYNC_ID   = 'channel_sync';
const SYNC_TYPE = 'channel_sync';
const MAX_RETRIES   = 5;
const RETRY_BASE_MS = 5 * 60 * 1000;

const retry = { count: 0, nextAt: 0 };

let channelSyncProgress: { processed: number; total: number; phase: 'idle' | 'fetching' | 'syncing' } = { processed: 0, total: 0, phase: 'idle' };

interface ChannelSyncLastResult {
  completedAt: string;
  mode: string;
  status: 'success' | 'partial' | 'error';
  lotsCreated: number;
  lotsUpdated: number;
  lotsSkipped: number;
  totalApiCalls: number;
  errorCount: number;
  errors: string[];
}
let channelSyncLastResult: ChannelSyncLastResult | null = null;

export function getChannelSyncIsRunning() {
  return syncLock.getActive().includes('Channel Sync');
}

export function getChannelSyncProgress() {
  return { ...channelSyncProgress };
}

export function getChannelSyncLastResult() {
  return channelSyncLastResult ? { ...channelSyncLastResult } : null;
}

/**
 * Return the first org that has channel sync enabled.
 * Interval-based: runs every N hours since the last successful run.
 */
async function getActiveChannelSyncOrg(): Promise<{ id: string; tz: string; frequencyMs: number } | null> {
  const rows = await db.select().from(appSettings);
  for (const s of rows) {
    if (!s.channelSyncEnabled) continue;
    const tz = s.timezone || 'America/Chicago';
    const frequencyMs = (s.channelSyncFrequency ?? 4) * 60 * 60 * 1000;
    return { id: s.id, tz, frequencyMs };
  }
  return null;
}

export async function startChannelSyncScheduler() {
  console.log('🌐 Channel sync scheduler initialized');
  // Restore last sync result from DB so the UI shows data after a deploy
  try {
    const rows = await db.select().from(appSettings);
    const firstOrg = rows.find(r => r.channelSyncEnabled) ?? rows[0];
    if (firstOrg) {
      const [meta] = await db.select().from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, firstOrg.id), eq(syncMetadata.id, SYNC_ID))).limit(1);
      if (meta?.lastSyncMetaJson) {
        channelSyncLastResult = JSON.parse(meta.lastSyncMetaJson);
        console.log('[Channel] Restored last sync result from DB');
      }
    }
  } catch (e: any) {
    console.warn('[Channel] Could not restore last sync result (non-fatal):', e.message);
  }
  setInterval(async () => { await checkAndRunChannelSync(); }, 60 * 1000);
}

async function checkAndRunChannelSync() {
  try {
    const now = new Date();
    const activeOrg = await withDbRetry(() => getActiveChannelSyncOrg());

    if (!activeOrg) return;

    const { id: orgId, tz, frequencyMs } = activeOrg;

    const [meta] = await db.select().from(syncMetadata).where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, SYNC_ID))).limit(1);
    const lastRunTs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;

    if (meta?.lastSyncStatus === 'error') {
      if (retry.count >= MAX_RETRIES) {
        console.log(`[Channel] All ${MAX_RETRIES} retries exhausted — waiting for next interval`);
        return;
      }
      if (Date.now() < retry.nextAt) return;
      console.log(`[Channel] Retrying after failure (attempt ${retry.count + 1}/${MAX_RETRIES})...`);
    } else {
      // Interval-based dedup: only run if enough time has elapsed since last success
      const elapsed = Date.now() - lastRunTs;
      if (lastRunTs > 0 && elapsed < frequencyMs) { retry.count = 0; return; }
      retry.count = 0;
    }

    // Single lock check: covers both "already running" and "blocked by another sync"
    const blockers = syncLock.getBlockersFor('Channel Sync');
    if (blockers.length > 0) {
      if (blockers.includes('Channel Sync')) {
        console.log('⏭️ Channel sync already in progress, skipping this cycle');
      } else {
        const blocker = blockers.join(', ');
        console.log(`⏭️ Channel sync blocked by: ${blocker} — will retry next minute`);
        recordSyncIssue({
          syncType: SYNC_TYPE,
          platform: 'scheduler',
          issueType: 'scheduler_blocked',
          issueDescription: `Scheduled channel sync is blocked by: ${blocker}. Retrying every minute.`,
          severity: 'medium',
          metadata: { blockedBy: blocker, frequencyHours: Math.round(frequencyMs / 3600000), timestamp: new Date().toISOString() },
        });
      }
      return;
    }

    // Warn if the most recent BL inventory sync is stale (older than the channel sync frequency)
    try {
      const [invMeta] = await db.select().from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, 'bricklink_inventory'))).limit(1);
      if (invMeta?.lastSyncStatus === 'error') {
        console.warn('[Channel] ⚠️  BrickLink inventory sync last failed — channel sync may use stale inventory data');
        recordSyncIssue({
          syncType: SYNC_TYPE,
          platform: 'scheduler',
          issueType: 'stale_source_data',
          issueDescription: `Channel sync is running but the last BrickLink inventory sync failed. BrickOwl quantities and prices may not reflect the latest inventory state.`,
          severity: 'high',
          metadata: { inventorySyncStatus: 'error', inventorySyncError: invMeta.errorMessage, timestamp: new Date().toISOString() },
        });
      }
    } catch (e: any) {
      console.warn('[Channel] Could not check inventory sync status (non-fatal):', e.message);
    }

    // Scheduled syncs always run a full comparison against BrickOwl.
    // BrickOwl is not the source of truth — manual edits made directly on BO
    // (price, qty, notes) are invisible to an incremental scan because the
    // corresponding BL item's updatedAt hasn't changed.  A full scan is the
    // only way to guarantee BO stays consistent with BL on every scheduled run.
    // Note: the BrickOwl inventory fetch is always full regardless (there is no
    // incremental list API), so the extra cost over incremental is just an
    // in-memory DB read with no additional API calls.
    await runScheduledChannelSync(true, orgId);
  } catch (error) {
    console.error('❌ Error in channel sync scheduler:', error);
  }
}

export async function runChannelSync(forceFullScan = false) {
  // Find the first enabled org to run the sync for
  const rows = await db.select().from(appSettings);
  const orgId = rows.find(r => r.channelSyncEnabled)?.id ?? rows[0]?.id;
  return runScheduledChannelSync(forceFullScan, orgId);
}

async function runScheduledChannelSync(forceFullScan = false, orgId?: string) {
  if (!syncLock.acquire('Channel Sync')) {
    console.log('⏭️ Scheduled channel sync skipped — another sync is running');
    return;
  }
  console.log('\n🌐 Starting scheduled channel sync (Local DB → BrickOwl)...');

  // Read last successful sync time BEFORE writing in_progress so the
  // incremental filter correctly scopes to items changed since that run.
  let sinceTime: Date | undefined;
  try {
    const whereClause = orgId
      ? and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, SYNC_ID))
      : eq(syncMetadata.id, SYNC_ID);
    const [prevMeta] = await db.select().from(syncMetadata).where(whereClause).limit(1);
    if (!forceFullScan && prevMeta?.lastSyncStatus === 'success' && prevMeta.lastSyncTime) {
      sinceTime = new Date(prevMeta.lastSyncTime);
      console.log(`[Channel] Incremental mode: processing BL items changed since ${sinceTime.toISOString()}`);
    } else {
      console.log(`[Channel] Full sync mode: ${forceFullScan ? 'forced full scan' : 'no prior successful sync'} — comparing all BL items`);
    }
  } catch { /* non-fatal — default to full sync */ }

  const effectiveOrgId = orgId ?? '';
  await upsertSyncMetadata(SYNC_ID, effectiveOrgId, { status: 'in_progress' });

  try {
    // Read sync mode + field config from org settings
    let syncMode: 'analysis' | 'full_control' | 'matched_sync' = 'full_control';
    let syncFields: SyncFieldConfig = { ...defaultSyncFields };
    if (orgId) {
      try {
        const [settingsForMode] = await db.select().from(appSettings).where(eq(appSettings.id, orgId)).limit(1);
        const m = settingsForMode?.channelSyncMode;
        if (m === 'matched_sync' || m === 'quantity_only') syncMode = 'matched_sync';
        else if (m === 'analysis') syncMode = 'analysis';
      } catch { /* default to full_control */ }
      try {
        const [cfgRow] = await db.select().from(channelSyncConfig).where(eq(channelSyncConfig.orgId, orgId)).limit(1);
        if (cfgRow) syncFields = {
          price:        cfgRow.syncPrice,
          remarks:      cfgRow.syncRemarks,
          description:  cfgRow.syncDescription,
          tierPrice:    cfgRow.syncTierPrice,
          salePercent:  cfgRow.syncSalePercent,
          bulkQty:      cfgRow.syncBulkQty,
          lotWeight:    cfgRow.syncLotWeight,
          stockroomModes: (cfgRow.syncStockroomModes as Record<string, 'skip'|'hidden'|'active'>) ?? { A: 'skip', B: 'skip', C: 'skip' },
        };
      } catch { /* use defaults */ }
    }

    channelSyncProgress = { processed: 0, total: 0, phase: 'fetching' };
    const result = await syncBrickLinkToBrickOwl(undefined, syncMode, (processed, total) => {
      channelSyncProgress = { processed, total, phase: 'syncing' };
    }, syncFields, sinceTime, orgId);
    const wasAborted = isChannelSyncAbortRequested();
    const hasErrors = result.errors.length > 0;
    const status: 'success' | 'partial' | 'error' = wasAborted || hasErrors ? 'partial' : 'success';
    const completionNote = wasAborted ? '(stopped by user)' : '';
    console.log(`\n✨ Channel sync ${wasAborted ? 'stopped' : 'complete'}! ${result.lotsCreated} created, ${result.lotsUpdated} updated, ${result.lotsSkipped} skipped, ${result.errors.length} errors (mode: ${syncMode}) ${completionNote}`);

    channelSyncLastResult = {
      completedAt: new Date().toISOString(),
      mode: syncMode,
      status,
      lotsCreated: result.lotsCreated,
      lotsUpdated: result.lotsUpdated,
      lotsSkipped: result.lotsSkipped,
      totalApiCalls: result.totalApiCalls,
      errorCount: result.errors.length,
      errors: result.errors.slice(0, 20),
    };

    await upsertSyncMetadata(SYNC_ID, effectiveOrgId, {
      status,
      recordsAdded: result.lotsCreated,
      recordsUpdated: result.lotsUpdated,
      errorMessage: hasErrors ? `${result.errors.length} lots failed` : null,
      lastSyncMetaJson: JSON.stringify(channelSyncLastResult),
    });

    retry.count = 0;
    resolveSchedulerIssues(SYNC_TYPE);
  } catch (error: any) {
    retry.count++;
    retry.nextAt = Date.now() + retry.count * RETRY_BASE_MS;
    const minsUntilRetry = retry.count * 5;
    console.error(`❌ Scheduled channel sync failed (attempt ${retry.count}/${MAX_RETRIES}): ${error.message}`);
    if (retry.count < MAX_RETRIES) {
      console.log(`[Channel] Next retry in ${minsUntilRetry} minute(s)`);
    } else {
      console.log(`[Channel] All ${MAX_RETRIES} retries exhausted`);
    }

    await upsertSyncMetadata(SYNC_ID, effectiveOrgId, {
      status: 'error',
      errorMessage: error.message,
    });

    recordSyncIssue({
      syncType: SYNC_TYPE,
      platform: 'scheduler',
      issueType: 'sync_failed',
      issueDescription: `Scheduled channel sync failed (attempt ${retry.count}/${MAX_RETRIES}): ${error.message}`,
      severity: 'high',
      metadata: { error: error.message, attempt: retry.count, maxRetries: MAX_RETRIES, timestamp: new Date().toISOString() },
    });
  } finally {
    channelSyncProgress = { processed: 0, total: 0, phase: 'idle' };
    syncLock.release('Channel Sync');
  }
}

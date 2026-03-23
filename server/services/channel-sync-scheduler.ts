import { db } from "../db";
import { appSettings, syncMetadata, channelSyncConfig } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { syncBrickLinkToBrickOwl, defaultSyncFields, SyncFieldConfig, isChannelSyncAbortRequested } from "./brickowl";
import { syncLock } from "./sync-lock";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";

const ORG_ID = 'org_planetbrick';

const SYNC_TYPE = 'channel_sync';
const MAX_RETRIES = 5;
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

export async function startChannelSyncScheduler() {
  console.log('🌐 Channel sync scheduler initialized');
  // Restore last sync result from DB so the UI shows data after a deploy
  try {
    const [meta] = await db.select().from(syncMetadata)
      .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, 'channel_sync'))).limit(1);
    if ((meta as any)?.lastSyncMetaJson) {
      channelSyncLastResult = JSON.parse((meta as any).lastSyncMetaJson);
      console.log('[Channel] Restored last sync result from DB');
    }
  } catch (e: any) {
    console.warn('[Channel] Could not restore last sync result (non-fatal):', e.message);
  }
  setInterval(async () => { await checkAndRunChannelSync(); }, 60 * 1000);
}

async function checkAndRunChannelSync() {
  try {
    let settingsRow: any;
    try {
      [settingsRow] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
    } catch (connErr: any) {
      if (connErr.message?.includes('Connection terminated') || connErr.code === 'ECONNRESET') {
        console.log('[Channel] DB connection blip, retrying in 3s...');
        await new Promise(r => setTimeout(r, 3000));
        [settingsRow] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
      } else throw connErr;
    }
    const settings = settingsRow;
    if (!settings?.channelSyncEnabled) return;

    const tz = settings.timezone || 'America/Chicago';
    const now = new Date();

    // Time-of-day gate
    const localTimeStr = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const [hStr, mStr] = localTimeStr.replace(/\u202f/g, '').split(':');
    const currentTotalMinutes = parseInt(hStr) * 60 + parseInt(mStr);
    const scheduledTime = settings.channelSyncTime || '03:00';
    const [schedH, schedM] = scheduledTime.split(':');
    const scheduledTotalMinutes = parseInt(schedH) * 60 + parseInt(schedM);
    if (currentTotalMinutes < scheduledTotalMinutes) return;

    const [meta] = await db.select().from(syncMetadata).where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, 'channel_sync'))).limit(1);
    const lastRunTs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;

    if (meta?.lastSyncStatus === 'error') {
      if (retry.count >= MAX_RETRIES) {
        console.log(`[Channel] All ${MAX_RETRIES} retries exhausted — waiting for next scheduled window`);
        return;
      }
      if (Date.now() < retry.nextAt) return;
      console.log(`[Channel] Retrying after failure (attempt ${retry.count + 1}/${MAX_RETRIES})...`);
    } else {
      // Calendar-date dedup in local timezone
      const todayStr = now.toLocaleDateString('en-US', { timeZone: tz });
      const lastRunStr = lastRunTs ? new Date(lastRunTs).toLocaleDateString('en-US', { timeZone: tz }) : '';
      if (todayStr === lastRunStr) { retry.count = 0; return; }
      retry.count = 0;
    }

    if (getChannelSyncIsRunning()) {
      console.log('⏭️ Channel sync already in progress, skipping this cycle');
      return;
    }

    // Warn if today's BL inventory sync failed — channel sync will still run but
    // BrickOwl data may not reflect the latest inventory state.
    try {
      const [invMeta] = await db.select().from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, 'bricklink_inventory'))).limit(1);
      if (invMeta?.lastSyncStatus === 'error' && invMeta.lastSyncTime) {
        const todayStr = now.toLocaleDateString('en-US', { timeZone: tz });
        const invDateStr = new Date(invMeta.lastSyncTime).toLocaleDateString('en-US', { timeZone: tz });
        if (todayStr === invDateStr) {
          console.warn('[Channel] ⚠️  BrickLink inventory sync failed today — channel sync will run with yesterday\'s inventory data');
          recordSyncIssue({
            syncType: SYNC_TYPE,
            platform: 'scheduler',
            issueType: 'stale_source_data',
            issueDescription: `Channel sync is running but today's BrickLink inventory sync failed. BrickOwl quantities and prices may not reflect the latest inventory state.`,
            severity: 'high',
            metadata: { inventorySyncStatus: 'error', inventorySyncError: invMeta.errorMessage, timestamp: new Date().toISOString() },
          });
        }
      }
    } catch (e: any) {
      console.warn('[Channel] Could not check inventory sync status (non-fatal):', e.message);
    }

    if (syncLock.isRunning()) {
      const blocker = syncLock.getActive().join(', ');
      console.log(`⏭️ Channel sync blocked by: ${blocker} — will retry next minute`);
      recordSyncIssue({
        syncType: SYNC_TYPE,
        platform: 'scheduler',
        issueType: 'scheduler_blocked',
        issueDescription: `Scheduled channel sync (${scheduledTime}) is blocked by: ${blocker}. Retrying every minute.`,
        severity: 'medium',
        metadata: { blockedBy: blocker, scheduledTime, timestamp: new Date().toISOString() },
      });
      return;
    }

    await runScheduledChannelSync();
  } catch (error) {
    console.error('❌ Error in channel sync scheduler:', error);
  }
}

export async function runChannelSync(forceFullScan = false) {
  return runScheduledChannelSync(forceFullScan);
}

async function runScheduledChannelSync(forceFullScan = false) {
  if (!syncLock.acquire('Channel Sync')) {
    console.log('⏭️ Scheduled channel sync skipped — another sync is running');
    return;
  }
  console.log('\n🌐 Starting scheduled channel sync (Local DB → BrickOwl)...');

  // Read last successful sync time BEFORE writing in_progress so the
  // incremental filter correctly scopes to items changed since that run.
  let sinceTime: Date | undefined;
  try {
    const [prevMeta] = await db.select().from(syncMetadata)
      .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, 'channel_sync'))).limit(1);
    if (!forceFullScan && prevMeta?.lastSyncStatus === 'success' && prevMeta.lastSyncTime) {
      sinceTime = new Date(prevMeta.lastSyncTime);
      console.log(`[Channel] Incremental mode: processing BL items changed since ${sinceTime.toISOString()}`);
    } else {
      console.log(`[Channel] Full sync mode: ${forceFullScan ? 'forced full scan' : 'no prior successful sync'} — comparing all BL items`);
    }
  } catch { /* non-fatal — default to full sync */ }

  await db.insert(syncMetadata).values({
    id: 'channel_sync',
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
    // Read sync mode + field config from settings
    let syncMode: 'analysis' | 'full_control' | 'matched_sync' = 'full_control';
    let syncFields: SyncFieldConfig = { ...defaultSyncFields };
    try {
      const [settingsForMode] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
      const m = settingsForMode?.channelSyncMode;
      if (m === 'matched_sync' || m === 'quantity_only') syncMode = 'matched_sync'; // quantity_only is legacy name
      else if (m === 'analysis') syncMode = 'analysis';
    } catch { /* default to full_control */ }
    try {
      const [cfgRow] = await db.select().from(channelSyncConfig).where(eq(channelSyncConfig.orgId, ORG_ID)).limit(1);
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

    channelSyncProgress = { processed: 0, total: 0, phase: 'fetching' };
    const result = await syncBrickLinkToBrickOwl(undefined, syncMode, (processed, total) => {
      channelSyncProgress = { processed, total, phase: 'syncing' };
    }, syncFields, sinceTime);
    const wasAborted = isChannelSyncAbortRequested();
    const hasErrors = result.errors.length > 0;
    const status = wasAborted ? 'partial' : hasErrors ? 'partial' : 'success';
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
      errors: result.errors.slice(0, 20), // keep first 20 for display
    };

    const metaJson = JSON.stringify(channelSyncLastResult);
    await db.insert(syncMetadata).values({
      id: 'channel_sync',
      lastSyncStatus: status,
      lastSyncTime: new Date(),
      recordsAdded: result.lotsCreated,
      recordsUpdated: result.lotsUpdated,
      errorMessage: hasErrors ? `${result.errors.length} lots failed` : null,
      orgId: ORG_ID,
    } as any).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncStatus: status,
        updatedAt: new Date(),
        recordsAdded: result.lotsCreated,
        recordsUpdated: result.lotsUpdated,
        errorMessage: hasErrors ? `${result.errors.length} lots failed` : null,
        lastSyncMetaJson: metaJson,
      } as any,
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

    await db.insert(syncMetadata).values({
      id: 'channel_sync',
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
      issueDescription: `Scheduled channel sync failed (attempt ${retry.count}/${MAX_RETRIES}): ${error.message}`,
      severity: 'high',
      metadata: { error: error.message, attempt: retry.count, maxRetries: MAX_RETRIES, timestamp: new Date().toISOString() },
    });
  } finally {
    channelSyncProgress = { processed: 0, total: 0, phase: 'idle' };
    syncLock.release('Channel Sync');
  }
}

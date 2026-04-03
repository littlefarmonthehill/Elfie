import { db } from "../db";
import { appSettings, syncMetadata, channelSyncConfig } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { isChannelSyncAbortRequested, SyncUpdatedItem } from "./brickowl";
import { getChannelAdapter } from "./channel-factory";
import { syncLock } from "./sync-lock";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";
import { upsertSyncMetadata, withDbRetry } from "./order-sync-helpers";
import { syncBricklinkData } from "./bricklink";

const SYNC_ID   = 'channel_sync';
const SYNC_TYPE = 'channel_sync';
const MAX_RETRIES   = 5;
const RETRY_BASE_MS = 5 * 60 * 1000;

const retry = { count: 0, nextAt: 0 };

// Per-channel progress map — each channel updates its own slot independently
const channelSyncProgress: Record<string, { processed: number; total: number; phase: 'idle' | 'fetching' | 'syncing' }> = {};

interface ChannelResult {
  lotsCreated: number;
  lotsUpdated: number;
  lotsSkipped: number;
  errorCount: number;
  errors: string[];
  status: 'success' | 'partial' | 'error';
  updatedItems?: SyncUpdatedItem[];
}

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
  updatedItems?: SyncUpdatedItem[];
  perChannel: Record<string, ChannelResult>;
}
let channelSyncLastResult: ChannelSyncLastResult | null = null;

export function getChannelSyncIsRunning() {
  return syncLock.getActive().includes('Channel Sync');
}

export function getChannelSyncProgress(channel?: string) {
  if (channel) {
    return channelSyncProgress[channel] ?? { processed: 0, total: 0, phase: 'idle' };
  }
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

/**
 * Return all channel keys that have a config row for this org.
 * Falls back to ['brickowl'] so behaviour is unchanged for existing orgs.
 */
async function getConfiguredChannelKeys(orgId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ channelKey: channelSyncConfig.channelKey })
      .from(channelSyncConfig)
      .where(eq(channelSyncConfig.orgId, orgId));
    const keys = rows.map(r => r.channelKey).filter(Boolean);
    return keys.length > 0 ? keys : ['brickowl'];
  } catch {
    return ['brickowl'];
  }
}

export async function startChannelSyncScheduler() {
  console.log('🌐 Channel sync scheduler initialized');
  // Restore last sync result from DB so the UI shows data after a deploy.
  try {
    const [meta] = await db.select().from(syncMetadata)
      .where(eq(syncMetadata.id, SYNC_ID)).limit(1);
    if (meta?.lastSyncMetaJson) {
      channelSyncLastResult = JSON.parse(meta.lastSyncMetaJson);
      console.log('[Channel] Restored last sync result from DB');
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
      const elapsed = Date.now() - lastRunTs;
      if (lastRunTs > 0 && elapsed < frequencyMs) { retry.count = 0; return; }
      retry.count = 0;
    }

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

    // Warn if the most recent BL inventory sync is stale
    try {
      const [invMeta] = await db.select().from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, 'bricklink_inventory'))).limit(1);
      if (invMeta?.lastSyncStatus === 'error') {
        console.warn('[Channel] ⚠️  BrickLink inventory sync last failed — channel sync may use stale inventory data');
        recordSyncIssue({
          syncType: SYNC_TYPE,
          platform: 'scheduler',
          issueType: 'stale_source_data',
          issueDescription: `Channel sync is running but the last BrickLink inventory sync failed. Channel quantities and prices may not reflect the latest inventory state.`,
          severity: 'high',
          metadata: { inventorySyncStatus: 'error', inventorySyncError: invMeta.errorMessage, timestamp: new Date().toISOString() },
        });
      }
    } catch (e: any) {
      console.warn('[Channel] Could not check inventory sync status (non-fatal):', e.message);
    }

    await runScheduledChannelSync(true, orgId);
  } catch (error) {
    console.error('❌ Error in channel sync scheduler:', error);
  }
}

export async function runChannelSync(forceFullScan = false) {
  const rows = await db.select().from(appSettings);
  const orgId = rows.find(r => r.channelSyncEnabled)?.id ?? rows[0]?.id;
  return runScheduledChannelSync(forceFullScan, orgId);
}

export async function runChannelSyncForOrg(orgId: string, forceFullScan = false, targetChannel?: string) {
  return runScheduledChannelSync(forceFullScan, orgId, targetChannel);
}

async function runScheduledChannelSync(forceFullScan = false, orgId?: string, targetChannel?: string) {
  if (!syncLock.acquire('Channel Sync')) {
    console.log('⏭️ Scheduled channel sync skipped — another sync is running');
    return;
  }

  const effectiveOrgId = orgId ?? '';

  // Read sync mode from org settings (shared across all channels for now)
  let syncMode: 'analysis' | 'full_control' | 'matched_sync' = 'full_control';
  if (orgId) {
    try {
      const [settingsForMode] = await db.select().from(appSettings).where(eq(appSettings.id, orgId)).limit(1);
      const m = settingsForMode?.channelSyncMode;
      if (m === 'matched_sync' || m === 'quantity_only') syncMode = 'matched_sync';
      else if (m === 'analysis') syncMode = 'analysis';
    } catch { /* default to full_control */ }
  }

  // Discover which channels are configured for this org
  let channelKeys = orgId ? await getConfiguredChannelKeys(orgId) : ['brickowl'];
  // If a specific channel was requested (manual sync from a single tile), run only that one
  if (targetChannel) {
    channelKeys = channelKeys.filter(k => k === targetChannel);
    if (channelKeys.length === 0) {
      console.warn(`[Channel] targetChannel "${targetChannel}" not in configured channels — nothing to sync`);
    }
  }
  // A targeted manual sync (single channel tile) skips the BrickLink SoT refresh —
  // that step is the scheduler's responsibility and runs on the org's configured frequency.
  // Manual per-channel syncs push from whatever is already in the local DB.
  const isManualPerChannel = !!targetChannel;

  console.log(`\n🌐 Starting ${isManualPerChannel ? 'manual' : 'scheduled'} channel sync for ${channelKeys.length} channel(s): ${channelKeys.join(', ')} (mode: ${syncMode}${targetChannel ? `, targeted: ${targetChannel}` : ''})`);

  await upsertSyncMetadata(SYNC_ID, effectiveOrgId, { status: 'in_progress' });

  // Aggregate totals across all channels
  let totalCreated = 0, totalUpdated = 0, totalSkipped = 0, totalApiCalls = 0;
  const allErrors: string[] = [];
  let anyAborted = false;
  let lastUpdatedItems: SyncUpdatedItem[] | undefined;
  const perChannel: Record<string, ChannelResult> = {};

  try {
    // Read last successful sync time for incremental mode.
    // For targeted channel syncs, use that channel's own metadata so its incremental
    // window is independent from the global channel_sync timestamp.
    let sinceTime: Date | undefined;
    try {
      const metaId = isManualPerChannel ? `channel_sync_${targetChannel}` : SYNC_ID;
      const whereClause = orgId
        ? and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, metaId))
        : eq(syncMetadata.id, metaId);
      const [prevMeta] = await db.select().from(syncMetadata).where(whereClause).limit(1);
      if (!forceFullScan && prevMeta?.lastSyncStatus === 'success' && prevMeta.lastSyncTime) {
        sinceTime = new Date(prevMeta.lastSyncTime);
        console.log(`[Channel] Incremental mode: processing BL items changed since ${sinceTime.toISOString()}`);
      } else {
        console.log(`[Channel] Full sync mode: ${forceFullScan ? 'forced full scan' : 'no prior successful sync'}`);
      }
    } catch { /* non-fatal — default to full sync */ }

    // ── Step 0: BrickLink inventory sync (source of truth) ──
    // Runs only during the auto-scheduler's full sweep. Manual per-channel triggers
    // push from existing local DB data — BL refresh is the scheduler's responsibility.
    if (!isManualPerChannel) {
      console.log('[Channel] → Step 0: BrickLink inventory sync (source of truth)');
      await upsertSyncMetadata('bricklink_inventory', effectiveOrgId, { status: 'in_progress' });
      try {
        const blResult = await syncBricklinkData(effectiveOrgId);
        const blAdded   = blResult.inventoryAdded   ?? 0;
        const blUpdated = blResult.inventoryUpdated  ?? 0;
        console.log(`[Channel] ✓ BrickLink: ${blAdded} added, ${blUpdated} updated`);
        await upsertSyncMetadata('bricklink_inventory', effectiveOrgId, {
          status: 'success',
          recordsAdded:   blAdded,
          recordsUpdated: blUpdated,
        });
      } catch (blErr: any) {
        const alreadyRunning = blErr.message?.includes('already in progress');
        console.error('[Channel] ✗ BrickLink inventory sync failed:', blErr.message);
        if (alreadyRunning) {
          console.log('[Channel] BL sync lock collision — continuing channel push with existing DB data');
        } else {
          await upsertSyncMetadata('bricklink_inventory', effectiveOrgId, {
            status: 'error',
            errorMessage: blErr.message,
          });
        }
        // Continue with channel syncs using existing local DB data — do not abort
        allErrors.push(`[bricklink] ${blErr.message}`);
      }
    }

    for (const channelKey of channelKeys) {
      let adapter;
      try {
        adapter = getChannelAdapter(channelKey);
      } catch (e: any) {
        console.warn(`[Channel] No adapter for "${channelKey}" — skipping`);
        allErrors.push(`${channelKey}: no adapter registered`);
        continue;
      }

      console.log(`[Channel] → Syncing channel: ${channelKey}`);
      // Mark this channel as in_progress in DB immediately so its tile shows "syncing"
      await upsertSyncMetadata(`channel_sync_${channelKey}`, effectiveOrgId, { status: 'in_progress' });
      channelSyncProgress[channelKey] = { processed: 0, total: 0, phase: 'fetching' };
      try {
        const result = await adapter.syncFromBrickLink(effectiveOrgId, {
          mode: syncMode,
          fullScan: forceFullScan || !sinceTime,
          sinceTime,
          onProgress: (processed, total) => {
            channelSyncProgress[channelKey] = { processed, total, phase: 'syncing' };
          },
        });

        totalCreated   += result.lotsCreated;
        totalUpdated   += result.lotsUpdated;
        totalSkipped   += result.lotsSkipped;
        totalApiCalls  += result.totalApiCalls;
        const channelErrors = result.errors.map(e => `[${channelKey}] ${e}`);
        allErrors.push(...channelErrors);

        // Carry updatedItems from BrickOwl (UI-facing, channel-specific for now)
        const channelUpdatedItems = channelKey === 'brickowl' && (result as any).updatedItems
          ? (result as any).updatedItems
          : undefined;
        if (channelUpdatedItems) lastUpdatedItems = channelUpdatedItems;

        const wasAborted = channelKey === 'brickowl' ? isChannelSyncAbortRequested() : false;
        if (wasAborted) anyAborted = true;

        const channelStatus = result.errors.length > 0 || wasAborted ? 'partial' : 'success';
        perChannel[channelKey] = {
          lotsCreated: result.lotsCreated,
          lotsUpdated: result.lotsUpdated,
          lotsSkipped: result.lotsSkipped,
          errorCount:  result.errors.length,
          errors:      result.errors.slice(0, 10),
          status:      channelStatus,
          updatedItems: channelUpdatedItems,
        };

        // Write per-channel metadata so each channel tile shows its own stats
        await upsertSyncMetadata(`channel_sync_${channelKey}`, effectiveOrgId, {
          status:         channelStatus,
          recordsAdded:   result.lotsCreated,
          recordsUpdated: result.lotsUpdated,
          errorMessage:   result.errors.length > 0 ? result.errors.slice(0, 3).join('; ') : null,
        });
        // Clear this channel's progress slot — it's done
        channelSyncProgress[channelKey] = { processed: 0, total: 0, phase: 'idle' };

        console.log(`[Channel] ✓ ${channelKey}: ${result.lotsCreated} created, ${result.lotsUpdated} updated, ${result.lotsSkipped} skipped, ${result.errors.length} errors`);
      } catch (chanErr: any) {
        console.error(`[Channel] ✗ ${channelKey} sync failed:`, chanErr.message);
        console.error(`[Channel] ✗ ${channelKey} stack:`, chanErr.stack);
        allErrors.push(`[${channelKey}] ${chanErr.message}`);
        perChannel[channelKey] = {
          lotsCreated: 0,
          lotsUpdated: 0,
          lotsSkipped: 0,
          errorCount:  1,
          errors:      [chanErr.message],
          status:      'error',
        };
        await upsertSyncMetadata(`channel_sync_${channelKey}`, effectiveOrgId, {
          status:       'error',
          errorMessage: chanErr.message,
        });
        channelSyncProgress[channelKey] = { processed: 0, total: 0, phase: 'idle' };
      }
    }

    const hasErrors = allErrors.length > 0;
    const status: 'success' | 'partial' | 'error' = anyAborted || hasErrors ? 'partial' : 'success';
    const completionNote = anyAborted ? '(stopped by user)' : '';
    console.log(`\n✨ Channel sync ${anyAborted ? 'stopped' : 'complete'}! ${totalCreated} created, ${totalUpdated} updated, ${totalSkipped} skipped, ${allErrors.length} errors ${completionNote}`);

    channelSyncLastResult = {
      completedAt: new Date().toISOString(),
      mode: syncMode,
      status,
      lotsCreated:   totalCreated,
      lotsUpdated:   totalUpdated,
      lotsSkipped:   totalSkipped,
      totalApiCalls,
      errorCount:    allErrors.length,
      errors:        allErrors.slice(0, 20),
      updatedItems:  lastUpdatedItems,
      perChannel,
    };

    await upsertSyncMetadata(SYNC_ID, effectiveOrgId, {
      status,
      recordsAdded:    totalCreated,
      recordsUpdated:  totalUpdated,
      errorMessage:    hasErrors ? `${allErrors.length} lots failed` : null,
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
    syncLock.release('Channel Sync');
  }
}

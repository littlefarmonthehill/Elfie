import { db } from "../db";
import { appSettings, syncMetadata, PLATFORM_ORG_ID } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { syncBrickLinkToBrickOwl } from "./brickowl";
import { syncLock } from "./sync-lock";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";

const ORG_ID = PLATFORM_ORG_ID;

const SYNC_TYPE = 'channel_sync';
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 5 * 60 * 1000;

const retry = { count: 0, nextAt: 0 };

export function getChannelSyncIsRunning() {
  return syncLock.getActive().includes('Channel Sync');
}

export async function startChannelSyncScheduler() {
  console.log('🌐 Channel sync scheduler initialized');
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

    if (syncLock.isRunning()) {
      const blocker = syncLock.getActive().join(', ');
      console.log(`⏭️ Channel sync blocked by: ${blocker} — will retry next minute`);
      recordSyncIssue({
        syncType: SYNC_TYPE,
        platform: 'scheduler',
        issueType: 'scheduler_blocked',
        issueDescription: `Scheduled channel sync (${scheduledTime}) is blocked by: ${blocker}. Retrying every minute.`,
        severity: 'high',
        metadata: { blockedBy: blocker, scheduledTime, timestamp: new Date().toISOString() },
      });
      return;
    }

    await runScheduledChannelSync();
  } catch (error) {
    console.error('❌ Error in channel sync scheduler:', error);
  }
}

export async function runChannelSync() {
  return runScheduledChannelSync();
}

async function runScheduledChannelSync() {
  if (!syncLock.acquire('Channel Sync')) {
    console.log('⏭️ Scheduled channel sync skipped — another sync is running');
    return;
  }
  console.log('\n🌐 Starting scheduled channel sync (Local DB → BrickOwl)...');

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
    // Read sync mode from settings
    let syncMode: 'full_control' | 'quantity_only' = 'full_control';
    try {
      const [settingsForMode] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
      if (settingsForMode?.channelSyncMode === 'quantity_only') syncMode = 'quantity_only';
    } catch { /* default to full_control */ }

    const result = await syncBrickLinkToBrickOwl(undefined, syncMode);
    const hasErrors = result.errors.length > 0;
    const status = hasErrors ? 'partial' : 'success';
    console.log(`\n✨ Channel sync complete! ${result.lotsCreated} created, ${result.lotsUpdated} updated, ${result.lotsSkipped} skipped, ${result.errors.length} errors (mode: ${syncMode})`);

    await db.insert(syncMetadata).values({
      id: 'channel_sync',
      lastSyncStatus: status,
      lastSyncTime: new Date(),
      recordsAdded: result.lotsCreated,
      recordsUpdated: result.lotsUpdated,
      errorMessage: hasErrors ? `${result.errors.length} lots failed` : null,
      orgId: ORG_ID,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncStatus: status,
        updatedAt: new Date(),
        recordsAdded: result.lotsCreated,
        recordsUpdated: result.lotsUpdated,
        errorMessage: hasErrors ? `${result.errors.length} lots failed` : null,
      },
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
    syncLock.release('Channel Sync');
  }
}

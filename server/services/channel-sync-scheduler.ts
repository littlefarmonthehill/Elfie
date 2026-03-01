import { db } from "../db";
import { appSettings, syncMetadata } from "@shared/schema";
import { eq } from "drizzle-orm";
import { syncBrickLinkToBrickOwl } from "./brickowl";
import { syncLock } from "./sync-lock";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";

const SYNC_TYPE = 'channel_sync';

export function getChannelSyncIsRunning() {
  return syncLock.getActive().includes('Channel Sync');
}

/**
 * Start the Channel Sync scheduler.
 *
 * Gold-standard pattern: same as pom-scheduler.
 * Uses "scheduled time has passed + not run in 20h" instead of exact minute match,
 * so a blocked sync keeps retrying every minute until the lock clears.
 */
export async function startChannelSyncScheduler() {
  console.log('🌐 Channel sync scheduler initialized');

  setInterval(async () => {
    await checkAndRunChannelSync();
  }, 60 * 1000);
}

async function checkAndRunChannelSync() {
  try {
    let settingsRow;
    try {
      [settingsRow] = await db.select().from(appSettings).limit(1);
    } catch (connErr: any) {
      if (connErr.message?.includes('Connection terminated') || connErr.code === 'ECONNRESET') {
        console.log('[Channel] DB connection blip, retrying in 3s...');
        await new Promise(r => setTimeout(r, 3000));
        [settingsRow] = await db.select().from(appSettings).limit(1);
      } else throw connErr;
    }
    const settings = settingsRow;
    if (!settings?.channelSyncEnabled) return;

    const tz = settings.timezone || 'America/Chicago';
    const now = new Date();
    const localTimeStr = now.toLocaleString('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const [hStr, mStr] = localTimeStr.replace(/\u202f/g, '').split(':');
    const currentTotalMinutes = parseInt(hStr) * 60 + parseInt(mStr);
    const scheduledTime = settings.channelSyncTime || '03:00';
    const [schedH, schedM] = scheduledTime.split(':');
    const scheduledTotalMinutes = parseInt(schedH) * 60 + parseInt(schedM);

    // Too early in the day.
    if (currentTotalMinutes < scheduledTotalMinutes) return;

    // Already ran within the last 20 hours — skip until tomorrow's window.
    // When blocked, runScheduledChannelSync() is never called so lastSyncTime is not
    // updated, meaning the scheduler keeps retrying every minute until the lock clears.
    const [meta] = await db.select().from(syncMetadata).where(eq(syncMetadata.id, 'channel_sync')).limit(1);
    const lastRun = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;
    if (Date.now() - lastRun < 20 * 60 * 60 * 1000) return;

    // If channel sync itself is already running, silently skip (duplicate tick guard).
    if (getChannelSyncIsRunning()) {
      console.log('⏭️ Channel sync already in progress, skipping this cycle');
      return;
    }

    // If a different sync is holding the lock, record the issue and retry next minute.
    if (syncLock.isRunning()) {
      const blocker = syncLock.getActive().join(', ');
      console.log(`⏭️ Channel sync blocked by: ${blocker} — will retry next minute`);
      recordSyncIssue({
        syncType: SYNC_TYPE,
        platform: 'scheduler',
        issueType: 'scheduler_blocked',
        issueDescription: `Scheduled channel sync (${scheduledTime}) is blocked by: ${blocker}. Retrying every minute until the lock clears.`,
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
  }).onConflictDoUpdate({
    target: syncMetadata.id,
    set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date() },
  });

  try {
    const result = await syncBrickLinkToBrickOwl();
    const status = result.errors > 0 ? 'partial' : 'success';
    console.log(`\n✨ Channel sync complete! ${result.lotsCreated} created, ${result.lotsUpdated} updated, ${result.lotsSkipped} skipped, ${result.errors} errors`);

    await db.insert(syncMetadata).values({
      id: 'channel_sync',
      lastSyncStatus: status,
      lastSyncTime: new Date(),
      recordsAdded: result.lotsCreated,
      recordsUpdated: result.lotsUpdated,
      errorMessage: result.errors > 0 ? `${result.errors} lots failed` : null,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncStatus: status,
        updatedAt: new Date(),
        recordsAdded: result.lotsCreated,
        recordsUpdated: result.lotsUpdated,
        errorMessage: result.errors > 0 ? `${result.errors} lots failed` : null,
      },
    });

    resolveSchedulerIssues(SYNC_TYPE);
  } catch (error: any) {
    console.error('❌ Scheduled channel sync failed:', error.message);

    await db.insert(syncMetadata).values({
      id: 'channel_sync',
      lastSyncStatus: 'error',
      lastSyncTime: new Date(),
      recordsAdded: 0,
      recordsUpdated: 0,
      errorMessage: error.message,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: { lastSyncStatus: 'error', updatedAt: new Date(), errorMessage: error.message },
    });

    recordSyncIssue({
      syncType: SYNC_TYPE,
      platform: 'scheduler',
      issueType: 'sync_failed',
      issueDescription: `Scheduled channel sync failed: ${error.message}`,
      severity: 'high',
      metadata: { error: error.message, timestamp: new Date().toISOString() },
    });
  } finally {
    syncLock.release('Channel Sync');
  }
}

import { db } from "../db";
import { appSettings, syncMetadata } from "@shared/schema";
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
 * Channel Sync is the third leg of the hub-and-spoke model:
 *   1. BL Inbound Sync  — BrickLink → Local DB   (nightly, pulls SOT changes)
 *   2. Order Sync       — Orders   → Local DB → all channels (manual / on-demand)
 *   3. Channel Sync     — Local DB → BrickOwl / other channels (this job)
 *
 * Gold-standard pattern: same as pom-scheduler.
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
    const currentTime = `${hStr.padStart(2, '0')}:${mStr.padStart(2, '0')}`;
    const scheduledTime = settings.channelSyncTime || '03:00';
    if (currentTime !== scheduledTime) return;

    // If channel sync itself is already running, silently skip (duplicate tick guard).
    if (getChannelSyncIsRunning()) {
      console.log('⏭️ Channel sync already in progress, skipping this cycle');
      return;
    }

    // If a different sync is holding the lock, this is a reportable issue — we'll
    // miss the daily window.
    if (syncLock.isRunning()) {
      const blocker = syncLock.getActive().join(', ');
      console.log(`⏭️ Channel sync blocked by running sync: ${blocker}`);
      recordSyncIssue({
        syncType: SYNC_TYPE,
        platform: 'scheduler',
        issueType: 'scheduler_blocked',
        issueDescription: `Scheduled channel sync (${scheduledTime}) was blocked by: ${blocker}. The daily window was missed — sync will not run again until tomorrow.`,
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

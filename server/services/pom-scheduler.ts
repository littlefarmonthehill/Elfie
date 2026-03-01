import { db } from "../db";
import { appSettings, syncMetadata } from "@shared/schema";
import { eq } from "drizzle-orm";
import { syncPriceOMagicCache } from "./bricklink";
import { syncLock } from "./sync-lock";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";

const SYNC_TYPE = 'priceomatic_sync';

/** Returns true if a POM sync (scheduled or manual) is currently in progress. */
export function getPomIsRunning() {
  return syncLock.getActive().includes('Price-o-Matic');
}

/**
 * Claim / release the global lock on behalf of the manual sync route.
 * Returns false if another sync is already running (manual route should 409).
 */
export function setPomIsRunning(value: boolean): boolean {
  if (value) {
    return syncLock.acquire('Price-o-Matic');
  } else {
    syncLock.release('Price-o-Matic');
    return true;
  }
}

/**
 * Start the standalone Price-o-Matic scheduler.
 *
 * Gold-standard pattern: uses "scheduled time has passed + not run in 20h" instead
 * of exact minute match, so a blocked sync keeps retrying every minute until it runs.
 */
export async function startPomSyncScheduler() {
  console.log('💰 Price-o-Matic sync scheduler initialized');

  setInterval(async () => {
    await checkAndRunPomSync();
  }, 60 * 1000);
}

async function checkAndRunPomSync() {
  try {
    let settingsRow;
    try {
      [settingsRow] = await db.select().from(appSettings).limit(1);
    } catch (connErr: any) {
      if (connErr.message?.includes('Connection terminated') || connErr.code === 'ECONNRESET') {
        console.log('[POM] DB connection blip, retrying in 3s...');
        await new Promise(r => setTimeout(r, 3000));
        [settingsRow] = await db.select().from(appSettings).limit(1);
      } else throw connErr;
    }
    const settings = settingsRow;
    if (!settings?.pomScheduleEnabled) return;

    const tz = settings.timezone || 'America/Chicago';
    const now = new Date();
    const localTimeStr = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const [hStr, mStr] = localTimeStr.replace(/\u202f/g, '').split(':');
    const currentTotalMinutes = parseInt(hStr) * 60 + parseInt(mStr);
    const scheduledTime = settings.pomSyncTime || '14:00';
    const [schedH, schedM] = scheduledTime.split(':');
    const scheduledTotalMinutes = parseInt(schedH) * 60 + parseInt(schedM);

    // Too early in the day.
    if (currentTotalMinutes < scheduledTotalMinutes) return;

    // Already ran within the last 20 hours — skip until tomorrow's window.
    // When blocked, runScheduledPomSync() is never called so lastSyncTime is not
    // updated, meaning the scheduler keeps retrying every minute until the lock clears.
    const [meta] = await db.select().from(syncMetadata).where(eq(syncMetadata.id, 'priceomatic_cache')).limit(1);
    const lastRun = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;
    if (Date.now() - lastRun < 20 * 60 * 60 * 1000) return;

    // If POM itself is already running, silently skip (duplicate tick guard).
    if (getPomIsRunning()) {
      console.log('⏭️ POM sync already in progress, skipping this cycle');
      return;
    }

    // If a different sync is holding the lock, record the issue and retry next minute.
    if (syncLock.isRunning()) {
      const blocker = syncLock.getActive().join(', ');
      console.log(`⏭️ POM sync blocked by: ${blocker} — will retry next minute`);
      recordSyncIssue({
        syncType: SYNC_TYPE,
        platform: 'scheduler',
        issueType: 'scheduler_blocked',
        issueDescription: `Scheduled Price-o-Matic sync (${scheduledTime}) is blocked by: ${blocker}. Retrying every minute until the lock clears.`,
        severity: 'medium',
        metadata: { blockedBy: blocker, scheduledTime, timestamp: new Date().toISOString() },
      });
      return;
    }

    await runScheduledPomSync(settings.pomScheduleBatchSize ?? 1500);
  } catch (error) {
    console.error('❌ Error in POM sync scheduler:', error);
  }
}

async function runScheduledPomSync(batchSize: number) {
  if (!syncLock.acquire('Price-o-Matic')) {
    console.log('⏭️ Scheduled POM sync skipped — another sync is running');
    return;
  }
  console.log(`\n💰 Starting scheduled Price-o-Matic sync (batch: ${batchSize} items)...`);

  await db.insert(syncMetadata).values({
    id: 'priceomatic_cache',
    lastSyncStatus: 'in_progress',
    lastSyncTime: new Date(),
    recordsAdded: 0,
    recordsUpdated: 0,
  }).onConflictDoUpdate({
    target: syncMetadata.id,
    set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date() },
  });

  try {
    const result = await syncPriceOMagicCache(batchSize);
    console.log(`\n✨ Scheduled POM sync complete! ${result.itemsUpdated} items updated, ${result.apiCallsUsed} API calls used`);

    await db.insert(syncMetadata).values({
      id: 'priceomatic_cache',
      lastSyncStatus: result.stopped && result.stopReason?.includes('limit') ? 'partial' : 'success',
      lastSyncTime: new Date(),
      recordsAdded: 0,
      recordsUpdated: result.itemsUpdated,
      errorMessage: result.stopReason || null,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncStatus: result.stopped && result.stopReason?.includes('limit') ? 'partial' : 'success',
        updatedAt: new Date(),
        recordsUpdated: result.itemsUpdated,
        errorMessage: result.stopReason || null,
      },
    });

    resolveSchedulerIssues(SYNC_TYPE);
  } catch (error: any) {
    console.error('❌ Scheduled POM sync failed:', error.message);

    await db.insert(syncMetadata).values({
      id: 'priceomatic_cache',
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
      issueDescription: `Scheduled Price-o-Matic sync failed: ${error.message}`,
      severity: 'medium',
      metadata: { error: error.message, timestamp: new Date().toISOString() },
    });
  } finally {
    syncLock.release('Price-o-Matic');
  }
}

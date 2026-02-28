import { db } from "../db";
import { appSettings, syncMetadata } from "@shared/schema";
import { syncPriceOMagicCache } from "./bricklink";

let isRunning = false;

/** Returns true if a POM sync (scheduled or manual) is currently in progress. */
export function getPomIsRunning() {
  return isRunning;
}

/** Set the running state — used by the manual sync route to claim the lock. */
export function setPomIsRunning(value: boolean) {
  isRunning = value;
}

/**
 * Start the standalone Price-o-Matic scheduler.
 * Completely independent from inventory sync — runs at its own scheduled time.
 */
export async function startPomSyncScheduler() {
  console.log('💰 Price-o-Matic sync scheduler initialized');

  setInterval(async () => {
    await checkAndRunPomSync();
  }, 60 * 1000);
}

async function checkAndRunPomSync() {
  try {
    const [settings] = await db.select().from(appSettings).limit(1);
    if (!settings?.pomScheduleEnabled) return;

    const tz = settings.timezone || 'America/Chicago';
    const now = new Date();
    // Compare in the user's configured timezone, not server UTC
    const localTimeStr = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const [hStr, mStr] = localTimeStr.replace(/\u202f/g, '').split(':');
    const currentTime = `${hStr.padStart(2, '0')}:${mStr.padStart(2, '0')}`;
    const scheduledTime = settings.pomSyncTime || '14:00';
    if (currentTime !== scheduledTime) return;

    if (isRunning) {
      console.log('⏭️ POM sync already in progress, skipping this cycle');
      return;
    }

    await runScheduledPomSync(settings.pomScheduleBatchSize ?? 1500);
  } catch (error) {
    console.error('❌ Error in POM sync scheduler:', error);
  }
}

async function runScheduledPomSync(batchSize: number) {
  isRunning = true;
  console.log(`\n💰 Starting scheduled Price-o-Matic sync (batch: ${batchSize} items)...`);

  // Write in_progress to DB so the manual route also sees it's running
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
  } finally {
    isRunning = false;
  }
}

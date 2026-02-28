import { db } from "../db";
import { appSettings } from "@shared/schema";
import { syncPriceOMagicCache } from "./bricklink";

let isRunning = false;

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
  try {
    const result = await syncPriceOMagicCache(batchSize);
    console.log(`\n✨ Scheduled POM sync complete! ${result.itemsUpdated} items updated, ${result.apiCallsUsed} API calls used`);
  } catch (error: any) {
    console.error('❌ Scheduled POM sync failed:', error.message);
  } finally {
    isRunning = false;
  }
}

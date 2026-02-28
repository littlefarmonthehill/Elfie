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

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
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

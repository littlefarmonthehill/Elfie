import { db } from "../db";
import { appSettings } from "@shared/schema";
import { syncLock } from "./sync-lock";
import { runPlatformOrderSync } from "./order-sync-core";

let isRunning = false;

/**
 * Start the automatic order sync scheduler.
 * Reads ordersSyncEnabled / ordersSyncFrequency from app_settings.
 */
export async function startOrderSyncScheduler() {
  console.log('🕒 Order sync scheduler initialized');
  await checkAndRunSync();
  setInterval(async () => {
    await checkAndRunSync();
  }, 60 * 1000);
}

async function checkAndRunSync() {
  try {
    const [settings] = await db.select().from(appSettings).limit(1);
    if (!settings?.ordersSyncEnabled) return;

    const frequencyMs = settings.ordersSyncFrequency * 60 * 1000;
    const now = Date.now();
    const lastSyncKey = 'last_order_sync_check';
    const lastSyncTime = (global as any)[lastSyncKey] || 0;
    if (now - lastSyncTime < frequencyMs) return;
    if (isRunning) {
      console.log('⏭️ Order sync already in progress, skipping this cycle');
      return;
    }

    (global as any)[lastSyncKey] = now;
    await runAllPlatformSyncs(settings);
  } catch (error) {
    console.error('❌ Error in order sync scheduler:', error);
  }
}

async function runAllPlatformSyncs(settings: any) {
  if (syncLock.isInventorySyncRunning()) {
    console.log('⏸️ Inventory sync in progress — queueing order sync');
    await syncLock.queueOrderSync(async () => {
      await executeOrderSync();
    });
    return;
  }
  await executeOrderSync();
}

async function executeOrderSync() {
  isRunning = true;
  console.log('\n🔄 Starting scheduled order sync for all platforms...');
  try {
    const result = await runPlatformOrderSync("all", {
      fullSync: false,
      withEmbeddings: true,
      withStuckCheck: true,
    });

    const totalAdded = result.bricklink.ordersAdded + result.brickowl.ordersAdded;
    console.log(
      `\n✨ Scheduled sync complete — ${totalAdded} new orders | ` +
      `Stripe: ${result.stripe.refunds}r ${result.stripe.fees}f | ` +
      `PayPal: ${result.paypal.refunds}r ${result.paypal.fees}f`
    );
  } finally {
    isRunning = false;
  }
}

export function stopOrderSyncScheduler() {
  console.log('🛑 Order sync scheduler stopped');
}

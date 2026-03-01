import { db } from "../db";
import { appSettings } from "@shared/schema";
import { syncLock } from "./sync-lock";
import { runPlatformOrderSync } from "./order-sync-core";

/**
 * Start the automatic order sync scheduler.
 * Reads ordersSyncEnabled / ordersSyncFrequency from app_settings.
 * Checks every 60s; skips the cycle if any other sync holds the lock.
 */
export async function startOrderSyncScheduler() {
  console.log('🕒 Order sync scheduler initialized');
  await checkAndRunSync();
  setInterval(async () => {
    await checkAndRunSync();
  }, 60 * 1000);
}

async function checkAndRunSync() {
  let settings: any;
  try {
    [settings] = await db.select().from(appSettings).limit(1);
  } catch (err: any) {
    if (err?.code === 'ETIMEDOUT' || err?.message?.includes('timeout')) {
      try {
        [settings] = await db.select().from(appSettings).limit(1);
      } catch (retryErr) {
        console.error('❌ Order sync scheduler: DB retry failed', retryErr);
        return;
      }
    } else {
      console.error('❌ Order sync scheduler: DB error', err);
      return;
    }
  }

  if (!settings?.ordersSyncEnabled) return;

  const frequencyMs = settings.ordersSyncFrequency * 60 * 1000;
  const now = Date.now();
  const lastSyncKey = 'last_order_sync_check';
  const lastSyncTime = (global as any)[lastSyncKey] || 0;
  if (now - lastSyncTime < frequencyMs) return;

  // Try to acquire the global sync lock — if anything else is running, skip
  // this cycle; the scheduler will retry next minute.
  const acquired = syncLock.acquire('Order Sync');
  if (!acquired) {
    console.log('⏭️ Order sync skipped — another sync is holding the lock');
    return;
  }

  (global as any)[lastSyncKey] = now;

  try {
    console.log('\n🔄 Starting scheduled order sync for all platforms...');
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
  } catch (error) {
    console.error('❌ Error in order sync scheduler:', error);
  } finally {
    syncLock.release('Order Sync');
  }
}

export function stopOrderSyncScheduler() {
  console.log('🛑 Order sync scheduler stopped');
}

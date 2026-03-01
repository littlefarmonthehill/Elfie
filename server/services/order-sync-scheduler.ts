import { db } from "../db";
import { appSettings, syncMetadata } from "@shared/schema";
import { eq } from "drizzle-orm";
import { syncLock } from "./sync-lock";
import { runPlatformOrderSync } from "./order-sync-core";

const SYNC_ID = 'bricklink_orders';

/**
 * Start the automatic order sync scheduler.
 * Reads ordersSyncEnabled / ordersSyncFrequency from app_settings.
 * Checks every 60s; skips the cycle if the frequency window hasn't elapsed
 * or if another sync holds the lock.
 *
 * Pattern: same as channel-sync-scheduler and pom-scheduler.
 * runPlatformOrderSync() manages its own lock — do NOT pre-acquire here.
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
    let settings: any;
    try {
      [settings] = await db.select().from(appSettings).limit(1);
    } catch (connErr: any) {
      if (connErr.message?.includes('Connection terminated') || connErr.code === 'ECONNRESET') {
        console.log('[Order Sync] DB connection blip, retrying in 3s...');
        await new Promise(r => setTimeout(r, 3000));
        [settings] = await db.select().from(appSettings).limit(1);
      } else throw connErr;
    }

    if (!settings?.ordersSyncEnabled) return;

    const frequencyMs = (settings.ordersSyncFrequency ?? 15) * 60 * 1000;

    const [meta] = await db
      .select()
      .from(syncMetadata)
      .where(eq(syncMetadata.id, SYNC_ID))
      .limit(1);

    const lastRun = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;
    if (Date.now() - lastRun < frequencyMs) return;

    if (syncLock.isRunning()) {
      console.log(`⏭️ Order sync skipped — another sync is holding the lock`);
      return;
    }

    await runScheduledOrderSync();
  } catch (error) {
    console.error('❌ Error in order sync scheduler:', error);
  }
}

async function runScheduledOrderSync() {
  console.log('\n🔄 Starting scheduled order sync for all platforms...');

  await db.insert(syncMetadata).values({
    id: SYNC_ID,
    lastSyncStatus: 'in_progress',
    lastSyncTime: new Date(),
    recordsAdded: 0,
    recordsUpdated: 0,
  }).onConflictDoUpdate({
    target: syncMetadata.id,
    set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date() },
  });

  try {
    // runPlatformOrderSync() handles its own lock acquisition and release internally.
    // Do NOT acquire the lock here — doing so causes a double-lock that immediately
    // throws "Order sync blocked: Order Sync is already running".
    const result = await runPlatformOrderSync("all", {
      fullSync: false,
      withEmbeddings: true,
      withStuckCheck: true,
    });

    const totalAdded = result.bricklink.ordersAdded + result.brickowl.ordersAdded;
    console.log(
      `\n✨ Scheduled order sync complete — ${totalAdded} new orders | ` +
      `Stripe: ${result.stripe.refunds}r ${result.stripe.fees}f | ` +
      `PayPal: ${result.paypal.refunds}r ${result.paypal.fees}f`
    );

    await db.insert(syncMetadata).values({
      id: SYNC_ID,
      lastSyncStatus: 'success',
      lastSyncTime: new Date(),
      recordsAdded: totalAdded,
      recordsUpdated: 0,
      errorMessage: null,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncStatus: 'success',
        updatedAt: new Date(),
        recordsAdded: totalAdded,
        recordsUpdated: 0,
        errorMessage: null,
      },
    });
  } catch (error: any) {
    console.error('❌ Scheduled order sync failed:', error.message);
    await db.insert(syncMetadata).values({
      id: SYNC_ID,
      lastSyncStatus: 'error',
      lastSyncTime: new Date(),
      recordsAdded: 0,
      recordsUpdated: 0,
      errorMessage: error.message,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: { lastSyncStatus: 'error', updatedAt: new Date(), errorMessage: error.message },
    });
    // Lock is released inside runPlatformOrderSync's finally block — no release needed here.
  }
}

export function stopOrderSyncScheduler() {
  console.log('🛑 Order sync scheduler stopped');
}

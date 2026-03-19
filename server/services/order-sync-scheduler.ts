import { db } from "../db";
import { appSettings, syncMetadata } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { syncLock } from "./sync-lock";
import { runPlatformOrderSync } from "./order-sync-core";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";

const ORG_ID = 'org_planetbrick';

function isWithinActiveWindow(startHHMM: string, endHHMM: string, tz: string): boolean {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = formatter.formatToParts(now);
  const h = parseInt(parts.find(p => p.type === 'hour')!.value);
  const m = parseInt(parts.find(p => p.type === 'minute')!.value);
  const nowMinutes = h * 60 + m;
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;
  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

const SYNC_ID = 'bricklink_orders';
const SYNC_TYPE = 'order_sync';
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 5 * 60 * 1000;

// In-memory retry state — resets on server restart (intentional)
const retry = { count: 0, nextAt: 0 };

export async function startOrderSyncScheduler() {
  console.log('🕒 Order sync scheduler initialized');
  await checkAndRunSync();
  setInterval(async () => { await checkAndRunSync(); }, 60 * 1000);
}

async function checkAndRunSync() {
  try {
    let settings: any;
    try {
      [settings] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
    } catch (connErr: any) {
      if (connErr.message?.includes('Connection terminated') || connErr.code === 'ECONNRESET') {
        console.log('[Order Sync] DB connection blip, retrying in 3s...');
        await new Promise(r => setTimeout(r, 3000));
        [settings] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
      } else throw connErr;
    }

    if (!settings?.ordersSyncEnabled) return;

    const startTime = settings.ordersSyncStartTime ?? '08:00';
    const endTime = settings.ordersSyncEndTime ?? '20:00';
    if (!isWithinActiveWindow(startTime, endTime, settings.timezone ?? 'America/Chicago')) return;

    const frequencyMs = (settings.ordersSyncFrequency ?? 15) * 60 * 1000;

    const [meta] = await db.select().from(syncMetadata).where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, SYNC_ID))).limit(1);
    const lastRunTs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;

    if (meta?.lastSyncStatus === 'error') {
      // On failure: retry up to MAX_RETRIES with incremental delays
      if (retry.count >= MAX_RETRIES) {
        // All retries exhausted — fall back to normal frequency window
        if (Date.now() - lastRunTs < frequencyMs) return;
        retry.count = 0; // Reset and run on normal schedule
      } else {
        if (Date.now() < retry.nextAt) return;
        console.log(`[Order Sync] Retrying after failure (attempt ${retry.count + 1}/${MAX_RETRIES})...`);
      }
    } else {
      // Normal frequency gate
      if (Date.now() - lastRunTs < frequencyMs) return;
      retry.count = 0; // Fresh run, reset retries
    }

    if (syncLock.isBlockedFor('Order Sync')) {
      const blocker = syncLock.getBlockersFor('Order Sync').join(', ');
      console.log(`⏭️ Order sync skipped — incompatible sync is running: ${blocker}`);
      recordSyncIssue({
        syncType: SYNC_TYPE,
        platform: 'scheduler',
        issueType: 'scheduler_blocked',
        issueDescription: `Scheduled order sync was blocked by: ${blocker}. Will retry on the next interval.`,
        severity: 'medium',
        metadata: { blockedBy: blocker, timestamp: new Date().toISOString() },
      });
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
    orgId: ORG_ID,
  }).onConflictDoUpdate({
    target: syncMetadata.id,
    set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date(), errorMessage: null },
  });

  try {
    const result = await runPlatformOrderSync("all", {
      fullSync: false,
      withEmbeddings: true,
      withStuckCheck: true,
    });

    const totalAdded = result.bricklink.ordersAdded + result.brickowl.ordersAdded;
    console.log(
      `\n✨ Scheduled order sync complete — ${totalAdded} new orders ` +
      `(BL: ${result.bricklink.ordersAdded}, BO: ${result.brickowl.ordersAdded})`
    );

    await db.insert(syncMetadata).values({
      id: SYNC_ID,
      lastSyncStatus: 'success',
      lastSyncTime: new Date(),
      recordsAdded: totalAdded,
      recordsUpdated: 0,
      errorMessage: null,
      orgId: ORG_ID,
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

    retry.count = 0;
    resolveSchedulerIssues(SYNC_TYPE);
  } catch (error: any) {
    retry.count++;
    retry.nextAt = Date.now() + retry.count * RETRY_BASE_MS;
    const minsUntilRetry = retry.count * 5;
    console.error(`❌ Scheduled order sync failed (attempt ${retry.count}/${MAX_RETRIES}): ${error.message}`);
    if (retry.count < MAX_RETRIES) {
      console.log(`[Order Sync] Next retry in ${minsUntilRetry} minute(s)`);
    } else {
      console.log(`[Order Sync] All ${MAX_RETRIES} retries exhausted — resuming normal schedule`);
    }

    await db.insert(syncMetadata).values({
      id: SYNC_ID,
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
      issueDescription: `Scheduled order sync failed (attempt ${retry.count}/${MAX_RETRIES}): ${error.message}`,
      severity: 'high',
      metadata: { error: error.message, attempt: retry.count, maxRetries: MAX_RETRIES, timestamp: new Date().toISOString() },
    });
  }
}

export function stopOrderSyncScheduler() {
  console.log('🛑 Order sync scheduler stopped');
}

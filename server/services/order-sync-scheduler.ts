import { db } from "../db";
import { appSettings, syncMetadata } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { syncLock } from "./sync-lock";
import { runPlatformOrderSync } from "./order-sync-core";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";

const ORG_ID = 'org_planetbrick';
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 5 * 60 * 1000;

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

// ── BrickLink order sync ────────────────────────────────────────────────────

const blRetry = { count: 0, nextAt: 0 };

async function checkAndRunBrickLinkSync() {
  try {
    let settings: any;
    try {
      [settings] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
    } catch (connErr: any) {
      if (connErr.message?.includes('Connection terminated') || connErr.code === 'ECONNRESET') {
        await new Promise(r => setTimeout(r, 3000));
        [settings] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
      } else throw connErr;
    }

    if (!settings?.ordersSyncEnabled) return;

    const startTime = settings.ordersSyncStartTime ?? '08:00';
    const endTime = settings.ordersSyncEndTime ?? '20:00';
    if (!isWithinActiveWindow(startTime, endTime, settings.timezone ?? 'America/Chicago')) return;

    const frequencyMs = (settings.ordersSyncFrequency ?? 15) * 60 * 1000;
    const SYNC_ID = 'bricklink_orders';

    const [meta] = await db.select().from(syncMetadata).where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, SYNC_ID))).limit(1);
    const lastRunTs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;

    if (meta?.lastSyncStatus === 'error') {
      if (blRetry.count >= MAX_RETRIES) {
        if (Date.now() - lastRunTs < frequencyMs) return;
        blRetry.count = 0;
      } else {
        if (Date.now() < blRetry.nextAt) return;
        console.log(`[BrickLink Order Sync] Retrying after failure (attempt ${blRetry.count + 1}/${MAX_RETRIES})...`);
      }
    } else {
      if (Date.now() - lastRunTs < frequencyMs) return;
      blRetry.count = 0;
    }

    if (syncLock.isBlockedFor('Order Sync')) {
      const blocker = syncLock.getBlockersFor('Order Sync').join(', ');
      console.log(`⏭️ BrickLink order sync skipped — incompatible sync is running: ${blocker}`);
      recordSyncIssue({
        syncType: 'order_sync',
        platform: 'scheduler',
        issueType: 'scheduler_blocked',
        issueDescription: `Scheduled BrickLink order sync was blocked by: ${blocker}.`,
        severity: 'medium',
        metadata: { blockedBy: blocker, timestamp: new Date().toISOString() },
      });
      return;
    }

    await runScheduledPlatformSync('bricklink', SYNC_ID, blRetry);
  } catch (error) {
    console.error('❌ Error in BrickLink order sync scheduler:', error);
  }
}

// ── BrickOwl order sync ─────────────────────────────────────────────────────

const boRetry = { count: 0, nextAt: 0 };

async function checkAndRunBrickOwlSync() {
  try {
    let settings: any;
    try {
      [settings] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
    } catch (connErr: any) {
      if (connErr.message?.includes('Connection terminated') || connErr.code === 'ECONNRESET') {
        await new Promise(r => setTimeout(r, 3000));
        [settings] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
      } else throw connErr;
    }

    // BrickOwl shares the orders sync enabled/schedule settings with BrickLink
    if (!settings?.ordersSyncEnabled) return;

    const startTime = settings.ordersSyncStartTime ?? '08:00';
    const endTime = settings.ordersSyncEndTime ?? '20:00';
    if (!isWithinActiveWindow(startTime, endTime, settings.timezone ?? 'America/Chicago')) return;

    const frequencyMs = (settings.ordersSyncFrequency ?? 15) * 60 * 1000;
    const SYNC_ID = 'brickowl_orders';

    const [meta] = await db.select().from(syncMetadata).where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, SYNC_ID))).limit(1);
    const lastRunTs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;

    if (meta?.lastSyncStatus === 'error') {
      if (boRetry.count >= MAX_RETRIES) {
        if (Date.now() - lastRunTs < frequencyMs) return;
        boRetry.count = 0;
      } else {
        if (Date.now() < boRetry.nextAt) return;
        console.log(`[BrickOwl Order Sync] Retrying after failure (attempt ${boRetry.count + 1}/${MAX_RETRIES})...`);
      }
    } else {
      if (Date.now() - lastRunTs < frequencyMs) return;
      boRetry.count = 0;
    }

    if (syncLock.isBlockedFor('Order Sync')) {
      const blocker = syncLock.getBlockersFor('Order Sync').join(', ');
      console.log(`⏭️ BrickOwl order sync skipped — incompatible sync is running: ${blocker}`);
      recordSyncIssue({
        syncType: 'order_sync',
        platform: 'scheduler',
        issueType: 'scheduler_blocked',
        issueDescription: `Scheduled BrickOwl order sync was blocked by: ${blocker}.`,
        severity: 'medium',
        metadata: { blockedBy: blocker, timestamp: new Date().toISOString() },
      });
      return;
    }

    await runScheduledPlatformSync('brickowl', SYNC_ID, boRetry);
  } catch (error) {
    console.error('❌ Error in BrickOwl order sync scheduler:', error);
  }
}

// ── Shared runner ───────────────────────────────────────────────────────────

async function runScheduledPlatformSync(
  platform: 'bricklink' | 'brickowl',
  syncId: string,
  retry: { count: number; nextAt: number },
) {
  const label = platform === 'bricklink' ? 'BrickLink' : 'BrickOwl';
  console.log(`\n🔄 Starting scheduled ${label} order sync...`);

  await db.insert(syncMetadata).values({
    id: syncId,
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
    const result = await runPlatformOrderSync(platform, {
      fullSync: false,
      withEmbeddings: true,
      withStuckCheck: true,
    });

    const added = platform === 'bricklink' ? result.bricklink.ordersAdded : result.brickowl.ordersAdded;
    console.log(`\n✨ Scheduled ${label} order sync complete — ${added} new orders`);

    await db.insert(syncMetadata).values({
      id: syncId,
      lastSyncStatus: 'success',
      lastSyncTime: new Date(),
      recordsAdded: added,
      recordsUpdated: 0,
      errorMessage: null,
      orgId: ORG_ID,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: { lastSyncStatus: 'success', updatedAt: new Date(), recordsAdded: added, recordsUpdated: 0, errorMessage: null },
    });

    retry.count = 0;
    resolveSchedulerIssues('order_sync');
  } catch (error: any) {
    retry.count++;
    retry.nextAt = Date.now() + retry.count * RETRY_BASE_MS;
    const minsUntilRetry = retry.count * 5;
    console.error(`❌ Scheduled ${label} order sync failed (attempt ${retry.count}/${MAX_RETRIES}): ${error.message}`);
    if (retry.count < MAX_RETRIES) {
      console.log(`[${label} Order Sync] Next retry in ${minsUntilRetry} minute(s)`);
    } else {
      console.log(`[${label} Order Sync] All ${MAX_RETRIES} retries exhausted — resuming normal schedule`);
    }

    await db.insert(syncMetadata).values({
      id: syncId,
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
      syncType: 'order_sync',
      platform: 'scheduler',
      issueType: 'sync_failed',
      issueDescription: `Scheduled ${label} order sync failed (attempt ${retry.count}/${MAX_RETRIES}): ${error.message}`,
      severity: 'high',
      metadata: { error: error.message, attempt: retry.count, maxRetries: MAX_RETRIES, timestamp: new Date().toISOString() },
    });
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function startOrderSyncScheduler() {
  console.log('🕒 Order sync scheduler initialized');
  // Stagger BrickOwl by 30 s to avoid hammering the lock simultaneously
  await checkAndRunBrickLinkSync();
  setTimeout(async () => {
    await checkAndRunBrickOwlSync();
    setInterval(async () => { await checkAndRunBrickOwlSync(); }, 60 * 1000);
  }, 30 * 1000);
  setInterval(async () => { await checkAndRunBrickLinkSync(); }, 60 * 1000);
}

export function stopOrderSyncScheduler() {
  console.log('🛑 Order sync scheduler stopped');
}

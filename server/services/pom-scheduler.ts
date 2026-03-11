import { db } from "../db";
import { appSettings, syncMetadata, PLATFORM_ORG_ID } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { syncPriceOMagicCache } from "./bricklink";
import { syncLock } from "./sync-lock";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";

const ORG_ID = PLATFORM_ORG_ID;

const SYNC_TYPE = 'priceomatic_sync';
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 5 * 60 * 1000;

const retry = { count: 0, nextAt: 0 };

export function getPomIsRunning() {
  return syncLock.getActive().includes('Price-o-Matic');
}

export function setPomIsRunning(value: boolean): boolean {
  if (value) {
    return syncLock.acquire('Price-o-Matic');
  } else {
    syncLock.release('Price-o-Matic');
    return true;
  }
}

export async function startPomSyncScheduler() {
  console.log('💰 Price-o-Matic sync scheduler initialized');
  setInterval(async () => { await checkAndRunPomSync(); }, 60 * 1000);
}

async function checkAndRunPomSync() {
  try {
    let settingsRow: any;
    try {
      [settingsRow] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
    } catch (connErr: any) {
      if (connErr.message?.includes('Connection terminated') || connErr.code === 'ECONNRESET') {
        console.log('[POM] DB connection blip, retrying in 3s...');
        await new Promise(r => setTimeout(r, 3000));
        [settingsRow] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
      } else throw connErr;
    }
    const settings = settingsRow;
    if (!settings?.pomScheduleEnabled) return;

    const tz = settings.timezone || 'America/Chicago';
    const now = new Date();

    // Time-of-day gate
    const localTimeStr = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const [hStr, mStr] = localTimeStr.replace(/\u202f/g, '').split(':');
    const currentTotalMinutes = parseInt(hStr) * 60 + parseInt(mStr);
    const scheduledTime = settings.pomSyncTime || '14:00';
    const [schedH, schedM] = scheduledTime.split(':');
    const scheduledTotalMinutes = parseInt(schedH) * 60 + parseInt(schedM);
    if (currentTotalMinutes < scheduledTotalMinutes) return;

    const [meta] = await db.select().from(syncMetadata).where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, 'priceomatic_cache'))).limit(1);
    const lastRunTs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;

    if (meta?.lastSyncStatus === 'error') {
      if (retry.count >= MAX_RETRIES) {
        console.log(`[POM] All ${MAX_RETRIES} retries exhausted — waiting for next scheduled window`);
        return;
      }
      if (Date.now() < retry.nextAt) return;
      console.log(`[POM] Retrying after failure (attempt ${retry.count + 1}/${MAX_RETRIES})...`);
    } else {
      // Calendar-date dedup in local timezone
      const todayStr = now.toLocaleDateString('en-US', { timeZone: tz });
      const lastRunStr = lastRunTs ? new Date(lastRunTs).toLocaleDateString('en-US', { timeZone: tz }) : '';
      if (todayStr === lastRunStr) { retry.count = 0; return; }
      retry.count = 0;
    }

    if (getPomIsRunning()) {
      console.log('⏭️ POM sync already in progress, skipping this cycle');
      return;
    }

    if (syncLock.isRunning()) {
      const blocker = syncLock.getActive().join(', ');
      console.log(`⏭️ POM sync blocked by: ${blocker} — will retry next minute`);
      recordSyncIssue({
        syncType: SYNC_TYPE,
        platform: 'scheduler',
        issueType: 'scheduler_blocked',
        issueDescription: `Scheduled Price-o-Matic sync (${scheduledTime}) is blocked by: ${blocker}. Retrying every minute.`,
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
    orgId: ORG_ID,
  }).onConflictDoUpdate({
    target: syncMetadata.id,
    set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date(), errorMessage: null },
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
      orgId: ORG_ID,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncStatus: result.stopped && result.stopReason?.includes('limit') ? 'partial' : 'success',
        updatedAt: new Date(),
        recordsUpdated: result.itemsUpdated,
        errorMessage: result.stopReason || null,
      },
    });

    retry.count = 0;
    resolveSchedulerIssues(SYNC_TYPE);
  } catch (error: any) {
    retry.count++;
    retry.nextAt = Date.now() + retry.count * RETRY_BASE_MS;
    const minsUntilRetry = retry.count * 5;
    console.error(`❌ Scheduled POM sync failed (attempt ${retry.count}/${MAX_RETRIES}): ${error.message}`);
    if (retry.count < MAX_RETRIES) {
      console.log(`[POM] Next retry in ${minsUntilRetry} minute(s)`);
    } else {
      console.log(`[POM] All ${MAX_RETRIES} retries exhausted`);
    }

    await db.insert(syncMetadata).values({
      id: 'priceomatic_cache',
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
      issueDescription: `Scheduled Price-o-Matic sync failed (attempt ${retry.count}/${MAX_RETRIES}): ${error.message}`,
      severity: 'medium',
      metadata: { error: error.message, attempt: retry.count, maxRetries: MAX_RETRIES, timestamp: new Date().toISOString() },
    });
  } finally {
    syncLock.release('Price-o-Matic');
  }
}

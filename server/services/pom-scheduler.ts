import { db } from "../db";
import { appSettings, syncMetadata, PLATFORM_ORG_ID } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { syncPriceOMagicCache } from "./bricklink";
import { syncLock } from "./sync-lock";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";

const ORG_ID = PLATFORM_ORG_ID;

const SYNC_TYPE = 'priceomatic_sync';
const MAX_RESTART_RETRIES = 3;
const MAX_ERROR_RETRIES = 5;
const ERROR_RETRY_BASE_MS = 5 * 60 * 1000;

const retry = { count: 0, nextAt: 0 };
let restartRetryCount = 0;
let lastResumeAttemptDate = '';

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

  setTimeout(async () => {
    try {
      await detectAndResumeInterruptedSync();
    } catch (e) {
      console.error('[POM] Error during startup resume check:', e);
    }
  }, 15_000);

  setInterval(async () => { await checkAndRunPomSync(); }, 60 * 1000);
}

async function detectAndResumeInterruptedSync() {
  try {
    const [meta] = await db.select().from(syncMetadata)
      .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, 'priceomatic_cache')))
      .limit(1);

    if (meta?.lastSyncStatus === 'in_progress' && !getPomIsRunning()) {
      console.log('[POM] Detected stale in_progress from previous run — marking as interrupted for auto-resume');
      await db.update(syncMetadata)
        .set({
          lastSyncStatus: 'interrupted',
          errorMessage: 'Sync interrupted by server restart. Will auto-resume.',
          updatedAt: new Date(),
        })
        .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, 'priceomatic_cache')));
    }
  } catch (err) {
    console.error('[POM] Error in detectAndResumeInterruptedSync:', err);
  }
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
    const todayStr = now.toLocaleDateString('en-US', { timeZone: tz });

    const [meta] = await db.select().from(syncMetadata).where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, 'priceomatic_cache'))).limit(1);
    const lastRunTs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;

    if (meta?.lastSyncStatus === 'interrupted') {
      if (lastResumeAttemptDate !== todayStr) {
        restartRetryCount = 0;
        lastResumeAttemptDate = todayStr;
      }

      if (restartRetryCount >= MAX_RESTART_RETRIES) {
        console.log(`[POM] All ${MAX_RESTART_RETRIES} restart resume attempts exhausted for today — marking as error`);
        await db.update(syncMetadata)
          .set({
            lastSyncStatus: 'error',
            errorMessage: `Auto-resume failed after ${MAX_RESTART_RETRIES} restart attempts.`,
            updatedAt: new Date(),
          })
          .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, 'priceomatic_cache')));
        return;
      }

      restartRetryCount++;
      console.log(`[POM] Auto-resuming interrupted sync (restart attempt ${restartRetryCount}/${MAX_RESTART_RETRIES})...`);

      if (getPomIsRunning()) {
        console.log('⏭️ POM sync already in progress, skipping resume');
        return;
      }
      if (syncLock.isRunning()) {
        const blocker = syncLock.getActive().join(', ');
        console.log(`⏭️ POM resume blocked by: ${blocker} — will retry next minute`);
        restartRetryCount--;
        return;
      }

      await runScheduledPomSync(settings.pomScheduleBatchSize ?? 1500);
      return;
    }

    if (meta?.lastSyncStatus === 'in_progress' && !getPomIsRunning()) {
      console.log('[POM] Found stale in_progress — marking as interrupted for next cycle');
      await db.update(syncMetadata)
        .set({
          lastSyncStatus: 'interrupted',
          errorMessage: 'Sync interrupted by server restart. Will auto-resume.',
          updatedAt: new Date(),
        })
        .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, 'priceomatic_cache')));
      return;
    }

    const localTimeStr = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const [hStr, mStr] = localTimeStr.replace(/\u202f/g, '').split(':');
    const currentTotalMinutes = parseInt(hStr) * 60 + parseInt(mStr);
    const scheduledTime = settings.pomSyncTime || '14:00';
    const [schedH, schedM] = scheduledTime.split(':');
    const scheduledTotalMinutes = parseInt(schedH) * 60 + parseInt(schedM);
    if (currentTotalMinutes < scheduledTotalMinutes) return;

    if (meta?.lastSyncStatus === 'error') {
      if (retry.count >= MAX_ERROR_RETRIES) {
        console.log(`[POM] All ${MAX_ERROR_RETRIES} retries exhausted — waiting for next scheduled window`);
        return;
      }
      if (Date.now() < retry.nextAt) return;
      console.log(`[POM] Retrying after failure (attempt ${retry.count + 1}/${MAX_ERROR_RETRIES})...`);
    } else {
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
    restartRetryCount = 0;
    resolveSchedulerIssues(SYNC_TYPE);
  } catch (error: any) {
    retry.count++;
    retry.nextAt = Date.now() + retry.count * ERROR_RETRY_BASE_MS;
    const minsUntilRetry = retry.count * 5;
    console.error(`❌ Scheduled POM sync failed (attempt ${retry.count}/${MAX_ERROR_RETRIES}): ${error.message}`);
    if (retry.count < MAX_ERROR_RETRIES) {
      console.log(`[POM] Next retry in ${minsUntilRetry} minute(s)`);
    } else {
      console.log(`[POM] All ${MAX_ERROR_RETRIES} retries exhausted`);
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
      issueDescription: `Scheduled Price-o-Matic sync failed (attempt ${retry.count}/${MAX_ERROR_RETRIES}): ${error.message}`,
      severity: 'medium',
      metadata: { error: error.message, attempt: retry.count, maxRetries: MAX_ERROR_RETRIES, timestamp: new Date().toISOString() },
    });
  } finally {
    syncLock.release('Price-o-Matic');
  }
}

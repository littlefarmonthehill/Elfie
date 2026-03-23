import { db } from "../db";
import { platformSettings, syncMetadata, PLATFORM_ORG_ID } from "@shared/schema";
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
  setTimeout(async () => { await checkInterruptedResume(); }, 15_000);
  setInterval(async () => { await checkAndRunPomSync(); }, 60 * 1000);
}

async function checkInterruptedResume(attempt = 1) {
  const MAX_RESUME_ATTEMPTS = 10;
  const RESUME_RETRY_MS = 30_000;

  try {
    const [meta] = await db.select().from(syncMetadata)
      .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, 'priceomatic_cache')))
      .limit(1);

    if (!meta) { console.log('[POM] Auto-resume: no sync metadata found'); return; }

    const msg = meta.errorMessage ?? '';
    const isShutdownInterrupt = msg.includes('interrupted') || msg.includes('shutdown') || msg.includes('restart');
    const isError = meta.lastSyncStatus === 'error' && isShutdownInterrupt;
    const isPartialShutdown = meta.lastSyncStatus === 'partial' && isShutdownInterrupt;

    if (!isError && !isPartialShutdown) {
      if (attempt === 1) console.log(`[POM] Auto-resume: no interrupted sync (status=${meta.lastSyncStatus}, msg=${msg || 'none'})`);
      return;
    }

    console.log(`[POM] Detected interrupted sync (status=${meta.lastSyncStatus}, msg=${msg}) — auto-resuming (attempt ${attempt}/${MAX_RESUME_ATTEMPTS})...`);
    await new Promise(r => setTimeout(r, attempt === 1 ? 30_000 : 15_000));

    if (getPomIsRunning()) {
      console.log('[POM] Auto-resume skipped — sync already running');
      return;
    }
    if (syncLock.isBlockedFor('Price-o-Matic')) {
      const blocker = syncLock.getBlockersFor('Price-o-Matic').join(', ');
      if (attempt < MAX_RESUME_ATTEMPTS) {
        console.log(`[POM] Auto-resume blocked by: ${blocker} — retrying in ${RESUME_RETRY_MS / 1000}s (attempt ${attempt}/${MAX_RESUME_ATTEMPTS})`);
        setTimeout(() => checkInterruptedResume(attempt + 1), RESUME_RETRY_MS);
      } else {
        console.log(`[POM] Auto-resume gave up after ${MAX_RESUME_ATTEMPTS} attempts (blocked by: ${blocker}) — regular scheduler will handle it`);
      }
      return;
    }

    const [settings] = await db.select().from(platformSettings).where(eq(platformSettings.id, 'platform')).limit(1);
    const batchSize = settings?.pomScheduleBatchSize ?? 1500;
    console.log(`[POM] Auto-resuming interrupted sync (batch: ${batchSize})...`);
    await runScheduledPomSync(batchSize);
  } catch (err: any) {
    console.error('[POM] Auto-resume check failed:', err.message);
  }
}

async function checkAndRunPomSync() {
  try {
    let settingsRow: any;
    try {
      [settingsRow] = await db.select().from(platformSettings).where(eq(platformSettings.id, 'platform')).limit(1);
    } catch (connErr: any) {
      if (connErr.message?.includes('Connection terminated') || connErr.code === 'ECONNRESET') {
        console.log('[POM] DB connection blip, retrying in 3s...');
        await new Promise(r => setTimeout(r, 3000));
        [settingsRow] = await db.select().from(platformSettings).where(eq(platformSettings.id, 'platform')).limit(1);
      } else throw connErr;
    }
    const settings = settingsRow;
    if (!settings?.pomScheduleEnabled) {
      return;
    }

    const tz = settings.timezone || 'America/Chicago';
    const now = new Date();

    const [meta] = await db.select().from(syncMetadata).where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, 'priceomatic_cache'))).limit(1);
    const lastRunTs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;

    const msg = meta?.errorMessage ?? '';
    const isInterruptRecovery = meta?.lastSyncStatus === 'error' && (msg.includes('interrupted') || msg.includes('shutdown') || msg.includes('restart'));
    const scheduledTime = settings.pomSyncTime || '14:00';

    if (!isInterruptRecovery) {
      const localTimeStr = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
      const [hStr, mStr] = localTimeStr.replace(/\u202f/g, '').split(':');
      const currentTotalMinutes = parseInt(hStr) * 60 + parseInt(mStr);
      const [schedH, schedM] = scheduledTime.split(':');
      const scheduledTotalMinutes = parseInt(schedH) * 60 + parseInt(schedM);
      if (currentTotalMinutes < scheduledTotalMinutes) return;
    }

    if (meta?.lastSyncStatus === 'error') {
      if (isInterruptRecovery) {
        console.log(`[POM] Recovering from interrupted sync — bypassing schedule time gate...`);
      } else {
        if (retry.count >= MAX_RETRIES) {
          return;
        }
        if (Date.now() < retry.nextAt) return;
        console.log(`[POM] Retrying after failure (attempt ${retry.count + 1}/${MAX_RETRIES})...`);
      }
    } else {
      const todayStr = now.toLocaleDateString('en-US', { timeZone: tz });
      const lastRunStr = lastRunTs ? new Date(lastRunTs).toLocaleDateString('en-US', { timeZone: tz }) : '';
      if (todayStr === lastRunStr) { retry.count = 0; return; }
      retry.count = 0;
    }

    if (getPomIsRunning()) {
      console.log('[POM] Sync already in progress, skipping this cycle');
      return;
    }

    if (syncLock.isBlockedFor('Price-o-Matic')) {
      const blocker = syncLock.getBlockersFor('Price-o-Matic').join(', ');
      console.log(`[POM] Sync blocked by: ${blocker} — will retry next minute`);
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
    console.error('[POM] Error in sync scheduler:', error);
  }
}

async function runScheduledPomSync(batchSize: number) {
  if (!syncLock.acquire('Price-o-Matic')) {
    console.log('[POM] Scheduled sync skipped — another sync is running');
    return;
  }
  console.log(`[POM] Starting scheduled sync (batch: ${batchSize} items)...`);

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
    console.log(`[POM] Scheduled sync complete! ${result.itemsUpdated} items updated, ${result.apiCallsUsed} API calls used`);

    const isShutdown = result.stopped && (result.stopReason?.includes('shutdown') || result.stopReason?.includes('interrupted'));
    const finalStatus = result.stopped
      ? (isShutdown ? 'error' : 'partial')
      : 'success';
    await db.insert(syncMetadata).values({
      id: 'priceomatic_cache',
      lastSyncStatus: finalStatus,
      lastSyncTime: new Date(),
      recordsAdded: 0,
      recordsUpdated: result.itemsUpdated,
      errorMessage: result.stopReason || null,
      orgId: ORG_ID,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncStatus: finalStatus,
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
    console.error(`[POM] Scheduled sync failed (attempt ${retry.count}/${MAX_RETRIES}): ${error.message}`);
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

import { db } from '../db';
import { platformSettings, syncMetadata, PLATFORM_ORG_ID } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { syncMarketNews } from './market-news-scraper';
import { recordSyncIssue, resolveSchedulerIssues } from './sync-issue-service';

const ORG_ID = PLATFORM_ORG_ID;
const SYNC_ID = 'market_news_sync';
const SYNC_TYPE = 'market_news_sync';

let isRunning = false;

export async function startMarketNewsSyncScheduler() {
  console.log('[MarketNews] Scheduler initialized');

  await checkAndRunSync();

  setInterval(async () => {
    await checkAndRunSync();
  }, 5 * 60 * 1000);
}

async function checkAndRunSync() {
  try {
    const [settings] = await db.select().from(platformSettings).where(eq(platformSettings.id, 'platform')).limit(1);

    if (!settings?.marketNewsSyncEnabled) return;

    const frequencyMs = (settings.marketNewsSyncFrequency ?? 360) * 60 * 1000;

    const [meta] = await db
      .select()
      .from(syncMetadata)
      .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, SYNC_ID)))
      .limit(1);

    const lastRun = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;
    if (Date.now() - lastRun < frequencyMs) return;

    if (isRunning) {
      console.log('[MarketNews] Sync already in progress, skipping');
      return;
    }

    await runMarketNewsSync(settings.marketNewsQueries as string[] | null);
  } catch (error) {
    console.error('[MarketNews] Scheduler error:', error);
  }
}

async function runMarketNewsSync(queries: string[] | null) {
  isRunning = true;

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
    console.log('[MarketNews] Running scheduled market news sync...');

    const result = await syncMarketNews(queries ?? undefined);

    if (result.success) {
      console.log(`[MarketNews] Sync completed: ${result.articlesAdded} added, ${result.articlesUpdated} updated, ${result.embeddingsGenerated} embedded, ${result.articlesPurged} purged`);

      await db.insert(syncMetadata).values({
        id: SYNC_ID,
        lastSyncStatus: 'success',
        lastSyncTime: new Date(),
        recordsAdded: result.articlesAdded ?? 0,
        recordsUpdated: result.articlesUpdated ?? 0,
        errorMessage: null,
        orgId: ORG_ID,
      }).onConflictDoUpdate({
        target: syncMetadata.id,
        set: {
          lastSyncStatus: 'success',
          updatedAt: new Date(),
          recordsAdded: result.articlesAdded ?? 0,
          recordsUpdated: result.articlesUpdated ?? 0,
          errorMessage: null,
        },
      });

      resolveSchedulerIssues(SYNC_TYPE);
    } else {
      console.error(`[MarketNews] Sync failed: ${result.error}`);

      await db.insert(syncMetadata).values({
        id: SYNC_ID,
        lastSyncStatus: 'error',
        lastSyncTime: new Date(),
        recordsAdded: 0,
        recordsUpdated: 0,
        errorMessage: result.error ?? 'Unknown error',
        orgId: ORG_ID,
      }).onConflictDoUpdate({
        target: syncMetadata.id,
        set: { lastSyncStatus: 'error', updatedAt: new Date(), errorMessage: result.error ?? 'Unknown error' },
      });

      recordSyncIssue({
        syncType: SYNC_TYPE,
        platform: 'scheduler',
        issueType: 'sync_failed',
        issueDescription: `Market news sync failed: ${result.error}`,
        severity: 'low',
        metadata: { error: result.error, timestamp: new Date().toISOString() },
      });
    }
  } catch (error: any) {
    console.error('[MarketNews] Error during sync:', error);

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
      issueDescription: `Market news sync threw an exception: ${error.message}`,
      severity: 'low',
      metadata: { error: error.message, timestamp: new Date().toISOString() },
    });
  } finally {
    isRunning = false;
  }
}

export async function triggerManualMarketNewsSync(queries?: string[]) {
  if (isRunning) {
    return { success: false, error: 'Market news sync already in progress' };
  }

  const [settings] = await db.select().from(platformSettings).where(eq(platformSettings.id, 'platform')).limit(1);
  return await syncMarketNews(queries ?? (settings?.marketNewsQueries as string[] | null) ?? undefined);
}

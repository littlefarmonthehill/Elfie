/**
 * BrickLink Forum Sync Scheduler
 * Automatically syncs forum posts at configured intervals.
 *
 * Gold-standard pattern: uses syncMetadata for timing (survives restarts),
 * records sync issues on failure, resolves them on success.
 */

import { db } from '../db';
import { appSettings, syncMetadata, PLATFORM_ORG_ID } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { syncBrickLinkForum } from './bl-forum-scraper';
import { recordSyncIssue, resolveSchedulerIssues } from './sync-issue-service';

const ORG_ID = PLATFORM_ORG_ID;

const SYNC_ID = 'forum_sync';
const SYNC_TYPE = 'forum_sync';

let isRunning = false;

export async function startForumSyncScheduler() {
  console.log('🕒 Forum sync scheduler initialized');

  await checkAndRunSync();

  setInterval(async () => {
    await checkAndRunSync();
  }, 5 * 60 * 1000);
}

async function checkAndRunSync() {
  try {
    const [settings] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);

    if (!settings?.forumSyncEnabled) return;

    const frequencyMs = (settings.forumSyncFrequency ?? 60) * 60 * 1000;

    const [meta] = await db
      .select()
      .from(syncMetadata)
      .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, SYNC_ID)))
      .limit(1);

    const lastRun = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;
    if (Date.now() - lastRun < frequencyMs) return;

    if (isRunning) {
      console.log('⏭️ Forum sync already in progress, skipping this cycle');
      return;
    }

    await runForumSync();
  } catch (error) {
    console.error('❌ Error in forum sync scheduler:', error);
  }
}

async function runForumSync() {
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
    set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date() },
  });

  try {
    console.log('📡 Running scheduled BrickLink forum sync...');

    const result = await syncBrickLinkForum();

    if (result.success) {
      console.log(`✅ Forum sync completed: ${result.postsSaved} new posts, ${result.embeddingsGenerated} embeddings, ${result.postsPurged} purged`);

      await db.insert(syncMetadata).values({
        id: SYNC_ID,
        lastSyncStatus: 'success',
        lastSyncTime: new Date(),
        recordsAdded: result.postsSaved ?? 0,
        recordsUpdated: 0,
        errorMessage: null,
        orgId: ORG_ID,
      }).onConflictDoUpdate({
        target: syncMetadata.id,
        set: {
          lastSyncStatus: 'success',
          updatedAt: new Date(),
          recordsAdded: result.postsSaved ?? 0,
          errorMessage: null,
        },
      });

      resolveSchedulerIssues(SYNC_TYPE);
    } else {
      console.error(`❌ Forum sync failed: ${result.error}`);

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
        issueDescription: `BrickLink forum sync failed: ${result.error}`,
        severity: 'low',
        metadata: { error: result.error, timestamp: new Date().toISOString() },
      });
    }
  } catch (error: any) {
    console.error('❌ Error during forum sync:', error);

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
      issueDescription: `BrickLink forum sync threw an exception: ${error.message}`,
      severity: 'low',
      metadata: { error: error.message, timestamp: new Date().toISOString() },
    });
  } finally {
    isRunning = false;
  }
}

export async function triggerManualForumSync() {
  if (isRunning) {
    return {
      success: false,
      error: 'Forum sync already in progress',
    };
  }

  return await syncBrickLinkForum();
}

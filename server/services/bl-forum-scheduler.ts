/**
 * BrickLink Forum Sync Scheduler
 * Automatically syncs forum posts at configured intervals
 */

import { db } from '../db';
import { appSettings } from '@shared/schema';
import { syncBrickLinkForum } from './bl-forum-scraper';

let isRunning = false;

/**
 * Start the automatic forum sync scheduler
 */
export async function startForumSyncScheduler() {
  console.log('🕒 Forum sync scheduler initialized');
  
  // Initial check and sync
  await checkAndRunSync();
  
  // Check every 5 minutes if we should run a sync
  setInterval(async () => {
    await checkAndRunSync();
  }, 5 * 60 * 1000); // Check every 5 minutes
}

/**
 * Check settings and run sync if enabled and due
 */
async function checkAndRunSync() {
  try {
    // Get current settings
    const [settings] = await db
      .select()
      .from(appSettings)
      .limit(1);
    
    if (!settings) {
      return; // No settings configured yet
    }
    
    // Check if forum sync is enabled
    if (!settings.forumSyncEnabled) {
      return; // Sync is disabled
    }
    
    // Check if we should run based on frequency (in minutes)
    const frequencyMs = settings.forumSyncFrequency * 60 * 1000;
    const now = Date.now();
    
    // Get last sync time from global state
    const lastSyncKey = 'last_forum_sync_check';
    const lastSyncTime = (global as any)[lastSyncKey] || 0;
    
    if (now - lastSyncTime < frequencyMs) {
      return; // Not time yet
    }
    
    // Prevent concurrent syncs
    if (isRunning) {
      console.log('⏭️ Forum sync already in progress, skipping this cycle');
      return;
    }
    
    // Update last sync time
    (global as any)[lastSyncKey] = now;
    
    // Run the sync
    await runForumSync();
    
  } catch (error) {
    console.error('❌ Error in forum sync scheduler:', error);
  }
}

/**
 * Execute the actual forum sync
 */
async function runForumSync() {
  isRunning = true;
  
  try {
    console.log('📡 Running scheduled BrickLink forum sync...');
    
    const result = await syncBrickLinkForum();
    
    if (result.success) {
      console.log(`✅ Forum sync completed: ${result.postsSaved} new posts, ${result.embeddingsGenerated} embeddings, ${result.postsPurged} purged`);
    } else {
      console.error(`❌ Forum sync failed: ${result.error}`);
    }
  } catch (error) {
    console.error('❌ Error during forum sync:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Manually trigger a forum sync (for API endpoints)
 */
export async function triggerManualForumSync() {
  if (isRunning) {
    return {
      success: false,
      error: 'Forum sync already in progress',
    };
  }
  
  return await syncBrickLinkForum();
}

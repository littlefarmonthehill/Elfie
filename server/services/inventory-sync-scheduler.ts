import { db } from "../db";
import { appSettings, syncMetadata } from "@shared/schema";
import { eq } from "drizzle-orm";
import { syncBricklinkData } from "./bricklink";
import { syncLock } from "./sync-lock";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";

const SYNC_ID = 'bricklink_inventory';
const SYNC_TYPE = 'inventory_sync';

export async function startInventorySyncScheduler() {
  console.log('📦 Inventory sync scheduler initialized');

  setInterval(async () => {
    await checkAndRunInventorySync();
  }, 60 * 1000);
}

async function checkAndRunInventorySync() {
  try {
    let settingsRow;
    try {
      [settingsRow] = await db.select().from(appSettings).limit(1);
    } catch (connErr: any) {
      if (connErr.message?.includes('Connection terminated') || connErr.code === 'ECONNRESET') {
        console.log('[Inventory] DB connection blip, retrying in 3s...');
        await new Promise(r => setTimeout(r, 3000));
        [settingsRow] = await db.select().from(appSettings).limit(1);
      } else throw connErr;
    }
    const settings = settingsRow;
    if (!settings?.inventorySyncEnabled) return;

    const tz = settings.timezone || 'America/Chicago';
    const now = new Date();
    const localTimeStr = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const [hStr, mStr] = localTimeStr.replace(/\u202f/g, '').split(':');
    const currentTotalMinutes = parseInt(hStr) * 60 + parseInt(mStr);
    const scheduledTime = settings.inventorySyncTime || '02:00';
    const [schedH, schedM] = scheduledTime.split(':');
    const scheduledTotalMinutes = parseInt(schedH) * 60 + parseInt(schedM);

    // Too early in the day — not yet reached the scheduled time.
    if (currentTotalMinutes < scheduledTotalMinutes) return;

    // Already ran successfully within the last 20 hours — skip until tomorrow's window.
    // NOTE: lastSyncTime is only written when runAutomatedInventorySync() is called,
    // NOT when blocked. So a blocked sync keeps retrying every minute until the lock clears.
    const [meta] = await db.select().from(syncMetadata).where(eq(syncMetadata.id, SYNC_ID)).limit(1);
    const lastRun = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;
    if (Date.now() - lastRun < 20 * 60 * 60 * 1000) return;

    if (syncLock.isRunning()) {
      const blocker = syncLock.getActive().join(', ');
      console.log(`⏭️ Inventory sync skipped — blocked by: ${blocker} — will retry next minute`);
      recordSyncIssue({
        syncType: SYNC_TYPE,
        platform: 'scheduler',
        issueType: 'scheduler_blocked',
        issueDescription: `Scheduled inventory sync (${scheduledTime}) is blocked by: ${blocker}. Retrying every minute until the lock clears.`,
        severity: 'high',
        metadata: { blockedBy: blocker, scheduledTime, timestamp: new Date().toISOString() },
      });
      return;
    }

    await runAutomatedInventorySync();
  } catch (error) {
    console.error('❌ Error in inventory sync scheduler:', error);
  }
}

async function runAutomatedInventorySync() {
  // syncBricklinkData() handles its own lock acquisition and release internally.
  // Do NOT acquire the lock here — doing so causes a double-lock that immediately
  // throws "Inventory sync already in progress" when syncBricklinkData tries to acquire it.

  console.log('\n🔄 Starting automated inventory sync (BrickLink → Local DB)...');

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
    const result = await syncBricklinkData();

    console.log(`\n✨ Automated inventory sync complete!`);
    console.log(`  📦 Categories: ${result.categoriesAdded} added, ${result.categoriesUpdated} updated`);
    console.log(`  🎨 Colors: ${result.colorsAdded} added, ${result.colorsUpdated} updated`);
    console.log(`  📊 Inventory: ${result.inventoryAdded} added, ${result.inventoryUpdated} updated`);
    console.log(`  🧩 Rebrickable: ${result.rebrickableSets} sets, ${result.rebrickableParts} parts`);
    console.log(`  🔗 API Calls: ${result.totalApiCalls}`);

    await db.insert(syncMetadata).values({
      id: SYNC_ID,
      lastSyncStatus: 'success',
      lastSyncTime: new Date(),
      recordsAdded: result.inventoryAdded ?? 0,
      recordsUpdated: result.inventoryUpdated ?? 0,
      errorMessage: null,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncStatus: 'success',
        updatedAt: new Date(),
        recordsAdded: result.inventoryAdded ?? 0,
        recordsUpdated: result.inventoryUpdated ?? 0,
        errorMessage: null,
      },
    });

    resolveSchedulerIssues(SYNC_TYPE);
  } catch (error: any) {
    console.error('❌ Automated inventory sync failed:', error.message);

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

    recordSyncIssue({
      syncType: SYNC_TYPE,
      platform: 'scheduler',
      issueType: 'sync_failed',
      issueDescription: `Automated inventory sync failed: ${error.message}`,
      severity: 'critical',
      metadata: { error: error.message, timestamp: new Date().toISOString() },
    });
    // Lock is released inside syncBricklinkData's finally block — no release needed here.
  }
}

export function stopInventorySyncScheduler() {
  console.log('🛑 Inventory sync scheduler stopped');
}

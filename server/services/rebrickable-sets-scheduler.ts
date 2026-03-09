import { db } from "../db";
import { appSettings, syncMetadata } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const ORG_ID = 'org_planetbrick';
const SYNC_ID = 'rebrickable_set_parts';

export async function startRebrickableSetsScheduler() {
  console.log('🧩 Rebrickable set-parts scheduler initialized');
  // Seed a sync_metadata row so UI shows it immediately
  await db.insert(syncMetadata).values({
    id: SYNC_ID,
    lastSyncStatus: 'never',
    lastSyncTime: null,
    recordsAdded: 0,
    recordsUpdated: 0,
    orgId: ORG_ID,
  }).onConflictDoNothing();

  setInterval(async () => { await checkAndRunRebrickableSync(); }, 60 * 1000);
}

async function checkAndRunRebrickableSync() {
  try {
    const [settingsRow] = await db.select().from(appSettings).where(eq(appSettings.orgId, ORG_ID)).limit(1);
    if (!settingsRow?.rebrickableSetSyncEnabled) return;

    const tz = settingsRow.timezone || 'America/Chicago';
    const now = new Date();

    // Time-of-day gate
    const localTimeStr = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const [hStr, mStr] = localTimeStr.replace(/\u202f/g, '').split(':');
    const currentTotalMinutes = parseInt(hStr) * 60 + parseInt(mStr);
    const scheduledTime = settingsRow.rebrickableSetSyncTime || '04:00';
    const [schedH, schedM] = scheduledTime.split(':');
    const scheduledTotalMinutes = parseInt(schedH) * 60 + parseInt(schedM);
    if (currentTotalMinutes < scheduledTotalMinutes) return;

    // Calendar-month dedup — only run once per month (Rebrickable data rarely changes)
    const [meta] = await db.select().from(syncMetadata)
      .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, SYNC_ID))).limit(1);
    if (meta?.lastSyncTime) {
      const lastRun = new Date(meta.lastSyncTime);
      const nowM = now.getMonth() + '-' + now.getFullYear();
      const lastM = lastRun.getMonth() + '-' + lastRun.getFullYear();
      if (nowM === lastM && meta.lastSyncStatus !== 'error') {
        return; // Already ran this month successfully
      }
    }

    console.log('[Rebrickable Scheduler] Starting monthly set-parts sync...');
    const { syncRebrickableSetParts, getRebrickableSyncIsRunning } = await import('./rebrickable.js');
    if (getRebrickableSyncIsRunning()) {
      console.log('[Rebrickable Scheduler] Already running, skipping');
      return;
    }
    syncRebrickableSetParts(false).catch((err: any) => {
      console.error('[Rebrickable Scheduler] Sync failed:', err.message);
    });
  } catch (error: any) {
    console.error('[Rebrickable Scheduler] Error:', error.message);
  }
}

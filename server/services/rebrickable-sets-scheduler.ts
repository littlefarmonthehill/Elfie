import { db } from "../db";
import { platformSettings, syncMetadata, PLATFORM_ORG_ID } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const ORG_ID = PLATFORM_ORG_ID;
const SYNC_ID = 'rebrickable_set_parts';

// In-memory month key — prevents double-firing within a server session
// even if the DB read races with an in-progress sync.
let _firedMonthKey: string | null = null;

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
    const [settingsRow] = await db.select().from(platformSettings).where(eq(platformSettings.id, 'platform')).limit(1);
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

    // In-memory dedup — fastest guard, covers races within the same server session
    const nowMonthKey = now.getMonth() + '-' + now.getFullYear();
    if (_firedMonthKey === nowMonthKey) return;

    // Calendar-month dedup — only run once per month (Rebrickable data rarely changes)
    const [meta] = await db.select().from(syncMetadata)
      .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, SYNC_ID))).limit(1);
    if (meta?.lastSyncTime) {
      const lastRun = new Date(meta.lastSyncTime);
      const lastM = lastRun.getMonth() + '-' + lastRun.getFullYear();
      if (lastM === nowMonthKey && meta.lastSyncStatus !== 'error') {
        _firedMonthKey = nowMonthKey; // sync in-memory flag
        return;
      }
    }

    // Lock in-memory before launching so subsequent ticks in this session skip
    _firedMonthKey = nowMonthKey;

    console.log('[Rebrickable Scheduler] Starting unified Rebrickable lane (incremental)…');
    const { syncRebrickableAll, getRebrickableAllRunning } = await import('./rebrickable.js');
    if (getRebrickableAllRunning()) {
      console.log('[Rebrickable Scheduler] Already running, skipping');
      return;
    }
    // Stamp lastSyncTime now so the DB-based dedup also works on next restart
    await db.update(syncMetadata)
      .set({ lastSyncTime: new Date(), lastSyncStatus: 'success' })
      .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, SYNC_ID)));
    syncRebrickableAll(false).catch((err: any) => {
      console.error('[Rebrickable Scheduler] Sync failed:', err.message);
    });
  } catch (error: any) {
    console.error('[Rebrickable Scheduler] Error:', error.message);
  }
}

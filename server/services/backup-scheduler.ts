import { db } from "../db";
import { organizations, syncMetadata } from "@shared/schema";
import { eq } from "drizzle-orm";
import { saveXMLBackup } from "./export";
import { withDbRetry } from "./order-sync-helpers";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory lock: prevents concurrent backups for the same org within
// the same server process (handles multiple setInterval registrations
// from hot-reloads stacking up).
const runningOrgs = new Set<string>();

// Singleton guard: only one interval is ever registered per process.
let schedulerStarted = false;

export async function startBackupScheduler() {
  if (schedulerStarted) {
    console.log('💾 XML backup scheduler already running — skipping duplicate init');
    return;
  }
  schedulerStarted = true;
  console.log('💾 XML backup scheduler initialized (every 24 h, per org)');
  setInterval(async () => { await checkAndRunBackup(); }, 60 * 1000);
}

async function checkAndRunBackup() {
  try {
    const orgs = await withDbRetry(() =>
      db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isActive, true))
    );
    for (const org of orgs) {
      await checkAndRunBackupForOrg(org.id);
    }
  } catch (err: any) {
    console.error('[Backup] Scheduler tick error (non-fatal):', err.message);
  }
}

async function checkAndRunBackupForOrg(orgId: string) {
  // In-process lock — prevents duplicate runs when multiple setInterval
  // registrations exist (server hot-reloads stack up intervals).
  if (runningOrgs.has(orgId)) return;

  const metaId = `xml_backup_${orgId}`;

  const [meta] = await withDbRetry(() =>
    db.select().from(syncMetadata).where(eq(syncMetadata.id, metaId)).limit(1)
  );

  const lastRunTs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;
  if (Date.now() - lastRunTs < INTERVAL_MS) return; // Not time yet

  // Claim the slot immediately — write a tentative lastSyncTime NOW so any
  // other concurrent timer tick that fires in the same second sees a recent
  // timestamp and skips.  The actual success/failure status is written after.
  runningOrgs.add(orgId);
  try {
    await claimBackupSlot(metaId, orgId);
    await runBackupForOrg(orgId, metaId);
  } finally {
    runningOrgs.delete(orgId);
  }
}

/** Optimistically mark the slot as taken so concurrent ticks skip it. */
async function claimBackupSlot(metaId: string, orgId: string) {
  try {
    const now = new Date();
    const [existing] = await db.select({ id: syncMetadata.id })
      .from(syncMetadata).where(eq(syncMetadata.id, metaId)).limit(1);

    if (existing) {
      await db.update(syncMetadata).set({
        lastSyncStatus: 'in_progress',
        lastSyncTime:   now,  // write now so duplicate ticks see a recent timestamp
        updatedAt:      now,
      }).where(eq(syncMetadata.id, metaId));
    } else {
      await db.insert(syncMetadata).values({
        id:             metaId,
        orgId,
        lastSyncStatus: 'in_progress',
        lastSyncTime:   now,
        updatedAt:      now,
      });
    }
  } catch (e: any) {
    console.warn('[Backup] Could not claim backup slot (non-fatal):', e.message);
  }
}

async function runBackupForOrg(orgId: string, metaId: string) {
  console.log(`💾 [Backup] Starting scheduled XML backup for org ${orgId}…`);

  try {
    const filename = await saveXMLBackup(orgId);
    console.log(`✅ [Backup] Scheduled XML backup complete for org ${orgId}: ${filename}`);
    await upsertBackupMeta(metaId, orgId, 'success', filename);
  } catch (err: any) {
    console.error(`❌ [Backup] Scheduled XML backup failed for org ${orgId}:`, err.message);
    await upsertBackupMeta(metaId, orgId, 'failed', null, err.message);
  }
}

async function upsertBackupMeta(
  metaId: string,
  orgId: string,
  status: 'in_progress' | 'success' | 'failed',
  filename: string | null,
  errorMsg?: string
) {
  try {
    const now = new Date();
    const [existing] = await db.select().from(syncMetadata)
      .where(eq(syncMetadata.id, metaId)).limit(1);

    const patch: any = {
      lastSyncStatus: status,
      errorMessage:   errorMsg ?? null,
      updatedAt:      now,
    };
    if (status === 'success') {
      patch.lastSyncTime     = now;
      patch.lastSyncMetaJson = JSON.stringify({ filename, completedAt: now.toISOString() });
    }

    if (existing) {
      await db.update(syncMetadata).set(patch).where(eq(syncMetadata.id, metaId));
    } else {
      await db.insert(syncMetadata).values({
        id:               metaId,
        orgId,
        lastSyncStatus:   status,
        errorMessage:     errorMsg ?? null,
        updatedAt:        now,
        lastSyncTime:     status === 'success' ? now : null,
        lastSyncMetaJson: filename ? JSON.stringify({ filename, completedAt: now.toISOString() }) : null,
      });
    }
  } catch (e: any) {
    console.warn('[Backup] Could not upsert sync metadata (non-fatal):', e.message);
  }
}

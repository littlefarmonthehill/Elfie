import { db } from "../db";
import { syncMetadata } from "@shared/schema";
import { eq } from "drizzle-orm";
import { saveXMLBackup } from "./export";
import { withDbRetry } from "./order-sync-helpers";

const BACKUP_META_ID = 'xml_backup';
const INTERVAL_MS    = 24 * 60 * 60 * 1000; // 24 hours

export async function startBackupScheduler() {
  console.log('💾 XML backup scheduler initialized (every 24 h)');
  setInterval(async () => { await checkAndRunBackup(); }, 60 * 1000);
}

async function checkAndRunBackup() {
  try {
    const [meta] = await withDbRetry(() =>
      db.select().from(syncMetadata)
        .where(eq(syncMetadata.id, BACKUP_META_ID))
        .limit(1)
    );

    const lastRunTs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;
    if (Date.now() - lastRunTs < INTERVAL_MS) return; // Not time yet

    await runBackup();
  } catch (err: any) {
    console.error('[Backup] Scheduler tick error (non-fatal):', err.message);
  }
}

async function runBackup() {
  console.log('💾 [Backup] Starting scheduled XML backup…');
  await upsertBackupMeta('in_progress', null);

  try {
    const filename = await saveXMLBackup();
    console.log(`✅ [Backup] Scheduled XML backup complete: ${filename}`);
    await upsertBackupMeta('success', filename);
  } catch (err: any) {
    console.error('❌ [Backup] Scheduled XML backup failed:', err.message);
    await upsertBackupMeta('failed', null, err.message);
  }
}

async function upsertBackupMeta(
  status: 'in_progress' | 'success' | 'failed',
  filename: string | null,
  errorMsg?: string
) {
  try {
    const now = new Date();
    const [existing] = await db.select().from(syncMetadata)
      .where(eq(syncMetadata.id, BACKUP_META_ID)).limit(1);

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
      await db.update(syncMetadata).set(patch).where(eq(syncMetadata.id, BACKUP_META_ID));
    } else {
      await db.insert(syncMetadata).values({
        id:             BACKUP_META_ID,
        orgId:          'system',
        lastSyncStatus: status,
        errorMessage:   errorMsg ?? null,
        updatedAt:      now,
        lastSyncTime:   status === 'success' ? now : null,
        lastSyncMetaJson: filename ? JSON.stringify({ filename, completedAt: now.toISOString() }) : null,
      });
    }
  } catch (e: any) {
    console.warn('[Backup] Could not upsert sync metadata (non-fatal):', e.message);
  }
}

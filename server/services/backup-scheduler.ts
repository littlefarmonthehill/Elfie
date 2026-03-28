import { db } from "../db";
import { organizations, syncMetadata } from "@shared/schema";
import { eq } from "drizzle-orm";
import { saveXMLBackup } from "./export";
import { withDbRetry } from "./order-sync-helpers";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function startBackupScheduler() {
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
  const metaId = `xml_backup_${orgId}`;

  const [meta] = await withDbRetry(() =>
    db.select().from(syncMetadata).where(eq(syncMetadata.id, metaId)).limit(1)
  );

  const lastRunTs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;
  if (Date.now() - lastRunTs < INTERVAL_MS) return; // Not time yet

  await runBackupForOrg(orgId, metaId);
}

async function runBackupForOrg(orgId: string, metaId: string) {
  console.log(`💾 [Backup] Starting scheduled XML backup for org ${orgId}…`);
  await upsertBackupMeta(metaId, orgId, 'in_progress', null);

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

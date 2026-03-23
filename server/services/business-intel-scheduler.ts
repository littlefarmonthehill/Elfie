import { db } from "../db";
import { syncMetadata, platformSettings, PLATFORM_ORG_ID } from "@shared/schema";
import { eq } from "drizzle-orm";
import { syncBusinessIntel } from "./business-intel-engine";

let isRunning = false;

async function checkAndRunSync() {
  if (isRunning) return;

  try {
    const [settings] = await db
      .select({
        enabled: platformSettings.businessIntelEnabled,
        frequency: platformSettings.businessIntelFrequency,
      })
      .from(platformSettings)
      .where(eq(platformSettings.id, 'platform'))
      .limit(1);

    if (!settings?.enabled) return;

    const [meta] = await db
      .select()
      .from(syncMetadata)
      .where(eq(syncMetadata.id, 'business_intel_sync'))
      .limit(1);

    const lastSync = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;
    const frequencyMs = (settings.frequency || 360) * 60 * 1000;
    const now = Date.now();

    if (now - lastSync < frequencyMs) return;

    isRunning = true;

    await db.insert(syncMetadata).values({
      id: 'business_intel_sync',
      orgId: PLATFORM_ORG_ID,
      lastSyncTime: new Date(),
      lastSyncStatus: 'in_progress',
      recordsAdded: 0,
      recordsUpdated: 0,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncTime: new Date(),
        lastSyncStatus: 'in_progress',
        errorMessage: null,
      },
    });

    const result = await syncBusinessIntel();

    await db.update(syncMetadata)
      .set({
        lastSyncStatus: 'success',
        recordsAdded: result.totalInsights,
        recordsUpdated: result.orgsProcessed,
        errorMessage: null,
      })
      .where(eq(syncMetadata.id, 'business_intel_sync'));

  } catch (err: any) {
    console.error('[BusinessIntel] Scheduler error:', err.message);
    await db.update(syncMetadata)
      .set({
        lastSyncStatus: 'error',
        errorMessage: err.message?.substring(0, 500),
      })
      .where(eq(syncMetadata.id, 'business_intel_sync'));
  } finally {
    isRunning = false;
  }
}

export async function startBusinessIntelScheduler() {
  console.log('[BusinessIntel] Scheduler initialized');
  await checkAndRunSync();
  setInterval(async () => {
    await checkAndRunSync();
  }, 5 * 60 * 1000);
}

export async function triggerManualBusinessIntelSync(): Promise<{ success: boolean; error?: string }> {
  if (isRunning) return { success: false, error: 'Business intel sync already running' };
  try {
    isRunning = true;

    await db.insert(syncMetadata).values({
      id: 'business_intel_sync',
      orgId: PLATFORM_ORG_ID,
      lastSyncTime: new Date(),
      lastSyncStatus: 'in_progress',
      recordsAdded: 0,
      recordsUpdated: 0,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncTime: new Date(),
        lastSyncStatus: 'in_progress',
        errorMessage: null,
      },
    });

    const result = await syncBusinessIntel();

    await db.update(syncMetadata)
      .set({
        lastSyncStatus: 'success',
        recordsAdded: result.totalInsights,
        recordsUpdated: result.orgsProcessed,
        errorMessage: null,
      })
      .where(eq(syncMetadata.id, 'business_intel_sync'));

    return { success: true };
  } catch (err: any) {
    await db.update(syncMetadata)
      .set({
        lastSyncStatus: 'error',
        errorMessage: err.message?.substring(0, 500),
      })
      .where(eq(syncMetadata.id, 'business_intel_sync'));
    return { success: false, error: err.message };
  } finally {
    isRunning = false;
  }
}

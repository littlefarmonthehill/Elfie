import { db } from "../db";
import { appSettings, syncMetadata } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { syncLock } from "./sync-lock";
import { runPlatformOrderSync, SyncPlatform } from "./order-sync-core";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";
import { upsertSyncMetadata } from "./order-sync-helpers";
import { broadcast } from "../sse";
import { retryFailedCrossPlatformSyncs } from "./cross-platform-retry";

const MAX_RETRIES = 5;
const RETRY_BASE_MS = 5 * 60 * 1000;

/**
 * Return the first org that has order sync enabled, along with the configured sync frequency.
 */
async function getActiveOrderSyncOrg(): Promise<{ orgId: string; frequencyMs: number } | null> {
  const rows = await db.select().from(appSettings);
  for (const s of rows) {
    if (!s.ordersSyncEnabled) continue;
    return { orgId: s.id, frequencyMs: (s.ordersSyncFrequency ?? 15) * 60 * 1000 };
  }
  return null;
}

// ── Scheduled order-sync platforms ───────────────────────────────────────────
// To add eBay: push 'ebay' here and implement an EbayOrderAdapter in order-sync-core.

const SCHEDULED_ORDER_PLATFORMS: Array<'bricklink' | 'brickowl'> = ['bricklink', 'brickowl'];

// ── Per-platform retry state ─────────────────────────────────────────────────

const retryState: Record<string, { count: number; nextAt: number }> = Object.fromEntries(
  SCHEDULED_ORDER_PLATFORMS.map(p => [p, { count: 0, nextAt: 0 }])
);

// ── Shared check-and-run logic ───────────────────────────────────────────────

/**
 * Check whether a scheduled sync is due for a given platform, then run it.
 * Handles retry back-off and lock contention.
 */
async function checkAndRunPlatformSync(platform: 'bricklink' | 'brickowl') {
  const syncId   = platform === 'bricklink' ? 'bricklink_orders' : 'brickowl_orders';
  const label    = platform === 'bricklink' ? 'BrickLink' : 'BrickOwl';
  const retry    = retryState[platform];

  try {
    // Resolve the active org, retrying once on transient DB connection errors
    let active: { orgId: string; frequencyMs: number } | null;
    try {
      active = await getActiveOrderSyncOrg();
    } catch (connErr: any) {
      if (connErr.message?.includes('Connection terminated') || connErr.code === 'ECONNRESET') {
        await new Promise(r => setTimeout(r, 3000));
        active = await getActiveOrderSyncOrg();
      } else throw connErr;
    }

    if (!active) return;

    const [meta] = await db
      .select()
      .from(syncMetadata)
      .where(and(eq(syncMetadata.orgId, active.orgId), eq(syncMetadata.id, syncId)))
      .limit(1);
    const lastRunTs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;

    // Back-off logic: when in error state use exponential retry, otherwise use normal frequency
    if (meta?.lastSyncStatus === 'error') {
      if (retry.count >= MAX_RETRIES) {
        if (Date.now() - lastRunTs < active.frequencyMs) return;
        retry.count = 0;
      } else {
        if (Date.now() < retry.nextAt) return;
        console.log(`[${label} Order Sync] Retrying after failure (attempt ${retry.count + 1}/${MAX_RETRIES})...`);
      }
    } else {
      if (Date.now() - lastRunTs < active.frequencyMs) return;
      retry.count = 0;
    }

    if (syncLock.isBlockedFor('Order Sync')) {
      const blocker = syncLock.getBlockersFor('Order Sync').join(', ');
      console.log(`⏭️ ${label} order sync skipped — incompatible sync is running: ${blocker}`);
      recordSyncIssue({
        syncType: 'order_sync',
        platform: 'scheduler',
        issueType: 'scheduler_blocked',
        issueDescription: `Scheduled ${label} order sync was blocked by: ${blocker}.`,
        severity: 'medium',
        metadata: { blockedBy: blocker, timestamp: new Date().toISOString() },
      });
      return;
    }

    await runScheduledPlatformSync(platform, syncId, label, retry, active.orgId);
  } catch (error) {
    console.error(`❌ Error in ${label} order sync scheduler:`, error);
  }
}

async function runScheduledPlatformSync(
  platform: 'bricklink' | 'brickowl',
  syncId: string,
  label: string,
  retry: { count: number; nextAt: number },
  orgId: string,
) {
  console.log(`\n🔄 Starting scheduled ${label} order sync...`);

  await upsertSyncMetadata(syncId, orgId, { status: 'in_progress' });

  try {
    // Run order sync WITHOUT embeddings so we can broadcast immediately after orders
    // land in the DB — before the slow embedding step delays the SSE notification.
    const result = await runPlatformOrderSync(platform as SyncPlatform, {
      fullSync: false,
      withEmbeddings: false,
      withStuckCheck: true,
    });

    const added = platform === 'bricklink' ? result.bricklink.ordersAdded : result.brickowl.ordersAdded;
    console.log(`\n✨ Scheduled ${label} order sync complete — ${added} new orders`);

    await upsertSyncMetadata(syncId, orgId, { status: 'success', recordsAdded: added, recordsUpdated: 0 });

    // Broadcast immediately — orders are in the DB now, fulfillment should refresh right away.
    if ((added ?? 0) > 0) {
      broadcast(orgId, 'order.synced', { platform, added, source: 'scheduler' });

      // Send push notifications for new orders
      (async () => {
        try {
          const { sendOrderSyncNotifications } = await import("./push-notifications");
          const { db: dbInner } = await import("../db");
          const { sql: drizzleSql } = await import("drizzle-orm");
          const marketplace = platform === 'bricklink' ? 'BrickLink' : 'BrickOwl';
          const newRows = await dbInner.execute(drizzleSql`
            SELECT order_number AS "orderNumber", NULL AS "shippingTier"
            FROM orders
            WHERE marketplace = ${marketplace} AND org_id = ${orgId}
            ORDER BY synced_at DESC LIMIT ${added}
          `);
          await sendOrderSyncNotifications(orgId, newRows.rows as { orderNumber: string; shippingTier?: string | null }[]);
        } catch (notifErr: any) {
          console.error(`⚠️ Push notifications failed (non-fatal): ${notifErr.message}`);
        }
      })();

      // Run embeddings in the background so they don't delay the broadcast.
      (async () => {
        try {
          const { batchEmbedOrders, batchEmbedOrderDetails } = await import("./embeddings");
          const { db } = await import("../db");
          const { sql: drizzleSql } = await import("drizzle-orm");
          const marketplace = platform === 'bricklink' ? 'BrickLink' : 'BrickOwl';
          const rows = await db.execute(drizzleSql`
            SELECT id FROM orders
            WHERE marketplace = ${marketplace} AND org_id = ${orgId}
            ORDER BY synced_at DESC LIMIT ${added}
          `);
          const newOrderIds = rows.rows.map((r: any) => r.id);
          if (newOrderIds.length > 0) {
            await batchEmbedOrders(newOrderIds);
            await batchEmbedOrderDetails(newOrderIds);
            console.log(`✓ Background embeddings complete for ${newOrderIds.length} ${label} order(s)`);
          }
        } catch (embErr) {
          console.error(`✗ Background embeddings failed (non-fatal):`, embErr);
        }
      })();
    }

    retry.count = 0;
    resolveSchedulerIssues('order_sync');

    // Run cross-platform retry queue after each successful sync — heals failures
    // from any prior cycle when BL or BO was temporarily unavailable.
    retryFailedCrossPlatformSyncs(orgId).catch(err =>
      console.error(`⚠️ Cross-platform retry runner error (non-fatal): ${err.message}`)
    );
  } catch (error: any) {
    retry.count++;
    retry.nextAt = Date.now() + retry.count * RETRY_BASE_MS;
    const minsUntilRetry = retry.count * 5;
    console.error(`❌ Scheduled ${label} order sync failed (attempt ${retry.count}/${MAX_RETRIES}): ${error.message}`);

    if (retry.count < MAX_RETRIES) {
      console.log(`[${label} Order Sync] Next retry in ${minsUntilRetry} minute(s)`);
    } else {
      console.log(`[${label} Order Sync] All ${MAX_RETRIES} retries exhausted — resuming normal schedule`);
    }

    await upsertSyncMetadata(syncId, orgId, { status: 'error', errorMessage: error.message });

    recordSyncIssue({
      syncType: 'order_sync',
      platform: 'scheduler',
      issueType: 'sync_failed',
      issueDescription: `Scheduled ${label} order sync failed (attempt ${retry.count}/${MAX_RETRIES}): ${error.message}`,
      severity: 'high',
      metadata: { error: error.message, attempt: retry.count, maxRetries: MAX_RETRIES, timestamp: new Date().toISOString() },
    });
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function startOrderSyncScheduler() {
  console.log(`🕒 Order sync scheduler initialized (platforms: ${SCHEDULED_ORDER_PLATFORMS.join(', ')})`);

  // Run the first platform immediately, then stagger each subsequent one by 30 s
  // to avoid all channels hitting the lock simultaneously.
  for (let i = 0; i < SCHEDULED_ORDER_PLATFORMS.length; i++) {
    const platform = SCHEDULED_ORDER_PLATFORMS[i];
    const delayMs = i * 30 * 1000;
    if (delayMs === 0) {
      await checkAndRunPlatformSync(platform);
      setInterval(() => checkAndRunPlatformSync(platform), 60 * 1000);
    } else {
      setTimeout(() => {
        checkAndRunPlatformSync(platform);
        setInterval(() => checkAndRunPlatformSync(platform), 60 * 1000);
      }, delayMs);
    }
  }
}

export function stopOrderSyncScheduler() {
  console.log('🛑 Order sync scheduler stopped');
}

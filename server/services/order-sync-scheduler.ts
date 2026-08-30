import { db } from "../db";
import { appSettings, syncMetadata, orders } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { syncLock } from "./sync-lock";
import { getVerifiedNewOrderIds, runPlatformOrderSync } from "./order-sync-core";
import { CHANNEL_ORDER_SYNCS } from "./channel-order-registry";
import { recordSyncIssue, resolveSchedulerIssues } from "./sync-issue-service";
import { upsertSyncMetadata } from "./order-sync-helpers";
import { broadcast } from "../sse";
import { retryFailedCrossPlatformSyncs } from "./cross-platform-retry";

const MAX_RETRIES    = 5;
const RETRY_BASE_MS  = 5 * 60 * 1000;
const STAGGER_MS     = 30 * 1000; // 30 s between each channel's first run

/**
 * All channels in the registry are scheduled automatically.
 * To add a new channel: register it in channel-order-registry.ts.
 * No changes needed in this file.
 */

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

// ── Per-channel retry state ───────────────────────────────────────────────────

const retryState: Record<string, { count: number; nextAt: number }> = Object.fromEntries(
  CHANNEL_ORDER_SYNCS.map(c => [c.channelKey, { count: 0, nextAt: 0 }])
);

// ── Core check-and-run logic ──────────────────────────────────────────────────

async function checkAndRunChannelSync(channelKey: string) {
  const channel = CHANNEL_ORDER_SYNCS.find(c => c.channelKey === channelKey);
  if (!channel) return;

  const syncId = `${channelKey}_orders`;
  const retry  = retryState[channelKey] ?? (retryState[channelKey] = { count: 0, nextAt: 0 });

  try {
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

    // Retry back-off when the last sync errored
    if (meta?.lastSyncStatus === 'error') {
      if (retry.count >= MAX_RETRIES) {
        if (Date.now() - lastRunTs < active.frequencyMs) return;
        retry.count = 0;
      } else {
        if (Date.now() < retry.nextAt) return;
        console.log(`[${channel.label} Order Sync] Retrying after failure (attempt ${retry.count + 1}/${MAX_RETRIES})...`);
      }
    } else {
      if (Date.now() - lastRunTs < active.frequencyMs) return;
      retry.count = 0;
    }

    if (syncLock.isBlockedFor('Order Sync')) {
      const blocker = syncLock.getBlockersFor('Order Sync').join(', ');
      console.log(`⏭️ ${channel.label} order sync skipped — incompatible sync running: ${blocker}`);
      recordSyncIssue({
        syncType: 'order_sync',
        platform: 'scheduler',
        issueType: 'scheduler_blocked',
        issueDescription: `Scheduled ${channel.label} order sync was blocked by: ${blocker}.`,
        severity: 'medium',
        metadata: { blockedBy: blocker, timestamp: new Date().toISOString() },
      });
      return;
    }

    await runScheduledChannelSync(channel.channelKey, channel.label, syncId, retry, active.orgId, channel.marketplaceName);
  } catch (error) {
    console.error(`❌ Error in ${channel.label} order sync scheduler:`, error);
  }
}

async function runScheduledChannelSync(
  channelKey: string,
  label: string,
  syncId: string,
  retry: { count: number; nextAt: number },
  orgId: string,
  marketplaceName: string,
) {
  console.log(`\n🔄 Starting scheduled ${label} order sync...`);
  await upsertSyncMetadata(syncId, orgId, { status: 'in_progress' });

  try {
    const result = await runPlatformOrderSync(channelKey, {
      fullSync:       false,
      withEmbeddings: false,
      withStuckCheck: true,
    });

    const added = result[channelKey]?.ordersAdded ?? 0;
    const newOrderIds = getVerifiedNewOrderIds(result[channelKey]);
    console.log(`\n✨ Scheduled ${label} order sync complete — ${added} order records added, ${newOrderIds.length} fresh customer orders`);

    await upsertSyncMetadata(syncId, orgId, {
      status:         'success',
      recordsAdded:   added,
      recordsUpdated: 0,
    });

    if (added > 0) {
      broadcast(orgId, 'order.synced', { platform: channelKey, added, source: 'scheduler' });
    }

    if (newOrderIds.length > 0) {
      // Push notifications — fire and forget
      (async () => {
        try {
          const { sendOrderSyncNotifications } = await import('./push-notifications');
          const newRows = await db.select({
            orderNumber: orders.orderNumber,
            shippingTier: orders.requestedShippingService,
          })
            .from(orders)
            .where(and(
              eq(orders.orgId, orgId),
              eq(orders.marketplace, marketplaceName),
              inArray(orders.id, newOrderIds),
            ));
          const delivery = await sendOrderSyncNotifications(
            orgId,
            newRows,
          );
          console.info(`[Push] order-sync org=${orgId} channel=${channelKey} freshOrders=${newOrderIds.length} attempted=${delivery.attempted} sent=${delivery.sent} failed=${delivery.failed} stale=${delivery.stale}`);
        } catch (notifErr: any) {
          // Do not log provider error text here; it can contain subscription
          // endpoint details. Per-subscription failures are logged safely by
          // sendOrderSyncNotifications.
          console.error('⚠️ Push notifications dispatch failed (non-fatal)');
        }
      })();

      // Embeddings — fire and forget (orders are already in DB for immediate broadcast)
      (async () => {
        try {
          const { batchEmbedOrders, batchEmbedOrderDetails } = await import('./embeddings');
          await batchEmbedOrders(newOrderIds);
          await batchEmbedOrderDetails(newOrderIds);
          console.log(`✓ Background embeddings complete for ${newOrderIds.length} ${label} order(s)`);
        } catch (embErr) {
          console.error(`✗ Background embeddings failed (non-fatal):`, embErr);
        }
      })();
    }

    retry.count = 0;
    resolveSchedulerIssues('order_sync');

    retryFailedCrossPlatformSyncs(orgId).catch(err =>
      console.error(`⚠️ Cross-platform retry runner error (non-fatal): ${err.message}`)
    );

    // Refresh active shipment tracking — fire and forget so Shipments view is pre-updated
    (async () => {
      try {
        const { refreshActiveTrackingForOrg } = await import('./tracking-refresh');
        await refreshActiveTrackingForOrg(orgId);
      } catch (trackErr: any) {
        console.warn(`⚠️ Tracking refresh error (non-fatal): ${trackErr.message}`);
      }
    })();

    // In-progress order health audit — fire and forget. Pure SQL reconciliation that
    // compares each active BL order's locally-stored items subtotal against its
    // locally-stored order header (orderTotal − shipping − tax − insurance). Any
    // mismatch (> $0.05) is flagged as a critical sync_issue AND auto-healed via a
    // targeted single-order re-sync. Catches partial BL /items responses that the
    // incremental scheduler would otherwise leave broken until the order ships.
    // Only runs for BrickLink channels — other channels have their own sync paths.
    if (channelKey === 'bricklink') {
      (async () => {
        try {
          const { auditAndHealActiveBrickLinkOrders } = await import('./order-health-check');
          await auditAndHealActiveBrickLinkOrders(orgId);
        } catch (auditErr: any) {
          console.warn(`⚠️ Order health audit error (non-fatal): ${auditErr.message}`);
        }
      })();
    }
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
      metadata: {
        error:      error.message,
        attempt:    retry.count,
        maxRetries: MAX_RETRIES,
        timestamp:  new Date().toISOString(),
      },
    });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function startOrderSyncScheduler() {
  const channelKeys = CHANNEL_ORDER_SYNCS.map(c => c.channelKey);
  console.log(`🕒 Order sync scheduler initialized (channels: ${channelKeys.join(', ')})`);

  // Run the first channel immediately; stagger subsequent ones by STAGGER_MS
  // to avoid all channels hammering the lock simultaneously.
  for (let i = 0; i < CHANNEL_ORDER_SYNCS.length; i++) {
    const key     = CHANNEL_ORDER_SYNCS[i].channelKey;
    const delayMs = i * STAGGER_MS;

    if (delayMs === 0) {
      await checkAndRunChannelSync(key);
      setInterval(() => checkAndRunChannelSync(key), 60 * 1000);
    } else {
      setTimeout(() => {
        checkAndRunChannelSync(key);
        setInterval(() => checkAndRunChannelSync(key), 60 * 1000);
      }, delayMs);
    }
  }
}

export function stopOrderSyncScheduler() {
  console.log('🛑 Order sync scheduler stopped');
}

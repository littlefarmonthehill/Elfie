import { db } from "../db";
import { appSettings, PLATFORM_ORG_ID } from "@shared/schema";
import { syncLock } from "./sync-lock";
import { sql } from "drizzle-orm";
import { CHANNEL_ORDER_SYNCS } from "./channel-order-registry";

// ── Platform type ─────────────────────────────────────────────────────────────
// 'all' runs every registered channel; named keys target a specific one.
// Add new channels to channel-order-registry.ts — no changes needed here.

export type SyncPlatform = 'bricklink' | 'brickowl' | 'ebay' | 'all' | (string & {});

export interface PlatformSyncOptions {
  limit?: number;
  fullSync?: boolean;
  sinceDate?: string;
  withEmbeddings?: boolean;
  withStuckCheck?: boolean;
}

/**
 * Per-channel outcome included in OrderSyncResult.
 * Named OrderSyncResult to avoid collision with cross-platform-sync's PlatformSyncResult.
 */
export interface ChannelSyncOutcome {
  success: boolean;
  skipped: boolean;
  ordersAdded: number;
  error: string | null;
}

/**
 * Keyed by channelKey (e.g. 'bricklink', 'brickowl', 'ebay').
 * Named keys also support dot-notation for backward-compat callers
 * (e.g. result.bricklink.ordersAdded, result.brickowl.success).
 */
export interface OrderSyncResult {
  bricklink: ChannelSyncOutcome;
  brickowl:  ChannelSyncOutcome;
  ebay:      ChannelSyncOutcome;
  [key: string]: ChannelSyncOutcome;
}

// ── Progress tracking ─────────────────────────────────────────────────────────

export interface OrderSyncProgress {
  status: 'idle' | 'in_progress';
  currentStep: string;
  progress: number;
  processed: number;
  total: number;
}

const idle: OrderSyncProgress = { status: 'idle', currentStep: '', progress: 0, processed: 0, total: 0 };

// Keyed by channelKey — dynamically initialised from registry
const orderSyncProgress: Record<string, OrderSyncProgress> = Object.fromEntries(
  CHANNEL_ORDER_SYNCS.map(c => [c.channelKey, { ...idle }])
);

export function getOrderSyncProgress(channel: string): OrderSyncProgress {
  return orderSyncProgress[channel] ?? { ...idle };
}

function setProgress(channel: string, update: Partial<OrderSyncProgress>) {
  orderSyncProgress[channel] = { ...(orderSyncProgress[channel] ?? idle), ...update };
}

function resetProgress(channel: string) {
  orderSyncProgress[channel] = { ...idle };
}

/** True while an order sync is in progress. */
export function getOrderSyncIsRunning() {
  return syncLock.getActive().includes('Order Sync');
}

// ── Default outcome ───────────────────────────────────────────────────────────

function defaultOutcome(): ChannelSyncOutcome {
  return { success: false, skipped: false, ordersAdded: 0, error: null };
}

/**
 * Single shared function that runs order sync for one or all channels.
 * All entry points (manual routes + scheduler) call this.
 *
 * Adding a new channel: register it in channel-order-registry.ts.
 * No changes needed in this file.
 */
export async function runPlatformOrderSync(
  platform: SyncPlatform,
  options: PlatformSyncOptions = {}
): Promise<OrderSyncResult> {
  const { limit, fullSync = false, sinceDate, withEmbeddings = false, withStuckCheck = false } = options;
  const effectiveFullSync = fullSync || !!sinceDate;

  // Initialise result map with a default outcome for every registered channel
  const result: OrderSyncResult = Object.fromEntries(
    CHANNEL_ORDER_SYNCS.map(c => [c.channelKey, defaultOutcome()])
  ) as OrderSyncResult;

  if (!syncLock.acquire('Order Sync')) {
    const blocker = syncLock.getActive().join(', ');
    throw new Error(`Order sync blocked: ${blocker} is already running`);
  }

  try {
    const allOrgSettings = await db.select().from(appSettings);
    const newOrderIds: string[] = [];

    if (allOrgSettings.length === 0) {
      for (const ch of CHANNEL_ORDER_SYNCS) result[ch.channelKey].skipped = true;
      console.log('⏭️ No orgs configured — skipping all order syncs');
      return result;
    }

    for (const settings of allOrgSettings) {
      const orgId = settings.id;

      // Skip the platform-admin row — it has no user orders, and its BrickLink
      // credentials resolve to the platform enrichment account which would treat
      // all 4 000+ orders as "new" (none stored under orgId='platform').
      if (orgId === PLATFORM_ORG_ID) continue;

      // Determine which channels to run
      const channelsToRun = platform === 'all'
        ? CHANNEL_ORDER_SYNCS
        : CHANNEL_ORDER_SYNCS.filter(c => c.channelKey === platform);

      for (const channel of channelsToRun) {
        if (!channel.isConfigured(settings)) {
          if (platform === channel.channelKey) {
            result[channel.channelKey].skipped = true;
            console.log(`⏭️ ${channel.label} skipped for org ${orgId} — credentials not configured`);
          }
          continue;
        }

        setProgress(channel.channelKey, {
          status: 'in_progress',
          currentStep: `Fetching orders from ${channel.label}…`,
          progress: 0,
          processed: 0,
          total: 0,
        });

        try {
          console.log(`🔄 Syncing ${channel.label} orders for org ${orgId}...`);

          const chResult = await channel.syncOrders(
            settings,
            orgId,
            { limit, fullSync: effectiveFullSync, sinceDate },
            (processed, total) => {
              const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
              setProgress(channel.channelKey, {
                currentStep: `Processing order ${processed} of ${total}`,
                progress: pct,
                processed,
                total,
              });
            },
          );

          result[channel.channelKey].success = true;
          result[channel.channelKey].ordersAdded += chResult.ordersAdded ?? 0;
          console.log(`✅ ${channel.label} (${orgId}): ${chResult.ordersAdded ?? 0} orders added`);

          if (withEmbeddings && (chResult.ordersAdded ?? 0) > 0) {
            const rows = await db.execute(sql`
              SELECT id FROM orders
              WHERE marketplace = ${channel.marketplaceName} AND org_id = ${orgId}
              ORDER BY synced_at DESC LIMIT ${chResult.ordersAdded}
            `);
            newOrderIds.push(...rows.rows.map((r: any) => r.id));
          }
        } catch (err: any) {
          result[channel.channelKey].error = err.message;
          console.error(`❌ ${channel.label} sync failed for org ${orgId}:`, err.message);
        } finally {
          resetProgress(channel.channelKey);
        }
      }
    }

    // ── Embeddings (scheduler-only) ─────────────────────────────────────────
    if (withEmbeddings && newOrderIds.length > 0) {
      try {
        console.log(`🧠 Generating embeddings for ${newOrderIds.length} new orders...`);
        const { batchEmbedOrders, batchEmbedOrderDetails } = await import('./embeddings');
        await batchEmbedOrders(newOrderIds);
        await batchEmbedOrderDetails(newOrderIds);
        console.log('✓ Embeddings complete');
      } catch (err) {
        console.error('✗ Embedding failed (non-fatal):', err);
      }
    }

    // ── Stuck inventory check (scheduler-only) ──────────────────────────────
    if (withStuckCheck) {
      try {
        const { checkStuckInventoryDeductions } = await import('./sync-issue-service');
        await checkStuckInventoryDeductions();
      } catch (err) {
        console.error('✗ Stuck check failed (non-fatal):', err);
      }
    }

    return result;
  } finally {
    syncLock.release('Order Sync');
  }
}

import { updateBrickOwlLot, getBrickOwlInventory } from './brickowl';
import { adjustBrickLinkInventoryDelta } from './bricklink';
import { recordSyncIssue } from './sync-issue-service';
import { db } from '../db';
import { channelLotLinks } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';

const BO_CHANNEL = 'brickowl' as const;

/**
 * Cross-Platform Inventory Synchronization Service
 *
 * Rules:
 * - The platform that generated the sale is EXCLUDED from receiving inventory updates
 *   (it already manages its own inventory for that order).
 * - All other platforms receive inventory updates.
 * - BrickLink uses delta-based adjustments ("+N" / "-N").
 * - BrickOwl uses absolute quantity updates.
 *
 * Supported Platforms:
 * - BrickLink (delta adjustments)
 * - BrickOwl (absolute quantity)
 *
 * Adding a new channel:
 *   1. Add its update function below following the same signature as
 *      updateBrickOwlQuantity / updateBrickLinkQuantityDelta.
 *   2. Call it (with source exclusion) inside syncInventoryItemAcrossPlatforms.
 *   3. Pre-fetch any inventory data the channel needs in syncMultipleItemsAcrossPlatforms
 *      and pass it through as a context parameter to avoid N+1 API calls.
 */

export interface PlatformSyncResult {
  platform: string;
  success: boolean;
  itemsUpdated: number;
  errors: string[];
}

export interface CrossPlatformSyncResult {
  success: boolean;
  platforms: PlatformSyncResult[];
  totalItemsUpdated: number;
  totalErrors: number;
}

export interface SyncItem {
  inventoryId: string;
  newQuantity: number;    // Absolute quantity — used for BrickOwl and absolute-setter platforms
  quantityDelta: number;  // Delta change — used for BrickLink (negative = reduce, positive = restore)
  sourcePlatform: string; // The platform that originated the sale; will be skipped
  orgId?: string;         // Org whose credentials to use for the adjustment
  // Optional context for error tracking
  orderId?: string;
  orderNumber?: string;
  itemNo?: string;
}

/** Pre-fetched context shared across all items in a single bulk sync run. */
interface SyncContext {
  /** Map of BL inventory ID (string) → BrickOwl lot, built from live BO inventory. */
  boInventoryMap: Map<string, any>;
}

// ── BrickOwl ─────────────────────────────────────────────────────────────────

/**
 * Update a single inventory item's quantity on BrickOwl (absolute).
 * Requires a pre-built inventory map to avoid repeated full-inventory API calls.
 */
async function updateBrickOwlQuantity(
  item: SyncItem,
  boInventoryMap: Map<string, any>
): Promise<{ success: boolean; error?: string }> {
  const { inventoryId, newQuantity, orgId, orderId, orderNumber, itemNo } = item;
  try {
    const matchingLot = boInventoryMap.get(inventoryId);

    if (!matchingLot) {
      const errMsg = `No BrickOwl lot found with BrickLink inventory ID: ${inventoryId}`;
      await recordSyncIssue({
        syncType: 'cross_platform_sync',
        platform: 'brickowl',
        itemId: inventoryId,
        itemNo,
        issueType: 'lot_not_found',
        issueDescription: `${errMsg}${orderNumber ? ` (order ${orderNumber})` : ''}`,
        severity: 'high',
        metadata: { inventoryId, orderId, orderNumber, itemNo, newQuantity },
      });
      return { success: false, error: errMsg };
    }

    await updateBrickOwlLot({ lot_id: matchingLot.lot_id, absolute_quantity: newQuantity });

    console.log(`✓ BrickOwl: Updated lot ${matchingLot.lot_id} to quantity ${newQuantity}`);
    return { success: true };

  } catch (error: any) {
    const errMsg = error.message || 'Unknown error';
    console.error(`✗ BrickOwl sync error for inventory ${inventoryId}:`, error);
    await recordSyncIssue({
      syncType: 'cross_platform_sync',
      platform: 'brickowl',
      itemId: inventoryId,
      itemNo,
      issueType: 'update_failed',
      issueDescription: `BrickOwl quantity update failed for inventory ${inventoryId}${orderNumber ? ` (order ${orderNumber})` : ''}: ${errMsg}`,
      severity: 'high',
      metadata: { inventoryId, orderId, orderNumber, itemNo, newQuantity, error: errMsg },
    });
    return { success: false, error: errMsg };
  }
}

// ── BrickLink ─────────────────────────────────────────────────────────────────

/**
 * Update a single inventory item's quantity on BrickLink (delta).
 */
async function updateBrickLinkQuantityDelta(
  item: SyncItem
): Promise<{ success: boolean; error?: string }> {
  const { inventoryId, quantityDelta, orderId, orderNumber, itemNo, orgId } = item;
  try {
    const numericId = parseInt(inventoryId, 10);
    if (isNaN(numericId)) {
      const errMsg = `Invalid BrickLink inventory ID: ${inventoryId}`;
      await recordSyncIssue({
        syncType: 'cross_platform_sync',
        platform: 'bricklink',
        itemId: inventoryId,
        itemNo,
        issueType: 'invalid_inventory_id',
        issueDescription: `${errMsg}${orderNumber ? ` (order ${orderNumber})` : ''}`,
        severity: 'high',
        metadata: { inventoryId, orderId, orderNumber, itemNo },
      });
      return { success: false, error: errMsg };
    }

    const result = await adjustBrickLinkInventoryDelta(numericId, quantityDelta, orgId);
    if (!result.success && result.error) {
      await recordSyncIssue({
        syncType: 'cross_platform_sync',
        platform: 'bricklink',
        itemId: inventoryId,
        itemNo,
        issueType: 'update_failed',
        issueDescription: `BrickLink delta update failed for inventory ${inventoryId}${orderNumber ? ` (order ${orderNumber})` : ''}: ${result.error}`,
        severity: 'high',
        metadata: { inventoryId, orderId, orderNumber, itemNo, quantityDelta, error: result.error },
      });
    }
    return result;

  } catch (error: any) {
    const errMsg = error.message || 'Unknown error';
    console.error(`✗ BrickLink sync error for inventory ${inventoryId}:`, error);
    await recordSyncIssue({
      syncType: 'cross_platform_sync',
      platform: 'bricklink',
      itemId: inventoryId,
      itemNo,
      issueType: 'update_failed',
      issueDescription: `BrickLink delta update failed for inventory ${inventoryId}${orderNumber ? ` (order ${orderNumber})` : ''}: ${errMsg}`,
      severity: 'high',
      metadata: { inventoryId, orderId, orderNumber, itemNo, quantityDelta, error: errMsg },
    });
    return { success: false, error: errMsg };
  }
}

// ── Orchestration ─────────────────────────────────────────────────────────────

/**
 * Synchronize a single inventory item across all platforms except the source.
 * Accepts a pre-built context to avoid redundant API calls in bulk operations.
 */
export async function syncInventoryItemAcrossPlatforms(
  item: SyncItem,
  context?: SyncContext
): Promise<CrossPlatformSyncResult> {
  const { inventoryId, quantityDelta, sourcePlatform } = item;
  const source = sourcePlatform.toLowerCase();

  console.log(`\n🌐 Cross-platform sync: inventory ${inventoryId} delta=${quantityDelta > 0 ? '+' : ''}${quantityDelta} (source: ${sourcePlatform})`);

  const platformResults: PlatformSyncResult[] = [];

  // BrickLink — skip if it's the source
  if (source !== 'bricklink') {
    const result = await updateBrickLinkQuantityDelta(item);
    platformResults.push({
      platform: 'BrickLink',
      success: result.success,
      itemsUpdated: result.success ? 1 : 0,
      errors: result.error ? [result.error] : [],
    });
    await new Promise(resolve => setTimeout(resolve, 150));
  } else {
    console.log(`⏭️  Skipping BrickLink (source platform)`);
  }

  // BrickOwl — skip if it's the source
  if (source !== 'brickowl') {
    const boInventoryMap = context?.boInventoryMap ?? new Map();
    const result = await updateBrickOwlQuantity(item, boInventoryMap);
    platformResults.push({
      platform: 'BrickOwl',
      success: result.success,
      itemsUpdated: result.success ? 1 : 0,
      errors: result.error ? [result.error] : [],
    });
  } else {
    console.log(`⏭️  Skipping BrickOwl (source platform)`);
  }

  const totalItemsUpdated = platformResults.reduce((sum, r) => sum + r.itemsUpdated, 0);
  const totalErrors = platformResults.reduce((sum, r) => sum + r.errors.length, 0);

  console.log(`🌐 Cross-platform sync complete: ${totalItemsUpdated} platforms updated, ${totalErrors} errors`);

  return {
    success: platformResults.every(r => r.success),
    platforms: platformResults,
    totalItemsUpdated,
    totalErrors,
  };
}

/**
 * Bulk synchronization: Update multiple inventory items across all platforms.
 *
 * BL inventory IDs are resolved to channel lot IDs via the local channel_lot_links
 * table (O(1) DB lookup, no external API call). Only items not yet in the table
 * (pre-dating the mapping feature) fall back to a one-time live BO inventory fetch.
 *
 * Runs as fire-and-forget — callers should not await this for order processing
 * to remain fast.
 */
export async function syncMultipleItemsAcrossPlatforms(
  items: SyncItem[]
): Promise<void> {
  console.log(`\n🌐 Starting bulk cross-platform sync for ${items.length} items...`);

  // Determine orgId for BrickOwl lookup (use the first item's org; all items in a
  // single bulk sync should belong to the same org).
  const orgId = items[0]?.orgId;

  // ── Primary: resolve BL→BO lot IDs from the local channel_lot_links table ──
  // This is a single indexed DB query — no external API call needed.
  let boInventoryMap = new Map<string, any>();
  const blInvIds = items
    .map(i => parseInt(i.inventoryId, 10))
    .filter(id => !isNaN(id));

  try {
    if (blInvIds.length > 0 && orgId) {
      const links = await db
        .select({ blInvId: channelLotLinks.blInvId, channelLotId: channelLotLinks.channelLotId })
        .from(channelLotLinks)
        .where(and(eq(channelLotLinks.orgId, orgId), eq(channelLotLinks.channel, BO_CHANNEL), inArray(channelLotLinks.blInvId, blInvIds)));
      for (const link of links) {
        boInventoryMap.set(String(link.blInvId), { lot_id: link.channelLotId });
      }
      console.log(`🌐 Resolved ${boInventoryMap.size}/${blInvIds.length} BL→BO lot links from local table`);
    }
  } catch (err: any) {
    console.warn(`⚠️ Could not query channel_lot_links — will fall back to live BO inventory: ${err.message}`);
  }

  // ── Fallback: fetch live BO inventory for items not yet in channel_lot_links ──
  // Covers lots created before this feature was deployed. Once the channel sync
  // has run at least once for an org, this fallback path will never trigger.
  const unresolved = blInvIds.filter(id => !boInventoryMap.has(String(id)));
  if (unresolved.length > 0) {
    console.log(`🌐 ${unresolved.length} items not in channel_lot_links — falling back to live BO inventory fetch`);
    try {
      const boInventory = await getBrickOwlInventory(false, orgId);
      for (const lot of boInventory) {
        const extId = lot.external_lot_ids?.other;
        if (extId && !boInventoryMap.has(extId)) {
          boInventoryMap.set(extId, lot);
        }
      }
      console.log(`🌐 Fallback BO inventory fetched: ${boInventoryMap.size} total lots now indexed`);
    } catch (err: any) {
      console.warn(`⚠️ Could not fetch live BO inventory for fallback: ${err.message}`);
    }
  }

  const context: SyncContext = { boInventoryMap };

  const syncPromises = items.map(item =>
    syncInventoryItemAcrossPlatforms(item, context).catch(error => {
      console.error(`✗ Cross-platform sync failed for ${item.inventoryId}:`, error);
    })
  );

  Promise.allSettled(syncPromises).then(results => {
    const successful = results.filter(r => r.status === 'fulfilled').length;
    console.log(`🌐 Bulk sync completed: ${successful}/${items.length} items synced across platforms`);
  });
}

import { updateBrickOwlLot, getBrickOwlInventory } from './brickowl';
import { adjustBrickLinkInventoryDelta } from './bricklink';
import { recordSyncIssue } from './sync-issue-service';

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
 * BrickOwl inventory is fetched once here and reused for every item, avoiding
 * an N+1 API call pattern that does not scale with larger catalogs.
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

  // Pre-fetch BrickOwl inventory once and index by BL inventory ID.
  // This avoids fetching the full inventory list once per item.
  let boInventoryMap = new Map<string, any>();
  try {
    const boInventory = await getBrickOwlInventory(false, orgId);
    for (const lot of boInventory) {
      if (lot.external_lot_ids?.other) {
        boInventoryMap.set(lot.external_lot_ids.other, lot);
      }
    }
    console.log(`🌐 Pre-fetched BrickOwl inventory: ${boInventoryMap.size} lots indexed`);
  } catch (err: any) {
    console.warn(`⚠️ Could not pre-fetch BrickOwl inventory for bulk sync — individual items will be skipped if their lot is not found: ${err.message}`);
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

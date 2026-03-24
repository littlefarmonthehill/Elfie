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
 * - BrickLink uses delta-based adjustments ("+N" / "-N" strings).
 * - BrickOwl uses absolute quantity updates.
 *
 * Supported Platforms:
 * - BrickLink (delta adjustments)
 * - BrickOwl (absolute quantity)
 * - eBay, BigCommerce, Amazon (future)
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
  orgId?: string;         // Org whose BrickLink credentials to use for the adjustment
  // Optional context for error tracking
  orderId?: string;
  orderNumber?: string;
  itemNo?: string;
}

/**
 * Update a single inventory item's quantity on BrickOwl (absolute)
 */
async function updateBrickOwlQuantity(
  item: SyncItem
): Promise<{ success: boolean; error?: string }> {
  const { inventoryId, newQuantity, orderId, orderNumber, itemNo } = item;
  try {
    const brickowlInventory = await getBrickOwlInventory(false);

    const matchingLot = brickowlInventory.find(
      lot => lot.external_lot_ids?.other === inventoryId
    );

    if (!matchingLot) {
      const errMsg = `No BrickOwl lot found with BrickLink inventory ID: ${inventoryId}`;
      await recordSyncIssue({
        syncType: 'cross_platform_sync',
        platform: 'brickowl',
        itemId: inventoryId,
        itemNo: itemNo,
        issueType: 'lot_not_found',
        issueDescription: `${errMsg}${orderNumber ? ` (order ${orderNumber})` : ''}`,
        severity: 'high',
        metadata: { inventoryId, orderId, orderNumber, itemNo, newQuantity },
      });
      return { success: false, error: errMsg };
    }

    await updateBrickOwlLot({
      lot_id: matchingLot.lot_id,
      absolute_quantity: newQuantity,
    });

    console.log(`✓ BrickOwl: Updated lot ${matchingLot.lot_id} to quantity ${newQuantity}`);
    return { success: true };

  } catch (error: any) {
    console.error(`✗ BrickOwl sync error for inventory ${inventoryId}:`, error);
    const errMsg = error.message || 'Unknown error';
    await recordSyncIssue({
      syncType: 'cross_platform_sync',
      platform: 'brickowl',
      itemId: inventoryId,
      itemNo: itemNo,
      issueType: 'update_failed',
      issueDescription: `BrickOwl quantity update failed for inventory ${inventoryId}${orderNumber ? ` (order ${orderNumber})` : ''}: ${errMsg}`,
      severity: 'high',
      metadata: { inventoryId, orderId, orderNumber, itemNo, newQuantity, error: errMsg },
    });
    return { success: false, error: errMsg };
  }
}

/**
 * Update a single inventory item's quantity on BrickLink (delta)
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
        itemNo: itemNo,
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
        itemNo: itemNo,
        issueType: 'update_failed',
        issueDescription: `BrickLink delta update failed for inventory ${inventoryId}${orderNumber ? ` (order ${orderNumber})` : ''}: ${result.error}`,
        severity: 'high',
        metadata: { inventoryId, orderId, orderNumber, itemNo, quantityDelta, error: result.error },
      });
    }
    return result;
  } catch (error: any) {
    console.error(`✗ BrickLink sync error for inventory ${inventoryId}:`, error);
    const errMsg = error.message || 'Unknown error';
    await recordSyncIssue({
      syncType: 'cross_platform_sync',
      platform: 'bricklink',
      itemId: inventoryId,
      itemNo: itemNo,
      issueType: 'update_failed',
      issueDescription: `BrickLink delta update failed for inventory ${inventoryId}${orderNumber ? ` (order ${orderNumber})` : ''}: ${errMsg}`,
      severity: 'high',
      metadata: { inventoryId, orderId, orderNumber, itemNo, quantityDelta, error: errMsg },
    });
    return { success: false, error: errMsg };
  }
}

/**
 * Synchronize a single inventory item across all platforms except the source.
 */
export async function syncInventoryItemAcrossPlatforms(
  item: SyncItem
): Promise<CrossPlatformSyncResult> {
  const { inventoryId, quantityDelta, sourcePlatform } = item;
  const source = sourcePlatform.toLowerCase();

  console.log(`\n🌐 Cross-platform sync: inventory ${inventoryId} delta=${quantityDelta > 0 ? '+' : ''}${quantityDelta} (source: ${sourcePlatform})`);

  const platformResults: PlatformSyncResult[] = [];

  // BrickLink — use delta, skip if BrickLink is the source
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

  // BrickOwl — use absolute quantity, skip if BrickOwl is the source
  if (source !== 'brickowl') {
    const result = await updateBrickOwlQuantity(item);
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
 * Bulk synchronization: Update multiple inventory items across platforms.
 * Runs asynchronously (fire-and-forget) to avoid blocking order processing.
 */
export async function syncMultipleItemsAcrossPlatforms(
  items: SyncItem[]
): Promise<void> {
  console.log(`\n🌐 Starting bulk cross-platform sync for ${items.length} items...`);

  const syncPromises = items.map(item =>
    syncInventoryItemAcrossPlatforms(item).catch(error => {
      console.error(`✗ Cross-platform sync failed for ${item.inventoryId}:`, error);
    })
  );

  Promise.allSettled(syncPromises).then(results => {
    const successful = results.filter(r => r.status === 'fulfilled').length;
    console.log(`🌐 Bulk sync completed: ${successful}/${items.length} items synced across platforms`);
  });
}

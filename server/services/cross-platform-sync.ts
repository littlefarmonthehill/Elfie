import { updateBrickOwlLot, getBrickOwlInventory } from './brickowl';
import { adjustBrickLinkInventoryDelta } from './bricklink';

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
}

/**
 * Update a single inventory item's quantity on BrickOwl (absolute)
 */
async function updateBrickOwlQuantity(
  inventoryId: string,
  newQuantity: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const brickowlInventory = await getBrickOwlInventory(false);
    
    const matchingLot = brickowlInventory.find(
      lot => lot.external_lot_ids?.other === inventoryId
    );
    
    if (!matchingLot) {
      return { 
        success: false, 
        error: `No BrickOwl lot found with BrickLink inventory ID: ${inventoryId}` 
      };
    }
    
    await updateBrickOwlLot({
      lot_id: matchingLot.lot_id,
      absolute_quantity: newQuantity,
    });
    
    console.log(`✓ BrickOwl: Updated lot ${matchingLot.lot_id} to quantity ${newQuantity}`);
    return { success: true };
    
  } catch (error: any) {
    console.error(`✗ BrickOwl sync error for inventory ${inventoryId}:`, error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Update a single inventory item's quantity on BrickLink (delta)
 */
async function updateBrickLinkQuantityDelta(
  inventoryId: string,
  quantityDelta: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const numericId = parseInt(inventoryId, 10);
    if (isNaN(numericId)) {
      return { success: false, error: `Invalid BrickLink inventory ID: ${inventoryId}` };
    }
    return await adjustBrickLinkInventoryDelta(numericId, quantityDelta);
  } catch (error: any) {
    console.error(`✗ BrickLink sync error for inventory ${inventoryId}:`, error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Synchronize a single inventory item across all platforms except the source.
 */
export async function syncInventoryItemAcrossPlatforms(
  item: SyncItem
): Promise<CrossPlatformSyncResult> {
  const { inventoryId, newQuantity, quantityDelta, sourcePlatform } = item;
  const source = sourcePlatform.toLowerCase();
  
  console.log(`\n🌐 Cross-platform sync: inventory ${inventoryId} delta=${quantityDelta > 0 ? '+' : ''}${quantityDelta} (source: ${sourcePlatform})`);
  
  const platformResults: PlatformSyncResult[] = [];

  // BrickLink — use delta, skip if BrickLink is the source
  if (source !== 'bricklink') {
    const result = await updateBrickLinkQuantityDelta(inventoryId, quantityDelta);
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
    const result = await updateBrickOwlQuantity(inventoryId, newQuantity);
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

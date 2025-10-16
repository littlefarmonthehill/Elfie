import { db } from '../db';
import { blInventory } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { updateBrickOwlLot, getBrickOwlInventory } from './brickowl';
import { updateBrickLinkInventoryQuantity } from './bricklink';

/**
 * Cross-Platform Inventory Synchronization Service
 * 
 * Industry standard: Item-by-item asynchronous updates across selling platforms
 * when BrickLink inventory changes (via order shipments, cancellations, manual adjustments)
 * 
 * BrickLink is the source of truth - all inventory changes update BrickLink first,
 * then propagate to other platforms.
 * 
 * Supported Platforms:
 * - BrickOwl (active)
 * - eBay, BigCommerce, Amazon, Etsy, Facebook (future - TBD)
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

/**
 * Update a single inventory item's quantity on BrickOwl
 */
async function updateBrickOwlQuantity(
  inventoryId: string,
  newQuantity: number
): Promise<{ success: boolean; error?: string }> {
  try {
    // Fetch BrickOwl inventory to find matching lot by external_lot_ids.other (BrickLink inventory ID)
    const brickowlInventory = await getBrickOwlInventory(false);
    
    // Find lot matching this BrickLink inventory ID
    const matchingLot = brickowlInventory.find(
      lot => lot.external_lot_ids?.other === inventoryId
    );
    
    if (!matchingLot) {
      return { 
        success: false, 
        error: `No BrickOwl lot found with BrickLink inventory ID: ${inventoryId}` 
      };
    }
    
    // Update lot quantity
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
 * Update a single inventory item's quantity on eBay
 * TODO: Implement when eBay integration is needed
 */
async function updateEbayQuantity(
  inventoryId: string,
  newQuantity: number
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  // eBay sync not yet implemented - skip gracefully
  return { success: true, skipped: true };
}

/**
 * Update a single inventory item's quantity on BigCommerce
 * TODO: Implement when BigCommerce integration is needed
 */
async function updateBigCommerceQuantity(
  inventoryId: string,
  newQuantity: number
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  // BigCommerce sync not yet implemented - skip gracefully
  return { success: true, skipped: true };
}

/**
 * Update a single inventory item's quantity on Amazon
 * TODO: Implement when Amazon integration is needed
 */
async function updateAmazonQuantity(
  inventoryId: string,
  newQuantity: number
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  // Amazon sync not yet implemented - skip gracefully
  return { success: true, skipped: true };
}

/**
 * Update a single inventory item's quantity on BrickLink
 */
async function updateBrickLinkQuantity(
  inventoryId: string,
  newQuantity: number
): Promise<{ success: boolean; error?: string }> {
  try {
    // BrickLink inventory ID is numeric
    const numericId = parseInt(inventoryId, 10);
    if (isNaN(numericId)) {
      return { success: false, error: `Invalid BrickLink inventory ID: ${inventoryId}` };
    }
    
    const result = await updateBrickLinkInventoryQuantity(numericId, newQuantity);
    return result;
  } catch (error: any) {
    console.error(`✗ BrickLink sync error for inventory ${inventoryId}:`, error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Synchronize a single inventory item's quantity across all selling platforms
 * 
 * This app is the source of truth for inventory quantities.
 * When inventory changes here (via order shipment, cancellation, manual adjustment),
 * the new quantity propagates to BrickLink and BrickOwl.
 * 
 * @param inventoryId - BrickLink inventory ID
 * @param newQuantity - New quantity to set on all platforms
 */
export async function syncInventoryItemAcrossPlatforms(
  inventoryId: string,
  newQuantity: number
): Promise<CrossPlatformSyncResult> {
  console.log(`\n🌐 Cross-platform sync: inventory ${inventoryId} → ${newQuantity}`);
  
  const platformResults: PlatformSyncResult[] = [];
  
  // BrickLink sync (source of truth for catalog, but this app controls quantity)
  const bricklinkResult = await updateBrickLinkQuantity(inventoryId, newQuantity);
  platformResults.push({
    platform: 'BrickLink',
    success: bricklinkResult.success,
    itemsUpdated: bricklinkResult.success ? 1 : 0,
    errors: bricklinkResult.error ? [bricklinkResult.error] : [],
  });
  
  // Add delay between platform API calls to avoid rate limits
  await new Promise(resolve => setTimeout(resolve, 150));
  
  // BrickOwl sync
  const brickowlResult = await updateBrickOwlQuantity(inventoryId, newQuantity);
  platformResults.push({
    platform: 'BrickOwl',
    success: brickowlResult.success,
    itemsUpdated: brickowlResult.success ? 1 : 0,
    errors: brickowlResult.error ? [brickowlResult.error] : [],
  });
  
  const totalItemsUpdated = platformResults.reduce((sum, r) => sum + r.itemsUpdated, 0);
  const totalErrors = platformResults.reduce((sum, r) => sum + r.errors.length, 0);
  
  const allSuccessful = platformResults.every(r => r.success);
  
  console.log(`🌐 Cross-platform sync complete: ${totalItemsUpdated} platforms updated, ${totalErrors} errors`);
  
  return {
    success: allSuccessful,
    platforms: platformResults,
    totalItemsUpdated,
    totalErrors,
  };
}

/**
 * Bulk synchronization: Update multiple inventory items across all platforms
 * 
 * Used when processing multiple order line items
 * Runs asynchronously for each item (fire-and-forget)
 * 
 * @param items - Array of {inventoryId, newQuantity} objects
 */
export async function syncMultipleItemsAcrossPlatforms(
  items: Array<{ inventoryId: string; newQuantity: number }>
): Promise<void> {
  console.log(`\n🌐 Starting bulk cross-platform sync for ${items.length} items...`);
  
  // Fire off all syncs asynchronously (don't wait for completion)
  // This prevents blocking order processing while platform APIs complete
  const syncPromises = items.map(({ inventoryId, newQuantity }) => 
    syncInventoryItemAcrossPlatforms(inventoryId, newQuantity)
      .catch(error => {
        console.error(`✗ Cross-platform sync failed for ${inventoryId}:`, error);
      })
  );
  
  // Don't await - let syncs complete in background
  Promise.allSettled(syncPromises).then(results => {
    const successful = results.filter(r => r.status === 'fulfilled').length;
    console.log(`🌐 Bulk sync completed: ${successful}/${items.length} items synced across platforms`);
  });
}

import { db } from '../db';
import { blInventory } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { updateBrickOwlLot, getBrickOwlInventory } from './brickowl';

/**
 * Cross-Platform Inventory Synchronization Service
 * 
 * Industry standard: Item-by-item asynchronous updates across all selling platforms
 * when BrickLink inventory changes (via order shipments, cancellations, manual adjustments)
 * 
 * Supported Platforms:
 * - BrickOwl (implemented)
 * - eBay (pending credentials)
 * - BigCommerce (pending credentials)
 * - Amazon (pending credentials)
 * - Etsy (pending credentials)
 * - Facebook Marketplace (pending credentials)
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
 * TODO: Implement when eBay credentials are configured
 */
async function updateEbayQuantity(
  inventoryId: string,
  newQuantity: number
): Promise<{ success: boolean; error?: string }> {
  // Check if eBay credentials are configured
  if (!process.env.EBAY_API_KEY) {
    return { success: false, error: 'eBay credentials not configured' };
  }
  
  // TODO: Implement eBay inventory update API call
  console.log(`⏭ eBay: Skipping (not implemented) - inventory ${inventoryId} → ${newQuantity}`);
  return { success: false, error: 'eBay sync not implemented' };
}

/**
 * Update a single inventory item's quantity on BigCommerce
 * TODO: Implement when BigCommerce credentials are configured
 */
async function updateBigCommerceQuantity(
  inventoryId: string,
  newQuantity: number
): Promise<{ success: boolean; error?: string }> {
  if (!process.env.BIGCOMMERCE_API_KEY) {
    return { success: false, error: 'BigCommerce credentials not configured' };
  }
  
  // TODO: Implement BigCommerce inventory update API call
  console.log(`⏭ BigCommerce: Skipping (not implemented) - inventory ${inventoryId} → ${newQuantity}`);
  return { success: false, error: 'BigCommerce sync not implemented' };
}

/**
 * Update a single inventory item's quantity on Amazon
 * TODO: Implement when Amazon credentials are configured
 */
async function updateAmazonQuantity(
  inventoryId: string,
  newQuantity: number
): Promise<{ success: boolean; error?: string }> {
  if (!process.env.AMAZON_API_KEY) {
    return { success: false, error: 'Amazon credentials not configured' };
  }
  
  // TODO: Implement Amazon inventory update API call
  console.log(`⏭ Amazon: Skipping (not implemented) - inventory ${inventoryId} → ${newQuantity}`);
  return { success: false, error: 'Amazon sync not implemented' };
}

/**
 * Synchronize a single inventory item's quantity across all selling platforms
 * 
 * Called after BrickLink inventory changes (order shipment, cancellation, manual adjustment)
 * Runs asynchronously - does not block order processing
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
  
  // BrickOwl sync
  const brickowlResult = await updateBrickOwlQuantity(inventoryId, newQuantity);
  platformResults.push({
    platform: 'BrickOwl',
    success: brickowlResult.success,
    itemsUpdated: brickowlResult.success ? 1 : 0,
    errors: brickowlResult.error ? [brickowlResult.error] : [],
  });
  
  // Add delays between platform API calls to avoid rate limits
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // eBay sync
  const ebayResult = await updateEbayQuantity(inventoryId, newQuantity);
  platformResults.push({
    platform: 'eBay',
    success: ebayResult.success,
    itemsUpdated: ebayResult.success ? 1 : 0,
    errors: ebayResult.error ? [ebayResult.error] : [],
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // BigCommerce sync
  const bigcommerceResult = await updateBigCommerceQuantity(inventoryId, newQuantity);
  platformResults.push({
    platform: 'BigCommerce',
    success: bigcommerceResult.success,
    itemsUpdated: bigcommerceResult.success ? 1 : 0,
    errors: bigcommerceResult.error ? [bigcommerceResult.error] : [],
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Amazon sync
  const amazonResult = await updateAmazonQuantity(inventoryId, newQuantity);
  platformResults.push({
    platform: 'Amazon',
    success: amazonResult.success,
    itemsUpdated: amazonResult.success ? 1 : 0,
    errors: amazonResult.error ? [amazonResult.error] : [],
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

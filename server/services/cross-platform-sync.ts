import { db } from '../db';
import { blInventory } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { updateBrickOwlLot, getBrickOwlInventory } from './brickowl';

/**
 * Cross-Platform Inventory Synchronization Service
 * 
 * BrickLink is the source of truth — it manages its own inventory quantities
 * when orders are placed and shipped through it. We do NOT push quantities
 * back to BrickLink; doing so interferes with BrickLink's own order-based
 * inventory management and causes inflation.
 * 
 * This service propagates inventory changes to secondary platforms only:
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

async function updateEbayQuantity(
  inventoryId: string,
  newQuantity: number
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  return { success: true, skipped: true };
}

async function updateBigCommerceQuantity(
  inventoryId: string,
  newQuantity: number
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  return { success: true, skipped: true };
}

async function updateAmazonQuantity(
  inventoryId: string,
  newQuantity: number
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  return { success: true, skipped: true };
}

/**
 * Synchronize a single inventory item's quantity across secondary selling platforms.
 * 
 * BrickLink is intentionally excluded — it manages its own inventory based on
 * orders placed through it. Pushing quantities to BrickLink causes double-adjustments
 * because BrickLink already deducts when an order is paid and we would overwrite
 * or add on top of that.
 * 
 * @param inventoryId - BrickLink inventory ID
 * @param newQuantity - New quantity to set on secondary platforms
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

  // Future platforms (eBay, BigCommerce, Amazon) go here

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
 * Bulk synchronization: Update multiple inventory items across secondary platforms
 */
export async function syncMultipleItemsAcrossPlatforms(
  items: Array<{ inventoryId: string; newQuantity: number }>
): Promise<void> {
  console.log(`\n🌐 Starting bulk cross-platform sync for ${items.length} items...`);
  
  const syncPromises = items.map(({ inventoryId, newQuantity }) => 
    syncInventoryItemAcrossPlatforms(inventoryId, newQuantity)
      .catch(error => {
        console.error(`✗ Cross-platform sync failed for ${inventoryId}:`, error);
      })
  );
  
  Promise.allSettled(syncPromises).then(results => {
    const successful = results.filter(r => r.status === 'fulfilled').length;
    console.log(`🌐 Bulk sync completed: ${successful}/${items.length} items synced across platforms`);
  });
}

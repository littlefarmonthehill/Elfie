import { db } from "../db";
import { blInventory, orders, orderDetails } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { shouldAdjustInventory } from "../config/order-status-mapping";
import { syncMultipleItemsAcrossPlatforms } from "./cross-platform-sync";

/**
 * Adjust inventory based on order status change
 * 
 * This service implements the critical inventory logic:
 * - Reduce inventory ONLY when order ships (any status → 'shipped')
 * - Restore inventory ONLY when shipped order is cancelled/returned ('shipped' → 'cancelled'/'returned')
 * - No adjustment for orders cancelled before shipping
 */
export async function adjustInventoryForOrder(orderId: string) {
  // Get order with current and previous status
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  // Check if inventory adjustment is needed
  const { shouldAdjust, impact } = shouldAdjustInventory(
    order.previousStatus || null,
    order.orderStatus
  );

  if (!shouldAdjust) {
    console.log(`No inventory adjustment needed for order ${orderId}: ${order.previousStatus} → ${order.orderStatus}`);
    return {
      adjusted: false,
      reason: `No adjustment needed for status change: ${order.previousStatus || 'new'} → ${order.orderStatus}`
    };
  }

  // Get order line items with BrickLink inventory IDs
  const lineItems = await db
    .select()
    .from(orderDetails)
    .where(eq(orderDetails.orderId, orderId));

  const adjustments: Array<{ inventoryId: number; quantity: number; action: string }> = [];
  const errors: Array<{ inventoryId: number | null; sku: string; error: string }> = [];

  // Process each line item
  for (const item of lineItems) {
    if (!item.bricklinkInventoryId) {
      errors.push({
        inventoryId: null,
        sku: item.sku || 'unknown',
        error: 'No BrickLink inventory ID found'
      });
      continue;
    }

    const adjustmentQty = item.quantity;
    
    try {
      if (impact === 'reduce') {
        // Reduce inventory when order ships
        await db
          .update(blInventory)
          .set({
            quantity: sql`GREATEST(0, ${blInventory.quantity} - ${adjustmentQty})`, // Prevent negative inventory
            updatedAt: new Date()
          })
          .where(eq(blInventory.id, item.bricklinkInventoryId));

        adjustments.push({
          inventoryId: item.bricklinkInventoryId,
          quantity: adjustmentQty,
          action: 'reduced'
        });
      } else if (impact === 'restore') {
        // Restore inventory when shipped order is cancelled/returned
        await db
          .update(blInventory)
          .set({
            quantity: sql`${blInventory.quantity} + ${adjustmentQty}`,
            updatedAt: new Date()
          })
          .where(eq(blInventory.id, item.bricklinkInventoryId));

        adjustments.push({
          inventoryId: item.bricklinkInventoryId,
          quantity: adjustmentQty,
          action: 'restored'
        });
      }
    } catch (error) {
      errors.push({
        inventoryId: item.bricklinkInventoryId,
        sku: item.sku || 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  console.log(`📦 Inventory adjusted for order ${orderId}:`, {
    statusChange: `${order.previousStatus || 'new'} → ${order.orderStatus}`,
    impact,
    adjustments: adjustments.length,
    errors: errors.length
  });

  // Trigger cross-platform inventory sync for all adjusted items
  // Fire-and-forget async - don't block order processing
  if (adjustments.length > 0) {
    (async () => {
      try {
        // Fetch updated quantities from database
        const itemsToSync: Array<{ inventoryId: string; newQuantity: number }> = [];
        
        for (const adjustment of adjustments) {
          const [inventoryItem] = await db
            .select()
            .from(blInventory)
            .where(eq(blInventory.id, adjustment.inventoryId))
            .limit(1);
          
          if (inventoryItem) {
            itemsToSync.push({
              inventoryId: inventoryItem.id.toString(),
              newQuantity: inventoryItem.quantity,
            });
          }
        }
        
        // Sync to all platforms (BrickOwl, eBay, BigCommerce, Amazon, etc.)
        if (itemsToSync.length > 0) {
          await syncMultipleItemsAcrossPlatforms(itemsToSync);
        }
      } catch (error) {
        console.error(`⚠️ Cross-platform sync failed for order ${orderId}:`, error);
        // Don't throw - sync failures should not block order processing
      }
    })();
  }

  return {
    adjusted: true,
    impact,
    statusChange: `${order.previousStatus || 'new'} → ${order.orderStatus}`,
    adjustments,
    errors
  };
}

/**
 * Update order status and trigger inventory adjustment
 * 
 * This function:
 * 1. Updates the order status
 * 2. Stores the previous status for transition tracking
 * 3. Triggers inventory adjustment based on status change
 */
export async function updateOrderStatus(orderId: string, newStatus: string) {
  // Get current order
  const [currentOrder] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!currentOrder) {
    throw new Error(`Order ${orderId} not found`);
  }

  // Update order status and store previous status
  await db
    .update(orders)
    .set({
      previousStatus: currentOrder.orderStatus, // Store current status as previous
      orderStatus: newStatus,
      updatedAt: new Date()
    })
    .where(eq(orders.id, orderId));

  // Adjust inventory based on status change
  const result = await adjustInventoryForOrder(orderId);

  return result;
}

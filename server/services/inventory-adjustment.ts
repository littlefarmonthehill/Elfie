import { db } from "../db";
import { blInventory, orders, orderDetails } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { syncMultipleItemsAcrossPlatforms, SyncItem } from "./cross-platform-sync";

/**
 * Adjust inventory based on order state.
 *
 * New timing rules:
 * - REDUCE inventory immediately when an order arrives (any active status), not at ship time.
 * - RESTORE inventory when an order is cancelled or returned (regardless of ship status).
 * - The `inventoryDeducted` flag on the order prevents double-adjustment.
 * - The source platform is excluded from cross-platform sync; all others are updated.
 */
export async function adjustInventoryForOrder(orderId: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const toStatus = order.orderStatus;
  const isActive = !['cancelled', 'returned'].includes(toStatus);
  const isCancelledOrReturned = toStatus === 'cancelled' || toStatus === 'returned';

  let impact: 'reduce' | 'restore' | 'none' = 'none';

  if (!order.inventoryDeducted && isActive) {
    // First time we're seeing this order in an active state — reduce inventory now
    impact = 'reduce';
  } else if (order.inventoryDeducted && isCancelledOrReturned) {
    // Inventory was previously deducted and now the order is cancelled/returned — restore it
    impact = 'restore';
  } else {
    console.log(`No inventory adjustment needed for order ${orderId}: status=${toStatus}, inventoryDeducted=${order.inventoryDeducted}`);
    return {
      adjusted: false,
      reason: `No adjustment needed (status=${toStatus}, inventoryDeducted=${order.inventoryDeducted})`
    };
  }

  const lineItems = await db
    .select()
    .from(orderDetails)
    .where(eq(orderDetails.orderId, orderId));

  const adjustments: Array<{ inventoryId: number; quantityChange: number; action: string }> = [];
  const errors: Array<{ inventoryId: number | null; sku: string; error: string }> = [];

  for (const item of lineItems) {
    if (!item.bricklinkInventoryId) {
      errors.push({
        inventoryId: null,
        sku: item.sku || 'unknown',
        error: 'No BrickLink inventory ID found'
      });
      continue;
    }

    const qty = item.quantity;

    try {
      if (impact === 'reduce') {
        await db
          .update(blInventory)
          .set({
            quantity: sql`GREATEST(0, ${blInventory.quantity} - ${qty})`,
            updatedAt: new Date()
          })
          .where(eq(blInventory.id, item.bricklinkInventoryId));

        adjustments.push({ inventoryId: item.bricklinkInventoryId, quantityChange: -qty, action: 'reduced' });
      } else if (impact === 'restore') {
        await db
          .update(blInventory)
          .set({
            quantity: sql`${blInventory.quantity} + ${qty}`,
            updatedAt: new Date()
          })
          .where(eq(blInventory.id, item.bricklinkInventoryId));

        adjustments.push({ inventoryId: item.bricklinkInventoryId, quantityChange: qty, action: 'restored' });
      }
    } catch (error) {
      errors.push({
        inventoryId: item.bricklinkInventoryId,
        sku: item.sku || 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Update the inventoryDeducted flag on the order
  await db
    .update(orders)
    .set({ inventoryDeducted: impact === 'reduce' })
    .where(eq(orders.id, orderId));

  console.log(`📦 Inventory adjusted for order ${orderId}:`, {
    status: toStatus,
    impact,
    adjustments: adjustments.length,
    errors: errors.length
  });

  // Cross-platform sync — fire-and-forget
  if (adjustments.length > 0) {
    const sourcePlatform = order.marketplace || 'unknown';

    (async () => {
      try {
        const itemsToSync: SyncItem[] = [];

        for (const adj of adjustments) {
          const [inventoryItem] = await db
            .select()
            .from(blInventory)
            .where(eq(blInventory.id, adj.inventoryId))
            .limit(1);

          if (inventoryItem) {
            itemsToSync.push({
              inventoryId: inventoryItem.id.toString(),
              newQuantity: inventoryItem.quantity,       // Absolute — for BrickOwl
              quantityDelta: adj.quantityChange,          // Delta — for BrickLink
              sourcePlatform,
              orgId: order.orgId,                        // Use org credentials, not platform
            });
          }
        }

        if (itemsToSync.length > 0) {
          await syncMultipleItemsAcrossPlatforms(itemsToSync);
        }
      } catch (error) {
        console.error(`⚠️ Cross-platform sync failed for order ${orderId}:`, error);
      }
    })();
  }

  return {
    adjusted: true,
    impact,
    status: toStatus,
    adjustments,
    errors
  };
}

/**
 * Update order status and trigger inventory adjustment.
 */
export async function updateOrderStatus(orderId: string, newStatus: string) {
  const [currentOrder] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!currentOrder) {
    throw new Error(`Order ${orderId} not found`);
  }

  // When returning to an active status, also reset workflowStatus so the order
  // is not filtered out of the fulfillment queue (which hides 'done' orders).
  const activeStatuses = ['awaiting_payment', 'awaiting_fulfillment', 'awaiting_shipment'];
  const resetWorkflow = activeStatuses.includes(newStatus) && currentOrder.workflowStatus === 'done';

  await db
    .update(orders)
    .set({
      previousStatus: currentOrder.orderStatus,
      orderStatus: newStatus,
      ...(resetWorkflow ? { workflowStatus: 'new' } : {}),
      updatedAt: new Date()
    })
    .where(eq(orders.id, orderId));

  const result = await adjustInventoryForOrder(orderId);
  return result;
}

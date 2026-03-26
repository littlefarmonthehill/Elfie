import { db } from "../db";
import { blInventory, orders, orderDetails } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { syncMultipleItemsAcrossPlatforms, SyncItem } from "./cross-platform-sync";
import { recordInventoryChanges } from "./inventory-history";

/**
 * Adjust inventory based on order state.
 *
 * New timing rules:
 * - REDUCE inventory immediately when an order arrives (any active status), not at ship time.
 * - RESTORE inventory when an order is cancelled or returned (regardless of ship status).
 * - The `inventoryDeducted` flag on the order prevents double-adjustment.
 * - The source platform is excluded from cross-platform sync; all others are updated.
 *
 * Race-condition safety:
 * - The `inventoryDeducted` flag is updated via an atomic conditional UPDATE that acts
 *   as an optimistic lock. If two concurrent calls both read `inventoryDeducted=false`
 *   before either writes, only the first DB update (which includes `WHERE inventory_deducted=false`)
 *   will affect a row — the second returns 0 rows and exits immediately. This eliminates
 *   the BO status-change + merge race that previously caused double BrickLink deductions.
 */
export async function adjustInventoryForOrder(
  orderId: string,
  _caller?: string,
  options?: { skipCrossPlatformSync?: boolean }
) {
  const callerTag = _caller ? ` [caller:${_caller}]` : '';
  console.log(`🔍 [AdjInv] adjustInventoryForOrder called for ${orderId}${callerTag}`);
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

  // ATOMIC CLAIM — prevents duplicate concurrent adjustments for the same order.
  // By updating inventoryDeducted FIRST under a conditional WHERE, we guarantee
  // that only one concurrent caller can proceed even if both read the flag as
  // false/true simultaneously (e.g. status-change call + merge call in the same sync cycle).
  const claimed = await db
    .update(orders)
    .set({ inventoryDeducted: impact === 'reduce' })
    .where(and(
      eq(orders.id, orderId),
      impact === 'reduce'
        ? eq(orders.inventoryDeducted, false)   // can only reduce if not yet deducted
        : eq(orders.inventoryDeducted, true)    // can only restore if previously deducted
    ))
    .returning({ id: orders.id });

  if (claimed.length === 0) {
    console.log(`⏭️ Inventory adjustment for order ${orderId} skipped — already claimed by a concurrent call (inventoryDeducted already at target state)`);
    return {
      adjusted: false,
      reason: `Concurrent claim: inventoryDeducted already at target state for impact=${impact}`,
    };
  }

  const lineItems = await db
    .select()
    .from(orderDetails)
    .where(eq(orderDetails.orderId, orderId));

  // Deduplicate by bricklinkInventoryId — sum quantities so that any duplicate
  // order_detail rows (e.g. from a BrickOwl lot_id rotation creating a second row
  // before the guard was in place) never cause the same BL inventory to be
  // adjusted twice in a single pass.
  const dedupedItems = new Map<number, { inventoryId: number; totalQty: number; sku: string }>();
  const noIdItems: Array<{ sku: string }> = [];

  for (const item of lineItems) {
    if (!item.bricklinkInventoryId) {
      noIdItems.push({ sku: item.sku || 'unknown' });
      continue;
    }
    const existing = dedupedItems.get(item.bricklinkInventoryId);
    if (existing) {
      existing.totalQty += item.quantity;
      console.warn(`⚠️ [AdjInv] Duplicate order_detail row for BL inv ${item.bricklinkInventoryId} on order ${orderId} — quantities merged (${existing.totalQty - item.quantity} + ${item.quantity})`);
    } else {
      dedupedItems.set(item.bricklinkInventoryId, {
        inventoryId: item.bricklinkInventoryId,
        totalQty: item.quantity,
        sku: item.sku || 'unknown',
      });
    }
  }

  const adjustments: Array<{ inventoryId: number; quantityChange: number; action: string }> = [];
  const errors: Array<{ inventoryId: number | null; sku: string; error: string }> = [];

  for (const { sku } of noIdItems) {
    errors.push({ inventoryId: null, sku, error: 'No BrickLink inventory ID found' });
  }

  for (const { inventoryId: invId, totalQty: qty, sku } of dedupedItems.values()) {
    const item = { bricklinkInventoryId: invId, quantity: qty, sku };

    try {
      const [currentItem] = await db
        .select()
        .from(blInventory)
        .where(eq(blInventory.id, item.bricklinkInventoryId))
        .limit(1);

      if (impact === 'reduce') {
        await db
          .update(blInventory)
          .set({
            quantity: sql`GREATEST(0, ${blInventory.quantity} - ${qty})`,
            updatedAt: new Date()
          })
          .where(eq(blInventory.id, item.bricklinkInventoryId));

        const oldQty = currentItem?.quantity ?? 0;
        const newQty = Math.max(0, oldQty - qty);
        await recordInventoryChanges([{
          orgId: order.orgId,
          inventoryId: item.bricklinkInventoryId,
          itemNo: currentItem?.itemNo ?? item.sku ?? 'unknown',
          colorId: currentItem?.colorId ?? null,
          source: 'order',
          sourceRef: order.id,
          field: 'quantity',
          oldValue: String(oldQty),
          newValue: String(newQty),
        }]);
        adjustments.push({ inventoryId: item.bricklinkInventoryId, quantityChange: -qty, action: 'reduced' });
      } else if (impact === 'restore') {
        await db
          .update(blInventory)
          .set({
            quantity: sql`${blInventory.quantity} + ${qty}`,
            updatedAt: new Date()
          })
          .where(eq(blInventory.id, item.bricklinkInventoryId));

        const oldQty = currentItem?.quantity ?? 0;
        const newQty = oldQty + qty;
        await recordInventoryChanges([{
          orgId: order.orgId,
          inventoryId: item.bricklinkInventoryId,
          itemNo: currentItem?.itemNo ?? item.sku ?? 'unknown',
          colorId: currentItem?.colorId ?? null,
          source: 'order_restore',
          sourceRef: order.id,
          field: 'quantity',
          oldValue: String(oldQty),
          newValue: String(newQty),
        }]);
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

  console.log(`📦 Inventory adjusted for order ${orderId}:`, {
    status: toStatus,
    impact,
    adjustments: adjustments.length,
    errors: errors.length
  });

  // Cross-platform sync — fire-and-forget
  // Skipped when skipCrossPlatformSync is true (e.g. BO manual returns — let the
  // scheduled sync push the restored quantities to external channels on its own cycle).
  if (adjustments.length > 0 && !options?.skipCrossPlatformSync) {
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
  } else if (adjustments.length > 0 && options?.skipCrossPlatformSync) {
    console.log(`⏭️ [AdjInv] Cross-platform sync skipped for order ${orderId} (skipCrossPlatformSync=true) — ${adjustments.length} local adjustment(s) made, channels will update on next scheduled sync.`);
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
export async function updateOrderStatus(orderId: string, newStatus: string, options?: { skipCrossPlatformSync?: boolean }) {
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

  const result = await adjustInventoryForOrder(orderId, undefined, options);
  return result;
}

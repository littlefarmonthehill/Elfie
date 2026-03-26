import { db } from "../db";
import { orders, orderDetails, orderAdjustments, channelLotLinks, syncMetadata } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getBrickOwlOrders, getBrickOwlOrderDetails, mapBrickOwlStatus } from "./brickowl-orders";
import { adjustInventoryForOrder } from "./inventory-adjustment";
import { upsertSyncMetadata, resolveExistingOrder, resolveOrderStatus } from "./order-sync-helpers";

const BO_CHANNEL = 'brickowl' as const;

const SYNC_ID = 'brickowl_orders';

export interface BrickOwlOrderSyncResult {
  ordersAdded: number;
  ordersUpdated: number;
  orderDetailsAdded: number;
  totalOrders: number;
  errors: string[];
}

/**
 * Sync orders directly from BrickOwl API.
 *
 * Uses timestamp-based incremental sync: fetches only orders placed since the last
 * successful sync (with a 4-hour lookback buffer to cover edge cases).
 * Full sync mode fetches all orders regardless of timestamp.
 */
export async function syncBrickOwlOrders(
  apiKey: string,
  orgId: string,
  options: { limit?: number; fullSync?: boolean; sinceDate?: string } = {},
  onProgress?: (processed: number, total: number) => void
): Promise<BrickOwlOrderSyncResult> {
  const result: BrickOwlOrderSyncResult = {
    ordersAdded: 0,
    ordersUpdated: 0,
    orderDetailsAdded: 0,
    totalOrders: 0,
    errors: [],
  };

  try {
    console.log(`\n🦉 Starting BrickOwl order sync...`);

    // Determine lookback timestamp for incremental sync.
    // We use update_time (not order_time) so that merges, status changes, and item
    // additions on older orders are all caught — not just newly placed orders.
    let updateTime: number | undefined = undefined;
    let orderTime: number | undefined = undefined; // only used for explicit sinceDate fallback

    if (options.sinceDate) {
      // Explicit "from date" — filter by order placement time for date-scoped historical pulls
      orderTime = Math.floor(new Date(options.sinceDate).getTime() / 1000);
      console.log(`📅 Date-scoped sync: fetching orders placed since ${options.sinceDate}`);
    } else if (!options.fullSync) {
      const [previousSync] = await db
        .select()
        .from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, SYNC_ID)))
        .limit(1);

      if (previousSync?.lastSyncTime) {
        // Use update_time with a 30-minute lookback buffer.
        // Shorter buffer is fine here because update_time catches modifications, not just creation.
        const LOOKBACK_SECONDS = 30 * 60;
        updateTime = Math.floor(previousSync.lastSyncTime.getTime() / 1000) - LOOKBACK_SECONDS;
        const lookbackDate = new Date(updateTime * 1000);
        console.log(`📅 Incremental sync: fetching orders updated since ${lookbackDate.toISOString()} (30m lookback from last sync at ${previousSync.lastSyncTime.toISOString()})`);
      } else {
        console.log(`🔄 No previous sync found — performing full sync`);
      }
    } else {
      console.log(`🔄 Full sync requested`);
    }

    // Build the canonical BO lot_id → BL inventory ID map from channel_lot_links.
    // This is a single indexed DB query — no external API call needed.
    // For lots not yet in the table the per-item fallback reads external_lot_ids.other
    // from the order item itself (populated by BrickOwl from the external_id we set on create).
    console.log(`🦉 Building lot→BL inventory map from channel_lot_links...`);
    let boLotToBlInvId = new Map<string, number>();
    try {
      const links = await db
        .select({ channelLotId: channelLotLinks.channelLotId, blInvId: channelLotLinks.blInvId })
        .from(channelLotLinks)
        .where(and(eq(channelLotLinks.orgId, orgId), eq(channelLotLinks.channel, BO_CHANNEL)));
      for (const link of links) {
        boLotToBlInvId.set(link.channelLotId, link.blInvId);
      }
      console.log(`🦉 Built lot map: ${boLotToBlInvId.size} BO lots linked to BL inventory`);
    } catch (err: any) {
      console.warn(`⚠️ Could not query channel_lot_links for lot map (will fall back to order item data): ${err.message}`);
    }

    const boOrders = await getBrickOwlOrders(apiKey, { limit: options.limit, updateTime, orderTime });
    result.totalOrders = boOrders.length;
    console.log(`🦉 Fetched ${result.totalOrders} orders from BrickOwl`);

    let processed = 0;
    for (const boOrder of boOrders) {
      try {
        await processBrickOwlOrder(boOrder, orgId, apiKey, result, boLotToBlInvId);
      } catch (error: any) {
        console.error(`✗ Error processing BrickOwl order ${boOrder.order_id}:`, error);
        result.errors.push(`Order ${boOrder.order_id}: ${error.message}`);
      }
      processed++;
      onProgress?.(processed, boOrders.length);
    }

    await upsertSyncMetadata(SYNC_ID, orgId, {
      status: 'success',
      recordsAdded: result.ordersAdded,
      recordsUpdated: result.ordersUpdated,
    });

    console.log(`✓ BrickOwl order sync complete:`, {
      ordersAdded: result.ordersAdded,
      ordersUpdated: result.ordersUpdated,
      orderDetailsAdded: result.orderDetailsAdded,
      errors: result.errors.length,
    });

    return result;

  } catch (error: any) {
    console.error('✗ BrickOwl order sync failed:', error);
    await upsertSyncMetadata(SYNC_ID, orgId, { status: 'error', errorMessage: error.message });
    throw error;
  }
}

/**
 * Safely parse a timestamp to a Date, preferring ISO format over Unix timestamp.
 */
function safeTimestampToDate(isoString: string | null | undefined, unixTimestamp: number | null | undefined): Date | null {
  if (isoString) {
    const date = new Date(isoString);
    if (!isNaN(date.getTime())) return date;
  }
  if (unixTimestamp) {
    const date = new Date(unixTimestamp * 1000);
    if (!isNaN(date.getTime())) return date;
  }
  return null;
}

/**
 * Process a single BrickOwl order: upsert the order record, upsert line items,
 * and trigger inventory adjustments.
 */
async function processBrickOwlOrder(
  boOrder: any,
  orgId: string,
  apiKey: string,
  result: BrickOwlOrderSyncResult,
  boLotToBlInvId: Map<string, number> = new Map()
): Promise<void> {
  const orderId = `bo-${boOrder.order_id}`;

  // Canonical ID → "BO." prefix format → plain numeric (covers all legacy record formats)
  const existingOrder = await resolveExistingOrder(
    orderId,
    `BO.${boOrder.order_id}`,
    String(boOrder.order_id)
  );

  const normalizedStatus = mapBrickOwlStatus(boOrder.status_id, boOrder.status ?? boOrder.status_name);
  const effectiveOrderId = existingOrder?.id ?? orderId;

  const brickOwlOrderData = await getBrickOwlOrderDetails(apiKey, boOrder.order_id);

  const orderDate =
    safeTimestampToDate(boOrder.iso_order_time, boOrder.order_time) ??
    safeTimestampToDate(brickOwlOrderData.iso_order_time, brickOwlOrderData.order_time) ??
    new Date();

  let isNewOrder = false;

  const orderData = {
    id: orderId,
    orderNumber: boOrder.order_id.toString(),
    orderKey: `BO.${boOrder.order_id}`,
    marketplace: 'BrickOwl',
    orderDate,
    orderStatus: normalizedStatus,
    previousStatus: existingOrder?.orderStatus || null,
    customerUsername: brickOwlOrderData.buyer_name || null,
    customerEmail: brickOwlOrderData.buyer_email || null,
    shipTo: JSON.stringify({
      name: brickOwlOrderData.ship_name || '',
      address1: brickOwlOrderData.ship_street_1 || '',
      address2: brickOwlOrderData.ship_street_2 || '',
      city: brickOwlOrderData.ship_city || '',
      state: brickOwlOrderData.ship_region || '',
      postalCode: brickOwlOrderData.ship_post_code || '',
      country: brickOwlOrderData.ship_country_code || '',
    }),
    billTo: null,
    shipByDate: null,
    orderTotal: (
      brickOwlOrderData.grand_total ??
      brickOwlOrderData.total_price ??
      brickOwlOrderData.base_order_amount ??
      brickOwlOrderData.order_total ??
      brickOwlOrderData.total ??
      brickOwlOrderData.sub_total ??
      0
    ).toString(),
    shippingAmount: (
      // Confirmed field name from BrickOwl order/view endpoint
      brickOwlOrderData.ship_total ??
      // Fallback aliases (undocumented / older API versions)
      brickOwlOrderData.base_ship_amount ??
      brickOwlOrderData.ship_cost ??
      brickOwlOrderData.shipping_cost ??
      brickOwlOrderData.total_shipping ??
      brickOwlOrderData.shipping ??
      // boOrder is from order/list which does NOT carry ship_total — last resort only
      boOrder.ship_total ??
      0
    ).toString(),
    taxAmount: (
      brickOwlOrderData.tax_amount ??
      brickOwlOrderData.vat ??
      brickOwlOrderData.vat_amount ??
      brickOwlOrderData.tax ??
      0
    ).toString(),
    internalNotes: null,
    customerNotes: brickOwlOrderData.buyer_notes || null,
    requestedShippingService: brickOwlOrderData.ship_method_name || null,
    carrierCode: null,
    serviceCode: null,
    updatedAt: new Date(),
  };

  if (!existingOrder) {
    await db.insert(orders).values([{ ...orderData, orgId }]);
    result.ordersAdded++;
    isNewOrder = true;
  } else {
    const { status: updatedStatus, wasDemotionBlocked, isShippedCancellation } = resolveOrderStatus(
      existingOrder.orderStatus,
      normalizedStatus
    );

    if (wasDemotionBlocked) {
      console.log(`🔒 BrickOwl order ${effectiveOrderId}: Preserving local shipped status (BrickOwl shows: ${normalizedStatus})`);
    }

    await db
      .update(orders)
      .set({
        ...orderData,
        id: existingOrder.id,
        orderStatus: updatedStatus,
        previousStatus: existingOrder.orderStatus,
      })
      .where(eq(orders.id, effectiveOrderId));

    result.ordersUpdated++;

    if (existingOrder.orderStatus !== updatedStatus) {
      console.log(`📦 BrickOwl order ${effectiveOrderId} status changed: ${existingOrder.orderStatus} → ${updatedStatus}`);

      if (isShippedCancellation) {
        // Seller cancelled a shipped order on BrickOwl's side — treat this the same way
        // BrickLink handles returns: restore local inventory but skip cross-platform sync.
        // The scheduled channel sync will propagate the restored quantities on its own cycle.
        console.log(`↩️ BrickOwl order ${effectiveOrderId} cancelled after shipping — restoring local inventory (no cross-platform push)`);

        // Record a refund adjustment (idempotent — keyed on the external transaction ID).
        // BrickOwl overwrites the order total on cancel, so we use whatever amount their
        // API last returned as the refund figure, same as the BrickLink return flow does.
        const externalId = `bo-${boOrder.order_id}-cancel`;
        const refundAmount = Number(orderData.orderTotal);
        if (refundAmount > 0) {
          const [existingAdj] = await db
            .select({ id: orderAdjustments.id })
            .from(orderAdjustments)
            .where(eq(orderAdjustments.externalTransactionId, externalId))
            .limit(1);
          if (!existingAdj) {
            await db.insert(orderAdjustments).values({
              orderId: effectiveOrderId,
              orgId,
              type: 'refund',
              amount: (-refundAmount).toFixed(2),
              paymentMethod: 'brickowl',
              externalTransactionId: externalId,
              reason: 'Customer cancellation after shipment',
              notes: `BrickOwl order ${boOrder.order_id} cancelled after shipping — refund of $${refundAmount.toFixed(2)}`,
            });
            console.log(`↩️ BrickOwl order ${effectiveOrderId}: recorded refund adjustment of -$${refundAmount.toFixed(2)}`);
          }
        } else {
          console.warn(`⚠️ BrickOwl order ${effectiveOrderId}: cancelled after shipping but order total is missing or zero — refund adjustment NOT recorded`);
        }

        adjustInventoryForOrder(effectiveOrderId, 'bo-shipped-cancel', { skipCrossPlatformSync: true }).catch(error => {
          console.error(`⚠️ Inventory restore failed for cancelled BrickOwl order ${effectiveOrderId}:`, error);
        });
      } else {
        adjustInventoryForOrder(effectiveOrderId, 'bo-status-change').catch(error => {
          console.error(`⚠️ Inventory adjustment failed for BrickOwl order ${effectiveOrderId}:`, error);
        });
      }
    }
  }

  // Process order line items.
  // We do a full upsert pass on every sync so that merges (where BrickOwl adds items
  // or increases quantities on an existing order) are reflected immediately.
  const items = brickOwlOrderData.items || [];
  console.log(`🦉 Order ${effectiveOrderId}: Processing ${items.length} items`);

  let itemsChanged = false;

  // Collect incremental items produced by a merge:
  // — for quantity increases on existing items: the delta quantity
  // — for genuinely new items: the full quantity
  const deltaItems: Array<{
    item: any;
    brickLinkInvId: number | null;
    deltaQty: number;
  }> = [];

  for (const item of items) {
    try {
      const lineItemKey = `${boOrder.order_id}-${item.lot_id}`;

      const [existingItem] = await db
        .select()
        .from(orderDetails)
        .where(and(eq(orderDetails.orderId, effectiveOrderId), eq(orderDetails.lineItemKey, lineItemKey)))
        .limit(1);

      if (existingItem) {
        // Item already recorded — check if quantity changed (happens when BrickOwl merges orders)
        // Parse ordered_quantity to integer: the BO API returns it as a string (e.g. "11"),
        // while existingItem.quantity is a number from the DB. Without the parse, strict
        // inequality (11 !== "11") evaluates to true for EVERY re-sync, stampeding
        // merge_detected_at and re-triggering adjustInventoryForOrder unnecessarily.
        const newQty = item.ordered_quantity != null
          ? parseInt(String(item.ordered_quantity), 10)
          : existingItem.quantity;
        if (existingItem.quantity !== newQty) {
          const deltaQty = newQty - existingItem.quantity;
          // Update the existing item to the new total so future syncs don't re-detect this change.
          await db
            .update(orderDetails)
            .set({ quantity: newQty })
            .where(eq(orderDetails.id, existingItem.id));
          if (deltaQty > 0) {
            // Only positive deltas represent items added by the merge.
            // Carry the BL inventory ID forward from the existing DB record.
            deltaItems.push({ item, brickLinkInvId: existingItem.bricklinkInventoryId ?? null, deltaQty });
          }
          itemsChanged = true;
          console.log(`🔀 Order ${effectiveOrderId}: lot ${item.lot_id} qty updated ${existingItem.quantity} → ${newQty} (merge detected, delta: ${deltaQty})`);
        }
        continue;
      }

      // New line item — resolve BL inventory ID from the lot map or the item's own field.
      let brickLinkInvId: number | null = null;
      const fromMap = boLotToBlInvId.get(String(item.lot_id));
      if (fromMap) {
        brickLinkInvId = fromMap;
      } else if (item.external_lot_ids?.other) {
        const parsed = parseInt(item.external_lot_ids.other, 10);
        if (!isNaN(parsed)) brickLinkInvId = parsed;
      }

      // Guard: if a row for this BL inventory ID already exists in the order (under a
      // different lot_id), BrickOwl re-listed the lot rather than genuinely adding a new one.
      // Update the existing row's lot keys in place so the lineItemKey stays current,
      // but do NOT count this as a merge-worthy change or insert a duplicate row.
      if (brickLinkInvId) {
        const [existingByInvId] = await db
          .select()
          .from(orderDetails)
          .where(and(
            eq(orderDetails.orderId, effectiveOrderId),
            eq(orderDetails.bricklinkInventoryId, brickLinkInvId)
          ))
          .limit(1);

        if (existingByInvId) {
          // Same BL inventory item already exists with a different lot_id.
          // This is a lot_id rotation on BrickOwl's side, not a customer-requested merge.
          // Refresh the key columns so future lookups hit the new lot_id.
          await db
            .update(orderDetails)
            .set({
              lineItemKey,
              boLotId: item.lot_id != null ? String(item.lot_id) : null,
            })
            .where(eq(orderDetails.id, existingByInvId.id));
          console.log(`🔄 Order ${effectiveOrderId}: lot ${item.lot_id} replaced lot_id for BL inv ${brickLinkInvId} — lot_id rotation, not a merge`);
          continue; // Do NOT set itemsChanged — this is not a real merge
        }
      }

      // Genuinely new item — insert it into the existing order so future syncs don't
      // re-detect it, and record it as a delta item for the new merge order.
      await db.insert(orderDetails).values([{
        orderId: effectiveOrderId,
        lineItemKey,
        sku: brickLinkInvId ? String(brickLinkInvId) : null,
        name: item.name || '',
        quantity: item.ordered_quantity,
        unitPrice: item.base_price ? item.base_price.toString() : '0',
        taxAmount: null,
        weight: item.weight ? item.weight.toString() : null,
        weightUnits: null,
        description: item.public_note || null,
        options: null,
        customField1: null,
        customField2: null,
        customField3: null,
        bricklinkInventoryId: brickLinkInvId,
        boLotId: item.lot_id != null ? String(item.lot_id) : null,
        colorId: null,
        condition: null,
        fulfilled: false,
        fulfilledAt: null,
      }]);
      result.orderDetailsAdded++;
      deltaItems.push({ item, brickLinkInvId, deltaQty: parseInt(String(item.ordered_quantity ?? 1), 10) });
      itemsChanged = true;
      console.log(`➕ Order ${effectiveOrderId}: new item lot ${item.lot_id} added (genuine merge or late addition)`);

    } catch (error: any) {
      console.error(`✗ Error processing order item for order ${orderId}:`, error);
      result.errors.push(`Order ${orderId} item error: ${error.message}`);
    }
  }

  if (isNewOrder) {
    console.log(`📦 New BrickOwl order ${effectiveOrderId} — triggering inventory adjustment`);
    adjustInventoryForOrder(effectiveOrderId, 'bo-new-order').catch(error => {
      console.error(`⚠️ Inventory adjustment failed for new BrickOwl order ${effectiveOrderId}:`, error);
    });
  } else if (itemsChanged && deltaItems.length > 0) {
    // Items were added or quantities increased on an existing order — genuine BrickOwl merge.
    // Create a new "delta" order that contains only the additional items so the operator
    // can process it like any regular order.  Both the original and the delta order are
    // linked via mergeGroupId so the UI can display the "+" indicator on each.
    const mergeGroupId = effectiveOrderId;
    const deltaOrderId = `${effectiveOrderId}-m${Date.now()}`;
    const deltaOrderNumber = `${boOrder.order_id}-M`;

    console.log(`🔀 Order ${effectiveOrderId}: merge detected — creating delta order ${deltaOrderId}`);

    await db.insert(orders).values([{
      id: deltaOrderId,
      orderNumber: deltaOrderNumber,
      orderKey: `BO.${deltaOrderNumber}`,
      marketplace: 'BrickOwl',
      orderDate: orderData.orderDate,
      orderStatus: orderData.orderStatus,
      previousStatus: null,
      customerUsername: orderData.customerUsername,
      customerEmail: orderData.customerEmail,
      shipTo: orderData.shipTo,
      billTo: null,
      shipByDate: null,
      orderTotal: '0',
      shippingAmount: '0',
      taxAmount: '0',
      internalNotes: null,
      customerNotes: orderData.customerNotes,
      requestedShippingService: orderData.requestedShippingService,
      carrierCode: null,
      serviceCode: null,
      orgId,
      workflowStatus: 'new',
      mergeGroupId,
    }]);

    // Tag the original order with the same mergeGroupId so both show the "+" indicator.
    await db
      .update(orders)
      .set({ mergeGroupId })
      .where(eq(orders.id, effectiveOrderId));

    // Insert the delta line items into the new order.
    for (const { item, brickLinkInvId, deltaQty } of deltaItems) {
      const lineItemKey = `${deltaOrderId}-${item.lot_id}`;
      try {
        await db.insert(orderDetails).values([{
          orderId: deltaOrderId,
          lineItemKey,
          sku: brickLinkInvId ? String(brickLinkInvId) : null,
          name: item.name || '',
          quantity: deltaQty,
          unitPrice: item.base_price ? item.base_price.toString() : '0',
          taxAmount: null,
          weight: item.weight ? item.weight.toString() : null,
          weightUnits: null,
          description: item.public_note || null,
          options: null,
          customField1: null,
          customField2: null,
          customField3: null,
          bricklinkInventoryId: brickLinkInvId,
          boLotId: item.lot_id != null ? String(item.lot_id) : null,
          colorId: null,
          condition: null,
          fulfilled: false,
          fulfilledAt: null,
        }]);
        result.orderDetailsAdded++;
      } catch (err: any) {
        console.error(`✗ Error inserting delta item for merge order ${deltaOrderId}:`, err);
        result.errors.push(`Merge order ${deltaOrderId} item error: ${err.message}`);
      }
    }

    result.ordersAdded++;

    // Trigger inventory adjustment for the new delta order.
    adjustInventoryForOrder(deltaOrderId, 'bo-merge-delta').catch(error => {
      console.error(`⚠️ Inventory adjustment failed for delta merge order ${deltaOrderId}:`, error);
    });
  }
}

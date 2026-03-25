import { db } from "../db";
import { orders, orderDetails, channelLotLinks } from "@shared/schema";
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
  options: { limit?: number; fullSync?: boolean } = {}
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

    // Determine lookback timestamp for incremental sync
    let orderTime: number | undefined = undefined;

    if (!options.fullSync) {
      const [previousSync] = await db
        .select()
        .from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, SYNC_ID)))
        .limit(1);

      if (previousSync?.lastSyncTime) {
        // Subtract a 4-hour buffer so orders placed during the previous sync window are never skipped.
        const LOOKBACK_SECONDS = 4 * 3600;
        orderTime = Math.floor(previousSync.lastSyncTime.getTime() / 1000) - LOOKBACK_SECONDS;
        const lookbackDate = new Date(orderTime * 1000);
        console.log(`📅 Incremental sync: fetching orders since ${lookbackDate.toISOString()} (4h lookback from last sync at ${previousSync.lastSyncTime.toISOString()})`);
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

    const boOrders = await getBrickOwlOrders(apiKey, { limit: options.limit, orderTime });
    result.totalOrders = boOrders.length;
    console.log(`🦉 Fetched ${result.totalOrders} orders from BrickOwl`);

    for (const boOrder of boOrders) {
      try {
        await processBrickOwlOrder(boOrder, orgId, apiKey, result, boLotToBlInvId);
      } catch (error: any) {
        console.error(`✗ Error processing BrickOwl order ${boOrder.order_id}:`, error);
        result.errors.push(`Order ${boOrder.order_id}: ${error.message}`);
      }
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
      brickOwlOrderData.sub_total ??
      brickOwlOrderData.total_price ??
      brickOwlOrderData.total ??
      brickOwlOrderData.grand_total ??
      brickOwlOrderData.base_order_amount ??
      brickOwlOrderData.order_total ??
      0
    ).toString(),
    shippingAmount: (
      brickOwlOrderData.ship_cost ??
      brickOwlOrderData.shipping_cost ??
      brickOwlOrderData.base_ship_amount ??
      brickOwlOrderData.total_shipping ??
      brickOwlOrderData.shipping ??
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
    const { status: updatedStatus, wasDemotionBlocked } = resolveOrderStatus(
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
      adjustInventoryForOrder(effectiveOrderId).catch(error => {
        console.error(`⚠️ Inventory adjustment failed for BrickOwl order ${effectiveOrderId}:`, error);
      });
    }
  }

  // Process order line items
  const items = brickOwlOrderData.items || [];
  console.log(`🦉 Order ${effectiveOrderId}: Processing ${items.length} items`);

  for (const item of items) {
    try {
      const lineItemKey = `${boOrder.order_id}-${item.lot_id}`;

      const [existingItem] = await db
        .select()
        .from(orderDetails)
        .where(and(eq(orderDetails.orderId, effectiveOrderId), eq(orderDetails.lineItemKey, lineItemKey)))
        .limit(1);

      if (existingItem) continue;

      // Resolve BL inventory ID: prefer the pre-built lot map, fall back to the item's own field.
      let brickLinkInvId: number | null = null;
      const fromMap = boLotToBlInvId.get(String(item.lot_id));
      if (fromMap) {
        brickLinkInvId = fromMap;
      } else if (item.external_lot_ids?.other) {
        const parsed = parseInt(item.external_lot_ids.other, 10);
        if (!isNaN(parsed)) brickLinkInvId = parsed;
      }

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

    } catch (error: any) {
      console.error(`✗ Error processing order item for order ${orderId}:`, error);
      result.errors.push(`Order ${orderId} item error: ${error.message}`);
    }
  }

  if (isNewOrder) {
    console.log(`📦 New BrickOwl order ${effectiveOrderId} — triggering inventory adjustment`);
    adjustInventoryForOrder(effectiveOrderId).catch(error => {
      console.error(`⚠️ Inventory adjustment failed for new BrickOwl order ${effectiveOrderId}:`, error);
    });
  }
}

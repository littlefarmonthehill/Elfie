import { db } from "../db";
import { orders, orderDetails, syncMetadata } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getBrickOwlOrders, getBrickOwlOrderDetails, mapBrickOwlStatus, mapBrickOwlCondition } from "./brickowl-orders";
import { adjustInventoryForOrder } from "./inventory-adjustment";


export interface BrickOwlOrderSyncResult {
  ordersAdded: number;
  ordersUpdated: number;
  orderDetailsAdded: number;
  skusMigrated: number;
  totalOrders: number;
  errors: string[];
}

/**
 * Sync orders directly from BrickOwl API
 * 
 * This replaces ShipStation as the source for BrickOwl orders.
 * Orders are fetched from BrickOwl, written to the orders table,
 * and inventory adjustments are triggered automatically.
 */
export async function syncBrickOwlOrders(
  apiKey: string,
  orgId: string,
  options: {
    limit?: number;
    fullSync?: boolean;
  } = {}
): Promise<BrickOwlOrderSyncResult> {
  const syncId = 'brickowl_orders';
  
  const result: BrickOwlOrderSyncResult = {
    ordersAdded: 0,
    ordersUpdated: 0,
    orderDetailsAdded: 0,
    skusMigrated: 0,
    totalOrders: 0,
    errors: [],
  };

  try {
    console.log(`\n🦉 Starting BrickOwl order sync...`);
    
    // Check if incremental sync should be used
    let orderTime: number | undefined = undefined;
    
    if (!options.fullSync) {
      // Check for previous sync
      const [previousSync] = await db
        .select()
        .from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, syncId)))
        .limit(1);
      
      if (previousSync?.lastSyncTime) {
        // BrickOwl API expects Unix timestamp.
        // Subtract a 4-hour lookback buffer so orders placed during the previous sync window
        // (between sync start and when lastSyncTime was written) are never permanently skipped.
        const LOOKBACK_SECONDS = 4 * 3600; // 4 hours
        orderTime = Math.floor(previousSync.lastSyncTime.getTime() / 1000) - LOOKBACK_SECONDS;
        const lookbackDate = new Date(orderTime * 1000);
        console.log(`📅 Incremental sync: fetching orders placed since ${lookbackDate.toISOString()} (4h lookback from last sync at ${previousSync.lastSyncTime.toISOString()})`);
      } else {
        console.log(`🔄 No previous sync found - performing full sync`);
      }
    } else {
      console.log(`🔄 Full sync requested`);
      
      // For full syncs: Run batch migration of historical data FIRST (much faster than item-by-item)
      console.log(`🔄 Running batch migration for historical BrickOwl orders...`);
      const migrationResult = await db.execute(`
        UPDATE order_details od
        SET bricklink_inventory_id = CAST(od.sku AS INTEGER)
        FROM orders o
        WHERE od.order_id = o.id
          AND o.marketplace = 'BrickOwl'
          AND od.sku ~ '^\\d+$'
          AND od.sku != '0'
          AND od.bricklink_inventory_id IS NULL
      `);
      
      const rowsUpdated = (migrationResult as any).rowCount || 0;
      if (rowsUpdated > 0) {
        console.log(`✅ Batch migrated ${rowsUpdated} historical BrickOwl items`);
        result.skusMigrated += rowsUpdated;
      } else {
        console.log(`✅ No historical items need migration`);
      }
    }
    
    // Fetch orders from BrickOwl API
    const boOrders = await getBrickOwlOrders(apiKey, {
      limit: options.limit,
      orderTime: orderTime,
    });
    
    result.totalOrders = boOrders.length;
    console.log(`🦉 Fetched ${result.totalOrders} orders from BrickOwl`);
    
    // Process each order
    for (const boOrder of boOrders) {
      try {
        await processBrickOwlOrder(boOrder, orgId, apiKey, result);
      } catch (error: any) {
        console.error(`✗ Error processing BrickOwl order ${boOrder.order_id}:`, error);
        result.errors.push(`Order ${boOrder.order_id}: ${error.message}`);
      }
    }
    
    // Update sync metadata
    await db.insert(syncMetadata).values({
      id: syncId,
      lastSyncTime: new Date(),
      lastSyncStatus: 'success',
      recordsAdded: result.ordersAdded,
      recordsUpdated: result.ordersUpdated,
      errorMessage: null,
      orgId,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncTime: new Date(),
        lastSyncStatus: 'success',
        recordsAdded: result.ordersAdded,
        recordsUpdated: result.ordersUpdated,
        errorMessage: null,
      },
    });
    
    console.log(`✓ BrickOwl order sync complete:`, {
      ordersAdded: result.ordersAdded,
      ordersUpdated: result.ordersUpdated,
      orderDetailsAdded: result.orderDetailsAdded,
      skusMigrated: result.skusMigrated,
      errors: result.errors.length,
    });
    
    return result;
    
  } catch (error: any) {
    console.error('✗ BrickOwl order sync failed:', error);
    
    // Update sync metadata with error
    await db.insert(syncMetadata).values({
      id: syncId,
      lastSyncTime: new Date(),
      lastSyncStatus: 'failed',
      errorMessage: error.message,
      orgId,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncTime: new Date(),
        lastSyncStatus: 'failed',
        errorMessage: error.message,
      },
    });
    
    throw error;
  }
}

/**
 * Safely parse timestamp to Date
 * Prefers ISO format over Unix timestamp
 */
function safeTimestampToDate(isoString: string | null | undefined, unixTimestamp: number | null | undefined): Date | null {
  // Try ISO string first (more reliable)
  if (isoString) {
    const date = new Date(isoString);
    if (!isNaN(date.getTime())) return date;
  }
  
  // Fallback to Unix timestamp
  if (unixTimestamp) {
    const date = new Date(unixTimestamp * 1000);
    if (!isNaN(date.getTime())) return date;
  }
  
  return null;
}

/**
 * Process a single BrickOwl order
 */
async function processBrickOwlOrder(
  boOrder: any,
  orgId: string,
  apiKey: string,
  result: BrickOwlOrderSyncResult
): Promise<void> {
  const orderId = `bo-${boOrder.order_id}`;
  
  // Check if order already exists — first by canonical bo- ID, then by legacy BO. order_number
  // This prevents a full sync from creating duplicate records for orders stored in the old format
  let [existingOrder] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  
  if (!existingOrder) {
    // Try legacy BO. prefixed order_number format first
    const [legacyOrderBo] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, `BO.${boOrder.order_id}`))
      .limit(1);
    if (legacyOrderBo) {
      existingOrder = legacyOrderBo;
    }
  }

  if (!existingOrder) {
    // Also try plain numeric order_number (old records stored order_number without any prefix)
    const [legacyOrderNumeric] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, String(boOrder.order_id)))
      .limit(1);
    if (legacyOrderNumeric) {
      existingOrder = legacyOrderNumeric;
    }
  }
  
  // Debug: log raw status fields to confirm what BrickOwl returns
  console.log(`🦉 [BO status debug] order ${orderId} — status_id: ${boOrder.status_id}, status: ${boOrder.status}, status_name: ${boOrder.status_name}`);

  // Map BrickOwl status to normalized status (numeric ID + text fallback)
  const normalizedStatus = mapBrickOwlStatus(boOrder.status_id, boOrder.status ?? boOrder.status_name);
  
  // Use the actual existing order's ID for all DB operations
  // (in case we found a legacy order via the BO. order_number fallback)
  const effectiveOrderId = existingOrder?.id ?? orderId;

  // Fetch full order details (including items)
  const brickOwlOrderData = await getBrickOwlOrderDetails(apiKey, boOrder.order_id);

  // Safely parse order date - prefer ISO format from list API, then detail view, then now
  const orderDate =
    safeTimestampToDate(boOrder.iso_order_time, boOrder.order_time) ??
    safeTimestampToDate(brickOwlOrderData.iso_order_time, brickOwlOrderData.order_time) ??
    new Date();

  let isNewOrder = false;

  // Build the full order payload used for both insert and update
  const orderData = {
    id: orderId,
    orderNumber: boOrder.order_id.toString(),
    orderKey: `BO.${boOrder.order_id}`,
    marketplace: 'BrickOwl',
    orderDate: orderDate,
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
    // Insert new order
    await db.insert(orders).values([{ ...orderData, orgId }]);
    result.ordersAdded++;
    isNewOrder = true;
  } else {
    // Protect locally-shipped orders: don't let BrickOwl demote status
    // (BrickOwl may lag behind after we mark an order as shipped)
    const isLocallyShipped = existingOrder.orderStatus === 'shipped';
    const wouldDemote = isLocallyShipped && normalizedStatus !== 'shipped';

    if (wouldDemote) {
      console.log(`🔒 BrickOwl order ${effectiveOrderId}: Preserving local shipped status (BrickOwl shows: ${normalizedStatus})`);
    }

    const updatedStatus = wouldDemote ? 'shipped' : normalizedStatus;

    // Update full order data on every sync (shipping address, totals, customer info, status)
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

    // If status actually changed, trigger inventory adjustment
    if (existingOrder.orderStatus !== updatedStatus) {
      console.log(`📦 BrickOwl order ${effectiveOrderId} status changed: ${existingOrder.orderStatus} → ${updatedStatus}`);
      adjustInventoryForOrder(effectiveOrderId).catch(error => {
        console.error(`⚠️ Inventory adjustment failed for BrickOwl order ${effectiveOrderId}:`, error);
      });
    }
  }
  
  // Process order items
  const items = brickOwlOrderData.items || [];
  console.log(`🦉 Order ${effectiveOrderId}: Processing ${items.length} items`);
  
  for (const item of items) {
    try {
      // Match existing line item key format: {order_id}-{lot_id} (without "bo-" prefix)
      const lineItemKey = `${boOrder.order_id}-${item.lot_id}`;
      
      // Check if line item already exists
      const [existingItem] = await db
        .select()
        .from(orderDetails)
        .where(
          and(
            eq(orderDetails.orderId, effectiveOrderId),
            eq(orderDetails.lineItemKey, lineItemKey)
          )
        )
        .limit(1);
      
      if (existingItem) {
        // Item already exists - skip it
        // Note: Historical SKU migration is handled in bulk at the start of full syncs
        // Only new orders/items from this point forward
        continue;
      }
      
      // Determine BrickLink inventory ID — only trust explicit cross-reference from API
      let brickLinkInvId: number | null = null;
      let skuValue: string | null = null;
      
      if (item.external_lot_ids?.other) {
        brickLinkInvId = parseInt(item.external_lot_ids.other, 10);
        skuValue = item.external_lot_ids.other;
      }
      
      const orderDetailData = {
        orderId: effectiveOrderId,
        lineItemKey,
        sku: skuValue,  // BrickLink inventory ID (standardized)
        name: `${item.boid || ''} - ${item.name || ''}`,
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
        colorId: item.color_id,
        condition: mapBrickOwlCondition(item.condition),
        fulfilled: false,
        fulfilledAt: null,
      };
      
      await db.insert(orderDetails).values([orderDetailData]);
      result.orderDetailsAdded++;
      
    } catch (error: any) {
      console.error(`✗ Error processing order item for order ${orderId}:`, error);
      result.errors.push(`Order ${orderId} item error: ${error.message}`);
    }
  }

  // Trigger inventory adjustment for new orders after items are inserted
  if (isNewOrder) {
    console.log(`📦 New BrickOwl order ${effectiveOrderId} — triggering inventory adjustment`);
    adjustInventoryForOrder(effectiveOrderId).catch(error => {
      console.error(`⚠️ Inventory adjustment failed for new BrickOwl order ${effectiveOrderId}:`, error);
    });
  }
}

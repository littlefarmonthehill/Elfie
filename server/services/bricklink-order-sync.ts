import { db } from "../db";
import { orders, orderDetails, syncMetadata } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getBrickLinkOrders, getBrickLinkOrderItems, mapBrickLinkStatusSync, mapBrickLinkCondition } from "./bricklink-orders";
import { mapPlatformStatus } from "../config/order-status-mapping";
import { adjustInventoryForOrder } from "./inventory-adjustment";

export interface BrickLinkOrderSyncResult {
  ordersAdded: number;
  ordersUpdated: number;
  orderDetailsAdded: number;
  totalOrders: number;
  errors: string[];
}

/**
 * Sync orders directly from BrickLink API
 * 
 * This replaces ShipStation as the source for BrickLink orders.
 * Orders are fetched from BrickLink, written to the orders table,
 * and inventory adjustments are triggered automatically.
 */
export async function syncBrickLinkOrders(
  consumerKey: string,
  consumerSecret: string,
  tokenValue: string,
  tokenSecret: string,
  options: {
    limit?: number;
    fullSync?: boolean;
  } = {}
): Promise<BrickLinkOrderSyncResult> {
  const syncId = 'bricklink_orders';
  
  const result: BrickLinkOrderSyncResult = {
    ordersAdded: 0,
    ordersUpdated: 0,
    orderDetailsAdded: 0,
    totalOrders: 0,
    errors: [],
  };

  try {
    console.log(`\n📦 Starting BrickLink order sync...`);
    
    // Check if incremental sync should be used
    let filedDate: Date | undefined = undefined;
    
    if (!options.fullSync) {
      // Check for previous sync
      const [previousSync] = await db
        .select()
        .from(syncMetadata)
        .where(eq(syncMetadata.id, syncId))
        .limit(1);
      
      if (previousSync?.lastSyncTime) {
        filedDate = previousSync.lastSyncTime;
        console.log(`📅 Incremental sync: fetching orders modified since ${filedDate.toISOString()}`);
      } else {
        console.log(`🔄 No previous sync found - performing full sync`);
      }
    } else {
      console.log(`🔄 Full sync requested`);
    }
    
    // Fetch orders from BrickLink API
    // Status options: PENDING (awaiting payment/shipment), COMPLETED (shipped), PURGED (cancelled/deleted)
    // Note: Skip PURGED orders for manual sync since they're old cancelled orders with no item data
    const skipPurged = !options.fullSync; // Skip PURGED orders unless explicitly doing full sync
    
    const pendingOrders = await getBrickLinkOrders(consumerKey, consumerSecret, tokenValue, tokenSecret, {
      direction: 'in', // Incoming orders (purchases)
      status: 'PENDING',
      limit: options.limit,
      filed: filedDate,
    });
    
    const completedOrders = await getBrickLinkOrders(consumerKey, consumerSecret, tokenValue, tokenSecret, {
      direction: 'in',
      status: 'COMPLETED',
      limit: options.limit,
      filed: filedDate,
    });
    
    let purgedOrders: any[] = [];
    if (!skipPurged) {
      purgedOrders = await getBrickLinkOrders(consumerKey, consumerSecret, tokenValue, tokenSecret, {
        direction: 'in',
        status: 'PURGED',
        limit: options.limit,
        filed: filedDate,
      });
    }
    
    const allOrders = [...pendingOrders, ...completedOrders, ...purgedOrders];
    result.totalOrders = allOrders.length;
    
    if (skipPurged) {
      console.log(`📦 Fetched ${result.totalOrders} orders from BrickLink (${pendingOrders.length} pending, ${completedOrders.length} completed, PURGED skipped for manual sync)`);
    } else {
      console.log(`📦 Fetched ${result.totalOrders} orders from BrickLink (${pendingOrders.length} pending, ${completedOrders.length} completed, ${purgedOrders.length} purged)`);
    }
    
    // Process each order
    for (const blOrder of allOrders) {
      try {
        await processBrickLinkOrder(blOrder, consumerKey, consumerSecret, tokenValue, tokenSecret, result);
      } catch (error: any) {
        console.error(`✗ Error processing BrickLink order ${blOrder.order_id}:`, error);
        result.errors.push(`Order ${blOrder.order_id}: ${error.message}`);
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
    
    console.log(`✓ BrickLink order sync complete:`, {
      ordersAdded: result.ordersAdded,
      ordersUpdated: result.ordersUpdated,
      orderDetailsAdded: result.orderDetailsAdded,
      errors: result.errors.length,
    });
    
    return result;
    
  } catch (error: any) {
    console.error('✗ BrickLink order sync failed:', error);
    
    // Update sync metadata with error
    await db.insert(syncMetadata).values({
      id: syncId,
      lastSyncTime: new Date(),
      lastSyncStatus: 'failed',
      errorMessage: error.message,
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
 * Process a single BrickLink order
 */
async function processBrickLinkOrder(
  blOrder: any,
  consumerKey: string,
  consumerSecret: string,
  tokenValue: string,
  tokenSecret: string,
  result: BrickLinkOrderSyncResult
): Promise<void> {
  const orderId = `bl-${blOrder.order_id}`;
  
  // Check if order already exists
  const [existingOrder] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  
  // Map BrickLink status to normalized status
  const normalizedStatus = mapPlatformStatus('bricklink', blOrder.status);
  
  // Prepare order data
  const orderData = {
    id: orderId,
    orderNumber: blOrder.order_id.toString(),
    orderKey: `BL.${blOrder.order_id}`,
    marketplace: 'BrickLink',
    orderDate: new Date(blOrder.date_ordered),
    orderStatus: normalizedStatus,
    previousStatus: existingOrder?.orderStatus || null,
    customerUsername: blOrder.buyer_name || null,
    customerEmail: blOrder.buyer_email || null,
    shipTo: JSON.stringify({
      name: blOrder.shipping?.address?.name?.full || '',
      address1: blOrder.shipping?.address?.address1 || '',
      address2: blOrder.shipping?.address?.address2 || '',
      city: blOrder.shipping?.address?.city || '',
      state: blOrder.shipping?.address?.state_or_province || '',
      postalCode: blOrder.shipping?.address?.postal_code || '',
      country: blOrder.shipping?.address?.country_code || '',
    }),
    billTo: null,
    shipByDate: null,
    orderTotal: blOrder.cost?.grand_total ? blOrder.cost.grand_total.toString() : '0',
    shippingAmount: blOrder.cost?.shipping ? blOrder.cost.shipping.toString() : '0',
    taxAmount: blOrder.cost?.vat_amount ? blOrder.cost.vat_amount.toString() : '0',
    internalNotes: null,
    customerNotes: blOrder.remarks || null,
    requestedShippingService: blOrder.shipping?.method || null,
    carrierCode: null,
    serviceCode: null,
    updatedAt: new Date(),
  };
  
  // Insert or update order
  if (existingOrder) {
    // Update existing order
    await db
      .update(orders)
      .set({
        ...orderData,
        previousStatus: existingOrder.orderStatus, // Preserve current status as previous
      })
      .where(eq(orders.id, orderId));
    
    result.ordersUpdated++;
    
    // If status changed, trigger inventory adjustment
    if (existingOrder.orderStatus !== normalizedStatus) {
      console.log(`📦 Order ${orderId} status changed: ${existingOrder.orderStatus} → ${normalizedStatus}`);
      
      // Trigger inventory adjustment asynchronously
      adjustInventoryForOrder(orderId).catch(error => {
        console.error(`⚠️ Inventory adjustment failed for order ${orderId}:`, error);
        result.errors.push(`Inventory adjustment failed for ${orderId}: ${error.message}`);
      });
    }
  } else {
    // Insert new order
    await db.insert(orders).values([orderData]);
    result.ordersAdded++;
  }
  
  // Fetch order items
  const blOrderItems = await getBrickLinkOrderItems(
    blOrder.order_id,
    consumerKey,
    consumerSecret,
    tokenValue,
    tokenSecret
  );
  
  console.log(`📦 Order ${orderId}: Fetched ${blOrderItems.length} items`);
  
  // Process order items
  for (const item of blOrderItems) {
    try {
      const lineItemKey = `bl-${blOrder.order_id}-${item.inventory_id}`;
      
      // Check if line item already exists
      const [existingItem] = await db
        .select()
        .from(orderDetails)
        .where(
          and(
            eq(orderDetails.orderId, orderId),
            eq(orderDetails.lineItemKey, lineItemKey)
          )
        )
        .limit(1);
      
      if (existingItem) {
        continue; // Skip if already exists
      }
      
      const orderDetailData = {
        orderId,
        lineItemKey,
        sku: item.inventory_id ? item.inventory_id.toString() : null,  // BrickLink inventory ID
        name: `${item.item?.no || ''} - ${item.item?.name || ''}`,
        quantity: item.quantity,
        unitPrice: item.unit_price ? item.unit_price.toString() : '0',
        taxAmount: null,
        weight: null,
        weightUnits: null,
        description: item.description || null,
        options: null,
        customField1: null,
        customField2: null,
        customField3: null,
        bricklinkInventoryId: item.inventory_id,
        colorId: item.color_id,
        condition: mapBrickLinkCondition(item.new_or_used),
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
}

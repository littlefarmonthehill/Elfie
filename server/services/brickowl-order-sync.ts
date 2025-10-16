import { db } from "../db";
import { orders, orderDetails, syncMetadata } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getBrickOwlOrders, getBrickOwlOrderDetails, mapBrickOwlStatus, mapBrickOwlCondition } from "./brickowl-orders";
import { adjustInventoryForOrder } from "./inventory-adjustment";

export interface BrickOwlOrderSyncResult {
  ordersAdded: number;
  ordersUpdated: number;
  orderDetailsAdded: number;
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
        .where(eq(syncMetadata.id, syncId))
        .limit(1);
      
      if (previousSync?.lastSyncTime) {
        // BrickOwl API expects Unix timestamp
        orderTime = Math.floor(previousSync.lastSyncTime.getTime() / 1000);
        console.log(`📅 Incremental sync: fetching orders modified since ${previousSync.lastSyncTime.toISOString()} (timestamp: ${orderTime})`);
      } else {
        console.log(`🔄 No previous sync found - performing full sync`);
      }
    } else {
      console.log(`🔄 Full sync requested`);
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
        await processBrickOwlOrder(boOrder, apiKey, result);
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
 * Process a single BrickOwl order
 */
async function processBrickOwlOrder(
  boOrder: any,
  apiKey: string,
  result: BrickOwlOrderSyncResult
): Promise<void> {
  const orderId = `bo-${boOrder.order_id}`;
  
  // Check if order already exists
  const [existingOrder] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  
  // Map BrickOwl status to normalized status
  const normalizedStatus = mapBrickOwlStatus(boOrder.status_id);
  
  // Fetch full order details (including items)
  const orderDetails = await getBrickOwlOrderDetails(apiKey, boOrder.order_id);
  
  // Prepare order data
  const orderData = {
    id: orderId,
    orderNumber: boOrder.order_id.toString(),
    orderKey: `BO.${boOrder.order_id}`,
    marketplace: 'BrickOwl',
    orderDate: new Date(boOrder.order_time * 1000), // Unix timestamp to Date
    orderStatus: normalizedStatus,
    previousStatus: existingOrder?.orderStatus || null,
    customerUsername: orderDetails.buyer_name || null,
    customerEmail: orderDetails.buyer_email || null,
    shipTo: JSON.stringify({
      name: orderDetails.ship_name || '',
      address1: orderDetails.ship_street_1 || '',
      address2: orderDetails.ship_street_2 || '',
      city: orderDetails.ship_city || '',
      state: orderDetails.ship_region || '',
      postalCode: orderDetails.ship_post_code || '',
      country: orderDetails.ship_country_code || '',
    }),
    billTo: null,
    shipByDate: null,
    orderTotal: orderDetails.total_price ? orderDetails.total_price.toString() : '0',
    shippingAmount: orderDetails.shipping_cost ? orderDetails.shipping_cost.toString() : '0',
    taxAmount: orderDetails.vat ? orderDetails.vat.toString() : '0',
    internalNotes: null,
    customerNotes: orderDetails.buyer_notes || null,
    requestedShippingService: orderDetails.ship_method_name || null,
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
      console.log(`🦉 Order ${orderId} status changed: ${existingOrder.orderStatus} → ${normalizedStatus}`);
      
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
  
  // Process order items
  const items = orderDetails.items || [];
  console.log(`🦉 Order ${orderId}: Processing ${items.length} items`);
  
  for (const item of items) {
    try {
      const lineItemKey = `bo-${boOrder.order_id}-${item.lot_id}`;
      
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
        sku: item.boid || null,
        name: `${item.boid || ''} - ${item.name || ''}`,
        quantity: item.ordered_quantity,
        unitPrice: item.base_price ? parseFloat(item.base_price) : 0,
        taxAmount: null,
        weight: item.weight ? parseFloat(item.weight) : null,
        weightUnits: null,
        description: item.public_note || null,
        options: null,
        customField1: null,
        customField2: null,
        customField3: null,
        bricklinkInventoryId: item.external_lot_ids?.other ? parseInt(item.external_lot_ids.other, 10) : null,
        colorId: item.color_id,
        condition: mapBrickOwlCondition(item.condition),
        fulfilled: false,
        fulfilledAt: null,
      };
      
      await db.insert(orderDetails).values(orderDetailData);
      result.orderDetailsAdded++;
      
    } catch (error: any) {
      console.error(`✗ Error processing order item for order ${orderId}:`, error);
      result.errors.push(`Order ${orderId} item error: ${error.message}`);
    }
  }
}

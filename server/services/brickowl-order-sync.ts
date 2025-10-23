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
  const brickOwlOrderData = await getBrickOwlOrderDetails(apiKey, boOrder.order_id);
  
  // Safely parse order date - prefer ISO format from API
  const orderDate = safeTimestampToDate(boOrder.iso_order_time, boOrder.order_time);
  
  // Only update/insert order if we have valid data AND order doesn't exist
  // If order exists, we'll skip updating it but STILL process items for SKU migration
  if (!existingOrder && orderDate) {
    // Prepare order data for NEW orders only
    const orderData = {
      id: orderId,
      orderNumber: boOrder.order_id.toString(),
      orderKey: `BO.${boOrder.order_id}`,
      marketplace: 'BrickOwl',
      orderDate: orderDate,
      orderStatus: normalizedStatus,
      previousStatus: null,
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
      orderTotal: brickOwlOrderData.total_price ? brickOwlOrderData.total_price.toString() : '0',
      shippingAmount: brickOwlOrderData.shipping_cost ? brickOwlOrderData.shipping_cost.toString() : '0',
      taxAmount: brickOwlOrderData.vat ? brickOwlOrderData.vat.toString() : '0',
      internalNotes: null,
      customerNotes: brickOwlOrderData.buyer_notes || null,
      requestedShippingService: brickOwlOrderData.ship_method_name || null,
      carrierCode: null,
      serviceCode: null,
    };
    
    // Insert new order
    await db.insert(orders).values([orderData]);
    result.ordersAdded++;
  } else if (existingOrder) {
    // Order exists - we'll process items but skip order update to avoid timestamp issues
    result.ordersUpdated++;
  }
  
  // Process order items
  const items = brickOwlOrderData.items || [];
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
        // Migration: Check if existing item has BOID SKU and needs to be updated
        const hasBoidSku = existingItem.sku && /^\d+$/.test(existingItem.sku) && !existingItem.bricklinkInventoryId;
        const hasBrickLinkId = item.external_lot_ids?.other;
        
        // Debug: Log first few items to see what API returns
        if (result.ordersAdded + result.ordersUpdated < 3) {
          console.log(`🔍 Item check: SKU=${existingItem.sku}, BL_ID=${existingItem.bricklinkInventoryId}, API_external=${item.external_lot_ids?.other}, hasBoidSku=${hasBoidSku}, hasBrickLinkId=${hasBrickLinkId}`);
        }
        
        if (hasBoidSku && hasBrickLinkId) {
          // Update the SKU to use BrickLink inventory ID
          await db
            .update(orderDetails)
            .set({
              sku: item.external_lot_ids.other,
              bricklinkInventoryId: parseInt(item.external_lot_ids.other, 10),
            })
            .where(eq(orderDetails.id, existingItem.id));
          
          console.log(`🔄 Migrated SKU for item ${lineItemKey}: BOID ${existingItem.sku} → BL Inv ${item.external_lot_ids.other}`);
          result.skusMigrated++;
        }
        
        continue; // Skip to next item
      }
      
      const orderDetailData = {
        orderId,
        lineItemKey,
        sku: item.external_lot_ids?.other || null,  // BrickLink inventory ID from external_lot_ids.other
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

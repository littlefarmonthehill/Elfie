import { db } from "../db";
import { orders, orderDetails, syncMetadata, blInventory, blCatalog } from "@shared/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import { getBrickLinkOrders, getBrickLinkOrderDetail, getBrickLinkOrderItems, mapBrickLinkStatusSync, mapBrickLinkCondition } from "./bricklink-orders";
import { bricklinkRequest } from "./bricklink";
import { mapPlatformStatus } from "../config/order-status-mapping";
import { adjustInventoryForOrder } from "./inventory-adjustment";

const ORG_ID = 'org_planetbrick';

/**
 * Fetch a single BrickLink inventory lot by ID and upsert it into the local db.
 * Called when an order item references a lot that doesn't exist locally yet —
 * e.g. a part listed during the day before the nightly inventory sync runs.
 */
async function fetchAndCacheMissingLot(inventoryId: number): Promise<boolean> {
  try {
    const { data } = await bricklinkRequest(`/inventories/${inventoryId}`);
    if (!data) return false;

    const lotData = {
      id: data.inventory_id as number,
      itemNo: (data.item?.no as string) || '',
      itemName: (data.item?.name as string) || null,
      itemType: (data.item?.type as string) || 'PART',
      colorId: data.color_id ?? null,
      colorName: (data.color_name as string) ?? null,
      quantity: (data.quantity as number) ?? 0,
      newOrUsed: (data.new_or_used as string) || 'U',
      completeness: (data.completeness as string) ?? null,
      unitPrice: data.unit_price ? String(data.unit_price) : null,
      myCost: data.my_cost ? String(data.my_cost) : null,
      bindId: data.bind_id ? Number(data.bind_id) : null,
      description: (data.description as string) || null,
      remarks: (data.remarks as string) || null,
      bulk: data.bulk ? Number(data.bulk) : 1,
      isRetain: Boolean(data.is_retain ?? false),
      isStockRoom: Boolean(data.is_stock_room ?? false),
      stockRoomId: (data.stock_room_id as string) ?? null,
      categoryId: data.item?.category_id ? Number(data.item.category_id) : null,
      dateCreated: data.date_created ? new Date(data.date_created as string) : null,
      saleRate: data.sale_rate ? Number(data.sale_rate) : null,
      tierPrice1: data.tier_price1 ? String(data.tier_price1) : null,
      tierPrice2: data.tier_price2 ? String(data.tier_price2) : null,
      tierPrice3: data.tier_price3 ? String(data.tier_price3) : null,
      tierQuantity1: data.tier_quantity1 ? Number(data.tier_quantity1) : null,
      tierQuantity2: data.tier_quantity2 ? Number(data.tier_quantity2) : null,
      tierQuantity3: data.tier_quantity3 ? Number(data.tier_quantity3) : null,
      orgId: ORG_ID,
    };

    await db.insert(blInventory).values(lotData)
      .onConflictDoUpdate({
        target: blInventory.id,
        set: {
          quantity: lotData.quantity,
          unitPrice: lotData.unitPrice,
          updatedAt: sql`now()`,
          syncedAt: sql`now()`,
        }
      });

    console.log(`✅ Cached missing lot ${inventoryId} (${lotData.itemNo}) from BrickLink`);
    return true;
  } catch (err: any) {
    console.warn(`⚠️ Could not fetch missing lot ${inventoryId} from BrickLink: ${err.message}`);
    return false;
  }
}

export interface BrickLinkOrderSyncResult {
  ordersAdded: number;
  ordersUpdated: number;
  orderDetailsAdded: number;
  totalOrders: number;
  errors: string[];
}

// Sync lock to prevent concurrent syncs
let isSyncing = false;

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

  // Prevent concurrent syncs
  if (isSyncing) {
    console.log(`⚠️ BrickLink order sync already in progress, skipping`);
    result.errors.push('Sync already in progress');
    return result;
  }
  
  isSyncing = true;

  try {
    console.log(`\n📦 Starting BrickLink order sync...`);
    
    // Fetch ALL orders from BrickLink API (no status filter)
    const fetchedOrders = await getBrickLinkOrders(consumerKey, consumerSecret, tokenValue, tokenSecret, {
      direction: 'in',
    });
    
    console.log(`📦 Fetched ${fetchedOrders.length} total orders from BrickLink API`);
    
    // Sort newest first so new orders get processed quickly
    fetchedOrders.sort((a: any, b: any) => 
      new Date(b.date_status_changed || b.date_ordered).getTime() - new Date(a.date_status_changed || a.date_ordered).getTime()
    );
    
    if (fetchedOrders.length > 0) {
      const newest = fetchedOrders.slice(0, 3);
      console.log(`📋 Newest orders:`, newest.map((o: any) => `#${o.order_id} status=${o.status} date_ordered=${o.date_ordered} date_changed=${o.date_status_changed}`));
    }
    
    // For incremental sync: only process orders that are new or have changed status
    // For full sync: process all orders
    // This is much more reliable than timestamp-based filtering
    let allOrders = fetchedOrders;
    if (!options.fullSync) {
      // Get all existing BrickLink order IDs and their statuses from our DB
      const existingOrders = await db
        .select({ id: orders.id, orderStatus: orders.orderStatus })
        .from(orders)
        .where(and(eq(orders.orgId, ORG_ID), sql`${orders.id} LIKE 'bl-%'`));
      
      const existingMap = new Map(existingOrders.map(o => [o.id, o.orderStatus]));
      
      allOrders = fetchedOrders.filter((order: any) => {
        const orderId = `bl-${order.order_id}`;
        const existing = existingMap.get(orderId);
        if (!existing) return true; // New order - process it
        // Protect locally-shipped orders: BrickLink may lag behind (e.g. if the update
        // to BrickLink failed or hasn't propagated yet). Never let a sync demote shipped.
        if (existing === 'shipped') return false;
        const newStatus = mapPlatformStatus('bricklink', order.status);
        if (existing !== newStatus) return true; // Status changed - process it
        return false; // Already synced, same status - skip
      });
      
      console.log(`📅 Incremental: ${allOrders.length} new/changed orders to process (skipped ${fetchedOrders.length - allOrders.length} unchanged)`);
    }
    
    // Apply limit after filtering
    if (options.limit && allOrders.length > options.limit) {
      console.log(`📦 Applying limit: processing ${options.limit} of ${allOrders.length} orders`);
      allOrders = allOrders.slice(0, options.limit);
    }
    
    result.totalOrders = allOrders.length;
    
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
      orgId: ORG_ID,
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
      orgId: ORG_ID,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncTime: new Date(),
        lastSyncStatus: 'failed',
        errorMessage: error.message,
      },
    });
    
    throw error;
  } finally {
    isSyncing = false;
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
  
  // Check if order already exists — first by canonical bl- ID, then by legacy BL. order_number
  // This prevents a full sync from creating duplicate records for orders stored in the old format
  let [existingOrder] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  
  if (!existingOrder) {
    const [legacyOrder] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, `BL.${blOrder.order_id}`))
      .limit(1);
    if (legacyOrder) {
      existingOrder = legacyOrder;
    }
  }
  
  // Map BrickLink status to normalized status
  const normalizedStatus = mapPlatformStatus('bricklink', blOrder.status);
  
  // Fetch full order details (includes cost breakdown with shipping/tax)
  // The order list endpoint only returns summary data without cost details
  let orderDetail: any = null;
  try {
    orderDetail = await getBrickLinkOrderDetail(
      blOrder.order_id, consumerKey, consumerSecret, tokenValue, tokenSecret
    );
  } catch (err: any) {
    console.warn(`⚠️ Could not fetch order detail for ${blOrder.order_id}: ${err.message}`);
  }
  
  // Use detail data for cost/shipping/address, fall back to list data
  const cost = orderDetail?.cost || blOrder.cost || {};
  const shipping = orderDetail?.shipping || blOrder.shipping || {};
  
  // BrickLink does not expose a top-level order weight field.
  // We will compute it from order items (item.weight * quantity) after the items loop.
  // Keep a placeholder so the orderData structure is consistent.
  const blTotalWeightOz: number | null = null;

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
      name: shipping?.address?.name?.full || '',
      street1: shipping?.address?.address1 || '',
      street2: shipping?.address?.address2 || '',
      city: shipping?.address?.city || '',
      state: shipping?.address?.state_or_province || '',
      postalCode: shipping?.address?.postal_code || '',
      country: shipping?.address?.country_code || '',
    }),
    billTo: null,
    shipByDate: null,
    orderTotal: cost?.grand_total ? cost.grand_total.toString() : '0',
    shippingAmount: cost?.shipping ? cost.shipping.toString() : '0',
    taxAmount: cost?.salesTax_collected_by_bl ? cost.salesTax_collected_by_bl.toString() : (cost?.vat_amount ? cost.vat_amount.toString() : '0'),
    internalNotes: null,
    customerNotes: orderDetail?.remarks || blOrder.remarks || null,
    requestedShippingService: shipping?.method || null,
    carrierCode: null,
    serviceCode: null,
    weight: blTotalWeightOz ? blTotalWeightOz.toString() : null,
    weightUnits: blTotalWeightOz ? 'oz' : null,
    updatedAt: new Date(),
  };
  
  // Insert or update order
  if (existingOrder) {
    // Protect locally-shipped orders: if we've marked this order as shipped locally,
    // don't let a sync from BrickLink demote the status (BrickLink may lag behind,
    // or our update to BrickLink may have failed temporarily).
    const isLocallyShipped = existingOrder.orderStatus === 'shipped';
    const wouldDemote = isLocallyShipped && normalizedStatus !== 'shipped';
    
    const updatedStatus = wouldDemote ? 'shipped' : normalizedStatus;
    
    if (wouldDemote) {
      console.log(`🔒 Order ${orderId}: Preserving local shipped status (BrickLink shows: ${normalizedStatus})`);
    }

    // Update existing order (use existingOrder.id in case it was found via legacy order_number lookup)
    // Separate weight from core data — only populate weight from BL if user hasn't manually set one
    const { weight: blWeight, weightUnits: blWeightUnits, ...coreOrderData } = orderData;
    await db
      .update(orders)
      .set({
        ...coreOrderData,
        id: existingOrder.id, // Preserve the existing ID — don't rename old-format records
        orderStatus: updatedStatus,
        previousStatus: existingOrder.orderStatus, // Preserve current status as previous
        // Only set BL weight if no weight is saved yet (don't overwrite manual entries)
        ...(existingOrder.weight == null && blWeight ? { weight: blWeight, weightUnits: blWeightUnits } : {}),
      })
      .where(eq(orders.id, existingOrder.id));
    
    result.ordersUpdated++;
    
    // If status changed (and we didn't protect it), trigger inventory adjustment
    const effectiveStatusChange = existingOrder.orderStatus !== updatedStatus;
    if (effectiveStatusChange) {
      console.log(`📦 Order ${orderId} status changed: ${existingOrder.orderStatus} → ${updatedStatus}`);
      
      // Trigger inventory adjustment asynchronously
      adjustInventoryForOrder(orderId).catch(error => {
        console.error(`⚠️ Inventory adjustment failed for order ${orderId}:`, error);
        result.errors.push(`Inventory adjustment failed for ${orderId}: ${error.message}`);
      });
    }
  } else {
    // Insert new order
    await db.insert(orders).values([{ ...orderData, orgId: ORG_ID }]);
    result.ordersAdded++;
  }
  
  const isNewOrder = !existingOrder;
  
  // Fetch order items
  const blOrderItems = await getBrickLinkOrderItems(
    blOrder.order_id,
    consumerKey,
    consumerSecret,
    tokenValue,
    tokenSecret
  );
  
  console.log(`📦 Order ${orderId}: Fetched ${blOrderItems.length} items`);
  
  // Accumulate total order weight in grams from line items (item.weight × quantity)
  let itemsTotalWeightGrams = 0;

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
      
      // Accumulate total order weight (item.weight is grams per unit)
      if (item.weight && item.quantity) {
        itemsTotalWeightGrams += parseFloat(item.weight) * item.quantity;
      }

      // Save BrickLink's per-piece catalog weight to bl_catalog_weight (not my_weight, which is user's field).
      // item.weight from the order items API is the official catalog weight in grams.
      if (item.inventory_id) {
        try {
          const unitWeightGrams = item.weight ? parseFloat(item.weight) : null;
          if (unitWeightGrams && unitWeightGrams > 0) {
            const wg = unitWeightGrams;
            // Dual-write: update bl_inventory (legacy) and bl_catalog (new)
            await db.update(blInventory)
              .set({
                blCatalogWeight: sql`CASE WHEN ${blInventory.blCatalogWeight} IS NULL OR ${blInventory.blCatalogWeight} = 0 THEN ${wg} ELSE ${blInventory.blCatalogWeight} END`,
              })
              .where(eq(blInventory.id, item.inventory_id));

            // Also update bl_catalog by (itemNo, itemType, colorId) if we have the item identity
            if (item.item?.no && item.item?.type) {
              await db.update(blCatalog)
                .set({
                  blCatalogWeight: sql`CASE WHEN ${blCatalog.blCatalogWeight} IS NULL OR ${blCatalog.blCatalogWeight} = 0 THEN ${wg} ELSE ${blCatalog.blCatalogWeight} END`,
                  updatedAt: new Date(),
                })
                .where(and(
                  eq(blCatalog.itemNo, item.item.no),
                  eq(blCatalog.itemType, item.item.type),
                  eq(blCatalog.colorId, item.color_id ?? 0),
                ));
            }
          }
        } catch (invErr: any) {
          console.warn(`⚠️ Could not save catalog weight for lot ${item.inventory_id}: ${invErr.message}`);
        }
      }

      // ── Missing inventory check ──────────────────────────────────────────────
      // If this lot doesn't exist in the local db (e.g. it was newly listed during
      // the day before the nightly inventory sync ran), fetch it from BrickLink now
      // so that inventory adjustment can deduct stock correctly.
      if (item.inventory_id) {
        const [existingLot] = await db
          .select({ id: blInventory.id })
          .from(blInventory)
          .where(eq(blInventory.id, item.inventory_id))
          .limit(1);

        if (!existingLot) {
          console.log(`🔍 Lot ${item.inventory_id} (${item.item?.no}) not in local DB — fetching from BrickLink...`);
          await fetchAndCacheMissingLot(item.inventory_id);
        }
      }

      if (existingItem) {
        continue; // Order detail already exists — inventory backfill above still ran
      }

      const orderDetailData = {
        orderId,
        lineItemKey,
        sku: item.inventory_id ? item.inventory_id.toString() : null,  // BrickLink inventory ID
        name: item.item?.name || `${item.item?.no || ''} - unknown`,
        quantity: item.quantity,
        unitPrice: item.unit_price ? item.unit_price.toString() : '0',
        taxAmount: null,
        weight: item.weight ? item.weight.toString() : null,
        weightUnits: item.weight ? 'g' : null,
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

  // After items are processed, write the computed total weight to the order record
  // if no weight is already saved (avoids overwriting manual edits)
  if (itemsTotalWeightGrams > 0) {
    const computedWeightOz = Math.round(itemsTotalWeightGrams * 0.035274 * 100) / 100;
    const currentOrder = await db.select({ weight: orders.weight }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (currentOrder[0] && currentOrder[0].weight == null) {
      await db.update(orders)
        .set({ weight: computedWeightOz.toString(), weightUnits: 'oz' })
        .where(eq(orders.id, orderId));
      console.log(`⚖️ Order ${orderId}: weight set to ${computedWeightOz} oz (${itemsTotalWeightGrams.toFixed(1)} g from ${blOrderItems.length} line items)`);
    }
  }

  // Trigger inventory adjustment for new orders after items are inserted
  if (isNewOrder) {
    console.log(`📦 New BrickLink order ${orderId} — triggering inventory adjustment`);
    adjustInventoryForOrder(orderId).catch(error => {
      console.error(`⚠️ Inventory adjustment failed for new order ${orderId}:`, error);
    });
  }
}

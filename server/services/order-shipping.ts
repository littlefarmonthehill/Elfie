/**
 * Order Shipping Service
 * 
 * Handles order splitting, shipment creation, and status synchronization.
 */

import { db } from '../db';
import { orders, orderDetails, orderSplits, orderSplitItems, shipments } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getShippingVendor } from './easypost';
import type { CreateShipmentRequest, BuyLabelRequest, Address, Parcel } from './shipping-vendor';

export interface ShipOrderRequest {
  orderId: string;
  itemIdsToShip: string[]; // Array of order_detail IDs to ship
  fromAddress: Address;
  parcel: Parcel;
}

export interface ShipmentPreview {
  willSplit: boolean;
  itemsToShip: any[];
  itemsToSplit: any[];
  splitOrderNumber?: string;
}

/**
 * Preview what will happen if we ship an order with selected items
 */
export async function previewShipment(orderId: string, itemIdsToShip: string[]): Promise<ShipmentPreview> {
  // Get all items for this order
  const allItems = await db
    .select()
    .from(orderDetails)
    .where(eq(orderDetails.orderId, orderId));

  const itemsToShip = allItems.filter(item => itemIdsToShip.includes(item.id));
  const itemsToSplit = allItems.filter(item => !itemIdsToShip.includes(item.id));

  const willSplit = itemsToSplit.length > 0;

  let splitOrderNumber: string | undefined;
  if (willSplit) {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    // Find next available split suffix
    const existingSplits = await db
      .select()
      .from(orderSplits)
      .where(eq(orderSplits.parentOrderId, orderId));

    const splitNumber = existingSplits.length + 1;
    splitOrderNumber = `${order.orderNumber}-${splitNumber}`;
  }

  return {
    willSplit,
    itemsToShip,
    itemsToSplit,
    splitOrderNumber,
  };
}

/**
 * Split an order into two orders
 * Uses a transaction to ensure atomicity - all operations succeed or all fail
 */
export async function splitOrder(orderId: string, itemIdsToKeep: string[]): Promise<{
  originalOrderId: string;
  splitOrderId: string;
  splitOrderNumber: string;
}> {
  // Wrap entire operation in a transaction for atomicity
  return await db.transaction(async (tx) => {
    // Get original order
    const [originalOrder] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!originalOrder) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Get all items
    const allItems = await tx
      .select()
      .from(orderDetails)
      .where(eq(orderDetails.orderId, orderId));

    const itemsToMove = allItems.filter(item => !itemIdsToKeep.includes(item.id));

    if (itemsToMove.length === 0) {
      throw new Error('No items to split');
    }

    // Find next split number
    const existingSplits = await tx
      .select()
      .from(orderSplits)
      .where(eq(orderSplits.parentOrderId, orderId));

    const splitNumber = existingSplits.length + 1;
    const splitOrderNumber = `${originalOrder.orderNumber}-${splitNumber}`;

    // Create new split order with $0 total
    const [splitOrder] = await tx
      .insert(orders)
      .values({
        id: `${orderId}-split-${splitNumber}`,
        orderNumber: splitOrderNumber,
        orderKey: originalOrder.orderKey,
        marketplace: originalOrder.marketplace,
        orderDate: originalOrder.orderDate,
        orderStatus: 'awaiting_shipment',
        customerUsername: originalOrder.customerUsername,
        customerEmail: originalOrder.customerEmail,
        shipTo: originalOrder.shipTo,
        billTo: originalOrder.billTo,
        shipByDate: originalOrder.shipByDate,
        orderTotal: '0.00', // Split orders have $0 total
        shippingAmount: '0.00',
        taxAmount: '0.00',
        internalNotes: `Split from ${originalOrder.orderNumber}`,
        customerNotes: originalOrder.customerNotes,
        requestedShippingService: originalOrder.requestedShippingService,
        localOnly: true, // Split orders don't sync to platforms
        parentOrderId: orderId,
      })
      .returning();

    // Record the split
    const [split] = await tx
      .insert(orderSplits)
      .values({
        parentOrderId: orderId,
        splitOrderId: splitOrder.id,
        splitSuffix: `-${splitNumber}`,
        reason: 'partial shipment',
      })
      .returning();

    // Move items to split order
    for (const item of itemsToMove) {
      // Create new order detail for split order
      const [newDetail] = await tx
        .insert(orderDetails)
        .values({
          orderId: splitOrder.id,
          lineItemKey: item.lineItemKey,
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxAmount: '0.00', // No tax on split
          weight: item.weight,
          weightUnits: item.weightUnits,
          description: item.description,
          options: item.options,
          bricklinkInventoryId: item.bricklinkInventoryId,
          colorId: item.colorId,
          condition: item.condition,
          fulfilled: false, // Not fulfilled yet
        })
        .returning();

      // Record which item moved to split - reference the NEW detail, not the deleted one
      await tx
        .insert(orderSplitItems)
        .values({
          splitId: split.id,
          orderDetailId: newDetail.id, // Reference the NEW order detail in split order
          quantityAssigned: item.quantity,
        });

      // Delete from original order (after creating split record)
      await tx
        .delete(orderDetails)
        .where(eq(orderDetails.id, item.id));
    }

    return {
      originalOrderId: orderId,
      splitOrderId: splitOrder.id,
      splitOrderNumber,
    };
  });
}

/**
 * Create shipment and get rates
 */
export async function createShipment(request: ShipOrderRequest): Promise<{
  shipmentId: string;
  rates: any[];
}> {
  const vendor = await getShippingVendor();

  // Get order details for address
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, request.orderId))
    .limit(1);

  if (!order) {
    throw new Error(`Order ${request.orderId} not found`);
  }

  // Parse ship-to address from order
  const shipTo = parseAddress(order.shipTo, order.customerUsername || 'Customer');

  const createRequest: CreateShipmentRequest = {
    toAddress: shipTo,
    fromAddress: request.fromAddress,
    parcel: request.parcel,
    reference: order.orderNumber,
  };

  const result = await vendor.createShipment(createRequest);

  return {
    shipmentId: result.shipmentId,
    rates: result.rates,
  };
}

/**
 * Buy shipping label and update order
 */
export async function purchaseLabel(
  orderId: string,
  shipmentId: string,
  rateId: string,
  insurance?: number
): Promise<{
  shipment: any;
  order: any;
}> {
  const vendor = await getShippingVendor();

  const buyRequest: BuyLabelRequest = {
    shipmentId,
    rateId,
    insurance,
  };

  const label = await vendor.buyLabel(buyRequest);

  // Create shipment record
  const [shipmentRecord] = await db
    .insert(shipments)
    .values({
      orderId,
      vendorCode: 'easypost',
      vendorShipmentId: label.shipmentId,
      carrier: label.carrier,
      service: label.service,
      trackingNumber: label.trackingNumber,
      labelUrl: label.labelUrl,
      labelFormat: label.labelFormat,
      cost: label.cost.toString(),
      currency: label.currency,
      status: 'purchased',
      metadata: JSON.stringify(label.metadata),
      purchasedAt: new Date(),
    })
    .returning();

  // Update order status to shipped
  const [updatedOrder] = await db
    .update(orders)
    .set({
      previousStatus: (await db.select().from(orders).where(eq(orders.id, orderId)).limit(1))[0]?.orderStatus,
      orderStatus: 'shipped',
      shipDate: new Date(),
      carrierCode: label.carrier,
      serviceCode: label.service,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId))
    .returning();

  // Mark all items as fulfilled
  const itemsToFulfill = await db
    .select()
    .from(orderDetails)
    .where(eq(orderDetails.orderId, orderId));

  for (const item of itemsToFulfill) {
    await db
      .update(orderDetails)
      .set({
        fulfilled: true,
        fulfilledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(orderDetails.id, item.id));
  }

  // Trigger inventory adjustment (imported from existing service)
  try {
    const { adjustInventoryForOrder } = await import('./inventory-adjustment');
    await adjustInventoryForOrder(orderId);
  } catch (error) {
    console.error('Error adjusting inventory:', error);
    // Don't fail the shipment if inventory adjustment fails
  }

  // Trigger platform sync (if not local-only)
  if (!updatedOrder.localOnly) {
    try {
      await syncOrderStatusToPlatform(updatedOrder);
    } catch (error) {
      console.error('Error syncing to platform:', error);
      // Don't fail the shipment if platform sync fails
    }
  }

  return {
    shipment: shipmentRecord,
    order: updatedOrder,
  };
}

/**
 * Sync order status back to platform
 */
async function syncOrderStatusToPlatform(order: any): Promise<void> {
  // Skip if local-only order
  if (order.localOnly) {
    return;
  }

  // This would integrate with BrickLink/BrickOwl APIs to update status
  // For now, just log it
  console.log(`📦 Would sync order ${order.orderNumber} status to ${order.marketplace}`);
  
  // TODO: Implement platform-specific status sync
  // - BrickLink: Update order status via API
  // - BrickOwl: Update order status via API
  // - Use existing ORDER_STATUS_MAPPINGS to map our status to platform status
}

/**
 * Parse address string to Address object
 * ShipStation format: "Name\nStreet\nCity, State ZIP\nCountry"
 */
function parseAddress(addressString: string, defaultName: string): Address {
  const lines = addressString.split('\n').map(l => l.trim()).filter(Boolean);
  
  if (lines.length < 3) {
    throw new Error('Invalid address format');
  }

  const name = lines[0] || defaultName;
  const street1 = lines[1] || '';
  const cityStateZip = lines[lines.length - 2] || '';
  const country = lines[lines.length - 1] || 'US';

  // Parse "City, State ZIP"
  const match = cityStateZip.match(/^(.+?),\s*([A-Z]{2})\s+(.+)$/);
  
  let city = '';
  let state = '';
  let zip = '';
  
  if (match) {
    city = match[1];
    state = match[2];
    zip = match[3];
  }

  return {
    name,
    street1,
    street2: lines.length > 4 ? lines[2] : undefined,
    city,
    state,
    zip,
    country,
  };
}

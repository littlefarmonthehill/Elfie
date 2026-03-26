/**
 * Order Shipping Service
 * 
 * Handles order splitting, shipment creation, and status synchronization.
 */

import { db } from '../db';
import { orders, orderDetails, orderSplits, orderSplitItems, shipments, orderAdjustments, appSettings } from '@shared/schema';
import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import { getShippingProvider } from './shipping-factory';
import type { CreateShipmentRequest, BuyLabelRequest, Address, Parcel, CustomsInfo, TaxIdentifier } from './shipping-vendor';

// ── Order shortcode — mirrors PackingSlip.tsx logic exactly ──────────────────
// Deterministic 2-char code from the order number. Same alphabet/hash as the
// client-side shortCode() so labels and packing slips always agree.
const SC_ALPHA = 'ABCDEFGHJKMPQRSTVWXYZ'; // 21 letters — no I, L, O, N, U
function orderShortCode(orderNumber: string): string {
  const s = orderNumber.trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = Math.imul(h, 33) ^ s.charCodeAt(i);
  h = h >>> 0;
  let code = '';
  for (let i = 0; i < 2; i++) { code += SC_ALPHA[h % SC_ALPHA.length]; h = Math.floor(h / SC_ALPHA.length); }
  return code;
}

// EU member states (ISO 3166-1 alpha-2) — IOSS applies for B2C shipments under €150
const EU_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI',
  'FR','GR','HR','HU','IE','IT','LT','LU','LV','MT',
  'NL','PL','PT','RO','SE','SI','SK',
]);

/**
 * Build customs info and tax identifiers for international shipments.
 * Returns null for domestic (US) shipments.
 */
async function buildInternationalShipping(
  destinationCountry: string,
  marketplace: string | null,
  itemSubtotal: number,
  totalWeightOz: number,
  totalQty: number,
  orgId: string,
): Promise<{ customsInfo: CustomsInfo; taxIdentifiers: TaxIdentifier[] } | null> {
  const country = (destinationCountry || 'US').toUpperCase();
  if (country === 'US') return null;

  // Fetch app settings for customs signer + IOSS/VAT numbers
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, orgId)).limit(1);
  const signer = settings?.customsSigner || 'Shipper';
  const isBrickLink = marketplace === 'BrickLink';

  // Tax identifier: IOSS (EU), UK VAT, etc.
  const taxIdentifiers: TaxIdentifier[] = [];

  if (EU_COUNTRIES.has(country)) {
    const iossNumber = isBrickLink ? settings?.blIossNumber : settings?.boIossNumber;
    if (iossNumber) {
      taxIdentifiers.push({ issuingCountry: 'EU', taxIdType: 'IOSS', taxId: iossNumber });
    }
  } else if (country === 'GB') {
    const ukVat = isBrickLink ? settings?.blUkVatNumber : settings?.boUkVatNumber;
    if (ukVat) {
      taxIdentifiers.push({ issuingCountry: 'GB', taxIdType: 'VAT', taxId: ukVat });
    }
  }

  // EEL/PFC: NOEEI 30.37(a) covers most low-value merchandise exports under $2,500
  const eelPfc = itemSubtotal < 2500 ? 'NOEEI 30.37(a)' : 'EEI';

  const customsInfo: CustomsInfo = {
    contentsType: 'merchandise',
    contentsExplanation: 'Plastic toy parts',
    eelPfc,
    customsCertify: true,
    customsSigner: signer,
    nonDeliveryOption: 'return',
    restrictionType: 'none',
    items: [
      {
        description: 'Plastic toy parts',
        quantity: Math.max(totalQty, 1),
        weight: Math.max(Math.round(totalWeightOz), 1),
        value: Math.max(itemSubtotal, 0.01),
        hsTariffNumber: '9503.00',
        originCountry: 'US',
      },
    ],
  };

  return { customsInfo, taxIdentifiers };
}

export interface OverrideAddress {
  name?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface ShipOrderRequest {
  orderId: string;
  itemIdsToShip: string[]; // Array of order_detail IDs to ship
  fromAddress: Address;
  parcel: Parcel;
  overrideToAddress?: OverrideAddress;
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
  // Get order first so we have orgId for credential lookup
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, request.orderId))
    .limit(1);

  if (!order) {
    throw new Error(`Order ${request.orderId} not found`);
  }

  const vendor = await getShippingProvider(order.orgId);

  // Parse ship-to address from order JSON (allow override from inline card address edit)
  let shipToData: any = {};
  try {
    shipToData = typeof order.shipTo === 'string' ? JSON.parse(order.shipTo) : (order.shipTo || {});
  } catch {}
  const baseShipTo: Address = {
    name:    shipToData.name    || '',
    company: shipToData.company || undefined,
    street1: shipToData.street1 || shipToData.address1 || '',
    street2: shipToData.street2 || shipToData.address2 || undefined,
    city:    shipToData.city    || '',
    state:   shipToData.state   || '',
    zip:     shipToData.postalCode || shipToData.zip || '',
    country: shipToData.country || 'US',
  };
  const shipTo: Address = request.overrideToAddress
    ? {
        name:    request.overrideToAddress.name    || baseShipTo.name,
        company: (request.overrideToAddress as any).company || baseShipTo.company,
        street1: request.overrideToAddress.street1 || baseShipTo.street1,
        street2: request.overrideToAddress.street2 ?? baseShipTo.street2,
        city:    request.overrideToAddress.city    || baseShipTo.city,
        state:   request.overrideToAddress.state   || baseShipTo.state,
        zip:     request.overrideToAddress.zip     || baseShipTo.zip,
        country: request.overrideToAddress.country || baseShipTo.country || 'US',
      }
    : baseShipTo;

  // Build customs info for international shipments
  let customsInfo: CustomsInfo | undefined;
  let taxIdentifiers: TaxIdentifier[] | undefined;
  const destCountry = (shipTo.country || 'US').toUpperCase();
  if (destCountry !== 'US') {
    // Fetch order items for declared value and quantity
    const items = await db
      .select({ quantity: orderDetails.quantity, unitPrice: orderDetails.unitPrice, weight: orderDetails.weight })
      .from(orderDetails)
      .where(eq(orderDetails.orderId, request.orderId));

    const itemSubtotal = items.reduce((sum, i) => {
      return sum + (i.quantity ?? 0) * parseFloat(i.unitPrice?.toString() || '0');
    }, 0);
    const totalQty = items.reduce((sum, i) => sum + (i.quantity ?? 0), 0);
    // Use parcel weight as the authoritative weight (already computed by caller)
    const totalWeightOz = request.parcel.weight;

    const intlShipping = await buildInternationalShipping(
      destCountry,
      order.marketplace,
      itemSubtotal,
      totalWeightOz,
      totalQty,
      order.orgId,
    );
    if (intlShipping) {
      customsInfo = intlShipping.customsInfo;
      taxIdentifiers = intlShipping.taxIdentifiers.length > 0 ? intlShipping.taxIdentifiers : undefined;
    }
    console.log(`🌍 International shipment to ${destCountry} — customs info built, declared value $${itemSubtotal.toFixed(2)}, tax IDs: ${taxIdentifiers?.length ?? 0}`);
  }

  const createRequest: CreateShipmentRequest = {
    toAddress: shipTo,
    fromAddress: request.fromAddress,
    parcel: request.parcel,
    reference: order.orderNumber
      ? `${orderShortCode(order.orderNumber)} ${order.orderNumber}`
      : undefined,
    customsInfo,
    taxIdentifiers,
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
  insurance?: number,
  orgId: string
): Promise<{
  shipment: any;
  order: any;
}> {
  // Determine test/production mode so we can stamp the shipment record
  const { appSettings } = await import('@shared/schema');
  const { eq: eqLocal } = await import('drizzle-orm');
  const [cfg] = await db.select().from(appSettings).where(eqLocal(appSettings.orgId, orgId)).limit(1);
  const isTestMode = (cfg?.easypostKeyMode ?? 'test') !== 'production';

  const vendor = await getShippingProvider(orgId);

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
      orgId,
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
      isTest: isTestMode,
      metadata: JSON.stringify(label.metadata),
      purchasedAt: new Date(),
    })
    .returning();

  // Update order status to shipped and auto-advance internal workflow to done
  const [updatedOrder] = await db
    .update(orders)
    .set({
      previousStatus: (await db.select().from(orders).where(eq(orders.id, orderId)).limit(1))[0]?.orderStatus,
      orderStatus: 'shipped',
      workflowStatus: 'done',
      shipDate: new Date(),
      carrierCode: label.carrier,
      serviceCode: label.service,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId))
    .returning();

  // Record shipping cost as a business cost adjustment (type='shipping_cost')
  // This feeds into cost analytics alongside merchant fees
  if (label.cost && Number(label.cost) > 0) {
    const carrier = [label.carrier, label.service].filter(Boolean).join(' ');
    await db.insert(orderAdjustments).values({
      orderId,
      type: 'shipping_cost',
      amount: (-Math.abs(Number(label.cost))).toFixed(2),
      reason: `Shipping — ${carrier || 'EasyPost'}`,
      notes: `Shipment ID: ${shipmentRecord.id}`,
    });
  }

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
    await adjustInventoryForOrder(orderId, 'shipping-label');
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

  const marketplace = order.marketplace?.toLowerCase();
  const trackingNumber = order.trackingNumber || '';
  const carrier = order.carrierCode || '';

  // Get shipment record to get tracking number
  const [shipment] = await db
    .select()
    .from(shipments)
    .where(eq(shipments.orderId, order.id))
    .orderBy(desc(shipments.purchasedAt))
    .limit(1);

  const actualTrackingNumber = shipment?.trackingNumber || trackingNumber;

  if (!actualTrackingNumber) {
    console.log(`⚠️  No tracking number for order ${order.orderNumber}, skipping platform sync`);
    return;
  }

  try {
    if (marketplace === 'bricklink') {
      await syncToBrickLink(order, actualTrackingNumber, carrier);
    } else if (marketplace === 'brickowl') {
      await syncToBrickOwl(order, actualTrackingNumber);
    } else {
      console.log(`📦 Platform sync not implemented for ${marketplace} (order ${order.orderNumber})`);
    }
  } catch (error: any) {
    console.error(`❌ Error syncing order ${order.orderNumber} to ${marketplace}:`, error.message);
    throw error;
  }
}

/**
 * Sync order to BrickLink
 */
async function syncToBrickLink(order: any, trackingNumber: string, carrier: string): Promise<void> {
  // Get BrickLink API credentials from org settings
  const { appSettings } = await import('@shared/schema');
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, order.orgId)).limit(1);

  const consumerKey = settings?.bricklinkConsumerKey || process.env.BRICKLINK_CONSUMER_KEY || '';
  const consumerSecret = settings?.bricklinkConsumerSecret || process.env.BRICKLINK_CONSUMER_SECRET || '';
  const tokenValue = settings?.bricklinkTokenValue || process.env.BRICKLINK_TOKEN_VALUE || '';
  const tokenSecret = settings?.bricklinkTokenSecret || process.env.BRICKLINK_TOKEN_SECRET || '';

  if (!consumerKey || !consumerSecret || !tokenValue || !tokenSecret) {
    console.log(`⚠️  BrickLink credentials not configured, skipping sync for order ${order.orderNumber}`);
    return;
  }

  // Extract BrickLink order ID from order number (e.g., "BL.12345678" -> "12345678")
  const blOrderId = order.orderNumber.replace(/^BL\./, '');

  const { updateBrickLinkOrderShipped } = await import('./bricklink-orders');
  await updateBrickLinkOrderShipped(
    blOrderId,
    trackingNumber,
    carrier,
    consumerKey,
    consumerSecret,
    tokenValue,
    tokenSecret
  );

  console.log(`✅ Synced order ${order.orderNumber} to BrickLink`);
}

/**
 * Sync order to BrickOwl
 */
async function syncToBrickOwl(order: any, trackingNumber: string): Promise<void> {
  // Get BrickOwl API credentials from org settings
  const { appSettings } = await import('@shared/schema');
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, order.orgId)).limit(1);

  const apiKey = settings?.brickowlApiKey || process.env.BRICKOWL_API_KEY || '';

  if (!apiKey) {
    console.log(`⚠️  BrickOwl API key not configured, skipping sync for order ${order.orderNumber}`);
    return;
  }

  // Extract BrickOwl order ID from order number (e.g., "BO.2801321" -> "2801321")
  const boOrderId = order.orderNumber.replace(/^BO\./, '');

  const { updateBrickOwlOrderShipped } = await import('./brickowl-orders');
  await updateBrickOwlOrderShipped(boOrderId, trackingNumber, apiKey);

  console.log(`✅ Synced order ${order.orderNumber} to BrickOwl`);
}

/**
 * Parse address string to Address object
 * Supports multiple formats:
 * - ShipStation format: "Name\nStreet\nCity, State ZIP\nCountry"
 * - BrickLink format: various formats
 * - Empty/null: returns test address
 */
function parseAddress(addressString: string | null, defaultName: string): Address {
  // If no address provided, return an EasyPost-approved test address for development
  if (!addressString || addressString.trim() === '') {
    return {
      name: defaultName || 'Test Customer',
      street1: '417 Montgomery Street',
      street2: 'Floor 5',
      city: 'San Francisco',
      state: 'CA',
      zip: '94104',
      country: 'US',
      phone: '4155559999',
    };
  }

  const lines = addressString.split('\n').map(l => l.trim()).filter(Boolean);
  
  // If insufficient lines, return an EasyPost-approved test address
  if (lines.length < 2) {
    return {
      name: defaultName || 'Test Customer',
      street1: '417 Montgomery Street',
      street2: 'Floor 5',
      city: 'San Francisco',
      state: 'CA',
      zip: '94104',
      country: 'US',
      phone: '4155559999',
    };
  }

  const name = lines[0] || defaultName;
  const street1 = lines[1] || 'Unknown Street';
  
  // Try to find city/state/zip line
  let cityStateZip = lines.length >= 3 ? lines[lines.length - 2] : '';
  if (lines.length === 2) {
    cityStateZip = ''; // Not enough info
  }
  const country = lines.length > 3 ? lines[lines.length - 1] : 'US';

  // Parse "City, State ZIP" pattern
  const match = cityStateZip.match(/^(.+?),\s*([A-Z]{2})\s+(.+)$/);
  
  let city = 'San Francisco';
  let state = 'CA';
  let zip = '94104';
  
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

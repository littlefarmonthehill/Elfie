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

/**
 * Extract the Mexico SAT tax ID (RFC/CURP) from raw shipTo data.
 *
 * Priority order:
 *   1. Dedicated taxId field stored during order sync (most reliable)
 *   2. "RFC: <value>" or "CURP: <value>" pattern anywhere in the address lines
 *   3. address1 ends with "RFC:" and address2 is an alphanumeric code (BrickOwl layout)
 */
function extractSatTaxId(shipToData: Record<string, any>): string | null {
  // 1. Dedicated field stored by sync
  if (shipToData.taxId) return String(shipToData.taxId).trim();

  // Concatenate all possible address line fields
  const allLines = [
    shipToData.address1, shipToData.address2, shipToData.address3,
    shipToData.street1,  shipToData.street2,
  ].filter(Boolean).join(' ');

  // 2. "RFC: XXXXXXX" or "CURP: XXXXXXXXXXXXXXXXXX" inline in address text
  const labeled = allLines.match(/\b(?:RFC|CURP)\s*:?\s*([A-Z0-9]{12,18})\b/i);
  if (labeled) return labeled[1].toUpperCase();

  // 3. address1 ends with "RFC:" and address2 is the bare value (common BrickOwl layout)
  const a1 = (shipToData.address1 || shipToData.street1 || '').trim();
  const a2 = (shipToData.address2 || shipToData.street2 || '').trim();
  if (/RFC\s*:?\s*$/i.test(a1) && /^[A-Z0-9]{12,18}$/i.test(a2)) {
    return a2.toUpperCase();
  }

  return null;
}

// EU member states (ISO 3166-1 alpha-2) — IOSS applies for B2C shipments under €150
const EU_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI',
  'FR','GR','HR','HU','IE','IT','LT','LU','LV','MT',
  'NL','PL','PT','RO','SE','SI','SK',
]);

// US military overseas addresses — require a customs form despite country='US'.
// State codes: AE (Europe/Middle East/Africa/Canada), AP (Pacific), AA (Americas).
// City names: APO, FPO, DPO (Diplomatic Pouch Office).
// Reference: https://www.usps.com/international/customs-forms.htm
const MILITARY_STATE_CODES = new Set(['AE','AP','AA']);
const MILITARY_CITY_RE = /^(APO|FPO|DPO)\b/i;

function isOverseasMilitary(country: string, state?: string, city?: string): boolean {
  if (country.toUpperCase() !== 'US') return false;
  if (state && MILITARY_STATE_CODES.has(state.toUpperCase())) return true;
  if (city && MILITARY_CITY_RE.test(city.trim())) return true;
  return false;
}

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
  customsDescription?: string,
  contentsTypeOverride?: string,
): Promise<{ customsInfo: CustomsInfo; taxIdentifiers: TaxIdentifier[] } | null> {
  const country = (destinationCountry || 'US').toUpperCase();
  if (country === 'US') return null;

  // Fetch app settings for customs signer + IOSS/VAT numbers
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.orgId, orgId)).limit(1);
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

  const contentsDesc = (customsDescription || '').trim() || 'Plastic toy parts';
  const resolvedContentsType = (contentsTypeOverride as any) || 'merchandise';

  const customsInfo: CustomsInfo = {
    contentsType: resolvedContentsType,
    contentsExplanation: contentsDesc,
    eelPfc,
    customsCertify: true,
    customsSigner: signer,
    nonDeliveryOption: 'return',
    restrictionType: 'none',
    items: [
      {
        description: contentsDesc,
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
  customsDescription?: string; // Override for customs "description of contents" (defaults to "Plastic toy parts")
  contentsType?: 'merchandise' | 'documents' | 'gift' | 'returned_goods' | 'other'; // Override customs contents type (default: 'merchandise')
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
        orgId: originalOrder.orgId,           // inherit org so the split order is visible
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
        // Inherit inventory state — items' qty was already deducted when the original
        // order synced in. Setting this prevents adjustInventoryForOrder from double-
        // deducting those items when the split order ships.
        inventoryDeducted: originalOrder.inventoryDeducted,
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

    // Stamp an internal note on the original order recording what was split off
    const splitDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const movedNames = itemsToMove.map(i => i.name).join(', ');
    const splitNote = `[${splitDate}] Split: ${itemsToMove.length} item${itemsToMove.length !== 1 ? 's' : ''} moved to ${splitOrderNumber} (${movedNames})`;
    await tx.update(orders)
      .set({
        internalNotes: sql`CASE WHEN ${orders.internalNotes} IS NULL OR ${orders.internalNotes} = '' THEN ${splitNote} ELSE ${orders.internalNotes} || E'\n' || ${splitNote} END`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

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
  addressNormalization: { changes: Array<{ field: string; original: string; normalized: string }>; warnings: string[] };
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
  if (!order.orgId) {
    throw new Error(`Order ${request.orderId} has no organisation — cannot create shipment`);
  }

  const vendor = await getShippingProvider(order.orgId);

  // Parse ship-to address from order JSON (allow override from inline card address edit)
  let shipToData: any = {};
  try {
    shipToData = typeof order.shipTo === 'string' ? JSON.parse(order.shipTo) : (order.shipTo || {});
  } catch {}
  // Resolve raw address lines (BrickLink uses street1/street2, BrickOwl uses address1/address2)
  const rawAddr1 = shipToData.street1 || shipToData.address1 || '';
  const rawAddr2 = shipToData.street2 || shipToData.address2 || undefined;
  // Detect when address1 is a secondary/attention line that comes before the actual street.
  // EasyPost's address normalization would otherwise swap the lines on the printed label.
  // Only match explicit attention/care-of keywords — do NOT use "doesn't start with digit"
  // as a fallback because directional streets like "N 5th Ave" or "SW Pine St" are valid
  // delivery addresses that don't start with a digit.
  const isAttentionLine = (s: string) =>
    /^(attention|attn\.?|att\.?|c\/o)\b/i.test(s.trim());
  const isSecondaryFirst = !!rawAddr2 && /^\d/.test(rawAddr2.trim()) && isAttentionLine(rawAddr1);
  // Build the company / street fields so the label line order is preserved:
  //   • No existing company → move attention line to `company` (EasyPost never normalises it)
  //   • Company already set → keep it; put the real street in street1 so EasyPost doesn't swap
  let resolvedCompany = shipToData.company || undefined;
  let resolvedStreet1 = rawAddr1;
  let resolvedStreet2 = rawAddr2;
  if (isSecondaryFirst) {
    if (!resolvedCompany) {
      resolvedCompany = rawAddr1;   // attention → company field
      resolvedStreet1 = rawAddr2!;  // street → street1
      resolvedStreet2 = undefined;
    } else {
      // Company slot taken — put real street in street1 so EasyPost won't reorder it,
      // attention goes to street2
      resolvedStreet1 = rawAddr2!;
      resolvedStreet2 = rawAddr1;
    }
  }
  // Extract SAT tax ID (RFC/CURP) for Mexico shipments
  const rawCountry = (shipToData.country || 'US').toUpperCase();
  const satTaxId = (rawCountry === 'MX' || rawCountry === 'MEXICO')
    ? extractSatTaxId(shipToData)
    : null;

  const baseShipTo: Address = {
    name:    shipToData.name    || '',
    company: resolvedCompany,
    street1: resolvedStreet1,
    street2: resolvedStreet2,
    city:    shipToData.city    || '',
    state:   shipToData.state   || '',
    zip:     shipToData.postalCode || shipToData.zip || '',
    country: shipToData.country || 'US',
    ...(shipToData.phone ? { phone: shipToData.phone } : {}),
    ...(satTaxId ? { federalTaxId: satTaxId } : {}),
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
        // Preserve phone through address override
        phone: (request.overrideToAddress as any).phone || baseShipTo.phone,
        // Preserve SAT tax ID through address override (unless caller explicitly clears it)
        federalTaxId: (request.overrideToAddress as any).federalTaxId ?? baseShipTo.federalTaxId,
      }
    : baseShipTo;

  // Build customs info for international shipments AND US overseas military addresses.
  // APO/FPO/DPO destinations have country='US' but still require customs forms per USPS.
  let customsInfo: CustomsInfo | undefined;
  let taxIdentifiers: TaxIdentifier[] | undefined;
  const destCountry = (shipTo.country || 'US').toUpperCase();
  const militaryOverride = destCountry === 'US' && isOverseasMilitary(destCountry, shipTo.state, shipTo.city);
  // Use 'MILITARY' as effective country so buildInternationalShipping skips the country==='US' early-return
  const effectiveCountry = militaryOverride ? 'MILITARY' : destCountry;

  if (effectiveCountry !== 'US') {
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
      effectiveCountry,
      order.marketplace,
      itemSubtotal,
      totalWeightOz,
      totalQty,
      order.orgId,
      request.customsDescription,
      request.contentsType,
    );
    if (intlShipping) {
      customsInfo = intlShipping.customsInfo;
      taxIdentifiers = intlShipping.taxIdentifiers.length > 0 ? intlShipping.taxIdentifiers : undefined;
    }
    const label = militaryOverride
      ? `🪖 Military overseas (${shipTo.state ?? shipTo.city})`
      : `🌍 International (${destCountry})`;
    console.log(`${label} — customs info built, declared value $${itemSubtotal.toFixed(2)}, tax IDs: ${taxIdentifiers?.length ?? 0}${shipTo.federalTaxId ? `, SAT RFC/CURP: ${shipTo.federalTaxId}` : ''}`);
  }

  // Build the order reference string: "[AB] BO.8362106"
  const orderRef = order.orderNumber
    ? (() => {
        const sc = orderShortCode(order.orderNumber);
        const prefix = order.marketplace === 'BrickOwl' ? 'BO.' : 'BL.';
        // Strip any existing marketplace prefix (bl-, BL., bo-, BO.) so we never double-prefix
        const num = order.orderNumber.replace(/^(bl[-.]|bo[-.]|BL[-.]|BO[-.])/i, '');
        return `${sc} ${prefix}${num}`;
      })()
    : undefined;

  // Determine label format based on org's print settings
  let labelFormat: 'PDF' | 'ZPL' = 'PDF';
  try {
    const [printCfg] = await db.select({ printMethod: appSettings.printMethod })
      .from(appSettings).where(eq(appSettings.orgId, order.orgId)).limit(1);
    if (printCfg?.printMethod === 'direct_zpl') labelFormat = 'ZPL';
  } catch {}

  const createRequest: CreateShipmentRequest = {
    toAddress: shipTo,
    fromAddress: request.fromAddress,
    parcel: request.parcel,
    reference: orderRef,
    customsInfo,
    taxIdentifiers,
    labelFormat,
  };

  const result = await vendor.createShipment(createRequest);

  return {
    shipmentId: result.shipmentId,
    rates: result.rates,
    addressNormalization: (result.metadata as any)?.addressNormalization
      ?? { changes: [], warnings: [] },
  };
}

/**
 * Buy shipping label and update order
 */
export async function purchaseLabel(
  orderId: string,
  shipmentId: string,
  rateId: string,
  orgId: string,
  insurance?: number,
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
      trackingStatus: 'pre_transit',
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
 * Ship an order without purchasing a carrier label.
 * Marks it shipped/done internally, adjusts inventory, and syncs status to the
 * marketplace (BrickLink / BrickOwl) with the supplied tracking number (may be empty).
 * The optional note is appended to the order's internal notes.
 * Does NOT create a 'purchased' shipment record, so this order is excluded from
 * the end-of-day SCAN form flow automatically.
 */
export async function shipWithoutLabel(
  orderId: string,
  orgId: string,
  trackingNumber: string,
  note: string,
): Promise<void> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) throw new Error(`Order ${orderId} not found`);

  // Append note to internal notes if provided
  const mergedNotes = [order.internalNotes, note].filter(Boolean).join('\n') || null;

  // Mark order as shipped and advance workflow to done
  const [updatedOrder] = await db
    .update(orders)
    .set({
      previousStatus: order.orderStatus,
      orderStatus: 'shipped',
      workflowStatus: 'done',
      shipDate: new Date(),
      ...(mergedNotes !== null ? { internalNotes: mergedNotes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId))
    .returning();

  // Record a manual shipment so the tracking number is stored, but use
  // status='manual' so it never shows up in the EOD/SCAN form query.
  if (trackingNumber) {
    await db.insert(shipments).values({
      orderId,
      orgId,
      vendorCode: 'manual',
      vendorShipmentId: `manual-${Date.now()}`,
      trackingNumber,
      status: 'manual',
      purchasedAt: new Date(),
    });
  }

  // Mark all items fulfilled
  await db
    .update(orderDetails)
    .set({ fulfilled: true, fulfilledAt: new Date(), updatedAt: new Date() })
    .where(eq(orderDetails.orderId, orderId));

  // Adjust inventory (non-fatal)
  try {
    const { adjustInventoryForOrder } = await import('./inventory-adjustment');
    await adjustInventoryForOrder(orderId, 'manual-ship');
  } catch (error) {
    console.error('[shipWithoutLabel] Inventory adjustment failed (non-fatal):', error);
  }

  // Sync shipped status to the marketplace (non-fatal — don't block on API errors)
  if (!updatedOrder.localOnly) {
    try {
      await syncShippedStatus(updatedOrder, trackingNumber);
    } catch (error) {
      console.error('[shipWithoutLabel] Platform sync failed (non-fatal):', error);
    }
  }
}

/**
 * Push "shipped" status to BrickLink or BrickOwl directly.
 * Unlike the private syncOrderStatusToPlatform(), this never skips on missing
 * tracking — BrickOwl only needs the status change; BrickLink accepts an empty
 * tracking_no string and still moves the order to SHIPPED.
 */
export async function syncShippedStatus(order: any, trackingNumber: string, carrier: string = ''): Promise<void> {
  if (order.localOnly) return;
  const marketplace = order.marketplace?.toLowerCase();
  try {
    if (marketplace === 'bricklink') {
      await syncToBrickLink(order, trackingNumber, carrier);
    } else if (marketplace === 'brickowl') {
      await syncToBrickOwl(order, trackingNumber);
    } else if (marketplace === 'ebay') {
      const { syncToEbay } = await import('./ebay-fulfillment');
      await syncToEbay(order, trackingNumber, carrier);
    } else {
      console.log(`[syncShippedStatus] No sync handler for marketplace: ${marketplace}`);
    }
  } catch (error: any) {
    console.error(`[syncShippedStatus] Error syncing order ${order.orderNumber} to ${marketplace}:`, error.message);
    throw error;
  }
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
    } else if (marketplace === 'ebay') {
      const { syncToEbay } = await import('./ebay-fulfillment');
      await syncToEbay(order, actualTrackingNumber, carrier);
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
  // Never fire against real BrickLink (or email real buyers) from a dev server
  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV] syncToBrickLink suppressed for order ${order.orderNumber} — would send tracking ${trackingNumber} to BL`);
    return;
  }

  // Get BrickLink API credentials from org_integrations
  const { getBricklinkCredentials } = await import('./bricklink');
  let consumerKey: string, consumerSecret: string, tokenValue: string, tokenSecret: string;
  try {
    ({ consumerKey, consumerSecret, tokenValue, tokenSecret } = await getBricklinkCredentials(order.orgId));
  } catch {
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
  // Never fire against real BrickOwl (or email real buyers) from a dev server
  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV] syncToBrickOwl suppressed for order ${order.orderNumber} — would send tracking ${trackingNumber} to BO`);
    return;
  }

  // Get BrickOwl API key from org_integrations
  const { getBrickOwlApiKey } = await import('./brickowl');
  const apiKey = await getBrickOwlApiKey(order.orgId);

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
 * - Multi-line format: "Name\nStreet\nCity, State ZIP\nCountry"
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

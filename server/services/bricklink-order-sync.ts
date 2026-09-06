import { db } from "../db";
import { orders, orderDetails, orderAdjustments, blInventory, blCatalog, syncIssues } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { getBrickLinkOrders, getBrickLinkOrderDetail, getBrickLinkOrderItems, getBrickLinkOrderMessages, mapBrickLinkCondition } from "./bricklink-orders";
import { bricklinkRequest, getBricklinkCredentials } from "./bricklink";
import { mapPlatformStatus } from "../config/order-status-mapping";
import { adjustInventoryForOrder } from "./inventory-adjustment";
import { upsertSyncMetadata, resolveExistingOrder, resolveOrderStatus } from "./order-sync-helpers";

const SYNC_ID = 'bricklink_orders';

/**
 * Fetch a single BrickLink inventory lot by ID and upsert it into the local db.
 * Called when an order item references a lot that doesn't exist locally yet —
 * e.g. a part listed during the day before the nightly inventory sync runs.
 */
async function fetchAndCacheMissingLot(inventoryId: number, orgId: string): Promise<boolean> {
  try {
    const { data } = await bricklinkRequest(`/inventories/${inventoryId}`, undefined, orgId);
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
      orgId,
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
  newOrderIds: string[];
  ordersUpdated: number;
  orderDetailsAdded: number;
  totalOrders: number;
  errors: string[];
  needsInventorySync?: boolean;
}

export function hasBrickLinkPaymentAfterLastSync(
  payment: { status?: string | null; date_paid?: string | null } | null | undefined,
  syncedAt: Date | string | null | undefined
): boolean {
  if (!payment?.status || payment.status === 'None' || payment.status === 'Returned' || !payment.date_paid) {
    return false;
  }

  const paidAtMs = new Date(payment.date_paid).getTime();
  const syncedAtMs = syncedAt ? new Date(syncedAt).getTime() : 0;
  return Number.isFinite(paidAtMs) && paidAtMs > syncedAtMs;
}

export function hasBrickLinkOrderUpdateAfterLastSync(
  dateStatusChanged: string | null | undefined,
  syncedAt: Date | string | null | undefined
): boolean {
  if (!dateStatusChanged) return false;

  const changedAtMs = new Date(dateStatusChanged).getTime();
  const syncedAtMs = syncedAt ? new Date(syncedAt).getTime() : 0;
  return Number.isFinite(changedAtMs) && changedAtMs > syncedAtMs;
}

/**
 * Sync orders directly from BrickLink API.
 *
 * Uses status-comparison incremental sync: fetch all orders, filter locally to
 * only process orders that are new or have changed status since the last run.
 * Full sync mode bypasses this filter and processes every order.
 */
export async function syncBrickLinkOrders(
  orgId: string,
  options: { limit?: number; fullSync?: boolean; sinceDate?: string; forceOrderIds?: Set<string>; skipMetadata?: boolean } = {},
  onProgress?: (processed: number, total: number) => void
): Promise<BrickLinkOrderSyncResult> {
  const result: BrickLinkOrderSyncResult = {
    ordersAdded: 0,
    newOrderIds: [],
    ordersUpdated: 0,
    orderDetailsAdded: 0,
    totalOrders: 0,
    errors: [],
  };

  try {
    console.log(`\n📦 Starting BrickLink order sync...`);

    let consumerKey: string, consumerSecret: string, tokenValue: string, tokenSecret: string;
    try {
      ({ consumerKey, consumerSecret, tokenValue, tokenSecret } = await getBricklinkCredentials(orgId));
    } catch (credErr: any) {
      return { ...result, errors: [`BrickLink credentials not configured: ${credErr.message}`] };
    }

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

    let allOrders = fetchedOrders;

    // Targeted heal: when forceOrderIds is supplied (e.g. by the order health
    // audit), restrict the fetched list to ONLY those orders. This guarantees
    // BrickLink is touched only for orders that actually need re-processing —
    // no incidental detail/items/messages calls for unrelated orders that
    // would otherwise pass the normal incremental filter.
    if (options.forceOrderIds && options.forceOrderIds.size > 0) {
      allOrders = fetchedOrders.filter((o: any) => options.forceOrderIds!.has(`bl-${o.order_id}`));
      console.log(`🎯 Targeted heal: processing ${allOrders.length} of ${fetchedOrders.length} fetched order(s) (${options.forceOrderIds.size} requested)`);
      // When forceOrderIds is supplied, `limit` is intentionally ignored — heal
      // must process every requested order, never drop some on the floor.
      if (options.limit && options.limit < options.forceOrderIds.size) {
        console.warn(`⚠️ Ignoring options.limit=${options.limit} because forceOrderIds (${options.forceOrderIds.size}) was supplied — targeted heal processes all requested orders.`);
      }
    } else if (options.sinceDate) {
      // Date-scoped sync: process all orders placed or updated on/after the given date.
      const sinceMs = new Date(options.sinceDate).getTime();
      allOrders = fetchedOrders.filter((order: any) => {
        const orderedMs = order.date_ordered ? new Date(order.date_ordered).getTime() : 0;
        const changedMs = order.date_status_changed ? new Date(order.date_status_changed).getTime() : 0;
        return Math.max(orderedMs, changedMs) >= sinceMs;
      });
      console.log(`📅 Date-scoped sync: ${allOrders.length} orders on/after ${options.sinceDate} (skipped ${fetchedOrders.length - allOrders.length})`);
    } else if (!options.fullSync) {
      // Incremental: only process orders that are new, have changed status, or have
      // an incomplete address (e.g. blank state from a prior partial sync).
      const existingOrders = await db
        .select({
          id: orders.id,
          orderStatus: orders.orderStatus,
          workflowStatus: orders.workflowStatus,
          shipTo: orders.shipTo,
          customerNotes: orders.customerNotes,
          syncedAt: orders.syncedAt,
        })
        .from(orders)
        .where(and(eq(orders.orgId, orgId), sql`${orders.id} LIKE 'bl-%'`));

      const existingMap = new Map(existingOrders.map(o => [o.id, {
        status: o.orderStatus,
        workflowStatus: o.workflowStatus,
        shipTo: o.shipTo,
        customerNotes: o.customerNotes,
        syncedAt: o.syncedAt,
      }]));

      const CLOSED_STATUSES = new Set(['shipped', 'returned', 'cancelled', 'Cancelled', 'purged', 'completed', 'Completed']);

      allOrders = fetchedOrders.filter((order: any) => {
        const orderId = `bl-${order.order_id}`;
        const existing = existingMap.get(orderId);
        if (!existing) return true; // New order — process it

        // Soft-purged locally (operator deleted the test order) — never re-import.
        if (existing.status === 'purged') return false;

        // BrickLink keeps order status as COMPLETED on returns; only payment.status changes.
        const isPaymentReturned = order.payment?.status === 'Returned';
        // Already returned locally — skip to prevent perpetual reprocessing.
        if (existing.status === 'returned') return false;
        // Completed orders: only reprocess on a payment return.
        // This prevents stale BrickLink status from overwriting a locally-completed order.
        if (existing.status === 'completed') return isPaymentReturned;

        // Shipped orders: allow advancement to 'completed' (buyer acknowledged receipt),
        // but block everything else to prevent stale BL data from reverting the status.
        if (existing.status === 'shipped') {
          const incomingStatus = mapPlatformStatus('bricklink', order.status);
          return isPaymentReturned || incomingStatus === 'completed';
        }

        const newStatus = mapPlatformStatus('bricklink', order.status);
        if (existing.status !== newStatus) return true; // Status changed

        // BrickLink can update remarks, addresses, shipping, totals, or items
        // without changing the normalized order status. Reprocess any order whose
        // channel update timestamp is newer than our last successful processing.
        if (hasBrickLinkOrderUpdateAfterLastSync(order.date_status_changed, existing.syncedAt)) return true;

        // Payment changes are independent of both BrickLink's order status and our
        // local workflow. For example, an old unpaid order may be moved to "bump"
        // before the buyer pays. BrickLink supplies date_paid in the order summary,
        // so compare it with the last successful processing time instead of relying
        // on workflowStatus === 'unpaid'.
        if (hasBrickLinkPaymentAfterLastSync(order.payment, existing.syncedAt)) return true;

        // Always re-check orders stuck in unpaid workflow — BrickLink payment.status
        // changes do NOT update date_status_changed, so incremental sync would otherwise
        // miss the payment arrival and leave the order perpetually in 'unpaid'.
        if (existing.workflowStatus === 'unpaid') return true;

        // Re-process active orders that need enrichment — but NOT closed ones
        // (shipped/completed/etc) to keep incremental syncs fast.
        if (!CLOSED_STATUSES.has(existing.status)) {
          try {
            const addr = existing.shipTo ? JSON.parse(existing.shipTo) : {};
            if (!addr.state) return true; // Missing address state
          } catch { /* ignore bad JSON */ }

          // customerNotes === null means detail was never fetched. Re-process to fill it in.
          if (existing.customerNotes === null) return true;
        }

        return false;
      });

      console.log(`📅 Incremental: ${allOrders.length} new/changed orders to process (skipped ${fetchedOrders.length - allOrders.length} unchanged)`);
    } else {
      console.log(`🔄 Full sync: processing all ${allOrders.length} orders`);
    }

    if (options.limit && allOrders.length > options.limit) {
      console.log(`📦 Applying limit: processing ${options.limit} of ${allOrders.length} orders`);
      allOrders = allOrders.slice(0, options.limit);
    }

    result.totalOrders = allOrders.length;

    let processed = 0;
    for (const blOrder of allOrders) {
      try {
        await processBrickLinkOrder(blOrder, consumerKey, consumerSecret, tokenValue, tokenSecret, orgId, result);
      } catch (error: any) {
        console.error(`✗ Error processing BrickLink order ${blOrder.order_id}:`, error);
        result.errors.push(`Order ${blOrder.order_id}: ${error.message}`);
      }
      processed++;
      onProgress?.(processed, allOrders.length);
    }

    // If any returns were detected, trigger a BrickLink inventory sync so local
    // quantities reflect what the seller restored on BrickLink's side.
    if (result.needsInventorySync) {
      console.log(`↩️ Return(s) detected — triggering BrickLink inventory sync to pull restored quantities...`);
      import('./bricklink').then(({ syncBricklinkInventory }) => {
        syncBricklinkInventory(true, orgId).catch((err: any) => {
          console.error('⚠️ Post-return inventory sync failed:', err.message);
        });
      });
    }

    if (!options.skipMetadata) {
      await upsertSyncMetadata(SYNC_ID, orgId, {
        status: 'success',
        recordsAdded: result.ordersAdded,
        recordsUpdated: result.ordersUpdated,
      });
    }

    console.log(`✓ BrickLink order sync complete:`, {
      ordersAdded: result.ordersAdded,
      ordersUpdated: result.ordersUpdated,
      orderDetailsAdded: result.orderDetailsAdded,
      errors: result.errors.length,
    });

    return result;

  } catch (error: any) {
    console.error('✗ BrickLink order sync failed:', error);
    if (!options.skipMetadata) {
      await upsertSyncMetadata(SYNC_ID, orgId, { status: 'error', errorMessage: error.message });
    }
    throw error;
  }
}

/**
 * Process a single BrickLink order: upsert the order record, backfill any
 * missing inventory lots, upsert line items, and trigger inventory adjustments.
 */
async function processBrickLinkOrder(
  blOrder: any,
  consumerKey: string,
  consumerSecret: string,
  tokenValue: string,
  tokenSecret: string,
  orgId: string,
  result: BrickLinkOrderSyncResult
): Promise<void> {
  const orderId = `bl-${blOrder.order_id}`;

  // Canonical ID → legacy "BL." prefix format (prevents duplicate records on full sync)
  const existingOrder = await resolveExistingOrder(orderId, orgId, `BL.${blOrder.order_id}`);

  // Soft-purged locally (operator deleted the test order) — never re-import.
  // This fires on both incremental AND full-sync paths, guarding against the case
  // where the full sync bypasses the pre-loop status filter.
  if (existingOrder?.orderStatus === 'purged') {
    console.log(`⏭️ BrickLink order ${orderId} is purged locally — skipping`);
    return;
  }

  const isReturn = blOrder.payment?.status === 'Returned';
  const normalizedStatus = isReturn ? 'returned' : mapPlatformStatus('bricklink', blOrder.status);
  // BrickLink payment.status 'None' (or absent) means payment not yet received.
  const isUnpaid = !isReturn && (!blOrder.payment?.status || blOrder.payment?.status === 'None');

  // Fetch full order detail for cost/shipping/address breakdown
  let orderDetail: any = null;
  try {
    orderDetail = await getBrickLinkOrderDetail(
      blOrder.order_id, consumerKey, consumerSecret, tokenValue, tokenSecret
    );
  } catch (err: any) {
    console.warn(`⚠️ Could not fetch order detail for ${blOrder.order_id}: ${err.message}`);
  }

  // Fetch buyer messages — BrickLink buyers can send in-app messages alongside or
  // instead of using the checkout remarks field. Use the first buyer message as a
  // fallback note when the order-level remarks field is empty.
  let buyerMessage: string | null = null;
  try {
    const messages = await getBrickLinkOrderMessages(
      blOrder.order_id, consumerKey, consumerSecret, tokenValue, tokenSecret
    );
    const buyerName = (orderDetail?.buyer_name || blOrder.buyer_name || '').toLowerCase();
    const fromBuyer = messages.filter((m: any) =>
      m.from && m.from.toLowerCase() === buyerName && m.body?.trim()
    );
    if (fromBuyer.length > 0) {
      buyerMessage = fromBuyer[0].body.trim();
    }
  } catch (err: any) {
    console.warn(`⚠️ Could not fetch messages for ${blOrder.order_id}: ${err.message}`);
  }

  const cost = orderDetail?.cost || blOrder.cost || {};
  const shipping = orderDetail?.shipping || blOrder.shipping || {};
  const addr = shipping?.address || {};

  // Resolve state: try every known BL API field variant, then fall back to
  // parsing the "full" formatted address string (e.g. "City, ST 12345\nCountry").
  const resolveState = (): string => {
    // Direct field variants BrickLink has used across API versions
    const direct = addr.state || addr.state_or_province || addr.province || addr.region || '';
    if (direct) return direct;
    // Last resort: parse from the full formatted address string.
    // BL formats US addresses as "...\nCity, ST ZIP\nCountry" or "City, ST  ZIP".
    const full: string = addr.full || '';
    if (full) {
      // Match "XX" state abbreviation preceded by ", " and followed by whitespace+digits or end
      const m = full.match(/,\s+([A-Z]{2})\s+\d/);
      if (m) return m[1];
    }
    return '';
  };
  const resolvedState = resolveState();

  // Log the raw address whenever state comes up empty — helps diagnose BL API changes.
  if (addr && !resolvedState) {
    console.warn(`[BL Order ${blOrder.order_id}] State empty after all fallbacks. Raw address: ${JSON.stringify(addr)}`);
  }

  const syncTime = new Date();
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
      name: addr.name?.full || '',
      street1: addr.address1 || '',
      street2: addr.address2 || '',
      city: addr.city || '',
      state: resolvedState,
      postalCode: addr.postal_code || '',
      country: addr.country_code || '',
      // BrickLink provides phone_number only when the buyer includes it with their shipping address.
      ...(addr.phone_number ? { phone: addr.phone_number } : {}),
    }),
    billTo: null,
    shipByDate: null,
    orderTotal: cost?.grand_total ? cost.grand_total.toString() : '0',
    shippingAmount: cost?.shipping ? cost.shipping.toString() : '0',
    taxAmount: cost?.salesTax_collected_by_bl
      ? cost.salesTax_collected_by_bl.toString()
      : (cost?.vat_amount ? cost.vat_amount.toString() : '0'),
    insuranceAmount: cost?.insurance ? cost.insurance.toString() : null,
    internalNotes: null,
    // Priority: checkout remarks > buyer in-app message > previous stored value > ''
    // null is reserved for "detail never fetched successfully".
    customerNotes: orderDetail != null
      ? ((orderDetail.remarks || '').trim() || buyerMessage || existingOrder?.customerNotes || '')
      : (blOrder.remarks || buyerMessage || existingOrder?.customerNotes || null),
    requestedShippingService: shipping?.method || null,
    carrierCode: null,
    serviceCode: null,
    weight: null,
    weightUnits: null,
    syncedAt: syncTime,
    updatedAt: syncTime,
  };

  let isNewOrder = false;

  if (existingOrder) {
    const { status: updatedStatus, wasDemotionBlocked } = resolveOrderStatus(
      existingOrder.orderStatus,
      normalizedStatus,
      isReturn
    );

    if (wasDemotionBlocked) {
      console.log(`🔒 Order ${orderId}: Preserving local shipped status (BrickLink shows: ${normalizedStatus})`);
    }

    const { weight: _w, weightUnits: _wu, ...coreOrderData } = orderData;
    await db
      .update(orders)
      .set({
        ...coreOrderData,
        id: existingOrder.id,
        orderStatus: updatedStatus,
        previousStatus: existingOrder.orderStatus,
        // Only set BL weight if no weight is saved yet (don't overwrite manual entries)
        ...(existingOrder.weight == null && orderData.weight
          ? { weight: orderData.weight, weightUnits: orderData.weightUnits }
          : {}),
        // Auto-promote: payment arrived and workflow still 'unpaid' → advance to 'new'
        ...(existingOrder.workflowStatus === 'unpaid' && !isUnpaid
          ? { workflowStatus: 'new' }
          // Auto-demote: still unpaid and workflow is at default 'new' → flag as 'unpaid'
          : existingOrder.workflowStatus === 'new' && isUnpaid
          ? { workflowStatus: 'unpaid' }
          : {}),
      })
      .where(eq(orders.id, existingOrder.id));

    if (existingOrder.workflowStatus === 'unpaid' && !isUnpaid) {
      console.log(`💳 BrickLink order ${orderId}: payment received — auto-promoting workflowStatus 'unpaid' → 'new'`);
    } else if (existingOrder.workflowStatus === 'new' && isUnpaid) {
      console.log(`💳 BrickLink order ${orderId}: payment not received — auto-setting workflowStatus 'new' → 'unpaid'`);
    }

    result.ordersUpdated++;

    const effectiveStatusChange = existingOrder.orderStatus !== updatedStatus;
    if (effectiveStatusChange) {
      console.log(`📦 Order ${orderId} status changed: ${existingOrder.orderStatus} → ${updatedStatus}`);

      if (isReturn) {
        // BrickLink has the seller restore inventory directly — skip our own adjustment
        // to avoid double-counting. Flag for a post-sync inventory pull instead.
        console.log(`↩️ Order ${orderId} is a return — skipping inventory adjustment, inventory sync will run after.`);
        result.needsInventorySync = true;

        const externalId = `bl-${blOrder.order_id}-return`;
        const refundAmount = cost?.grand_total ? Number(cost.grand_total) : null;
        if (refundAmount && refundAmount > 0) {
          const existing = await db
            .select({ id: orderAdjustments.id })
            .from(orderAdjustments)
            .where(eq(orderAdjustments.externalTransactionId, externalId))
            .limit(1);
          if (existing.length === 0) {
            await db.insert(orderAdjustments).values({
              orderId,
              type: 'refund',
              amount: (-refundAmount).toFixed(2),
              paymentMethod: 'bricklink',
              externalTransactionId: externalId,
              reason: 'Customer return',
              notes: `BrickLink return on order ${blOrder.order_id} — refund of $${refundAmount.toFixed(2)} (payment.status: Returned, date: ${blOrder.payment?.date_paid ?? 'unknown'})`,
              orgId,
            });
            console.log(`↩️ Order ${orderId}: recorded refund adjustment of -$${refundAmount.toFixed(2)}`);
          }
        } else {
          console.warn(`⚠️ Order ${orderId}: BrickLink return detected but cost.grand_total is missing or zero — refund adjustment NOT recorded. cost=${JSON.stringify(cost)}`);
        }
      } else {
        console.log(`🔄 BrickLink order ${orderId} status changed (${existingOrder.orderStatus} → ${updatedStatus}) — triggering inventory adjustment`);
        adjustInventoryForOrder(orderId, 'bl-status-change').catch(error => {
          console.error(`⚠️ Inventory adjustment failed for order ${orderId}:`, error);
          result.errors.push(`Inventory adjustment failed for ${orderId}: ${error.message}`);
        });
      }
    }
  } else {
    // UPSERT instead of plain INSERT — mirrors the BrickOwl sync fix.
    // Handles race conditions from concurrent manual syncs and server restarts.
    // inventoryDeducted is intentionally excluded from the conflict update set so
    // a previously-deducted order is never double-deducted on a re-sync.
    if (isUnpaid) {
      console.log(`💳 BrickLink order ${orderId}: payment not received — setting workflowStatus='unpaid'`);
    }
    const [upserted] = await db
      .insert(orders)
      .values([{ ...orderData, orgId, workflowStatus: isUnpaid ? 'unpaid' : 'new' }])
      .onConflictDoUpdate({
        target: orders.id,
        set: {
          orderStatus:              sql`EXCLUDED.order_status`,
          previousStatus:           sql`EXCLUDED.previous_status`,
          customerUsername:         sql`EXCLUDED.customer_username`,
          customerEmail:            sql`EXCLUDED.customer_email`,
          shipTo:                   sql`EXCLUDED.ship_to`,
          billTo:                   sql`EXCLUDED.bill_to`,
          shipByDate:               sql`EXCLUDED.ship_by_date`,
          orderTotal:               sql`EXCLUDED.order_total`,
          shippingAmount:           sql`EXCLUDED.shipping_amount`,
          taxAmount:                sql`EXCLUDED.tax_amount`,
          insuranceAmount:          sql`EXCLUDED.insurance_amount`,
          internalNotes:            sql`EXCLUDED.internal_notes`,
          customerNotes:            sql`EXCLUDED.customer_notes`,
          requestedShippingService: sql`EXCLUDED.requested_shipping_service`,
          carrierCode:              sql`EXCLUDED.carrier_code`,
          serviceCode:              sql`EXCLUDED.service_code`,
          syncedAt:                 sql`EXCLUDED.synced_at`,
          updatedAt:                sql`EXCLUDED.updated_at`,
          // inventoryDeducted: deliberately NOT included — preserves true from a prior sync session
          // orgId: deliberately NOT included — org never changes on a re-sync
        },
      })
      .returning({ id: orders.id, inventoryDeducted: orders.inventoryDeducted });

    if (!upserted?.inventoryDeducted) {
      result.ordersAdded++;
    } else {
      console.log(`⚠️ BrickLink order ${orderId}: UPSERT conflict — inventoryDeducted already true (prior sync session). Skipping re-adjustment.`);
      result.ordersUpdated++;
    }
    isNewOrder = !upserted?.inventoryDeducted;
  }

  // Fetch and process order line items.
  // BrickLink's /orders/{id}/items endpoint occasionally returns a truncated/
  // partial response (e.g. returns one of two batches), with no error. That's
  // what caused order bl-31642438 to be inserted with 1 of 2 line items even
  // though both lots were already in local inventory.
  // Defense: compare the sum of items × unit_price against the cost breakdown
  // we already have from getBrickLinkOrderDetail (grand_total − shipping − tax
  // − insurance). If they don't match within 5¢, retry up to 2x with backoff.
  const expectedItemsSubtotal = (() => {
    const total = cost?.grand_total ? Number(cost.grand_total) : 0;
    const ship  = cost?.shipping ? Number(cost.shipping) : 0;
    const tax   = cost?.salesTax_collected_by_bl ? Number(cost.salesTax_collected_by_bl)
                : cost?.vat_amount ? Number(cost.vat_amount) : 0;
    const ins   = cost?.insurance ? Number(cost.insurance) : 0;
    return total > 0 ? +(total - ship - tax - ins).toFixed(2) : null;
  })();

  let blOrderItems: any[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    blOrderItems = await getBrickLinkOrderItems(
      blOrder.order_id, consumerKey, consumerSecret, tokenValue, tokenSecret
    );
    if (expectedItemsSubtotal == null) break; // No header to compare against
    const fetchedSubtotal = blOrderItems.reduce((s, it) => {
      const qty = Number(it.quantity) || 0;
      const price = Number(it.unit_price) || 0;
      return s + qty * price;
    }, 0);
    const gap = Math.abs(expectedItemsSubtotal - fetchedSubtotal);
    if (gap <= 0.05) break;
    if (attempt < 3) {
      console.warn(`⚠️ Order ${orderId}: items API returned ${blOrderItems.length} item(s) summing to $${fetchedSubtotal.toFixed(2)}, expected $${expectedItemsSubtotal.toFixed(2)} (gap $${gap.toFixed(2)}). Retrying in ${attempt}s (attempt ${attempt + 1}/3)…`);
      await new Promise(r => setTimeout(r, attempt * 1000));
    } else {
      console.error(`🚨 Order ${orderId}: items API still returns mismatched subtotal after 3 attempts ($${fetchedSubtotal.toFixed(2)} vs expected $${expectedItemsSubtotal.toFixed(2)}). Proceeding with partial data — reconciliation safety net will raise a sync_issue.`);
    }
  }

  console.log(`📦 Order ${orderId}: Fetched ${blOrderItems.length} items`);

  let itemsTotalWeightGrams = 0;

  for (const item of blOrderItems) {
    try {
      const lineItemKey = `bl-${blOrder.order_id}-${item.inventory_id}`;

      const [existingItem] = await db
        .select()
        .from(orderDetails)
        .where(and(eq(orderDetails.orderId, orderId), eq(orderDetails.lineItemKey, lineItemKey)))
        .limit(1);

      if (item.weight && item.quantity) {
        itemsTotalWeightGrams += parseFloat(item.weight) * item.quantity;
      }

      // Opportunistically save the catalog weight from the order item API response
      if (item.inventory_id && item.item?.no && item.item?.type) {
        try {
          const unitWeightGrams = item.weight ? parseFloat(item.weight) : null;
          if (unitWeightGrams && unitWeightGrams > 0) {
            const wg = unitWeightGrams;
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
        } catch (invErr: any) {
          console.warn(`⚠️ Could not save catalog weight for lot ${item.inventory_id}: ${invErr.message}`);
        }
      }

      // If this lot doesn't exist locally, fetch it now so inventory adjustment
      // can deduct stock correctly (handles lots listed since the last inventory sync).
      // Wrapped in its OWN try so a transient BrickLink API error here can NEVER
      // skip the insert below — that was the root cause of order bl-31642438
      // coming in with 1 of 2 line items.
      if (item.inventory_id) {
        try {
          const [existingLot] = await db
            .select({ id: blInventory.id })
            .from(blInventory)
            .where(eq(blInventory.id, item.inventory_id))
            .limit(1);

          if (!existingLot) {
            console.log(`🔍 Lot ${item.inventory_id} (${item.item?.no}) not in local DB — fetching from BrickLink...`);
            await fetchAndCacheMissingLot(item.inventory_id, orgId);
          }
        } catch (lotErr: any) {
          console.warn(`⚠️ Lot backfill failed for ${item.inventory_id} on order ${orderId} — line item will still be inserted: ${lotErr.message}`);
        }
      }

      if (existingItem) continue; // Inventory backfill above still ran

      await db.insert(orderDetails).values([{
        orderId,
        lineItemKey,
        sku: item.inventory_id ? item.inventory_id.toString() : null,
        itemNo: item.item?.no || null,
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
      }]);
      result.orderDetailsAdded++;

    } catch (error: any) {
      console.error(`✗ Error processing order item for order ${orderId}:`, error);
      result.errors.push(`Order ${orderId} item error: ${error.message}`);
    }
  }

  // ── Reconciliation safety net ────────────────────────────────────────────
  // Verify what we actually persisted matches what BrickLink told us.
  // Catches BOTH cases:
  //   1) An item insert was silently skipped by the per-item try/catch above
  //   2) BrickLink itself returned partial data on this call
  // Either way, raise a critical sync_issue so the user sees it instead of
  // discovering it months later via a buyer complaint (as happened with
  // order bl-31642438).
  try {
    const [{ persistedCount = 0, persistedSubtotal = 0 } = {} as any] = await db
      .select({
        persistedCount: sql<number>`COUNT(*)::int`,
        persistedSubtotal: sql<number>`COALESCE(SUM(CAST(${orderDetails.unitPrice} AS DECIMAL) * ${orderDetails.quantity}), 0)`,
      })
      .from(orderDetails)
      .where(eq(orderDetails.orderId, orderId));

    const [orderRow] = await db
      .select({
        total: orders.orderTotal,
        shipping: orders.shippingAmount,
        tax: orders.taxAmount,
        insurance: orders.insuranceAmount,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    const expectedCount = blOrderItems.length;
    const actualCount = Number(persistedCount) || 0;
    const actualSubtotal = Number(persistedSubtotal) || 0;
    const orderTotal = orderRow ? parseFloat(orderRow.total as any) : 0;
    const shipping = orderRow?.shipping ? parseFloat(orderRow.shipping as any) : 0;
    const tax = orderRow?.tax ? parseFloat(orderRow.tax as any) : 0;
    const insurance = orderRow?.insurance ? parseFloat(orderRow.insurance as any) : 0;
    const expectedSubtotal = orderTotal - shipping - tax - insurance;
    const subtotalGap = Math.abs(expectedSubtotal - actualSubtotal);

    const countMismatch = actualCount !== expectedCount;
    // Only flag a money gap if it's > 5 cents AND we have a believable order_total
    const moneyMismatch = orderTotal > 0 && subtotalGap > 0.05;

    if (countMismatch || moneyMismatch) {
      const description = countMismatch
        ? `Order ${orderId}: BrickLink returned ${expectedCount} line item(s) but ${actualCount} are persisted locally. Order total $${orderTotal.toFixed(2)} vs items $${actualSubtotal.toFixed(2)} + shipping $${shipping.toFixed(2)} + tax $${tax.toFixed(2)} (gap $${subtotalGap.toFixed(2)}). Run a full sync to pull the missing line item(s).`
        : `Order ${orderId}: line item totals don't reconcile. Order total $${orderTotal.toFixed(2)} but items+shipping+tax = $${(actualSubtotal + shipping + tax + insurance).toFixed(2)} (gap $${subtotalGap.toFixed(2)}). A line item may be missing or mispriced — run a full sync.`;

      console.error(`🚨 ${description}`);
      const issueType = countMismatch ? 'line_item_missing' : 'total_mismatch';
      const metadata = JSON.stringify({
        orderNumber: blOrder.order_id,
        expectedCount, actualCount,
        orderTotal, expectedSubtotal, actualSubtotal,
        shipping, tax, insurance, subtotalGap,
      });

      // Dedupe: if there's already an open issue for this order+type, refresh
      // it instead of inserting a duplicate every nightly sync.
      const [existingIssue] = await db
        .select({ id: syncIssues.id })
        .from(syncIssues)
        .where(and(
          eq(syncIssues.platform, 'bricklink'),
          eq(syncIssues.itemId, orderId),
          eq(syncIssues.issueType, issueType),
          eq(syncIssues.status, 'open'),
          eq(syncIssues.orgId, orgId),
        ))
        .limit(1);

      if (existingIssue) {
        await db.update(syncIssues)
          .set({ issueDescription: description, metadata, severity: 'critical' })
          .where(eq(syncIssues.id, existingIssue.id));
      } else {
        await db.insert(syncIssues).values({
          syncType: 'order_sync',
          platform: 'bricklink',
          itemId: orderId,
          issueType,
          issueDescription: description,
          severity: 'critical',
          status: 'open',
          metadata,
          orgId,
        });
      }
      result.errors.push(description);
    }
  } catch (reconErr: any) {
    console.warn(`⚠️ Order ${orderId}: reconciliation check failed (non-fatal): ${reconErr.message}`);
  }

  // Write computed total weight if no weight is already saved
  if (itemsTotalWeightGrams > 0) {
    const computedWeightOz = Math.round(itemsTotalWeightGrams * 0.035274 * 100) / 100;
    const [currentOrder] = await db.select({ weight: orders.weight }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (currentOrder?.weight == null) {
      await db.update(orders)
        .set({ weight: computedWeightOz.toString(), weightUnits: 'oz' })
        .where(eq(orders.id, orderId));
      console.log(`⚖️ Order ${orderId}: weight set to ${computedWeightOz} oz (${itemsTotalWeightGrams.toFixed(1)} g from ${blOrderItems.length} line items)`);
    }
  }

  // Trigger inventory adjustment for new orders after items are inserted
  if (isNewOrder) {
    result.newOrderIds.push(orderId);
    console.log(`📦 New BrickLink order ${orderId} — triggering inventory adjustment`);
    adjustInventoryForOrder(orderId).catch(error => {
      console.error(`⚠️ Inventory adjustment failed for new order ${orderId}:`, error);
    });
  }
}

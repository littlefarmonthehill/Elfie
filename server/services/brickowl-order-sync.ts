import { db } from "../db";
import { orders, orderDetails, orderAdjustments, channelLotLinks, syncMetadata, shipments } from "@shared/schema";
import { eq, and, sql, ne } from "drizzle-orm";
import { getBrickOwlOrders, getBrickOwlOrderDetails, mapBrickOwlStatus } from "./brickowl-orders";
import { getBrickOwlApiKey } from "./brickowl";
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
  orgId: string,
  options: { limit?: number; fullSync?: boolean; sinceDate?: string } = {},
  onProgress?: (processed: number, total: number) => void
): Promise<BrickOwlOrderSyncResult> {
  const result: BrickOwlOrderSyncResult = {
    ordersAdded: 0,
    ordersUpdated: 0,
    orderDetailsAdded: 0,
    totalOrders: 0,
    errors: [],
  };

  const apiKey = await getBrickOwlApiKey(orgId);
  if (!apiKey) {
    return { ...result, errors: ['BrickOwl API key not configured. Add it in Settings → Platforms.'] };
  }

  try {
    console.log(`\n🦉 Starting BrickOwl order sync...`);

    // Determine lookback timestamp for incremental sync.
    // We use update_time (not order_time) so that merges, status changes, and item
    // additions on older orders are all caught — not just newly placed orders.
    let updateTime: number | undefined = undefined;
    let orderTime: number | undefined = undefined; // only used for explicit sinceDate fallback

    if (options.sinceDate) {
      // Explicit "from date" — filter by order placement time for date-scoped historical pulls
      orderTime = Math.floor(new Date(options.sinceDate).getTime() / 1000);
      console.log(`📅 Date-scoped sync: fetching orders placed since ${options.sinceDate}`);
    } else if (!options.fullSync) {
      const [previousSync] = await db
        .select()
        .from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, SYNC_ID)))
        .limit(1);

      if (previousSync?.lastSyncTime) {
        // Use update_time with a 30-minute lookback buffer.
        // Shorter buffer is fine here because update_time catches modifications, not just creation.
        const LOOKBACK_SECONDS = 30 * 60;
        updateTime = Math.floor(previousSync.lastSyncTime.getTime() / 1000) - LOOKBACK_SECONDS;
        const lookbackDate = new Date(updateTime * 1000);
        console.log(`📅 Incremental sync: fetching orders updated since ${lookbackDate.toISOString()} (30m lookback from last sync at ${previousSync.lastSyncTime.toISOString()})`);
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

    const boOrders = await getBrickOwlOrders(apiKey, { limit: options.limit, updateTime, orderTime });
    result.totalOrders = boOrders.length;
    console.log(`🦉 Fetched ${result.totalOrders} orders from BrickOwl`);

    let processed = 0;
    for (const boOrder of boOrders) {
      try {
        await processBrickOwlOrder(boOrder, orgId, apiKey, result, boLotToBlInvId);
      } catch (error: any) {
        console.error(`✗ Error processing BrickOwl order ${boOrder.order_id}:`, error);
        result.errors.push(`Order ${boOrder.order_id}: ${error.message}`);
      }
      processed++;
      onProgress?.(processed, boOrders.length);
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
    orgId,
    `BO.${boOrder.order_id}`,
    String(boOrder.order_id)
  );

  // Soft-purged locally (operator deleted the test order) — never re-import.
  if (existingOrder?.orderStatus === 'purged') {
    console.log(`⏭️ BrickOwl order ${orderId} is purged locally — skipping`);
    return;
  }

  const normalizedStatus = mapBrickOwlStatus(boOrder.status_id, boOrder.status ?? boOrder.status_name);
  const effectiveOrderId = existingOrder?.id ?? orderId;
  // BrickOwl status_id 0/1/7 map to 'awaiting_payment' — order exists but payment not confirmed.
  const isUnpaid = normalizedStatus === 'awaiting_payment';

  const brickOwlOrderData = await getBrickOwlOrderDetails(apiKey, boOrder.order_id);

  // Diagnostic: log all field names for orders where we expect a buyer note, so we can
  // identify the exact API field name.  Remove once confirmed.
  if (boOrder.order_id.toString() === '9061604') {
    console.log(`[BO Debug] bo-9061604 all API keys: ${Object.keys(brickOwlOrderData).join(', ')}`);
    const noteFields = Object.entries(brickOwlOrderData)
      .filter(([k]) => /note|comment|message|buyer/i.test(k));
    console.log(`[BO Debug] bo-9061604 note-like fields: ${JSON.stringify(noteFields)}`);
  }

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
      // Prefer ship_first_name + ship_last_name (actual recipient name).
      // ship_name on BrickOwl's API is the SELLER's store name, not the buyer's name.
      // Fall back to buyer_name (display name) if the split fields are missing.
      name: (
        [brickOwlOrderData.ship_first_name, brickOwlOrderData.ship_last_name]
          .filter(Boolean).join(' ').trim()
      ) || brickOwlOrderData.buyer_name || '',
      address1: brickOwlOrderData.ship_street_1 || '',
      address2: brickOwlOrderData.ship_street_2 || '',
      city: brickOwlOrderData.ship_city || '',
      // BrickOwl API has used ship_region, ship_state, and ship_province across versions.
      state: brickOwlOrderData.ship_region
          || brickOwlOrderData.ship_state
          || brickOwlOrderData.ship_province
          || '',
      postalCode: brickOwlOrderData.ship_post_code || '',
      country: brickOwlOrderData.ship_country_code || '',
    }),
    billTo: null,
    shipByDate: null,
    // BrickOwl's base_order_total IS the full order total (items + shipping already included).
    // ship_total and base_tax_amount are stored separately for the breakdown display only —
    // do NOT add them to base_order_total or shipping will be double-counted.
    ...(() => {
      const orderTotal  = Number(brickOwlOrderData.base_order_total  ?? brickOwlOrderData.total_price ?? brickOwlOrderData.order_total ?? brickOwlOrderData.sub_total ?? 0);
      const shipTotal   = Number(brickOwlOrderData.base_ship_amount   ?? brickOwlOrderData.ship_total  ?? brickOwlOrderData.ship_cost   ?? boOrder.ship_total ?? 0);
      const taxTotal    = Number(brickOwlOrderData.base_tax_amount    ?? brickOwlOrderData.tax_amount  ?? brickOwlOrderData.vat         ?? brickOwlOrderData.tax ?? 0);
      return {
        orderTotal:     orderTotal.toFixed(2),
        shippingAmount: shipTotal.toFixed(2),
        taxAmount:      taxTotal.toFixed(2),
      };
    })(),
    internalNotes: null,
    // BrickOwl API returns the buyer's order note as "order_note".
    // Legacy alias "buyer_notes" kept as fallback for any older API variations.
    customerNotes: brickOwlOrderData.order_note || brickOwlOrderData.buyer_notes || null,
    requestedShippingService: brickOwlOrderData.ship_method_name || null,
    carrierCode: null,
    serviceCode: null,
    updatedAt: new Date(),
  };

  if (!existingOrder) {
    // UPSERT instead of plain INSERT — handles race conditions from multi-device manual syncs
    // and cross-session re-inserts after server restarts.  inventoryDeducted is intentionally
    // excluded from the conflict update set so a previously-deducted order is never re-deducted.
    if (isUnpaid) {
      console.log(`💳 BrickOwl order ${orderId}: awaiting payment (status_id ${boOrder.status_id}) — setting workflowStatus='unpaid'`);
    }
    const [upserted] = await db
      .insert(orders)
      .values([{ ...orderData, orgId, workflowStatus: isUnpaid ? 'unpaid' : 'new' }])
      .onConflictDoUpdate({
        target: orders.id,
        set: {
          orderStatus:               sql`EXCLUDED.order_status`,
          previousStatus:            sql`EXCLUDED.previous_status`,
          customerUsername:          sql`EXCLUDED.customer_username`,
          customerEmail:             sql`EXCLUDED.customer_email`,
          shipTo:                    sql`EXCLUDED.ship_to`,
          billTo:                    sql`EXCLUDED.bill_to`,
          shipByDate:                sql`EXCLUDED.ship_by_date`,
          orderTotal:                sql`EXCLUDED.order_total`,
          shippingAmount:            sql`EXCLUDED.shipping_amount`,
          taxAmount:                 sql`EXCLUDED.tax_amount`,
          internalNotes:             sql`EXCLUDED.internal_notes`,
          // COALESCE: never overwrite an existing note with null — preserve it if the
          // API returns no note field (wrong field name, blank response, etc.)
          customerNotes:             sql`COALESCE(EXCLUDED.customer_notes, orders.customer_notes)`,
          requestedShippingService:  sql`EXCLUDED.requested_shipping_service`,
          carrierCode:               sql`EXCLUDED.carrier_code`,
          serviceCode:               sql`EXCLUDED.service_code`,
          updatedAt:                 sql`EXCLUDED.updated_at`,
          // inventoryDeducted: deliberately NOT included — preserves true from a prior sync session
          // orgId: deliberately NOT included — org never changes on a re-sync
        },
      })
      .returning({ id: orders.id, inventoryDeducted: orders.inventoryDeducted });

    if (!upserted?.inventoryDeducted) {
      // Fresh insert (or conflict with an un-deducted row) — treat as new, fire inventory adjustment.
      result.ordersAdded++;
      isNewOrder = true;
    } else {
      // Conflict with a row that already has inventoryDeducted=true — a prior sync session
      // (multi-device manual sync, server restart, etc.) already processed this order.
      // The atomic guard in adjustInventoryForOrder would block a duplicate anyway, but we
      // skip the fire-and-forget entirely to avoid unnecessary DB chatter.
      console.log(`⚠️ Order ${orderId}: UPSERT conflict — inventoryDeducted already true (prior sync session). Skipping re-adjustment.`);
      result.ordersUpdated++;
    }
  } else {
    // If the order is locally 'shipped' but BrickOwl is reporting a lower status,
    // check whether this order was actually shipped through the app (has a non-voided
    // shipment record). If there are NO active shipments the 'shipped' status came
    // from a BrickOwl sync promotion, not from our fulfilment flow — so we trust
    // BrickOwl to correct it and bypass the demotion guard.
    const wouldDemoteFromShipped =
      existingOrder.orderStatus === 'shipped' &&
      !['shipped', 'completed', 'cancelled'].includes(normalizedStatus);

    let allowDemotion = false;
    if (wouldDemoteFromShipped) {
      // Never demote if workflowStatus is 'shipped' — this means the order was explicitly
      // marked shipped (either via the fulfillment flow or a migration). Orders in this
      // state are authoritative: BrickOwl API latency or a momentary lower-status response
      // must never clobber them even if there are no app-created shipment records.
      if (existingOrder.workflowStatus === 'shipped') {
        console.log(`🔒 BrickOwl order ${effectiveOrderId}: demotion blocked — workflowStatus is 'shipped' (explicitly marked shipped, no active shipments check needed)`);
      } else {
        const activeShipments = await db
          .select({ id: shipments.id })
          .from(shipments)
          .where(and(eq(shipments.orderId, effectiveOrderId), ne(shipments.status, 'voided')))
          .limit(1);
        allowDemotion = activeShipments.length === 0;
        if (allowDemotion) {
          console.warn(`🔄 BrickOwl order ${effectiveOrderId}: allowing demotion shipped → ${normalizedStatus} (no active shipments — order was sync-promoted, not app-shipped)`);
        }
      }
    }

    const { status: updatedStatus, wasDemotionBlocked, isShippedCancellation } = allowDemotion
      ? { status: normalizedStatus, wasDemotionBlocked: false, isShippedCancellation: false }
      : resolveOrderStatus(existingOrder.orderStatus, normalizedStatus);

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
        // Preserve existing note if the sync returns null (wrong field name, blank API response, etc.)
        customerNotes: orderData.customerNotes ?? existingOrder.customerNotes ?? null,
        // If we're allowing a demotion from shipped (sync-promoted, no real shipment),
        // reset workflowStatus to 'new' so the order re-enters the fulfillment queue.
        ...(allowDemotion && updatedStatus !== 'shipped'
          ? { workflowStatus: 'new', shipDate: null }
          // Auto-promote: payment arrived and workflow still 'unpaid' → advance to 'new'
          : existingOrder.workflowStatus === 'unpaid' && !isUnpaid
          ? { workflowStatus: 'new' }
          // Auto-demote: still unpaid and workflow is at default 'new' → flag as 'unpaid'
          : existingOrder.workflowStatus === 'new' && isUnpaid
          ? { workflowStatus: 'unpaid' }
          : {}),
      })
      .where(eq(orders.id, effectiveOrderId));

    if (existingOrder.workflowStatus === 'unpaid' && !isUnpaid) {
      console.log(`💳 BrickOwl order ${effectiveOrderId}: payment confirmed — auto-promoting workflowStatus 'unpaid' → 'new'`);
    } else if (existingOrder.workflowStatus === 'new' && isUnpaid) {
      console.log(`💳 BrickOwl order ${effectiveOrderId}: payment not received — auto-setting workflowStatus 'new' → 'unpaid'`);
    }

    result.ordersUpdated++;

    if (existingOrder.orderStatus !== updatedStatus) {
      console.log(`📦 BrickOwl order ${effectiveOrderId} status changed: ${existingOrder.orderStatus} → ${updatedStatus}`);
      if (updatedStatus === 'shipped' && existingOrder.orderStatus !== 'shipped') {
        console.warn(`⚠️ [BrickOwl sync] Order ${effectiveOrderId} promoted to SHIPPED by BrickOwl API (was: ${existingOrder.orderStatus}, BrickOwl status_id: ${boOrder.status_id}). This was NOT shipped through E.L.F.I.E. — verify on BrickOwl's website.`);
      }

      if (isShippedCancellation) {
        // Seller cancelled a shipped order on BrickOwl's side — treat this the same way
        // BrickLink handles returns: restore local inventory but skip cross-platform sync.
        // The scheduled channel sync will propagate the restored quantities on its own cycle.
        console.log(`↩️ BrickOwl order ${effectiveOrderId} cancelled after shipping — restoring local inventory (no cross-platform push)`);

        // Record a refund adjustment (idempotent — keyed on the external transaction ID).
        // BrickOwl overwrites the order total on cancel, so we use whatever amount their
        // API last returned as the refund figure, same as the BrickLink return flow does.
        const externalId = `bo-${boOrder.order_id}-cancel`;
        const refundAmount = Number(orderData.orderTotal);
        if (refundAmount > 0) {
          const [existingAdj] = await db
            .select({ id: orderAdjustments.id })
            .from(orderAdjustments)
            .where(eq(orderAdjustments.externalTransactionId, externalId))
            .limit(1);
          if (!existingAdj) {
            await db.insert(orderAdjustments).values({
              orderId: effectiveOrderId,
              orgId,
              type: 'refund',
              amount: (-refundAmount).toFixed(2),
              paymentMethod: 'brickowl',
              externalTransactionId: externalId,
              reason: 'Customer cancellation after shipment',
              notes: `BrickOwl order ${boOrder.order_id} cancelled after shipping — refund of $${refundAmount.toFixed(2)}`,
            });
            console.log(`↩️ BrickOwl order ${effectiveOrderId}: recorded refund adjustment of -$${refundAmount.toFixed(2)}`);
          }
        } else {
          console.warn(`⚠️ BrickOwl order ${effectiveOrderId}: cancelled after shipping but order total is missing or zero — refund adjustment NOT recorded`);
        }

        adjustInventoryForOrder(effectiveOrderId, 'bo-shipped-cancel', { skipCrossPlatformSync: true }).catch(error => {
          console.error(`⚠️ Inventory restore failed for cancelled BrickOwl order ${effectiveOrderId}:`, error);
        });
      } else {
        console.log(`🔄 BrickOwl order ${effectiveOrderId} status changed (${existingOrder.orderStatus} → ${updatedStatus}) — triggering inventory adjustment`);
        adjustInventoryForOrder(effectiveOrderId, 'bo-status-change').catch(error => {
          console.error(`⚠️ Inventory adjustment failed for BrickOwl order ${effectiveOrderId}:`, error);
        });
      }
    }

    // Detect partial refund: BrickOwl keeps the order status unchanged (e.g. still "shipped")
    // but lowers base_order_total — showing the original amount in parentheses in their UI.
    // We detect this as a total decrease and record an idempotent refund adjustment.
    // The idempotency key encodes the new total so repeat syncs don't double-record it,
    // but a second partial refund (different resulting total) will still be captured.
    if (!wasDemotionBlocked && existingOrder.orderStatus === updatedStatus) {
      const oldTotal = Number(existingOrder.orderTotal ?? 0);
      const newTotal = Number(orderData.orderTotal ?? 0);
      const refundDelta = oldTotal - newTotal;

      // Guard: if the delta is within a few cents of the stored shipping amount, this is
      // almost certainly a correction of a previously double-counted ship_total (legacy data
      // from before the order-total fix), not a genuine partial refund.  Skip recording an
      // adjustment — the order update below will silently correct the stored total.
      const storedShipping = Number(existingOrder.shippingAmount ?? 0);
      const looksLikeShippingCorrection = storedShipping > 0 && Math.abs(refundDelta - storedShipping) < 0.02;

      if (looksLikeShippingCorrection) {
        console.log(`⚠️ Order ${effectiveOrderId}: total decrease of $${refundDelta.toFixed(2)} matches stored shipping $${storedShipping.toFixed(2)} — skipping partial refund (legacy double-count correction)`);
      }

      if (refundDelta > 0.009 && !looksLikeShippingCorrection) {
        const externalId = `bo-${boOrder.order_id}-partial-${Math.round(newTotal * 100)}`;
        const [existingAdj] = await db
          .select({ id: orderAdjustments.id })
          .from(orderAdjustments)
          .where(eq(orderAdjustments.externalTransactionId, externalId))
          .limit(1);

        if (!existingAdj) {
          await db.insert(orderAdjustments).values({
            orderId: effectiveOrderId,
            orgId,
            type: 'refund',
            amount: (-refundDelta).toFixed(2),
            paymentMethod: 'brickowl',
            externalTransactionId: externalId,
            reason: 'Partial refund',
            notes: `BrickOwl order ${boOrder.order_id} partial refund — order total changed from $${oldTotal.toFixed(2)} to $${newTotal.toFixed(2)}`,
          });
          console.log(`💳 BrickOwl order ${effectiveOrderId}: recorded partial refund of -$${refundDelta.toFixed(2)} ($${oldTotal.toFixed(2)} → $${newTotal.toFixed(2)})`);
        }
      }
    }
  }

  // Process order line items.
  // We do a full upsert pass on every sync so that merges (where BrickOwl adds items
  // or increases quantities on an existing order) are reflected immediately.
  const items = brickOwlOrderData.items || [];
  console.log(`🦉 Order ${effectiveOrderId}: Processing ${items.length} items`);

  let itemsChanged = false;

  // Collect incremental items produced by a merge:
  // — for quantity increases on existing items: the delta quantity
  // — for genuinely new items: the full quantity
  const deltaItems: Array<{
    item: any;
    brickLinkInvId: number | null;
    deltaQty: number;
  }> = [];

  for (const item of items) {
    try {
      const lineItemKey = `${boOrder.order_id}-${item.lot_id}`;

      const [existingItem] = await db
        .select()
        .from(orderDetails)
        .where(and(eq(orderDetails.orderId, effectiveOrderId), eq(orderDetails.lineItemKey, lineItemKey)))
        .limit(1);

      if (existingItem) {
        // Item already recorded — check if quantity changed (happens when BrickOwl merges orders)
        // Parse ordered_quantity to integer: the BO API returns it as a string (e.g. "11"),
        // while existingItem.quantity is a number from the DB. Without the parse, strict
        // inequality (11 !== "11") evaluates to true for EVERY re-sync, stampeding
        // merge_detected_at and re-triggering adjustInventoryForOrder unnecessarily.
        const newQty = item.ordered_quantity != null
          ? parseInt(String(item.ordered_quantity), 10)
          : existingItem.quantity;
        if (existingItem.quantity !== newQty) {
          const deltaQty = newQty - existingItem.quantity;
          // Update the existing item to the new total so future syncs don't re-detect this change.
          await db
            .update(orderDetails)
            .set({ quantity: newQty })
            .where(eq(orderDetails.id, existingItem.id));
          if (deltaQty > 0) {
            // Only positive deltas represent items added by the merge.
            // Carry the BL inventory ID forward from the existing DB record.
            deltaItems.push({ item, brickLinkInvId: existingItem.bricklinkInventoryId ?? null, deltaQty });
          }
          itemsChanged = true;
          console.log(`🔀 Order ${effectiveOrderId}: lot ${item.lot_id} qty updated ${existingItem.quantity} → ${newQty} (merge detected, delta: ${deltaQty})`);
        }
        continue;
      }

      // New line item — resolve BL inventory ID from the lot map or the item's own field.
      let brickLinkInvId: number | null = null;
      const fromMap = boLotToBlInvId.get(String(item.lot_id));
      if (fromMap) {
        brickLinkInvId = fromMap;
      } else if (item.external_lot_ids?.other) {
        const parsed = parseInt(item.external_lot_ids.other, 10);
        if (!isNaN(parsed)) brickLinkInvId = parsed;
      }

      // Guard: if a row for this BL inventory ID already exists in the order (under a
      // different lot_id), BrickOwl re-listed the lot rather than genuinely adding a new one.
      // Update the existing row's lot keys in place so the lineItemKey stays current,
      // but do NOT count this as a merge-worthy change or insert a duplicate row.
      if (brickLinkInvId) {
        const [existingByInvId] = await db
          .select()
          .from(orderDetails)
          .where(and(
            eq(orderDetails.orderId, effectiveOrderId),
            eq(orderDetails.bricklinkInventoryId, brickLinkInvId)
          ))
          .limit(1);

        if (existingByInvId) {
          // Same BL inventory item already exists with a different lot_id.
          // This is a lot_id rotation on BrickOwl's side, not a customer-requested merge.
          // Refresh the key columns so future lookups hit the new lot_id.
          await db
            .update(orderDetails)
            .set({
              lineItemKey,
              boLotId: item.lot_id != null ? String(item.lot_id) : null,
            })
            .where(eq(orderDetails.id, existingByInvId.id));
          console.log(`🔄 Order ${effectiveOrderId}: lot ${item.lot_id} replaced lot_id for BL inv ${brickLinkInvId} — lot_id rotation, not a merge`);
          continue; // Do NOT set itemsChanged — this is not a real merge
        }
      }

      // Genuinely new item — insert it into the existing order so future syncs don't
      // re-detect it, and record it as a delta item for the new merge order.
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
      deltaItems.push({ item, brickLinkInvId, deltaQty: parseInt(String(item.ordered_quantity ?? 1), 10) });
      itemsChanged = true;
      console.log(`➕ Order ${effectiveOrderId}: new item lot ${item.lot_id} added (genuine merge or late addition)`);

    } catch (error: any) {
      console.error(`✗ Error processing order item for order ${orderId}:`, error);
      result.errors.push(`Order ${orderId} item error: ${error.message}`);
    }
  }

  if (isNewOrder) {
    console.log(`📦 New BrickOwl order ${effectiveOrderId} — triggering inventory adjustment`);
    adjustInventoryForOrder(effectiveOrderId, 'bo-new-order').catch(error => {
      console.error(`⚠️ Inventory adjustment failed for new BrickOwl order ${effectiveOrderId}:`, error);
    });
  } else if (itemsChanged && deltaItems.length > 0) {
    // Items were added or quantities increased on an existing order — genuine BrickOwl merge.
    // Create a new "delta" order that contains only the additional items so the operator
    // can process it like any regular order.  Both the original and the delta order are
    // linked via mergeGroupId so the UI can display the "+" indicator on each.
    console.log(`🔀 Order ${effectiveOrderId}: merge detected (isNewOrder=${isNewOrder}, deltaItems=${deltaItems.length}) — creating delta order`);
    try {
    const mergeGroupId = effectiveOrderId;
    const deltaOrderId = `${effectiveOrderId}-m${Date.now()}`;
    const deltaOrderNumber = `${boOrder.order_id}-M`;

    console.log(`🔀 Order ${effectiveOrderId}: inserting delta order ${deltaOrderId}`);

    await db.insert(orders).values([{
      id: deltaOrderId,
      orderNumber: deltaOrderNumber,
      orderKey: `BO.${deltaOrderNumber}`,
      marketplace: 'BrickOwl',
      orderDate: orderData.orderDate,
      orderStatus: orderData.orderStatus,
      previousStatus: null,
      customerUsername: orderData.customerUsername,
      customerEmail: orderData.customerEmail,
      shipTo: orderData.shipTo,
      billTo: null,
      shipByDate: null,
      orderTotal: '0',
      shippingAmount: '0',
      taxAmount: '0',
      internalNotes: null,
      customerNotes: orderData.customerNotes,
      requestedShippingService: orderData.requestedShippingService,
      carrierCode: null,
      serviceCode: null,
      orgId,
      workflowStatus: 'new',
      mergeGroupId,
    }]);

    // Tag the original order with the same mergeGroupId so both show the "+" indicator.
    await db
      .update(orders)
      .set({ mergeGroupId })
      .where(eq(orders.id, effectiveOrderId));

    // Insert the delta line items into the new order.
    for (const { item, brickLinkInvId, deltaQty } of deltaItems) {
      const lineItemKey = `${deltaOrderId}-${item.lot_id}`;
      try {
        await db.insert(orderDetails).values([{
          orderId: deltaOrderId,
          lineItemKey,
          sku: brickLinkInvId ? String(brickLinkInvId) : null,
          name: item.name || '',
          quantity: deltaQty,
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
      } catch (err: any) {
        console.error(`✗ Error inserting delta item for merge order ${deltaOrderId}:`, err);
        result.errors.push(`Merge order ${deltaOrderId} item error: ${err.message}`);
      }
    }

    result.ordersAdded++;

    // Trigger inventory adjustment for the new delta order.
    adjustInventoryForOrder(deltaOrderId, 'bo-merge-delta').catch(error => {
      console.error(`⚠️ Inventory adjustment failed for delta merge order ${deltaOrderId}:`, error);
    });
    } catch (mergeErr: any) {
      console.error(`✗ Order ${effectiveOrderId}: merge delta creation failed:`, mergeErr.message, mergeErr.stack);
      result.errors.push(`Order ${effectiveOrderId} merge delta error: ${mergeErr.message}`);
    }
  }
}

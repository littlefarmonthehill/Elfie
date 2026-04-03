/**
 * eBay Sell Fulfillment API order sync.
 *
 * Implements the IChannelOrderSync interface so it plugs directly into
 * the shared order-sync-core pipeline (scheduling, retry, inventory adjustment,
 * cross-platform push, SSE broadcast, embeddings).
 *
 * eBay-specific behaviour:
 *   - Credentials stored in org_integrations (not app_settings)
 *   - SKUs are in "BL-{blInventoryId}" format — parsed to link inventory
 *   - Incremental sync using eBay's lastmodifieddate filter
 *   - Status mapping: orderFulfillmentStatus + cancelState → internal statuses
 */

import { db } from "../db";
import { orders, orderDetails, orgIntegrations, syncMetadata, platformSettings } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { adjustInventoryForOrder } from "./inventory-adjustment";
import { upsertSyncMetadata, resolveExistingOrder, resolveOrderStatus } from "./order-sync-helpers";
import type { ChannelOrderSyncOptions, OrderSyncProgressCallback, ChannelOrderSyncResult } from "./channel-order-sync-interface";

const SYNC_ID = 'ebay_orders';
const MARKETPLACE = 'eBay';

// ── Scopes needed for order fulfillment read access ───────────────────────────
const FULFILLMENT_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
].join(' ');

// ── Status mapping ────────────────────────────────────────────────────────────

function mapEbayStatus(fulfillmentStatus: string, cancelState: string): string {
  if (cancelState === 'CANCELED') return 'cancelled';
  if (cancelState === 'CANCEL_REQUESTED') return 'pending';
  switch (fulfillmentStatus) {
    case 'FULFILLED':    return 'completed';
    case 'IN_PROGRESS':  return 'paid';
    case 'NOT_STARTED':  return 'paid';
    default:             return 'pending';
  }
}

// ── OAuth token (loads creds from org_integrations) ───────────────────────────

interface EbayCreds {
  appId: string;
  certId: string;
  refreshToken: string;
  environment: 'production' | 'sandbox';
}

async function loadEbayCreds(orgId: string): Promise<EbayCreds | null> {
  const [[row], [ps]] = await Promise.all([
    db.select().from(orgIntegrations)
      .where(and(eq(orgIntegrations.orgId, orgId), eq(orgIntegrations.channel, 'ebay')))
      .limit(1),
    db.select().from(platformSettings).limit(1),
  ]);

  const creds = row?.credentials as Record<string, string> | undefined;
  if (!creds?.refreshToken) return null;

  const env = (creds.environment as 'production' | 'sandbox') ?? 'production';
  const appId  = creds.appId  ?? (env === 'sandbox' ? ps?.ebaySandboxAppId  : ps?.ebayProdAppId)  ?? '';
  const certId = creds.certId ?? (env === 'sandbox' ? ps?.ebaySandboxCertId : ps?.ebayProdCertId) ?? '';

  if (!appId || !certId) return null;

  return { appId, certId, refreshToken: creds.refreshToken, environment: env };
}

async function getEbayAccessToken(creds: EbayCreds): Promise<string> {
  const baseUrl = creds.environment === 'sandbox'
    ? 'https://api.sandbox.ebay.com'
    : 'https://api.ebay.com';

  const basicAuth = Buffer.from(`${creds.appId}:${creds.certId}`).toString('base64');

  const resp = await fetch(`${baseUrl}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: creds.refreshToken,
      scope:         FULFILLMENT_SCOPES,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`[eBay Order Sync] Token refresh failed: ${resp.status} ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  if (!data.access_token) throw new Error('[eBay Order Sync] Token response missing access_token');
  return data.access_token;
}

// ── Fetch orders from Sell Fulfillment API (paginated) ────────────────────────

async function fetchEbayOrders(
  accessToken: string,
  baseUrl: string,
  sinceIso?: string,
  limit?: number,
): Promise<any[]> {
  const pageSize = Math.min(limit ?? 200, 200);
  const all: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      limit:  String(pageSize),
      offset: String(offset),
    });

    if (sinceIso) {
      // eBay date-range filter format: lastmodifieddate:[{ISO}..]
      params.set('filter', `lastmodifieddate:[{${sinceIso}}..]`);
    }

    const resp = await fetch(`${baseUrl}/sell/fulfillment/v1/order?${params}`, {
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`[eBay Fulfillment API] ${resp.status}: ${body.slice(0, 300)}`);
    }

    const data = await resp.json();
    const page: any[] = data.orders ?? [];
    all.push(...page);
    offset += page.length;

    const total = data.total ?? 0;
    if (page.length === 0 || offset >= total || (limit && all.length >= limit)) {
      hasMore = false;
    }
  }

  return limit ? all.slice(0, limit) : all;
}

// ── Parse BL-{id} SKU ─────────────────────────────────────────────────────────

function parseSkuToBlInvId(sku: string | null | undefined): number | null {
  const match = (sku ?? '').match(/^BL-(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

// ── Process a single eBay order ───────────────────────────────────────────────

async function processEbayOrder(
  ebayOrder: any,
  orgId: string,
  result: { ordersAdded: number; ordersUpdated: number; errors: string[] },
): Promise<void> {
  const rawId = ebayOrder.orderId ?? ebayOrder.legacyOrderId;
  if (!rawId) return;

  const orderId           = `eb-${rawId}`;
  const fulfillmentStatus = String(ebayOrder.orderFulfillmentStatus ?? 'NOT_STARTED');
  const cancelState       = String(ebayOrder.cancelStatus?.cancelState ?? 'NONE_REQUESTED');
  const normalizedStatus  = mapEbayStatus(fulfillmentStatus, cancelState);

  const existingOrder = await resolveExistingOrder(orderId, orgId, rawId);
  if (existingOrder?.orderStatus === 'purged') {
    console.log(`⏭️ eBay order ${orderId} is purged locally — skipping`);
    return;
  }

  // ── Parse shipping address ─────────────────────────────────────────────────
  const shipInstr = ebayOrder.fulfillmentStartInstructions?.[0];
  const shipToApi = shipInstr?.shippingStep?.shipTo;
  const addr      = shipToApi?.contactAddress ?? {};
  const shipTo    = JSON.stringify({
    name:       shipToApi?.fullName ?? ebayOrder.buyer?.buyerRegistrationAddress?.fullName ?? '',
    address1:   addr.addressLine1 ?? '',
    address2:   addr.addressLine2 ?? '',
    city:       addr.city ?? '',
    state:      addr.stateOrProvince ?? '',
    postalCode: addr.postalCode ?? '',
    country:    addr.countryCode ?? '',
  });

  // ── Parse totals ───────────────────────────────────────────────────────────
  const ps          = ebayOrder.pricingSummary ?? {};
  const orderTotal  = Number(ps.total?.value ?? 0);
  const shipAmount  = Number(ps.deliveryCost?.value ?? 0);
  const taxAmount   = Number(ps.tax?.value ?? ps.totalTaxAmount?.value ?? 0);
  const orderDate   = ebayOrder.creationDate ? new Date(ebayOrder.creationDate) : new Date();

  const orderData = {
    id:                       orderId,
    orderNumber:              rawId,
    orderKey:                 `eBay.${rawId}`,
    marketplace:              MARKETPLACE,
    orderDate,
    orderStatus:              normalizedStatus,
    previousStatus:           existingOrder?.orderStatus ?? null,
    customerUsername:         ebayOrder.buyer?.username ?? null,
    customerEmail:            null,
    shipTo,
    billTo:                   null,
    shipByDate:               null,
    orderTotal:               orderTotal.toFixed(2),
    shippingAmount:           shipAmount.toFixed(2),
    taxAmount:                taxAmount.toFixed(2),
    internalNotes:            null,
    customerNotes:            ebayOrder.buyerCheckoutNotes ?? null,
    requestedShippingService: ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shippingServiceCode ?? null,
    carrierCode:              null,
    serviceCode:              null,
    updatedAt:                new Date(),
  };

  let isNewOrder = false;

  if (!existingOrder) {
    // Idempotent upsert — inventoryDeducted excluded from conflict update
    const [upserted] = await db
      .insert(orders)
      .values([{ ...orderData, orgId }])
      .onConflictDoUpdate({
        target: orders.id,
        set: {
          orderStatus:              sql`EXCLUDED.order_status`,
          previousStatus:           sql`EXCLUDED.previous_status`,
          customerUsername:         sql`EXCLUDED.customer_username`,
          shipTo:                   sql`EXCLUDED.ship_to`,
          shipByDate:               sql`EXCLUDED.ship_by_date`,
          orderTotal:               sql`EXCLUDED.order_total`,
          shippingAmount:           sql`EXCLUDED.shipping_amount`,
          taxAmount:                sql`EXCLUDED.tax_amount`,
          customerNotes:            sql`COALESCE(EXCLUDED.customer_notes, orders.customer_notes)`,
          requestedShippingService: sql`EXCLUDED.requested_shipping_service`,
          updatedAt:                sql`EXCLUDED.updated_at`,
          // inventoryDeducted: deliberately NOT included
        },
      })
      .returning({ id: orders.id, inventoryDeducted: orders.inventoryDeducted });

    if (!upserted?.inventoryDeducted) {
      result.ordersAdded++;
      isNewOrder = true;
    } else {
      console.log(`⚠️ eBay order ${orderId}: already deducted in a prior sync — skipping re-adjustment`);
      result.ordersUpdated++;
    }
  } else {
    // Order already exists — update status and check for changes
    const { status: updatedStatus } = resolveOrderStatus(existingOrder.orderStatus, normalizedStatus);

    await db
      .update(orders)
      .set({
        ...orderData,
        id:             existingOrder.id,
        orderStatus:    updatedStatus,
        previousStatus: existingOrder.orderStatus,
        customerNotes:  orderData.customerNotes ?? existingOrder.customerNotes ?? null,
      })
      .where(eq(orders.id, existingOrder.id));

    result.ordersUpdated++;

    if (existingOrder.orderStatus !== updatedStatus) {
      console.log(`📦 eBay order ${existingOrder.id}: ${existingOrder.orderStatus} → ${updatedStatus}`);
      adjustInventoryForOrder(existingOrder.id, 'ebay-status-change').catch(err =>
        console.error(`⚠️ Inventory adjustment failed for eBay order ${existingOrder.id}:`, err)
      );
    }
  }

  // ── Upsert line items ──────────────────────────────────────────────────────
  // lineItemKey is not a unique DB constraint — use check-then-insert pattern.
  const lineItems: any[] = ebayOrder.lineItems ?? [];
  for (const li of lineItems) {
    const blInvId   = parseSkuToBlInvId(li.sku);
    const sku       = li.sku ?? li.lineItemId ?? 'unknown';
    const qty       = Number(li.quantity ?? 1);
    const lineTotal = Number(li.total?.value ?? li.lineItemCost?.value ?? 0);
    const detailKey = `${orderId}-${li.lineItemId ?? sku}`;
    const itemName  = li.title ?? sku; // name column is NOT NULL

    const [existing] = await db
      .select({ id: orderDetails.id, quantity: orderDetails.quantity })
      .from(orderDetails)
      .where(and(eq(orderDetails.orderId, orderId), eq(orderDetails.lineItemKey, detailKey)))
      .limit(1);

    if (existing) {
      if (existing.quantity !== qty) {
        await db
          .update(orderDetails)
          .set({ quantity: qty, updatedAt: new Date() })
          .where(eq(orderDetails.id, existing.id));
      }
    } else {
      await db.insert(orderDetails).values({
        orderId,
        lineItemKey:          detailKey,
        sku,
        name:                 itemName,
        bricklinkInventoryId: blInvId,
        quantity:             qty,
        unitPrice:            qty > 0 ? (lineTotal / qty).toFixed(4) : '0.0000',
        itemNo:               blInvId ? `BL-${blInvId}` : null,
        condition:            null,
        colorId:              null,
      });
    }
  }

  // ── Trigger inventory adjustment for new orders ────────────────────────────
  // adjustInventoryForOrder is atomic-locked internally — safe to fire here.
  // It deducts local BL stock and triggers cross-platform sync to all other channels.
  if (isNewOrder) {
    adjustInventoryForOrder(orderId, 'ebay-new-order').catch(err =>
      console.error(`⚠️ Inventory adjustment failed for new eBay order ${orderId}:`, err)
    );
  }
}

// ── Main export: syncEbayOrders ───────────────────────────────────────────────

export async function syncEbayOrders(
  orgId: string,
  options: ChannelOrderSyncOptions = {},
  onProgress?: OrderSyncProgressCallback,
): Promise<ChannelOrderSyncResult> {
  const result = { ordersAdded: 0, ordersUpdated: 0, errors: [] as string[] };

  // ── Load & validate credentials ───────────────────────────────────────────
  const creds = await loadEbayCreds(orgId);
  if (!creds) {
    console.log(`⏭️ eBay order sync skipped for org ${orgId} — no credentials configured`);
    return result;
  }

  const baseUrl = creds.environment === 'sandbox'
    ? 'https://api.sandbox.ebay.com'
    : 'https://api.ebay.com';

  console.log(`\n🛒 Starting eBay order sync for org ${orgId} [${creds.environment}]...`);

  // ── Obtain access token ───────────────────────────────────────────────────
  let accessToken: string;
  try {
    accessToken = await getEbayAccessToken(creds);
  } catch (err: any) {
    await upsertSyncMetadata(SYNC_ID, orgId, { status: 'error', errorMessage: err.message });
    throw err;
  }

  // ── Determine sync window ─────────────────────────────────────────────────
  let sinceIso: string | undefined;

  if (options.sinceDate) {
    sinceIso = new Date(options.sinceDate).toISOString();
    console.log(`📅 eBay date-scoped sync since ${sinceIso}`);
  } else if (!options.fullSync) {
    const [meta] = await db
      .select()
      .from(syncMetadata)
      .where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, SYNC_ID)))
      .limit(1);

    if (meta?.lastSyncTime) {
      // 30-minute lookback buffer — same pattern as BrickOwl
      const lookback = new Date(meta.lastSyncTime.getTime() - 30 * 60 * 1000);
      sinceIso = lookback.toISOString();
      console.log(`📅 eBay incremental sync since ${sinceIso}`);
    } else {
      console.log(`🔄 eBay first sync — fetching all orders`);
    }
  } else {
    console.log(`🔄 eBay full sync requested`);
  }

  // ── Fetch & process orders ────────────────────────────────────────────────
  try {
    const ebayOrders = await fetchEbayOrders(accessToken, baseUrl, sinceIso, options.limit);
    console.log(`🛒 Fetched ${ebayOrders.length} orders from eBay`);

    let processed = 0;
    for (const order of ebayOrders) {
      try {
        await processEbayOrder(order, orgId, result);
      } catch (err: any) {
        console.error(`✗ eBay order ${order.orderId} failed:`, err.message);
        result.errors.push(`Order ${order.orderId}: ${err.message}`);
      }
      processed++;
      onProgress?.(processed, ebayOrders.length);
    }
  } catch (err: any) {
    await upsertSyncMetadata(SYNC_ID, orgId, { status: 'error', errorMessage: err.message });
    throw err;
  }

  await upsertSyncMetadata(SYNC_ID, orgId, {
    status: result.errors.length > 0 && result.ordersAdded === 0 ? 'partial' : 'success',
    recordsAdded:   result.ordersAdded,
    recordsUpdated: result.ordersUpdated,
  });

  console.log(`✓ eBay order sync complete: +${result.ordersAdded} new, ${result.ordersUpdated} updated, ${result.errors.length} errors`);
  return result;
}

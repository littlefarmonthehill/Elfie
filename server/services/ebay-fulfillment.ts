/**
 * Push shipping/tracking to eBay when an order is marked shipped.
 *
 * Called from order-shipping.ts after a label is purchased or an order is
 * manually marked as shipped, for any order with marketplace='eBay'.
 *
 * Mirrors the pattern of syncToBrickLink / syncToBrickOwl — non-fatal, dev-
 * mode suppressed, credentials loaded from org_integrations (not app_settings).
 */

import { db } from "../db";
import { orderDetails, orgIntegrations } from "@shared/schema";
import { eq, and } from "drizzle-orm";

// ── Carrier code mapping ──────────────────────────────────────────────────────
// EasyPost carrier names → eBay ShippingCarrierCode enum values.
// https://developer.ebay.com/devzone/xml/docs/reference/ebay/types/ShippingCarrierCodeType.html
//
// eBay rejects unknown carrier codes, so we pass through unrecognised values
// as-is and let their API return an error rather than silently sending a wrong one.

const CARRIER_MAP: Record<string, string> = {
  USPS:           'USPS',
  UPS:            'UPS',
  FEDEX:          'FedEx',
  DHL:            'DHLExpressUS',
  'DHL EXPRESS':  'DHLExpressUS',
  ONTRAC:         'OnTrac',
  LSO:            'LSO',
  STAMPS:         'USPS',   // Stamps.com dispatches via USPS
  'CANADA POST':  'CanadaPost',
  AUSPOST:        'AustraliaPost',
};

function mapCarrierCode(easypostCarrier: string): string | null {
  const key = (easypostCarrier ?? '').toUpperCase().trim();
  if (!key) return null;
  return CARRIER_MAP[key] ?? easypostCarrier;
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

interface EbayCreds {
  appId:        string;
  certId:       string;
  refreshToken: string;
  environment:  'production' | 'sandbox';
}

async function loadEbayCreds(orgId: string): Promise<EbayCreds | null> {
  const [row] = await db
    .select()
    .from(orgIntegrations)
    .where(and(eq(orgIntegrations.orgId, orgId), eq(orgIntegrations.channel, 'ebay')))
    .limit(1);

  const creds = row?.credentials as Record<string, string> | undefined;
  if (!creds?.appId || !creds?.certId || !creds?.refreshToken) return null;

  return {
    appId:        creds.appId,
    certId:       creds.certId,
    refreshToken: creds.refreshToken,
    environment:  (creds.environment as 'production' | 'sandbox') ?? 'production',
  };
}

const FULFILLMENT_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
].join(' ');

async function getAccessToken(creds: EbayCreds, baseUrl: string): Promise<string> {
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
    throw new Error(`[eBay Fulfillment] Token refresh failed: ${resp.status} ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  if (!data.access_token) throw new Error('[eBay Fulfillment] Token response missing access_token');
  return data.access_token;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Push a shippingFulfillment record to eBay for a completed order.
 *
 * Calls POST /sell/fulfillment/v1/order/{ebayOrderId}/shippingFulfillment
 * with all line items on the order, the current timestamp as the ship date,
 * and the carrier/tracking supplied by the caller.
 *
 * This triggers eBay's buyer notification (tracking email) and updates the
 * seller's on-time shipment rate metrics.
 *
 * Callers are responsible for non-fatal error handling — this function throws
 * on any API or auth failure so the caller can log it without blocking the
 * local shipment flow.
 *
 * Suppressed entirely in NODE_ENV=development (same guard as BL/BO sync).
 */
export async function syncToEbay(
  order: any,
  trackingNumber: string,
  carrier: string = '',
): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[DEV] syncToEbay suppressed for order ${order.orderNumber}` +
      ` — would push tracking "${trackingNumber}" carrier "${carrier || '(none)'}" to eBay`
    );
    return;
  }

  const creds = await loadEbayCreds(order.orgId);
  if (!creds) {
    console.log(
      `⚠️ [eBay Fulfillment] No eBay credentials for org ${order.orgId}` +
      ` — skipping tracking push for order ${order.orderNumber}`
    );
    return;
  }

  const baseUrl = creds.environment === 'sandbox'
    ? 'https://api.sandbox.ebay.com'
    : 'https://api.ebay.com';

  const accessToken = await getAccessToken(creds, baseUrl);

  // ── Resolve line items ─────────────────────────────────────────────────────
  // lineItemKey stored format: "ebay-{ebayOrderId}-{lineItemId}"
  // Strip the local order ID prefix to recover the raw eBay lineItemId.
  //
  // order.id       = "ebay-18-12345-67890"  (local PK)
  // order.orderNumber = "18-12345-67890"    (raw eBay order ID)

  const localOrderId = order.id as string;
  const ebayOrderId  = order.orderNumber as string;
  const keyPrefix    = `${localOrderId}-`;

  const details = await db
    .select({ lineItemKey: orderDetails.lineItemKey, quantity: orderDetails.quantity })
    .from(orderDetails)
    .where(eq(orderDetails.orderId, localOrderId));

  const ebayLineItems = details
    .filter(d => d.lineItemKey?.startsWith(keyPrefix))
    .map(d => ({
      lineItemId: d.lineItemKey!.slice(keyPrefix.length),
      quantity:   d.quantity,
    }))
    .filter(li => !!li.lineItemId);

  if (ebayLineItems.length === 0) {
    console.warn(
      `⚠️ [eBay Fulfillment] No line items found for order ${ebayOrderId}` +
      ` — fulfillment will be submitted without line item details`
    );
  }

  // ── POST /shippingFulfillment ──────────────────────────────────────────────
  const carrierCode = mapCarrierCode(carrier);

  const payload: Record<string, any> = {
    shippedDate: new Date().toISOString(),
  };

  if (carrierCode) {
    payload.shippingCarrierCode = carrierCode;
  }

  if (trackingNumber) {
    payload.trackingNumber = trackingNumber;
  }

  if (ebayLineItems.length > 0) {
    payload.lineItems = ebayLineItems;
  }

  const resp = await fetch(
    `${baseUrl}/sell/fulfillment/v1/order/${encodeURIComponent(ebayOrderId)}/shippingFulfillment`,
    {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body:   JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    }
  );

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(
      `[eBay Fulfillment] shippingFulfillment failed for order ${ebayOrderId}:` +
      ` ${resp.status} ${errBody.slice(0, 300)}`
    );
  }

  console.log(
    `✅ [eBay Fulfillment] Tracking pushed for eBay order ${ebayOrderId}` +
    ` — ${carrierCode ?? '(carrier unknown)'} ${trackingNumber || '(no tracking)'}`
  );
}

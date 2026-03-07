/**
 * PayPal Capture-Based Refund Detection
 *
 * Two complementary approaches — use whichever fires first:
 *
 * 1. WEBHOOK (real-time): POST /api/webhooks/paypal
 *    PayPal sends PAYMENT.CAPTURE.REFUNDED when a refund is issued.
 *    Matched by: capture_id → order_id → amount fallback.
 *
 * 2. POLLING (catch-up): syncPayPalRefundsByCapture()
 *    Queries GET /v2/payments/captures/{capture_id} for every order that has
 *    a stored capture_id but no PayPal refund adjustment yet.
 *    Status PARTIALLY_REFUNDED or REFUNDED → follows HATEOAS links to get
 *    the refund ID and amount, then records the adjustment.
 *
 * Capture ID source:
 *   The T0006 transaction_id in the Transaction Search API IS the capture_id
 *   in the Payments API v2.  The fee sync stores it on orders.paypalCaptureId.
 */

import { db } from '../db';
import { orders, orderAdjustments, appSettings } from '../../shared/schema';
import { eq, and, gte, isNotNull, isNull, desc } from 'drizzle-orm';

const PAYPAL_API_BASE = 'https://api-m.paypal.com';

// ─── Access token (broad scope — no scope restriction so all app perms apply) ──

interface CachedToken { token: string; expiresAt: number }
const _cachedTokens = new Map<string, CachedToken>();

async function getAccessToken(orgId: string = 'org_planetbrick'): Promise<string> {
  const cached = _cachedTokens.get(orgId);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  // Read credentials from DB (org-scoped), fall back to env vars
  const [settings] = await db.select({
    paypalClientId: appSettings.paypalClientId,
    paypalClientSecret: appSettings.paypalClientSecret,
    paypalEnvironment: appSettings.paypalEnvironment,
  }).from(appSettings).where(eq(appSettings.orgId, orgId)).limit(1);

  const id = settings?.paypalClientId || process.env.PAYPAL_CLIENT_ID;
  const secret = settings?.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET;
  const environment = settings?.paypalEnvironment || 'live';
  const apiBase = environment === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : PAYPAL_API_BASE;

  if (!id || !secret) throw new Error('PayPal credentials not configured. Please add them in Settings → Platforms.');
  const res = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data: any = await res.json();
  if (!data.access_token) throw new Error(`PayPal token error: ${JSON.stringify(data)}`);
  _cachedTokens.set(orgId, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

// ─── Payments API: query a capture ───────────────────────────────────────────

interface CaptureResource {
  id: string;
  status: 'COMPLETED' | 'DECLINED' | 'PARTIALLY_REFUNDED' | 'PENDING' | 'REFUNDED';
  amount: { value: string; currency_code: string };
  links?: Array<{ href: string; rel: string; method: string }>;
}

interface RefundResource {
  id: string;
  status: 'CANCELLED' | 'PENDING' | 'COMPLETED';
  amount: { value: string; currency_code: string };
  create_time?: string;
  update_time?: string;
  links?: Array<{ href: string; rel: string; method: string }>;
}

async function apiGet<T>(url: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PayPal API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function queryCapture(captureId: string): Promise<CaptureResource> {
  return apiGet<CaptureResource>(`${PAYPAL_API_BASE}/v2/payments/captures/${captureId}`);
}

export async function queryRefund(refundId: string): Promise<RefundResource> {
  return apiGet<RefundResource>(`${PAYPAL_API_BASE}/v2/payments/refunds/${refundId}`);
}

// ─── Order lookup helpers ─────────────────────────────────────────────────────

type Order = typeof orders.$inferSelect;

async function findOrderByCaptureId(captureId: string): Promise<Order | undefined> {
  const [row] = await db.select().from(orders).where(eq(orders.paypalCaptureId, captureId)).limit(1);
  return row;
}

async function findOrderByPaypalOrderId(paypalOrderId: string): Promise<Order | undefined> {
  const [row] = await db.select().from(orders).where(eq(orders.paypalOrderId, paypalOrderId)).limit(1);
  return row;
}

async function findOrderByAmountFallback(amount: number, refundDate: Date): Promise<Order | undefined> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await db.select().from(orders).where(gte(orders.orderDate, since)).orderBy(desc(orders.orderDate));
  return rows.find(o => {
    if (!o.orderTotal) return false;
    if (Math.abs(Number(o.orderTotal) - amount) > 0.01) return false;
    const days = (refundDate.getTime() - new Date(o.orderDate).getTime()) / 86_400_000;
    return days >= -1 && days <= 90;
  });
}

async function refundAlreadyRecorded(refundId: string): Promise<boolean> {
  const rows = await db
    .select({ id: orderAdjustments.id })
    .from(orderAdjustments)
    .where(and(eq(orderAdjustments.externalTransactionId, refundId), eq(orderAdjustments.paymentMethod, 'paypal')))
    .limit(1);
  return rows.length > 0;
}

/**
 * Check if a refund of the same amount already exists for this order.
 * Guards against duplicate records when PayPal returns fees immediately via T0113
 * and then fires a PAYMENT.CAPTURE.REFUNDED webhook days later for the same amount.
 */
async function orderRefundAmountAlreadyRecorded(orderId: string, amount: number): Promise<boolean> {
  const rows = await db
    .select({ id: orderAdjustments.id, amount: orderAdjustments.amount })
    .from(orderAdjustments)
    .where(and(eq(orderAdjustments.orderId, orderId), eq(orderAdjustments.type, 'refund')));
  return rows.some(r => Math.abs(Math.abs(Number(r.amount)) - amount) < 0.01);
}

async function recordRefund(
  orderId: string,
  refundId: string,
  amount: number,
  eventType: string,
  refundDate: Date,
  captureId?: string,
): Promise<void> {
  await db.insert(orderAdjustments).values({
    orderId,
    type: 'refund',
    amount: (-amount).toFixed(2),
    paymentMethod: 'paypal',
    externalTransactionId: refundId,
    reason: `PayPal ${eventType}`,
    notes: `PayPal refund ${refundId}${captureId ? ` (capture ${captureId})` : ''} on ${refundDate.toISOString().split('T')[0]}`,
  });
}

// ─── Webhook signature verification ──────────────────────────────────────────

export interface WebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
}

export async function verifyWebhookSignature(headers: WebhookHeaders, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    console.warn('⚠️  PAYPAL_WEBHOOK_ID not set — skipping signature verification (insecure in production)');
    return true;
  }
  try {
    const token = await getAccessToken();
    const res = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transmission_id: headers.transmissionId,
        transmission_time: headers.transmissionTime,
        cert_url: headers.certUrl,
        auth_algo: headers.authAlgo,
        transmission_sig: headers.transmissionSig,
        webhook_id: webhookId,
        webhook_event: JSON.parse(rawBody),
      }),
    });
    const data: any = await res.json();
    if (data.verification_status !== 'SUCCESS') {
      console.warn('⚠️  PayPal signature verification failed:', data);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('PayPal webhook verification error:', err.message);
    return false;
  }
}

// ─── Webhook event handler ────────────────────────────────────────────────────

/**
 * Handles PAYMENT.CAPTURE.REFUNDED and PAYMENT.CAPTURE.REVERSED.
 *
 * Webhook resource structure for these events:
 *   resource        = the refund object
 *   resource.id     = refund_id
 *   resource.supplementary_data.related_ids.capture_id = the capture that was refunded
 *   resource.supplementary_data.related_ids.order_id   = the PayPal order
 *   resource.amount = gross refund amount
 */
export async function handleCaptureRefunded(event: any): Promise<{ processed: boolean; reason?: string }> {
  const resource = event.resource ?? {};
  const refundId: string = resource.id;
  const captureId: string | undefined = resource.supplementary_data?.related_ids?.capture_id;
  const paypalOrderId: string | undefined = resource.supplementary_data?.related_ids?.order_id;
  const rawAmount: string | undefined = resource.seller_receivable_breakdown?.gross_amount?.value ?? resource.amount?.value;

  console.log(`🅿️ PayPal webhook ${event.event_type}: refund=${refundId} capture=${captureId ?? '?'} order=${paypalOrderId ?? '?'} amount=${rawAmount ?? '?'}`);

  if (!rawAmount) return { processed: false, reason: 'No amount in webhook payload' };
  const amount = Math.abs(parseFloat(rawAmount));
  const refundDate = new Date(resource.update_time ?? resource.create_time ?? Date.now());

  if (await refundAlreadyRecorded(refundId)) {
    console.log(`  Refund ${refundId} already recorded — skipping`);
    return { processed: false, reason: 'Already recorded' };
  }

  // Matching priority: capture_id > paypal_order_id > amount fallback
  let order: Order | undefined;
  if (captureId) order = await findOrderByCaptureId(captureId);
  if (!order && paypalOrderId) order = await findOrderByPaypalOrderId(paypalOrderId);
  if (!order) order = await findOrderByAmountFallback(amount, refundDate);

  if (!order) {
    console.warn(`  No matching order for refund ${refundId} $${amount}`);
    return { processed: false, reason: 'No matching order found' };
  }

  // Guard against duplicate: PayPal returns fees immediately (T0113) and sends
  // PAYMENT.CAPTURE.REFUNDED days later for the same gross amount. Both have
  // different refund IDs so refundAlreadyRecorded won't catch this — check by
  // order + amount instead.
  if (await orderRefundAmountAlreadyRecorded(order.id, amount)) {
    console.log(`  Refund of $${amount} already recorded on order ${order.orderNumber} — skipping duplicate`);
    return { processed: false, reason: 'Refund amount already recorded for this order' };
  }

  // If this webhook gave us IDs we haven't stored yet, persist them
  const updates: Record<string, string> = {};
  if (captureId && !order.paypalCaptureId) updates.paypalCaptureId = captureId;
  if (paypalOrderId && !order.paypalOrderId) updates.paypalOrderId = paypalOrderId;
  if (Object.keys(updates).length > 0) {
    await db.update(orders).set(updates).where(eq(orders.id, order.id));
  }

  await recordRefund(order.id, refundId, amount, event.event_type, refundDate, captureId);
  console.log(`  ✅ Recorded PayPal refund -$${amount} on order ${order.orderNumber}`);
  return { processed: true };
}

// ─── Polling: check captures for refunds ─────────────────────────────────────

export interface CapturePollResult {
  checked: number;
  refundsFound: number;
  alreadySynced: number;
  errors: string[];
}

/**
 * For every order with a paypalCaptureId, query GET /v2/payments/captures/{id}.
 * If the capture status is PARTIALLY_REFUNDED or REFUNDED, follow HATEOAS refund
 * links to get the refund details and record any not yet in order_adjustments.
 *
 * This is the catch-up mechanism — webhooks are real-time but may be missed.
 * Run this as part of the order sync or on demand.
 */
export async function syncPayPalRefundsByCapture(): Promise<CapturePollResult> {
  const result: CapturePollResult = { checked: 0, refundsFound: 0, alreadySynced: 0, errors: [] };

  // Orders that have a capture_id stored but we want to check for refunds
  const ordersWithCapture = await db
    .select()
    .from(orders)
    .where(isNotNull(orders.paypalCaptureId))
    .orderBy(desc(orders.orderDate));

  console.log(`🅿️ PayPal capture poll: checking ${ordersWithCapture.length} orders with capture IDs`);

  for (const order of ordersWithCapture) {
    const captureId = order.paypalCaptureId!;
    result.checked++;

    try {
      const capture = await queryCapture(captureId);

      if (capture.status !== 'PARTIALLY_REFUNDED' && capture.status !== 'REFUNDED') continue;

      console.log(`  Order ${order.orderNumber} capture ${captureId} → status ${capture.status}`);

      // Follow HATEOAS refund links embedded in the capture
      const refundLinks = (capture.links ?? []).filter(l => l.rel === 'refund');

      if (refundLinks.length === 0) {
        // No HATEOAS links — record using the capture amount as a best-effort refund
        const refundId = `${captureId}_refund`;
        if (await refundAlreadyRecorded(refundId)) { result.alreadySynced++; continue; }
        const amount = Math.abs(parseFloat(capture.amount.value));
        await recordRefund(order.id, refundId, amount, `CAPTURE.${capture.status}`, new Date(), captureId);
        console.log(`  ✅ Recorded refund -$${amount} on order ${order.orderNumber} (no HATEOAS link)`);
        result.refundsFound++;
        continue;
      }

      for (const link of refundLinks) {
        try {
          const refund = await queryRefund(link.href.split('/').pop()!);
          if (refund.status !== 'COMPLETED') continue;

          if (await refundAlreadyRecorded(refund.id)) { result.alreadySynced++; continue; }

          const amount = Math.abs(parseFloat(refund.amount.value));
          if (await orderRefundAmountAlreadyRecorded(order.id, amount)) { result.alreadySynced++; continue; }

          const refundDate = new Date(refund.update_time ?? refund.create_time ?? Date.now());
          await recordRefund(order.id, refund.id, amount, 'PAYMENT.CAPTURE.REFUNDED', refundDate, captureId);
          console.log(`  ✅ Recorded refund ${refund.id} -$${amount} on order ${order.orderNumber}`);
          result.refundsFound++;
        } catch (err: any) {
          result.errors.push(`Refund fetch error (order ${order.orderNumber}): ${err.message}`);
        }
      }
    } catch (err: any) {
      // 404 = capture not found in Payments API (may be an older/different flow)
      if (!err.message?.includes('404')) {
        result.errors.push(`Capture query error (order ${order.orderNumber}): ${err.message}`);
      }
    }
  }

  console.log(`🅿️ PayPal capture poll complete: ${result.checked} checked, ${result.refundsFound} new, ${result.alreadySynced} already synced`);
  return result;
}

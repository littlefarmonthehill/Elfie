/**
 * PayPal Webhook Handler
 *
 * Listens for PAYMENT.CAPTURE.REFUNDED and PAYMENT.CAPTURE.REVERSED events.
 * Verifies the webhook signature using PayPal's API, then matches the refund
 * to a local order and creates an order_adjustments record.
 *
 * Matching priority:
 *  1. Exact: orders.paypal_order_id = resource.supplementary_data.related_ids.order_id
 *  2. Fallback: refund amount + recent order date proximity
 */

import { db } from '../db';
import { orders, orderAdjustments } from '../../shared/schema';
import { eq, and, gte, desc } from 'drizzle-orm';

const PAYPAL_API_BASE = 'https://api-m.paypal.com';

// ─── Auth token (broad scope for webhook verification + payments) ─────────────

interface CachedToken { token: string; expiresAt: number }
let cachedToken: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET not set');
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data: any = await res.json();
  if (!data.access_token) throw new Error('Failed to get PayPal access token for webhook verification');
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

// ─── Webhook signature verification ──────────────────────────────────────────

export interface WebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
}

export async function verifyWebhookSignature(
  headers: WebhookHeaders,
  rawBody: string,
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    console.warn('⚠️  PAYPAL_WEBHOOK_ID not set — skipping signature verification (insecure)');
    return true;
  }

  try {
    const token = await getAccessToken();
    const res = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
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
    const verified = data.verification_status === 'SUCCESS';
    if (!verified) console.warn('⚠️  PayPal webhook signature verification failed:', data);
    return verified;
  } catch (err: any) {
    console.error('PayPal webhook signature verification error:', err.message);
    return false;
  }
}

// ─── Order matching ───────────────────────────────────────────────────────────

async function findOrderForRefund(
  paypalOrderId: string | undefined,
  refundAmount: number,
  refundDate: Date,
): Promise<typeof orders.$inferSelect | undefined> {
  // Strategy 1: exact PayPal order ID match
  if (paypalOrderId) {
    const [row] = await db
      .select()
      .from(orders)
      .where(eq(orders.paypalOrderId, paypalOrderId))
      .limit(1);
    if (row) {
      console.log(`  PayPal webhook: matched order ${row.orderNumber} via paypal_order_id ${paypalOrderId}`);
      return row;
    }
  }

  // Strategy 2: amount + recency (last 90 days)
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const candidates = await db
    .select()
    .from(orders)
    .where(gte(orders.orderDate, since))
    .orderBy(desc(orders.orderDate));

  const match = candidates.find(o => {
    if (!o.orderTotal) return false;
    if (Math.abs(Number(o.orderTotal) - refundAmount) > 0.01) return false;
    const orderDate = new Date(o.orderDate);
    const days = (refundDate.getTime() - orderDate.getTime()) / 86_400_000;
    return days >= -1 && days <= 90;
  });

  if (match) {
    console.log(`  PayPal webhook: matched order ${match.orderNumber} via amount $${refundAmount} (fallback)`);
  } else {
    console.warn(`  PayPal webhook: no order found for refund $${refundAmount} (paypalOrderId=${paypalOrderId ?? 'none'})`);
  }
  return match;
}

// ─── Refund event handler ─────────────────────────────────────────────────────

export interface PayPalCaptureEvent {
  id: string;
  event_type: string;
  resource: {
    id: string;
    status?: string;
    amount?: { value: string; currency_code: string };
    seller_receivable_breakdown?: {
      gross_amount?: { value: string };
    };
    supplementary_data?: {
      related_ids?: {
        order_id?: string;
        capture_id?: string;
      };
    };
    create_time?: string;
    update_time?: string;
  };
}

export async function handleCaptureRefunded(event: PayPalCaptureEvent): Promise<{ processed: boolean; reason?: string }> {
  const resource = event.resource;
  const refundId = resource.id;
  const paypalOrderId = resource.supplementary_data?.related_ids?.order_id;
  const captureId = resource.supplementary_data?.related_ids?.capture_id;

  const rawAmount =
    resource.seller_receivable_breakdown?.gross_amount?.value ??
    resource.amount?.value;
  if (!rawAmount) return { processed: false, reason: 'No refund amount in event' };

  const refundAmount = Math.abs(parseFloat(rawAmount));
  const refundDate = new Date(resource.update_time ?? resource.create_time ?? Date.now());

  console.log(`🅿️ PayPal webhook ${event.event_type}: refund ${refundId} $${refundAmount} paypalOrderId=${paypalOrderId ?? 'none'} captureId=${captureId ?? 'none'}`);

  // Deduplicate
  const existing = await db
    .select({ id: orderAdjustments.id })
    .from(orderAdjustments)
    .where(
      and(
        eq(orderAdjustments.externalTransactionId, refundId),
        eq(orderAdjustments.paymentMethod, 'paypal'),
      )
    )
    .limit(1);
  if (existing.length > 0) {
    console.log(`  Refund ${refundId} already recorded — skipping`);
    return { processed: false, reason: 'Already recorded' };
  }

  const order = await findOrderForRefund(paypalOrderId, refundAmount, refundDate);
  if (!order) return { processed: false, reason: 'No matching order found' };

  await db.insert(orderAdjustments).values({
    orderId: order.id,
    type: 'refund',
    amount: (-refundAmount).toFixed(2),
    paymentMethod: 'paypal',
    externalTransactionId: refundId,
    reason: `PayPal ${event.event_type}`,
    notes: `PayPal capture refund ${refundId}${captureId ? ` (capture ${captureId})` : ''} on ${refundDate.toISOString().split('T')[0]}`,
  });

  console.log(`  ✅ Recorded PayPal refund -$${refundAmount} on order ${order.orderNumber}`);
  return { processed: true };
}

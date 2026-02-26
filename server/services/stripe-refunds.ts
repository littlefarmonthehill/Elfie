import { db } from '../db';
import { orders, orderAdjustments } from '@shared/schema';
import { eq, and, isNull, gte, sql } from 'drizzle-orm';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

interface StripeRefund {
  id: string;
  amount: number; // in cents
  currency: string;
  status: string;
  reason: string | null;
  created: number; // unix timestamp
  charge: string;
  payment_intent: string | null;
  metadata: Record<string, string>;
}

interface SyncResult {
  refundsChecked: number;
  matched: number;
  alreadySynced: number;
  unmatched: number;
  errors: string[];
  matches: Array<{ refundId: string; orderId: string; orderNumber: string; amount: number }>;
  unmatchedRefunds: Array<{ refundId: string; amount: number; date: string; reason: string | null }>;
}

async function stripeGet(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');

  const url = new URL(`${STRIPE_API_BASE}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
    },
  });

  const data = await response.json();
  if (data.error) throw new Error(`Stripe API error: ${data.error.message}`);
  return data;
}

export async function fetchStripeRefunds(sinceDays = 90): Promise<StripeRefund[]> {
  const since = Math.floor((Date.now() - sinceDays * 24 * 60 * 60 * 1000) / 1000);
  const refunds: StripeRefund[] = [];
  let startingAfter: string | null = null;

  while (true) {
    const params: Record<string, string> = {
      limit: '100',
      'created[gte]': String(since),
    };
    if (startingAfter) params.starting_after = startingAfter;

    const page = await stripeGet('/refunds', params);
    refunds.push(...page.data);

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  return refunds.filter(r => r.status === 'succeeded');
}

export async function syncStripeRefunds(sinceDays = 90): Promise<SyncResult> {
  const result: SyncResult = {
    refundsChecked: 0,
    matched: 0,
    alreadySynced: 0,
    unmatched: 0,
    errors: [],
    matches: [],
    unmatchedRefunds: [],
  };

  // Fetch refunds from Stripe
  const refunds = await fetchStripeRefunds(sinceDays);
  result.refundsChecked = refunds.length;

  // Fetch all shipped/completed orders within the same window
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const dbOrders = await db
    .select()
    .from(orders)
    .where(gte(orders.orderDate, sinceDate));

  // Get already-synced Stripe refund IDs to avoid duplicates
  const existingAdjustments = await db
    .select({ externalTransactionId: orderAdjustments.externalTransactionId })
    .from(orderAdjustments)
    .where(eq(orderAdjustments.paymentMethod, 'stripe'));

  const syncedRefundIds = new Set(
    existingAdjustments
      .map(a => a.externalTransactionId)
      .filter(Boolean) as string[]
  );

  for (const refund of refunds) {
    // Skip already synced
    if (syncedRefundIds.has(refund.id)) {
      result.alreadySynced++;
      continue;
    }

    const refundAmountDollars = refund.amount / 100;
    const refundDate = new Date(refund.created * 1000);

    // Match by exact order total amount + refund date >= order date
    const match = dbOrders.find(order => {
      if (!order.orderTotal) return false;
      const orderTotal = Number(order.orderTotal);
      const orderDate = new Date(order.orderDate);

      // Amount must match exactly (to the cent)
      if (Math.abs(orderTotal - refundAmountDollars) > 0.01) return false;

      // Refund must be on or after order date
      if (refundDate < orderDate) return false;

      // Refund must be within 60 days of order
      const daysDiff = (refundDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff > 60) return false;

      return true;
    });

    if (!match) {
      result.unmatched++;
      result.unmatchedRefunds.push({
        refundId: refund.id,
        amount: refundAmountDollars,
        date: refundDate.toISOString().split('T')[0],
        reason: refund.reason,
      });
      continue;
    }

    // Insert adjustment record
    try {
      await db.insert(orderAdjustments).values({
        orderId: match.id,
        type: 'refund',
        amount: (-refundAmountDollars).toFixed(2),
        paymentMethod: 'stripe',
        externalTransactionId: refund.id,
        reason: refund.reason === 'requested_by_customer' ? 'Customer return' : (refund.reason || 'Refund'),
        notes: `Stripe refund ${refund.id} processed on ${refundDate.toISOString().split('T')[0]}`,
      });

      result.matched++;
      result.matches.push({
        refundId: refund.id,
        orderId: match.id,
        orderNumber: match.orderNumber || match.id,
        amount: refundAmountDollars,
      });
    } catch (err: any) {
      result.errors.push(`Failed to save refund ${refund.id}: ${err.message}`);
    }
  }

  return result;
}

export async function getOrderAdjustments(orderId: string) {
  return db
    .select()
    .from(orderAdjustments)
    .where(eq(orderAdjustments.orderId, orderId))
    .orderBy(orderAdjustments.createdAt);
}

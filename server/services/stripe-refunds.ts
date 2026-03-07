import { db } from '../db';
import { orders, orderAdjustments } from '@shared/schema';
import { eq, and, gte } from 'drizzle-orm';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

interface StripeRefund {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reason: string | null;
  created: number;
  charge: string;
  payment_intent: string | null;
  metadata: Record<string, string>;
}

interface StripeBalanceTransaction {
  id: string;
  amount: number;
  fee: number;
  net: number;
  fee_details: Array<{ type: string; amount: number; description: string }>;
  created: number;
  description: string | null;
  source: string;
  type: string;
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

interface FeeSyncResult {
  transactionsChecked: number;
  matched: number;
  alreadySynced: number;
  unmatched: number;
  errors: string[];
}

async function stripeGet(endpoint: string, params: Record<string, string> = {}, apiKey?: string): Promise<any> {
  const key = apiKey || process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe secret key not configured. Add it under Settings → Platforms → Payments → Stripe.');

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

export async function fetchStripeRefunds(sinceDays = 90, apiKey?: string): Promise<StripeRefund[]> {
  const since = Math.floor((Date.now() - sinceDays * 24 * 60 * 60 * 1000) / 1000);
  const refunds: StripeRefund[] = [];
  let startingAfter: string | null = null;

  while (true) {
    const params: Record<string, string> = {
      limit: '100',
      'created[gte]': String(since),
    };
    if (startingAfter) params.starting_after = startingAfter;

    const page = await stripeGet('/refunds', params, apiKey);
    refunds.push(...page.data);

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  return refunds.filter(r => r.status === 'succeeded');
}

async function fetchStripeChargeTransactions(sinceDays = 90, apiKey?: string): Promise<StripeBalanceTransaction[]> {
  const since = Math.floor((Date.now() - sinceDays * 24 * 60 * 60 * 1000) / 1000);
  const transactions: StripeBalanceTransaction[] = [];
  let startingAfter: string | null = null;

  while (true) {
    const params: Record<string, string> = {
      limit: '100',
      type: 'charge',
      'created[gte]': String(since),
    };
    if (startingAfter) params.starting_after = startingAfter;

    const page = await stripeGet('/balance_transactions', params, apiKey);
    transactions.push(...page.data);

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  return transactions;
}

export async function syncStripeFees(sinceDays = 90, apiKey?: string): Promise<FeeSyncResult> {
  const result: FeeSyncResult = {
    transactionsChecked: 0,
    matched: 0,
    alreadySynced: 0,
    unmatched: 0,
    errors: [],
  };

  const transactions = await fetchStripeChargeTransactions(sinceDays, apiKey);
  result.transactionsChecked = transactions.length;

  if (transactions.length === 0) return result;

  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const dbOrders = await db.select().from(orders).where(gte(orders.orderDate, sinceDate));

  // Get already-synced fee transaction IDs
  const existingFees = await db
    .select({ externalTransactionId: orderAdjustments.externalTransactionId })
    .from(orderAdjustments)
    .where(eq(orderAdjustments.type, 'merchant_fee'));

  const syncedFeeIds = new Set(
    existingFees.map(f => f.externalTransactionId).filter(Boolean) as string[]
  );

  for (const txn of transactions) {
    const appFeeId = `${txn.id}_app`;
    const stripeFeeId = `${txn.id}_stripe`;

    if (syncedFeeIds.has(appFeeId) || syncedFeeIds.has(stripeFeeId)) {
      result.alreadySynced++;
      continue;
    }

    const chargeAmountDollars = txn.amount / 100;
    const txnDate = new Date(txn.created * 1000);

    // Match to an order by amount + date proximity
    // Charges can arrive before or after the order syncs to our DB (within a few days window)
    const match = dbOrders.find(order => {
      if (!order.orderTotal) return false;
      const orderTotal = Number(order.orderTotal);
      const orderDate = new Date(order.orderDate);

      if (Math.abs(orderTotal - chargeAmountDollars) > 0.01) return false;

      // Allow charge to be within 7 days before or 14 days after order date
      const daysDiff = (txnDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff < -7 || daysDiff > 14) return false;

      return true;
    });

    if (!match) {
      result.unmatched++;
      continue;
    }

    try {
      const appFeeDetail = txn.fee_details.find(f => f.type === 'application_fee');
      const stripeFeeDetail = txn.fee_details.find(f => f.type === 'stripe_fee');

      if (appFeeDetail && appFeeDetail.amount > 0) {
        await db.insert(orderAdjustments).values({
          orderId: match.id,
          type: 'merchant_fee',
          amount: (-(appFeeDetail.amount / 100)).toFixed(2),
          paymentMethod: 'stripe',
          externalTransactionId: appFeeId,
          reason: 'BrickLink payment connector fee',
          notes: `${(appFeeDetail.amount / 100).toFixed(2)} fee on $${chargeAmountDollars.toFixed(2)} charge (txn ${txn.id})`,
        });
      }

      if (stripeFeeDetail && stripeFeeDetail.amount > 0) {
        await db.insert(orderAdjustments).values({
          orderId: match.id,
          type: 'merchant_fee',
          amount: (-(stripeFeeDetail.amount / 100)).toFixed(2),
          paymentMethod: 'stripe',
          externalTransactionId: stripeFeeId,
          reason: 'Stripe processing fee',
          notes: `${(stripeFeeDetail.amount / 100).toFixed(2)} fee on $${chargeAmountDollars.toFixed(2)} charge (txn ${txn.id})`,
        });
      }

      result.matched++;
    } catch (err: any) {
      result.errors.push(`Failed to save fees for txn ${txn.id}: ${err.message}`);
    }
  }

  return result;
}

export async function syncStripeRefunds(sinceDays = 90, apiKey?: string): Promise<SyncResult> {
  const result: SyncResult = {
    refundsChecked: 0,
    matched: 0,
    alreadySynced: 0,
    unmatched: 0,
    errors: [],
    matches: [],
    unmatchedRefunds: [],
  };

  const refunds = await fetchStripeRefunds(sinceDays, apiKey);
  result.refundsChecked = refunds.length;

  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const dbOrders = await db.select().from(orders).where(gte(orders.orderDate, sinceDate));

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
    if (syncedRefundIds.has(refund.id)) {
      result.alreadySynced++;
      continue;
    }

    const refundAmountDollars = refund.amount / 100;
    const refundDate = new Date(refund.created * 1000);

    const match = dbOrders.find(order => {
      if (!order.orderTotal) return false;
      const orderTotal = Number(order.orderTotal);
      const orderDate = new Date(order.orderDate);

      if (Math.abs(orderTotal - refundAmountDollars) > 0.01) return false;
      if (refundDate < orderDate) return false;
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

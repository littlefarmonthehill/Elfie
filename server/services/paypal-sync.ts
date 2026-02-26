import { db } from '../db';
import { orders, orderAdjustments } from '@shared/schema';
import { eq, and, gte } from 'drizzle-orm';

const PAYPAL_API_BASE = 'https://api-m.paypal.com';

interface PayPalAccessToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface PayPalTransaction {
  transaction_info: {
    paypal_account_id: string;
    transaction_id: string;
    paypal_reference_id: string;
    paypal_reference_id_type: string;
    transaction_event_code: string;
    transaction_initiation_date: string;
    transaction_updated_date: string;
    transaction_amount: { currency_code: string; value: string };
    fee_amount?: { currency_code: string; value: string };
    insurance_amount?: { currency_code: string; value: string };
    sales_tax_amount?: { currency_code: string; value: string };
    shipping_amount?: { currency_code: string; value: string };
    ship_discount_amount?: { currency_code: string; value: string };
    transaction_status: string;
    transaction_subject?: string;
    transaction_note?: string;
    payment_tracking_id?: string;
    bank_reference_id?: string;
    ending_balance?: { currency_code: string; value: string };
    available_balance?: { currency_code: string; value: string };
    invoice_id?: string;
    custom_field?: string;
  };
  payer_info?: {
    account_id: string;
    email_address: string;
    address_status: string;
    payer_status: string;
    payer_name: { given_name: string; surname: string };
    country_code: string;
  };
  shipping_info?: {
    name: string;
    method: string;
    address: {
      line1: string;
      city: string;
      state: string;
      postal_code: string;
      country_code: string;
    };
  };
  cart_info?: {
    item_details?: Array<{
      item_name?: string;
      item_description?: string;
      item_quantity?: string;
      item_unit_price?: { currency_code: string; value: string };
      item_amount?: { currency_code: string; value: string };
    }>;
  };
}

export interface PayPalSyncResult {
  transactionsChecked: number;
  refundsMatched: number;
  feesMatched: number;
  alreadySynced: number;
  unmatched: number;
  errors: string[];
  matches: Array<{ transactionId: string; orderId: string; orderNumber: string; amount: number; type: 'refund' | 'fee' }>;
  unmatchedTransactions: Array<{ transactionId: string; amount: number; date: string; type: string }>;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET not configured');

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const data: PayPalAccessToken = await response.json();
  if (!data.access_token) throw new Error('Failed to obtain PayPal access token');

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.token;
}

async function fetchTransactions(startDate: Date, endDate: Date): Promise<PayPalTransaction[]> {
  const token = await getAccessToken();
  const transactions: PayPalTransaction[] = [];
  let page = 1;
  let totalPages = 1;

  // PayPal Transaction Search max window is 31 days - caller must split if needed
  const start = startDate.toISOString().replace(/\.\d{3}Z$/, '-0000');
  const end = endDate.toISOString().replace(/\.\d{3}Z$/, '-0000');

  while (page <= totalPages) {
    const url = new URL(`${PAYPAL_API_BASE}/v1/reporting/transactions`);
    url.searchParams.set('start_date', start);
    url.searchParams.set('end_date', end);
    url.searchParams.set('fields', 'all');
    url.searchParams.set('page_size', '500');
    url.searchParams.set('page', String(page));

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    const data = await response.json();
    if (data.name && data.message) throw new Error(`PayPal API error: ${data.message}`);

    if (data.transaction_details) {
      transactions.push(...data.transaction_details);
    }

    totalPages = data.total_pages || 1;
    page++;
  }

  return transactions;
}

/**
 * Fetch all transactions for the past `sinceDays` days.
 * PayPal's API has a 31-day window limit, so we split into chunks.
 */
async function fetchAllTransactions(sinceDays: number): Promise<PayPalTransaction[]> {
  const endDate = new Date();
  const startDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const allTransactions: PayPalTransaction[] = [];
  const chunkMs = 31 * 24 * 60 * 60 * 1000; // 31 days in ms

  let chunkStart = new Date(startDate);
  while (chunkStart < endDate) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + chunkMs, endDate.getTime()));
    const chunk = await fetchTransactions(chunkStart, chunkEnd);
    allTransactions.push(...chunk);
    chunkStart = new Date(chunkEnd.getTime() + 1000); // +1 second to avoid overlap
  }

  return allTransactions;
}

/**
 * Parse a PayPal amount string to a positive float (absolute value)
 */
function parseAmount(value: string): number {
  return Math.abs(parseFloat(value));
}

/**
 * Map PayPal transaction event codes to human-readable types
 * T0006 = Express Checkout payment
 * T1107 = Payment refund
 * T1201 = Chargeback
 * T1202 = Chargeback reversal
 */
function classifyTransaction(eventCode: string): 'sale' | 'refund' | 'chargeback' | 'other' {
  if (['T0001', 'T0002', 'T0003', 'T0004', 'T0005', 'T0006', 'T0007', 'T0008', 'T0009', 'T0010',
       'T0011', 'T0012', 'T0013', 'T0014', 'T0015', 'T0016', 'T0017', 'T0018', 'T0019', 'T0020'].includes(eventCode)) {
    return 'sale';
  }
  if (['T1107', 'T1108', 'T2105'].includes(eventCode)) {
    return 'refund';
  }
  if (['T1201', 'T1202'].includes(eventCode)) {
    return 'chargeback';
  }
  return 'other';
}

export async function syncPayPalTransactions(sinceDays = 90): Promise<PayPalSyncResult> {
  const result: PayPalSyncResult = {
    transactionsChecked: 0,
    refundsMatched: 0,
    feesMatched: 0,
    alreadySynced: 0,
    unmatched: 0,
    errors: [],
    matches: [],
    unmatchedTransactions: [],
  };

  const allTransactions = await fetchAllTransactions(sinceDays);
  result.transactionsChecked = allTransactions.length;

  if (allTransactions.length === 0) return result;

  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const dbOrders = await db.select().from(orders).where(gte(orders.orderDate, sinceDate));

  // Get already-synced PayPal transaction IDs
  const existingAdjustments = await db
    .select({ externalTransactionId: orderAdjustments.externalTransactionId })
    .from(orderAdjustments)
    .where(eq(orderAdjustments.paymentMethod, 'paypal'));

  const syncedIds = new Set(
    existingAdjustments.map(a => a.externalTransactionId).filter(Boolean) as string[]
  );

  // Process refunds
  const refunds = allTransactions.filter(t => {
    const code = t.transaction_info.transaction_event_code;
    return classifyTransaction(code) === 'refund' && t.transaction_info.transaction_status === 'S';
  });

  for (const txn of refunds) {
    const info = txn.transaction_info;
    const txnId = info.transaction_id;

    if (syncedIds.has(txnId)) {
      result.alreadySynced++;
      continue;
    }

    const refundAmount = parseAmount(info.transaction_amount.value);
    const txnDate = new Date(info.transaction_initiation_date);

    const match = dbOrders.find(order => {
      if (!order.orderTotal) return false;
      const orderTotal = Number(order.orderTotal);
      const orderDate = new Date(order.orderDate);

      if (Math.abs(orderTotal - refundAmount) > 0.01) return false;
      if (txnDate < orderDate) return false;
      const daysDiff = (txnDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff > 60) return false;

      return true;
    });

    if (!match) {
      result.unmatched++;
      result.unmatchedTransactions.push({
        transactionId: txnId,
        amount: refundAmount,
        date: txnDate.toISOString().split('T')[0],
        type: 'refund',
      });
      continue;
    }

    try {
      await db.insert(orderAdjustments).values({
        orderId: match.id,
        type: 'refund',
        amount: (-refundAmount).toFixed(2),
        paymentMethod: 'paypal',
        externalTransactionId: txnId,
        reason: 'PayPal refund',
        notes: `PayPal refund ${txnId} processed on ${txnDate.toISOString().split('T')[0]}`,
      });

      result.refundsMatched++;
      result.matches.push({
        transactionId: txnId,
        orderId: match.id,
        orderNumber: match.orderNumber || match.id,
        amount: refundAmount,
        type: 'refund',
      });
    } catch (err: any) {
      result.errors.push(`Failed to save refund ${txnId}: ${err.message}`);
    }
  }

  // Process fees from completed sales
  const sales = allTransactions.filter(t => {
    const code = t.transaction_info.transaction_event_code;
    return classifyTransaction(code) === 'sale' && t.transaction_info.transaction_status === 'S';
  });

  for (const txn of sales) {
    const info = txn.transaction_info;
    const txnId = info.transaction_id;
    const feeId = `${txnId}_fee`;

    if (!info.fee_amount) continue;
    if (syncedIds.has(feeId)) {
      result.alreadySynced++;
      continue;
    }

    const saleAmount = parseAmount(info.transaction_amount.value);
    const feeAmount = parseAmount(info.fee_amount.value);
    if (feeAmount === 0) continue;

    const txnDate = new Date(info.transaction_initiation_date);

    const match = dbOrders.find(order => {
      if (!order.orderTotal) return false;
      const orderTotal = Number(order.orderTotal);
      const orderDate = new Date(order.orderDate);

      if (Math.abs(orderTotal - saleAmount) > 0.01) return false;

      const daysDiff = (txnDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff < -7 || daysDiff > 14) return false;

      return true;
    });

    if (!match) {
      result.unmatched++;
      continue;
    }

    try {
      await db.insert(orderAdjustments).values({
        orderId: match.id,
        type: 'merchant_fee',
        amount: (-feeAmount).toFixed(2),
        paymentMethod: 'paypal',
        externalTransactionId: feeId,
        reason: 'PayPal transaction fee',
        notes: `$${feeAmount.toFixed(2)} PayPal fee on $${saleAmount.toFixed(2)} sale (txn ${txnId})`,
      });

      result.feesMatched++;
      result.matches.push({
        transactionId: feeId,
        orderId: match.id,
        orderNumber: match.orderNumber || match.id,
        amount: feeAmount,
        type: 'fee',
      });
    } catch (err: any) {
      result.errors.push(`Failed to save fee for txn ${txnId}: ${err.message}`);
    }
  }

  return result;
}

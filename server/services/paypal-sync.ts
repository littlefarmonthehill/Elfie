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
  unmatchedTransactions: Array<{ transactionId: string; amount: number; date: string; type: string; eventCode: string }>;
}

interface RefundSyncResult {
  refundsChecked: number;
  matched: number;
  alreadySynced: number;
  unmatched: number;
  errors: string[];
  matches: Array<{ transactionId: string; orderId: string; orderNumber: string; amount: number }>;
  unmatchedTransactions: Array<{ transactionId: string; amount: number; date: string; eventCode: string }>;
}

interface FeeSyncResult {
  transactionsChecked: number;
  matched: number;
  alreadySynced: number;
  unmatched: number;
  errors: string[];
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export function clearPayPalTokenCache() {
  cachedToken = null;
}

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
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Furi.paypal.com%2Fservices%2Freporting%2Fsearch%2Fread',
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
 * Fetch all PayPal transactions for the past `sinceDays` days.
 * PayPal's API has a 31-day window limit, so we split into 31-day chunks.
 */
export async function fetchAllPayPalTransactions(sinceDays: number): Promise<PayPalTransaction[]> {
  const endDate = new Date();
  const startDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const allTransactions: PayPalTransaction[] = [];
  const chunkMs = 31 * 24 * 60 * 60 * 1000;

  let chunkStart = new Date(startDate);
  while (chunkStart < endDate) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + chunkMs, endDate.getTime()));
    const chunk = await fetchTransactions(chunkStart, chunkEnd);
    allTransactions.push(...chunk);
    chunkStart = new Date(chunkEnd.getTime() + 1000);
  }

  return allTransactions;
}

/**
 * PayPal transaction event codes that indicate a refund/reversal.
 *
 * T0113 - Reversal of an Express Checkout (T0006) payment — the most common
 *          code when a seller refunds a buyer who paid via Express Checkout
 * T1106 - Seller-initiated refund / billing agreement cancellation credit
 * T1107 - Payment refund sent by merchant
 * T1108 - Reversal / fee reversal
 * T2104 - Dispute resolution (reversal cancellation) — net credit to merchant
 * T2105 - Dispute settlement / chargeback refund
 *
 * We accept any status (S=Success, P=Pending, V=Reversal, etc.) so partial
 * or pending refunds still get matched.
 */
const REFUND_EVENT_CODES = new Set(['T0113', 'T1106', 'T1107', 'T1108', 'T2104', 'T2105']);

/**
 * Sale event codes — T0000-T0020 series.
 */
const SALE_EVENT_CODES = new Set([
  'T0001','T0002','T0003','T0004','T0005','T0006','T0007','T0008','T0009','T0010',
  'T0011','T0012','T0013','T0014','T0015','T0016','T0017','T0018','T0019','T0020',
]);

function parseAmount(value: string): number {
  return Math.abs(parseFloat(value));
}

/**
 * Normalize an order/invoice reference for loose comparison.
 * Strips platform prefixes (BL-, BO-) and leading zeros.
 */
function normalizeOrderRef(s: string): string {
  return s.replace(/^(BL[-.]?|BO[-.]?)/i, '').replace(/^0+/, '').trim();
}

// ─── Refunds ─────────────────────────────────────────────────────────────────

/**
 * Sync PayPal refund transactions to order_adjustments.
 * Mirrors the Stripe pattern exactly: fetch → deduplicate → match → insert.
 */
export async function syncPayPalRefunds(sinceDays = 90, forceResync = false): Promise<RefundSyncResult> {
  const result: RefundSyncResult = {
    refundsChecked: 0,
    matched: 0,
    alreadySynced: 0,
    unmatched: 0,
    errors: [],
    matches: [],
    unmatchedTransactions: [],
  };

  if (forceResync) {
    await db.delete(orderAdjustments).where(and(
      eq(orderAdjustments.paymentMethod, 'paypal'),
      eq(orderAdjustments.type, 'refund'),
    ));
    console.log('🗑️ PayPal force-resync: cleared existing PayPal refund adjustments');
  }

  const allTransactions = await fetchAllPayPalTransactions(sinceDays);
  console.log(`🅿️ PayPal: fetched ${allTransactions.length} total transactions (last ${sinceDays} days)`);

  // Log breakdown of event codes for diagnostics
  const codeCounts: Record<string, number> = {};
  for (const t of allTransactions) {
    const code = t.transaction_info.transaction_event_code;
    codeCounts[code] = (codeCounts[code] || 0) + 1;
  }
  console.log('🅿️ PayPal event code breakdown:', Object.entries(codeCounts).sort().map(([k,v]) => `${k}:${v}`).join(', '));

  // Build a lookup map: original payment transaction_id → transaction record.
  // Used to resolve T0113 tax-reversal transactions back to the full order amount.
  // PayPal splits a full-order refund into the tax portion (T0113) + the remainder
  // (sometimes T1107 or not yet visible). T0113.paypal_reference_id → T0006.transaction_id.
  const saleByTxnId = new Map<string, PayPalTransaction>();
  for (const t of allTransactions) {
    if (SALE_EVENT_CODES.has(t.transaction_info.transaction_event_code)) {
      saleByTxnId.set(t.transaction_info.transaction_id, t);
    }
  }

  // Filter to refund-type transactions (any status — PayPal pending refunds still matter)
  const refundTxns = allTransactions.filter(t =>
    REFUND_EVENT_CODES.has(t.transaction_info.transaction_event_code)
  );
  result.refundsChecked = refundTxns.length;
  console.log(`🅿️ PayPal: ${refundTxns.length} refund-type transactions found [codes: ${refundTxns.map(t => t.transaction_info.transaction_event_code).join(', ') || 'none'}]`);

  if (refundTxns.length === 0) return result;

  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const dbOrders = await db.select().from(orders).where(gte(orders.orderDate, sinceDate));

  const existingAdjustments = await db
    .select({ externalTransactionId: orderAdjustments.externalTransactionId })
    .from(orderAdjustments)
    .where(eq(orderAdjustments.paymentMethod, 'paypal'));

  const syncedIds = new Set(
    existingAdjustments.map(a => a.externalTransactionId).filter(Boolean) as string[]
  );

  for (const txn of refundTxns) {
    const info = txn.transaction_info;
    const txnId = info.transaction_id;

    if (syncedIds.has(txnId)) {
      result.alreadySynced++;
      continue;
    }

    // refundAmount may be overridden below if we resolve back to the original payment
    let refundAmount = parseAmount(info.transaction_amount.value);
    const txnDate = new Date(info.transaction_initiation_date);
    const eventCode = info.transaction_event_code;

    // ── Matching ───────────────────────────────────────────────────────────

    let match: typeof dbOrders[0] | undefined;

    // Strategy 1: invoice_id fast path — BrickLink sets invoice_id = order number
    // on the payment; refund transactions often inherit the same invoice_id.
    const invoiceRef = info.invoice_id || info.custom_field || '';
    if (invoiceRef) {
      const normInvoice = normalizeOrderRef(invoiceRef);
      match = dbOrders.find(o => {
        const normOrder = normalizeOrderRef(o.orderNumber || '');
        return normOrder.length > 0 && normOrder === normInvoice;
      });
      if (match) {
        console.log(`  ${txnId} (${eventCode}): $${refundAmount} → matched via invoice_id "${invoiceRef}" → order ${match.orderNumber}`);
      }
    }

    // Strategy 2: exact amount + date proximity (mirrors Stripe)
    if (!match) {
      match = dbOrders.find(order => {
        if (!order.orderTotal) return false;
        const orderTotal = Number(order.orderTotal);
        const orderDate = new Date(order.orderDate);
        if (Math.abs(orderTotal - refundAmount) > 0.01) return false;
        if (txnDate < orderDate) return false;
        const daysDiff = (txnDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
        return daysDiff <= 60;
      });
      if (match) {
        console.log(`  ${txnId} (${eventCode}): $${refundAmount} → matched via amount+date → order ${match.orderNumber}`);
      }
    }

    // Strategy 3: follow paypal_reference_id back to the original sale (T0006).
    // PayPal sends a T0113 for the tax portion of a refund (e.g. $0.61) while the
    // full order payment was $8.88. The T0113 carries a paypal_reference_id pointing
    // to the T0006. We look up that T0006, use its FULL amount to find the order,
    // and then record the refund for the full order total — not just the tax slice.
    if (!match && info.paypal_reference_id) {
      const origPayment = saleByTxnId.get(info.paypal_reference_id);
      if (origPayment) {
        const origAmount = parseAmount(origPayment.transaction_info.transaction_amount.value);
        match = dbOrders.find(order => {
          if (!order.orderTotal) return false;
          const orderTotal = Number(order.orderTotal);
          const orderDate = new Date(order.orderDate);
          if (Math.abs(orderTotal - origAmount) > 0.01) return false;
          if (txnDate < orderDate) return false;
          const daysDiff = (txnDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
          return daysDiff <= 60;
        });
        if (match) {
          // Record the FULL order amount as the refund (the T0113 is just the tax slice)
          refundAmount = origAmount;
          console.log(`  ${txnId} (${eventCode}): $${parseAmount(info.transaction_amount.value)} (partial/tax) → linked via T0006 ref $${origAmount} → order ${match.orderNumber} — recording full refund $${refundAmount}`);
        }
      }
    }

    if (!match) {
      console.log(`  ${txnId} (${eventCode}): $${refundAmount} on ${txnDate.toISOString().split('T')[0]} → no match (invoice="${invoiceRef || 'none'}", ref="${info.paypal_reference_id || 'none'}")`);
      result.unmatched++;
      result.unmatchedTransactions.push({
        transactionId: txnId,
        amount: refundAmount,
        date: txnDate.toISOString().split('T')[0],
        eventCode,
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
        notes: `PayPal ${eventCode} refund ${txnId} on ${txnDate.toISOString().split('T')[0]}`,
      });

      result.matched++;
      result.matches.push({
        transactionId: txnId,
        orderId: match.id,
        orderNumber: match.orderNumber || match.id,
        amount: refundAmount,
      });
    } catch (err: any) {
      result.errors.push(`Failed to save refund ${txnId}: ${err.message}`);
    }
  }

  return result;
}

// ─── Fees ─────────────────────────────────────────────────────────────────────

/**
 * Sync PayPal transaction fees (from completed sales) to order_adjustments.
 * Mirrors the Stripe fee sync pattern exactly.
 */
export async function syncPayPalFees(sinceDays = 90): Promise<FeeSyncResult> {
  const result: FeeSyncResult = {
    transactionsChecked: 0,
    matched: 0,
    alreadySynced: 0,
    unmatched: 0,
    errors: [],
  };

  const allTransactions = await fetchAllPayPalTransactions(sinceDays);

  const saleTxns = allTransactions.filter(t =>
    SALE_EVENT_CODES.has(t.transaction_info.transaction_event_code) &&
    t.transaction_info.transaction_status === 'S' &&
    t.transaction_info.fee_amount
  );
  result.transactionsChecked = saleTxns.length;

  if (saleTxns.length === 0) return result;

  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const dbOrders = await db.select().from(orders).where(gte(orders.orderDate, sinceDate));

  const existingFees = await db
    .select({ externalTransactionId: orderAdjustments.externalTransactionId })
    .from(orderAdjustments)
    .where(and(
      eq(orderAdjustments.paymentMethod, 'paypal'),
      eq(orderAdjustments.type, 'merchant_fee'),
    ));

  const syncedFeeIds = new Set(
    existingFees.map(f => f.externalTransactionId).filter(Boolean) as string[]
  );

  for (const txn of saleTxns) {
    const info = txn.transaction_info;
    const txnId = info.transaction_id;
    const feeId = `${txnId}_fee`;

    if (syncedFeeIds.has(feeId)) {
      result.alreadySynced++;
      continue;
    }

    const feeAmount = parseAmount(info.fee_amount!.value);
    if (feeAmount === 0) continue;

    const saleAmount = parseAmount(info.transaction_amount.value);
    const txnDate = new Date(info.transaction_initiation_date);

    const match = dbOrders.find(order => {
      if (!order.orderTotal) return false;
      const orderTotal = Number(order.orderTotal);
      const orderDate = new Date(order.orderDate);
      if (Math.abs(orderTotal - saleAmount) > 0.01) return false;
      const daysDiff = (txnDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysDiff >= -7 && daysDiff <= 14;
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

      result.matched++;
    } catch (err: any) {
      result.errors.push(`Failed to save fee for txn ${txnId}: ${err.message}`);
    }
  }

  return result;
}

// ─── Combined wrapper (backwards compatible) ──────────────────────────────────

/**
 * Run both PayPal refund sync and fee sync.
 * This is the function called from the API route.
 */
export async function syncPayPalTransactions(sinceDays = 90, forceResync = false): Promise<PayPalSyncResult> {
  const [refundResult, feeResult] = await Promise.all([
    syncPayPalRefunds(sinceDays, forceResync),
    syncPayPalFees(sinceDays),
  ]);

  return {
    transactionsChecked: refundResult.refundsChecked + feeResult.transactionsChecked,
    refundsMatched: refundResult.matched,
    feesMatched: feeResult.matched,
    alreadySynced: refundResult.alreadySynced + feeResult.alreadySynced,
    unmatched: refundResult.unmatched + feeResult.unmatched,
    errors: [...refundResult.errors, ...feeResult.errors],
    matches: [
      ...refundResult.matches.map(m => ({ ...m, type: 'refund' as const })),
    ],
    unmatchedTransactions: refundResult.unmatchedTransactions.map(t => ({
      transactionId: t.transactionId,
      amount: t.amount,
      date: t.date,
      type: 'refund',
      eventCode: t.eventCode,
    })),
  };
}

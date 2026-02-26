export interface FinancialSyncResult {
  stripe: { success: boolean; skipped: boolean; refunds: number; fees: number; error: string | null };
  paypal: { success: boolean; skipped: boolean; refunds: number; fees: number; error: string | null };
}

export async function runFinancialSyncs(sinceDays = 90): Promise<FinancialSyncResult> {
  const result: FinancialSyncResult = {
    stripe: { success: false, skipped: false, refunds: 0, fees: 0, error: null },
    paypal: { success: false, skipped: false, refunds: 0, fees: 0, error: null },
  };

  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const { syncStripeRefunds, syncStripeFees } = await import('./stripe-refunds');
      const [refundRes, feeRes] = await Promise.all([
        syncStripeRefunds(sinceDays),
        syncStripeFees(sinceDays),
      ]);
      result.stripe.success = true;
      result.stripe.refunds = refundRes.matched;
      result.stripe.fees = feeRes.matched;
      console.log(`💳 Stripe: ${refundRes.matched} refunds, ${feeRes.matched} fees matched`);
    } catch (err: any) {
      result.stripe.error = err.message;
      console.error('❌ Stripe sync failed (non-fatal):', err.message);
    }
  } else {
    result.stripe.skipped = true;
  }

  if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
    try {
      const { syncPayPalTransactions } = await import('./paypal-sync');
      const ppRes = await syncPayPalTransactions(sinceDays);
      result.paypal.success = true;
      result.paypal.refunds = ppRes.refundsMatched;
      result.paypal.fees = ppRes.feesMatched;
      console.log(`🅿️ PayPal: ${ppRes.refundsMatched} refunds, ${ppRes.feesMatched} fees matched`);
    } catch (err: any) {
      result.paypal.error = err.message;
      console.error('❌ PayPal sync failed (non-fatal):', err.message);
    }
  } else {
    result.paypal.skipped = true;
  }

  return result;
}

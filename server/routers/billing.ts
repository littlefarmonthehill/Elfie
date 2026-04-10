import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { organizations, plans } from '@shared/schema';
import { isAuthenticated } from '../auth';
import { asyncRoute, reqOrgId } from '../lib/routeHelpers';
import { storage } from '../storage';
import { stripeClient, createCheckoutSession, createCheckoutSessionByPlan, createPortalSession, handleStripeWebhook, changePlan, setAutoRenew, cancelSubscriptionNow } from '../services/stripe';
import { checkBrickspotterLimit } from '../services/tierEnforcement';

const router = Router();
router.use(isAuthenticated);

// POST /api/billing/checkout
router.post('/checkout', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { plan, interval, planId, context } = req.body;

  if (planId !== undefined) {
    const [dbPlan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    if (!dbPlan || dbPlan.status !== 'live') {
      return res.status(400).json({ message: "Invalid or unavailable plan" });
    }
    if (dbPlan.isDefault) {
      await storage.updateOrganization(orgId, {
        plan: dbPlan.name,
        planId: dbPlan.id,
        subscriptionStatus: 'active',
        trialEndsAt: null,
      });
      const isOnboarding = context === 'onboarding' || context === 'plan_expired';
      const redirect = isOnboarding ? `/?subscribed=true&plan=${dbPlan.id}` : `/settings?tab=billing`;
      return res.json({ success: true, redirect });
    }
    const isOnboarding = context === 'onboarding' || context === 'plan_expired';
    const successUrl = isOnboarding
      ? `${req.protocol}://${req.get('host')}/?subscribed=true&plan=${dbPlan.id}`
      : `${req.protocol}://${req.get('host')}/settings?tab=billing&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = isOnboarding
      ? `${req.protocol}://${req.get('host')}/`
      : `${req.protocol}://${req.get('host')}/settings?tab=billing`;
    const session = await createCheckoutSessionByPlan(orgId, dbPlan, successUrl, cancelUrl);
    return res.json({ url: session.url });
  }

  if (!['foundation', 'core'].includes(plan)) return res.status(400).json({ message: "Invalid plan" });
  if (!['monthly', 'annual'].includes(interval)) return res.status(400).json({ message: "Invalid interval" });
  const isOnboarding = context === 'onboarding';
  const successUrl = isOnboarding
    ? `${req.protocol}://${req.get('host')}/?subscribed=true&plan=${plan}`
    : `${req.protocol}://${req.get('host')}/settings?tab=billing&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = isOnboarding
    ? `${req.protocol}://${req.get('host')}/`
    : `${req.protocol}://${req.get('host')}/settings?tab=billing`;
  const session = await createCheckoutSession(orgId, plan, interval, successUrl, cancelUrl);
  res.json({ url: session.url });
}));

// POST /api/billing/portal
router.post('/portal', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const returnUrl = `${req.protocol}://${req.get('host')}/settings?tab=billing`;
  const session = await createPortalSession(orgId, returnUrl);
  res.json({ url: session.url });
}));

// GET /api/billing/status
router.get('/status', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const org = await storage.getOrganization(orgId);
  if (!org) return res.status(404).json({ message: "Organization not found" });
  const brickspotterCheck = await checkBrickspotterLimit(orgId);
  let planSunsetAt: string | null = null;
  let planStatus: string | null = null;
  let planName: string | null = null;
  if (org.planId) {
    const [planRow] = await db.select({ name: plans.name, status: plans.status, sunsetAt: plans.sunsetAt })
      .from(plans).where(eq(plans.id, org.planId)).limit(1);
    if (planRow) {
      planName = planRow.name;
      planStatus = planRow.status;
      planSunsetAt = planRow.sunsetAt ? planRow.sunsetAt.toISOString() : null;
    }
  }
  res.json({
    plan: org.plan,
    planName: planName ?? org.plan,
    status: org.subscriptionStatus,
    interval: org.subscriptionInterval,
    hasStripeCustomer: !!org.stripeCustomerId,
    hasActiveSubscription: !!org.stripeSubscriptionId,
    trialEndsAt: org.trialEndsAt ?? null,
    subscriptionEndsAt: org.subscriptionEndsAt ?? null,
    cancelAtPeriodEnd: org.cancelAtPeriodEnd ?? false,
    planStatus,
    planSunsetAt,
    brickspotter: {
      scansUsed: brickspotterCheck.scansUsed ?? 0,
      scansLimit: brickspotterCheck.scansLimit ?? -1,
      apiCallLimit: brickspotterCheck.apiCallLimit ?? 0,
      brickspotterOnly: brickspotterCheck.isBrickspotterOnly ?? false,
    },
  });
}));

// GET /api/billing/payments
router.get('/payments', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return res.status(404).json({ error: 'Not found' });
  if (!org.stripeCustomerId) return res.json({ payments: [] });
  const stripe = stripeClient.getClient();
  const invoices = await stripe.invoices.list({ customer: org.stripeCustomerId, limit: 50 });
  const payments = invoices.data.map(inv => ({
    id: inv.id,
    amount: inv.amount_paid,
    currency: inv.currency,
    status: inv.status,
    description: inv.description || inv.lines.data[0]?.description || null,
    periodStart: inv.period_start,
    periodEnd: inv.period_end,
    created: inv.created,
    hostedUrl: inv.hosted_invoice_url,
    pdfUrl: inv.invoice_pdf,
  }));
  res.json({ payments });
}));

// POST /api/billing/webhook — Stripe signature verification, no auth middleware
router.post('/webhook', (req: any, res: any) => {
  const sig = req.headers['stripe-signature'] as string;
  handleStripeWebhook((req as any).rawBody || req.body, sig)
    .then(() => res.json({ received: true }))
    .catch((err: any) => {
      console.error("Webhook error:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    });
});

// POST /api/billing/change-plan
router.post('/change-plan', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { plan, interval } = req.body;
  if (!['foundation', 'core'].includes(plan)) return res.status(400).json({ message: "Invalid plan" });
  if (!['monthly', 'annual'].includes(interval)) return res.status(400).json({ message: "Invalid interval" });
  const result = await changePlan(orgId, plan, interval);
  res.json(result);
}));

// PATCH /api/billing/auto-renew
router.patch('/auto-renew', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { autoRenew } = req.body;
  if (typeof autoRenew !== 'boolean') return res.status(400).json({ message: "autoRenew must be a boolean" });
  const result = await setAutoRenew(orgId, autoRenew);
  res.json(result);
}));

// DELETE /api/billing/subscription
router.delete('/subscription', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const result = await cancelSubscriptionNow(orgId);
  res.json(result);
}));

export default router;

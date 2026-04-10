import Stripe from "stripe";
import { db } from "../db";
import { organizations, plans } from "@shared/schema";
import type { Plan } from "@shared/schema";
import { eq } from "drizzle-orm";

// Cached at startup by initStripeKey() called from server/index.ts
let _stripeSecretKey: string | null = null;

export function initStripeKey(key: string): void {
  _stripeSecretKey = key;
}

function getStripeClient(): Stripe {
  const key = _stripeSecretKey;
  if (!key) {
    throw new Error("Stripe secret key is not configured. Add it in Platform Settings.");
  }
  return new Stripe(key, {
    apiVersion: "2026-02-25.clover",
  });
}

export const stripeClient = { getClient: getStripeClient };

function getPriceId(plan: string, interval: string): string {
  if (interval === "monthly") {
    if (plan === "core") return process.env.STRIPE_CORE_MONTHLY_PRICE_ID!;
    if (plan === "foundation") return process.env.STRIPE_FOUNDATION_MONTHLY_PRICE_ID!;
  } else {
    if (plan === "core") return process.env.STRIPE_CORE_ANNUAL_PRICE_ID!;
    if (plan === "foundation") return process.env.STRIPE_FOUNDATION_ANNUAL_PRICE_ID!;
  }
  throw new Error(`Unknown plan/interval: ${plan}/${interval}`);
}

export async function createCheckoutSession(orgId: string, plan: string, interval: "monthly" | "annual", successUrl: string, cancelUrl: string) {
  const stripe = getStripeClient();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) throw new Error("Organization not found");

  const priceId = getPriceId(plan, interval);

  // Include a free trial period if the billing plan specifies one
  const trialDays = org.planId
    ? (await db.select({ d: plans.trialDurationDays }).from(plans).where(eq(plans.id, org.planId)).limit(1))[0]?.d ?? 0
    : 0;

  const session = await stripe.checkout.sessions.create({
    customer: org.stripeCustomerId || undefined,
    payment_method_types: ["card"],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: "subscription",
    subscription_data: trialDays > 0 ? { trial_period_days: trialDays } : undefined,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      orgId,
      plan,
      interval,
    },
  });

  return session;
}

// Creates a checkout session using a plan from the plans table (dynamic pricing model)
export async function createCheckoutSessionByPlan(orgId: string, plan: Plan, successUrl: string, cancelUrl: string) {
  const stripe = getStripeClient();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) throw new Error("Organization not found");

  const session = await stripe.checkout.sessions.create({
    customer: org.stripeCustomerId || undefined,
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: plan.name },
          unit_amount: plan.basePrice,
          recurring: { interval: "month" },
        },
        quantity: 1,
      },
    ],
    mode: "subscription",
    subscription_data: (plan.trialDurationDays ?? 0) > 0 ? { trial_period_days: plan.trialDurationDays } : undefined,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      orgId,
      planId: String(plan.id),
      plan: plan.name,
    },
  });

  return session;
}

export async function createPortalSession(orgId: string, returnUrl: string) {
  const stripe = getStripeClient();
  const [org] = await db.select({ stripeCustomerId: organizations.stripeCustomerId }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org?.stripeCustomerId) throw new Error("No Stripe customer found for this organization");

  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: returnUrl,
  });

  return session;
}

export async function changePlan(orgId: string, newPlan: string, newInterval: string) {
  const stripe = getStripeClient();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) throw new Error("Organization not found");
  if (!org.stripeSubscriptionId) throw new Error("No active subscription found. Use checkout to start a subscription.");

  const newPriceId = getPriceId(newPlan, newInterval);
  const subscription = await stripe.subscriptions.retrieve(org.stripeSubscriptionId);
  const itemId = subscription.items.data[0]?.id;
  if (!itemId) throw new Error("Subscription has no items");

  await stripe.subscriptions.update(org.stripeSubscriptionId, {
    items: [{ id: itemId, price: newPriceId }],
    metadata: { plan: newPlan, interval: newInterval },
    proration_behavior: "create_prorations",
  });

  return { success: true };
}

export async function setAutoRenew(orgId: string, autoRenew: boolean) {
  const stripe = getStripeClient();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) throw new Error("Organization not found");
  if (!org.stripeSubscriptionId) throw new Error("No active subscription found");

  const cancelAtPeriodEnd = !autoRenew;
  await stripe.subscriptions.update(org.stripeSubscriptionId, {
    cancel_at_period_end: cancelAtPeriodEnd,
  });

  await db.update(organizations)
    .set({ cancelAtPeriodEnd, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  return { autoRenew, cancelAtPeriodEnd };
}

export async function cancelSubscriptionNow(orgId: string) {
  const stripe = getStripeClient();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) throw new Error("Organization not found");
  if (!org.stripeSubscriptionId) throw new Error("No active subscription found");

  await stripe.subscriptions.cancel(org.stripeSubscriptionId);
  return { success: true };
}

export async function handleStripeWebhook(payload: string, sig: string) {
  const stripe = getStripeClient();
  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch (err: any) {
    throw new Error(`Webhook Error: ${err.message}`);
  }

  const subscription = event.data.object as Stripe.Subscription;
  const stripeSubscriptionId = subscription.id;
  const stripeCustomerId = subscription.customer as string;
  const status = subscription.status;

  // Find org by stripeCustomerId or metadata
  let [org] = await db.select().from(organizations).where(eq(organizations.stripeCustomerId, stripeCustomerId)).limit(1);
  
  if (!org) {
     const orgId = subscription.metadata.orgId;
     if (orgId) {
        [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
     }
  }

  if (!org) return;

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      const plan = subscription.metadata.plan || org.plan;
      const interval = subscription.items.data[0].price.recurring?.interval === "year" ? "annual" : "monthly";
      const cancelAtPeriodEnd = subscription.cancel_at_period_end ?? false;
      
      const periodEnd = (subscription as any).current_period_end
        ? new Date((subscription as any).current_period_end * 1000)
        : null;
      await db.update(organizations).set({
        stripeSubscriptionId,
        stripeCustomerId,
        subscriptionStatus: status === "active" ? "active" : (status === "trialing" ? "trial" : "past_due"),
        plan: plan as any,
        subscriptionInterval: interval,
        subscriptionEndsAt: periodEnd,
        cancelAtPeriodEnd,
        updatedAt: new Date(),
      }).where(eq(organizations.id, org.id));
      break;

    case "customer.subscription.deleted":
      await db.update(organizations).set({
        stripeSubscriptionId: null,
        subscriptionStatus: "canceled",
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      }).where(eq(organizations.id, org.id));
      break;
  }
}

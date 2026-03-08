import Stripe from "stripe";
import { db } from "../db";
import { organizations } from "@shared/schema";
import { eq } from "drizzle-orm";

function getStripeClient(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured. Please add your Stripe secret key to connect billing.");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-01-27-ac.0",
  });
}

export const stripeClient = { getClient: getStripeClient };

export async function createCheckoutSession(orgId: string, plan: string, interval: "monthly" | "annual", successUrl: string, cancelUrl: string) {
  const stripe = getStripeClient();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) throw new Error("Organization not found");

  const priceId = interval === "monthly" 
    ? (plan === "core" ? process.env.STRIPE_CORE_MONTHLY_PRICE_ID : process.env.STRIPE_FOUNDATION_MONTHLY_PRICE_ID)
    : (plan === "core" ? process.env.STRIPE_CORE_ANNUAL_PRICE_ID : process.env.STRIPE_FOUNDATION_ANNUAL_PRICE_ID);

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
      
      const periodEnd = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null;
      await db.update(organizations).set({
        stripeSubscriptionId,
        stripeCustomerId,
        subscriptionStatus: status === "active" ? "active" : (status === "trialing" ? "trial" : "past_due"),
        plan: plan as any,
        subscriptionInterval: interval,
        subscriptionEndsAt: periodEnd,
        updatedAt: new Date(),
      }).where(eq(organizations.id, org.id));
      break;

    case "customer.subscription.deleted":
      await db.update(organizations).set({
        stripeSubscriptionId: null,
        subscriptionStatus: "canceled",
        updatedAt: new Date(),
      }).where(eq(organizations.id, org.id));
      break;
  }
}

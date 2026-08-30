import webpush from 'web-push';
import { db } from '../db';
import { pushSubscriptions } from '@shared/schema';
import { eq } from 'drizzle-orm';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@planetbrick.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const ELFIE_ALL_MESSAGES = [
  (count: number, ids: string[]) =>
    count === 1
      ? `Commander! 1 new mission just dropped — ${ids[0]} is locked and loaded. Time to gear up!`
      : count <= 3
      ? `Commander! ${count} new orders have entered the hangar — ${ids.slice(0, 2).join(', ')}${count > 2 ? ' and more' : ''} are ready for action!`
      : `Commander! ${count} new orders just swarmed the base. The warehouse calls — it's brick o'clock!`,
  (count: number, ids: string[]) =>
    count === 1
      ? `New order detected, Commander. ${ids[0]} is in the queue and awaiting your move.`
      : count <= 3
      ? `${count} new orders just landed on PlanetBrick — ${ids.slice(0, 2).join(', ')}${count > 2 ? ' and more' : ''}. Your pick station awaits.`
      : `${count} orders incoming, Commander. The brick vault is calling — deploy your finest sorting skills!`,
  (count: number, ids: string[]) =>
    count === 1
      ? `Incoming order, Commander! ${ids[0]} just hit the system. E.L.F.I.E. standing by for pick.`
      : count <= 3
      ? `E.L.F.I.E. scanning new orders: ${ids.slice(0, 2).join(', ')}${count > 2 ? ' + more' : ''}. All systems go, Commander.`
      : `${count} new orders in the queue, Commander. Time to unleash the brickforce!`,
  (count: number, ids: string[]) =>
    count === 1
      ? `Order ${ids[0]} has cleared the launchpad, Commander. Fulfillment window is open!`
      : `New batch alert! ${count} order${count > 1 ? 's' : ''} cleared for pick — ${ids.slice(0, 2).join(', ')}${count > 2 ? ' and more' : ''}. PlanetBrick ops center is live.`,
];

const ELFIE_PRIORITY_MESSAGES = [
  (count: number, ids: string[]) =>
    count === 1
      ? `PRIORITY ALERT! ${ids[0]} needs warp-speed fulfillment, Commander. Express lane engaged!`
      : `PRIORITY ALERT! ${count} express orders are incoming — ${ids.slice(0, 2).join(', ')}${count > 2 ? ' and more' : ''}. Full thrusters, Commander!`,
  (count: number, ids: string[]) =>
    count === 1
      ? `Commander, ${ids[0]} is priority-flagged. E.L.F.I.E. recommends immediate deployment!`
      : `${count} priority orders detected, Commander — ${ids.slice(0, 2).join(', ')}${count > 2 ? ' and more' : ''}. The express dock is yours.`,
];

function pickMessage(templates: ((c: number, ids: string[]) => string)[], count: number, ids: string[]) {
  return templates[Math.floor(Math.random() * templates.length)](count, ids);
}

export interface PushNotificationDeliverySummary {
  attempted: number;
  sent: number;
  failed: number;
  stale: number;
}

function emptyDeliverySummary(): PushNotificationDeliverySummary {
  return { attempted: 0, sent: 0, failed: 0, stale: 0 };
}

function safePushFailureDetails(error: unknown): string {
  const err = error as { statusCode?: unknown; code?: unknown };
  const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : null;
  const code = typeof err?.code === 'string' && /^[A-Z0-9_-]+$/i.test(err.code)
    ? err.code
    : null;
  return [statusCode != null ? `status=${statusCode}` : null, code ? `code=${code}` : null]
    .filter(Boolean)
    .join(' ') || 'status=unknown';
}

export async function sendOrderSyncNotifications(
  orgId: string,
  allNewOrders: { orderNumber: string; shippingTier?: string | null }[]
): Promise<PushNotificationDeliverySummary> {
  const summary = emptyDeliverySummary();
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.info(`[Push] order-sync org=${orgId} skipped=missing-vapid`);
    return summary;
  }
  if (allNewOrders.length === 0) return summary;

  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.orgId, orgId));
  if (subs.length === 0) {
    console.info(`[Push] order-sync org=${orgId} skipped=no-subscriptions`);
    return summary;
  }

  const allIds = allNewOrders.map((o) => o.orderNumber);
  const priorityOrders = allNewOrders.filter(
    (o) => o.shippingTier && ['EXPRESS', 'PRIORITY'].includes(o.shippingTier.toUpperCase())
  );
  const priorityIds = priorityOrders.map((o) => o.orderNumber);

  const staleEndpoints = new Set<number>();

  const sendToSubscription = async (
    subscriptionId: number,
    notificationType: 'all-orders' | 'priority',
    pushSub: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: object,
  ) => {
    summary.attempted++;
    try {
      await webpush.sendNotification(pushSub, JSON.stringify(payload));
      summary.sent++;
      console.info(`[Push] order-sync org=${orgId} subscription=${subscriptionId} type=${notificationType} result=sent`);
    } catch (error: unknown) {
      summary.failed++;
      const statusCode = (error as { statusCode?: unknown })?.statusCode;
      if (statusCode === 410 || statusCode === 404) staleEndpoints.add(subscriptionId);
      // Intentionally do not include endpoint URLs, subscription keys, or an
      // arbitrary provider error message in logs.
      console.warn(`[Push] order-sync org=${orgId} subscription=${subscriptionId} type=${notificationType} result=failed ${safePushFailureDetails(error)}`);
    }
  };

  for (const sub of subs) {
    const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };

    // All orders notification
    if (sub.notifyAllOrders && allNewOrders.length > 0) {
      await sendToSubscription(sub.id, 'all-orders', pushSub, {
        title: 'E.L.F.I.E. · New Orders Incoming!',
        body: pickMessage(ELFIE_ALL_MESSAGES, allNewOrders.length, allIds),
        tag: 'elfie-all-orders',
        url: '/',
      });
    }

    // Priority-only notification (only if there are priority orders AND all-orders is off, or always if priority-only is on)
    if (sub.notifyPriorityOrders && priorityOrders.length > 0 && !sub.notifyAllOrders) {
      await sendToSubscription(sub.id, 'priority', pushSub, {
        title: 'E.L.F.I.E. · Priority Alert!',
        body: pickMessage(ELFIE_PRIORITY_MESSAGES, priorityOrders.length, priorityIds),
        tag: 'elfie-priority-orders',
        url: '/',
      });
    }
  }

  // Clean up dead subscriptions
  for (const id of staleEndpoints) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }
  summary.stale = staleEndpoints.size;
  return summary;
}

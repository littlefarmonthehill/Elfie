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
      ? `Commander! 1 new mission just dropped — ${ids[0]} is locked and loaded. Time to gear up! 🧱`
      : count <= 3
      ? `Commander! ${count} new orders have entered the hangar — ${ids.slice(0, 2).join(', ')}${count > 2 ? ' and more' : ''} are ready for action! 🧱`
      : `Commander! ${count} new orders just swarmed the base. The warehouse calls — it's brick o'clock! 🧱`,
];

const ELFIE_PRIORITY_MESSAGES = [
  (count: number, ids: string[]) =>
    count === 1
      ? `🚨 PRIORITY ALERT! ${ids[0]} needs warp-speed fulfillment, Commander. Express lane engaged!`
      : `🚨 PRIORITY ALERT! ${count} express orders are incoming — ${ids.slice(0, 2).join(', ')}${count > 2 ? ' and more' : ''}. Full thrusters, Commander!`,
];

function pickMessage(templates: ((c: number, ids: string[]) => string)[], count: number, ids: string[]) {
  return templates[Math.floor(Math.random() * templates.length)](count, ids);
}

export async function sendOrderSyncNotifications(
  orgId: string,
  allNewOrders: { orderNumber: string; shippingTier?: string | null }[]
) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  if (allNewOrders.length === 0) return;

  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.orgId, orgId));
  if (subs.length === 0) return;

  const allIds = allNewOrders.map((o) => o.orderNumber);
  const priorityOrders = allNewOrders.filter(
    (o) => o.shippingTier && ['EXPRESS', 'PRIORITY'].includes(o.shippingTier.toUpperCase())
  );
  const priorityIds = priorityOrders.map((o) => o.orderNumber);

  const staleEndpoints: number[] = [];

  for (const sub of subs) {
    const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };

    // All orders notification
    if (sub.notifyAllOrders && allNewOrders.length > 0) {
      try {
        await webpush.sendNotification(
          pushSub,
          JSON.stringify({
            title: 'E.L.F.I.E. · New Orders Incoming!',
            body: pickMessage(ELFIE_ALL_MESSAGES, allNewOrders.length, allIds),
            tag: 'elfie-all-orders',
            url: '/',
          })
        );
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) staleEndpoints.push(sub.id);
      }
    }

    // Priority-only notification (only if there are priority orders AND all-orders is off, or always if priority-only is on)
    if (sub.notifyPriorityOrders && priorityOrders.length > 0 && !sub.notifyAllOrders) {
      try {
        await webpush.sendNotification(
          pushSub,
          JSON.stringify({
            title: 'E.L.F.I.E. · Priority Alert!',
            body: pickMessage(ELFIE_PRIORITY_MESSAGES, priorityOrders.length, priorityIds),
            tag: 'elfie-priority-orders',
            url: '/',
          })
        );
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) staleEndpoints.push(sub.id);
      }
    }
  }

  // Clean up dead subscriptions
  for (const id of staleEndpoints) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }
}

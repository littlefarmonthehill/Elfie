/**
 * Automatic tracking status refresh for active shipments.
 * Called by the order sync scheduler after each successful sync so users
 * see up-to-date carrier status when they open the Shipments view.
 */

import { db } from "../db";
import { shipments } from "@shared/schema";
import { eq, and, isNotNull, ne } from "drizzle-orm";

const STALE_AFTER_MS = 30 * 60 * 1000; // 30 minutes

export async function refreshActiveTrackingForOrg(orgId: string): Promise<void> {
  // Find all active (non-delivered) shipments that have a tracking number and are stale
  const rows = await db
    .select({
      id: shipments.id,
      orderId: shipments.orderId,
      trackingNumber: shipments.trackingNumber,
      carrier: shipments.carrier,
      trackerId: shipments.trackerId,
      trackingStatus: shipments.trackingStatus,
      trackingUpdatedAt: shipments.trackingUpdatedAt,
    })
    .from(shipments)
    .where(and(
      eq(shipments.orgId, orgId),
      eq(shipments.status, 'purchased'),
      isNotNull(shipments.trackingNumber),
      ne(shipments.trackingStatus as any, 'delivered'),
    ));

  if (rows.length === 0) return;

  // Filter to only stale entries (not updated in the last 30 min)
  const now = Date.now();
  const stale = rows.filter(r => {
    if (!r.trackingUpdatedAt) return true;
    return now - new Date(r.trackingUpdatedAt).getTime() > STALE_AFTER_MS;
  });

  if (stale.length === 0) return;

  let vendor: any;
  try {
    const { getShippingVendor } = await import('./easypost');
    vendor = await getShippingVendor(undefined, orgId);
  } catch {
    // EasyPost not configured for this org — silently skip
    return;
  }

  let refreshed = 0;
  for (const row of stale) {
    try {
      let tracker: { id: string; status: string; statusDetail: string };
      if (row.trackerId) {
        tracker = await vendor.getTracker(row.trackerId);
      } else {
        tracker = await vendor.createOrGetTracker(row.trackingNumber, row.carrier);
      }

      await db.update(shipments)
        .set({
          trackerId: tracker.id,
          trackingStatus: tracker.status,
          trackingStatusDetail: tracker.statusDetail,
          trackingUpdatedAt: new Date(),
        })
        .where(eq(shipments.id, row.id));

      refreshed++;
    } catch (e: any) {
      console.warn(`[TrackingRefresh] Failed for ${row.trackingNumber}: ${e.message}`);
    }
  }

  if (refreshed > 0) {
    console.log(`[TrackingRefresh] Updated ${refreshed}/${stale.length} active shipments for org ${orgId}`);
  }
}

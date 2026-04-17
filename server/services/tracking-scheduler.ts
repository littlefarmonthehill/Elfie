/**
 * Background tracking refresh scheduler.
 * Runs every 30 minutes in production to update tracking statuses
 * for all non-delivered shipments that have a tracking number.
 */

import { db } from "../db";
import { shipments } from "@shared/schema";
import { and, eq, inArray, isNotNull, ne, or, isNull } from "drizzle-orm";

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const BATCH_SIZE  = 50;              // max shipments per run

async function runTrackingRefresh() {
  try {
    const rows = await db
      .select({
        id:                shipments.id,
        orgId:             shipments.orgId,
        orderId:           shipments.orderId,
        trackingNumber:    shipments.trackingNumber,
        carrier:           shipments.carrier,
        trackerId:         shipments.trackerId,
        trackingStatus:    shipments.trackingStatus,
        trackingUpdatedAt: shipments.trackingUpdatedAt,
      })
      .from(shipments)
      .where(and(
        isNotNull(shipments.trackingNumber),
        inArray(shipments.status, ['purchased', 'manifested']),
        or(
          isNull(shipments.trackingStatus),
          ne(shipments.trackingStatus, 'delivered'),
        ),
      ))
      .limit(BATCH_SIZE);

    if (rows.length === 0) return;

    let vendor: any;
    try {
      const { getShippingVendor } = await import('./easypost');
      vendor = await getShippingVendor();
    } catch {
      return;
    }

    let updated = 0;
    for (const row of rows) {
      try {
        let tracker: { id: string; status: string; statusDetail: string };
        if (row.trackerId) {
          tracker = await vendor.getTracker(row.trackerId);
        } else {
          tracker = await vendor.createOrGetTracker(row.trackingNumber!, row.carrier);
        }
        await db
          .update(shipments)
          .set({
            trackerId:           tracker.id,
            trackingStatus:      tracker.status,
            trackingStatusDetail: tracker.statusDetail,
            trackingUpdatedAt:   new Date(),
          })
          .where(eq(shipments.id, row.id));
        updated++;
      } catch {
        // Skip individual failures — other shipments should still be processed
      }
    }

    if (updated > 0) {
      console.log(`[TrackingScheduler] Refreshed ${updated}/${rows.length} shipment(s).`);
    }
  } catch (err: any) {
    console.warn(`[TrackingScheduler] Run failed:`, err.message);
  }
}

export function startTrackingScheduler() {
  // Stagger 5 minutes after startup to avoid hammering EasyPost on boot
  const initial = setTimeout(() => {
    runTrackingRefresh();
    setInterval(runTrackingRefresh, INTERVAL_MS);
  }, 5 * 60 * 1000);

  // Prevent the timer from keeping Node alive if the process is exiting
  if (initial.unref) initial.unref();
  console.log('[TrackingScheduler] Started — will refresh every 30 min.');
}

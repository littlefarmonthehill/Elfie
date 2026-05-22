/**
 * EasyPost webhook receiver.
 *
 * EasyPost posts tracker.* events here whenever a carrier reports a new
 * status (in_transit, out_for_delivery, delivered, etc.). This bypasses the
 * 30-minute polling stale window so the UI reflects carrier reality within
 * seconds.
 *
 * Setup (one-time, per EasyPost account):
 *   1. Add a Replit secret: EASYPOST_WEBHOOK_SECRET=<a long random string>
 *   2. In EasyPost dashboard → Account Settings → Webhooks, add:
 *        URL:    https://<your-prod-domain>/api/easypost/webhook
 *        Secret: <same value as EASYPOST_WEBHOOK_SECRET>
 *   3. Subscribe to "Tracker" events.
 *
 * Without the secret the endpoint refuses to process any request (503), so the
 * secret MUST be configured before EasyPost can deliver events successfully.
 */

import { Router } from "express";
import crypto from "crypto";
import { db } from "../db";
import { shipments } from "@shared/schema";
import { and, eq, isNull, notInArray, or } from "drizzle-orm";

const router = Router();

// Terminal states: once a shipment reaches one of these, an out-of-order webhook
// must not regress it back to in_transit / pre_transit. EasyPost very occasionally
// delivers events out of order, especially when retrying after a previous failure.
const TERMINAL_STATUSES = ["delivered", "return_to_sender", "failure", "error", "cancelled"];

function verifySignature(rawBody: Buffer | undefined, headerSig: string | undefined, secret: string): boolean {
  if (!rawBody || typeof headerSig !== "string") return false;
  // Accept "sha256=..." prefixed signatures and normalise whitespace/case.
  const normalised = headerSig.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalised)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(normalised, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

router.post("/easypost/webhook", async (req: any, res) => {
  const secret = process.env.EASYPOST_WEBHOOK_SECRET;
  // Fail-closed: without a configured secret we cannot trust any caller, so refuse
  // to mutate state. Operators must set EASYPOST_WEBHOOK_SECRET in Replit secrets
  // and the matching value in the EasyPost dashboard.
  if (!secret) {
    console.error("[EasyPostWebhook] EASYPOST_WEBHOOK_SECRET not set — refusing to process webhook");
    return res.status(503).json({ error: "webhook not configured" });
  }

  const sig = (req.headers["x-hmac-signature"] || req.headers["X-Hmac-Signature"]) as string | undefined;
  if (!verifySignature(req.rawBody, sig, secret)) {
    console.warn("[EasyPostWebhook] Signature verification failed — rejecting request");
    return res.status(401).json({ error: "invalid signature" });
  }

  const event = req.body;
  // Accept both wrapped ({ description, result }) and bare-tracker payloads.
  const description: string = event?.description || event?.object || "";
  const tracker = event?.result?.object === "Tracker"
    ? event.result
    : event?.object === "Tracker"
      ? event
      : null;

  // Always 200 OK after this point so EasyPost doesn't retry indefinitely for events we don't care about.
  if (!tracker || !tracker.id) {
    return res.json({ ok: true, ignored: true, reason: "no tracker in payload" });
  }
  if (description && !description.startsWith("tracker.")) {
    return res.json({ ok: true, ignored: true, reason: `event ${description}` });
  }

  try {
    // Build the WHERE clause:
    //   - always match by tracker_id
    //   - if the incoming status is NOT itself a terminal state, skip rows that
    //     are already in a terminal state (prevents out-of-order webhook events
    //     from regressing a delivered shipment back to in_transit).
    const incomingIsTerminal = TERMINAL_STATUSES.includes(tracker.status ?? "");
    // NOTE: `NOT IN (...)` in SQL evaluates to NULL (falsy) for rows where the
    // column itself is NULL, which would silently skip brand-new shipments that
    // haven't received any tracking status yet. Explicitly allow NULL rows.
    const where = incomingIsTerminal
      ? eq(shipments.trackerId, tracker.id)
      : and(
          eq(shipments.trackerId, tracker.id),
          or(
            isNull(shipments.trackingStatus),
            notInArray(shipments.trackingStatus, TERMINAL_STATUSES),
          ),
        );

    const result = await db
      .update(shipments)
      .set({
        trackingStatus: tracker.status ?? null,
        trackingStatusDetail: tracker.status_detail ?? null,
        trackingUpdatedAt: new Date(),
      })
      .where(where)
      .returning({ id: shipments.id, orgId: shipments.orgId });

    if (result.length === 0) {
      // Tracker we've never seen — common during testing or if a tracker was created
      // outside our system. Acknowledge but don't error.
      console.log(`[EasyPostWebhook] No shipment matched tracker ${tracker.id} (status=${tracker.status})`);
      return res.json({ ok: true, matched: 0 });
    }

    console.log(
      `[EasyPostWebhook] ${tracker.id} → ${tracker.status} (${tracker.status_detail || "n/a"}) — updated ${result.length} shipment(s) for org ${result[0].orgId}`,
    );
    return res.json({ ok: true, matched: result.length });
  } catch (e: any) {
    console.error(`[EasyPostWebhook] Failed to update shipment for tracker ${tracker.id}: ${e.message}`);
    return res.status(500).json({ error: "update failed" });
  }
});

export default router;

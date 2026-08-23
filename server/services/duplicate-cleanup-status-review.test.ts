import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveBrickLinkSourceOrderId,
  normalizeBrickLinkStatusEvidence,
} from "./duplicate-cleanup-status-review";

test("uses the canonical local ID/key pair, never the displayed order number, for BrickLink evidence", () => {
  assert.equal(deriveBrickLinkSourceOrderId({
    id: "bl-12345",
    orderKey: "BL.12345",
  }), "12345");
  assert.equal(deriveBrickLinkSourceOrderId({
    id: "legacy-row",
    orderKey: "BL.12345",
  }), null);
  assert.equal(deriveBrickLinkSourceOrderId({
    id: "bl-12345",
    orderKey: "not-the-source-key",
  }), null);
});

test("treats BrickLink payment returns as authoritative over its completed order status", () => {
  const evidence = normalizeBrickLinkStatusEvidence("12345", {
    order_id: 12345,
    status: "COMPLETED",
    payment: { status: "Returned" },
  }, new Date("2026-03-25T19:35:00.000Z"));

  assert.equal(evidence.normalizedStatus, "returned");
  assert.equal(evidence.sourceStatus, "COMPLETED");
  assert.equal(evidence.paymentStatus, "Returned");
});

test("rejects marketplace records that contain no status evidence", () => {
  assert.throws(
    () => normalizeBrickLinkStatusEvidence("12345", { order_id: 12345 }),
    /did not return a status/i,
  );
});

test("rejects a marketplace response whose immutable order ID differs from the requested source", () => {
  assert.throws(
    () => normalizeBrickLinkStatusEvidence("12345", {
      order_id: 99999,
      status: "PURGED",
    }),
    /requested immutable source order/i,
  );
});
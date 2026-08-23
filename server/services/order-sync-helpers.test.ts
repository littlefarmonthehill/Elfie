import assert from "node:assert/strict";
import test from "node:test";
import { compareDuplicateOrderRecords } from "./order-sync-helpers";

const matchingOrders = {
  duplicate: {
    orderKey: "source-order-42",
    source: "BrickLink",
    orderDate: "2026-01-02T03:04:05.000Z",
    orderTotal: "18.50",
  },
  canonical: {
    orderKey: "source-order-42",
    source: "bricklink",
    orderDate: new Date("2026-01-02T03:04:05.000Z"),
    orderTotal: 18.5,
  },
  duplicateIsSplit: false,
  canonicalIsSplit: false,
  hasReusedOrderNumber: false,
};

test("only permits archival when every required order comparison agrees", () => {
  const result = compareDuplicateOrderRecords(matchingOrders);

  assert.equal(result.isSafe, true);
  assert.ok(result.safeReason);
  assert.deepEqual(result.reasons, []);
});

test("refuses a legacy candidate without a matching order key", () => {
  const result = compareDuplicateOrderRecords({
    ...matchingOrders,
    canonical: { ...matchingOrders.canonical, orderKey: "other-source-order" },
  });

  assert.equal(result.isSafe, false);
  assert.deepEqual(result.reasons, ["order key is missing or does not match"]);
});

test("refuses split and reused-number candidates even when the other fields match", () => {
  const result = compareDuplicateOrderRecords({
    ...matchingOrders,
    duplicateIsSplit: true,
    hasReusedOrderNumber: true,
  });

  assert.equal(result.isSafe, false);
  assert.deepEqual(result.reasons, [
    "one of the orders is a split or reship record",
    "the legacy order number is reused by another order",
  ]);
});

test("refuses source, date, and total mismatches independently", () => {
  const result = compareDuplicateOrderRecords({
    ...matchingOrders,
    canonical: {
      ...matchingOrders.canonical,
      source: "eBay",
      orderDate: "2026-01-03T03:04:05.000Z",
      orderTotal: "18.51",
    },
  });

  assert.equal(result.isSafe, false);
  assert.deepEqual(result.reasons, [
    "source marketplace is missing or does not match",
    "order date is missing or does not match",
    "order total is missing or does not match",
  ]);
});
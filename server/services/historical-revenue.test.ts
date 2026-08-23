import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateLineRevenue,
  calculateOrderRevenue,
  isRevenueEligible,
} from "./historical-revenue";

test("uses the same status and test exclusions as order revenue reporting", () => {
  assert.equal(isRevenueEligible({ orderStatus: "shipped", isTest: false }), true);
  assert.equal(isRevenueEligible({ orderStatus: "Returned", isTest: false }), false);
  assert.equal(isRevenueEligible({ orderStatus: "CANCELLED", isTest: false }), false);
  assert.equal(isRevenueEligible({ orderStatus: "purged", isTest: false }), true);
  assert.equal(isRevenueEligible({ orderStatus: "shipped", isTest: true }), false);
});

test("calculates stored order totals in cents without floating point drift", () => {
  assert.equal(calculateOrderRevenue({ orderTotal: "1548.79" }), 154879);
  assert.equal(calculateOrderRevenue({ orderTotal: null }), 0);
  assert.equal(calculateOrderRevenue({ orderTotal: "not-a-number" }), 0);
});

test("can independently verify line quantity and price evidence", () => {
  assert.equal(calculateLineRevenue([
    { quantity: 2, unitPrice: "1.10" },
    { quantity: 1, unitPrice: 0.59 },
    { quantity: null, unitPrice: "8.00" },
  ]), 279);
});
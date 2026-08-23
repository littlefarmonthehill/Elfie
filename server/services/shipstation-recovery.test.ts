import assert from "node:assert/strict";
import test from "node:test";
import { canConfirmShipStationLineItem, classifyRecoveryOrderMatch, isImmutableLineConflict } from "./shipstation-recovery";

type LocalOrderRef = { id: string };

test("requires an immutable source-to-local mapping before a recovery can be verified", () => {
  const local: LocalOrderRef = { id: "local-order" };
  const match = classifyRecoveryOrderMatch<LocalOrderRef>([], [local]);

  assert.deepEqual(match, { kind: "order_number_only", order: local });
  assert.notEqual(match.kind, "verified");
});

test("never falls back to order number when immutable identifiers conflict", () => {
  const localById: LocalOrderRef = { id: "local-by-id" };
  const localByKey: LocalOrderRef = { id: "local-by-key" };
  const sameNumber: LocalOrderRef = { id: "local-by-number" };
  const match = classifyRecoveryOrderMatch(
    [localById, localByKey],
    [sameNumber],
  );

  assert.deepEqual(match, { kind: "immutable_conflict" });
});

test("accepts a unique immutable mapping even when the order number is duplicated", () => {
  const verified: LocalOrderRef = { id: "verified-order" };
  const sameNumberElsewhere: LocalOrderRef = { id: "same-number-other-channel" };
  const match = classifyRecoveryOrderMatch(
    [verified],
    [verified, sameNumberElsewhere],
  );

  assert.deepEqual(match, { kind: "verified", order: verified });
});

test("does not allow a keyless ShipStation line to repair a uniquely fingerprinted local row", () => {
  assert.equal(canConfirmShipStationLineItem({ hasStableKey: false }), false);
});

test("allows a ShipStation line with an immutable item key to proceed to review", () => {
  assert.equal(canConfirmShipStationLineItem({ hasStableKey: true }), true);
});

test("treats a concurrent immutable-line insert as a reload conflict, not a successful recovery", () => {
  assert.equal(isImmutableLineConflict({
    code: "23505",
    constraint: "order_details_order_line_item_key_unique",
  }), true);
  assert.equal(isImmutableLineConflict({
    code: "23505",
    constraint: "historical_order_recovery_candidate_key_unique",
  }), false);
});
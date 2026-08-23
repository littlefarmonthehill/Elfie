import { createHash } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { mapPlatformStatus } from "../config/order-status-mapping";
import { getBricklinkCredentials } from "./bricklink";
import { getBrickLinkOrderDetail } from "./bricklink-orders";
import { historicalOrderRecovery, orders, PLATFORM_ORG_ID } from "@shared/schema";

// Immutable scope of the March 25 duplicate-reconciliation review. The local
// IDs and BrickLink source IDs are the canonical source identity pair; neither
// the query nor a correction relies on a displayed order number or a mutable
// timestamp/status predicate.
export const DUPLICATE_RECONCILIATION_MANIFEST = [
  { localOrderId: "bl-17141345", sourceOrderId: "17141345" },
  { localOrderId: "bl-12398298", sourceOrderId: "12398298" },
  { localOrderId: "bl-10406576", sourceOrderId: "10406576" },
  { localOrderId: "bl-9749074", sourceOrderId: "9749074" },
  { localOrderId: "bl-7502815", sourceOrderId: "7502815" },
  { localOrderId: "bl-7501164", sourceOrderId: "7501164" },
  { localOrderId: "bl-7492231", sourceOrderId: "7492231" },
  { localOrderId: "bl-7473435", sourceOrderId: "7473435" },
  { localOrderId: "bl-7113811", sourceOrderId: "7113811" },
] as const;

export type MarketplaceStatusComparison = "matches" | "mismatch" | "unavailable";

type LocalStatusRecord = {
  id: string;
  orgId: string | null;
  orderKey: string | null;
  orderStatus: string;
  updatedAt: Date;
  zeroLineEligible: boolean;
};

export type BrickLinkStatusEvidence = {
  sourceOrderId: string;
  sourceStatus: string | null;
  paymentStatus: string | null;
  normalizedStatus: string;
  dateStatusChanged: string | null;
  dateOrdered: string | null;
  retrievedAt: string;
};

export type DuplicateCleanupStatusReviewCandidate = {
  candidateKey: string;
  candidateHash: string;
  localSnapshotHash: string;
  localOrder: LocalStatusRecord;
  sourceOrderId: string | null;
  marketplaceEvidence: BrickLinkStatusEvidence | null;
  evidenceError: string | null;
  comparison: MarketplaceStatusComparison;
  review: {
    decision: string;
    reason: string | null;
    reviewedBy: string;
    reviewedAt: Date;
  } | null;
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function deriveBrickLinkSourceOrderId(order: Pick<LocalStatusRecord, "id" | "orderKey">): string | null {
  const match = /^bl-(\d+)$/.exec(order.id);
  if (!match || order.orderKey !== `BL.${match[1]}`) return null;
  return match[1];
}

export function duplicateCleanupLocalSnapshotHash(order: LocalStatusRecord): string {
  return hash({
    id: order.id,
    orgId: order.orgId,
    orderKey: order.orderKey,
    orderStatus: order.orderStatus,
    updatedAt: order.updatedAt.toISOString(),
    zeroLineEligible: order.zeroLineEligible,
  });
}

export function normalizeBrickLinkStatusEvidence(
  sourceOrderId: string,
  sourceOrder: any,
  retrievedAt = new Date(),
): BrickLinkStatusEvidence {
  const sourceStatus = typeof sourceOrder?.status === "string" ? sourceOrder.status : null;
  const paymentStatus = typeof sourceOrder?.payment?.status === "string"
    ? sourceOrder.payment.status
    : null;
  if (String(sourceOrder?.order_id ?? "") !== sourceOrderId) {
    throw new Error("BrickLink did not return the requested immutable source order.");
  }
  if (!sourceStatus && !paymentStatus) {
    throw new Error("BrickLink did not return a status for this immutable source order.");
  }

  return {
    sourceOrderId,
    sourceStatus,
    paymentStatus,
    // BrickLink retains COMPLETED after a return; the payment status is the
    // authoritative return signal and must take precedence over order status.
    normalizedStatus: paymentStatus === "Returned"
      ? "returned"
      : mapPlatformStatus("bricklink", sourceStatus ?? ""),
    dateStatusChanged: typeof sourceOrder?.date_status_changed === "string"
      ? sourceOrder.date_status_changed
      : null,
    dateOrdered: typeof sourceOrder?.date_ordered === "string"
      ? sourceOrder.date_ordered
      : null,
    retrievedAt: retrievedAt.toISOString(),
  };
}

function candidateHash(
  localOrder: LocalStatusRecord,
  sourceOrderId: string | null,
  marketplaceEvidence: BrickLinkStatusEvidence | null,
  evidenceError: string | null,
): string {
  return hash({
    localSnapshotHash: duplicateCleanupLocalSnapshotHash(localOrder),
    sourceOrderId,
    // Retrieval time documents when the evidence was read but must not make a
    // still-current comparison stale between the review screen and its submit.
    marketplaceEvidence: marketplaceEvidence && {
      sourceOrderId: marketplaceEvidence.sourceOrderId,
      sourceStatus: marketplaceEvidence.sourceStatus,
      paymentStatus: marketplaceEvidence.paymentStatus,
      normalizedStatus: marketplaceEvidence.normalizedStatus,
      dateStatusChanged: marketplaceEvidence.dateStatusChanged,
      dateOrdered: marketplaceEvidence.dateOrdered,
    },
    evidenceError,
  });
}

async function fetchBrickLinkEvidence(
  localOrder: LocalStatusRecord,
  sourceOrderId: string,
): Promise<BrickLinkStatusEvidence> {
  const credentials = await getBricklinkCredentials(localOrder.orgId ?? PLATFORM_ORG_ID);
  const sourceOrder = await getBrickLinkOrderDetail(
    Number(sourceOrderId),
    credentials.consumerKey,
    credentials.consumerSecret,
    credentials.tokenValue,
    credentials.tokenSecret,
  );
  if (!sourceOrder) {
    throw new Error("BrickLink did not return this archived source order.");
  }
  return normalizeBrickLinkStatusEvidence(sourceOrderId, sourceOrder);
}

export async function getDuplicateCleanupStatusReviewCandidates() {
  const localOrders = await db.select({
    id: orders.id,
    orgId: orders.orgId,
    orderKey: orders.orderKey,
    orderStatus: orders.orderStatus,
    updatedAt: orders.updatedAt,
    zeroLineEligible: sql<boolean>`NOT EXISTS (
      SELECT 1 FROM order_details WHERE order_details.order_id = ${orders.id}
    )`,
  }).from(orders).where(inArray(
    orders.id,
    DUPLICATE_RECONCILIATION_MANIFEST.map(candidate => candidate.localOrderId),
  ));
  const localOrderById = new Map(localOrders.map(order => [order.id, order]));
  if (localOrderById.size !== DUPLICATE_RECONCILIATION_MANIFEST.length) {
    throw new Error("A recorded duplicate-reconciliation order is missing; status review cannot proceed.");
  }

  const candidatesWithoutReviews = await Promise.all(DUPLICATE_RECONCILIATION_MANIFEST.map(async (manifestEntry) => {
    const localOrder = localOrderById.get(manifestEntry.localOrderId)!;
    const sourceOrderId = deriveBrickLinkSourceOrderId(localOrder);
    let marketplaceEvidence: BrickLinkStatusEvidence | null = null;
    let evidenceError: string | null = null;

    if (sourceOrderId !== manifestEntry.sourceOrderId) {
      evidenceError = "The canonical local source ID/key pair is missing or inconsistent.";
    } else {
      try {
        marketplaceEvidence = await fetchBrickLinkEvidence(localOrder, sourceOrderId);
      } catch (error: any) {
        evidenceError = `Marketplace evidence unavailable: ${error?.message ?? "unknown error"}`;
      }
    }

    const comparison: MarketplaceStatusComparison = marketplaceEvidence
      ? marketplaceEvidence.normalizedStatus === localOrder.orderStatus ? "matches" : "mismatch"
      : "unavailable";
    const candidateKey = `duplicate-cleanup-status:${localOrder.id}:${manifestEntry.sourceOrderId}`;

    return {
      candidateKey,
      candidateHash: candidateHash(localOrder, manifestEntry.sourceOrderId, marketplaceEvidence, evidenceError),
      localSnapshotHash: duplicateCleanupLocalSnapshotHash(localOrder),
      localOrder,
      sourceOrderId: manifestEntry.sourceOrderId,
      marketplaceEvidence,
      evidenceError,
      comparison,
    };
  }));

  const keys = candidatesWithoutReviews.map(candidate => candidate.candidateKey);
  const reviews = keys.length === 0 ? [] : await db.select({
    candidateKey: historicalOrderRecovery.candidateKey,
    decision: historicalOrderRecovery.decision,
    reason: historicalOrderRecovery.reason,
    reviewedBy: historicalOrderRecovery.reviewedBy,
    reviewedAt: historicalOrderRecovery.reviewedAt,
  }).from(historicalOrderRecovery).where(inArray(historicalOrderRecovery.candidateKey, keys));
  const reviewByKey = new Map(reviews.map(review => [review.candidateKey, review]));

  const candidates: DuplicateCleanupStatusReviewCandidate[] = candidatesWithoutReviews.map(candidate => ({
    ...candidate,
    review: reviewByKey.get(candidate.candidateKey) ?? null,
  }));
  return {
    candidates,
    summary: {
      total: candidates.length,
      matches: candidates.filter(candidate => candidate.comparison === "matches").length,
      mismatches: candidates.filter(candidate => candidate.comparison === "mismatch").length,
      unavailable: candidates.filter(candidate => candidate.comparison === "unavailable").length,
      reviewed: candidates.filter(candidate => candidate.review != null).length,
    },
  };
}
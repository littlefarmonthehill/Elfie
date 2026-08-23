import { db } from "../db";
import { orders, syncMetadata } from "@shared/schema";
import { eq, and } from "drizzle-orm";

/**
 * Shared helpers for sync operations across all channels and schedulers.
 * Add new channel adapters here rather than duplicating these patterns.
 */

// ── Historical duplicate review ──────────────────────────────────────────────

export interface DuplicateOrderComparisonInput {
  duplicate: {
    orderKey: string | null;
    source: string | null;
    orderDate: Date | string | null;
    orderTotal: string | number | null;
  };
  canonical: {
    orderKey: string | null;
    source: string | null;
    orderDate: Date | string | null;
    orderTotal: string | number | null;
  };
  duplicateIsSplit: boolean;
  canonicalIsSplit: boolean;
  hasReusedOrderNumber: boolean;
}

export interface DuplicateOrderComparisonResult {
  isSafe: boolean;
  reasons: string[];
  safeReason: string | null;
}

function normalizedText(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.toLowerCase() : null;
}

function normalizedDate(value: Date | string | null): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizedMoney(value: string | number | null): string | null {
  if (value == null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : null;
}

/**
 * A legacy ID pattern is only a lead, never proof that two orders are
 * duplicates. Archiving is allowed only when all immutable-ish business
 * fields agree and neither record is involved in an order split.
 */
export function compareDuplicateOrderRecords(
  input: DuplicateOrderComparisonInput,
): DuplicateOrderComparisonResult {
  const reasons: string[] = [];
  const duplicateKey = normalizedText(input.duplicate.orderKey);
  const canonicalKey = normalizedText(input.canonical.orderKey);
  const duplicateSource = normalizedText(input.duplicate.source);
  const canonicalSource = normalizedText(input.canonical.source);
  const duplicateDate = normalizedDate(input.duplicate.orderDate);
  const canonicalDate = normalizedDate(input.canonical.orderDate);
  const duplicateTotal = normalizedMoney(input.duplicate.orderTotal);
  const canonicalTotal = normalizedMoney(input.canonical.orderTotal);

  if (!duplicateKey || !canonicalKey || duplicateKey !== canonicalKey) {
    reasons.push("order key is missing or does not match");
  }
  if (!duplicateSource || !canonicalSource || duplicateSource !== canonicalSource) {
    reasons.push("source marketplace is missing or does not match");
  }
  if (!duplicateDate || !canonicalDate || duplicateDate !== canonicalDate) {
    reasons.push("order date is missing or does not match");
  }
  if (!duplicateTotal || !canonicalTotal || duplicateTotal !== canonicalTotal) {
    reasons.push("order total is missing or does not match");
  }
  if (input.duplicateIsSplit || input.canonicalIsSplit) {
    reasons.push("one of the orders is a split or reship record");
  }
  if (input.hasReusedOrderNumber) {
    reasons.push("the legacy order number is reused by another order");
  }

  return {
    isSafe: reasons.length === 0,
    reasons,
    safeReason: reasons.length === 0
      ? "Order key, source marketplace, order date, and total all match; neither order is split and the legacy number is not reused."
      : null,
  };
}

// ── DB Connection Resilience ──────────────────────────────────────────────────

/**
 * Run `fn` once; on a transient DB connection error (ECONNRESET / "Connection
 * terminated") wait 3 s and try again exactly once.  All other errors re-throw
 * immediately.  Used by every scheduler's outer try/catch so the single-retry
 * pattern isn't duplicated across files.
 */
export async function withDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const isTransient =
      err.message?.includes('Connection terminated') || err.code === 'ECONNRESET';
    if (!isTransient) throw err;
    await new Promise(r => setTimeout(r, 3000));
    return fn();
  }
}

// ── Sync Metadata ────────────────────────────────────────────────────────────

interface SyncMetadataPayload {
  status: 'in_progress' | 'success' | 'partial' | 'error';
  recordsAdded?: number;
  recordsUpdated?: number;
  errorMessage?: string | null;
  /** Optional JSON blob of the last full sync result (channel sync stores lotsCreated/updated/errors/mode). */
  lastSyncMetaJson?: string | null;
}

/**
 * Upsert a sync_metadata row for a given sync operation.
 * Centralizes the identical upsert pattern used by every channel and scheduler sync.
 */
export async function upsertSyncMetadata(
  syncId: string,
  orgId: string,
  payload: SyncMetadataPayload
): Promise<void> {
  const now = new Date();
  const base = {
    id: syncId,
    orgId,
    lastSyncTime: now,
    lastSyncStatus: payload.status,
    recordsAdded: payload.recordsAdded ?? 0,
    recordsUpdated: payload.recordsUpdated ?? 0,
    errorMessage: payload.errorMessage ?? null,
    lastSyncMetaJson: payload.lastSyncMetaJson ?? null,
  };
  await db
    .insert(syncMetadata)
    .values(base)
    .onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncTime: now,
        lastSyncStatus: payload.status,
        recordsAdded: payload.recordsAdded ?? 0,
        recordsUpdated: payload.recordsUpdated ?? 0,
        errorMessage: payload.errorMessage ?? null,
        lastSyncMetaJson: payload.lastSyncMetaJson ?? null,
        updatedAt: now,
      },
    });
}

// ── Order Lookup ─────────────────────────────────────────────────────────────

/**
 * Find an existing order by its canonical ID, falling back to one or more legacy
 * order_number formats (e.g. "BL.12345", "BO.12345", plain numeric string).
 *
 * Scoped to the given orgId so that a multi-tenant environment never accidentally
 * matches an order belonging to a different organization.
 *
 * Returns the first match found, or undefined if the order is new.
 */
export async function resolveExistingOrder(
  canonicalId: string,
  orgId: string,
  ...legacyOrderNumbers: string[]
) {
  const [byId] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, canonicalId), eq(orders.orgId, orgId)))
    .limit(1);

  if (byId) return byId;

  for (const legacyNum of legacyOrderNumbers) {
    const [byNumber] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.orderNumber, legacyNum), eq(orders.orgId, orgId)))
      .limit(1);
    if (byNumber) return byNumber;
  }

  return undefined;
}

// ── Status Protection ────────────────────────────────────────────────────────

/**
 * Determine the status to write for an existing order, protecting locally-shipped
 * orders from being demoted by a lagging marketplace status.
 *
 * Rules:
 * - If we've already marked the order as shipped locally, keep 'shipped' unless
 *   the incoming status is also 'shipped' or is a legitimate return.
 * - Returns are always allowed through regardless of local status.
 *
 * @param existingStatus  The status currently stored in our DB.
 * @param incomingStatus  The normalized status coming from the marketplace.
 * @param isReturn        True when the marketplace has signalled a return (e.g. BL payment.status).
 */
export function resolveOrderStatus(
  existingStatus: string,
  incomingStatus: string,
  isReturn = false
): { status: string; wasDemotionBlocked: boolean; isShippedCancellation: boolean } {
  if (isReturn) {
    return { status: incomingStatus, wasDemotionBlocked: false, isShippedCancellation: false };
  }
  // Guard against status regressions from terminal/advanced states.
  //
  // 'shipped' may advance to 'completed' (buyer confirmed receipt) or 'cancelled'
  // (post-ship cancellation that restores inventory).  All true demotions (e.g.
  // shipped → awaiting_shipment from stale BL data) are blocked.
  //
  // 'completed' (buyer confirmed receipt) must never regress — it may only move
  // to 'returned' or 'cancelled'.
  //
  // 'returned' and 'cancelled' are fully terminal — they must never regress to any
  // earlier state.  A marketplace API can show an old status that pre-dates a manual
  // local action (mark-as-returned, test-order purge, etc.).  Without this guard the
  // sync would silently undo that local action on every re-sync.
  const wouldDemoteFromShipped   = existingStatus === 'shipped'    &&
    !['shipped', 'completed', 'cancelled'].includes(incomingStatus);
  const wouldDemoteFromCompleted = existingStatus === 'completed'  &&
    !['completed', 'returned', 'cancelled'].includes(incomingStatus);
  const wouldDemoteFromReturned  = existingStatus === 'returned'   &&
    !['returned', 'cancelled'].includes(incomingStatus);
  const wouldDemoteFromCancelled = existingStatus === 'cancelled'  &&
    !['returned', 'cancelled'].includes(incomingStatus);
  const wouldDemote = wouldDemoteFromShipped || wouldDemoteFromCompleted
                    || wouldDemoteFromReturned || wouldDemoteFromCancelled;

  if (wouldDemote) {
    // BrickOwl sellers use "cancel" the same way BrickLink uses "return" — the seller
    // cancels a shipped order when items come back.  Allow cancelled to override shipped
    // so we can restore inventory (without pushing to other channels), but block all other
    // backward status movements (e.g. shipped → awaiting_shipment caused by stale BL data).
    // Only trigger isShippedCancellation for the specific shipped→cancelled transition.
    if (wouldDemoteFromShipped && incomingStatus === 'cancelled') {
      return { status: 'cancelled', wasDemotionBlocked: false, isShippedCancellation: true };
    }
    // Return the *existing* status (not a hardcoded 'shipped') so completed/returned/cancelled
    // orders stay in their local state rather than reverting to a marketplace-reported status.
    return { status: existingStatus, wasDemotionBlocked: true, isShippedCancellation: false };
  }
  return { status: incomingStatus, wasDemotionBlocked: false, isShippedCancellation: false };
}

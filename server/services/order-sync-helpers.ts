import { db } from "../db";
import { orders, syncMetadata } from "@shared/schema";
import { eq, and } from "drizzle-orm";

/**
 * Shared helpers for sync operations across all channels and schedulers.
 * Add new channel adapters here rather than duplicating these patterns.
 */

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
  const wouldDemote = existingStatus === 'shipped' && incomingStatus !== 'shipped';
  if (wouldDemote) {
    // BrickOwl sellers use "cancel" the same way BrickLink uses "return" — the seller
    // cancels a shipped order when items come back.  Allow cancelled to override shipped
    // so we can restore inventory (without pushing to other channels), but block all other
    // backward status movements (e.g. shipped → awaiting_shipment caused by stale BL data).
    if (incomingStatus === 'cancelled') {
      return { status: 'cancelled', wasDemotionBlocked: false, isShippedCancellation: true };
    }
    return { status: 'shipped', wasDemotionBlocked: true, isShippedCancellation: false };
  }
  return { status: incomingStatus, wasDemotionBlocked: false, isShippedCancellation: false };
}

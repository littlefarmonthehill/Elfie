import { db } from "../db";
import { orders, syncMetadata } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Shared helpers for order sync across all channels.
 * Add new channel adapters here rather than duplicating these patterns.
 */

// ── Sync Metadata ────────────────────────────────────────────────────────────

interface SyncMetadataPayload {
  status: 'in_progress' | 'success' | 'error';
  recordsAdded?: number;
  recordsUpdated?: number;
  errorMessage?: string | null;
}

/**
 * Upsert a sync_metadata row for a given sync operation.
 * Centralizes the identical upsert pattern used by every channel sync.
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
        updatedAt: now,
      },
    });
}

// ── Order Lookup ─────────────────────────────────────────────────────────────

/**
 * Find an existing order by its canonical ID, falling back to one or more legacy
 * order_number formats (e.g. "BL.12345", "BO.12345", plain numeric string).
 *
 * Returns the first match found, or undefined if the order is new.
 */
export async function resolveExistingOrder(
  canonicalId: string,
  ...legacyOrderNumbers: string[]
) {
  const [byId] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, canonicalId))
    .limit(1);

  if (byId) return byId;

  for (const legacyNum of legacyOrderNumbers) {
    const [byNumber] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, legacyNum))
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
): { status: string; wasDemotionBlocked: boolean } {
  if (isReturn) {
    return { status: incomingStatus, wasDemotionBlocked: false };
  }
  const wouldDemote = existingStatus === 'shipped' && incomingStatus !== 'shipped';
  if (wouldDemote) {
    return { status: 'shipped', wasDemotionBlocked: true };
  }
  return { status: incomingStatus, wasDemotionBlocked: false };
}

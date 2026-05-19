import { db } from "../db";
import { sql } from "drizzle-orm";
import { recordSyncIssue } from "./sync-issue-service";
import { syncBrickLinkOrders } from "./bricklink-order-sync";
import { syncLock } from "./sync-lock";

const HEAL_LOCK_NAME = 'Order Sync';

const RECONCILE_TOLERANCE = 0.05;

const CLOSED_STATUSES = [
  'shipped', 'returned', 'cancelled', 'Cancelled',
  'purged', 'completed', 'Completed',
];

interface BrokenOrder {
  orderId: string;        // e.g. "bl-31642438"
  rawOrderId: string;     // e.g. "31642438"
  expected: number;
  actual: number;
  gap: number;
  lineCount: number;
}

/**
 * Audit every active (not closed) BrickLink order for an org and check that the
 * locally-stored items subtotal reconciles against the locally-stored order header.
 *
 * This is a PURE INTERNAL SQL check — zero external API calls. Only orders whose
 * subtotals don't match within $0.05 are flagged AND auto-healed via a single
 * targeted re-sync (which is the only step that hits the BrickLink API, and only
 * for orders that are actually broken).
 *
 * Catches:
 *   - Partial /orders/{id}/items API responses (the bl-31642438 scenario)
 *   - Buyer-edited orders (added / removed lots after initial sync)
 *   - Manual price adjustments that didn't propagate
 */
export async function auditAndHealActiveBrickLinkOrders(orgId: string): Promise<void> {
  let rows;
  try {
    const result = await db.execute(sql`
      SELECT
        o.id,
        o.order_total::float            AS order_total,
        COALESCE(o.shipping_amount, 0)::float  AS shipping,
        COALESCE(o.tax_amount, 0)::float       AS tax,
        COALESCE(o.insurance_amount, 0)::float AS insurance,
        COALESCE((
          SELECT SUM(d.quantity * COALESCE(d.unit_price, 0))
          FROM order_details d
          WHERE d.order_id = o.id
        ), 0)::float AS items_subtotal,
        COALESCE((
          SELECT COUNT(*) FROM order_details d WHERE d.order_id = o.id
        ), 0)::int AS line_count
      FROM orders o
      WHERE o.org_id = ${orgId}
        AND o.id LIKE 'bl-%'
        AND o.order_status NOT IN (${sql.raw(CLOSED_STATUSES.map(s => `'${s}'`).join(','))})
        AND o.local_only = false
        AND o.order_total IS NOT NULL
    `);
    rows = result.rows as Array<{
      id: string;
      order_total: number;
      shipping: number;
      tax: number;
      insurance: number;
      items_subtotal: number;
      line_count: number;
    }>;
  } catch (err: any) {
    console.error(`[OrderHealthCheck] Failed to query active orders for org ${orgId}: ${err.message}`);
    return;
  }

  const broken: BrokenOrder[] = [];
  for (const r of rows) {
    const expected = +(r.order_total - r.shipping - r.tax - r.insurance).toFixed(2);
    const actual = +r.items_subtotal.toFixed(2);
    // Skip only when both sides are zero (no signal); a zero-expected order with
    // non-zero actuals (or vice versa) is still suspect and should be flagged.
    if (expected <= 0 && actual <= 0) continue;
    const gap = Math.abs(expected - actual);
    if (gap > RECONCILE_TOLERANCE) {
      broken.push({
        orderId: r.id,
        rawOrderId: r.id.replace(/^bl-/, ''),
        expected, actual, gap,
        lineCount: r.line_count,
      });
    }
  }

  if (broken.length === 0) {
    console.log(`[OrderHealthCheck] org=${orgId}: audited ${rows.length} active BL order(s), all reconciled.`);
    return;
  }

  console.warn(`[OrderHealthCheck] org=${orgId}: ${broken.length} of ${rows.length} active BL order(s) failed reconciliation — flagging and auto-healing.`);

  for (const b of broken) {
    await recordSyncIssue({
      syncType: 'order_sync',
      platform: 'bricklink',
      itemId: b.orderId,
      issueType: 'order_items_mismatch',
      issueDescription:
        `Order ${b.orderId} has ${b.lineCount} line item(s) summing to $${b.actual.toFixed(2)}, ` +
        `but the order header expects $${b.expected.toFixed(2)} (gap $${b.gap.toFixed(2)}). ` +
        `Likely cause: BrickLink returned a partial items response. Auto-healing via targeted re-sync.`,
      severity: 'critical',
      metadata: {
        orderId: b.orderId,
        expectedItemsSubtotal: b.expected,
        actualItemsSubtotal: b.actual,
        gap: b.gap,
        currentLineCount: b.lineCount,
        detectedAt: new Date().toISOString(),
        healingAttempted: true,
      },
    });
  }

  // Acquire the Order Sync lock so the heal run can't overlap with the next
  // scheduled tick (also a normal order sync) or with a user-triggered manual
  // sync. If we can't get the lock right now, leave the sync_issue rows open;
  // the next scheduler cycle will re-audit and try to heal again.
  if (!syncLock.acquire(HEAL_LOCK_NAME)) {
    console.warn(`[OrderHealthCheck] org=${orgId}: could not acquire ${HEAL_LOCK_NAME} lock for heal — will retry on next scheduler cycle.`);
    return;
  }

  try {
    const forceIds = new Set(broken.map(b => b.orderId));
    // skipMetadata: true → don't poison the scheduler's sync_metadata row.
    // The heal is an internal repair, not a top-level scheduled sync.
    const healResult = await syncBrickLinkOrders(orgId, {
      forceOrderIds: forceIds,
      skipMetadata: true,
    });
    console.log(`[OrderHealthCheck] org=${orgId}: heal sync processed ${healResult.ordersUpdated + healResult.ordersAdded} order(s), errors=${healResult.errors.length}`);
  } catch (err: any) {
    console.error(`[OrderHealthCheck] org=${orgId}: auto-heal sync failed (sync_issue rows remain open): ${err.message}`);
  } finally {
    syncLock.release(HEAL_LOCK_NAME);
  }
}

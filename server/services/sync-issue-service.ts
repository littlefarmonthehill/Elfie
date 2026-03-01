import { db } from "../db";
import { syncIssues, orders } from "@shared/schema";
import { and, eq, lt, ne } from "drizzle-orm";
import { sql } from "drizzle-orm";

export interface SyncIssueInput {
  syncType: string;
  platform: string;
  itemId?: string;
  itemNo?: string;
  issueType: string;
  issueDescription: string;
  severity: "critical" | "high" | "medium" | "low";
  metadata?: Record<string, any>;
}

/**
 * Record a sync issue, skipping if an identical open issue already exists.
 * Safe to call fire-and-forget — never throws.
 */
export async function recordSyncIssue(input: SyncIssueInput): Promise<void> {
  try {
    const conditions: any[] = [
      eq(syncIssues.status, "open"),
      eq(syncIssues.issueType, input.issueType),
      eq(syncIssues.platform, input.platform),
      eq(syncIssues.syncType, input.syncType),
    ];

    if (input.itemId) {
      conditions.push(eq(syncIssues.itemId, input.itemId));
    }

    const [existing] = await db
      .select({ id: syncIssues.id })
      .from(syncIssues)
      .where(and(...conditions))
      .limit(1);

    if (existing) return; // Already tracked

    await db.insert(syncIssues).values({
      syncType: input.syncType,
      platform: input.platform,
      itemId: input.itemId ?? null,
      itemNo: input.itemNo ?? null,
      issueType: input.issueType,
      issueDescription: input.issueDescription,
      severity: input.severity,
      status: "open",
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });

    console.log(`📋 Sync issue recorded: [${input.severity}] ${input.issueType} on ${input.platform}`);
  } catch (err) {
    console.error("Failed to record sync issue:", err);
  }
}

/**
 * Auto-resolve any open scheduler issues (blocked/failed) for a sync type
 * when that sync subsequently completes successfully.
 * Safe to call fire-and-forget — never throws.
 */
export async function resolveSchedulerIssues(syncType: string): Promise<void> {
  try {
    await db
      .update(syncIssues)
      .set({ status: 'resolved', resolvedAt: new Date(), resolvedBy: 'system' })
      .where(
        and(
          eq(syncIssues.syncType, syncType),
          eq(syncIssues.platform, 'scheduler'),
          eq(syncIssues.status, 'open'),
        )
      );
  } catch (err) {
    console.error(`Failed to resolve scheduler issues for ${syncType}:`, err);
  }
}

/**
 * Detect active orders where inventory was never deducted.
 * Any active order older than 10 minutes with inventoryDeducted=false is a silent failure.
 * Writes a critical sync_issue for each.
 */
export async function checkStuckInventoryDeductions(): Promise<void> {
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const stuckOrders = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        marketplace: orders.marketplace,
        orderStatus: orders.orderStatus,
        syncedAt: orders.syncedAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.inventoryDeducted, false),
          ne(orders.orderStatus, "cancelled"),
          ne(orders.orderStatus, "returned"),
          lt(orders.syncedAt, tenMinutesAgo)
        )
      )
      .limit(50);

    for (const order of stuckOrders) {
      await recordSyncIssue({
        syncType: "inventory_deduction",
        platform: order.marketplace?.toLowerCase() ?? "unknown",
        itemId: order.id,
        itemNo: order.orderNumber,
        issueType: "deduction_not_recorded",
        issueDescription: `Order ${order.orderNumber} (${order.orderStatus}) has been active for over 10 minutes but inventory was never deducted. Cross-platform quantities may be out of sync.`,
        severity: "critical",
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          marketplace: order.marketplace,
          orderStatus: order.orderStatus,
          syncedAt: order.syncedAt,
        },
      });
    }

    if (stuckOrders.length > 0) {
      console.log(`⚠️ Found ${stuckOrders.length} orders with stuck inventory deductions`);
    }
  } catch (err) {
    console.error("Failed to check stuck inventory deductions:", err);
  }
}

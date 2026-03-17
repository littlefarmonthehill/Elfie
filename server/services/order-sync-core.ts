import { db } from "../db";
import { appSettings } from "@shared/schema";
import { syncLock } from "./sync-lock";
import { sql, eq } from "drizzle-orm";

export type SyncPlatform = "bricklink" | "brickowl" | "all";

export interface PlatformSyncOptions {
  limit?: number;
  fullSync?: boolean;
  withEmbeddings?: boolean;
  withStuckCheck?: boolean;
}

export interface PlatformSyncResult {
  bricklink: { success: boolean; skipped: boolean; ordersAdded: number; error: string | null };
  brickowl:  { success: boolean; skipped: boolean; ordersAdded: number; error: string | null };
}

/** True while an order sync is in progress (delegates to global lock). */
export function getOrderSyncIsRunning() {
  return syncLock.getActive().includes('Order Sync');
}

/**
 * Single shared function that runs order sync for one or all platforms.
 * All entry points (manual routes + scheduler) call this.
 */
export async function runPlatformOrderSync(
  platform: SyncPlatform,
  options: PlatformSyncOptions = {}
): Promise<PlatformSyncResult> {
  const { limit, fullSync = false, withEmbeddings = false, withStuckCheck = false } = options;

  const result: PlatformSyncResult = {
    bricklink: { success: false, skipped: false, ordersAdded: 0, error: null },
    brickowl:  { success: false, skipped: false, ordersAdded: 0, error: null },
  };

  if (!syncLock.acquire('Order Sync')) {
    const blocker = syncLock.getActive().join(', ');
    throw new Error(`Order sync blocked: ${blocker} is already running`);
  }

  try {
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, 'org_planetbrick')).limit(1);
  const newOrderIds: string[] = [];

  // ── BrickLink ──────────────────────────────────────────────────────────────
  if (platform === "bricklink" || platform === "all") {
    if (
      settings?.bricklinkConsumerKey &&
      settings?.bricklinkConsumerSecret &&
      settings?.bricklinkTokenValue &&
      settings?.bricklinkTokenSecret
    ) {
      try {
        console.log("🧱 Syncing BrickLink orders...");
        const { syncBrickLinkOrders } = await import("./bricklink-order-sync");
        const blResult = await syncBrickLinkOrders(
          settings.bricklinkConsumerKey,
          settings.bricklinkConsumerSecret,
          settings.bricklinkTokenValue,
          settings.bricklinkTokenSecret,
          { limit, fullSync }
        );
        result.bricklink.success = true;
        result.bricklink.ordersAdded = blResult.ordersAdded ?? 0;
        console.log(`✅ BrickLink: ${result.bricklink.ordersAdded} orders added`);

        if (withEmbeddings && result.bricklink.ordersAdded > 0) {
          const rows = await db.execute(sql`
            SELECT id FROM orders WHERE marketplace = 'BrickLink'
            ORDER BY synced_at DESC LIMIT ${result.bricklink.ordersAdded}
          `);
          newOrderIds.push(...rows.rows.map((r: any) => r.id));
        }
      } catch (err: any) {
        result.bricklink.error = err.message;
        console.error("❌ BrickLink sync failed:", err.message);
      }
    } else {
      result.bricklink.skipped = true;
      console.log("⏭️ BrickLink skipped — credentials not configured");
    }
  }

  // ── BrickOwl ───────────────────────────────────────────────────────────────
  if (platform === "brickowl" || platform === "all") {
    if (settings?.brickowlApiKey) {
      try {
        console.log("🦉 Syncing BrickOwl orders...");
        const { syncBrickOwlOrders } = await import("./brickowl-order-sync");
        const boResult = await syncBrickOwlOrders(settings.brickowlApiKey, { limit, fullSync });
        result.brickowl.success = true;
        result.brickowl.ordersAdded = boResult.ordersAdded ?? 0;
        console.log(`✅ BrickOwl: ${result.brickowl.ordersAdded} orders added`);

        if (withEmbeddings && result.brickowl.ordersAdded > 0) {
          const rows = await db.execute(sql`
            SELECT id FROM orders WHERE marketplace = 'BrickOwl'
            ORDER BY synced_at DESC LIMIT ${result.brickowl.ordersAdded}
          `);
          newOrderIds.push(...rows.rows.map((r: any) => r.id));
        }
      } catch (err: any) {
        result.brickowl.error = err.message;
        console.error("❌ BrickOwl sync failed:", err.message);
      }
    } else {
      result.brickowl.skipped = true;
      console.log("⏭️ BrickOwl skipped — credentials not configured");
    }
  }

  // ── Embeddings (scheduler-only) ────────────────────────────────────────────
  if (withEmbeddings && newOrderIds.length > 0) {
    try {
      console.log(`🧠 Generating embeddings for ${newOrderIds.length} new orders...`);
      const { batchEmbedOrders, batchEmbedOrderDetails } = await import("./embeddings");
      await batchEmbedOrders(newOrderIds);
      await batchEmbedOrderDetails(newOrderIds);
      console.log(`✓ Embeddings complete`);
    } catch (err) {
      console.error("✗ Embedding failed (non-fatal):", err);
    }
  }

  // ── Stuck inventory check (scheduler-only) ─────────────────────────────────
  if (withStuckCheck) {
    try {
      const { checkStuckInventoryDeductions } = await import("./sync-issue-service");
      await checkStuckInventoryDeductions();
    } catch (err) {
      console.error("✗ Stuck check failed (non-fatal):", err);
    }
  }

  return result;
  } finally {
    syncLock.release('Order Sync');
  }
}

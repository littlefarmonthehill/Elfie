import { updateBrickOwlLot, getBrickOwlInventory } from './brickowl';
import { adjustBrickLinkInventoryDelta } from './bricklink';
import { recordSyncIssue } from './sync-issue-service';
import { db } from '../db';
import { channelLotLinks, crossPlatformSyncQueue, blInventory } from '@shared/schema';
import { eq, and, inArray, isNotNull, sql, desc } from 'drizzle-orm';

const BO_CHANNEL = 'brickowl' as const;

/**
 * Infer the org's default BrickLink stockroom from their own inventory history.
 *
 * BL's store-wide sold-out preference (which stockroom A/B/C) is only configurable
 * in the BL web UI and is NOT exposed via the API. When we send a delta that brings
 * a lot to qty=0 we must explicitly specify is_stock_room + stock_room_id, so we
 * derive the seller's default by looking at which stockroom holds the most of their
 * already-sold-out lots. Falls back to 'A' (BL's own default) for new orgs with no data.
 */
async function inferDefaultStockroom(orgId: string): Promise<'A' | 'B' | 'C'> {
  const rows = await db
    .select({
      stockRoomId: blInventory.stockRoomId,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(blInventory)
    .where(
      and(
        eq(blInventory.orgId, orgId),
        eq(blInventory.isStockRoom, true),
        isNotNull(blInventory.stockRoomId),
        eq(blInventory.quantity, 0),
      )
    )
    .groupBy(blInventory.stockRoomId)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(1);

  const top = rows[0]?.stockRoomId;
  if (top === 'A' || top === 'B' || top === 'C') return top;
  return 'A'; // BL's documented default when stock_room_id is omitted
}

/**
 * Cross-Platform Inventory Synchronization Service
 *
 * Rules:
 * - The platform that generated the sale is EXCLUDED from receiving inventory updates
 *   (it already manages its own inventory for that order).
 * - All other platforms receive inventory updates.
 * - BrickLink uses delta-based adjustments ("+N" / "-N").
 * - BrickOwl uses absolute quantity updates.
 *
 * Supported Platforms:
 * - BrickLink (delta adjustments)
 * - BrickOwl (absolute quantity)
 *
 * BrickOwl lot resolution (three-tier lookup):
 *   1. channelLotLinks table — fast local DB lookup, populated by channel sync.
 *   2. live BO inventory via external_lot_ids.other — fallback for lots created before
 *      channelLotLinks existed; requires channel sync to have set external_id on BO lots.
 *   3. live BO inventory via boid+color_id+condition match against blInventory — works
 *      even for BO lots created directly in BrickOwl (never touched by our channel sync).
 *
 * Adding a new channel:
 *   1. Add its update function below following the same signature as
 *      updateBrickOwlQuantity / updateBrickLinkQuantityDelta.
 *   2. Call it (with source exclusion) inside syncInventoryItemAcrossPlatforms.
 *   3. Pre-fetch any inventory data the channel needs in syncMultipleItemsAcrossPlatforms
 *      and pass it through as a context parameter to avoid N+1 API calls.
 */

export interface PlatformSyncResult {
  platform: string;
  success: boolean;
  itemsUpdated: number;
  errors: string[];
}

export interface CrossPlatformSyncResult {
  success: boolean;
  platforms: PlatformSyncResult[];
  totalItemsUpdated: number;
  totalErrors: number;
}

export interface SyncItem {
  inventoryId: string;
  newQuantity: number;    // Absolute quantity — used for BrickOwl and absolute-setter platforms
  quantityDelta: number;  // Delta change — used for BrickLink (negative = reduce, positive = restore)
  sourcePlatform: string; // The platform that originated the sale; will be skipped
  orgId?: string;         // Org whose credentials to use for the adjustment
  // Optional context for error tracking
  orderId?: string;
  orderNumber?: string;
  itemNo?: string;
  isRetry?: boolean;      // true = already a retry attempt; do NOT re-enqueue on failure
  /**
   * When set, ONLY these platforms are updated — all others are skipped.
   * Used by the retry runner to target exactly the failed platform without
   * relying on sourcePlatform exclusion (which breaks with 3+ channels).
   * Add new channel names here as they are added to syncInventoryItemAcrossPlatforms.
   */
  onlyPlatforms?: string[];
}

// ── Retry-queue helpers ────────────────────────────────────────────────────────

async function enqueueRetry(params: {
  item: SyncItem;
  targetPlatform: string; // e.g. 'BrickLink', 'BrickOwl', 'eBay', 'Amazon', …
  errorMessage: string;
}): Promise<void> {
  const { item, targetPlatform, errorMessage } = params;
  if (item.isRetry) return; // Never re-enqueue a retry attempt
  const numericId = parseInt(item.inventoryId, 10);
  if (isNaN(numericId)) return;
  if (!item.orgId) return;
  try {
    await db.insert(crossPlatformSyncQueue).values({
      orgId: item.orgId,
      blInventoryId: numericId,
      targetPlatform,
      sourcePlatform: item.sourcePlatform,
      sourceOrderId: item.orderId ?? null,
      quantityDelta: item.quantityDelta,
      lastError: errorMessage,
    });
    console.log(`📋 Enqueued ${targetPlatform} retry for inventory ${item.inventoryId}${item.orderId ? ` (order ${item.orderId})` : ''}`);
  } catch (err: any) {
    console.error(`Failed to enqueue cross-platform retry: ${err.message}`);
  }
}

/** Pre-fetched context shared across all items in a single bulk sync run. */
export interface SyncContext {
  /** Map of BL inventory ID (string) → BrickOwl lot, built from live BO inventory. */
  boInventoryMap: Map<string, any>;
}

// ── BrickOwl ─────────────────────────────────────────────────────────────────

/**
 * Update a single inventory item's quantity on BrickOwl (absolute).
 * Requires a pre-built inventory map to avoid repeated full-inventory API calls.
 */
async function updateBrickOwlQuantity(
  item: SyncItem,
  boInventoryMap: Map<string, any>
): Promise<{ success: boolean; error?: string }> {
  const { inventoryId, newQuantity, orgId, orderId, orderNumber, itemNo } = item;
  try {
    const matchingLot = boInventoryMap.get(inventoryId);

    if (!matchingLot) {
      const errMsg = `No BrickOwl lot found with BrickLink inventory ID: ${inventoryId}`;
      console.warn(`⚠️ ${errMsg}. No matching entry in channel_lot_links and no external_lot_ids.other match in live BO inventory for BL inv ${inventoryId}.`);
      await recordSyncIssue({
        syncType: 'cross_platform_sync',
        platform: 'brickowl',
        itemId: inventoryId,
        itemNo,
        issueType: 'lot_not_found',
        issueDescription: `${errMsg}${orderNumber ? ` (order ${orderNumber})` : ''}. No channel_lot_links entry and no external_lot_ids.other match found.`,
        severity: 'high',
        metadata: { inventoryId, orderId, orderNumber, itemNo, newQuantity },
      });
      return { success: false, error: errMsg };
    }

    await updateBrickOwlLot({ lot_id: matchingLot.lot_id, absolute_quantity: newQuantity }, orgId);

    console.log(`✓ BrickOwl: Updated lot ${matchingLot.lot_id} to quantity ${newQuantity}`);
    return { success: true };

  } catch (error: any) {
    const errMsg = error.message || 'Unknown error';
    console.error(`✗ BrickOwl sync error for inventory ${inventoryId}:`, error);
    await recordSyncIssue({
      syncType: 'cross_platform_sync',
      platform: 'brickowl',
      itemId: inventoryId,
      itemNo,
      issueType: 'update_failed',
      issueDescription: `BrickOwl quantity update failed for inventory ${inventoryId}${orderNumber ? ` (order ${orderNumber})` : ''}: ${errMsg}`,
      severity: 'high',
      metadata: { inventoryId, orderId, orderNumber, itemNo, newQuantity, error: errMsg },
    });
    await enqueueRetry({ item, targetPlatform: 'BrickOwl', errorMessage: errMsg });
    return { success: false, error: errMsg };
  }
}

// ── BrickLink ─────────────────────────────────────────────────────────────────

/**
 * Update a single inventory item's quantity on BrickLink (delta).
 */
async function updateBrickLinkQuantityDelta(
  item: SyncItem
): Promise<{ success: boolean; error?: string }> {
  const { inventoryId, quantityDelta, orderId, orderNumber, itemNo, orgId } = item;
  try {
    const numericId = parseInt(inventoryId, 10);
    if (isNaN(numericId)) {
      const errMsg = `Invalid BrickLink inventory ID: ${inventoryId}`;
      await recordSyncIssue({
        syncType: 'cross_platform_sync',
        platform: 'bricklink',
        itemId: inventoryId,
        itemNo,
        issueType: 'invalid_inventory_id',
        issueDescription: `${errMsg}${orderNumber ? ` (order ${orderNumber})` : ''}`,
        severity: 'high',
        metadata: { inventoryId, orderId, orderNumber, itemNo },
      });
      return { success: false, error: errMsg };
    }

    // Look up retention settings from local inventory. Per BL API docs, is_retain,
    // is_stock_room, and stock_room_id are all per-call — they must be included on
    // every request or BL will use its own defaults (which may delete or misplace the lot).
    const [localLot] = await db
      .select({
        isRetain:    blInventory.isRetain,
        isStockRoom: blInventory.isStockRoom,
        stockRoomId: blInventory.stockRoomId,
        quantity:    blInventory.quantity,
      })
      .from(blInventory)
      .where(eq(blInventory.id, numericId))
      .limit(1);
    let isRetain    = localLot?.isRetain    ?? true;
    const isStockRoom = localLot?.isStockRoom ?? false;
    const stockRoomId = localLot?.stockRoomId ?? null;
    const localQty    = localLot?.quantity    ?? 0;

    // BL rejects "Update would result in 0 quantity in your inventory without being in
    // stockroom" when is_retain=true but is_stock_room=false and the result would be qty=0.
    //
    // Root cause: is_stock_room from GET means "lot is currently in stockroom" (always false
    // for an active lot). On PUT it means "move to stockroom when qty hits 0". We must not
    // echo the GET value back — when the lot is about to hit 0 we need to signal the
    // desired sold-out behaviour explicitly.
    //
    // localQty is already the post-deduction value, so localQty <= 0 means BL would also
    // reach 0 after this delta (assuming BL and local are in sync).
    let effectiveStockRoom = isStockRoom;
    let effectiveStockRoomId = stockRoomId;
    if (isRetain && !isStockRoom && localQty <= 0) {
      // BL rejects qty=0 with is_retain=true + is_stock_room=false.
      // The seller's default stockroom is not exposed via BL's API — infer it from their
      // existing sold-out lots (whichever stockroom holds the most of them).
      const defaultStockroom = await inferDefaultStockroom(orgId);
      effectiveStockRoom = true;
      effectiveStockRoomId = defaultStockroom;
      console.log(`⚠️  [BL-DELTA] Inventory ${inventoryId} would reach 0 qty — overriding is_stock_room=true (stockroom ${defaultStockroom}, inferred from org history) so BL moves lot to stockroom instead of rejecting`);
    }

    console.log(`🎯 [BL-DELTA] Sending delta ${quantityDelta > 0 ? '+' : ''}${quantityDelta} to BrickLink inventory ${inventoryId} (is_retain=${isRetain}, is_stock_room=${effectiveStockRoom}${effectiveStockRoomId ? `, stock_room_id=${effectiveStockRoomId}` : ''})${orderId ? ` (order ${orderId})` : ''}`);
    const result = await adjustBrickLinkInventoryDelta(numericId, quantityDelta, orgId, isRetain, effectiveStockRoom, effectiveStockRoomId);
    if (!result.success && result.error) {
      await recordSyncIssue({
        syncType: 'cross_platform_sync',
        platform: 'bricklink',
        itemId: inventoryId,
        itemNo,
        issueType: 'update_failed',
        issueDescription: `BrickLink delta update failed for inventory ${inventoryId}${orderNumber ? ` (order ${orderNumber})` : ''}: ${result.error}`,
        severity: 'high',
        metadata: { inventoryId, orderId, orderNumber, itemNo, quantityDelta, error: result.error },
      });
      await enqueueRetry({ item, targetPlatform: 'BrickLink', errorMessage: result.error });
    }
    return result;

  } catch (error: any) {
    const errMsg = error.message || 'Unknown error';
    console.error(`✗ BrickLink sync error for inventory ${inventoryId}:`, error);
    await recordSyncIssue({
      syncType: 'cross_platform_sync',
      platform: 'bricklink',
      itemId: inventoryId,
      itemNo,
      issueType: 'update_failed',
      issueDescription: `BrickLink delta update failed for inventory ${inventoryId}${orderNumber ? ` (order ${orderNumber})` : ''}: ${errMsg}`,
      severity: 'high',
      metadata: { inventoryId, orderId, orderNumber, itemNo, quantityDelta, error: errMsg },
    });
    await enqueueRetry({ item, targetPlatform: 'BrickLink', errorMessage: errMsg });
    return { success: false, error: errMsg };
  }
}

// ── Orchestration ─────────────────────────────────────────────────────────────

/**
 * Synchronize a single inventory item across all platforms except the source.
 * Accepts a pre-built context to avoid redundant API calls in bulk operations.
 */
export async function syncInventoryItemAcrossPlatforms(
  item: SyncItem,
  context?: SyncContext
): Promise<CrossPlatformSyncResult> {
  const { inventoryId, quantityDelta, sourcePlatform, onlyPlatforms } = item;
  const source = sourcePlatform.toLowerCase();

  console.log(`\n🌐 Cross-platform sync: inventory ${inventoryId} delta=${quantityDelta > 0 ? '+' : ''}${quantityDelta} (source: ${sourcePlatform}${onlyPlatforms ? ` | only: ${onlyPlatforms.join(',')}` : ''})`);

  const platformResults: PlatformSyncResult[] = [];

  /**
   * shouldRun(name) — returns true if this platform should be updated.
   * A platform is skipped when:
   *   a) it is the sale source (it already manages its own inventory), OR
   *   b) onlyPlatforms is set and this platform is not in the list.
   *
   * When adding a new channel (eBay, Amazon, …), wrap its update block with
   * shouldRun('ChannelName') — the retry system automatically targets just the
   * failed channel via onlyPlatforms without any further changes needed here.
   */
  const shouldRun = (platformName: string) => {
    if (source === platformName.toLowerCase()) return false;
    if (onlyPlatforms && !onlyPlatforms.includes(platformName)) return false;
    return true;
  };

  // BrickLink
  if (shouldRun('BrickLink')) {
    const result = await updateBrickLinkQuantityDelta(item);
    platformResults.push({
      platform: 'BrickLink',
      success: result.success,
      itemsUpdated: result.success ? 1 : 0,
      errors: result.error ? [result.error] : [],
    });
    await new Promise(resolve => setTimeout(resolve, 150));
  } else {
    console.log(`⏭️  Skipping BrickLink (${source === 'bricklink' ? 'source platform' : 'not in onlyPlatforms'})`);
  }

  // BrickOwl
  if (shouldRun('BrickOwl')) {
    const boInventoryMap = context?.boInventoryMap ?? new Map();
    const result = await updateBrickOwlQuantity(item, boInventoryMap);
    platformResults.push({
      platform: 'BrickOwl',
      success: result.success,
      itemsUpdated: result.success ? 1 : 0,
      errors: result.error ? [result.error] : [],
    });
  } else {
    console.log(`⏭️  Skipping BrickOwl (${source === 'brickowl' ? 'source platform' : 'not in onlyPlatforms'})`);
  }

  // ── Add new channels here following the same pattern ──────────────────────
  // if (shouldRun('eBay')) { ... }
  // if (shouldRun('Amazon')) { ... }

  const totalItemsUpdated = platformResults.reduce((sum, r) => sum + r.itemsUpdated, 0);
  const totalErrors = platformResults.reduce((sum, r) => sum + r.errors.length, 0);

  console.log(`🌐 Cross-platform sync complete: ${totalItemsUpdated} platforms updated, ${totalErrors} errors`);

  return {
    success: platformResults.every(r => r.success),
    platforms: platformResults,
    totalItemsUpdated,
    totalErrors,
  };
}

/**
 * Bulk synchronization: Update multiple inventory items across all platforms.
 *
 * BL inventory IDs are resolved to BO channel lot IDs via two lookups:
 *   1. channelLotLinks table — fast local DB lookup, populated by channel sync (preferred).
 *   2. Live BO inventory via external_lot_ids.other — fallback for lots created before
 *      the channelLotLinks feature was deployed. Requires the channel sync to have set
 *      external_id on the BO lot when it was created.
 *
 * Runs as fire-and-forget — callers should not await this for order processing
 * to remain fast.
 */
export async function syncMultipleItemsAcrossPlatforms(
  items: SyncItem[]
): Promise<void> {
  console.log(`\n🌐 Starting bulk cross-platform sync for ${items.length} items...`);

  // Determine orgId for BrickOwl lookup (use the first item's org; all items in a
  // single bulk sync should belong to the same org).
  const orgId = items[0]?.orgId;

  // ── Primary: resolve BL→BO lot IDs from the local channel_lot_links table ──
  // This is a single indexed DB query — no external API call needed.
  let boInventoryMap = new Map<string, any>();
  const blInvIds = items
    .map(i => parseInt(i.inventoryId, 10))
    .filter(id => !isNaN(id));

  try {
    if (blInvIds.length > 0 && orgId) {
      const links = await db
        .select({ blInvId: channelLotLinks.blInvId, channelLotId: channelLotLinks.channelLotId })
        .from(channelLotLinks)
        .where(and(eq(channelLotLinks.orgId, orgId), eq(channelLotLinks.channel, BO_CHANNEL), inArray(channelLotLinks.blInvId, blInvIds)));
      for (const link of links) {
        boInventoryMap.set(String(link.blInvId), { lot_id: link.channelLotId });
      }
      console.log(`🌐 Resolved ${boInventoryMap.size}/${blInvIds.length} BL→BO lot links from local table`);
    }
  } catch (err: any) {
    console.warn(`⚠️ Could not query channel_lot_links — will fall back to live BO inventory: ${err.message}`);
  }

  // ── Fallback: fetch live BO inventory for items not yet in channel_lot_links ──
  // Covers lots created before this feature was deployed. Once the channel sync
  // has run at least once for an org, this fallback path will never trigger.
  const unresolved = blInvIds.filter(id => !boInventoryMap.has(String(id)));
  if (unresolved.length > 0) {
    console.log(`🌐 ${unresolved.length} items not in channel_lot_links — falling back to live BO inventory fetch`);
    try {
      const boInventory = await getBrickOwlInventory(false, orgId);
      for (const lot of boInventory) {
        const extId = lot.external_lot_ids?.other;
        if (extId && !boInventoryMap.has(extId)) {
          boInventoryMap.set(extId, lot);
        }
      }
      console.log(`🌐 Fallback BO inventory fetched: ${boInventoryMap.size} total lots now indexed`);
    } catch (err: any) {
      console.warn(`⚠️ Could not fetch live BO inventory for fallback: ${err.message}`);
    }
  }

  const context: SyncContext = { boInventoryMap };

  const syncPromises = items.map(item =>
    syncInventoryItemAcrossPlatforms(item, context).catch(error => {
      console.error(`✗ Cross-platform sync failed for ${item.inventoryId}:`, error);
    })
  );

  Promise.allSettled(syncPromises).then(results => {
    const successful = results.filter(r => r.status === 'fulfilled').length;
    console.log(`🌐 Bulk sync completed: ${successful}/${items.length} items synced across platforms`);
  });
}

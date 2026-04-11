import { db } from '../db';
import { crossPlatformSyncQueue, blInventory, channelLotLinks } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { syncInventoryItemAcrossPlatforms, SyncContext } from './cross-platform-sync';
import { getBrickOwlInventory } from './brickowl';
import { recordSyncIssue } from './sync-issue-service';

const MAX_RETRY_ATTEMPTS = 10;
const BO_CHANNEL = 'brickowl' as const;

/**
 * Retry all pending cross-platform qty sync failures for the given org.
 *
 * Called by the order-sync-scheduler after each successful sync cycle so that
 * failures caused by temporary BL/BO downtime are automatically healed.
 *
 * Strategy:
 *  - BrickLink target: uses the original quantityDelta (BL never received it).
 *  - BrickOwl target: reads current local qty at retry time (absolute update is
 *    always correct, even if multiple orders have since arrived).
 *  - After MAX_RETRY_ATTEMPTS failures, marks as 'abandoned' and records a
 *    critical sync issue visible in DashboardNotifications.
 */
export async function retryFailedCrossPlatformSyncs(orgId: string): Promise<void> {
  const pending = await db
    .select()
    .from(crossPlatformSyncQueue)
    .where(and(
      eq(crossPlatformSyncQueue.orgId, orgId),
      eq(crossPlatformSyncQueue.status, 'pending'),
    ));

  if (pending.length === 0) return;

  console.log(`\n🔄 [Retry] ${pending.length} pending cross-platform sync(s) to retry...`);

  // Pre-build the BO lot map for any BO-target items — one DB query covers all.
  const boTargetItems = pending.filter(i => i.targetPlatform === 'BrickOwl');
  let boInventoryMap: SyncContext['boInventoryMap'] = new Map();

  if (boTargetItems.length > 0) {
    try {
      const links = await db
        .select({ blInvId: channelLotLinks.blInvId, channelLotId: channelLotLinks.channelLotId })
        .from(channelLotLinks)
        .where(and(eq(channelLotLinks.orgId, orgId), eq(channelLotLinks.channel, BO_CHANNEL)));
      for (const link of links) {
        boInventoryMap.set(String(link.blInvId), { lot_id: link.channelLotId });
      }
      console.log(`🔄 [Retry] Resolved ${boInventoryMap.size} BL→BO lot links from local table`);
    } catch (err: any) {
      console.warn(`⚠️ [Retry] Could not query channel_lot_links: ${err.message} — falling back to live BO inventory`);
      try {
        const boInventory = await getBrickOwlInventory(false, orgId);
        for (const lot of boInventory) {
          const extId = lot.external_lot_ids?.other;
          if (extId && !boInventoryMap.has(extId)) boInventoryMap.set(extId, lot);
        }
      } catch (e: any) {
        console.warn(`⚠️ [Retry] Live BO inventory fallback also failed: ${e.message}`);
      }
    }
  }

  for (const item of pending) {
    const newRetryCount = item.retryCount + 1;
    const now = new Date();

    try {
      // Read current local quantity for BO absolute updates.
      const [inv] = await db
        .select({ quantity: blInventory.quantity, itemNo: blInventory.itemNo })
        .from(blInventory)
        .where(eq(blInventory.id, item.blInventoryId));

      if (!inv) throw new Error(`Local inventory ${item.blInventoryId} not found — lot may have been deleted`);

      const result = await syncInventoryItemAcrossPlatforms(
        {
          inventoryId: String(item.blInventoryId),
          newQuantity: inv.quantity,         // current local qty (correct for BO absolute)
          quantityDelta: item.quantityDelta, // original delta (correct for BL delta)
          sourcePlatform: item.sourcePlatform,
          orgId,
          orderId: item.sourceOrderId ?? undefined,
          itemNo: inv.itemNo,
          isRetry: true,                     // prevents re-enqueue if this attempt also fails
          // Pin to exactly the failed platform — works correctly regardless of how many
          // channels exist (eBay, Amazon, etc.). No changes needed here when new channels
          // are added to syncInventoryItemAcrossPlatforms.
          onlyPlatforms: [item.targetPlatform],
        },
        { boInventoryMap },
      );

      if (!result.success) {
        const platformErrors = result.platforms
          .filter(p => !p.success)
          .map(p => `${p.platform}: ${p.errors.join(', ')}`)
          .join('; ');
        throw new Error(platformErrors || `${item.targetPlatform} sync returned failure without details`);
      }

      await db
        .update(crossPlatformSyncQueue)
        .set({ status: 'done', retryCount: newRetryCount, lastAttemptAt: now, lastError: null })
        .where(eq(crossPlatformSyncQueue.id, item.id));

      console.log(`✓ [Retry] ${item.targetPlatform} qty sync succeeded for inventory ${item.blInventoryId} (attempt ${newRetryCount})`);

    } catch (err: any) {
      const abandoned = newRetryCount >= MAX_RETRY_ATTEMPTS;
      await db
        .update(crossPlatformSyncQueue)
        .set({
          retryCount: newRetryCount,
          lastAttemptAt: now,
          lastError: err.message,
          status: abandoned ? 'abandoned' : 'pending',
        })
        .where(eq(crossPlatformSyncQueue.id, item.id));

      if (abandoned) {
        console.warn(`⚠️ [Retry] Exhausted ${MAX_RETRY_ATTEMPTS} retries for ${item.targetPlatform} inventory ${item.blInventoryId} — abandoning`);
        await recordSyncIssue({
          syncType: 'cross_platform_sync',
          platform: item.targetPlatform.toLowerCase(),
          itemId: String(item.blInventoryId),
          issueType: 'retry_exhausted',
          issueDescription: `Qty sync to ${item.targetPlatform} permanently failed for inventory ${item.blInventoryId}${item.sourceOrderId ? ` (order ${item.sourceOrderId})` : ''} after ${MAX_RETRY_ATTEMPTS} retries. Manual update required. Last error: ${err.message}`,
          severity: 'critical',
          metadata: {
            blInventoryId: item.blInventoryId,
            targetPlatform: item.targetPlatform,
            sourceOrderId: item.sourceOrderId,
            quantityDelta: item.quantityDelta,
            lastError: err.message,
          },
        });
      } else {
        console.warn(`⚠️ [Retry] Attempt ${newRetryCount}/${MAX_RETRY_ATTEMPTS} failed for ${item.targetPlatform} inventory ${item.blInventoryId}: ${err.message}`);
      }
    }
  }

  console.log(`🔄 [Retry] Retry cycle complete`);
}

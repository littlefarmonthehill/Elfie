/**
 * Central registry of all selling-channel order-sync adapters.
 *
 * To add a new selling channel:
 *   1. Create `server/services/{channel}-order-sync.ts` exporting a
 *      `sync{Channel}Orders` function and wrap it in an adapter class below.
 *   2. Add an instance of that adapter to CHANNEL_ORDER_SYNCS.
 *
 * Everything else — scheduling, retry, inventory adjustment, cross-platform
 * sync, SSE broadcast, push notifications, embeddings — is handled automatically
 * by the shared core (order-sync-core.ts / order-sync-scheduler.ts).
 */

import type {
  IChannelOrderSync,
  ChannelOrderSyncOptions,
  OrderSyncProgressCallback,
  ChannelOrderSyncResult,
} from "./channel-order-sync-interface";

// ── BrickLink ─────────────────────────────────────────────────────────────────

class BrickLinkOrderSyncAdapter implements IChannelOrderSync {
  readonly channelKey      = 'bricklink';
  readonly label           = 'BrickLink';
  readonly marketplaceName = 'BrickLink';

  isConfigured(s: any): boolean {
    return !!(
      s.bricklinkConsumerKey &&
      s.bricklinkConsumerSecret &&
      s.bricklinkTokenValue &&
      s.bricklinkTokenSecret
    );
  }

  async syncOrders(
    s: any,
    orgId: string,
    options: ChannelOrderSyncOptions,
    onProgress: OrderSyncProgressCallback,
  ): Promise<ChannelOrderSyncResult> {
    const { syncBrickLinkOrders } = await import('./bricklink-order-sync');
    return syncBrickLinkOrders(
      s.bricklinkConsumerKey,
      s.bricklinkConsumerSecret,
      s.bricklinkTokenValue,
      s.bricklinkTokenSecret,
      orgId,
      options,
      onProgress,
    );
  }
}

// ── BrickOwl ──────────────────────────────────────────────────────────────────

class BrickOwlOrderSyncAdapter implements IChannelOrderSync {
  readonly channelKey      = 'brickowl';
  readonly label           = 'BrickOwl';
  readonly marketplaceName = 'BrickOwl';

  isConfigured(s: any): boolean {
    return !!s.brickowlApiKey;
  }

  async syncOrders(
    s: any,
    orgId: string,
    options: ChannelOrderSyncOptions,
    onProgress: OrderSyncProgressCallback,
  ): Promise<ChannelOrderSyncResult> {
    const { syncBrickOwlOrders } = await import('./brickowl-order-sync');
    return syncBrickOwlOrders(s.brickowlApiKey, orgId, options, onProgress);
  }
}

// ── eBay ──────────────────────────────────────────────────────────────────────
// eBay credentials live in org_integrations (not app_settings), so isConfigured
// always returns true — syncEbayOrders handles the "not configured" path itself.

class EbayOrderSyncAdapter implements IChannelOrderSync {
  readonly channelKey      = 'ebay';
  readonly label           = 'eBay';
  readonly marketplaceName = 'eBay';

  isConfigured(_s: any): boolean {
    return true;
  }

  async syncOrders(
    _s: any,
    orgId: string,
    options: ChannelOrderSyncOptions,
    onProgress: OrderSyncProgressCallback,
  ): Promise<ChannelOrderSyncResult> {
    const { syncEbayOrders } = await import('./ebay-order-sync');
    return syncEbayOrders(orgId, options, onProgress);
  }
}

// ── Registry ──────────────────────────────────────────────────────────────────
// Order determines sync stagger timing in the scheduler (30 s between each).

export const CHANNEL_ORDER_SYNCS: IChannelOrderSync[] = [
  new BrickLinkOrderSyncAdapter(),
  new BrickOwlOrderSyncAdapter(),
  new EbayOrderSyncAdapter(),
];

/** Look up a channel adapter by its channelKey. */
export function getChannelOrderSync(channelKey: string): IChannelOrderSync | undefined {
  return CHANNEL_ORDER_SYNCS.find(c => c.channelKey === channelKey);
}

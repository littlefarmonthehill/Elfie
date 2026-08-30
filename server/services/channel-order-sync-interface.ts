/**
 * Common interface for all selling-channel order sync adapters.
 *
 * Every channel (BrickLink, BrickOwl, eBay, …) that can receive orders
 * must implement this interface so `order-sync-core.ts` can drive it the
 * same way regardless of channel-specific API details.
 *
 * To add a new selling channel:
 *   1. Create `server/services/{channel}-order-sync.ts` implementing IChannelOrderSync.
 *   2. Import and register the instance in `channel-order-registry.ts`.
 *
 * Scheduling, progress tracking, retry back-off, and cross-platform inventory
 * adjustment are all handled automatically by the shared core — channel adapters
 * only need to worry about fetching and normalising orders from their own API.
 */

export interface ChannelOrderSyncOptions {
  limit?: number;
  fullSync?: boolean;
  /** ISO date string — when set, treat as a from-date full sync */
  sinceDate?: string;
}

export type OrderSyncProgressCallback = (processed: number, total: number) => void;

export interface ChannelOrderSyncResult {
  ordersAdded: number;
  /**
   * Local order IDs that were verified as fresh customer orders during this
   * sync run. This is intentionally separate from ordersAdded because channel
   * adapters may also count internal fulfillment records (such as merge
   * deltas) there.
   */
  newOrderIds?: string[];
  ordersUpdated?: number;
  errors?: string[];
}

/**
 * Notification callers must only use IDs explicitly returned by a channel
 * adapter, never a broad records-added count or a recency query.
 */
export function getVerifiedNewOrderIds(
  outcome: Pick<ChannelOrderSyncResult, 'newOrderIds'> | undefined,
): string[] {
  return [...new Set(outcome?.newOrderIds ?? [])];
}

export interface IChannelOrderSync {
  /**
   * Unique snake_case key for this channel.
   * Used as the sync_metadata.id suffix, progress map key, and log labels.
   * Examples: 'bricklink', 'brickowl', 'ebay'
   */
  readonly channelKey: string;

  /** Human-readable display label for logs and UI. e.g. 'BrickLink', 'eBay' */
  readonly label: string;

  /**
   * The exact string stored in orders.marketplace column.
   * e.g. 'BrickLink', 'BrickOwl', 'eBay'
   */
  readonly marketplaceName: string;

  /**
   * Returns true if this channel has valid credentials for the given org settings row.
   * Receives the org's app_settings row.
   *
   * For channels whose credentials live in org_integrations (like eBay) rather than
   * app_settings, always return true — let syncOrders handle the "not configured" case.
   */
  isConfigured(orgSettings: any): boolean;

  /**
   * Run the order sync for a single org.
   *
   * Responsible for:
   *   - Fetching new/updated orders from the channel API
   *   - Upserting them into the local `orders` and `order_details` tables
   *   - Calling adjustInventoryForOrder (which handles cross-platform push)
   *   - Updating sync_metadata with status and record counts
   *
   * The shared core handles: lock acquisition, progress tracking, retry back-off,
   * SSE broadcast, push notifications, and embedding generation.
   */
  syncOrders(
    orgSettings: any,
    orgId: string,
    options: ChannelOrderSyncOptions,
    onProgress: OrderSyncProgressCallback,
  ): Promise<ChannelOrderSyncResult>;
}

/**
 * IChannelSync — Channel Sync Adapter Interface
 *
 * Every sales channel integration (BrickOwl, Amazon, eBay, …) must implement
 * this interface. It is the channel equivalent of IShippingVendor.
 *
 * Adding a new channel:
 *  1. Create a new file, e.g. amazon-channel-adapter.ts
 *  2. Implement IChannelSync
 *  3. Register it in getChannelAdapter() in channel-factory.ts
 */

export interface ChannelSyncOptions {
  mode:        'analysis' | 'full_control' | 'matched_sync';
  fullScan?:   boolean;
  sinceTime?:  Date;
  onProgress?: (processed: number, total: number) => void;
}

export interface ChannelSyncResult {
  lotsCreated:   number;
  lotsUpdated:   number;
  lotsSkipped:   number;
  lotsDeleted?:  number;
  errors:        string[];
  totalApiCalls: number;
}

export interface ConnectionTestResult {
  ok:       boolean;
  message?: string;
}

export interface IChannelSync {
  /** The registry key for this channel — must match PROVIDER_REGISTRY */
  readonly channelKey: string;

  /**
   * Push the org's BrickLink inventory to this channel.
   * Called by both the scheduler and manual sync routes.
   */
  syncFromBrickLink(orgId: string, options: ChannelSyncOptions): Promise<ChannelSyncResult>;

  /**
   * Verify that the provided credentials can reach the channel API.
   * Called when a user connects or re-tests an integration.
   */
  testConnection(orgId: string, credentials: Record<string, string>): Promise<ConnectionTestResult>;
}

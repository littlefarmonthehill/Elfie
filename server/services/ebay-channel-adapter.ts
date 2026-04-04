/**
 * eBay Channel Adapter
 *
 * Implements IChannelSync for eBay using the eBay Sell Inventory API.
 * Follows the same pattern as BrickOwlChannelAdapter.
 */

import type { IChannelSync, ChannelSyncOptions, ChannelSyncResult, ConnectionTestResult } from './channel-sync-interface';
import {
  syncBrickLinkToEbay,
  testEbayConnection,
  defaultEbayChannelConfig,
  type EbayChannelConfig,
} from './ebay';
import { db } from '../db';
import { channelSyncConfig } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

function getServerOrigin(): string {
  // Prefer REPLIT_DOMAINS for public-facing URL (used by eBay to crawl images)
  const domains = process.env.REPLIT_DOMAINS ?? '';
  const first = domains.split(',')[0]?.trim();
  if (first) return `https://${first}`;

  // Fallback for local dev
  const port = process.env.PORT ?? '5000';
  return `http://localhost:${port}`;
}

export class EbayChannelAdapter implements IChannelSync {
  readonly channelKey = 'ebay';

  async syncFromBrickLink(orgId: string, options: ChannelSyncOptions): Promise<ChannelSyncResult> {
    // Read eBay-specific channel config
    let channelConfig_: EbayChannelConfig = { ...defaultEbayChannelConfig };
    try {
      const [cfgRow] = await db
        .select()
        .from(channelSyncConfig)
        .where(and(eq(channelSyncConfig.orgId, orgId), eq(channelSyncConfig.channelKey, 'ebay')))
        .limit(1);
      if (cfgRow) {
        channelConfig_ = {
          ...defaultEbayChannelConfig,
          ...(cfgRow.channelConfig as Partial<EbayChannelConfig>),
          syncItemTypes: (cfgRow.syncItemTypes as Record<string, boolean>) ?? {},
          syncPriceFloor: cfgRow.syncPriceFloor != null ? Number(cfgRow.syncPriceFloor) : null,
          syncStockroomModes: (cfgRow.syncStockroomModes as Record<string, 'skip' | 'active'>) ?? { A: 'skip', B: 'skip', C: 'skip' },
        };
      }
    } catch { /* use defaults */ }

    const serverOrigin = getServerOrigin();

    const result = await syncBrickLinkToEbay(
      options.mode,
      options.onProgress,
      channelConfig_,
      orgId,
      serverOrigin,
    );

    return {
      lotsCreated:   result.lotsCreated,
      lotsUpdated:   result.lotsUpdated,
      lotsSkipped:   result.lotsSkipped,
      errors:        result.errors,
      totalApiCalls: result.totalApiCalls,
    };
  }

  async testConnection(orgId: string, _credentials: Record<string, string>): Promise<ConnectionTestResult> {
    return testEbayConnection(orgId);
  }
}

/**
 * BrickOwl Channel Adapter
 *
 * Implements IChannelSync for BrickOwl by wrapping the existing
 * syncBrickLinkToBrickOwl function. This is the first adapter in the
 * channel registry — future channels (Amazon, eBay) follow the same pattern.
 */

import type { IChannelSync, ChannelSyncOptions, ChannelSyncResult, ConnectionTestResult, FeedbackPayload, FeedbackResult } from './channel-sync-interface';
import { syncBrickLinkToBrickOwl, defaultSyncFields, SyncFieldConfig, postBrickOwlFeedback } from './brickowl';
import { db } from '../db';
import { channelSyncConfig, appSettings } from '@shared/schema';
import { eq } from 'drizzle-orm';

export class BrickOwlChannelAdapter implements IChannelSync {
  readonly channelKey = 'brickowl';

  async syncFromBrickLink(orgId: string, options: ChannelSyncOptions): Promise<ChannelSyncResult> {
    // Read sync field config for this org (mirrors what the scheduler does)
    let syncFields: SyncFieldConfig = { ...defaultSyncFields };
    try {
      const [cfgRow] = await db
        .select()
        .from(channelSyncConfig)
        .where(eq(channelSyncConfig.orgId, orgId))
        .limit(1);
      if (cfgRow) {
        syncFields = {
          price:          cfgRow.syncPrice,
          remarks:        cfgRow.syncRemarks,
          description:    cfgRow.syncDescription,
          tierPrice:      cfgRow.syncTierPrice,
          salePercent:    cfgRow.syncSalePercent,
          bulkQty:        cfgRow.syncBulkQty,
          lotWeight:      cfgRow.syncLotWeight,
          stockroomModes: (cfgRow.syncStockroomModes as Record<string, 'skip' | 'hidden' | 'active'>) ?? { A: 'skip', B: 'skip', C: 'skip' },
          syncItemTypes:  (cfgRow.syncItemTypes as Record<string, boolean>) ?? {},
        };
      }
    } catch { /* use defaults */ }

    const result = await syncBrickLinkToBrickOwl(
      undefined,
      options.mode,
      options.onProgress,
      syncFields,
      options.sinceTime,
      orgId,
    );

    return {
      lotsCreated:   result.lotsCreated,
      lotsUpdated:   result.lotsUpdated,
      lotsSkipped:   result.lotsSkipped,
      errors:        result.errors,
      totalApiCalls: result.totalApiCalls,
    };
  }

  async postFeedback(orgId: string, payload: FeedbackPayload): Promise<FeedbackResult> {
    const ratingMap: Record<string, 1 | 3 | 5> = { positive: 5, neutral: 3, negative: 1 };
    const rating = ratingMap[payload.rating] ?? 5;
    try {
      await postBrickOwlFeedback(payload.channelOrderId, rating, payload.comment ?? '', orgId);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, message: err.message ?? 'BrickOwl feedback failed' };
    }
  }

  async testConnection(orgId: string, _credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const [settings] = await db
        .select({ brickowlApiKey: appSettings.brickowlApiKey })
        .from(appSettings)
        .where(eq(appSettings.id, orgId))
        .limit(1);
      if (!settings?.brickowlApiKey) {
        return { ok: false, message: 'No BrickOwl API key configured. Add it in Settings → Platform Connections.' };
      }
      // Lightweight connectivity check: fetch the first page of inventory
      const url = new URL('https://api.brickowl.com/v1/inventory/list');
      url.searchParams.set('key', settings.brickowlApiKey);
      url.searchParams.set('active_only', '0');
      const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) {
        return { ok: false, message: `BrickOwl API returned ${resp.status} ${resp.statusText}` };
      }
      return { ok: true, message: 'Connected successfully' };
    } catch (e: any) {
      return { ok: false, message: e.message ?? 'Connection test failed' };
    }
  }
}

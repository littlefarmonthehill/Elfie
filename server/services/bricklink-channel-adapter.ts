/**
 * BrickLink Channel Adapter
 *
 * Implements IChannelSync for BrickLink.
 * syncFromBrickLink is a no-op here (BrickLink IS the source of truth for inventory).
 * The primary purpose of this adapter is postFeedback().
 *
 * Adding BrickLink as a channel target in the future (e.g. syncing BO→BL)
 * would be implemented in syncFromBrickLink.
 */

import type { IChannelSync, ChannelSyncOptions, ChannelSyncResult, ConnectionTestResult, FeedbackPayload, FeedbackResult } from './channel-sync-interface';
import { postBrickLinkFeedback } from './bricklink';

// BL API: rating is an integer — 0=Praise, 1=Neutral, 2=Complaint (NOT string letters)
const RATING_MAP: Record<string, 0 | 1 | 2> = {
  positive: 0,
  neutral:  1,
  negative: 2,
};

export class BrickLinkChannelAdapter implements IChannelSync {
  readonly channelKey = 'bricklink';

  async syncFromBrickLink(_orgId: string, _options: ChannelSyncOptions): Promise<ChannelSyncResult> {
    return { lotsCreated: 0, lotsUpdated: 0, lotsSkipped: 0, errors: [], totalApiCalls: 0 };
  }

  async testConnection(_orgId: string, _credentials: Record<string, string>): Promise<ConnectionTestResult> {
    return { ok: true, message: 'BrickLink credentials are managed via OAuth — test via Settings.' };
  }

  async postFeedback(orgId: string, payload: FeedbackPayload): Promise<FeedbackResult> {
    const rating = RATING_MAP[payload.rating] ?? 0;
    try {
      await postBrickLinkFeedback(payload.channelOrderId, rating, payload.comment ?? '', orgId);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, message: err.message ?? 'BrickLink feedback failed' };
    }
  }
}

/**
 * Channel Factory
 *
 * Returns the correct IChannelSync adapter for a given channel key.
 * To add a new channel:
 *   1. Write your adapter (implements IChannelSync)
 *   2. Add one case here
 *   3. Add the provider to PROVIDER_REGISTRY in provider-registry.ts
 */

import type { IChannelSync } from './channel-sync-interface';
import { BrickOwlChannelAdapter } from './brickowl-channel-adapter';
import { BrickLinkChannelAdapter } from './bricklink-channel-adapter';

const adapterCache: Record<string, IChannelSync> = {};

export function getChannelAdapter(channelKey: string): IChannelSync {
  if (adapterCache[channelKey]) return adapterCache[channelKey];

  let adapter: IChannelSync;

  switch (channelKey.toLowerCase()) {
    case 'brickowl':
      adapter = new BrickOwlChannelAdapter();
      break;

    case 'bricklink':
      adapter = new BrickLinkChannelAdapter();
      break;

    // Future channels — add cases here:
    // case 'amazon':
    //   adapter = new AmazonChannelAdapter();
    //   break;
    // case 'ebay':
    //   adapter = new EbayChannelAdapter();
    //   break;

    default:
      throw new Error(`No channel adapter registered for "${channelKey}". Add it to channel-factory.ts.`);
  }

  adapterCache[channelKey] = adapter;
  return adapter;
}

export function getSupportedChannelKeys(): string[] {
  return ['brickowl', 'bricklink']; // extend as adapters are added
}

/**
 * Shipping Provider Factory
 *
 * Returns the correct IShippingVendor for the org's active shipping integration.
 * Reads from orgIntegrations first; falls back to appSettings (EasyPost legacy)
 * so existing orgs keep working without a data migration.
 *
 * To add a new shipping provider:
 *   1. Write a class that implements IShippingVendor (see easypost.ts for reference)
 *   2. Add a case in the switch below
 *   3. Add the provider to PROVIDER_REGISTRY in provider-registry.ts
 */

import { db } from '../db';
import { orgIntegrations } from '@shared/schema';
import { and, eq } from 'drizzle-orm';
import type { IShippingVendor } from './shipping-vendor';

export async function getShippingProvider(orgId: string): Promise<IShippingVendor> {
  // 1. Look for an active shipping integration in orgIntegrations
  const [integration] = await db
    .select()
    .from(orgIntegrations)
    .where(
      and(
        eq(orgIntegrations.orgId, orgId),
        eq(orgIntegrations.type, 'shipping'),
        eq(orgIntegrations.isConnected, true),
      )
    )
    .limit(1);

  const providerKey = integration?.channel;
  const creds = (integration?.credentials as Record<string, string>) ?? {};

  switch (providerKey) {
    case 'easypost': {
      // Credentials stored in orgIntegrations take precedence over appSettings
      const apiKey = creds.mode === 'production'
        ? (creds.apiKey || undefined)
        : (creds.testApiKey || undefined);
      const { getShippingVendor } = await import('./easypost');
      return getShippingVendor(apiKey, orgId); // orgId used for appSettings fallback
    }

    case 'shipstation':
      // ShipStation implements order import (shipstation.ts) but not the
      // IShippingVendor label-buying interface yet. Throw a clear error.
      throw new Error('ShipStation label purchasing is not yet implemented. Use EasyPost for shipping labels.');

    // Future providers — add cases here:
    // case 'pirateship': {
    //   const { PirateshipVendor } = await import('./pirateship');
    //   return new PirateshipVendor(creds.apiKey);
    // }

    default:
      // No active integration in orgIntegrations — fall back to legacy appSettings path
      const { getShippingVendor } = await import('./easypost');
      return getShippingVendor(undefined, orgId);
  }
}

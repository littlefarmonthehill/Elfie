/**
 * Provider Registry
 *
 * Single source of truth for every integration E.L.F.I.E. supports or plans to support.
 * The UI reads this registry to render the "Available Integrations" catalogue.
 * The backend reads it to validate provider keys and credential shapes.
 *
 * Adding a new provider:
 *  1. Add an entry here.
 *  2. Write a service file that implements IChannelSync or IShippingVendor.
 *  3. Register it in the factory (getChannelAdapter / getShippingProvider).
 *  4. No other changes required.
 */

export type ProviderType   = 'sales_channel' | 'shipping';
export type ProviderStatus = 'live' | 'beta' | 'coming_soon';

export interface CredentialField {
  key:          string;
  label:        string;
  type:         'text' | 'password' | 'select';
  required:     boolean;
  placeholder?: string;
  helpText?:    string;
  options?:     { value: string; label: string }[];
}

export interface ProviderDefinition {
  key:               string;
  name:              string;
  type:              ProviderType;
  status:            ProviderStatus;
  description:       string;
  credentialFields:  CredentialField[];
  accentColor?:      string;
  docsUrl?:          string;
}

export const PROVIDER_REGISTRY: Record<string, ProviderDefinition> = {

  // ── Sales Channels ──────────────────────────────────────────────────────────

  brickowl: {
    key:         'brickowl',
    name:        'BrickOwl',
    type:        'sales_channel',
    status:      'live',
    description: 'Push your BrickLink inventory to BrickOwl and sync orders in both directions.',
    accentColor: 'cyan',
    docsUrl:     'https://www.brickowl.com/tools',
    credentialFields: [
      {
        key:         'apiKey',
        label:       'API Key',
        type:        'password',
        required:    true,
        helpText:    'Found in BrickOwl → Settings → API',
        placeholder: 'bo_…',
      },
    ],
  },

  amazon: {
    key:         'amazon',
    name:        'Amazon',
    type:        'sales_channel',
    status:      'coming_soon',
    description: 'List LEGO parts and sets on Amazon Marketplace via the Selling Partner API.',
    accentColor: 'orange',
    docsUrl:     'https://developer-docs.amazon.com/sp-api/',
    credentialFields: [
      { key: 'sellerId',  label: 'Seller ID',      type: 'text',     required: true  },
      { key: 'clientId',  label: 'LWA Client ID',  type: 'text',     required: true  },
      { key: 'clientSecret', label: 'LWA Client Secret', type: 'password', required: true },
      { key: 'refreshToken', label: 'Refresh Token', type: 'password', required: true },
      {
        key:      'region',
        label:    'Marketplace Region',
        type:     'select',
        required: true,
        options:  [
          { value: 'us',  label: 'United States (ATVPDKIKX0DER)' },
          { value: 'ca',  label: 'Canada (A2EUQ1WTGCTBG2)' },
          { value: 'uk',  label: 'United Kingdom (A1F83G8C2ARO7P)' },
          { value: 'de',  label: 'Germany (A1PA6795UKMFR9)' },
        ],
      },
    ],
  },

  ebay: {
    key:         'ebay',
    name:        'eBay',
    type:        'sales_channel',
    status:      'coming_soon',
    description: 'Sync inventory to eBay listings and import orders automatically.',
    accentColor: 'yellow',
    docsUrl:     'https://developer.ebay.com/',
    credentialFields: [
      { key: 'appId',     label: 'App ID (Client ID)', type: 'text',     required: true },
      { key: 'certId',    label: 'Cert ID',             type: 'password', required: true },
      { key: 'devId',     label: 'Dev ID',              type: 'text',     required: true },
      { key: 'userToken', label: 'OAuth User Token',    type: 'password', required: true },
    ],
  },

  // ── Shipping Providers ───────────────────────────────────────────────────────

  easypost: {
    key:         'easypost',
    name:        'EasyPost',
    type:        'shipping',
    status:      'live',
    description: 'Multi-carrier shipping labels with USPS, UPS, FedEx, and DHL via EasyPost.',
    accentColor: 'violet',
    docsUrl:     'https://docs.easypost.com/',
    credentialFields: [
      {
        key:         'apiKey',
        label:       'Production API Key',
        type:        'password',
        required:    false,
        placeholder: 'EZTKxxx…',
      },
      {
        key:         'testApiKey',
        label:       'Test API Key',
        type:        'password',
        required:    false,
        placeholder: 'EZTKtest_xxx…',
      },
      {
        key:      'mode',
        label:    'Active Mode',
        type:     'select',
        required: true,
        options:  [
          { value: 'test',       label: 'Test'       },
          { value: 'production', label: 'Production' },
        ],
      },
    ],
  },

  pirateship: {
    key:         'pirateship',
    name:        'Pirateship',
    type:        'shipping',
    status:      'coming_soon',
    description: 'Heavily discounted USPS and UPS rates with a simple API.',
    accentColor: 'blue',
    docsUrl:     'https://pirateship.com/api',
    credentialFields: [
      {
        key:      'apiKey',
        label:    'API Key',
        type:     'password',
        required: true,
      },
    ],
  },

  shipstation: {
    key:         'shipstation',
    name:        'ShipStation',
    type:        'shipping',
    status:      'live',
    description: 'Full-featured order and shipping management with multi-carrier support.',
    accentColor: 'blue',
    docsUrl:     'https://www.shipstation.com/docs/api/',
    credentialFields: [
      { key: 'apiKey',    label: 'API Key',    type: 'password', required: true },
      { key: 'apiSecret', label: 'API Secret', type: 'password', required: true },
    ],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getProviderDefinition(key: string): ProviderDefinition | undefined {
  return PROVIDER_REGISTRY[key];
}

export function getProvidersOfType(type: ProviderType): ProviderDefinition[] {
  return Object.values(PROVIDER_REGISTRY).filter(p => p.type === type);
}

export function getLiveProviders(type?: ProviderType): ProviderDefinition[] {
  return Object.values(PROVIDER_REGISTRY).filter(
    p => p.status === 'live' && (!type || p.type === type)
  );
}

export function getAllProviders(type?: ProviderType): ProviderDefinition[] {
  return Object.values(PROVIDER_REGISTRY).filter(
    p => !type || p.type === type
  );
}

/**
 * eBay Channel Service
 *
 * Implements BrickLink → eBay inventory synchronization using the eBay Sell Inventory API.
 *
 * Key design decisions:
 *  - PART items use Variation Listing model:
 *      Group key  → "GRP-{itemNo}-{condition}"  (one listing per part+condition)
 *      Variant SKU → "VAR-{itemNo}-{colorId}-{condition}"  (one per color)
 *  - Non-PART items (sets, minifigs, etc.) use the existing 1:1 model:
 *      SKU → "BL-{blInventoryId}"
 *  - Authentication: OAuth 2.0 Code Grant — refresh token stored in org_integrations.
 *  - Images: resolved from the image center (lot-level > item-type-level > catalog),
 *    served via our /api/user-images/:key proxy so eBay can crawl them.
 *  - Catalog matching: for Sets, we add structured aspects that eBay can match.
 *  - Industry best practices: Fixed Price (BIN), GTC duration, LEGO categories.
 */

import { db } from '../db';
import { blInventory, blColors, blCatalog, channelLotLinks, orgIntegrations, channelSyncConfig, platformSettings } from '@shared/schema';
import { eq, and, inArray, isNull, isNotNull } from 'drizzle-orm';
import { getImagesForLot } from './user-image-store';

const EBAY_CHANNEL = 'ebay' as const;

// ── eBay Category IDs for LEGO ─────────────────────────────────────────────
export const EBAY_LEGO_CATEGORIES: Record<string, string> = {
  S: '19006',  // Complete Sets & Packs
  P: '18076',  // Bricks & Building Pieces
  M: '11731',  // Minifigures
  G: '11726',  // LEGO Gear
  B: '11481',  // LEGO Instruction Books
};

// ── eBay Condition enums ───────────────────────────────────────────────────
export const EBAY_CONDITIONS = {
  NEW:             'NEW',
  USED_VERY_GOOD:  'USED_VERY_GOOD',
  USED_GOOD:       'USED_GOOD',
  USED_ACCEPTABLE: 'USED_ACCEPTABLE',
} as const;

// ── eBay OAuth scopes ──────────────────────────────────────────────────────
const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
].join(' ');

// ── Token cache ────────────────────────────────────────────────────────────
const tokenCache: Map<string, { accessToken: string; expiresAt: number }> = new Map();

// ── Merchant location key (created via API) ────────────────────────────────
const MERCHANT_LOCATION_KEY = 'MAIN_WAREHOUSE';

// ── Type definitions ───────────────────────────────────────────────────────

export interface EbayChannelConfig {
  ebayBlIdField:          'custom_label' | 'item_specifics';
  ebayCatalogMatch:       boolean;
  ebayListingDuration:    string;
  syncImages:             boolean;
  syncDescription:        boolean;
  ebayMarketplaceId:      string;
  ebayConditionUsed:      string;
  ebayPriceUpliftPercent: number;
  priceSyncMode:          'always' | 'initial_only';
  ebayFulfillmentPolicyId?: string;
  ebayPaymentPolicyId?:     string;
  ebayReturnPolicyId?:      string;
  syncItemTypes:          Record<string, boolean>;
  syncPriceFloor:         number | null;
  syncStockroomModes:     Record<string, 'skip' | 'active'>;
}

export const defaultEbayChannelConfig: EbayChannelConfig = {
  ebayBlIdField:          'custom_label',
  ebayCatalogMatch:       true,
  ebayListingDuration:    'GTC',
  syncImages:             true,
  syncDescription:        true,
  ebayMarketplaceId:      'EBAY_US',
  ebayConditionUsed:      'USED_VERY_GOOD',
  ebayPriceUpliftPercent: 0,
  priceSyncMode:          'always',
  syncItemTypes:          {},
  syncPriceFloor:         null,
  syncStockroomModes:     { A: 'skip', B: 'skip', C: 'skip' },
};

// BrickLink color name → official LEGO color name mapping
const BL_TO_LEGO_COLOR: Record<string, string> = {
  'Dark Bluish Gray':       'Dark Stone Grey',
  'Light Bluish Gray':      'Medium Stone Grey',
  'Very Light Bluish Gray': 'White Glow',
  'Flat Silver':            'Silver Metallic',
  'Chrome Silver':          'Chrome Silver',
  'Pearl Dark Gray':        'Titanium Metallic',
  'Pearl Light Gray':       'Silver Drum Lacquered',
  'Medium Stone Gray':      'Medium Stone Grey',
  'Warm Gold':              'Warm Gold',
  'Flat Dark Gold':         'Warm Gold',
  'Chrome Gold':            'Chrome Gold',
  'Pearl Gold':             'Warm Gold',
  'Reddish Brown':          'Reddish Brown',
  'Dark Orange':            'Dark Orange',
  'Sand Yellow':            'Brick Yellow',
  'Brick Yellow':           'Brick Yellow',
  'Medium Nougat':          'Medium Nougat',
  'Nougat':                 'Nougat',
  'Dark Nougat':            'Dark Nougat',
  'Maersk Blue':            'Maersk Blue',
  'Earth Orange':           'Dark Nougat',
  'Dark Green':             'Dark Green',
  'Sand Green':             'Sand Green',
  'Lime':                   'Bright Yellowish Green',
  'Yellow-Green':           'Bright Yellowish Green',
  'Medium Green':           'Medium Green',
  'Olive Green':            'Olive Green',
  'Dark Red':               'Dark Red',
  'Rust':                   'Rust',
  'Salmon':                 'Light Nougat',
  'Light Salmon':           'Light Nougat',
  'Dark Blue':              'Dark Blue',
  'Medium Blue':            'Medium Blue',
  'Sand Blue':              'Sand Blue',
  'Dark Purple':            'Dark Purple',
  'Medium Lavender':        'Medium Lilac',
  'Lavender':               'Lavender',
  'Dark Pink':              'Dark Pink',
  'Medium Dark Pink':       'Bright Pink',
  'Magenta':                'Magenta',
  'Trans-Clear':            'Transparent',
  'Trans-Black':            'Transparent Black Infrared',
  'Trans-Red':              'Transparent Red',
  'Trans-Orange':           'Transparent Fluorescent Red-Orange',
  'Trans-Neon Orange':      'Transparent Fluorescent Red-Orange',
  'Trans-Yellow':           'Transparent Yellow',
  'Trans-Neon Yellow':      'Transparent Fluorescent Yellow',
  'Trans-Green':            'Transparent Green',
  'Trans-Neon Green':       'Transparent Fluorescent Green',
  'Trans-Dark Blue':        'Transparent Blue',
  'Trans-Medium Blue':      'Transparent Medium Blue',
  'Trans-Purple':           'Transparent Violet',
  'Trans-Dark Pink':        'Transparent Pink',
  'Glow In Dark White':     'Phosphorescent White',
  'Glow In Dark Opaque':    'Phosphorescent Green',
};

function toLegoColorName(blColorName: string | null): string | null {
  if (!blColorName) return null;
  return BL_TO_LEGO_COLOR[blColorName] ?? blColorName;
}

export interface EbaySyncResult {
  lotsCreated:   number;
  lotsUpdated:   number;
  lotsSkipped:   number;
  errors:        string[];
  totalApiCalls: number;
  preview?: EbayAnalysisPreview;
}

export interface EbayAnalysisPreview {
  matchedLots:   number;
  unmatchedLots: number;
  wouldUpdate:   number;
  wouldCreate:   number;
  byField: {
    qty:         number;
    price:       number;
    description: number;
    images:      number;
  };
}

interface EbayCredentials {
  appId:        string;
  certId:       string;
  devId?:       string;
  refreshToken: string;
  environment:  'production' | 'sandbox';
}

interface EbayInventoryItem {
  sku:           string;
  quantity:      number;
  price:         string | null;
  title:         string | null;
  condition:     string | null;
  offerId?:      string;
  listingId?:    string;
  blInvId?:      number;
}

// ── Variation listing data structures ─────────────────────────────────────

interface PartVariant {
  variantSku:  string;
  colorId:     number;
  colorName:   string | null;
  condition:   string;           // 'N' | 'U'
  totalQty:    number;
  minPrice:    number;           // lowest unit price across contributing lots
  lots:        any[];
}

interface PartGroup {
  groupKey:            string;
  itemNo:              string;
  itemName:            string | null;
  condition:           string;   // 'N' | 'U'
  variants:            PartVariant[];
  primaryColorId:      number;   // colorId of most-stocked variant (for primary image)
}

// ── SKU / Key helpers ──────────────────────────────────────────────────────

/** Group key for a part variation listing: one per (itemNo, condition) */
function makeGroupKey(itemNo: string, condition: string): string {
  return `GRP-${itemNo}-${condition}`;
}

/** Variant SKU for a specific color within a part variation listing */
function makeVariantSku(itemNo: string, colorId: number, condition: string): string {
  return `VAR-${itemNo}-${colorId}-${condition}`;
}

/** Parse a variant SKU. Returns null if not a VAR- SKU. */
function parseVariantSku(sku: string): { itemNo: string; colorId: number; condition: string } | null {
  const match = sku.match(/^VAR-(.+?)-(\d+)-(N|U)$/);
  if (!match) return null;
  return { itemNo: match[1], colorId: parseInt(match[2], 10), condition: match[3] };
}

/** Parse a group key. Returns null if not a GRP- key. */
function parseGroupKey(key: string): { itemNo: string; condition: string } | null {
  const match = key.match(/^GRP-(.+)-(N|U)$/);
  if (!match) return null;
  return { itemNo: match[1], condition: match[2] };
}

/** Legacy SKU used by the 1:1 (non-PART) model */
function makeSku(blInvId: number | string): string {
  return `BL-${blInvId}`;
}

function parseSkuToBlInvId(sku: string): number | null {
  const match = sku.match(/^BL-(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

// ── OAuth / Credentials ────────────────────────────────────────────────────

async function loadEbayCredentials(orgId: string): Promise<EbayCredentials | null> {
  const [[psRow], [orgRow]] = await Promise.all([
    db.select().from(platformSettings).limit(1),
    db.select().from(orgIntegrations)
      .where(and(eq(orgIntegrations.orgId, orgId), eq(orgIntegrations.channel, 'ebay')))
      .limit(1),
  ]);

  const orgCreds = (orgRow?.credentials ?? {}) as Record<string, string>;
  const env = (orgCreds.environment as 'production' | 'sandbox') ?? 'production';

  if (env === 'sandbox') {
    const appId        = psRow?.ebaySandboxAppId  ?? orgCreds.sandboxAppId  ?? '';
    const certId       = psRow?.ebaySandboxCertId ?? orgCreds.sandboxCertId ?? '';
    const devId        = psRow?.ebaySandboxDevId  ?? orgCreds.sandboxDevId  ?? '';
    const refreshToken = orgCreds.sandboxRefreshToken ?? '';
    if (!appId || !certId || !refreshToken) return null;
    return { appId, certId, devId, refreshToken, environment: 'sandbox' };
  }

  const appId        = psRow?.ebayProdAppId  ?? orgCreds.appId  ?? '';
  const certId       = psRow?.ebayProdCertId ?? orgCreds.certId ?? '';
  const devId        = psRow?.ebayProdDevId  ?? orgCreds.devId  ?? '';
  const refreshToken = orgCreds.refreshToken ?? '';
  if (!appId || !certId || !refreshToken) return null;
  return { appId, certId, devId, refreshToken, environment: 'production' };
}

async function getAccessToken(orgId: string): Promise<string> {
  const cached = tokenCache.get(orgId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

  const creds = await loadEbayCredentials(orgId);
  if (!creds) throw new Error('[eBay] No eBay credentials configured for this org. Connect eBay in Settings → Platform Connections.');

  const baseUrl   = ebayBaseUrl(creds.environment);
  const basicAuth = Buffer.from(`${creds.appId}:${creds.certId}`).toString('base64');

  const resp = await fetch(`${baseUrl}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken, scope: EBAY_SCOPES }).toString(),
    signal:  AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`[eBay] Token refresh failed: ${resp.status} ${body}`);
  }

  const data: any  = await resp.json();
  const expiresIn: number = data.expires_in ?? 7200;
  const accessToken: string = data.access_token;
  tokenCache.set(orgId, { accessToken, expiresAt: Date.now() + expiresIn * 1000 });

  try {
    const [row] = await db.select().from(orgIntegrations)
      .where(and(eq(orgIntegrations.orgId, orgId), eq(orgIntegrations.channel, 'ebay'))).limit(1);
    if (row) {
      const existing = (row.credentials as Record<string, string>) ?? {};
      await db.update(orgIntegrations)
        .set({ credentials: { ...existing, accessToken, tokenExpiry: String(Date.now() + expiresIn * 1000) } })
        .where(eq(orgIntegrations.id, row.id));
    }
  } catch { /* non-critical */ }

  return accessToken;
}

// ── eBay API fetch helper ──────────────────────────────────────────────────

function ebayBaseUrl(env: 'production' | 'sandbox'): string {
  return env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
}

const EBAY_MAX_RETRIES = 3;

async function ebayFetch(
  orgId: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: any }> {
  const creds  = await loadEbayCredentials(orgId);
  const env    = creds?.environment ?? 'production';
  const baseUrl = ebayBaseUrl(env);
  const url    = `${baseUrl}${path}`;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= EBAY_MAX_RETRIES; attempt++) {
    const accessToken = await getAccessToken(orgId);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization:      `Bearer ${accessToken}`,
          'Content-Type':     'application/json',
          Accept:             'application/json',
          'Accept-Language':  'en-US',
          'Content-Language': 'en-US',
          ...extraHeaders,
        },
        body:   body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (networkErr) {
      lastError = networkErr instanceof Error ? networkErr : new Error(String(networkErr));
      if (attempt < EBAY_MAX_RETRIES) { await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000)); continue; }
      throw lastError;
    }

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') ?? '5', 10);
      if (attempt < EBAY_MAX_RETRIES) { await new Promise(r => setTimeout(r, (isNaN(retryAfter) ? 5 : retryAfter) * 1000)); continue; }
    }
    if (response.status >= 500 && attempt < EBAY_MAX_RETRIES) {
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000)); continue;
    }
    if (response.status === 204) return { ok: true, status: 204, data: null };

    let data: any = null;
    try { data = await response.json(); } catch { data = null; }
    return { ok: response.ok, status: response.status, data };
  }
  throw lastError ?? new Error(`[eBay] Unexpected retry exit for ${method} ${path}`);
}

// ── eBay Inventory API helpers ─────────────────────────────────────────────

async function getAllEbayInventoryItems(orgId: string): Promise<Map<string, EbayInventoryItem>> {
  const result: Map<string, EbayInventoryItem> = new Map();
  const limit = 200;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { ok, data } = await ebayFetch(orgId, 'GET', `/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`);
    if (!ok || !data?.inventoryItems) break;
    for (const item of data.inventoryItems ?? []) {
      const sku: string = item.sku;
      result.set(sku, {
        sku,
        quantity:  item.availability?.shipToLocationAvailability?.quantity ?? 0,
        price:     null,
        title:     item.product?.title ?? null,
        condition: item.condition ?? null,
        blInvId:   parseSkuToBlInvId(sku) ?? undefined,
      });
    }
    const total: number = data.total ?? 0;
    offset += limit;
    hasMore = offset < total;
  }
  return result;
}

async function getAllEbayOffers(orgId: string): Promise<Map<string, { offerId: string; price: string; listingId?: string; status?: string }>> {
  const result: Map<string, { offerId: string; price: string; listingId?: string; status?: string }> = new Map();
  const limit = 100;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { ok, data } = await ebayFetch(orgId, 'GET', `/sell/inventory/v1/offer?limit=${limit}&offset=${offset}`);
    if (!ok || !data?.offers) break;
    for (const offer of data.offers ?? []) {
      result.set(offer.sku, {
        offerId:   offer.offerId,
        price:     offer.pricingSummary?.price?.value ?? '0',
        listingId: offer.listing?.listingId,
        status:    offer.status,
      });
    }
    const total: number = data.total ?? 0;
    offset += limit;
    hasMore = offset < total;
  }
  return result;
}

// ── Image resolution ───────────────────────────────────────────────────────

async function resolveImageUrls(opts: {
  orgId:        string;
  blInvId:      number;
  itemNo:       string;
  itemType:     string;
  colorId:      number;
  serverOrigin: string;
  syncImages:   boolean;
}): Promise<string[]> {
  if (!opts.syncImages) return [];
  try {
    const { lotLevel, itemTypeLevel } = await getImagesForLot({
      orgId:         opts.orgId,
      blInventoryId: opts.blInvId,
      itemNo:        opts.itemNo,
      itemType:      opts.itemType,
    });
    const userImages = lotLevel.length > 0 ? lotLevel : itemTypeLevel;
    if (userImages.length > 0) {
      return userImages.slice(0, 12).map(img => `${opts.serverOrigin}/api/user-images/${encodeURIComponent(img.storageKey)}`);
    }
  } catch { /* fall through */ }

  const typeCode = opts.itemType === 'PART' || opts.itemType === 'P' ? 'pn'
    : opts.itemType === 'MINIFIG' || opts.itemType === 'M' ? 'mn'
    : opts.itemType === 'SET' || opts.itemType === 'S' ? 'sn'
    : 'pn';
  return [`${opts.serverOrigin}/api/part-image/${typeCode}/${opts.colorId}/${opts.itemNo}`];
}

// ── PART variation listing builders ───────────────────────────────────────

/**
 * Build PartGroups from PART lots.
 * Groups by {itemNo, condition}. Each unique colorId = one variant.
 * Multiple BL lots with same (itemNo, colorId, condition) are aggregated.
 */
function buildPartGroups(
  partLots: any[],
  catalogMap: Map<string, string>,
  colorMap:   Map<number, string>,
): PartGroup[] {
  const groups = new Map<string, PartGroup>();

  for (const lot of partLots) {
    const condition = lot.newOrUsed ?? 'U';
    const colorId   = lot.colorId ?? 0;
    const groupKey  = makeGroupKey(lot.itemNo, condition);

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        itemNo:         lot.itemNo,
        itemName:       catalogMap.get(`PART:${lot.itemNo}`) ?? null,
        condition,
        variants:       [],
        primaryColorId: colorId,
      });
    }

    const group      = groups.get(groupKey)!;
    const variantSku = makeVariantSku(lot.itemNo, colorId, condition);
    let variant      = group.variants.find(v => v.variantSku === variantSku);

    if (!variant) {
      variant = {
        variantSku,
        colorId,
        colorName: colorMap.get(colorId) ?? null,
        condition,
        totalQty:  0,
        minPrice:  Infinity,
        lots:      [],
      };
      group.variants.push(variant);
    }

    variant.totalQty += lot.quantity ?? 0;
    const price = parseFloat(lot.unitPrice ?? '0');
    if (price < variant.minPrice) variant.minPrice = price;
    variant.lots.push(lot);
  }

  // Set primaryColorId = most-stocked variant for the group's lead image
  for (const group of groups.values()) {
    let maxQty = -1;
    for (const v of group.variants) {
      if (v.totalQty > maxQty) { maxQty = v.totalQty; group.primaryColorId = v.colorId; }
    }
    if (group.variants[0] && group.primaryColorId === 0) group.primaryColorId = group.variants[0].colorId;
  }

  return [...groups.values()];
}

/** Listing title for a variation group — no color, shared across all variants */
function buildGroupTitle(itemNo: string, itemName: string | null, condition: string): string {
  const condLabel = condition === 'N' ? 'New' : 'Used';
  let title = 'LEGO';
  if (itemName) title += ` ${itemName}`;
  title += ` ${itemNo} Part ${condLabel}`;
  return title.slice(0, 80).trim();
}

/** Listing description for a variation group, with pricing disclaimer */
function buildGroupDescription(
  itemNo:       string,
  itemName:     string | null,
  condition:    string,
  variantCount: number,
): string {
  const lines: string[] = [];
  if (itemName) lines.push(`<b>${itemName}</b> (${itemNo})`);
  lines.push(`Condition: ${condition === 'N' ? 'New' : 'Used'}`);
  lines.push(`Available in ${variantCount} color${variantCount !== 1 ? 's' : ''} — select a color above to see availability and pricing.`);
  lines.push('');
  lines.push('<i>Listed and fulfilled by an independent LEGO seller. Part of a larger collection — see store for more items.</i>');
  lines.push('');

  const pricingNote = condition === 'N'
    ? '<i><b>Note on pricing:</b> The lowest available price is shown. Prices may vary by color — please select a color to see its specific price.</i>'
    : '<i><b>Note on pricing:</b> The lowest available price is shown. Prices may vary by color — please select a color to see its specific price. For used parts, prices may also vary based on condition; any notable scratches or damage will be described in the listing details.</i>';

  lines.push(pricingNote);
  return lines.join('<br>');
}

/**
 * Inventory item body for a single variant.
 * Title and description must match the group (eBay requirement).
 * Aspects include the specific color for this variant.
 */
function buildVariantItemBody(opts: {
  variant:       PartVariant;
  groupTitle:    string;
  groupDesc:     string;
  imageUrls:     string[];
  config:        EbayChannelConfig;
}): Record<string, unknown> {
  const { variant, groupTitle, groupDesc, imageUrls, config } = opts;
  const isNew = variant.condition === 'N';

  const conditionId = isNew ? EBAY_CONDITIONS.NEW
    : config.ebayConditionUsed === 'USED_GOOD'       ? EBAY_CONDITIONS.USED_GOOD
    : config.ebayConditionUsed === 'USED_ACCEPTABLE' ? EBAY_CONDITIONS.USED_ACCEPTABLE
    : EBAY_CONDITIONS.USED_VERY_GOOD;

  const legoColorName = toLegoColorName(variant.colorName);
  const aspects: Record<string, string[]> = { Brand: ['LEGO'] };
  if (legoColorName) aspects['Color'] = [legoColorName];
  aspects['Part Number'] = [opts.variant.lots[0]?.itemNo ?? ''];
  aspects['MPN']         = [opts.variant.lots[0]?.itemNo ?? ''];

  const conditionDescription = isNew
    ? undefined
    : `Used LEGO part — see listing details for specific condition notes`;

  return {
    product: {
      title:       groupTitle,
      description: config.syncDescription !== false ? groupDesc : undefined,
      aspects,
      imageUrls:   imageUrls.length > 0 ? imageUrls : undefined,
    },
    condition:            conditionId,
    conditionDescription,
    availability: {
      shipToLocationAvailability: {
        quantity: Math.max(0, variant.totalQty),
      },
    },
  };
}

/**
 * Item Group body for a part variation listing.
 * Contains title, description, image URLs, and the variesBy specification.
 */
function buildGroupBody(opts: {
  group:       PartGroup;
  groupTitle:  string;
  groupDesc:   string;
  imageUrls:   string[];   // images for all variants (primary first)
  config:      EbayChannelConfig;
}): Record<string, unknown> {
  const { group, groupTitle, groupDesc, imageUrls } = opts;

  const colorValues = group.variants
    .map(v => toLegoColorName(v.colorName) ?? v.colorName ?? 'Unknown')
    .filter((c, i, a) => a.indexOf(c) === i);  // deduplicate

  return {
    title:       groupTitle,
    description: groupDesc,
    imageUrls:   imageUrls.length > 0 ? imageUrls : [`https://via.placeholder.com/400x300.png?text=${encodeURIComponent(group.itemNo)}`],
    variantSKUs: group.variants.map(v => v.variantSku),
    variesBy: {
      aspectsImageVariesBy: ['Color'],
      specifications: [
        {
          name:   'Color',
          values: colorValues,
        },
      ],
    },
    aspects: {
      Brand:         ['LEGO'],
      'Part Number': [group.itemNo],
      MPN:           [group.itemNo],
    },
  };
}

/**
 * Offer body for a single variant SKU.
 * Price is variant-specific (lowest BL price × uplift).
 */
function buildVariantOfferBody(opts: {
  variant:        PartVariant;
  categoryId:     string;
  config:         EbayChannelConfig;
  isUpdate:       boolean;
  existingPrice?: string;
}): Record<string, unknown> {
  const { variant, categoryId, config, isUpdate, existingPrice } = opts;

  let listingPrice: number;
  if (isUpdate && config.priceSyncMode === 'initial_only' && existingPrice != null) {
    listingPrice = parseFloat(existingPrice);
  } else {
    const upliftFactor = 1 + Math.max(0, config.ebayPriceUpliftPercent ?? 0) / 100;
    listingPrice = (variant.minPrice === Infinity ? 0 : variant.minPrice) * upliftFactor;
  }

  const body: Record<string, unknown> = {
    sku:               variant.variantSku,
    marketplaceId:     config.ebayMarketplaceId,
    format:            'FIXED_PRICE',
    listingDuration:   config.ebayListingDuration,
    availableQuantity: Math.max(0, variant.totalQty),
    categoryId,
    pricingSummary: {
      price: {
        value:    Math.max(0.01, listingPrice).toFixed(2),
        currency: 'USD',
      },
    },
    merchantLocationKey: MERCHANT_LOCATION_KEY,
    includeCatalogProductDetails: false,
  };

  if (config.ebayFulfillmentPolicyId) body.fulfillmentPolicyId = config.ebayFulfillmentPolicyId;
  if (config.ebayPaymentPolicyId)     body.paymentPolicyId     = config.ebayPaymentPolicyId;
  if (config.ebayReturnPolicyId)      body.returnPolicyId      = config.ebayReturnPolicyId;

  return body;
}

// ── Non-PART (1:1) listing builders ───────────────────────────────────────

function buildEbayTitle(opts: {
  itemNo:    string;
  itemName:  string | null;
  colorName: string | null;
  itemType:  string;
  condition: string;
}): string {
  const { itemNo, itemName, colorName, itemType, condition } = opts;
  const condLabel  = condition === 'N' ? 'New' : 'Used';
  const typeLabel  = itemType === 'S' ? 'Set' : itemType === 'M' ? 'Minifigure' : itemType === 'G' ? 'Gear' : 'Part';
  let title = 'LEGO';
  if (itemName) title += ` ${itemName}`;
  if (colorName && itemType !== 'S') title += ` ${colorName}`;
  title += ` ${itemNo}`;
  if (itemType !== 'S') title += ` ${typeLabel}`;
  title += ` ${condLabel}`;
  return title.slice(0, 80).trim();
}

function buildInventoryItemBody(opts: {
  blLot:      any;
  itemName:   string | null;
  colorName:  string | null;
  imageUrls:  string[];
  config:     EbayChannelConfig;
}): Record<string, unknown> {
  const { blLot, itemName, colorName, imageUrls, config } = opts;
  const isNew = blLot.newOrUsed === 'N';

  const conditionId = isNew ? EBAY_CONDITIONS.NEW
    : config.ebayConditionUsed === 'USED_GOOD'       ? EBAY_CONDITIONS.USED_GOOD
    : config.ebayConditionUsed === 'USED_ACCEPTABLE' ? EBAY_CONDITIONS.USED_ACCEPTABLE
    : EBAY_CONDITIONS.USED_VERY_GOOD;

  const title = buildEbayTitle({
    itemNo:    blLot.itemNo,
    itemName,
    colorName,
    itemType:  blLot.itemType,
    condition: blLot.newOrUsed ?? 'U',
  });

  const aspects: Record<string, string[]> = { Brand: ['LEGO'] };
  const legoColorName = toLegoColorName(colorName);
  if (legoColorName && blLot.itemType !== 'S') aspects['Color'] = [legoColorName];
  if (blLot.itemType !== 'S' && blLot.itemType !== 'B') {
    aspects['Part Number'] = [blLot.itemNo];
    aspects['MPN']         = [blLot.itemNo];
  }
  if (blLot.itemType === 'S') aspects['Set Number'] = [blLot.itemNo];
  if (config.ebayBlIdField === 'item_specifics') aspects['BrickLink Lot ID'] = [String(blLot.id)];

  const conditionDescription = isNew
    ? undefined
    : (blLot.description?.trim() || `Used LEGO ${blLot.itemType === 'S' ? 'set' : 'item'} ${blLot.itemNo} — see photos for details`);

  return {
    product: {
      title,
      description: config.syncDescription !== false ? buildEbayDescription(blLot, itemName, colorName) : undefined,
      aspects,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    },
    condition:            conditionId,
    conditionDescription,
    availability: {
      shipToLocationAvailability: {
        quantity: Math.max(0, blLot.quantity ?? 0),
      },
    },
  };
}

function buildEbayDescription(blLot: any, itemName: string | null, colorName: string | null): string {
  const lines: string[] = [];
  if (itemName) lines.push(`<b>${itemName}</b> (${blLot.itemNo})`);
  if (colorName && blLot.itemType !== 'S') lines.push(`Color: ${colorName}`);
  lines.push(`Condition: ${blLot.newOrUsed === 'N' ? 'New' : 'Used'}`);
  if (blLot.itemType === 'M') lines.push(`BrickLink Minifig ID: ${blLot.itemNo}`);
  if (blLot.description) lines.push(`<br>${blLot.description}`);
  lines.push('<br><i>Listed and fulfilled by an independent LEGO seller. Part of a larger collection — see store for more items.</i>');
  return lines.join('<br>');
}

function buildOfferBody(opts: {
  sku:           string;
  blLot:         any;
  categoryId:    string;
  config:        EbayChannelConfig;
  isUpdate:      boolean;
  existingPrice?: string;
}): Record<string, unknown> {
  const { sku, blLot, categoryId, config, isUpdate, existingPrice } = opts;

  let listingPrice: number;
  if (isUpdate && config.priceSyncMode === 'initial_only' && existingPrice != null) {
    listingPrice = parseFloat(existingPrice);
  } else {
    const blPrice      = parseFloat(blLot.unitPrice ?? '0');
    const upliftFactor = 1 + Math.max(0, config.ebayPriceUpliftPercent ?? 0) / 100;
    listingPrice = blPrice * upliftFactor;
  }

  const body: Record<string, unknown> = {
    sku,
    marketplaceId:     config.ebayMarketplaceId,
    format:            'FIXED_PRICE',
    listingDuration:   config.ebayListingDuration,
    availableQuantity: Math.max(0, blLot.quantity ?? 0),
    categoryId,
    pricingSummary: {
      price: {
        value:    Math.max(0.01, listingPrice).toFixed(2),
        currency: 'USD',
      },
    },
    merchantLocationKey: MERCHANT_LOCATION_KEY,
    listingDescription: buildEbayDescription(blLot, null, null),
    includeCatalogProductDetails: config.ebayCatalogMatch && blLot.itemType === 'S',
  };

  if (config.ebayFulfillmentPolicyId) body.fulfillmentPolicyId = config.ebayFulfillmentPolicyId;
  if (config.ebayPaymentPolicyId)     body.paymentPolicyId     = config.ebayPaymentPolicyId;
  if (config.ebayReturnPolicyId)      body.returnPolicyId      = config.ebayReturnPolicyId;

  return body;
}

// ── Abort flag ─────────────────────────────────────────────────────────────

let _abortRequested = false;
export function requestEbayAbort()    { _abortRequested = true; }
export function clearEbayAbort()      { _abortRequested = false; }
export function isEbayAbortRequested(){ return _abortRequested; }

// ── Part variation sync ────────────────────────────────────────────────────

async function syncPartVariationGroups(opts: {
  orgId:         string;
  groups:        PartGroup[];
  config:        EbayChannelConfig;
  serverOrigin:  string;
  existingItems: Map<string, EbayInventoryItem>;
  existingOffers: Map<string, { offerId: string; price: string; listingId?: string; status?: string }>;
  mode:          'full_control' | 'matched_sync';
  result:        EbaySyncResult;
  onProgress?:   (processed: number, total: number) => void;
  totalItems:    number;
  processedSoFar: { count: number };
}): Promise<void> {
  const { orgId, groups, config, serverOrigin, existingItems, existingOffers, mode, result } = opts;
  const categoryId = EBAY_LEGO_CATEGORIES['P'];

  for (const group of groups) {
    if (isEbayAbortRequested()) { result.errors.push('Sync aborted by user request.'); break; }

    const groupHasExisting = group.variants.some(v => existingItems.has(v.variantSku));
    if (!groupHasExisting && mode === 'matched_sync') {
      // matched_sync: skip groups that don't already exist on eBay
      for (const v of group.variants) result.lotsSkipped += v.lots.length;
      opts.processedSoFar.count += group.variants.reduce((s, v) => s + v.lots.length, 0);
      if (opts.onProgress) opts.onProgress(opts.processedSoFar.count, opts.totalItems);
      continue;
    }

    const groupTitle = buildGroupTitle(group.itemNo, group.itemName, group.condition);
    const groupDesc  = buildGroupDescription(group.itemNo, group.itemName, group.condition, group.variants.length);

    // Collect images: resolve per-color image for each variant, primary color first
    const imageUrlsForGroup: string[] = [];
    const sortedVariants = [...group.variants].sort((a, b) =>
      a.colorId === group.primaryColorId ? -1 : b.colorId === group.primaryColorId ? 1 : 0
    );

    for (const variant of sortedVariants) {
      const variantImages = await resolveImageUrls({
        orgId,
        blInvId:      variant.lots[0]?.id ?? 0,
        itemNo:       group.itemNo,
        itemType:     'PART',
        colorId:      variant.colorId,
        serverOrigin,
        syncImages:   config.syncImages,
      });
      for (const url of variantImages) {
        if (!imageUrlsForGroup.includes(url)) imageUrlsForGroup.push(url);
        if (imageUrlsForGroup.length >= 12) break;
      }
      if (imageUrlsForGroup.length >= 12) break;
    }

    let groupHadChanges = false;

    // ── Process each variant: PUT inventory item + create/update offer ──────
    for (const variant of group.variants) {
      if (isEbayAbortRequested()) break;

      // Per-variant image: use that color's specific image (first in sorted list)
      const variantImages = await resolveImageUrls({
        orgId,
        blInvId:      variant.lots[0]?.id ?? 0,
        itemNo:       group.itemNo,
        itemType:     'PART',
        colorId:      variant.colorId,
        serverOrigin,
        syncImages:   config.syncImages,
      });

      const itemBody = buildVariantItemBody({ variant, groupTitle, groupDesc, imageUrls: variantImages, config });

      // PUT inventory item
      try {
        const putRes = await ebayFetch(orgId, 'PUT',
          `/sell/inventory/v1/inventory_item/${encodeURIComponent(variant.variantSku)}`,
          itemBody,
        );
        result.totalApiCalls++;
        if (!putRes.ok && putRes.status !== 204) {
          const errMsg = putRes.data?.errors?.[0]?.message ?? JSON.stringify(putRes.data);
          result.errors.push(`Variant ${variant.variantSku}: inventory update failed — ${errMsg}`);
          result.lotsSkipped += variant.lots.length;
          opts.processedSoFar.count += variant.lots.length;
          if (opts.onProgress) opts.onProgress(opts.processedSoFar.count, opts.totalItems);
          continue;
        }
        groupHadChanges = true;
      } catch (err: any) {
        result.errors.push(`Variant ${variant.variantSku}: ${err.message}`);
        result.lotsSkipped += variant.lots.length;
        opts.processedSoFar.count += variant.lots.length;
        if (opts.onProgress) opts.onProgress(opts.processedSoFar.count, opts.totalItems);
        continue;
      }

      // Create or update offer for this variant
      const existingOffer = existingOffers.get(variant.variantSku);
      const offerBody = buildVariantOfferBody({
        variant, categoryId, config,
        isUpdate:      !!existingOffer,
        existingPrice: existingOffer?.price,
      });

      try {
        if (existingOffer) {
          const updateRes = await ebayFetch(orgId, 'PUT', `/sell/inventory/v1/offer/${existingOffer.offerId}`, offerBody);
          result.totalApiCalls++;
          if (!updateRes.ok) {
            const errMsg = updateRes.data?.errors?.[0]?.message ?? JSON.stringify(updateRes.data);
            result.errors.push(`Variant ${variant.variantSku} offer update failed — ${errMsg}`);
          } else {
            result.lotsUpdated += variant.lots.length;
            for (const lot of variant.lots) {
              await upsertChannelLink(orgId, lot.id, existingOffer.listingId ?? variant.variantSku);
            }
          }
        } else if (mode === 'full_control') {
          const createRes = await ebayFetch(orgId, 'POST', '/sell/inventory/v1/offer', offerBody);
          result.totalApiCalls++;
          if (!createRes.ok) {
            const errMsg = createRes.data?.errors?.[0]?.message ?? JSON.stringify(createRes.data);
            // Recover: eBay has the offer but it wasn't in our paginated fetch — GET by SKU then PUT
            if (errMsg.toLowerCase().includes('already exists')) {
              const getRes = await ebayFetch(orgId, 'GET', `/sell/inventory/v1/offer?sku=${encodeURIComponent(variant.variantSku)}`);
              result.totalApiCalls++;
              const recovered = getRes.data?.offers?.[0];
              if (recovered) {
                const updateBody = buildVariantOfferBody({ variant, categoryId, config, isUpdate: true, existingPrice: recovered.pricingSummary?.price?.value });
                const updateRes = await ebayFetch(orgId, 'PUT', `/sell/inventory/v1/offer/${recovered.offerId}`, updateBody);
                result.totalApiCalls++;
                if (!updateRes.ok) {
                  const upErrMsg = updateRes.data?.errors?.[0]?.message ?? JSON.stringify(updateRes.data);
                  result.errors.push(`Variant ${variant.variantSku} offer recovery update failed — ${upErrMsg}`);
                  result.lotsSkipped += variant.lots.length;
                } else {
                  for (const lot of variant.lots) {
                    await upsertChannelLink(orgId, lot.id, recovered.listing?.listingId ?? recovered.offerId);
                  }
                  result.lotsUpdated += variant.lots.length;
                }
              } else {
                result.errors.push(`Variant ${variant.variantSku} offer creation failed — ${errMsg}`);
                result.lotsSkipped += variant.lots.length;
              }
            } else {
              result.errors.push(`Variant ${variant.variantSku} offer creation failed — ${errMsg}`);
              result.lotsSkipped += variant.lots.length;
            }
          } else {
            // Don't publish yet — will publish via publishOfferByInventoryItemGroup
            result.lotsCreated += variant.lots.length;
          }
        }
      } catch (err: any) {
        result.errors.push(`Variant ${variant.variantSku} (offer): ${err.message}`);
      }

      opts.processedSoFar.count += variant.lots.length;
      if (opts.onProgress) opts.onProgress(opts.processedSoFar.count, opts.totalItems);
    }

    // ── PUT inventory item group ─────────────────────────────────────────
    if (groupHadChanges || mode === 'full_control') {
      const groupBody = buildGroupBody({ group, groupTitle, groupDesc, imageUrls: imageUrlsForGroup, config });
      try {
        const grpRes = await ebayFetch(orgId, 'PUT',
          `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(group.groupKey)}`,
          groupBody,
        );
        result.totalApiCalls++;
        if (!grpRes.ok && grpRes.status !== 204) {
          const errMsg = grpRes.data?.errors?.[0]?.message ?? JSON.stringify(grpRes.data);
          result.errors.push(`Group ${group.groupKey}: item group update failed — ${errMsg}`);
          console.error(`[eBay] PUT item group FAILED: ${group.groupKey} — ${errMsg}`);
        }
      } catch (err: any) {
        result.errors.push(`Group ${group.groupKey} (item group): ${err.message}`);
      }
    }

    // ── Publish group (full_control only) ────────────────────────────────
    if (mode === 'full_control') {
      try {
        const publishRes = await ebayFetch(orgId, 'POST', '/sell/inventory/v1/offer/publish_by_inventory_item_group', {
          inventoryItemGroupKey: group.groupKey,
          marketplaceId:         config.ebayMarketplaceId,
        });
        result.totalApiCalls++;
        if (publishRes.ok || publishRes.status === 204) {
          const listingId = publishRes.data?.listingId;
          if (listingId) {
            // Update channel lot links with the actual eBay listing ID
            for (const variant of group.variants) {
              for (const lot of variant.lots) {
                await upsertChannelLink(orgId, lot.id, listingId);
              }
            }
          }
        } else {
          // 25002 = already published (no-op), log but don't count as error
          const errCode = publishRes.data?.errors?.[0]?.errorId;
          if (errCode !== 25002) {
            const errMsg = publishRes.data?.errors?.[0]?.message ?? JSON.stringify(publishRes.data);
            console.warn(`[eBay] Publish group ${group.groupKey}: ${errMsg}`);
          }
        }
      } catch (err: any) {
        result.errors.push(`Group ${group.groupKey} (publish): ${err.message}`);
      }
    }

    // Small throttle between groups
    await new Promise(r => setTimeout(r, 50));
  }
}

// ── Core sync function ─────────────────────────────────────────────────────

export async function syncBrickLinkToEbay(
  mode:         'analysis' | 'full_control' | 'matched_sync',
  onProgress:   ((processed: number, total: number) => void) | undefined,
  config:       EbayChannelConfig,
  orgId:        string,
  serverOrigin: string,
): Promise<EbaySyncResult> {
  clearEbayAbort();

  const result: EbaySyncResult = {
    lotsCreated:   0,
    lotsUpdated:   0,
    lotsSkipped:   0,
    errors:        [],
    totalApiCalls: 0,
  };

  // ── Step 1: Load BrickLink inventory ──────────────────────────────────────
  let rawBl: (typeof blInventory.$inferSelect)[];
  try {
    rawBl = await db.select().from(blInventory)
      .where(and(eq(blInventory.orgId, orgId), isNull(blInventory.deletedAt)));
  } catch (err: any) {
    result.errors.push(`Failed to load BrickLink inventory: ${err.message}`);
    return result;
  }

  const BL_TYPE_TO_CODE: Record<string, string> = {
    PART: 'P', SET: 'S', MINIFIG: 'M', GEAR: 'G',
    BOOK: 'B', INSTRUCTION: 'I', ORIGINAL_BOX: 'O',
  };

  const hasItemTypeFilter = Object.keys(config.syncItemTypes).length > 0;
  const priceFloor        = config.syncPriceFloor ?? null;

  const blLots = rawBl.filter(lot => {
    if (!lot.itemType) return false;
    const typeCode = BL_TYPE_TO_CODE[lot.itemType] ?? lot.itemType;
    if (hasItemTypeFilter && config.syncItemTypes[typeCode] === false) return false;
    if (priceFloor && priceFloor > 0) {
      const lotPrice = lot.unitPrice ? parseFloat(lot.unitPrice) : 0;
      if (lotPrice < priceFloor) return false;
    }
    if (lot.isStockRoom) {
      const stockMode = config.syncStockroomModes[lot.stockRoomId ?? ''] ?? 'skip';
      if (stockMode === 'skip') return false;
    }
    return true;
  });

  console.log(`[eBay] BL inventory: ${rawBl.length} total → ${blLots.length} after filters`);
  if (blLots.length === 0) {
    console.warn('[eBay] All BL lots filtered out — nothing to sync.');
    return result;
  }

  // ── Step 2: Load catalog info ──────────────────────────────────────────────
  const itemNos  = [...new Set(blLots.map(l => l.itemNo))];
  const colorIds = [...new Set(blLots.map(l => l.colorId).filter((c): c is number => c != null))];

  let catalogRows: { itemNo: string; itemType: string | null; name: string | null }[] = [];
  let colorRows:   { colorId: number; colorName: string }[] = [];
  try {
    [catalogRows, colorRows] = await Promise.all([
      itemNos.length > 0
        ? db.select({ itemNo: blCatalog.itemNo, itemType: blCatalog.itemType, name: blCatalog.itemName })
            .from(blCatalog).where(inArray(blCatalog.itemNo, itemNos))
        : Promise.resolve([]),
      colorIds.length > 0
        ? db.select({ colorId: blColors.id, colorName: blColors.name })
            .from(blColors).where(inArray(blColors.id, colorIds))
        : Promise.resolve([]),
    ]);
  } catch (err: any) {
    result.errors.push(`Failed to load catalog data: ${err.message}`);
    return result;
  }

  const catalogMap = new Map<string, string>();
  for (const row of catalogRows) catalogMap.set(`${row.itemType}:${row.itemNo}`, row.name ?? '');
  const colorMap = new Map<number, string>();
  for (const row of colorRows) colorMap.set(row.colorId, row.colorName);

  // ── Step 3: Load existing channel lot links ────────────────────────────────
  let existingLinks: (typeof channelLotLinks.$inferSelect)[];
  try {
    existingLinks = await db.select().from(channelLotLinks)
      .where(and(eq(channelLotLinks.orgId, orgId), eq(channelLotLinks.channel, EBAY_CHANNEL)));
  } catch (err: any) {
    result.errors.push(`Failed to load channel lot links: ${err.message}`);
    return result;
  }
  const linkByBlInvId = new Map<number, string>();
  for (const link of existingLinks) {
    if (link.blInvId != null) linkByBlInvId.set(link.blInvId, link.channelLotId ?? '');
  }

  // ── Step 4: Load eBay inventory (all items) ────────────────────────────────
  console.log('[eBay] Fetching current eBay inventory…');
  let ebayItems: Map<string, EbayInventoryItem>;
  try {
    ebayItems = await getAllEbayInventoryItems(orgId);
    result.totalApiCalls += Math.ceil(ebayItems.size / 200) + 1;
  } catch (err: any) {
    result.errors.push(`Failed to fetch eBay inventory: ${err.message}`);
    return result;
  }

  // Reverse map for BL-{lotId} items (non-PART 1:1 model)
  const ebayByBlInvId = new Map<number, EbayInventoryItem>();
  for (const [_sku, item] of ebayItems) {
    if (item.blInvId != null) ebayByBlInvId.set(item.blInvId, item);
  }

  // ── Step 4.5: Pre-fetch all eBay offers (once) ────────────────────────────
  console.log('[eBay] Fetching current eBay offers…');
  let allOffers: Map<string, { offerId: string; price: string; listingId?: string; status?: string }>;
  try {
    allOffers = await getAllEbayOffers(orgId);
    result.totalApiCalls += Math.ceil(allOffers.size / 100) + 1;
  } catch (err: any) {
    result.errors.push(`Failed to fetch eBay offers: ${err.message}`);
    return result;
  }

  // ── Step 5: Split lots into PART (variation model) and other (1:1 model) ──
  const partLots  = blLots.filter(l => l.itemType === 'PART');
  const otherLots = blLots.filter(l => l.itemType !== 'PART');

  const total     = blLots.length;
  let   processed = 0;

  // ── ANALYSIS MODE ──────────────────────────────────────────────────────────
  if (mode === 'analysis') {
    const preview: EbayAnalysisPreview = {
      matchedLots: 0, unmatchedLots: 0, wouldUpdate: 0, wouldCreate: 0,
      byField: { qty: 0, price: 0, description: 0, images: 0 },
    };

    // Parts: check variant-level
    const partGroups = buildPartGroups(partLots, catalogMap, colorMap);
    for (const group of partGroups) {
      for (const variant of group.variants) {
        processed += variant.lots.length;
        if (onProgress) onProgress(processed, total);
        const existingItem = ebayItems.get(variant.variantSku);
        if (!existingItem) {
          preview.unmatchedLots += variant.lots.length;
          preview.wouldCreate++;
        } else {
          preview.matchedLots += variant.lots.length;
          if (existingItem.quantity !== variant.totalQty) { preview.byField.qty++; preview.wouldUpdate++; }
        }
      }
    }

    // Other lots: check lot-level
    for (const lot of otherLots) {
      processed++;
      if (onProgress) onProgress(processed, total);
      const ebayItem = ebayByBlInvId.get(lot.id);
      if (!ebayItem) { preview.unmatchedLots++; preview.wouldCreate++; }
      else { preview.matchedLots++; if (ebayItem.quantity !== (lot.quantity ?? 0)) { preview.byField.qty++; preview.wouldUpdate++; } }
    }

    result.preview = preview;
    return result;
  }

  // ── SYNC MODE ──────────────────────────────────────────────────────────────

  // Step 6: Sync PART lots via variation group model
  if (partLots.length > 0) {
    const partGroups = buildPartGroups(partLots, catalogMap, colorMap);
    console.log(`[eBay] Part variation sync: ${partGroups.length} groups (${partLots.length} lots)`);

    const processedSoFar = { count: 0 };
    await syncPartVariationGroups({
      orgId, groups: partGroups, config, serverOrigin,
      existingItems:  ebayItems,
      existingOffers: allOffers,
      mode:           mode as 'full_control' | 'matched_sync',
      result, onProgress,
      totalItems:     total,
      processedSoFar,
    });
    processed = processedSoFar.count;
  }

  // Step 7: Sync non-PART lots via 1:1 model
  for (const lot of otherLots) {
    if (isEbayAbortRequested()) { result.errors.push('Sync aborted by user request.'); break; }

    processed++;
    if (onProgress) onProgress(processed, total);

    const sku      = makeSku(lot.id);
    const ebayItem = ebayByBlInvId.get(lot.id);
    const isMatched = !!ebayItem;

    if (!isMatched && mode === 'matched_sync') { result.lotsSkipped++; continue; }

    const lotTypeCode = BL_TYPE_TO_CODE[lot.itemType ?? ''] ?? lot.itemType ?? 'P';
    const categoryId  = EBAY_LEGO_CATEGORIES[lotTypeCode] ?? EBAY_LEGO_CATEGORIES['P'];
    const itemName    = catalogMap.get(`${lot.itemType}:${lot.itemNo}`) ?? null;
    const colorName   = lot.colorId != null ? colorMap.get(lot.colorId) ?? null : null;

    const imageUrls = await resolveImageUrls({
      orgId, blInvId: lot.id, itemNo: lot.itemNo,
      itemType: lot.itemType ?? 'P', colorId: lot.colorId ?? 0,
      serverOrigin, syncImages: config.syncImages,
    });

    const blLotNormalized = { ...lot, itemType: lotTypeCode };
    const itemBody = buildInventoryItemBody({ blLot: blLotNormalized, itemName, colorName, imageUrls, config });

    // PUT inventory item
    try {
      const putResult = await ebayFetch(orgId, 'PUT', `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, itemBody);
      result.totalApiCalls++;
      if (!putResult.ok && putResult.status !== 204) {
        const errMsg = putResult.data?.errors?.[0]?.message ?? JSON.stringify(putResult.data);
        result.errors.push(`SKU ${sku}: inventory update failed — ${errMsg}`);
        result.lotsSkipped++;
        continue;
      }
    } catch (err: any) {
      result.errors.push(`SKU ${sku}: ${err.message}`);
      result.lotsSkipped++;
      continue;
    }

    // Create or update offer
    try {
      const existingOffer = allOffers.get(sku) ?? null;
      const offerBody = buildOfferBody({
        sku, blLot: blLotNormalized, categoryId, config,
        isUpdate:      !!existingOffer,
        existingPrice: existingOffer?.price,
      });

      if (existingOffer) {
        const updateResult = await ebayFetch(orgId, 'PUT', `/sell/inventory/v1/offer/${existingOffer.offerId}`, offerBody);
        result.totalApiCalls++;
        if (!updateResult.ok) {
          const errMsg = updateResult.data?.errors?.[0]?.message ?? JSON.stringify(updateResult.data);
          result.errors.push(`SKU ${sku}: offer update failed — ${errMsg}`);
        } else {
          result.lotsUpdated++;
          await upsertChannelLink(orgId, lot.id, existingOffer.listingId ?? sku);
        }
      } else if (mode === 'full_control') {
        const createResult = await ebayFetch(orgId, 'POST', '/sell/inventory/v1/offer', offerBody);
        result.totalApiCalls++;
        if (!createResult.ok) {
          const errMsg = createResult.data?.errors?.[0]?.message ?? JSON.stringify(createResult.data);
          // Recover: eBay has the offer but it wasn't in our paginated fetch — GET by SKU then PUT
          if (errMsg.toLowerCase().includes('already exists')) {
            const getRes = await ebayFetch(orgId, 'GET', `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`);
            result.totalApiCalls++;
            const recovered = getRes.data?.offers?.[0];
            if (recovered) {
              const updateBody = buildOfferBody({ sku, blLot: blLotNormalized, categoryId, config, isUpdate: true, existingPrice: recovered.pricingSummary?.price?.value });
              const updateRes = await ebayFetch(orgId, 'PUT', `/sell/inventory/v1/offer/${recovered.offerId}`, updateBody);
              result.totalApiCalls++;
              if (!updateRes.ok) {
                const upErrMsg = updateRes.data?.errors?.[0]?.message ?? JSON.stringify(updateRes.data);
                result.errors.push(`SKU ${sku}: offer recovery update failed — ${upErrMsg}`);
                result.lotsSkipped++;
              } else {
                await upsertChannelLink(orgId, lot.id, recovered.listing?.listingId ?? recovered.offerId);
                result.lotsUpdated++;
              }
            } else {
              result.errors.push(`SKU ${sku}: offer creation failed — ${errMsg}`);
              result.lotsSkipped++;
            }
          } else {
            result.errors.push(`SKU ${sku}: offer creation failed — ${errMsg}`);
            result.lotsSkipped++;
          }
          continue;
        }
        const offerId = createResult.data?.offerId;
        if (offerId) {
          const publishResult = await ebayFetch(orgId, 'POST', `/sell/inventory/v1/offer/${offerId}/publish`, {});
          result.totalApiCalls++;
          const listingId = publishResult.data?.listingId;
          await upsertChannelLink(orgId, lot.id, listingId ?? offerId);
          result.lotsCreated++;
        }
      }
    } catch (err: any) {
      result.errors.push(`SKU ${sku} (offer): ${err.message}`);
      result.lotsSkipped++;
    }

    if (processed % 20 === 0) await new Promise(r => setTimeout(r, 200));
  }

  // ── Cleanup Phase ──────────────────────────────────────────────────────────
  if (mode === 'full_control') {
    try {
      const skusToWithdraw: Array<{ sku: string; reason: string }> = [];

      const filteredInIds   = new Set(blLots.map(l => l.id));
      const partLotIds      = new Set(rawBl.filter(l => l.itemType === 'PART').map(l => l.id));

      // Case 1: Old-format BL-{lotId} PART items → migrate to variation model (withdraw old SKUs)
      for (const [sku, _item] of ebayItems) {
        const blInvId = parseSkuToBlInvId(sku);
        if (blInvId != null && partLotIds.has(blInvId)) {
          skusToWithdraw.push({ sku, reason: 'migrated to variation model' });
        }
      }

      // Case 2: Non-PART lots filtered out by config
      const filteredOutOtherLots = rawBl.filter(l =>
        l.itemType !== 'PART' && !filteredInIds.has(l.id) && ebayByBlInvId.has(l.id)
      );
      for (const lot of filteredOutOtherLots) {
        skusToWithdraw.push({ sku: makeSku(lot.id), reason: 'filtered out by config' });
      }

      // Case 3: Soft-deleted non-PART lots that still have eBay items
      const softDeleted = await db.select({ id: blInventory.id, itemType: blInventory.itemType })
        .from(blInventory)
        .where(and(eq(blInventory.orgId, orgId), isNotNull(blInventory.deletedAt)));
      for (const lot of softDeleted) {
        if (lot.itemType !== 'PART' && ebayByBlInvId.has(lot.id)) {
          skusToWithdraw.push({ sku: makeSku(lot.id), reason: 'BL lot soft-deleted' });
        }
      }

      // Case 4: Withdraw offers for VAR- variants belonging to groups with no active lots
      const activeGroupKeys = new Set(buildPartGroups(partLots, catalogMap, colorMap).map(g => g.groupKey));
      for (const [sku, _item] of ebayItems) {
        const parsed = parseVariantSku(sku);
        if (!parsed) continue;
        const gk = makeGroupKey(parsed.itemNo, parsed.condition);
        if (!activeGroupKeys.has(gk)) {
          skusToWithdraw.push({ sku, reason: 'group has no active lots' });
        }
      }

      if (skusToWithdraw.length > 0) {
        console.log(`[eBay] Cleanup: ${skusToWithdraw.length} offer(s) to potentially withdraw`);
        for (const { sku, reason } of skusToWithdraw) {
          if (isEbayAbortRequested()) break;
          const offer = allOffers.get(sku);
          if (!offer || offer.status !== 'PUBLISHED') continue;

          console.log(`[eBay] Cleanup: withdrawing offer ${offer.offerId} for SKU ${sku} (${reason})`);
          const withdrawResult = await ebayFetch(orgId, 'POST', `/sell/inventory/v1/offer/${offer.offerId}/withdraw`, {});
          result.totalApiCalls++;
          if (!withdrawResult.ok && withdrawResult.status !== 204) {
            const errMsg = withdrawResult.data?.errors?.[0]?.message ?? JSON.stringify(withdrawResult.data);
            console.error(`[eBay] Cleanup: withdraw failed for SKU ${sku} — ${errMsg}`);
            result.errors.push(`SKU ${sku}: withdraw failed — ${errMsg}`);
          } else {
            console.log(`[eBay] Cleanup: withdrawn ${sku} (${reason})`);
            result.lotsUpdated++;
          }
        }
      }
    } catch (cleanupErr: any) {
      console.error('[eBay] Cleanup phase error (non-fatal):', cleanupErr.message);
    }
  }

  return result;
}

// ── Channel lot link helpers ───────────────────────────────────────────────

async function upsertChannelLink(orgId: string, blInvId: number, channelLotId: string): Promise<void> {
  try {
    await db.insert(channelLotLinks)
      .values({ blInvId, orgId, channel: EBAY_CHANNEL, channelLotId, syncedAt: new Date() })
      .onConflictDoUpdate({
        target: [channelLotLinks.blInvId, channelLotLinks.orgId, channelLotLinks.channel],
        set:    { channelLotId, syncedAt: new Date() },
      });
  } catch { /* non-critical */ }
}

// ── Connection test ────────────────────────────────────────────────────────

export async function testEbayConnection(orgId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const creds = await loadEbayCredentials(orgId);
    if (!creds) return { ok: false, message: 'No eBay credentials configured. Add them in Settings → Platform Connections.' };
    await getAccessToken(orgId);
    const { ok, data } = await ebayFetch(orgId, 'GET', '/sell/inventory/v1/inventory_item?limit=1');
    if (!ok) return { ok: false, message: `eBay API returned error: ${data?.errors?.[0]?.message ?? 'unknown'}` };
    return { ok: true, message: 'Connected successfully' };
  } catch (err: any) {
    return { ok: false, message: err.message ?? 'Connection test failed' };
  }
}

// ── OAuth URL generator ────────────────────────────────────────────────────

export function buildEbayOAuthUrl(opts: {
  appId:       string;
  redirectUri: string;
  environment: 'production' | 'sandbox';
  state?:      string;
}): string {
  const baseUrl = opts.environment === 'sandbox'
    ? 'https://auth.sandbox.ebay.com/oauth2/authorize'
    : 'https://auth.ebay.com/oauth2/authorize';
  const params = new URLSearchParams({
    client_id:     opts.appId,
    redirect_uri:  opts.redirectUri,
    response_type: 'code',
    scope:         EBAY_SCOPES,
    state:         opts.state ?? '',
  });
  return `${baseUrl}?${params.toString()}`;
}

export async function exchangeEbayAuthCode(opts: {
  appId:       string;
  certId:      string;
  code:        string;
  redirectUri: string;
  environment: 'production' | 'sandbox';
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const baseUrl   = ebayBaseUrl(opts.environment);
  const basicAuth = Buffer.from(`${opts.appId}:${opts.certId}`).toString('base64');
  const resp = await fetch(`${baseUrl}/identity/v1/oauth2/token`, {
    method:  'POST',
    headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ grant_type: 'authorization_code', code: opts.code, redirect_uri: opts.redirectUri }).toString(),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`eBay token exchange failed: ${resp.status} ${body}`);
  }
  const data: any = await resp.json();
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in ?? 7200 };
}

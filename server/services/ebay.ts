/**
 * eBay Channel Service
 *
 * Implements BrickLink → eBay inventory synchronization using the eBay Sell Inventory API.
 *
 * Key design decisions:
 *  - SKU format: "BL-{blInventoryId}" — the SKU IS the BrickLink lot ID link.
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
// From eBay's category tree (Toys & Games > Building Toys > LEGO Building Toys)
export const EBAY_LEGO_CATEGORIES: Record<string, string> = {
  S: '19006',  // Complete Sets & Packs
  P: '18076',  // Bricks & Building Pieces
  M: '11731',  // Minifigures (approximate — eBay clusters these under LEGO)
  G: '11726',  // LEGO Gear
  B: '11481',  // LEGO Instruction Books
};

// ── eBay Condition IDs ─────────────────────────────────────────────────────
// conditionId strings used in Inventory API v1
export const EBAY_CONDITIONS = {
  NEW:             '1000',
  USED_VERY_GOOD:  '3000',
  USED_GOOD:       '4000',
  USED_ACCEPTABLE: '5000',
} as const;

// ── eBay OAuth scopes required for Sell Inventory API ─────────────────────
const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
].join(' ');

// ── Token cache (in-memory) ────────────────────────────────────────────────
const tokenCache: Map<string, { accessToken: string; expiresAt: number }> = new Map();

// ── Type definitions ───────────────────────────────────────────────────────

export interface EbayChannelConfig {
  ebayBlIdField:       'custom_label' | 'item_specifics';
  ebayCatalogMatch:    boolean;
  ebayListingDuration: string;
  syncImages:          boolean;
  syncDescription:     boolean;
  ebayMarketplaceId:   string;
  ebayConditionUsed:   string;
  ebayFulfillmentPolicyId?: string;
  ebayPaymentPolicyId?:     string;
  ebayReturnPolicyId?:      string;
}

export const defaultEbayChannelConfig: EbayChannelConfig = {
  ebayBlIdField:       'custom_label',
  ebayCatalogMatch:    true,
  ebayListingDuration: 'GTC',
  syncImages:          true,
  syncDescription:     true,
  ebayMarketplaceId:   'EBAY_US',
  ebayConditionUsed:   'USED_VERY_GOOD',
};

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
  blInvId?:      number; // parsed from SKU
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ebayBaseUrl(env: 'production' | 'sandbox'): string {
  return env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
}

function makeSku(blInvId: number | string): string {
  return `BL-${blInvId}`;
}

function parseSkuToBlInvId(sku: string): number | null {
  const match = sku.match(/^BL-(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

// ── OAuth / Credentials ────────────────────────────────────────────────────

/**
 * Load eBay credentials for an org.
 * - App credentials (AppId, CertId, DevId, RuName) come from platform_settings (shared across orgs).
 * - User tokens (refreshToken) come from org_integrations (per-org OAuth).
 * Returns null if not fully configured.
 */
async function loadEbayCredentials(orgId: string): Promise<EbayCredentials | null> {
  // Load both in parallel
  const [[psRow], [orgRow]] = await Promise.all([
    db.select().from(platformSettings).limit(1),
    db.select().from(orgIntegrations)
      .where(and(eq(orgIntegrations.orgId, orgId), eq(orgIntegrations.channel, 'ebay')))
      .limit(1),
  ]);

  const orgCreds = (orgRow?.credentials ?? {}) as Record<string, string>;
  const env = (orgCreds.environment as 'production' | 'sandbox') ?? 'production';

  if (env === 'sandbox') {
    // App creds: from platform_settings sandbox columns (fallback to legacy org-level fields)
    const appId  = psRow?.ebaySandboxAppId  ?? orgCreds.sandboxAppId  ?? '';
    const certId = psRow?.ebaySandboxCertId ?? orgCreds.sandboxCertId ?? '';
    const devId  = psRow?.ebaySandboxDevId  ?? orgCreds.sandboxDevId  ?? '';
    // User token: always from org_integrations
    const refreshToken = orgCreds.sandboxRefreshToken ?? '';

    if (!appId || !certId || !refreshToken) return null;
    return { appId, certId, devId, refreshToken, environment: 'sandbox' };
  }

  // Production
  const appId  = psRow?.ebayProdAppId  ?? orgCreds.appId  ?? '';
  const certId = psRow?.ebayProdCertId ?? orgCreds.certId ?? '';
  const devId  = psRow?.ebayProdDevId  ?? orgCreds.devId  ?? '';
  const refreshToken = orgCreds.refreshToken ?? '';

  if (!appId || !certId || !refreshToken) return null;
  return { appId, certId, devId, refreshToken, environment: 'production' };
}

/**
 * Get a valid access token, refreshing if expired.
 * Caches tokens in memory by orgId.
 */
async function getAccessToken(orgId: string): Promise<string> {
  const cached = tokenCache.get(orgId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const creds = await loadEbayCredentials(orgId);
  if (!creds) throw new Error('[eBay] No eBay credentials configured for this org. Connect eBay in Settings → Platform Connections.');

  const baseUrl = ebayBaseUrl(creds.environment);
  const basicAuth = Buffer.from(`${creds.appId}:${creds.certId}`).toString('base64');

  const resp = await fetch(`${baseUrl}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: creds.refreshToken,
      scope:         EBAY_SCOPES,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`[eBay] Token refresh failed: ${resp.status} ${body}`);
  }

  const data = await resp.json();
  const expiresIn: number = data.expires_in ?? 7200;
  const accessToken: string = data.access_token;

  tokenCache.set(orgId, { accessToken, expiresAt: Date.now() + expiresIn * 1000 });

  // Also persist token update to org_integrations credentials
  try {
    const [row] = await db
      .select()
      .from(orgIntegrations)
      .where(and(eq(orgIntegrations.orgId, orgId), eq(orgIntegrations.channel, 'ebay')))
      .limit(1);
    if (row) {
      const existing = (row.credentials as Record<string, string>) ?? {};
      await db
        .update(orgIntegrations)
        .set({ credentials: { ...existing, accessToken, tokenExpiry: String(Date.now() + expiresIn * 1000) } })
        .where(eq(orgIntegrations.id, row.id));
    }
  } catch { /* non-critical */ }

  return accessToken;
}

// ── eBay API fetch helper ──────────────────────────────────────────────────

const EBAY_MAX_RETRIES = 3;

async function ebayFetch(
  orgId: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: any }> {
  const creds = await loadEbayCredentials(orgId);
  const env = creds?.environment ?? 'production';
  const baseUrl = ebayBaseUrl(env);
  const url = `${baseUrl}${path}`;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= EBAY_MAX_RETRIES; attempt++) {
    const accessToken = await getAccessToken(orgId);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept:         'application/json',
          ...extraHeaders,
        },
        body:   body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (networkErr) {
      lastError = networkErr instanceof Error ? networkErr : new Error(String(networkErr));
      if (attempt < EBAY_MAX_RETRIES) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        continue;
      }
      throw lastError;
    }

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') ?? '5', 10);
      if (attempt < EBAY_MAX_RETRIES) {
        await new Promise(r => setTimeout(r, (isNaN(retryAfter) ? 5 : retryAfter) * 1000));
        continue;
      }
    }

    if (response.status >= 500) {
      if (attempt < EBAY_MAX_RETRIES) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        continue;
      }
    }

    // 204 No Content (success with no body)
    if (response.status === 204) return { ok: true, status: 204, data: null };

    let data: any = null;
    try { data = await response.json(); } catch { data = null; }

    return { ok: response.ok, status: response.status, data };
  }

  throw lastError ?? new Error(`[eBay] Unexpected retry exit for ${method} ${path}`);
}

// ── eBay Inventory API helpers ─────────────────────────────────────────────

/**
 * Fetch all eBay inventory items for this org (paginated).
 * Returns a map of SKU → EbayInventoryItem.
 */
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
      const blInvId = parseSkuToBlInvId(sku);
      result.set(sku, {
        sku,
        quantity:  item.availability?.shipToLocationAvailability?.quantity ?? 0,
        price:     null, // price is on the offer, not the item
        title:     item.product?.title ?? null,
        condition: item.condition ?? null,
        blInvId:   blInvId ?? undefined,
      });
    }

    const total: number = data.total ?? 0;
    offset += limit;
    hasMore = offset < total;
  }

  return result;
}

/**
 * Fetch all eBay offers (price, listing status).
 * Returns a map of SKU → partial offer info.
 */
async function getAllEbayOffers(orgId: string): Promise<Map<string, { offerId: string; price: string; listingId?: string }>> {
  // We fetch offers by listing them; eBay doesn't provide a single "get all" but we can
  // iterate through items and get their offers. For efficiency, we'll fetch in bulk.
  // eBay offers endpoint supports filtering by sku (one at a time) which is slow.
  // Instead, we rely on the inventory items list above and fetch offer data separately
  // only for items that exist. For analysis mode this is fine; for sync mode we fetch lazily.
  return new Map();
}

/**
 * Get offer for a specific SKU. Returns null if none.
 */
async function getOfferForSku(orgId: string, sku: string): Promise<{ offerId: string; price: string; listingId?: string; status?: string } | null> {
  const { ok, data } = await ebayFetch(orgId, 'GET', `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`);
  if (!ok || !data?.offers?.length) return null;
  const offer = data.offers[0];
  return {
    offerId:   offer.offerId,
    price:     offer.pricingSummary?.price?.value ?? '0',
    listingId: offer.listing?.listingId,
    status:    offer.status,
  };
}

// ── Image resolution ───────────────────────────────────────────────────────

/**
 * Build a publicly accessible image URL for a given lot.
 * Resolution order: lot-level → item-type-level → catalog (BL-style image proxy).
 *
 * Returns an array of URLs (for eBay's imageUrls field — max 12).
 * If no user images exist, falls back to catalog image URL.
 */
async function resolveImageUrls(opts: {
  orgId:       string;
  blInvId:     number;
  itemNo:      string;
  itemType:    string;
  colorId:     number;
  serverOrigin: string;
  syncImages:  boolean;
}): Promise<string[]> {
  if (!opts.syncImages) return [];

  try {
    const { lotLevel, itemTypeLevel } = await getImagesForLot({
      orgId:         opts.orgId,
      blInventoryId: opts.blInvId,
      itemNo:        opts.itemNo,
      itemType:      opts.itemType,
    });

    // Use lot-level images first, then item-type-level
    const userImages = lotLevel.length > 0 ? lotLevel : itemTypeLevel;
    if (userImages.length > 0) {
      return userImages
        .slice(0, 12)
        .map(img => `${opts.serverOrigin}/api/user-images/${encodeURIComponent(img.storageKey)}`);
    }
  } catch { /* fall through to catalog fallback */ }

  // Catalog fallback — use our image proxy which returns a processed PNG
  const typeCode = opts.itemType === 'PART' || opts.itemType === 'P' ? 'pn'
    : opts.itemType === 'MINIFIG' || opts.itemType === 'M' ? 'mn'
    : opts.itemType === 'SET' || opts.itemType === 'S' ? 'sn'
    : 'pn';

  return [`${opts.serverOrigin}/api/part-image/${typeCode}/${opts.colorId}/${opts.itemNo}`];
}

// ── eBay listing title builder ─────────────────────────────────────────────

function buildEbayTitle(opts: {
  itemNo:    string;
  itemName:  string | null;
  colorName: string | null;
  itemType:  string;
  condition: string; // 'N' | 'U'
}): string {
  const { itemNo, itemName, colorName, itemType, condition } = opts;
  const condLabel = condition === 'N' ? 'New' : 'Used';
  const typeLabel = itemType === 'S' ? 'Set' : itemType === 'M' ? 'Minifigure' : itemType === 'G' ? 'Gear' : 'Part';

  let title = 'LEGO';
  if (itemName) title += ` ${itemName}`;
  if (colorName && itemType !== 'S') title += ` ${colorName}`;
  title += ` ${itemNo}`;
  if (itemType !== 'S') title += ` ${typeLabel}`;
  title += ` ${condLabel}`;

  // eBay title limit: 80 characters
  return title.slice(0, 80).trim();
}

// ── eBay Inventory Item body builder ──────────────────────────────────────

function buildInventoryItemBody(opts: {
  blLot:       any;
  itemName:    string | null;
  colorName:   string | null;
  imageUrls:   string[];
  config:      EbayChannelConfig;
}): Record<string, unknown> {
  const { blLot, itemName, colorName, imageUrls, config } = opts;
  const isNew = blLot.newOrUsed === 'N';

  const conditionId = isNew
    ? EBAY_CONDITIONS.NEW
    : (config.ebayConditionUsed === 'USED_VERY_GOOD' ? EBAY_CONDITIONS.USED_VERY_GOOD
      : config.ebayConditionUsed === 'USED_GOOD' ? EBAY_CONDITIONS.USED_GOOD
      : EBAY_CONDITIONS.USED_ACCEPTABLE);

  const title = buildEbayTitle({
    itemNo:    blLot.itemNo,
    itemName,
    colorName,
    itemType:  blLot.itemType,
    condition: blLot.newOrUsed ?? 'U',
  });

  const aspects: Record<string, string[]> = {
    Brand:         ['LEGO'],
    'LEGO Theme':  ['LEGO'],
    'Set Number':  [blLot.itemNo],
  };
  if (colorName && blLot.itemType !== 'S') aspects['Color'] = [colorName];
  if (blLot.newOrUsed) aspects['Condition'] = [isNew ? 'New' : 'Used'];

  // Store BrickLink lot ID in item specifics if configured
  if (config.ebayBlIdField === 'item_specifics') {
    aspects['BrickLink Lot ID'] = [String(blLot.id)];
  }

  const body: Record<string, unknown> = {
    product: {
      title,
      description: config.syncDescription !== false ? buildEbayDescription(blLot, itemName, colorName) : undefined,
      aspects,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    },
    condition:           conditionId,
    conditionDescription: isNew ? undefined : (blLot.description || undefined),
    availability: {
      shipToLocationAvailability: {
        quantity: Math.max(0, blLot.quantity ?? 0),
      },
    },
  };

  return body;
}

function buildEbayDescription(blLot: any, itemName: string | null, colorName: string | null): string {
  const lines: string[] = [];
  if (itemName) lines.push(`<b>${itemName}</b> (${blLot.itemNo})`);
  if (colorName && blLot.itemType !== 'S') lines.push(`Color: ${colorName}`);
  lines.push(`Condition: ${blLot.newOrUsed === 'N' ? 'New' : 'Used'}`);
  if (blLot.description) lines.push(`<br>${blLot.description}`);
  lines.push('<br><i>Listed and fulfilled by an independent LEGO seller. Part of a larger collection — see store for more items.</i>');
  return lines.join('<br>');
}

// ── Offer body builder ────────────────────────────────────────────────────

function buildOfferBody(opts: {
  sku:        string;
  blLot:      any;
  categoryId: string;
  config:     EbayChannelConfig;
}): Record<string, unknown> {
  const { sku, blLot, categoryId, config } = opts;
  const price = parseFloat(blLot.unitPrice ?? '0');

  const body: Record<string, unknown> = {
    sku,
    marketplaceId:     config.ebayMarketplaceId,
    format:            'FIXED_PRICE',
    listingDuration:   config.ebayListingDuration,
    availableQuantity: Math.max(0, blLot.quantity ?? 0),
    categoryId,
    pricingSummary: {
      price: {
        value:    price.toFixed(2),
        currency: 'USD',
      },
    },
    listingDescription: buildEbayDescription(blLot, null, null),
    includeCatalogProductDetails: config.ebayCatalogMatch && blLot.itemType === 'S',
  };

  if (config.ebayFulfillmentPolicyId) body.fulfillmentPolicyId = config.ebayFulfillmentPolicyId;
  if (config.ebayPaymentPolicyId)     body.paymentPolicyId     = config.ebayPaymentPolicyId;
  if (config.ebayReturnPolicyId)      body.returnPolicyId      = config.ebayReturnPolicyId;

  return body;
}

// ── Helper to detect abort ─────────────────────────────────────────────────

let _abortRequested = false;
export function requestEbayAbort() { _abortRequested = true; }
export function clearEbayAbort()   { _abortRequested = false; }
export function isEbayAbortRequested() { return _abortRequested; }

// ── Core sync function ─────────────────────────────────────────────────────

export async function syncBrickLinkToEbay(
  mode:       'analysis' | 'full_control' | 'matched_sync',
  onProgress: ((processed: number, total: number) => void) | undefined,
  config:     EbayChannelConfig,
  orgId:      string,
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
    rawBl = await db
      .select()
      .from(blInventory)
      .where(and(
        eq(blInventory.orgId, orgId),
        isNull(blInventory.deletedAt),
      ));
  } catch (err: any) {
    console.error('[eBay] Failed to load BrickLink inventory:', err.message, err.stack);
    result.errors.push(`Failed to load BrickLink inventory: ${err.message}`);
    return result;
  }

  // Filter by syncItemTypes
  const blLots = rawBl.filter(lot => {
    // If itemType is missing, skip
    if (!lot.itemType) return false;
    // Stockroom lots: skip if stockroom mode is 'skip' for that stockroom
    // (handled later, just include all for now)
    return true;
  });

  // ── Step 2: Load catalog info (names + colors) ────────────────────────────
  const itemNos = [...new Set(blLots.map(l => l.itemNo))];
  const colorIds = [...new Set(blLots.map(l => l.colorId).filter((c): c is number => c != null))];

  let catalogRows: { itemNo: string; itemType: string | null; name: string | null }[] = [];
  let colorRows: { colorId: number; colorName: string }[] = [];
  try {
    [catalogRows, colorRows] = await Promise.all([
      itemNos.length > 0
        ? db.select({ itemNo: blCatalog.itemNo, itemType: blCatalog.itemType, name: blCatalog.name })
            .from(blCatalog)
            .where(inArray(blCatalog.itemNo, itemNos))
        : Promise.resolve([]),
      colorIds.length > 0
        ? db.select({ colorId: blColors.colorId, colorName: blColors.colorName })
            .from(blColors)
            .where(inArray(blColors.colorId, colorIds))
        : Promise.resolve([]),
    ]);
  } catch (err: any) {
    console.error('[eBay] Failed to load catalog/color data:', err.message, err.stack);
    result.errors.push(`Failed to load catalog data: ${err.message}`);
    return result;
  }

  const catalogMap = new Map<string, string>();
  for (const row of catalogRows) catalogMap.set(`${row.itemType}:${row.itemNo}`, row.name ?? '');
  const colorMap = new Map<number, string>();
  for (const row of colorRows) colorMap.set(row.colorId, row.colorName);

  // ── Step 3: Load existing channel lot links (BL→eBay mappings) ────────────
  let existingLinks: (typeof channelLotLinks.$inferSelect)[];
  try {
    existingLinks = await db
      .select()
      .from(channelLotLinks)
      .where(and(
        eq(channelLotLinks.orgId, orgId),
        eq(channelLotLinks.channel, EBAY_CHANNEL),
      ));
  } catch (err: any) {
    console.error('[eBay] Failed to load channel lot links:', err.message, err.stack);
    result.errors.push(`Failed to load channel lot links: ${err.message}`);
    return result;
  }

  const linkByBlInvId = new Map<number, string>(); // blInvId → eBay listing ID or SKU
  for (const link of existingLinks) {
    if (link.blInvId != null) linkByBlInvId.set(link.blInvId, link.channelLotId ?? '');
  }

  // ── Step 4: Load eBay inventory (all items) ───────────────────────────────
  console.log('[eBay] Fetching current eBay inventory…');
  let ebayItems: Map<string, EbayInventoryItem>;
  try {
    ebayItems = await getAllEbayInventoryItems(orgId);
    result.totalApiCalls += Math.ceil(ebayItems.size / 200) + 1;
  } catch (err: any) {
    result.errors.push(`Failed to fetch eBay inventory: ${err.message}`);
    return result;
  }

  // Build reverse map: blInvId → eBay item (from SKU)
  const ebayByBlInvId = new Map<number, EbayInventoryItem>();
  for (const [sku, item] of ebayItems) {
    if (item.blInvId != null) ebayByBlInvId.set(item.blInvId, item);
  }

  const total = blLots.length;
  let processed = 0;

  if (mode === 'analysis') {
    // ── ANALYSIS MODE ─────────────────────────────────────────────────────
    const preview: EbayAnalysisPreview = {
      matchedLots:   0,
      unmatchedLots: 0,
      wouldUpdate:   0,
      wouldCreate:   0,
      byField:       { qty: 0, price: 0, description: 0, images: 0 },
    };

    for (const lot of blLots) {
      processed++;
      if (onProgress) onProgress(processed, total);
      if (isEbayAbortRequested()) break;

      const ebayItem = ebayByBlInvId.get(lot.id);
      if (!ebayItem) {
        preview.unmatchedLots++;
        preview.wouldCreate++;
        continue;
      }

      preview.matchedLots++;
      let hasChanges = false;

      const blQty = lot.quantity ?? 0;
      if (ebayItem.quantity !== blQty) { preview.byField.qty++; hasChanges = true; }

      if (hasChanges) preview.wouldUpdate++;
    }

    result.preview = preview;
    return result;
  }

  // ── SYNC MODE (full_control | matched_sync) ──────────────────────────────
  for (const lot of blLots) {
    if (isEbayAbortRequested()) {
      result.errors.push('Sync aborted by user request.');
      break;
    }

    processed++;
    if (onProgress) onProgress(processed, total);

    const sku = makeSku(lot.id);
    const ebayItem = ebayByBlInvId.get(lot.id);
    const isMatched = !!ebayItem;

    if (!isMatched && mode === 'matched_sync') {
      result.lotsSkipped++;
      continue;
    }

    const categoryId = EBAY_LEGO_CATEGORIES[lot.itemType ?? 'P'] ?? EBAY_LEGO_CATEGORIES['P'];
    const itemName   = catalogMap.get(`${lot.itemType}:${lot.itemNo}`) ?? null;
    const colorName  = lot.colorId != null ? colorMap.get(lot.colorId) ?? null : null;

    // Resolve images
    const imageUrls = config.syncImages ? await resolveImageUrls({
      orgId,
      blInvId:      lot.id,
      itemNo:       lot.itemNo,
      itemType:     lot.itemType ?? 'P',
      colorId:      lot.colorId ?? 0,
      serverOrigin,
      syncImages:   config.syncImages,
    }) : [];

    // Build inventory item body
    const itemBody = buildInventoryItemBody({ blLot: lot, itemName, colorName, imageUrls, config });

    // ── PUT inventory item ──────────────────────────────────────────────────
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

    // ── Create or update offer ─────────────────────────────────────────────
    try {
      const existingOffer = isMatched ? await getOfferForSku(orgId, sku) : null;
      result.totalApiCalls++;

      const offerBody = buildOfferBody({ sku, blLot: lot, categoryId, config });

      if (existingOffer) {
        // Update existing offer
        const updateResult = await ebayFetch(orgId, 'PUT', `/sell/inventory/v1/offer/${existingOffer.offerId}`, offerBody);
        result.totalApiCalls++;

        if (!updateResult.ok) {
          const errMsg = updateResult.data?.errors?.[0]?.message ?? JSON.stringify(updateResult.data);
          result.errors.push(`SKU ${sku}: offer update failed — ${errMsg}`);
        } else {
          result.lotsUpdated++;
          // Update channel lot link
          await upsertChannelLink(orgId, lot.id, existingOffer.listingId ?? sku);
        }
      } else if (mode === 'full_control') {
        // Create new offer
        const createResult = await ebayFetch(orgId, 'POST', '/sell/inventory/v1/offer', offerBody);
        result.totalApiCalls++;

        if (!createResult.ok) {
          const errMsg = createResult.data?.errors?.[0]?.message ?? JSON.stringify(createResult.data);
          result.errors.push(`SKU ${sku}: offer creation failed — ${errMsg}`);
          result.lotsSkipped++;
          continue;
        }

        const offerId = createResult.data?.offerId;
        if (offerId) {
          // Publish the offer to make it a live listing
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

    // Throttle — eBay Inventory API allows ~5000 calls/day on developer plan
    // Avoid hammering: small delay between each lot
    if (processed % 20 === 0) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return result;
}

// ── Channel lot link helpers ──────────────────────────────────────────────

async function upsertChannelLink(orgId: string, blInvId: number, channelLotId: string): Promise<void> {
  try {
    await db
      .insert(channelLotLinks)
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

    // Try to get an access token
    await getAccessToken(orgId);

    // Lightweight check: list inventory items (limit 1)
    const { ok, data } = await ebayFetch(orgId, 'GET', '/sell/inventory/v1/inventory_item?limit=1');
    if (!ok) {
      return { ok: false, message: `eBay API returned error: ${data?.errors?.[0]?.message ?? 'unknown'}` };
    }

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

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeEbayAuthCode(opts: {
  appId:       string;
  certId:      string;
  code:        string;
  redirectUri: string;
  environment: 'production' | 'sandbox';
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const baseUrl = ebayBaseUrl(opts.environment);
  const basicAuth = Buffer.from(`${opts.appId}:${opts.certId}`).toString('base64');

  const resp = await fetch(`${baseUrl}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code:         opts.code,
      redirect_uri: opts.redirectUri,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`eBay token exchange failed: ${resp.status} ${body}`);
  }

  const data = await resp.json();
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresIn:    data.expires_in ?? 7200,
  };
}

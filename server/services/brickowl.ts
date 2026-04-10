import { db } from "../db";
import { blInventory, blColors, channelLotLinks, orgIntegrations } from "@shared/schema";
import { eq, isNotNull, isNull, inArray, sql, and, gt } from "drizzle-orm";
import { decodeHTML } from "entities";

const BO_CHANNEL = 'brickowl' as const;

/**
 * Fetch the BrickOwl API key for an org from org_integrations.
 * Falls back to the BRICKOWL_API_KEY env var (platform-level override).
 */
export async function getBrickOwlApiKey(orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ credentials: orgIntegrations.credentials })
    .from(orgIntegrations)
    .where(and(eq(orgIntegrations.orgId, orgId), eq(orgIntegrations.channel, 'brickowl')))
    .limit(1);
  const apiKey = (row?.credentials as Record<string, string> | undefined)?.apiKey;
  return apiKey || process.env.BRICKOWL_API_KEY || null;
}

// Normalize a note/description string so both sides of a BL↔BO comparison are
// always in the same canonical form before being compared or pushed to BrickOwl.
//
// Problems this solves:
//  1. BrickLink stores notes with HTML entities (&#39;, &#40;, &#41;, &#8217;, &nbsp;, …)
//     The old hand-rolled decoder only handled 9 specific entities.  Any entity
//     outside that set (e.g. &#160; for non-breaking space, &#8230; for ellipsis,
//     &#44; for comma, etc.) would pass through un-decoded, causing BrickOwl (which
//     decodes everything on storage) to return a different string next time, so the
//     diff never resolved no matter how many syncs ran.
//  2. BrickOwl's /inventory/list response may itself HTML-encode the stored text
//     (returning &#40; for ( etc.), which also needs decoding before comparison.
//  3. Non-breaking spaces (\u00a0 / &nbsp; / &#160;) render identically to a regular
//     space in every UI but compare differently — normalise to ASCII space.
//  4. Windows CRLF / bare CR line-endings from BrickLink are normalised to LF so
//     they don't cause spurious differences vs BrickOwl which always stores LF.
function decodeHtmlEntities(text: string | null | undefined): string {
  if (!text) return '';
  return decodeHTML(text)          // handles ALL named + numeric entities
    .replace(/\u00a0/g, ' ')       // non-breaking space → regular space
    .replace(/\r\n/g, '\n')        // Windows CRLF → LF
    .replace(/\r/g, '\n')          // old Mac CR → LF
    .trim();
}

export interface SyncPreviewBreakdown {
  matchedLots:   number; // BL lots that have a linked BO lot
  unmatchedLots: number; // BL lots with no BO match (would be created in full_control)
  wouldUpdate:   number; // matched lots with at least one enabled field changed
  wouldCreate:   number; // unmatched lots that would be created (full_control only, counted in analysis)
  byField: {
    qty:         number;
    price:       number;
    remarks:     number;
    description: number;
    tierPrice:   number;
    salePercent: number;
    forSale:     number;
    bulkQty:     number;
    lotWeight:   number;
  };
}

export interface SyncUpdatedItem {
  itemNo: string;
  condition: string;
  lotId: string;
  changes: Array<{
    field: 'qty' | 'price' | 'remarks' | 'description' | 'tierPrice' | 'salePercent' | 'forSale' | 'bulkQty' | 'color';
    from: string;
    to: string;
  }>;
}

export interface SkippedCreateItem {
  itemNo: string;
  blInvId?: number;
  boid?: string;
  lotId?: string;
  colorId?: number;
  colorName?: string;
  qty?: number;
  price?: string;
  condition?: string;
  itemType?: string;
}

export interface BrickOwlSyncResult {
  lotsCreated: number;
  lotsUpdated: number;
  lotsSkipped: number;
  lotsDeactivated?: number;
  errors: string[];
  totalApiCalls: number;
  preview?: SyncPreviewBreakdown; // populated when mode === 'analysis'
  updatedItems?: SyncUpdatedItem[]; // per-item field-level changes (capped at 200)
  // Items skipped during create because BrickOwl is retiring the catalog entry
  skippedScheduledForDeletion?: SkippedCreateItem[];
  // Items skipped during create because the resolved BOID doesn't exist on BO
  skippedInvalidBoid?: SkippedCreateItem[];
}

export interface BrickOwlInventoryLot {
  lot_id: string;
  boid: string;
  color_id: number;
  qty: string;
  quantity?: number; // Alternative field name
  // BrickOwl returns THREE price fields:
  //   price       = effective price buyers pay (base_price × (1 - sale_percent/100))
  //   base_price  = the listing price we set via the API — compare against BL prices
  //   final_price = same as price (alias)
  // ALWAYS compare BL prices against base_price, not price.
  price: string;
  base_price: string;
  final_price?: string;
  condition: string;
  full_con?: string; // Full condition name
  for_sale: number | string;
  sale_percent?: string;    // BrickOwl store sale discount % — intentionally set by user, do NOT sync from BL
  external_lot_ids?: {
    other?: string;
    external_id_1?: string;
  };
  personal_note?: string;  // Internal notes (BrickLink remarks)
  public_note?: string;    // Public notes (BrickLink description)
  tier_price?: string;     // e.g. "100:0.050,200:0.040,500:0.030"
  sale_percentage?: number; // Normalized sale_percent (number)
  bulk_qty?: string | null; // Minimum order quantity (BrickLink bulk)
  my_cost?: string | null;  // Cost price (BrickLink myCost)
  lot_weight?: string | null; // Custom lot weight (BrickLink myWeight)
}

// ─── Retry helper ────────────────────────────────────────────────────────────
// Wraps a raw fetch call with automatic retry for:
//   429  — rate-limited: honours Retry-After header, falls back to 2 s
//   5xx  — transient server/load error: exponential back-off (1 s, 2 s, 4 s)
//   network errors (ECONNRESET, ETIMEDOUT, etc.) — same exponential back-off
// Permanent 4xx errors (400, 401, 403, 404) are not retried.
const BO_MAX_RETRIES = 3;

async function brickowlFetchWithRetry(
  url: string,
  options: RequestInit,
  context: string,
): Promise<Response> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= BO_MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, options);
    } catch (networkErr) {
      lastErr = networkErr instanceof Error ? networkErr : new Error(String(networkErr));
      if (attempt < BO_MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`[BrickOwl] ${context} — network error (attempt ${attempt + 1}/${BO_MAX_RETRIES + 1}), retrying in ${delay}ms: ${lastErr.message}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw lastErr;
    }

    if (response.status === 429) {
      const retryAfterRaw = response.headers.get('Retry-After');
      const retryAfterSec = retryAfterRaw ? parseInt(retryAfterRaw, 10) : 2;
      const delay = (isNaN(retryAfterSec) ? 2 : retryAfterSec) * 1000;
      if (attempt < BO_MAX_RETRIES) {
        console.warn(`[BrickOwl] ${context} — rate limited (429), waiting ${delay}ms then retry ${attempt + 1}/${BO_MAX_RETRIES}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      const body = await response.text().catch(() => '');
      throw new Error(`[BrickOwl] ${context} — rate limit exceeded after ${BO_MAX_RETRIES} retries: ${body}`);
    }

    if (response.status >= 500) {
      const delay = Math.pow(2, attempt) * 1000;
      lastErr = new Error(`[BrickOwl] ${context} — server error ${response.status}`);
      if (attempt < BO_MAX_RETRIES) {
        console.warn(`[BrickOwl] ${context} — server error ${response.status} (attempt ${attempt + 1}/${BO_MAX_RETRIES + 1}), retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      const body = await response.text().catch(() => '');
      throw new Error(`[BrickOwl] ${context} — server error after ${BO_MAX_RETRIES} retries: ${response.status} ${response.statusText} - ${body}`);
    }

    // 2xx / 3xx / permanent 4xx — return as-is (caller decides what to do with non-ok 4xx)
    return response;
  }
  throw lastErr ?? new Error(`[BrickOwl] ${context} — unexpected retry loop exit`);
}

// Make a BrickOwl API GET request
async function brickowlGet(endpoint: string, params?: Record<string, string>, orgId?: string): Promise<any> {
  if (!orgId) throw new Error('[BrickOwl] orgId is required — BrickOwl credentials are per-org.');
  const apiKey = await getBrickOwlApiKey(orgId);
  if (!apiKey) {
    throw new Error(`[BrickOwl] BrickOwl API key is not configured for org "${orgId}". Add it in Settings > Platforms.`);
  }

  const queryParams = new URLSearchParams({ key: apiKey, ...params });
  const url = `https://api.brickowl.com/v1${endpoint}?${queryParams.toString()}`;

  const response = await brickowlFetchWithRetry(
    url,
    { method: 'GET', headers: { Accept: 'application/json' } },
    `GET ${endpoint}`,
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`BrickOwl API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}

// Make a BrickOwl API POST request
async function brickowlPost(endpoint: string, data: Record<string, any>, orgId?: string): Promise<any> {
  if (!orgId) throw new Error('[BrickOwl] orgId is required — BrickOwl credentials are per-org.');
  const apiKey = await getBrickOwlApiKey(orgId);
  if (!apiKey) {
    throw new Error(`[BrickOwl] BrickOwl API key is not configured for org "${orgId}". Add it in Settings > Platforms.`);
  }

  const formData = new URLSearchParams({ key: apiKey, ...data });
  const url = `https://api.brickowl.com/v1${endpoint}`;

  const response = await brickowlFetchWithRetry(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    },
    `POST ${endpoint}`,
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`BrickOwl API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const rawText = await response.text().catch(() => '');
  if (!rawText) return {};
  try { return JSON.parse(rawText); } catch { return {}; }
}

/**
 * Post seller feedback for a BrickOwl order.
 * BO API: POST /v1/order/feedback — { order_id, rating: 1|0|-1, comment (max 120 chars) }
 * rating: 1 = Positive, 0 = Neutral, -1 = Negative
 */
export async function postBrickOwlFeedback(
  orderId: string,
  feedbackType: 'positive' | 'neutral' | 'negative',
  message: string,
  orgId: string,
): Promise<void> {
  const ratingMap: Record<string, string> = { positive: '1', neutral: '0', negative: '-1' };
  await brickowlPost('/order/feedback', {
    order_id: orderId,
    rating: ratingMap[feedbackType] ?? '1',
    comment: message.slice(0, 120),
  }, orgId);
}

// Get BrickOwl inventory list
export async function getBrickOwlInventory(activeOnly: boolean = true, orgId?: string): Promise<BrickOwlInventoryLot[]> {
  const params = { active_only: activeOnly ? '1' : '0' };
  const response = await brickowlGet('/inventory/list', params, orgId);
  
  // BrickOwl API returns array directly or { inventory: [...] }
  const lots = Array.isArray(response) ? response : (response.inventory || []);

  // Normalize API field names to our interface:
  //   sale_percent  → sale_percentage (number)
  //   tier_price    → coerce to string (API may return array/object/number)
  return lots.map((lot: any) => ({
    ...lot,
    // Normalize sale_percent → sale_percentage (number) for internal use.
    // Whether BL saleRate is pushed to BO sale_percent is controlled by fields.salePercent toggle.
    sale_percentage: typeof lot.sale_percent === 'number'
      ? lot.sale_percent
      : parseFloat(lot.sale_percent ?? lot.sale_percentage ?? '0') || 0,
    tier_price: lot.tier_price != null && typeof lot.tier_price !== 'string'
      ? (Array.isArray(lot.tier_price) && lot.tier_price.length === 0 ? undefined : String(lot.tier_price))
      : (lot.tier_price ?? undefined),
  }));
}

// Build a BrickOwl tier_price string from BrickLink tier fields.
// Returns undefined when no tiers are set, or 'remove' when clearing existing tiers.
function buildTierPriceString(
  qty1?: number | null, price1?: string | null,
  qty2?: number | null, price2?: string | null,
  qty3?: number | null, price3?: string | null,
): string | undefined {
  const tiers: string[] = [];
  if (qty1 && price1) tiers.push(`${qty1}:${parseFloat(price1).toFixed(3)}`);
  if (qty2 && price2) tiers.push(`${qty2}:${parseFloat(price2).toFixed(3)}`);
  if (qty3 && price3) tiers.push(`${qty3}:${parseFloat(price3).toFixed(3)}`);
  return tiers.length > 0 ? tiers.join(',') : undefined;
}

// Normalize a BrickOwl tier_price string so we can compare without formatting noise.
// e.g. "100:0.05,200:0.04" → "100:0.050,200:0.040"
// BrickOwl may return tier_price as a non-string (array, object, number) — coerce defensively.
function normalizeTierPrice(raw?: string | null | unknown): string {
  if (!raw || raw === 'remove') return '';
  // Coerce non-string values — if coercion yields a useless string, bail out
  const str = typeof raw === 'string' ? raw : String(raw);
  if (!str || str === '[object Object]' || str === 'null' || str === 'undefined') return '';
  return str.split(',').map(tier => {
    const [q, p] = tier.trim().split(':');
    const qty = parseInt(q, 10);
    const price = parseFloat(p);
    if (isNaN(qty) || isNaN(price)) return '';
    return `${qty}:${price.toFixed(3)}`;
  }).filter(Boolean).join(',');
}

// Create a new lot on BrickOwl
export async function createBrickOwlLot(data: {
  boid?: string;
  bl_item_no?: string;
  color_id?: number;
  quantity: number;
  price: number;
  condition?: string;
  for_sale?: number;
  external_id?: string;  // Use external_id (not external_id_1) to store as external_lot_ids.other
  personal_note?: string;
  public_note?: string;
  tier_price?: string;       // e.g. "100:0.050,200:0.040"
  sale_percentage?: number;  // BrickLink saleRate
  bulk_qty?: number;         // Minimum order quantity (BrickLink bulk)
  lot_weight?: number;       // Custom lot weight (BrickLink myWeight)
}, orgId?: string): Promise<any> {
  // Decode HTML entities from notes before sending to BrickOwl
  const decodedPersonalNote = data.personal_note ? decodeHtmlEntities(data.personal_note) : undefined;
  const decodedPublicNote = data.public_note ? decodeHtmlEntities(data.public_note) : undefined;
  
  const payload = {
    ...(data.boid && { boid: data.boid }),
    ...(data.bl_item_no && { bl_item_no: data.bl_item_no }),
    ...(data.color_id !== undefined && { color_id: data.color_id.toString() }),
    quantity: data.quantity.toString(),
    price: data.price.toFixed(3),
    ...(data.condition && { condition: data.condition }),
    ...(data.for_sale !== undefined && { for_sale: data.for_sale.toString() }),
    ...(data.external_id && { external_id: data.external_id }),
    ...(decodedPersonalNote && { personal_note: decodedPersonalNote }),
    ...(decodedPublicNote && { public_note: decodedPublicNote }),
    ...(data.tier_price && { tier_price: data.tier_price }),
    ...(data.sale_percentage !== undefined && data.sale_percentage > 0 && { sale_percentage: data.sale_percentage.toString() }),
    ...(data.bulk_qty !== undefined && data.bulk_qty > 0 && { bulk_qty: data.bulk_qty.toString() }),
    ...(data.lot_weight !== undefined && data.lot_weight > 0 && { lot_weight: data.lot_weight.toFixed(4) }),
  };
  console.log('[BrickOwl] Creating lot with payload:', JSON.stringify(payload));
  return brickowlPost('/inventory/create', payload, orgId);
}

// Delete a lot from BrickOwl by lot_id
export async function deleteBrickOwlLot(lotId: string, orgId?: string): Promise<any> {
  return brickowlPost('/inventory/delete', { lot_id: lotId }, orgId);
}

// Keep internal alias for uses within this file
const brickowlDeleteLot = deleteBrickOwlLot;

// Update an existing lot on BrickOwl
export async function updateBrickOwlLot(data: {
  lot_id?: string;
  external_id_1?: string;
  external_id?: string;   // Sets external_lot_ids.other (same field as create's external_id)
  absolute_quantity?: number;
  price?: number;
  condition?: string;
  for_sale?: number;
  personal_note?: string;
  public_note?: string;
  tier_price?: string;       // e.g. "100:0.050,200:0.040" or "remove"
  sale_percentage?: number;  // BrickLink saleRate; 0 = remove
  bulk_qty?: number;         // Minimum order quantity (BrickLink bulk)
  lot_weight?: number;       // Custom lot weight (BrickLink myWeight)
  color_id?: number;         // BrickOwl color ID — send to correct a color mismatch in-place
}, orgId?: string): Promise<any> {
  const updateData: Record<string, string> = {};
  
  if (data.lot_id) updateData.lot_id = data.lot_id;
  if (data.external_id_1) updateData.external_id_1 = data.external_id_1;
  if (data.external_id) updateData.external_id = data.external_id;
  if (data.absolute_quantity !== undefined) updateData.absolute_quantity = data.absolute_quantity.toString();
  if (data.price !== undefined) updateData.price = data.price.toFixed(3);
  if (data.condition) updateData.condition = data.condition;
  if (data.for_sale !== undefined) updateData.for_sale = data.for_sale.toString();
  if (data.tier_price !== undefined) updateData.tier_price = data.tier_price;
  // BrickOwl API field is `sale_percent` (not `sale_percentage`) — confirmed from API docs.
  // Wrong field name = sale updates silently ignored, causing permanent price discrepancies.
  if (data.sale_percentage !== undefined) updateData.sale_percent = data.sale_percentage.toString();
  // New fields
  if (data.bulk_qty !== undefined) updateData.bulk_qty = data.bulk_qty.toString();
  if (data.lot_weight !== undefined) updateData.lot_weight = data.lot_weight.toFixed(4);
  if (data.color_id !== undefined) updateData.color_id = data.color_id.toString();
  
  // Decode HTML entities from notes before sending to BrickOwl
  if (data.personal_note !== undefined) {
    updateData.personal_note = decodeHtmlEntities(data.personal_note);
  }
  if (data.public_note !== undefined) {
    updateData.public_note = decodeHtmlEntities(data.public_note);
  }
  
  return brickowlPost('/inventory/update', updateData, orgId);
}

// ─── Batch up to 50 inventory/update calls in one HTTP request ──────────────
// BrickOwl bulk/batch endpoint: POST /v1/bulk/batch
// Rate limit: 100 batch requests/min → 600ms between calls
// Throughput: 50 items × 100 batches/min = 5,000 updates/min
async function brickowlBatch(
  requests: Array<{ endpoint: string; request_method: 'GET' | 'POST'; params: Record<string, any>[] }>,
  orgId?: string,
): Promise<any[]> {
  if (!orgId) throw new Error('[BrickOwl] orgId is required — BrickOwl credentials are per-org.');
  const apiKey = await getBrickOwlApiKey(orgId);
  if (!apiKey) throw new Error(`[BrickOwl] BrickOwl API key is not configured for org "${orgId}". Add it in Settings > Platforms.`);

  // BrickOwl expects the requests field value to be the full JSON object
  // {"requests":[...]}, not just the raw array [...] — see API docs example.
  const formData = new URLSearchParams({
    key: apiKey,
    requests: JSON.stringify({ requests }),
  });

  const response = await brickowlFetchWithRetry(
    'https://api.brickowl.com/v1/bulk/batch',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    },
    'POST /bulk/batch',
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`BrickOwl Batch API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : (data.responses || []);
}

// Normalize BrickLink item type to BrickOwl format
function normalizeBrickLinkItemType(blType: string): string {
  // BrickLink uses uppercase (e.g., "PART"), BrickOwl expects proper case (e.g., "Part")
  const typeMap: Record<string, string> = {
    'PART': 'Part',
    'SET': 'Set',
    'MINIFIG': 'Minifigure',
    'GEAR': 'Gear',
    'CATALOG': 'Sticker',
    'INSTRUCTION': 'Instructions',
    'UNSORTED_LOT': 'Minibuild',
    'ORIGINAL_BOX': 'Packaging',
  };
  
  return typeMap[blType.toUpperCase()] || 'Part';
}

// ── Abort flag ───────────────────────────────────────────────────────────────
// Set via requestChannelSyncStop(); cleared automatically at the start of each
// new sync run. Checked at the boundary of every loop round so the sync can
// exit cleanly after finishing the current batch, without leaving partial writes.
let channelSyncAbortFlag = false;
export function requestChannelSyncStop() { channelSyncAbortFlag = true; }
export function clearChannelSyncAbort()  { channelSyncAbortFlag = false; }
export function isChannelSyncAbortRequested() { return channelSyncAbortFlag; }

// In-process BOID cache: survives for the lifetime of the server process.
// Key: "<blItemNo>:<normalizedType>:<boColorId|any>" — color-aware so the same
// part in different colors gets distinct BOIDs.
const boidCache = new Map<string, string | null>();

// In-process BrickLink→BrickOwl color ID cache (finite set, safe to hold forever).
const boColorCache = new Map<number, number | null>(); // BL color ID → BO color ID
const boColorNameCache = new Map<number, string>();    // BO color ID → BO color name
const blColorNameCache = new Map<number, string>();    // BL color ID → BL color name

// Look up a BO color name by BO color ID (populated after first color map load).
export function getBoColorName(boColorId: number): string {
  return boColorNameCache.get(boColorId) ?? `Color ${boColorId}`;
}
// Look up a BL color name by BL color ID (populated after first color map load).
export function getBlColorName(blColorId: number): string {
  return blColorNameCache.get(blColorId) ?? `Color ${blColorId}`;
}

// Lookup BOID from BrickLink item number + optional BrickOwl color ID (with in-process caching).
// When boColorId is supplied the API returns only the BOID for that specific color variant,
// which is essential for any item type that has per-color lots (Parts, Gear, etc.).
export async function lookupBoid(blItemNo: string, type: string = 'Part', boColorId?: number, orgId?: string): Promise<string | null> {
  const normalizedType = normalizeBrickLinkItemType(type);
  const cacheKey = `${blItemNo}:${normalizedType}:${boColorId ?? 'any'}`;

  if (boidCache.has(cacheKey)) {
    return boidCache.get(cacheKey)!;
  }

  try {
    const params: Record<string, string> = {
      id: blItemNo,
      type: normalizedType,
      id_type: 'bl_item_no',
    };
    if (boColorId !== undefined) {
      params.color_id = boColorId.toString();
    }

    const result = await brickowlGet('/catalog/id_lookup', params, orgId);

    let boids: string[] = [];
    if (result.boids && Array.isArray(result.boids)) {
      boids = result.boids;
    } else if (Array.isArray(result)) {
      boids = result.map((item: any) => item.boid || item);
    }

    const owlId = boids.length > 0 ? boids[0] : null;
    // BrickOwl's catalog/id_lookup returns the bare owl_id (e.g. "978971").
    // The actual boid used in BO inventory for color-variant parts is
    // "{owl_id}-{bo_color_id}" (e.g. "978971-92"). Append the suffix so that
    // lot creation, adoption matching, and mismatch detection all stay consistent.
    const boid = (owlId && boColorId != null && boColorId > 0) ? `${owlId}-${boColorId}` : owlId;
    // Only cache positive results — null means "not found" which may be transient
    // (catalog gap, API blip, wrong color mapping). Not caching allows the next
    // full scan to retry and pick up newly added catalog entries.
    if (boid) {
      boidCache.set(cacheKey, boid);
      console.log(`[BOID] ✓ ${blItemNo} (color=${boColorId ?? 'any'}) → ${boid}`);
    } else {
      console.log(`[BOID] ✗ ${blItemNo} (color=${boColorId ?? 'any'}): not found`);
    }
    return boid;
  } catch (error) {
    console.error(`[BOID] lookup failed for ${blItemNo}:`, error);
    // Don't cache failures — transient errors should be retried next sync
    return null;
  }
}

// ── BrickOwl color map ────────────────────────────────────────────────────────
// Loaded once per process via /catalog/color_list.
// Key: BrickLink color ID → Value: BrickOwl color ID.
let boColorMapLoaded = false;
// Permanent failure flag — if the endpoint errors, don't retry every item.
let boColorMapFailed = false;
// In-flight promise mutex — prevents duplicate concurrent fetches when
// resolveBoColorId is called simultaneously for multiple unique colors.
let boColorMapInflight: Promise<void> | null = null;

async function loadBoColorMap(orgId?: string): Promise<void> {
  // If a previous attempt failed due to missing orgId but we now have one, allow a retry.
  if (boColorMapFailed && orgId) boColorMapFailed = false;
  if (boColorMapLoaded || boColorMapFailed) return;
  if (boColorMapInflight) return boColorMapInflight;

  boColorMapInflight = (async () => {
    try {
      // Correct BrickOwl color list endpoint (underscore, not slash).
      const result = await brickowlGet('/catalog/color_list', {}, orgId);
      console.log(`[Color Map] Raw BO color list (first 400 chars):`, JSON.stringify(result).substring(0, 400));

      // BrickOwl returns an object keyed by BO color ID: { "0": {...}, "2": {...}, ... }
      // Each entry has: id (BO color ID, string), bl_ids (array of BL color ID strings),
      // and optionally bl_color_id / bl_id for single-value mappings.
      let colorEntries: any[] = [];
      if (Array.isArray(result)) {
        colorEntries = result;
      } else if (result && typeof result === 'object') {
        // Object keyed by color ID — convert values to array
        colorEntries = Object.values(result);
      }

      let mapped = 0;
      for (const c of colorEntries) {
        // BO color ID — may be a string in the response
        const boIdRaw = c.color_id ?? c.id;
        if (boIdRaw == null) continue;
        const boId = typeof boIdRaw === 'string' ? parseInt(boIdRaw) : boIdRaw;
        if (isNaN(boId)) continue;

        // Store BO color name
        if (c.name) boColorNameCache.set(boId, c.name);

        // BL color IDs — BO API returns bl_ids as an array of strings,
        // or sometimes a single value in bl_color_id / bl_id.
        const blSources: (string | number)[] = [];
        if (Array.isArray(c.bl_ids)) {
          blSources.push(...c.bl_ids.filter((v: any) => v != null));
        } else if (c.bl_color_id != null) {
          blSources.push(c.bl_color_id);
        } else if (c.bl_id != null) {
          blSources.push(c.bl_id);
        } else if (c.bricklink_color_id != null) {
          blSources.push(c.bricklink_color_id);
        }

        // BL color names — parallel array to bl_ids
        const blNames: string[] = Array.isArray(c.bl_names) ? c.bl_names.filter(Boolean) : [];

        for (let idx = 0; idx < blSources.length; idx++) {
          const blRaw = blSources[idx];
          const blId = typeof blRaw === 'string' ? parseInt(blRaw) : blRaw;
          if (isNaN(blId)) continue;
          boColorCache.set(blId, boId);
          if (blNames[idx]) blColorNameCache.set(blId, blNames[idx]);
          mapped++;
        }
      }

      boColorMapLoaded = true;
      console.log(`[Color Map] Loaded ${mapped} BL→BO color mappings from ${colorEntries.length} BO colors`);
    } catch (err) {
      console.error(`[Color Map] Failed to load BO color list:`, err);
      boColorMapFailed = true;
    } finally {
      boColorMapInflight = null;
    }
  })();

  return boColorMapInflight;
}

// Resolve a BrickLink color ID to a BrickOwl color ID (cached per-process).
// Returns null when BL has no color (null/undefined input) OR when the color
// cannot be mapped (color map unavailable or BL-only color).
// Per business rule: if BL has no color, no color is sent to BrickOwl.
async function resolveBoColorId(blColorId: number | null | undefined, orgId?: string): Promise<number | null> {
  if (blColorId == null) return null; // No BL color → send none to BO
  // Ensure the color map is loaded (no-op after first successful load or failure)
  await loadBoColorMap(orgId);
  return boColorCache.get(blColorId) ?? null;
}

// Map BrickLink color ID to BrickOwl color ID (exported for diagnostics/testing)
export async function mapColorId(bricklinkColorId: number, orgId?: string): Promise<number | null> {
  return resolveBoColorId(bricklinkColorId, orgId);
}

/**
 * Maps a BrickLink new/used code + item type to the BrickOwl condition SHORT CODE
 * required by the CREATE and UPDATE lot API.
 *
 * CONFIRMED via live API testing (April 2026):
 *   - Full strings ('New (Sealed)', 'Used (Good)', etc.) are ALWAYS rejected with 400.
 *     The error message displays full strings as examples — do NOT send them.
 *   - Short codes are required for both create and update calls.
 *   - Valid short codes differ by item type AND (for Sets) BrickLink completeness:
 *
 *   Sets (completeness-aware):
 *     BL completeness S + N → 'news'   (New Sealed)
 *     BL completeness C + N → 'newc'   (New Complete)
 *     BL completeness B + N → 'newi'   (New Incomplete)
 *     unknown/null    + N → 'news'     (safest fallback for new sets)
 *     BL completeness C + U → 'usedc'  (Used Complete)
 *     BL completeness B + U → 'usedi'  (Used Incomplete)
 *     unknown/null    + U → 'usedc'    (safest fallback for used sets)
 *
 *   Gear: N → 'news', U → 'usedc'  (all codes accepted; sealed/complete most appropriate)
 *
 *   Parts, Minifigs, Books, Instructions, everything else:
 *     N → 'new', U → 'usedg'
 *
 * BrickOwl's GET /inventory/list returns short codes in the 'full_con' field —
 * used for matching existing lots, never sent to write APIs.
 */
export function toBOApiCondition(newOrUsed: string, itemType?: string, completeness?: string | null): string {
  const isNew = newOrUsed === 'N';
  const type = (itemType ?? '').toUpperCase();

  if (type === 'SET' || type === 'S') {
    const c = (completeness ?? '').toUpperCase();
    if (isNew) {
      if (c === 'C') return 'newc';   // New (Complete)
      if (c === 'B') return 'newi';   // New (Incomplete)
      return 'news';                  // New (Sealed) — default / completeness=S
    } else {
      if (c === 'B') return 'usedi';  // Used (Incomplete)
      return 'usedc';                 // Used (Complete) — default / completeness=C
    }
  }

  if (type === 'GEAR' || type === 'G') {
    return isNew ? 'news' : 'usedc';
  }

  // Parts, Minifigs, Books, Instructions, and everything else
  return isNew ? 'new' : 'usedg';
}

// Sync a single inventory item from BrickLink to BrickOwl
export async function syncInventoryItem(
  blItem: typeof blInventory.$inferSelect,
  brickowlInventory?: any[],
  mode: 'analysis' | 'full_control' | 'matched_sync' = 'full_control',
  taggedLotMap?: Map<string, any>,
  orgId?: string,
): Promise<{
  success: boolean;
  action: 'created' | 'updated' | 'skipped';
  error?: string;
}> {
  try {
    const newPrice = blItem.unitPrice ? parseFloat(blItem.unitPrice) : 0;
    const apiCondition = toBOApiCondition(blItem.newOrUsed, blItem.itemType ?? undefined, blItem.completeness ?? undefined);
    const isUsedItem   = blItem.newOrUsed !== 'N';

    // ─── STEP 1: Match by BrickLink inventory ID tag (fast, reliable) ───────
    // Priority: pre-built taggedLotMap → channel_lot_links DB lookup → linear scan of brickowlInventory.
    // The BO inventory is fetched lazily (only if needed for Step 2/3 adopt+create paths).
    let taggedLot: any = null;
    if (taggedLotMap) {
      taggedLot = taggedLotMap.get(blItem.id.toString());
    } else {
      // Single-item call: query channel_lot_links for this specific BL inv ID (O(1) DB lookup).
      const [link] = await db
        .select({ channelLotId: channelLotLinks.channelLotId })
        .from(channelLotLinks)
        .where(and(
          eq(channelLotLinks.blInvId, blItem.id),
          eq(channelLotLinks.channel, BO_CHANNEL),
          ...(orgId ? [eq(channelLotLinks.orgId, orgId)] : []),
        ))
        .limit(1);

      if (link) {
        // Found in mapping table — resolve the full lot object for change detection.
        // Fetch BO inventory lazily if not provided by the caller.
        if (!brickowlInventory) {
          brickowlInventory = await getBrickOwlInventory(false, orgId);
        }
        taggedLot = brickowlInventory.find((lot: any) => lot.lot_id === link.channelLotId);
      } else if (brickowlInventory) {
        // Not in channel_lot_links (pre-dates mapping) — fall back to linear scan.
        taggedLot = brickowlInventory.find((lot: any) => lot.external_lot_ids?.other === blItem.id.toString());
      }
      // If neither channelLotLinks nor brickowlInventory has a match, taggedLot remains null
      // and we fall through to Step 2 (BOID lookup / adopt / create).
    }

    if (taggedLot) {
      const existingQty = parseInt(taggedLot.qty);
      const existingPrice = parseFloat(taggedLot.price);
      const qtyChanged = existingQty !== blItem.quantity;
      const priceChanged = Math.abs(existingPrice - newPrice) > 0.001;
      // Decode both sides before comparing so HTML entities (&#39;, &#160;, &nbsp;, etc.)
      // and whitespace differences don't cause spurious change-detections.
      const remarksChanged = decodeHtmlEntities(taggedLot.personal_note) !== decodeHtmlEntities(blItem.remarks);
      const descriptionChanged = decodeHtmlEntities(taggedLot.public_note) !== decodeHtmlEntities(blItem.description);

      if (qtyChanged || priceChanged || remarksChanged || descriptionChanged) {
        if (mode === 'analysis') {
          console.log(`[Sync] Analysis: ${blItem.itemNo} has changes (qty/price/remarks) — skipping write`);
          return { success: true, action: 'skipped' };
        }
        console.log(`[Sync] Updating ${blItem.itemNo} (BL inv ${blItem.id}): Qty ${existingQty} → ${blItem.quantity}, Price $${existingPrice} → $${newPrice}`);
        await updateBrickOwlLot({
          lot_id: taggedLot.lot_id,
          absolute_quantity: blItem.quantity,
          price: newPrice,
          condition: apiCondition,
          for_sale: 1,
          personal_note: blItem.remarks || undefined,
          public_note: blItem.description || undefined,
        }, orgId);
        return { success: true, action: 'updated' };
      } else {
        console.log(`[Sync] Skipping ${blItem.itemNo} - no changes detected`);
        return { success: true, action: 'skipped' };
      }
    }

    // ─── STEP 2: Look up BOID and check for pre-existing untagged lots ──────
    // Pre-existing BrickOwl lots (created before external_id tagging was in place)
    // won't have external_lot_ids.other set. We identify them by BOID + condition
    // so we can update them in place instead of creating duplicates.

    // Analysis mode: no tagged lot found, no writes allowed — skip BOID lookup entirely.
    // BOID lookups are external API calls (~400ms each); skipping them makes analysis
    // mode orders of magnitude faster when most items aren't yet tagged.
    if (mode === 'analysis') {
      return { success: true, action: 'skipped' };
    }

    const boid = await lookupBoid(blItem.itemNo, blItem.itemType);

    if (boid) {
      // Need the full BO inventory to scan for untagged lots (adopt path).
      // Fetch lazily here — avoids the API call when Step 1 succeeds (common case).
      if (!brickowlInventory) {
        brickowlInventory = await getBrickOwlInventory(false, orgId);
      }
      const USED_CONDITIONS = ['usedg', 'usedc', 'usedn', 'useda', 'usedi'];
      const untaggedMatches = brickowlInventory.filter((lot: any) => {
        const lotCond = lot.full_con || lot.condition;
        return lot.boid === boid &&
          (lotCond === apiCondition || (isUsedItem && USED_CONDITIONS.includes(lotCond)));
      });

      if (untaggedMatches.length === 1) {
        // Exactly one pre-existing lot for this part + condition — safe to adopt it.
        const untaggedLot = untaggedMatches[0];
        if ((mode as string) === 'analysis') {
          console.log(`[Sync] Analysis: would adopt pre-existing BrickOwl lot ${untaggedLot.lot_id} for ${blItem.itemNo} — skipping write`);
          return { success: true, action: 'skipped' };
        }
        console.log(`[Sync] Adopting pre-existing BrickOwl lot ${untaggedLot.lot_id} for ${blItem.itemNo} (BOID ${boid}) and tagging with BL inv ID ${blItem.id}`);
        await updateBrickOwlLot({
          lot_id: untaggedLot.lot_id,
          external_id: blItem.id.toString(), // Tag it so future syncs use Step 1
          absolute_quantity: blItem.quantity,
          price: newPrice,
          condition: apiCondition,
          for_sale: 1,
          personal_note: blItem.remarks || undefined,
          public_note: blItem.description || undefined,
        }, orgId);
        return { success: true, action: 'updated' };
      }

      if (untaggedMatches.length > 1) {
        // Multiple untagged lots with the same BOID + condition — ambiguous.
        // Do NOT create yet another duplicate. Log and skip so the user can
        // manually clean up and tag one of the existing lots.
        const lotIds = untaggedMatches.map((l: any) => l.lot_id).join(', ');
        console.warn(`[Sync] SKIPPED ${blItem.itemNo}: ${untaggedMatches.length} ambiguous untagged BrickOwl lots found (lot IDs: ${lotIds}). Resolve duplicates on BrickOwl before syncing.`);
        return {
          success: false,
          action: 'skipped',
          error: `${untaggedMatches.length} duplicate untagged BrickOwl lots found for ${blItem.itemNo} (BOID ${boid}, condition: ${apiCondition}). Clean up duplicates on BrickOwl first.`,
        };
      }
    }

    // ─── STEP 3: No existing lot found anywhere — safe to create ────────────
    if (!boid) {
      return {
        success: false,
        action: 'skipped',
        error: `Could not find BOID for BrickLink item ${blItem.itemNo}`,
      };
    }

    if ((mode as string) === 'analysis' || mode === 'matched_sync') {
      // Analysis mode: read-only, never write anything — just build comparison data
      // Matched-sync mode: only update already-matched lots — never create new listings
      console.log(`[Sync] Skipping ${blItem.itemNo} (${mode} mode — no existing BrickOwl lot)`);
      return { success: true, action: 'skipped' };
    }

    console.log(`[Sync] Creating new lot for ${blItem.itemNo} (BL inv ${blItem.id})`);
    await createBrickOwlLot({
      boid,
      quantity: blItem.quantity,
      price: newPrice,
      condition: apiCondition,
      for_sale: 1,
      external_id: blItem.id.toString(), // Tag immediately so future syncs find it in Step 1
      personal_note: blItem.remarks || undefined,
      public_note: blItem.description || undefined,
    }, orgId);

    return { success: true, action: 'created' };
  } catch (error) {
    return {
      success: false,
      action: 'skipped',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ─── Industry-standard delta sync with bulk batching ─────────────────────────
//
// Strategy:
//   Phase 1 — Pure in-memory comparison (no API calls, no delays).
//             Classify every BL item into one of three buckets:
//               toUpdate  — tagged lot exists in BO and fields have changed
//               toAdopt   — no tagged lot; needs BOID lookup (full_control only)
//               skipped   — no changes or read-only mode
//
//   Phase 2 — Apply writes via BrickOwl's bulk/batch endpoint (max 50 per call,
//             100 calls/min → 600ms gap between batches).
//             Throughput: 50 × 100 = 5,000 lots/min for changed items only.
//             Items with no changes never touch the API.
//
// Compared to the old per-item loop (120ms × N items regardless of changes),
// this is typically 10–100× faster for a normal sync where most lots are stable.

// Which optional fields to sync from BrickLink → BrickOwl.
// Qty is always synced and cannot be disabled.
export interface SyncFieldConfig {
  price:            boolean; // base_price comparison
  remarks:          boolean; // personal_note (BL remarks)
  description:      boolean; // public_note (BL description)
  tierPrice:        boolean; // tier pricing
  salePercent:      boolean; // sale_percent — opt-in, BO sales may be independently managed
  bulkQty:          boolean;  // bulk_qty — minimum order quantity (BL bulk)
  lotWeight:        boolean;  // lot_weight — custom lot weight (BL myWeight)
  // Per-stockroom mode: 'skip' = ignore entirely, 'hidden' = deactivate existing + don't create new (legacy), 'sync' = create/maintain on BO hidden (for_sale=0), 'active' = sync as normal for-sale lot (for_sale=1)
  stockroomModes:   Record<string, 'skip' | 'hidden' | 'active' | 'sync'>;
  // Per-item-type inclusion: { 'P': false } excludes Parts; missing key or true = include. Empty = all types synced.
  syncItemTypes:    Record<string, boolean>;
  // Price floor: lots priced below this are skipped (and existing BO listings deactivated). 0 / null = no floor.
  priceFloor:       number | null;
}
export const defaultSyncFields: SyncFieldConfig = {
  price: true, remarks: true, description: true, tierPrice: true, salePercent: true,
  bulkQty: true, lotWeight: true, stockroomModes: { A: 'skip', B: 'skip', C: 'skip' },
  syncItemTypes: {}, priceFloor: null,
};

export async function syncBrickLinkToBrickOwl(
  limit?: number,
  mode: 'analysis' | 'full_control' | 'matched_sync' = 'full_control',
  onProgress?: (processed: number, total: number) => void,
  fields: SyncFieldConfig = defaultSyncFields,
  sinceTime?: Date,
  orgId?: string,
): Promise<BrickOwlSyncResult> {
  const result: BrickOwlSyncResult = {
    lotsCreated: 0,
    lotsUpdated: 0,
    lotsSkipped: 0,
    errors: [],
    totalApiCalls: 0,
    skippedScheduledForDeletion: [],
    skippedInvalidBoid: [],
  };

  // Clear any stale abort flag from a previous run.
  channelSyncAbortFlag = false;

  // Initialise the preview breakdown — only fully populated in analysis mode.
  const preview: SyncPreviewBreakdown = {
    matchedLots: 0, unmatchedLots: 0, wouldUpdate: 0, wouldCreate: 0,
    byField: { qty: 0, price: 0, remarks: 0, description: 0, tierPrice: 0,
               salePercent: 0, forSale: 0, bulkQty: 0, lotWeight: 0 },
  };

  // ── Fetch both inventories once ──────────────────────────────────────────
  // Incremental mode: when sinceTime is provided, only process BL lots whose
  // updatedAt is newer than the last successful channel sync.  This avoids
  // re-sending the same unchanged data to BrickOwl every run.
  // Full mode (no sinceTime): every active lot is compared — used on first run
  // or after a sync failure to ensure BrickOwl is fully in sync with BL.
  const blFilter = sinceTime
    ? and(isNull(blInventory.deletedAt), gt(blInventory.updatedAt, sinceTime))
    : isNull(blInventory.deletedAt);
  let query = db.select().from(blInventory).where(blFilter);
  if (limit) query = query.limit(limit) as any;
  const blItems = await query;

  const syncLabel = sinceTime
    ? `Incremental (since ${sinceTime.toISOString()})`
    : 'Full';
  console.log(`[ChannelSync] ${syncLabel} — ${blItems.length} BrickLink items to compare (soft-deleted excluded)`);
  const blWithSale = blItems.filter(i => (i.saleRate ?? 0) > 0).length;
  console.log(`[ChannelSync:DIAG] BL items with saleRate>0: ${blWithSale}`);

  const brickowlInventory = await getBrickOwlInventory(false, orgId);
  console.log(`[ChannelSync] ${brickowlInventory.length} BrickOwl lots fetched`);

  // ── Diagnostic: show what external_lot_ids keys BrickOwl actually returns ──
  {
    const keyCounts: Record<string, number> = {};
    const keySamples: Record<string, string[]> = {};
    for (const lot of brickowlInventory) {
      const extIds = (lot as any).external_lot_ids ?? {};
      for (const [k, v] of Object.entries(extIds)) {
        keyCounts[k] = (keyCounts[k] ?? 0) + 1;
        if (!keySamples[k]) keySamples[k] = [];
        if (keySamples[k].length < 3) keySamples[k].push(String(v));
      }
    }
    console.log('[ChannelSync:DIAG] external_lot_ids key distribution:', JSON.stringify(keyCounts));
    for (const [k, samples] of Object.entries(keySamples)) {
      console.log(`[ChannelSync:DIAG]   .${k} samples:`, samples);
    }
  }

  // O(1) lookup: BL inventory ID → BrickOwl lot (tagged lots only)
  const taggedLotMap = new Map<string, any>();
  for (const lot of brickowlInventory) {
    const extId = lot.external_lot_ids?.other;
    if (extId) taggedLotMap.set(extId, lot);
  }

  // ── Write-back: upsert all tagged BL↔BO lot links into channel_lot_links ───
  // Keeps our local mapping table current so cross-platform sync and order
  // reconciliation can resolve channel lot IDs with an O(1) DB lookup instead
  // of re-fetching the full BrickOwl inventory on every triggered sync.
  if (taggedLotMap.size > 0 && orgId) {
    const entries = [...taggedLotMap.entries()]
      .map(([blInvIdStr, lot]) => ({ blInvId: parseInt(blInvIdStr, 10), channelLotId: String(lot.lot_id) }))
      .filter(e => !isNaN(e.blInvId));
    const CHUNK = 50;
    for (let i = 0; i < entries.length; i += CHUNK) {
      await Promise.all(
        entries.slice(i, i + CHUNK).map(e =>
          db.insert(channelLotLinks)
            .values({ blInvId: e.blInvId, orgId: orgId!, channel: BO_CHANNEL, channelLotId: e.channelLotId, syncedAt: new Date() })
            .onConflictDoUpdate({
              target: [channelLotLinks.blInvId, channelLotLinks.orgId, channelLotLinks.channel],
              set: { channelLotId: e.channelLotId, syncedAt: new Date() },
            })
        )
      );
    }
    console.log(`[ChannelSync] ✓ Upserted ${entries.length} lot links into channel_lot_links`);
  }

  // Pre-load the BO color map once so Phase 1 color-mismatch checks are
  // instant (resolveBoColorId reads from the in-memory cache after this).
  await loadBoColorMap(orgId);

  // ── Phase 1: In-memory delta detection (no API calls) ────────────────────
  type UpdateJob = {
    blItemNo: string;
    lot_id: string;
    absolute_quantity: number;
    price: number;
    condition: string;
    for_sale?: number;         // 0 = stockroom / not for sale, 1 = for sale
    personal_note?: string;
    public_note?: string;
    tier_price?: string;       // BrickOwl format: "100:0.050,200:0.040" or "remove"
    sale_percentage?: number;  // only present when fields.salePercent=true and sale changed
    bulk_qty?: number;         // minimum order quantity
    lot_weight?: number;       // custom lot weight
    external_id?: string;      // set when adopting an untagged lot
    // true when quantity changed — must sync via batch (or individual qty call)
    qtyChanged: boolean;
    // true when base_price changed (for diagnostics)
    priceChanged: boolean;
    // true when any non-qty field changed — these MUST go via individual
    // API calls because BrickOwl's batch /bulk/batch endpoint silently ignores them.
    hasNonQtyChange: boolean;
    color_id?: number;         // set when BrickOwl lot has the wrong color; corrected in-place
    // Old BO values — captured at push time for the updated-items detail view
    boQty?: number;
    boPrice?: number;
    boRemarks?: string;
    boDescription?: string;
    boBulkQty?: number;
    boForSale?: number;
  };

  const toUpdate: UpdateJob[] = [];
  const toAdopt: Array<typeof blItems[number]> = []; // needs BOID lookup

  let phaseProgress = 0;
  for (const item of blItems) {
    phaseProgress++;
    // In analysis mode report progress during Phase 1 (there is no Phase 2)
    if (mode === 'analysis') onProgress?.(phaseProgress, blItems.length);

    // Item-type filter: if syncItemTypes is non-empty and this type is explicitly excluded,
    // deactivate any existing BO listing (for_sale=0) and skip creation of new ones.
    // BL inventory stores full names (PART, SET, MINIFIG, GEAR); UI config uses short codes (P, S, M, G).
    const BL_BO_TYPE_CODE: Record<string, string> = { PART: 'P', SET: 'S', MINIFIG: 'M', GEAR: 'G', BOOK: 'B', INSTRUCTION: 'I', ORIGINAL_BOX: 'O' };
    const itemTypeCode = BL_BO_TYPE_CODE[item.itemType ?? ''] ?? item.itemType ?? '';
    if (Object.keys(fields.syncItemTypes).length > 0 && fields.syncItemTypes[itemTypeCode] === false) {
      const existingTaggedLot = taggedLotMap.get(item.id.toString());
      if (existingTaggedLot) {
        const boForSaleVal = parseInt(String(existingTaggedLot.for_sale ?? '1'));
        if (boForSaleVal !== 0) {
          toUpdate.push({
            blItemNo: item.itemNo,
            lot_id: existingTaggedLot.lot_id,
            absolute_quantity: item.quantity,
            price: item.unitPrice ? parseFloat(item.unitPrice) : 0,
            condition: toBOApiCondition(item.newOrUsed, item.itemType ?? undefined, item.completeness ?? undefined),
            qtyChanged: false,
            priceChanged: false,
            hasNonQtyChange: true,
            for_sale: 0,
          });
        }
      }
      result.lotsSkipped++;
      continue;
    }

    // Price floor filter: if a floor is configured and the lot's price is below it,
    // deactivate any existing BO listing and skip creating/updating it.
    const lotPrice = item.unitPrice ? parseFloat(item.unitPrice) : 0;
    if (fields.priceFloor && fields.priceFloor > 0 && lotPrice < fields.priceFloor) {
      const existingTaggedLot = taggedLotMap.get(item.id.toString());
      if (existingTaggedLot) {
        const boForSaleVal = parseInt(String(existingTaggedLot.for_sale ?? '1'));
        if (boForSaleVal !== 0) {
          toUpdate.push({
            blItemNo: item.itemNo,
            lot_id: existingTaggedLot.lot_id,
            absolute_quantity: item.quantity,
            price: lotPrice,
            condition: toBOApiCondition(item.newOrUsed, item.itemType ?? undefined, item.completeness ?? undefined),
            qtyChanged: false,
            priceChanged: false,
            hasNonQtyChange: true,
            for_sale: 0,
          });
        }
      }
      result.lotsSkipped++;
      continue;
    }

    // Determine the sync mode for this item's stockroom.
    // Non-stockroom items always proceed as 'active'.
    const stockroomMode: 'skip' | 'hidden' | 'active' | 'sync' = item.isStockRoom
      ? (fields.stockroomModes[item.stockRoomId ?? ''] ?? 'skip')
      : 'active';
    if (stockroomMode === 'skip') {
      result.lotsSkipped++;
      continue;
    }

    const newPrice = item.unitPrice ? parseFloat(item.unitPrice) : 0;
    const apiCondition = toBOApiCondition(item.newOrUsed, item.itemType ?? undefined, item.completeness ?? undefined);
    const isUsedItem   = item.newOrUsed !== 'N';

    const taggedLot = taggedLotMap.get(item.id.toString());

    if (taggedLot) {
      // ── Color-mismatch detection ───────────────────────────────────────────
      // If the tagged lot was created with the wrong color (e.g. during a
      // color-map bug), resolve the correct BO color ID and flag it so the
      // update job corrects it in-place — no delete/recreate needed.
      let correctedColorId: number | undefined;
      if (item.colorId != null) {
        const expectedBoColorId = await resolveBoColorId(item.colorId);
        // BrickOwl's inventory/list does not return color_id directly.
        // Extract it from the boid: parts use "{owl_id}-{bo_color_id}", non-color items have no suffix (= 0).
        const boidParts = (taggedLot.boid ?? '').split('-');
        const actualBoColorId = boidParts.length >= 2 ? parseInt(boidParts[boidParts.length - 1]) : 0;
        if (expectedBoColorId != null && expectedBoColorId > 0 &&
            actualBoColorId !== expectedBoColorId) {
          console.log(
            `[ChannelSync] Color mismatch on lot ${taggedLot.lot_id} ` +
            `(${item.itemNo}): boid=${taggedLot.boid} → color ${actualBoColorId}, ` +
            `expected BO color_id=${expectedBoColorId} — will correct in-place`
          );
          correctedColorId = expectedBoColorId;
        }
      }

      const newTierPrice = buildTierPriceString(
        item.tierQuantity1, item.tierPrice1,
        item.tierQuantity2, item.tierPrice2,
        item.tierQuantity3, item.tierPrice3,
      );
      // Normalize raw BO tier_price to a clean string (BrickOwl may return array/object/number)
      const boTierPriceStr = normalizeTierPrice(taggedLot.tier_price);
      // If BL has no tiers but BO has active tiers, send 'remove' to clear them
      const tierPriceToSend = newTierPrice ?? (boTierPriceStr ? 'remove' : undefined);

      const boQty   = parseInt(taggedLot.qty);
      // Compare against base_price (the listing price we set via API), NOT price (effective/discounted).
      // BrickOwl returns price = base_price × (1 - sale_percent/100); comparing against it would
      // cause false positives on every lot with any BrickOwl store sale set.
      const boBase      = parseFloat(taggedLot.base_price ?? taggedLot.price);
      const newSaleRate = item.saleRate ?? 0;

      // for_sale: 'active' stockroom mode keeps the lot visible on BO (for_sale=1).
      // 'hidden' stockroom mode and non-stockroom items use the standard isStockRoom rule.
      const newForSale  = (stockroomMode === 'active') ? 1 : (item.isStockRoom ? 0 : 1);
      const boForSale   = parseInt(String(taggedLot.for_sale ?? '1'));

      // bulk_qty: BO does return this in inventory/list — delta-detection is safe.
      const newBulkQty  = item.bulk ?? 1;
      const boBulkQty   = parseInt(taggedLot.bulk_qty ?? '1') || 1;
      // lot_weight: BO does NOT return this in inventory/list.
      // We need the BL-side value to piggyback onto other updates; BO-side is not read.
      const newLotWeight = item.myWeight ? parseFloat(item.myWeight) : 0;

      const qtyChanged = isNaN(boQty) || boQty !== item.quantity;

      // Each optional field is only compared when its sync flag is enabled.
      // If disabled, the field is treated as unchanged (never included in updates).
      // If BO returns no price (undefined/NaN), treat as changed so it gets corrected.
      // base_price follows the fields.price toggle for existing matched lots in all modes.
      // (For new lots created via adopt/create, price is always included regardless.)
      const priceChanged    = fields.price && (isNaN(boBase) || Math.abs(boBase - newPrice) > 0.001);
      // Decode both sides before comparing so the sync engine and discrepancy
      // detection always agree.  BrickLink stores HTML entities (e.g. &#39;);
      // BrickOwl normally stores decoded text, but can also hold entities when
      // an older sync pushed un-decoded BL text.  decodeHtmlEntities() handles
      // both and trims trailing whitespace on each side.
      const remarksChanged  = fields.remarks     && decodeHtmlEntities(taggedLot.personal_note || '') !== decodeHtmlEntities(item.remarks      || '');
      const descChanged     = fields.description && decodeHtmlEntities(taggedLot.public_note   || '') !== decodeHtmlEntities(item.description || '');
      const tierChanged     = fields.tierPrice   && boTierPriceStr !== normalizeTierPrice(newTierPrice);
      // salePercent is opt-in — users may manage BO sales independently.
      // When enabled: sync BL saleRate (0–100) → BO sale_percent.
      const saleChanged     = fields.salePercent && (taggedLot.sale_percentage ?? 0) !== newSaleRate;
      // for_sale is always synced — stockroom state is authoritative from BL
      const forSaleChanged  = !isNaN(boForSale) && boForSale !== newForSale;
      // bulk_qty: BO returns this in inventory/list so delta-detection works correctly.
      const bulkQtyChanged  = fields.bulkQty  && boBulkQty !== newBulkQty;

      // WRITE-THROUGH FIELD — lot_weight is NOT returned by BrickOwl's /inventory/list
      // endpoint, so boLotWeight is always 0 regardless of what BrickOwl actually stores.
      // Strategy: never use it as an update trigger. Instead, piggyback onto any update
      // that already fires for a genuine reason (qty/price/notes/etc.), so the value is
      // pushed to BrickOwl over time without causing wasteful extra calls.
      // (lotWeightChanged is intentionally omitted from hasChange.)

      const colorChanged = !!correctedColorId;
      const hasChange = qtyChanged || priceChanged || remarksChanged || descChanged || tierChanged || saleChanged || forSaleChanged || bulkQtyChanged || colorChanged;

      // Always track for preview breakdown (populated regardless of mode)
      preview.matchedLots++;
      if (hasChange) {
        preview.wouldUpdate++;
        if (qtyChanged)         preview.byField.qty++;
        if (priceChanged)       preview.byField.price++;
        if (remarksChanged)     preview.byField.remarks++;
        if (descChanged)        preview.byField.description++;
        if (tierChanged)        preview.byField.tierPrice++;
        if (saleChanged)        preview.byField.salePercent++;
        if (forSaleChanged)     preview.byField.forSale++;
        if (bulkQtyChanged)     preview.byField.bulkQty++;
      }

      if (hasChange) {
        if (mode === 'analysis') {
          result.lotsSkipped++; // analysis: report discrepancy but don't write
        } else {
          // matched_sync and full_control both sync all fields for matched lots
          const decodedRemarks = decodeHtmlEntities(item.remarks || '');
          const decodedDesc   = decodeHtmlEntities(item.description || '');
          // hasNonQtyChange drives the batch vs individual routing decision.
          // Write-through fields (my_cost, lot_weight) are included in the payload
          // but never make a lot "non-qty-only" by themselves — they piggyback on
          // whatever else already needs an individual call.
          // color_id corrections must also go via individual calls (not batch).
          const hasNonQty = priceChanged || remarksChanged || descChanged || tierChanged || saleChanged || forSaleChanged || bulkQtyChanged || colorChanged;
          toUpdate.push({
            blItemNo: item.itemNo,
            lot_id: taggedLot.lot_id,
            absolute_quantity: item.quantity,
            price: newPrice,
            condition: apiCondition,
            qtyChanged,
            priceChanged,
            hasNonQtyChange: hasNonQty,
            ...(remarksChanged  && { personal_note: decodedRemarks }),
            ...(descChanged     && { public_note:   decodedDesc }),
            ...(tierPriceToSend !== undefined && { tier_price: tierPriceToSend }),
            ...(saleChanged     && { sale_percentage: newSaleRate }),
            ...(forSaleChanged  && { for_sale: newForSale }),
            ...(bulkQtyChanged  && { bulk_qty: newBulkQty }),
            // Write-through: push lot_weight when updating for any other reason
            ...(fields.lotWeight && newLotWeight > 0 && { lot_weight: newLotWeight }),
            // Color correction: fix lots created with wrong color during a color-map bug
            ...(colorChanged && { color_id: correctedColorId }),
            // Old BO values for the updated-items detail view
            boQty:        isNaN(boQty)  ? undefined : boQty,
            boPrice:      isNaN(boBase) ? undefined : boBase,
            boRemarks:    taggedLot.personal_note || undefined,
            boDescription:taggedLot.public_note   || undefined,
            boBulkQty,
            boForSale:    isNaN(boForSale) ? undefined : boForSale,
          });
        }
      } else {
        result.lotsSkipped++;
      }
    } else if (mode === 'full_control') {
      // No tagged lot — queue for BOID lookup (Phase 2b).
      // 'hidden' stockroom mode: don't create new listings (only deactivate existing ones above).
      if (stockroomMode === 'hidden') {
        result.lotsSkipped++;
      } else {
        preview.unmatchedLots++;
        preview.wouldCreate++;
        toAdopt.push(item);
      }
    } else {
      // matched_sync / analysis: skip untagged items — never create new lots
      preview.unmatchedLots++;
      result.lotsSkipped++;
    }
  }

  console.log(
    `[ChannelSync] Phase 1 complete — ${toUpdate.length} to update, ` +
    `${toAdopt.length} to adopt/create, ${result.lotsSkipped} skipped`
  );

  // ── Diagnostic: per-field breakdown of what triggered each update ─────────
  if (toUpdate.length > 0) {
    const breakdown = {
      qty:      toUpdate.filter(j => j.qtyChanged).length,
      price:    toUpdate.filter(j => j.priceChanged).length,
      remarks:  toUpdate.filter(j => j.personal_note !== undefined).length,
      desc:     toUpdate.filter(j => j.public_note !== undefined).length,
      tier:     toUpdate.filter(j => j.tier_price !== undefined).length,
      sale:     toUpdate.filter(j => j.sale_percentage !== undefined).length,
      forSale:  toUpdate.filter(j => j.for_sale !== undefined).length,
      bulkQty:  toUpdate.filter(j => j.bulk_qty !== undefined).length,
      color:    toUpdate.filter(j => j.color_id !== undefined).length,
    };
    console.log(
      `[ChannelSync:DIAG] Update field breakdown (${toUpdate.length} jobs): ` +
      `qty=${breakdown.qty} price=${breakdown.price} remarks=${breakdown.remarks} ` +
      `desc=${breakdown.desc} tier=${breakdown.tier} sale%=${breakdown.sale} ` +
      `forSale=${breakdown.forSale} bulkQty=${breakdown.bulkQty} color=${breakdown.color}`
    );
    // Sample first 5 jobs for deep inspection
    toUpdate.slice(0, 5).forEach((job, i) => {
      const taggedLot = taggedLotMap.get(
        blItems.find(x => x.itemNo === job.blItemNo)?.id?.toString() ?? ''
      );
      const changedFields = [
        job.qtyChanged        && `qty(BL=${job.absolute_quantity},BO=${taggedLot?.qty})`,
        job.priceChanged      && `price(BL=${job.price.toFixed(3)},BO=${taggedLot?.base_price})`,
        job.personal_note !== undefined && `remarks`,
        job.public_note   !== undefined && `desc`,
        job.tier_price    !== undefined && `tier=${job.tier_price}`,
        job.sale_percentage !== undefined && `sale%=${job.sale_percentage}`,
        job.for_sale      !== undefined && `forSale(BL=${job.for_sale},BO=${taggedLot?.for_sale})`,
        job.bulk_qty      !== undefined && `bulk(BL=${job.bulk_qty},BO=${taggedLot?.bulk_qty})`,
        job.color_id      !== undefined && `color=${job.color_id}`,
      ].filter(Boolean).join(' ');
      console.log(`[ChannelSync:DIAG] Job ${i + 1}: ${job.blItemNo} lot=${job.lot_id} — changed: ${changedFields}`);
    });
  }

  // Build per-item update detail list (capped at 200 to keep JSON blob manageable)
  if (mode !== 'analysis') {
    result.updatedItems = toUpdate.slice(0, 200).map(job => {
      const changes: SyncUpdatedItem['changes'] = [];
      if (job.qtyChanged)
        changes.push({ field: 'qty',         from: String(job.boQty ?? '?'),            to: String(job.absolute_quantity) });
      if (job.priceChanged)
        changes.push({ field: 'price',        from: job.boPrice?.toFixed(3) ?? '?',      to: job.price.toFixed(3) });
      if (job.personal_note !== undefined)
        changes.push({ field: 'remarks',      from: job.boRemarks    ?? '',              to: job.personal_note });
      if (job.public_note !== undefined)
        changes.push({ field: 'description',  from: job.boDescription ?? '',             to: job.public_note });
      if (job.tier_price !== undefined)
        changes.push({ field: 'tierPrice',    from: '(prev)',                            to: job.tier_price });
      if (job.sale_percentage !== undefined)
        changes.push({ field: 'salePercent',  from: '?',                                 to: String(job.sale_percentage) });
      if (job.for_sale !== undefined)
        changes.push({ field: 'forSale',      from: String(job.boForSale ?? '?'),        to: String(job.for_sale) });
      if (job.bulk_qty !== undefined)
        changes.push({ field: 'bulkQty',      from: String(job.boBulkQty ?? '?'),        to: String(job.bulk_qty) });
      if (job.color_id !== undefined)
        changes.push({ field: 'color',        from: '(wrong)',                            to: String(job.color_id) });
      return { itemNo: job.blItemNo, condition: job.condition, lotId: job.lot_id, changes };
    });
  }

  if (mode === 'analysis') {
    result.preview = preview; // attach field-level breakdown for preview UI
    return result;
  }

  // ── Phase 2a: Update changed tagged lots ─────────────────────────────────
  //
  // CONFIRMED behaviour of BrickOwl's /bulk/batch endpoint:
  //   • absolute_quantity IS applied (10 s per batch → real DB writes)
  //   • price, personal_note, public_note, tier_price, sale_percentage are
  //     silently IGNORED — BrickOwl returns {"status":"Success"} but never
  //     writes those fields. Sending any of them also causes the batch to
  //     return in ~270 ms (no DB writes at all, causing rate-limit cascade).
  //
  // Strategy:
  //   • qty-only changes  → batch API  (only lot_id + absolute_quantity)
  //   • any non-qty field → individual /inventory/update calls (works for all)

  const qtyOnlyJobs = toUpdate.filter(job => !job.hasNonQtyChange);
  const fieldJobs   = toUpdate.filter(job =>  job.hasNonQtyChange);
  // fieldJobs that also have a qty change — qty is folded into their individual call
  const fieldJobsWithQtyChange = fieldJobs.filter(job => job.qtyChanged);

  console.log(
    `[ChannelSync] Phase 2a — ${qtyOnlyJobs.length} qty-only (batch) + ${fieldJobs.length} field-changes` +
    ` (individual; ${fieldJobsWithQtyChange.length} of those also carry qty in same call)`
  );

  let updateProgress = 0;
  // Steps: batch qty-only + individual field calls (qty folded in for multi-change lots) + adoptions.
  // Use only non-zero-qty adoptions — zero-qty items are skipped immediately and never
  // increment updateProgress, so including them in the total would make the bar never reach 100%.
  const nonZeroAdoptCount = toAdopt.filter(item => item.quantity > 0).length;
  const totalPhase2 = qtyOnlyJobs.length + fieldJobs.length + nonZeroAdoptCount;

  // ── 2a-i: Batch qty-only lots (fast) ──────────────────────────────────────
  // Send ONLY lot_id + absolute_quantity — no price, no notes, no extras.
  // This prevents the "extra fields → instant 200ms no-op" BrickOwl bug.
  // Only runs for lots where ONLY quantity changed (field-changed lots handle
  // qty via a separate individual call in Phase 2a-ii to avoid 429 storms).
  const BATCH_SIZE        = 50;
  const BATCH_CONCURRENCY = 6;
  const BATCH_GAP_MS      = 700;  // 6 concurrent × (250ms process + 700ms gap) ≈ 370 calls/min — safely under 600/min

  // Qty-only lots go via batch. Field-changed lots that ALSO have a qty change handle
  // qty inside the individual /inventory/update call (absolute_quantity is supported there),
  // so they are NOT added here. This removes the previous double-call pattern where such
  // lots consumed one batch slot AND one individual slot.
  const batchQtyJobs = [...qtyOnlyJobs];

  const qtyChunks: UpdateJob[][] = [];
  for (let i = 0; i < batchQtyJobs.length; i += BATCH_SIZE) {
    qtyChunks.push(batchQtyJobs.slice(i, i + BATCH_SIZE));
  }

  for (let r = 0; r < qtyChunks.length; r += BATCH_CONCURRENCY) {
    if (channelSyncAbortFlag) {
      console.log('[ChannelSync] Abort requested — stopping after batch qty round');
      break;
    }
    const round = qtyChunks.slice(r, r + BATCH_CONCURRENCY);

    await Promise.all(round.map(async (chunk) => {
      const batchRequests = chunk.map(job => ({
        endpoint: 'inventory/update',
        request_method: 'POST' as const,
        // qty-only: send only the two fields BrickOwl's batch actually applies
        params: [{ lot_id: job.lot_id, absolute_quantity: job.absolute_quantity }],
      }));

      try {
        const responses = await brickowlBatch(batchRequests, orgId);
        result.totalApiCalls++;

        responses.forEach((resp: any, idx: number) => {
          const job = chunk[idx];
          const isExplicitError = resp && typeof resp === 'object' && (resp.error || resp.errors);
          const bodyStatus = resp?.body?.status;
          if (isExplicitError) {
            result.errors.push(`${job.blItemNo}: ${JSON.stringify(resp.error || resp.errors)}`);
            result.lotsSkipped++;
          } else if (bodyStatus && bodyStatus !== 'Success') {
            result.errors.push(`${job.blItemNo}: unexpected status "${bodyStatus}"`);
            result.lotsSkipped++;
          } else {
            result.lotsUpdated++;
          }
        });

        if (responses.length < chunk.length) {
          for (let j = responses.length; j < chunk.length; j++) {
            result.errors.push(`${chunk[j].blItemNo}: no response in batch`);
            result.lotsSkipped++;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        chunk.forEach(job => {
          result.errors.push(`${job.blItemNo}: ${msg}`);
          result.lotsSkipped++;
        });
        console.error(`[ChannelSync] Batch error:`, msg);
      }

      updateProgress += chunk.length;
    }));

    onProgress?.(updateProgress, totalPhase2);
    if (r + BATCH_CONCURRENCY < qtyChunks.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_GAP_MS));
    }
  }

  // ── 2a-ii: Individual calls for field-changed lots (price / notes / tier / sale) ──
  // BrickOwl's /inventory/update supports all of these fields per the API docs.
  // NOTE: The correct field name for sale discount is `sale_percent` (not `sale_percentage`).
  // We process FIELD_CONCURRENCY lots in parallel with a gap between rounds.
  const FIELD_CONCURRENCY = 6;
  const FIELD_GAP_MS      = 400; // 6 concurrent × (250ms process + 400ms gap) ≈ 554/min — safely under 600/min

  const saleFieldJobs = fieldJobs.filter(j => j.sale_percentage !== undefined);
  console.log(`[ChannelSync:DIAG] fieldJobs total=${fieldJobs.length}, with sale_percentage=${saleFieldJobs.length}`);
  if (saleFieldJobs.length > 0) {
    console.log(`[ChannelSync:DIAG] First 5 sale fieldJobs: ${saleFieldJobs.slice(0, 5).map(j => `lot_id=${j.lot_id} sale%=${j.sale_percentage}`).join(', ')}`);
  }

  let fieldResponsesLogged = 0;

  for (let r = 0; r < fieldJobs.length; r += FIELD_CONCURRENCY) {
    if (channelSyncAbortFlag) {
      console.log('[ChannelSync] Abort requested — stopping after field update round');
      break;
    }
    const chunk = fieldJobs.slice(r, r + FIELD_CONCURRENCY);

    await Promise.all(chunk.map(async (job) => {
      try {
        const fieldPayload: Parameters<typeof updateBrickOwlLot>[0] = {
          lot_id: job.lot_id,
          // If qty also changed on this lot, include it here so we avoid a
          // separate batch call — one individual call handles both changes.
          ...(job.qtyChanged      && { absolute_quantity: job.absolute_quantity }),
          // Only include price if the price field sync is enabled.
          // If price sync is off, we update qty/notes/tier/sale without touching price.
          ...(fields.price        && { price: job.price }),
          ...(job.personal_note   !== undefined && { personal_note:   job.personal_note   }),
          ...(job.public_note     !== undefined && { public_note:     job.public_note     }),
          ...(job.tier_price      !== undefined && { tier_price:      job.tier_price      }),
          ...(job.sale_percentage !== undefined && { sale_percentage: job.sale_percentage }),
          ...(job.for_sale        !== undefined && { for_sale:        job.for_sale        }),
          ...(job.bulk_qty        !== undefined && { bulk_qty:        job.bulk_qty        }),
          ...(job.lot_weight      !== undefined && { lot_weight:      job.lot_weight      }),
          ...(job.color_id        !== undefined && { color_id:        job.color_id        }),
        };

        const updateResp = await updateBrickOwlLot(fieldPayload, orgId);
        result.totalApiCalls++;
        result.lotsUpdated++;

        if (fieldResponsesLogged < 5) {
          fieldResponsesLogged++;
          console.log(
            `[ChannelSync:DIAG] UPDATE lot_id=${job.lot_id}` +
            ` price=${job.price.toFixed(3)} priceChanged=${job.priceChanged}` +
            ` fields=${Object.keys(fieldPayload).join(',')}` +
            ` resp=${JSON.stringify(updateResp)}`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('scheduled for deletion')) {
          // BrickOwl has this lot queued for removal — track it so the tile can show the user
          console.warn(`[ChannelSync] Skipping lot_id=${job.lot_id} (${job.blItemNo}): BrickOwl item is scheduled for deletion`);
          result.skippedScheduledForDeletion!.push({
            itemNo: job.blItemNo,
            lotId: job.lot_id,
            condition: job.condition,
            qty: job.absolute_quantity,
            price: job.price.toFixed(3),
          });
          result.lotsSkipped++;
        } else {
          result.errors.push(`${job.blItemNo} lot_id=${job.lot_id}: ${msg}`);
          result.lotsSkipped++;
          console.error(`[ChannelSync] Individual update error lot_id=${job.lot_id}:`, msg);
        }
      }

      updateProgress++;
    }));

    onProgress?.(updateProgress, totalPhase2);
    if (r + FIELD_CONCURRENCY < fieldJobs.length) {
      await new Promise(resolve => setTimeout(resolve, FIELD_GAP_MS));
    }
  }

  // ── Phase 2b: Adopt / create untagged lots (full_control only) ───────────
  // Step 1: Pre-fetch all BOIDs in parallel chunks (read-only GET, safe to parallelise).
  //         In-process cache means warm syncs skip these calls entirely.
  // Step 2: Sequential adopt/create using the pre-fetched map (writes must be serial).
  // Rate limit: ~600 individual GET calls/min → 100ms gap between parallel chunks.
  const INDIVIDUAL_GAP_MS = 100;
  const BOID_CHUNK = 10; // 10 concurrent lookups × 100ms gap → ~600/min

  // Skip 0-qty items — BrickOwl rejects creating lots with qty=0, and they
  // should not exist on BO at all.  Log and count them as skipped.
  const zeroQtyAdopt = toAdopt.filter(item => item.quantity <= 0);
  const adoptCandidates = toAdopt.filter(item => item.quantity > 0);
  if (zeroQtyAdopt.length > 0) {
    console.log(`[ChannelSync] Phase 2b: skipping ${zeroQtyAdopt.length} zero-qty items (not created on BrickOwl)`);
    result.lotsSkipped += zeroQtyAdopt.length;
  }

  // Pre-resolve BrickOwl color IDs for all unique BL color IDs in this batch.
  // Cached per-process — warm syncs skip the API call entirely.
  const uniqueBlColorIds = [...new Set(adoptCandidates.map(i => i.colorId).filter((c): c is number => c != null))];
  const boColorMap = new Map<number, number | null>();
  for (const blColorId of uniqueBlColorIds) {
    boColorMap.set(blColorId, await resolveBoColorId(blColorId, orgId));
  }
  console.log(`[ChannelSync] Phase 2b: resolved ${boColorMap.size} color mappings`);

  const boidMap = new Map<number, string | null>(); // index → BOID
  for (let i = 0; i < adoptCandidates.length; i += BOID_CHUNK) {
    const chunk = adoptCandidates.slice(i, i + BOID_CHUNK);
    const results = await Promise.all(
      chunk.map(item => {
        const boColorId = item.colorId != null ? boColorMap.get(item.colorId) ?? undefined : undefined;
        return lookupBoid(item.itemNo, item.itemType, boColorId ?? undefined, orgId);
      })
    );
    results.forEach((boid, j) => boidMap.set(i + j, boid));
    // Count uncached (real API) calls — cached hits don't count against rate limit
    result.totalApiCalls += results.length;
    if (i + BOID_CHUNK < adoptCandidates.length) {
      await new Promise(resolve => setTimeout(resolve, INDIVIDUAL_GAP_MS));
    }
  }
  console.log(`[ChannelSync] Phase 2b BOID pre-fetch done — ${boidMap.size} resolved`);

  for (let adoptIdx = 0; adoptIdx < adoptCandidates.length; adoptIdx++) {
    if (channelSyncAbortFlag) {
      console.log('[ChannelSync] Abort requested — stopping adopt/create loop');
      break;
    }
    const item = adoptCandidates[adoptIdx];
    const newPrice = item.unitPrice ? parseFloat(item.unitPrice) : 0;
    const apiCondition = toBOApiCondition(item.newOrUsed, item.itemType ?? undefined, item.completeness ?? undefined);
    const isUsedItem   = item.newOrUsed !== 'N';

    const boid = boidMap.get(adoptIdx);

    if (!boid) {
      // Item not found in BrickOwl's catalog — this is a catalog limitation,
      // not a sync failure. Count as skipped, not an error.
      result.lotsSkipped++;
    } else {
      const USED_CONDITIONS = ['usedg', 'usedc', 'usedn', 'useda', 'usedi'];
      const untagged = brickowlInventory.filter((lot: any) => {
        const lotCond = lot.full_con || lot.condition;
        return lot.boid === boid &&
          (lotCond === apiCondition || (isUsedItem && USED_CONDITIONS.includes(lotCond)));
      });

      const itemTierPrice = buildTierPriceString(item.tierQuantity1, item.tierPrice1, item.tierQuantity2, item.tierPrice2, item.tierQuantity3, item.tierPrice3);
      const itemForSale   = item.isStockRoom ? 0 : 1;
      const itemBulkQty   = (fields.bulkQty  && item.bulk  && item.bulk  > 1) ? item.bulk  : undefined;
      const itemLotWeight = (fields.lotWeight && item.myWeight)                 ? parseFloat(item.myWeight) : undefined;

      if (untagged.length === 1) {
        // Adopt single pre-existing untagged lot
        try {
          const adoptedLotId = untagged[0].lot_id;
          const itemSalePercent = fields.salePercent ? (item.saleRate ?? 0) : undefined;
          await updateBrickOwlLot({
            lot_id: adoptedLotId,
            external_id: item.id.toString(),
            absolute_quantity: item.quantity,
            price: newPrice,
            condition: apiCondition,
            for_sale: itemForSale,
            personal_note:   item.remarks     || undefined,
            public_note:     item.description || undefined,
            ...(itemTierPrice  !== undefined && { tier_price:  itemTierPrice  }),
            ...(itemSalePercent !== undefined && { sale_percentage: itemSalePercent }),
            ...(itemBulkQty   !== undefined && { bulk_qty:    itemBulkQty   }),
            ...(itemLotWeight !== undefined && { lot_weight:  itemLotWeight }),
          }, orgId);
          // Persist the BL↔BO link now that we've successfully adopted the lot
          if (orgId) {
            await db.insert(channelLotLinks)
              .values({ blInvId: item.id, orgId, channel: BO_CHANNEL, channelLotId: adoptedLotId, syncedAt: new Date() })
              .onConflictDoUpdate({
                target: [channelLotLinks.blInvId, channelLotLinks.orgId, channelLotLinks.channel],
                set: { channelLotId: adoptedLotId, syncedAt: new Date() },
              });
          }
          result.lotsUpdated++;
          result.totalApiCalls++;
          console.log(`[ChannelSync] ✓ Adopted lot ${adoptedLotId} for ${item.itemNo}`);
        } catch (err) {
          result.errors.push(`${item.itemNo}: adopt failed — ${err instanceof Error ? err.message : err}`);
          result.lotsSkipped++;
        }
      } else if (untagged.length > 1) {
        const ids = untagged.map((l: any) => l.lot_id).join(', ');
        result.errors.push(`${item.itemNo}: ${untagged.length} ambiguous untagged lots (${ids}) — resolve on BrickOwl first`);
        result.lotsSkipped++;
      } else {
        // Create new lot
        try {
          const itemSalePercent = fields.salePercent ? (item.saleRate ?? 0) : undefined;
          const createResp = await createBrickOwlLot({
            boid,
            quantity: item.quantity,
            price: newPrice,
            condition: apiCondition,
            for_sale: itemForSale,
            external_id: item.id.toString(),
            personal_note:   item.remarks     || undefined,
            public_note:     item.description || undefined,
            ...(itemTierPrice  !== undefined && { tier_price:  itemTierPrice  }),
            ...(itemSalePercent !== undefined && itemSalePercent > 0 && { sale_percentage: itemSalePercent }),
            ...(itemBulkQty   !== undefined && { bulk_qty:    itemBulkQty   }),
            ...(itemLotWeight !== undefined && { lot_weight:  itemLotWeight }),
          }, orgId);
          result.lotsCreated++;
          result.totalApiCalls++;
          // Persist the new BL↔BO link if the API returned a lot_id in the response
          const newLotId = createResp?.lot_id?.toString();
          if (newLotId && orgId) {
            await db.insert(channelLotLinks)
              .values({ blInvId: item.id, orgId, channel: BO_CHANNEL, channelLotId: newLotId, syncedAt: new Date() })
              .onConflictDoUpdate({
                target: [channelLotLinks.blInvId, channelLotLinks.orgId, channelLotLinks.channel],
                set: { channelLotId: newLotId, syncedAt: new Date() },
              });
          }
          console.log(`[ChannelSync] ✓ Created lot ${newLotId ?? '(id pending next sync)'} for ${item.itemNo} (BOID ${boid})`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('scheduled for deletion')) {
            // BrickOwl is retiring this catalog entry — track it for the UI tile
            console.warn(`[ChannelSync] Skipping ${item.itemNo} (BOID ${boid}): BrickOwl item is scheduled for deletion`);
            result.skippedScheduledForDeletion!.push({
              itemNo: item.itemNo,
              blInvId: item.id,
              boid,
              colorId: item.colorId ?? undefined,
              colorName: undefined,
              qty: item.quantity,
              price: item.unitPrice ?? undefined,
              condition: item.newOrUsed,
              itemType: item.itemType ?? undefined,
            });
            result.lotsSkipped++;
          } else if (msg.includes('Invalid BOID') || msg.includes('item not found') || (msg.includes('404') && msg.includes('not found'))) {
            // The BOID we resolved doesn't exist on BrickOwl — permanent catalog gap.
            // Track it for the UI tile; treat as a quiet skip (not a hard error) so it
            // doesn't flip status to 'partial' and block incremental sinceTime advancement.
            console.warn(`[ChannelSync] Skipping ${item.itemNo} (BOID ${boid}): BOID not found on BrickOwl (permanent catalog gap)`);
            result.skippedInvalidBoid!.push({
              itemNo: item.itemNo,
              blInvId: item.id,
              boid,
              colorId: item.colorId ?? undefined,
              colorName: undefined,
              qty: item.quantity,
              price: item.unitPrice ?? undefined,
              condition: item.newOrUsed,
              itemType: item.itemType ?? undefined,
            });
            result.lotsSkipped++;
          } else {
            result.errors.push(`${item.itemNo}: create failed — ${msg}`);
            result.lotsSkipped++;
          }
        }
      }
    }

    updateProgress++;
    onProgress?.(updateProgress, totalPhase2);
    await new Promise(resolve => setTimeout(resolve, INDIVIDUAL_GAP_MS));
  }

  // ── Phase 3: Deactivate BO lots for soft-deleted BL items ──
  // Policy: soft-deleted BL lots are hidden on BrickOwl (for_sale=0) rather than
  // permanently deleted — this preserves BO sales history and lets operators
  // clean up deliberately via the soft-delete report (or a future cleanup tool).
  // Applies in full_control and matched_sync (not analysis — no writes in analysis).
  if ((mode as string) !== 'analysis') {
    const softDeletedBl = await db.select({ id: blInventory.id, itemNo: blInventory.itemNo })
      .from(blInventory)
      .where(isNotNull(blInventory.deletedAt));

    const softDeletedIds = new Set(softDeletedBl.map(i => i.id.toString()));
    const lotsToDeactivate = brickowlInventory.filter((lot: any) => {
      const extId = lot.external_lot_ids?.bl_inventory_id || lot.external_id_1;
      if (!extId || !softDeletedIds.has(extId.toString())) return false;
      // Only act if currently visible (for_sale=1) — skip already-hidden lots
      return parseInt(String(lot.for_sale ?? '1')) !== 0;
    });

    if (lotsToDeactivate.length > 0) {
      console.log(`[ChannelSync] Phase 3: deactivating ${lotsToDeactivate.length} BO lots for soft-deleted BL items`);
      for (const lot of lotsToDeactivate) {
        if (channelSyncAbortFlag) {
          console.log('[ChannelSync] Abort requested — stopping deactivate loop');
          break;
        }
        try {
          await updateBrickOwlLot({ lot_id: lot.lot_id, for_sale: 0 }, orgId);
          result.lotsDeactivated = (result.lotsDeactivated ?? 0) + 1;
          result.totalApiCalls++;
          console.log(`[ChannelSync] ✓ Deactivated BO lot ${lot.lot_id} (BL item soft-deleted)`);
        } catch (err) {
          result.errors.push(`lot ${lot.lot_id}: deactivate failed — ${err instanceof Error ? err.message : err}`);
        }
        await new Promise(resolve => setTimeout(resolve, INDIVIDUAL_GAP_MS));
      }
    }
  }

  console.log(
    `[ChannelSync] Done — ${result.lotsUpdated} updated, ${result.lotsCreated} created, ` +
    `${result.lotsDeactivated ?? 0} deactivated, ${result.lotsSkipped} skipped, ` +
    `${result.errors.length} errors, ${result.totalApiCalls} API calls`
  );

  return result;
}

import { db } from "../db";
import { blCategories, blColors, blInventory, blCatalog, blApiCalls, appSettings, priceGuideCache, partPriceHistory, setPartRelationships, orderDetails, orders, organizations, PLATFORM_ORG_ID } from "@shared/schema";
import { eq, gte, sql, inArray, and, gt, desc } from "drizzle-orm";
import OAuth from "oauth-1.0a";
import crypto from "crypto";
import { syncRebrickableSetParts } from "./rebrickable";
import { syncLock } from "./sync-lock";
import { batchEmbedInventory, batchEmbedSets } from "./embeddings";
import { syncBrickLinkToBrickOwl } from "./brickowl";
import { saveXMLBackup } from "./export";

const resolvedCatalogItemName = (itemNoRef: any, itemTypeRef: any, colorIdRef: any) =>
  sql<string | null>`(SELECT item_name FROM bl_catalog WHERE item_no = ${itemNoRef} AND item_type = ${itemTypeRef} ORDER BY (color_id = ${colorIdRef})::int DESC, color_id ASC LIMIT 1)`;

export interface BricklinkSyncResult {
  inventoryAdded: number;
  inventoryUpdated: number;
  totalApiCalls: number;
  rateLimitWarning?: string;
}

export interface RateLimitHourBucket {
  hourStart: string;   // ISO timestamp — start of this 1-hour slot
  rollsOffAt: string;  // ISO timestamp — when these calls leave the 24h window
  calls: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  callsLast24h: number;
  warning?: string;
  blocked?: boolean;
  oldestCallTime?: Date | null;
  newestCallTime?: Date | null;
  hourlyBuckets?: RateLimitHourBucket[]; // 24 hourly slots, oldest first
}

// Clean token values - remove any non-alphanumeric characters that may have been added
const cleanToken = (value: string) => value.replace(/[^A-Z0-9]/gi, '');

// Platform default for BL API calls per rolling 24-hour window
const BL_API_CALLS_PER_DAY_DEFAULT = 5000;
const BL_API_CALLS_WARN_AT = 4000;

// Resolve the effective call ceiling for an org.
// Platform org → uses blApiCallLimit from appSettings (admin-configured in Platform Services).
// Flagship plan = unlimited (-1). Otherwise uses blApiCallLimitOverride or platform default.
async function getOrgCallCeiling(orgId: string): Promise<number> {
  try {
    // Platform org: use the admin-configured ceiling from Platform Services settings
    if (orgId === PLATFORM_ORG_ID) {
      const [platformSettings] = await db
        .select({ blApiCallLimit: appSettings.blApiCallLimit })
        .from(appSettings)
        .where(eq(appSettings.id, PLATFORM_ORG_ID))
        .limit(1);
      if (platformSettings?.blApiCallLimit != null) return platformSettings.blApiCallLimit;
    }

    const [org] = await db
      .select({ plan: organizations.plan, blApiCallLimitOverride: organizations.blApiCallLimitOverride })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (org?.plan === 'flagship') return -1;
    if (org?.blApiCallLimitOverride != null) return org.blApiCallLimitOverride;
  } catch {
    // fall through to default on error
  }
  return BL_API_CALLS_PER_DAY_DEFAULT;
}

// Check rate limit status for the last 24 hours — scoped to a single org
export async function checkRateLimit(orgId: string = PLATFORM_ORG_ID): Promise<RateLimitStatus> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const recentCalls = await db
    .select({
      count: sql<number>`count(*)`,
      oldest: sql<Date | null>`min(${blApiCalls.timestamp})`,
      newest: sql<Date | null>`max(${blApiCalls.timestamp})`,
    })
    .from(blApiCalls)
    .where(and(eq(blApiCalls.orgId, orgId), gte(blApiCalls.timestamp, twentyFourHoursAgo)));
  
  const callsLast24h = Number(recentCalls[0]?.count) || 0;
  const oldestCallTime = recentCalls[0]?.oldest ?? null;
  const newestCallTime = recentCalls[0]?.newest ?? null;

  // Build 24 hourly buckets (oldest first)
  const hourlyRows = await db
    .select({
      hourEpoch: sql<string>`EXTRACT(EPOCH FROM date_trunc('hour', ${blApiCalls.timestamp}))::bigint`,
      calls: sql<number>`count(*)`,
    })
    .from(blApiCalls)
    .where(and(eq(blApiCalls.orgId, orgId), gte(blApiCalls.timestamp, twentyFourHoursAgo)))
    .groupBy(sql`date_trunc('hour', ${blApiCalls.timestamp})`)
    .orderBy(sql`date_trunc('hour', ${blApiCalls.timestamp})`);

  const hourlyMap = new Map(hourlyRows.map(r => [Number(r.hourEpoch) * 1000, Number(r.calls)]));
  const hourlyBuckets: RateLimitHourBucket[] = [];
  for (let i = 23; i >= 0; i--) {
    const slotStartMs = Math.floor(Date.now() / 3600000) * 3600000 - i * 3600000;
    hourlyBuckets.push({
      hourStart: new Date(slotStartMs).toISOString(),
      rollsOffAt: new Date(slotStartMs + 24 * 60 * 60 * 1000).toISOString(),
      calls: hourlyMap.get(slotStartMs) ?? 0,
    });
  }

  const callCeiling = await getOrgCallCeiling(orgId);

  // Flagship / unlimited orgs are never blocked
  if (callCeiling === -1) {
    return { allowed: true, callsLast24h, oldestCallTime, newestCallTime, hourlyBuckets };
  }

  if (callsLast24h >= callCeiling) {
    return {
      allowed: false,
      callsLast24h,
      blocked: true,
      oldestCallTime,
      newestCallTime,
      hourlyBuckets,
      warning: `BL API limit reached: ${callsLast24h}/${callCeiling} calls in 24 hours. Please wait before syncing again.`,
    };
  }
  
  if (callsLast24h >= BL_API_CALLS_WARN_AT) {
    return {
      allowed: true,
      callsLast24h,
      oldestCallTime,
      newestCallTime,
      hourlyBuckets,
      warning: `BL API usage warning: ${callsLast24h}/${callCeiling} calls in 24 hours. Approaching limit.`,
    };
  }
  
  return { allowed: true, callsLast24h, oldestCallTime, newestCallTime, hourlyBuckets };
}

// Track a BL API call with org attribution
async function trackApiCall(endpoint: string, success: boolean = true, orgId: string = PLATFORM_ORG_ID): Promise<void> {
  await db.insert(blApiCalls).values({
    endpoint,
    success,
    orgId,
  });
}

// Make a BrickLink API request with rate limiting (GET)
export async function bricklinkRequest(endpoint: string, queryParams?: Record<string, string>, orgId: string = PLATFORM_ORG_ID): Promise<{ data: any; apiCalls: number }> {
  // Get credentials from database settings (with fallback to env vars), scoped to org
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.orgId, orgId)).limit(1);
  
  const consumerKey = cleanToken(settings?.bricklinkConsumerKey || process.env.BRICKLINK_CONSUMER_KEY || '');
  const consumerSecret = cleanToken(settings?.bricklinkConsumerSecret || process.env.BRICKLINK_CONSUMER_SECRET || '');
  const tokenValue = cleanToken(settings?.bricklinkTokenValue || process.env.BRICKLINK_TOKEN_VALUE || '');
  const tokenSecret = cleanToken(settings?.bricklinkTokenSecret || process.env.BRICKLINK_TOKEN_SECRET || '');
  
  if (!consumerKey || !consumerSecret || !tokenValue || !tokenSecret) {
    throw new Error('BrickLink credentials not configured. Please add them in Settings.');
  }

  // Check rate limit before making request (per-org)
  const rateLimit = await checkRateLimit(orgId);
  if (!rateLimit.allowed) {
    throw new Error(rateLimit.warning || 'API rate limit exceeded');
  }

  // Create OAuth client with credentials
  const oauth = new OAuth({
    consumer: {
      key: consumerKey,
      secret: consumerSecret,
    },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64');
    },
  });

  const token = {
    key: cleanToken(tokenValue),
    secret: cleanToken(tokenSecret),
  };

  // Build URL with query params - OAuth needs the full URL for GET request signatures
  let url = `https://api.bricklink.com/api/store/v1${endpoint}`;
  if (queryParams && Object.keys(queryParams).length > 0) {
    const params = new URLSearchParams(queryParams);
    const qs = params.toString();
    if (qs) url = `${url}?${qs}`;
  }
  
  // For GET requests, query params must be in the URL, not the data field
  const requestData = { url, method: 'GET' };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));
  
  let success = false;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`BrickLink API error (${response.status}):`, errorText);
      throw new Error(`BrickLink API error: ${response.statusText}`);
    }

    const json = await response.json();
    
    // BrickLink returns 200 OK even for auth errors - check meta.code in response
    if (json.meta && json.meta.code !== 200) {
      console.error(`BrickLink API error (meta.code ${json.meta.code}):`, json.meta.description || json.meta.message);
      throw new Error(`BrickLink API error: ${json.meta.description || json.meta.message}`);
    }
    
    success = true; // Only mark as success if both HTTP and meta.code are OK
    
    // Log API response for debugging
    if (endpoint.includes('/inventories')) {
      console.log(`BrickLink inventory response meta:`, json.meta);
      console.log(`BrickLink inventory data type:`, Array.isArray(json.data) ? 'array' : typeof json.data);
      console.log(`BrickLink inventory items count:`, Array.isArray(json.data) ? json.data.length : 'not an array');
      if (Array.isArray(json.data) && json.data.length > 0) {
        console.log(`First inventory item:`, JSON.stringify(json.data[0]));
      }
    }
    
    return { data: json.data, apiCalls: 1 };
  } finally {
    // Track the API call exactly once, regardless of success or failure
    await trackApiCall(endpoint, success, orgId);
  }
}

// Make a BrickLink API PUT request (for updating inventory)
async function bricklinkPutRequest(endpoint: string, body: any, orgId: string = PLATFORM_ORG_ID): Promise<{ data: any; apiCalls: number }> {
  // Get credentials from database settings (with fallback to env vars), scoped to org
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.orgId, orgId)).limit(1);
  
  const consumerKey = cleanToken(settings?.bricklinkConsumerKey || process.env.BRICKLINK_CONSUMER_KEY || '');
  const consumerSecret = cleanToken(settings?.bricklinkConsumerSecret || process.env.BRICKLINK_CONSUMER_SECRET || '');
  const tokenValue = cleanToken(settings?.bricklinkTokenValue || process.env.BRICKLINK_TOKEN_VALUE || '');
  const tokenSecret = cleanToken(settings?.bricklinkTokenSecret || process.env.BRICKLINK_TOKEN_SECRET || '');
  
  if (!consumerKey || !consumerSecret || !tokenValue || !tokenSecret) {
    throw new Error('BrickLink credentials not configured. Please add them in Settings.');
  }

  // Check rate limit before making request (per-org)
  const rateLimit = await checkRateLimit(orgId);
  if (!rateLimit.allowed) {
    throw new Error(rateLimit.warning || 'API rate limit exceeded');
  }

  // Create OAuth client
  const oauth = new OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64');
    },
  });

  const token = {
    key: cleanToken(tokenValue),
    secret: cleanToken(tokenSecret),
  };

  const url = `https://api.bricklink.com/api/store/v1${endpoint}`;
  const requestData = { url, method: 'PUT', body: JSON.stringify(body) };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));
  
  let success = false;
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`BrickLink PUT error (${response.status}):`, errorText);
      throw new Error(`BrickLink API error: ${response.statusText}`);
    }

    const json = await response.json();
    
    if (json.meta && json.meta.code !== 200) {
      console.error(`BrickLink PUT error (meta.code ${json.meta.code}):`, json.meta.description || json.meta.message);
      throw new Error(`BrickLink API error: ${json.meta.description || json.meta.message}`);
    }
    
    success = true;
    return { data: json.data, apiCalls: 1 };
  } finally {
    await trackApiCall(endpoint, success, orgId);
  }
}

/**
 * Adjust BrickLink inventory quantity using delta (relative) format.
 * BrickLink's API uses "+N" / "-N" string deltas, NOT absolute values.
 * Sending an absolute value would be treated as additive and inflate the qty.
 *
 * @param inventoryId - BrickLink inventory ID (numeric from bl_inventory.id)
 * @param delta - Change in quantity: negative to reduce, positive to restore
 */
export async function adjustBrickLinkInventoryDelta(
  inventoryId: number,
  delta: number,
  orgId: string = PLATFORM_ORG_ID
): Promise<{ success: boolean; error?: string }> {
  try {
    if (delta === 0) return { success: true };
    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
    console.log(`Adjusting BrickLink inventory ${inventoryId} by ${deltaStr}...`);
    
    await bricklinkPutRequest(`/inventories/${inventoryId}`, {
      quantity: deltaStr,
    }, orgId);
    
    console.log(`✓ BrickLink: Adjusted inventory ${inventoryId} by ${deltaStr}`);
    return { success: true };
  } catch (error: any) {
    console.error(`✗ BrickLink adjustment failed for inventory ${inventoryId}:`, error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * @deprecated Use adjustBrickLinkInventoryDelta instead.
 * Left here in case any legacy callers reference it directly.
 */
export async function updateBrickLinkInventoryQuantity(
  inventoryId: number,
  newQuantity: number
): Promise<{ success: boolean; error?: string }> {
  console.warn(`updateBrickLinkInventoryQuantity is deprecated. Use adjustBrickLinkInventoryDelta.`);
  return { success: false, error: 'Deprecated: BrickLink requires delta adjustments, not absolute quantity.' };
}

/**
 * Update BrickLink inventory item with multiple fields
 * @param inventoryId - BrickLink inventory ID (numeric from bl_inventory.id)
 * @param updates - Object with fields to update (quantity, unit_price, remarks, description, new_or_used, etc.)
 */
export async function updateBrickLinkInventoryItem(
  inventoryId: number,
  updates: Record<string, any>,
  orgId: string = PLATFORM_ORG_ID
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`Updating BrickLink inventory ${inventoryId} with:`, updates);
    
    await bricklinkPutRequest(`/inventories/${inventoryId}`, updates, orgId);
    
    console.log(`✓ BrickLink: Updated inventory ${inventoryId}`);
    return { success: true };
  } catch (error: any) {
    console.error(`✗ BrickLink update failed for inventory ${inventoryId}:`, error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

export async function syncBricklinkCategories(orgId: string = PLATFORM_ORG_ID): Promise<{ added: number; updated: number; apiCalls: number }> {
  try {
    const { data: responseData, apiCalls } = await bricklinkRequest('/categories', undefined, orgId);
    
    // BrickLink API returns data directly as an array
    const categories = Array.isArray(responseData) ? responseData : [];
    
    if (categories.length === 0) {
      return { added: 0, updated: 0, apiCalls };
    }
    
    // Fetch all existing categories in one query
    const existingCategories = await db.select().from(blCategories);
    const existingMap = new Map(existingCategories.map(cat => [cat.id, cat]));
    
    // Separate into new and existing
    const newCategories = categories.filter(cat => !existingMap.has(cat.category_id));
    const categoriesToUpdate = categories.filter(cat => {
      const existing = existingMap.get(cat.category_id);
      return existing && existing.name !== cat.category_name;
    });
    
    let added = 0;
    let updated = 0;

    // Batch insert new categories
    if (newCategories.length > 0) {
      const values = newCategories.map(cat => ({
        id: cat.category_id,
        name: cat.category_name,
      }));
      await db.insert(blCategories).values(values);
      added = newCategories.length;
    }
    
    // Update changed categories
    for (const cat of categoriesToUpdate) {
      await db.update(blCategories)
        .set({ name: cat.category_name, updatedAt: new Date() })
        .where(eq(blCategories.id, cat.category_id));
      updated++;
    }

    return { added, updated, apiCalls };
  } catch (error) {
    console.error('Error syncing BrickLink categories:', error);
    throw error;
  }
}

export async function syncBricklinkColors(orgId: string = PLATFORM_ORG_ID): Promise<{ added: number; updated: number; apiCalls: number }> {
  try {
    const { data: responseData, apiCalls } = await bricklinkRequest('/colors', undefined, orgId);
    
    // BrickLink API returns data directly as an array
    const colors = Array.isArray(responseData) ? responseData : [];
    
    if (colors.length === 0) {
      return { added: 0, updated: 0, apiCalls };
    }
    
    // Fetch all existing colors in one query
    const existingColors = await db.select().from(blColors);
    const existingMap = new Map(existingColors.map(color => [color.id, color]));
    
    // Separate into new and existing
    const newColors = colors.filter(color => !existingMap.has(color.color_id));
    const colorsToUpdate = colors.filter(color => {
      const existing = existingMap.get(color.color_id);
      if (!existing) return false;
      
      return existing.name !== color.color_name || 
             existing.rgb !== (color.color_code || '000000') || 
             existing.type !== (color.color_type || 'solid');
    });
    
    let added = 0;
    let updated = 0;

    // Batch insert new colors
    if (newColors.length > 0) {
      const values = newColors.map(color => ({
        id: color.color_id,
        name: color.color_name,
        rgb: color.color_code || '000000',
        type: color.color_type || 'solid',
      }));
      await db.insert(blColors).values(values);
      added = newColors.length;
    }
    
    // Update changed colors
    for (const color of colorsToUpdate) {
      await db.update(blColors)
        .set({ 
          name: color.color_name, 
          rgb: color.color_code || '000000', 
          type: color.color_type || 'solid', 
          updatedAt: new Date() 
        })
        .where(eq(blColors.id, color.color_id));
      updated++;
    }

    return { added, updated, apiCalls };
  } catch (error) {
    console.error('Error syncing BrickLink colors:', error);
    throw error;
  }
}

function buildBricklinkImageUrl(itemType: string, colorId: number | null, itemNo: string): string | null {
  if (!itemNo) return null;
  switch (itemType) {
    case 'PART':        return colorId ? `https://img.bricklink.com/P/${colorId}/${itemNo}.jpg` : null;
    case 'MINIFIG':     return `https://img.bricklink.com/M/${itemNo}.jpg`;
    case 'SET':         return `https://img.bricklink.com/S/${itemNo}.jpg`;
    case 'GEAR':        return colorId ? `https://img.bricklink.com/G/${colorId}/${itemNo}.jpg` : null;
    case 'INSTRUCTION': return `https://img.bricklink.com/IN/${itemNo}.jpg`;
    case 'BOOK':        return `https://img.bricklink.com/BK/${itemNo}.jpg`;
    case 'ORIGINAL_BOX':return `https://img.bricklink.com/S/${itemNo}.jpg`;
    default:            return colorId ? `https://img.bricklink.com/P/${colorId}/${itemNo}.jpg` : null;
  }
}

export async function syncBricklinkInventory(callComplete = true, orgId: string = PLATFORM_ORG_ID): Promise<{ added: number; updated: number; apiCalls: number }> {
  try {
    const { syncProgressTracker } = await import('./sync-progress');
    if (callComplete) syncProgressTracker.start();
    
    console.log('📥 Downloading all inventory data from BrickLink API...');
    syncProgressTracker.update('Downloading inventory from BrickLink...', 10);
    
    // Fetch all inventory without status filters - BrickLink will return everything
    const { data: responseData, apiCalls } = await bricklinkRequest('/inventories', undefined, orgId);
    
    const items = Array.isArray(responseData) ? responseData : [];
    console.log(`✓ Downloaded ${items.length} items from BrickLink`);
    syncProgressTracker.update(`Downloaded ${items.length} items from BrickLink`, 25, { itemsDownloaded: items.length });
    
    if (items.length === 0) {
      console.log('No inventory items received from BrickLink');
      return { added: 0, updated: 0, apiCalls };
    }

    console.log(`First item sample:`, JSON.stringify(items[0]).substring(0, 200));
    
    // Get all existing inventory IDs for this org in one query for comparison
    const existingItems = await db.select({ id: blInventory.id }).from(blInventory).where(eq(blInventory.orgId, orgId));
    const existingIds = new Set(existingItems.map(item => item.id));
    
    // Separate items into new and existing - explicitly convert inventory_id to number for comparison
    const newItems = items.filter(item => !existingIds.has(Number(item.inventory_id)));
    const existingItemsToCheck = items.filter(item => existingIds.has(Number(item.inventory_id)));
    
    console.log(`🔍 Analyzing changes: ${newItems.length} new items, ${existingItemsToCheck.length} items to check for updates`);
    syncProgressTracker.update(`Analyzing changes: ${newItems.length} new, ${existingItemsToCheck.length} to check`, 35, { 
      totalItems: items.length 
    });
    
    // Batch insert new items (PostgreSQL supports large batch inserts)
    let added = 0;
    if (newItems.length > 0) {
      console.log(`➕ Adding ${newItems.length} new items to database...`);
      syncProgressTracker.update(`Adding ${newItems.length} new items...`, 40);
      const BATCH_SIZE = 1000;
      for (let i = 0; i < newItems.length; i += BATCH_SIZE) {
        const batch = newItems.slice(i, i + BATCH_SIZE);
        const values = batch.map(item => ({
          id: item.inventory_id,
          itemNo: item.item.no,
          itemType: item.item.type,
          colorId: item.color_id || 0,
          quantity: item.quantity,
          newOrUsed: item.new_or_used,
          completeness: item.completeness || null,
          unitPrice: item.unit_price,
          myCost: item.my_cost || null,
          bindId: item.bind_id || null,
          description: item.description || null,
          remarks: item.remarks || null,
          bulk: item.bulk || null,
          isRetain: !!item.is_retain,
          isStockRoom: !!item.is_stock_room,
          stockRoomId: item.stock_room_id || null,
          dateCreated: item.date_created ? new Date(item.date_created) : null,
          saleRate: item.sale_rate || null,
          tierPrice1: item.tier_price1 || null,
          tierPrice2: item.tier_price2 || null,
          tierPrice3: item.tier_price3 || null,
          tierQuantity1: item.tier_quantity1 || null,
          tierQuantity2: item.tier_quantity2 || null,
          tierQuantity3: item.tier_quantity3 || null,
          myWeight: item.my_weight || null,
          orgId,
        }));
        
        await db.insert(blInventory).values(values).onConflictDoNothing();

        // Dual-write: upsert catalog-level fields to bl_catalog (deduplicate within batch)
        const batchCatMap = new Map<string, any>();
        for (const item of batch) {
          const k = `${item.item.no}|${item.item.type}|${item.color_id || 0}`;
          if (!batchCatMap.has(k)) batchCatMap.set(k, { itemNo: item.item.no, itemType: item.item.type, colorId: item.color_id || 0, itemName: item.item.name || null, colorName: item.color_name || null, categoryId: item.item.category_id || null });
        }
        if (batchCatMap.size > 0) {
          await db.insert(blCatalog).values(Array.from(batchCatMap.values())).onConflictDoUpdate({
            target: [blCatalog.itemNo, blCatalog.itemType, blCatalog.colorId],
            set: {
              itemName: sql`COALESCE(EXCLUDED.item_name, bl_catalog.item_name)`,
              colorName: sql`COALESCE(EXCLUDED.color_name, bl_catalog.color_name)`,
              categoryId: sql`COALESCE(EXCLUDED.category_id, bl_catalog.category_id)`,
              updatedAt: sql`NOW()`,
            },
          });
        }

        added += batch.length;
        console.log(`Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${added}/${newItems.length} new items`);
      }

      // Fire-and-forget: fetch Rebrickable color-accurate images for new PART items in background
      const newPartItems = newItems
        .filter(item => item.item.type === 'PART' && item.color_id)
        .map(item => ({
          id: item.inventory_id,
          itemNo: item.item.no,
          colorId: item.color_id,
          itemType: item.item.type,
        }));
      // Image URLs resolved dynamically via BrickLink CDN — no fetch needed
    }
    
    // For existing items, check if they need updates (quantity or price changes)
    let updated = 0;
    if (existingItemsToCheck.length > 0) {
      console.log(`🔄 Comparing ${existingItemsToCheck.length} items for price/quantity changes...`);
      syncProgressTracker.update(`Comparing ${existingItemsToCheck.length} items for changes...`, 50);
      // Get full details of existing items that might need updates in batches to avoid PostgreSQL ROW limit
      const FETCH_BATCH_SIZE = 1000; // Fetch in smaller batches to avoid "ROW expressions can have at most 1664 entries" error
      const existingDetails = [];
      
      for (let i = 0; i < existingItemsToCheck.length; i += FETCH_BATCH_SIZE) {
        const batch = existingItemsToCheck.slice(i, i + FETCH_BATCH_SIZE);
        // Explicitly convert to integers to avoid type mismatch with PostgreSQL
        const batchIds = batch.map(item => Number(item.inventory_id));
        
        const batchDetails = await db.select()
          .from(blInventory)
          .where(and(eq(blInventory.orgId, orgId), inArray(blInventory.id, batchIds)));
        
        existingDetails.push(...batchDetails);
        const progress = Math.round((existingDetails.length / existingItemsToCheck.length) * 100);
        const overallProgress = 50 + Math.round(progress * 0.3); // 50-80%
        console.log(`  Progress: ${existingDetails.length}/${existingItemsToCheck.length} (${progress}%)`);
        syncProgressTracker.update(
          `Checking for updates: ${existingDetails.length}/${existingItemsToCheck.length}`, 
          overallProgress, 
          { itemsChecked: existingDetails.length }
        );
      }
      
      const existingMap = new Map(existingDetails.map(item => [item.id, item]));
      
      // Batch update items that have changed
      const BATCH_SIZE = 500;
      let debugLogCount = 0;
      const itemsToUpdate = existingItemsToCheck.filter(item => {
        const existing = existingMap.get(Number(item.inventory_id));
        if (!existing) return false;
        
        // Normalize numeric values
        const apiUnitPrice = parseFloat(item.unit_price || "0");
        const existingUnitPrice = parseFloat(existing.unitPrice || "0");
        
        // Normalize boolean values from BrickLink (true/false or possibly undefined)
        const apiIsRetain = !!item.is_retain;
        const apiIsStockRoom = !!item.is_stock_room;
        
        const needsUpdate = (
          existing.quantity !== item.quantity || 
          Math.abs(existingUnitPrice - apiUnitPrice) > 0.001 ||
          existing.itemNo !== item.item.no ||
          existing.itemType !== item.item.type ||
          existing.colorId !== (item.color_id || 0) ||
          existing.newOrUsed !== item.new_or_used ||
          existing.description !== (item.description || null) ||
          existing.remarks !== (item.remarks || null) ||
          existing.bulk !== (item.bulk || null) ||
          existing.isRetain !== apiIsRetain ||
          existing.isStockRoom !== apiIsStockRoom ||
          existing.bindId !== (item.bind_id || null)
        );
        
        // Log first few items that need updates to help debug
        if (needsUpdate && debugLogCount < 5) {
          debugLogCount++;
          const reasons = [];
          if (existing.quantity !== item.quantity) reasons.push(`quantity: ${existing.quantity} → ${item.quantity}`);
          if (Math.abs(existingUnitPrice - apiUnitPrice) > 0.001) reasons.push(`price: $${existingUnitPrice} → $${apiUnitPrice}`);
          if (existing.remarks !== (item.remarks || null)) reasons.push('remarks changed');
          if (existing.description !== (item.description || null)) reasons.push('description changed');
          if (existing.isRetain !== apiIsRetain) reasons.push(`isRetain: ${existing.isRetain} → ${apiIsRetain}`);
          if (existing.isStockRoom !== apiIsStockRoom) reasons.push(`isStockRoom: ${existing.isStockRoom} → ${apiIsStockRoom}`);
          console.log(`[Sync Debug] Item ${item.inventory_id} (${item.item.no}) needs update: ${reasons.join(', ')}`);
        }
        
        return needsUpdate;
      });
      
      console.log(`Found ${itemsToUpdate.length} items needing updates`);
      syncProgressTracker.update(`Updating ${itemsToUpdate.length} modified items...`, 85);
      
      for (let i = 0; i < itemsToUpdate.length; i += BATCH_SIZE) {
        const batch = itemsToUpdate.slice(i, i + BATCH_SIZE);
        
        // Update each item in the batch
        for (const item of batch) {
          await db.update(blInventory)
            .set({ 
              itemNo: item.item.no,
              itemType: item.item.type,
              colorId: item.color_id || 0,
              quantity: item.quantity,
              newOrUsed: item.new_or_used,
              completeness: item.completeness || null,
              unitPrice: item.unit_price,
              myCost: item.my_cost || null,
              bindId: item.bind_id || null,
              description: item.description || null,
              remarks: item.remarks || null,
              bulk: item.bulk || null,
              isRetain: !!item.is_retain,
              isStockRoom: !!item.is_stock_room,
              stockRoomId: item.stock_room_id || null,
              dateCreated: item.date_created ? new Date(item.date_created) : null,
              saleRate: item.sale_rate || null,
              tierPrice1: item.tier_price1 || null,
              tierPrice2: item.tier_price2 || null,
              tierPrice3: item.tier_price3 || null,
              tierQuantity1: item.tier_quantity1 || null,
              tierQuantity2: item.tier_quantity2 || null,
              tierQuantity3: item.tier_quantity3 || null,
              myWeight: item.my_weight || null,
              updatedAt: new Date() 
            })
            .where(and(eq(blInventory.orgId, orgId), eq(blInventory.id, Number(item.inventory_id))));

          // Dual-write catalog fields to bl_catalog
          await db.insert(blCatalog).values({
            itemNo: item.item.no,
            itemType: item.item.type,
            colorId: item.color_id || 0,
            itemName: item.item.name || null,
            colorName: item.color_name || null,
            categoryId: item.item.category_id || null,
          }).onConflictDoUpdate({
            target: [blCatalog.itemNo, blCatalog.itemType, blCatalog.colorId],
            set: {
              itemName: sql`COALESCE(EXCLUDED.item_name, bl_catalog.item_name)`,
              colorName: sql`COALESCE(EXCLUDED.color_name, bl_catalog.color_name)`,
              categoryId: sql`COALESCE(EXCLUDED.category_id, bl_catalog.category_id)`,
              updatedAt: sql`NOW()`,
            },
          });
          updated++;
        }
        
        const updateProgress = 85 + Math.round(((i + batch.length) / itemsToUpdate.length) * 10); // 85-95%
        syncProgressTracker.update(`Updated ${updated}/${itemsToUpdate.length} items`, updateProgress, { itemsUpdated: updated });
        console.log(`Updated batch ${Math.floor(i / BATCH_SIZE) + 1}: ${updated}/${itemsToUpdate.length} items`);
      }
    }

    // Bulk-upsert bl_catalog for ALL items so every inventory lot gets a name/color/category.
    // This covers items that existed before the dual-write was added and items that
    // didn't change (so weren't touched by the new/update paths above).
    // Deduplicate by (item_no, item_type, color_id) first — multiple lots share the same key.
    const catalogMap = new Map<string, { itemNo: string; itemType: string; colorId: number; itemName: string | null; colorName: string | null; categoryId: number | null }>();
    for (const item of items) {
      const key = `${item.item.no}|${item.item.type}|${item.color_id || 0}`;
      if (!catalogMap.has(key)) {
        catalogMap.set(key, {
          itemNo: item.item.no,
          itemType: item.item.type,
          colorId: item.color_id || 0,
          itemName: item.item.name || null,
          colorName: item.color_name || null,
          categoryId: item.item.category_id || null,
        });
      }
    }
    const uniqueCatalogValues = Array.from(catalogMap.values());
    const CATALOG_BATCH = 1000;
    let catalogUpserted = 0;
    for (let i = 0; i < uniqueCatalogValues.length; i += CATALOG_BATCH) {
      const batch = uniqueCatalogValues.slice(i, i + CATALOG_BATCH);
      await db.insert(blCatalog).values(batch).onConflictDoUpdate({
        target: [blCatalog.itemNo, blCatalog.itemType, blCatalog.colorId],
        set: {
          itemName: sql`COALESCE(EXCLUDED.item_name, bl_catalog.item_name)`,
          colorName: sql`COALESCE(EXCLUDED.color_name, bl_catalog.color_name)`,
          categoryId: sql`COALESCE(EXCLUDED.category_id, bl_catalog.category_id)`,
          updatedAt: sql`NOW()`,
        },
      });
      catalogUpserted += batch.length;
    }
    console.log(`[CatalogBackfill] Upserted ${catalogUpserted} bl_catalog rows from inventory sync`);

    console.log(`BrickLink inventory sync complete: ${added} added, ${updated} updated`);
    if (callComplete) {
      syncProgressTracker.complete(added, updated);
    } else {
      // Called from comprehensive sync — stay 'syncing', let the outer function complete
      syncProgressTracker.update('BrickLink inventory synced, continuing…', 70, { itemsAdded: added, itemsUpdated: updated });
    }
    return { added, updated, apiCalls };
  } catch (error) {
    console.error('Error syncing BrickLink inventory:', error);
    const { syncProgressTracker } = await import('./sync-progress');
    syncProgressTracker.error(error instanceof Error ? error.message : 'Sync failed');
    throw error;
  }
}

// OLD VERSION WITH STATUS FILTERS - KEPT FOR REFERENCE
async function syncBricklinkInventoryByStatus(orgId: string = PLATFORM_ORG_ID): Promise<{ added: number; updated: number; apiCalls: number }> {
  try {
    let added = 0;
    let updated = 0;
    let totalApiCalls = 0;

    console.log('Starting BrickLink inventory sync...');
    
    // Fetch inventory from all statuses (Y=available, S/B/C=stockrooms, N=unavailable, R=reserved)
    // We'll make separate calls for each status to ensure we get everything
    const statuses = ['Y', 'S', 'B', 'C', 'N', 'R'];
    
    for (const status of statuses) {
      console.log(`Fetching inventory with status: ${status}`);
      
      try {
        const { data: responseData, apiCalls } = await bricklinkRequest('/inventories', { status }, orgId);
        totalApiCalls += apiCalls;
        
        const items = Array.isArray(responseData) ? responseData : [];
        console.log(`Received ${items.length} items with status ${status}`);
        
        for (const item of items) {
          const existing = await db.select().from(blInventory).where(eq(blInventory.id, item.inventory_id));
          
          if (existing.length === 0) {
            await db.insert(blInventory).values({
              id: item.inventory_id,
              itemNo: item.item.no,
              itemType: item.item.type,
              colorId: item.color_id || 0,
              quantity: item.quantity,
              newOrUsed: item.new_or_used,
              unitPrice: item.unit_price,
            });
            added++;
          } else {
            const needsUpdate = existing[0].quantity !== item.quantity || 
                                existing[0].unitPrice !== item.unit_price;
            if (needsUpdate) {
              await db.update(blInventory)
                .set({ 
                  quantity: item.quantity,
                  unitPrice: item.unit_price,
                  updatedAt: new Date() 
                })
                .where(eq(blInventory.id, item.inventory_id));
              updated++;
            }
          }
        }
      } catch (statusError) {
        console.error(`Error fetching status ${status}:`, statusError);
        // Continue with other statuses even if one fails
      }
    }

    console.log(`BrickLink inventory sync complete: ${added} added, ${updated} updated, ${totalApiCalls} API calls`);

    return { added, updated, apiCalls: totalApiCalls };
  } catch (error) {
    console.error('Error syncing BrickLink inventory:', error);
    throw error;
  }
}

export async function syncBricklinkData(orgId: string = PLATFORM_ORG_ID): Promise<BricklinkSyncResult> {
  
  // Acquire inventory sync lock to prevent order sync conflicts
  const lockAcquired = await syncLock.acquireInventoryLock();
  if (!lockAcquired) {
    throw new Error('Inventory sync already in progress');
  }

  const { syncProgressTracker } = await import('./sync-progress');

  try {
    const rateLimit = await checkRateLimit(orgId);
    
    console.log('\n🔄 Starting inventory sync...');
    syncProgressTracker.start();

    // Step 1: Sync inventory from BrickLink (the only org-level API call)
    console.log('📦 Step 1/2: Syncing BrickLink inventory...');
    const inventoryResult = await syncBricklinkInventory(false, orgId);

    // Step 2: Save XML backup
    console.log('💾 Step 2/2: Saving XML backup...');
    syncProgressTracker.update('Saving XML backup…', 95);
    try {
      const backupFilename = await saveXMLBackup();
      console.log(`💾 XML backup saved: ${backupFilename}`);
    } catch (error) {
      console.error('✗ XML backup failed (non-fatal):', error);
    }

    syncProgressTracker.complete(inventoryResult.added, inventoryResult.updated);
    console.log('✅ Inventory sync complete!');

    return {
      inventoryAdded: inventoryResult.added,
      inventoryUpdated: inventoryResult.updated,
      totalApiCalls: inventoryResult.apiCalls,
      rateLimitWarning: rateLimit.warning,
    };
  } catch (error) {
    syncProgressTracker.error(error instanceof Error ? error.message : 'Comprehensive sync failed');
    throw error;
  } finally {
    // Always release the lock, even if sync fails
    syncLock.releaseInventoryLock();
  }
}

// ====== PRICE-O-MAGIC FUNCTIONS ======

// Make a BrickLink Catalog API request (different base URL)
export async function bricklinkCatalogRequest(endpoint: string, queryParams?: Record<string, string>, orgId: string = PLATFORM_ORG_ID): Promise<{ data: any; apiCalls: number }> {
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.orgId, orgId)).limit(1);
  
  console.log('[Price-o-Matic Debug] Settings loaded:', {
    hasSettings: !!settings,
    consumerKey: settings?.bricklinkConsumerKey ? 'present' : 'missing',
    consumerSecret: settings?.bricklinkConsumerSecret ? 'present' : 'missing',
    tokenValue: settings?.bricklinkTokenValue ? 'present' : 'missing',
    tokenSecret: settings?.bricklinkTokenSecret ? 'present' : 'missing',
  });
  
  const consumerKey = cleanToken(settings?.bricklinkConsumerKey || process.env.BRICKLINK_CONSUMER_KEY || '');
  const consumerSecret = cleanToken(settings?.bricklinkConsumerSecret || process.env.BRICKLINK_CONSUMER_SECRET || '');
  const tokenValue = cleanToken(settings?.bricklinkTokenValue || process.env.BRICKLINK_TOKEN_VALUE || '');
  const tokenSecret = cleanToken(settings?.bricklinkTokenSecret || process.env.BRICKLINK_TOKEN_SECRET || '');
  
  if (!consumerKey || !consumerSecret || !tokenValue || !tokenSecret) {
    console.error('[Price-o-Matic Debug] Missing credentials:', {
      consumerKey: consumerKey ? 'present' : 'MISSING',
      consumerSecret: consumerSecret ? 'present' : 'MISSING',
      tokenValue: tokenValue ? 'present' : 'MISSING',
      tokenSecret: tokenSecret ? 'present' : 'MISSING',
    });
    throw new Error('BrickLink credentials not configured. Please add them in Settings.');
  }

  // Check rate limit (per-org)
  const rateLimit = await checkRateLimit(orgId);
  if (!rateLimit.allowed) {
    throw new Error(rateLimit.warning || 'API rate limit exceeded');
  }

  // Create OAuth client
  const oauth = new OAuth({
    consumer: {
      key: consumerKey,
      secret: consumerSecret,
    },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64');
    },
  });

  const token = {
    key: cleanToken(tokenValue),
    secret: cleanToken(tokenSecret),
  };

  // Catalog API uses same /api/store/v1 base as other endpoints
  let url = `https://api.bricklink.com/api/store/v1${endpoint}`;
  if (queryParams && Object.keys(queryParams).length > 0) {
    const params = new URLSearchParams(queryParams);
    const qs = params.toString();
    if (qs) url = `${url}?${qs}`;
  }
  
  const requestData = { url, method: 'GET' };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));
  
  let success = false;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`BrickLink Catalog API error (${response.status}):`, errorText);
      throw new Error(`BrickLink Catalog API error: ${response.statusText}`);
    }

    const json = await response.json();
    
    if (json.meta && json.meta.code !== 200) {
      console.error(`BrickLink Catalog API error (meta.code ${json.meta.code}):`, json.meta.description || json.meta.message);
      throw new Error(`BrickLink Catalog API error: ${json.meta.description || json.meta.message}`);
    }
    
    success = true;
    return { data: json.data, apiCalls: 1 };
  } finally {
    await trackApiCall(endpoint, success, orgId);
  }
}

function sumPriceDetailQty(priceDetails: Array<{ quantity: string | number }> | undefined): number | null {
  if (!priceDetails || priceDetails.length === 0) return null;
  const total = priceDetails.reduce((sum, d) => sum + (parseInt(d.quantity.toString()) || 0), 0);
  return total > 0 ? total : null;
}

// Compute multiple weighted percentiles from BrickLink price_detail entries in one pass
function computePercentiles(
  priceDetails: Array<{ quantity: string | number; unit_price: string }> | undefined,
  percentiles: number[]
): Record<number, number | null> {
  const result: Record<number, number | null> = {};
  percentiles.forEach(p => { result[p] = null; });
  if (!priceDetails || priceDetails.length === 0) return result;
  const weighted = priceDetails
    .map(d => ({ price: parseFloat(d.unit_price), qty: Math.max(1, parseInt(d.quantity.toString()) || 1) }))
    .filter(d => d.price > 0)
    .sort((a, b) => a.price - b.price);
  if (weighted.length === 0) return result;
  const totalQty = weighted.reduce((sum, d) => sum + d.qty, 0);
  const last = weighted[weighted.length - 1].price;
  for (const percentile of percentiles) {
    const target = totalQty * (percentile / 100);
    let cumulative = 0;
    let found = false;
    for (const d of weighted) {
      cumulative += d.qty;
      if (cumulative >= target) { result[percentile] = Number(d.price.toFixed(4)); found = true; break; }
    }
    if (!found) result[percentile] = Number(last.toFixed(4));
  }
  return result;
}

// Convenience wrapper for single-percentile callers
function computeWeightedPercentile(
  priceDetails: Array<{ quantity: string | number; unit_price: string }> | undefined,
  percentile: number
): number | null {
  return computePercentiles(priceDetails, [percentile])[percentile] ?? null;
}

// Calculate Price-O-Matic suggested price with premium
function calculateSuggestedPrice(
  stockAvgPrice: number | null,
  soldAvgPrice: number | null,
  premiumPercentage: number = 15
): number {
  // Use 85th-percentile sold price as primary reference — fall back to stock avg if no sold data
  const basePrice = soldAvgPrice || stockAvgPrice || 0;
  
  if (basePrice === 0) {
    return 0;
  }
  
  // Apply premium percentage (default 15% for fast turnaround and large inventory)
  const suggestedPrice = basePrice * (1 + premiumPercentage / 100);
  
  return Number(suggestedPrice.toFixed(2));
}

interface PomFormulaConfig {
  basePremium: number;
  minifigPremium: number;
  scarcityThreshold1: number;
  scarcityBonus1: number;
  scarcityThreshold2: number;
  scarcityBonus2: number;
  scarcityThreshold3: number;
  scarcityBonus3: number;
  costFloorPct: number;
  minPrice: number;
  // Market Dynamics: combines BL market demand signal and supply signal
  trendingEnabled: boolean;         // master on/off for market dynamics
  trendingDays: number;             // repurposed: max % adjustment market dynamics can apply (up or down)
  trendingThreshold: number;        // BL sold unit_quantity that represents "fully demanded" (ratio denominator)
  trendingBonus: number;            // demand weight 0–100: how much of maxAdj goes to demand side
  highSupplyEnabled: boolean;       // unused in formula, kept for schema compat
  highSupplyThreshold: number;      // BL stock unit_quantity that represents "fully supplied" (ratio denominator)
  highSupplyPenalty: number;        // supply weight 0–100: how much of maxAdj goes to supply side
}

const POM_FORMULA_DEFAULTS: PomFormulaConfig = {
  basePremium: 10,
  minifigPremium: 5,
  scarcityThreshold1: 50,
  scarcityBonus1: 15,
  scarcityThreshold2: 200,
  scarcityBonus2: 8,
  scarcityThreshold3: 500,
  scarcityBonus3: 3,
  costFloorPct: 0,
  minPrice: 0.02,
  trendingEnabled: false,
  trendingDays: 30,
  trendingThreshold: 5,
  trendingBonus: 5,
  highSupplyEnabled: false,
  highSupplyThreshold: 5000,
  highSupplyPenalty: 5,
};

export async function getPomFormulaConfig(): Promise<PomFormulaConfig> {
  try {
    const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, PLATFORM_ORG_ID)).limit(1);
    if (!settings) return POM_FORMULA_DEFAULTS;
    return {
      basePremium: settings.pomBasePremium ?? POM_FORMULA_DEFAULTS.basePremium,
      minifigPremium: settings.pomMinifigPremium ?? POM_FORMULA_DEFAULTS.minifigPremium,
      scarcityThreshold1: settings.pomScarcityThreshold1 ?? POM_FORMULA_DEFAULTS.scarcityThreshold1,
      scarcityBonus1: settings.pomScarcityBonus1 ?? POM_FORMULA_DEFAULTS.scarcityBonus1,
      scarcityThreshold2: settings.pomScarcityThreshold2 ?? POM_FORMULA_DEFAULTS.scarcityThreshold2,
      scarcityBonus2: settings.pomScarcityBonus2 ?? POM_FORMULA_DEFAULTS.scarcityBonus2,
      scarcityThreshold3: settings.pomScarcityThreshold3 ?? POM_FORMULA_DEFAULTS.scarcityThreshold3,
      scarcityBonus3: settings.pomScarcityBonus3 ?? POM_FORMULA_DEFAULTS.scarcityBonus3,
      costFloorPct: settings.pomCostFloorPct ?? POM_FORMULA_DEFAULTS.costFloorPct,
      minPrice: parseFloat(String(settings.pomMinPrice ?? POM_FORMULA_DEFAULTS.minPrice)),
      trendingEnabled: settings.pomTrendingEnabled ?? POM_FORMULA_DEFAULTS.trendingEnabled,
      trendingDays: settings.pomTrendingDays ?? POM_FORMULA_DEFAULTS.trendingDays,
      trendingThreshold: settings.pomTrendingThreshold ?? POM_FORMULA_DEFAULTS.trendingThreshold,
      trendingBonus: settings.pomTrendingBonus ?? POM_FORMULA_DEFAULTS.trendingBonus,
      highSupplyEnabled: settings.pomHighSupplyEnabled ?? POM_FORMULA_DEFAULTS.highSupplyEnabled,
      highSupplyThreshold: settings.pomHighSupplyThreshold ?? POM_FORMULA_DEFAULTS.highSupplyThreshold,
      highSupplyPenalty: settings.pomHighSupplyPenalty ?? POM_FORMULA_DEFAULTS.highSupplyPenalty,
    };
  } catch {
    return POM_FORMULA_DEFAULTS;
  }
}

// Apply cost floor and minimum price floors to a market-derived suggested price
export function applyPomFloors(
  marketPrice: number,
  myCost: number | null | undefined,
  config: PomFormulaConfig = POM_FORMULA_DEFAULTS
): { finalPrice: number; floorApplied: 'cost' | 'min' | 'none' } {
  let finalPrice = marketPrice;
  let floorApplied: 'cost' | 'min' | 'none' = 'none';

  // Cost floor: never price below my_cost × (1 + costFloorPct%)
  if (config.costFloorPct > 0 && myCost && myCost > 0) {
    const costFloor = myCost * (1 + config.costFloorPct / 100);
    if (costFloor > finalPrice) {
      finalPrice = costFloor;
      floorApplied = 'cost';
    }
  }

  // Absolute minimum price floor
  if (config.minPrice > 0 && config.minPrice > finalPrice) {
    finalPrice = config.minPrice;
    if (floorApplied === 'none') floorApplied = 'min';
  }

  return { finalPrice: Number(finalPrice.toFixed(4)), floorApplied };
}

// Calculate suggested price with supply adjustment (low supply = higher price)
export function calculateSuggestedPriceWithSupply(
  stockAvgPrice: number | null,
  soldAvgPrice: number | null,
  stockTotalLots: number = 0,   // BL stock guide total_lots: global seller listing count (scarcity tiers)
  basePremiumPercentage: number = 10,
  itemType: string = 'PART',
  config: PomFormulaConfig = POM_FORMULA_DEFAULTS,
  marketSoldQty: number = 0,    // BL sold guide unit_quantity: total pieces sold globally (demand signal)
  marketStockQty: number = 0    // BL stock guide unit_quantity: total pieces available globally (supply signal)
): number {
  const basePrice = soldAvgPrice || stockAvgPrice || 0;
  
  if (basePrice === 0) {
    return 0;
  }
  
  // Use minifig-specific base premium if applicable
  let totalPremium = (itemType === 'MINIFIG' || itemType === 'M')
    ? config.minifigPremium
    : config.basePremium;
  
  // Apply scarcity bonus tiers (fewer sellers globally = price up)
  if (stockTotalLots < config.scarcityThreshold1) {
    totalPremium += config.scarcityBonus1;
  } else if (stockTotalLots < config.scarcityThreshold2) {
    totalPremium += config.scarcityBonus2;
  } else if (stockTotalLots < config.scarcityThreshold3) {
    totalPremium += config.scarcityBonus3;
  }

  // Market Dynamics: weighted combination of BL demand signal and supply signal
  // Both use data from the BL price guide API — no local order history involved.
  //   demandRatio = fraction of "max demand" this item has achieved (0–1, capped)
  //   supplyRatio = fraction of "max supply" this item has (0–1, capped)
  //   adjustment  = maxAdj × (demandRatio × demandWeight% - supplyRatio × supplyWeight%)
  if (config.trendingEnabled) {
    const maxAdj = config.trendingDays;  // repurposed field: max % swing allowed
    const demandRatio = config.trendingThreshold > 0
      ? Math.min(marketSoldQty / config.trendingThreshold, 1.0)
      : 0;
    const supplyRatio = config.highSupplyThreshold > 0
      ? Math.min(marketStockQty / config.highSupplyThreshold, 1.0)
      : 0;
    const demandContrib = demandRatio * (config.trendingBonus / 100);
    const supplyContrib = supplyRatio * (config.highSupplyPenalty / 100);
    totalPremium += maxAdj * (demandContrib - supplyContrib);
  }
  
  const suggestedPrice = basePrice * (1 + totalPremium / 100);
  return Number(suggestedPrice.toFixed(2));
}

// Module-level stop flags — cleared at sync start
let pomSyncStopRequested = false;
let pomShutdownRequested = false;
export function requestPomSyncStop() { pomSyncStopRequested = true; }
export function requestPomShutdown() { pomShutdownRequested = true; }

// Live progress object — updated throughout the sync loop so the status endpoint can surface it
let pomSyncProgress = { active: false, itemsProcessed: 0, itemsTotal: 0, apiCallsAtStart: 0, itemsNew: 0, itemsRefreshed: 0 };
export function getPomSyncProgress() { return { ...pomSyncProgress }; }

// Fetch and cache Price-o-Matic data for an item
// Sync Price-o-Matic data for up to N inventory items (default from settings)
export async function syncPriceOMagicCache(maxItems?: number, orgId: string = PLATFORM_ORG_ID): Promise<{
  itemsUpdated: number;
  itemsSkipped: number;
  apiCallsUsed: number;
  stopped: boolean;
  stopReason?: string;
}> {
  const [pomSettings] = await db.select({
    pomBatchSize: appSettings.pomBatchSize,
    blApiCallLimit: appSettings.blApiCallLimit,
    pomFreshnessDays: appSettings.pomFreshnessDays,
    pomZeroStockSkip: appSettings.pomZeroStockSkip,
    pomApiBudgetPct: appSettings.pomApiBudgetPct,
  }).from(appSettings).where(eq(appSettings.id, orgId)).limit(1);

  const effectiveMaxItems = maxItems ?? pomSettings?.pomBatchSize ?? 1500;
  const totalCeiling = pomSettings?.blApiCallLimit ?? 4900;
  const budgetPct = pomSettings?.pomApiBudgetPct ?? 70;
  const apiCallCeiling = Math.floor(totalCeiling * budgetPct / 100);
  const freshnessDays = pomSettings?.pomFreshnessDays ?? 180;
  const zeroStockSkip = pomSettings?.pomZeroStockSkip ?? true;

  console.log(`[Price-o-Matic Sync] Starting sync for up to ${effectiveMaxItems} items (API ceiling: ${apiCallCeiling})`);
  pomSyncStopRequested = false;
  pomShutdownRequested = false;

  let itemsUpdated = 0;
  let itemsSkipped = 0;
  let apiCallsUsed = 0;
  let stopped = false;
  let stopReason: string | undefined;

  try {
    // Get initial API usage count (raw call count only — ceiling enforcement uses platform-level apiCallCeiling,
    // NOT the org-level default from checkRateLimit, so POM respects the admin's configured limit in Platform Services).
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [usageRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(blApiCalls)
      .where(and(eq(blApiCalls.orgId, orgId), gte(blApiCalls.timestamp, twentyFourHoursAgo)));
    const callsLast24h = Number(usageRow?.count) || 0;

    pomSyncProgress = { active: true, itemsProcessed: 0, itemsTotal: 0, apiCallsAtStart: callsLast24h, itemsNew: 0, itemsRefreshed: 0 };
    if (callsLast24h >= apiCallCeiling) {
      pomSyncProgress = { active: false, itemsProcessed: 0, itemsTotal: 0, apiCallsAtStart: callsLast24h, itemsNew: 0, itemsRefreshed: 0 };
      return {
        itemsUpdated: 0,
        itemsSkipped: 0,
        apiCallsUsed: 0,
        stopped: true,
        stopReason: `BL API limit reached: ${callsLast24h}/${apiCallCeiling} calls in 24 hours. Please wait before syncing again.`,
      };
    }

    // Build candidate queue: inventory items needing price guide refresh.
    // Sorted by oldest fetchedAt first (never-fetched items always come first).
    // Staleness window and zero-stock skip come from scheduler settings.
    const quantityFilter = zeroStockSkip ? gt(blInventory.quantity, 0) : undefined;
    const inventoryItems = await db
      .select({
        id: blInventory.id,
        itemNo: blInventory.itemNo,
        itemType: blInventory.itemType,
        colorId: blInventory.colorId,
        newOrUsed: blInventory.newOrUsed,
        quantity: blInventory.quantity,
        itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
        imageUrl: blCatalog.imageUrl,
        thumbnailUrl: blCatalog.thumbnailUrl,
        categoryId: blCatalog.categoryId,
        cacheId: priceGuideCache.id,
        lastFetched: priceGuideCache.fetchedAt,
      })
      .from(blInventory)
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .leftJoin(
        priceGuideCache,
        and(
          eq(blInventory.itemNo, priceGuideCache.itemNo),
          eq(blInventory.itemType, priceGuideCache.itemType),
          sql`(${blInventory.colorId} = ${priceGuideCache.colorId} OR (${blInventory.colorId} IS NULL AND ${priceGuideCache.colorId} IS NULL))`,
          sql`${blInventory.newOrUsed} = ${priceGuideCache.newOrUsed}`
        )
      )
      .where(quantityFilter)
      .orderBy(
        sql`COALESCE(${priceGuideCache.fetchedAt}, '1970-01-01'::timestamp) ASC`
      )
      .limit(100000);

    // Freshness window from scheduler settings — items not fetched within N days (or never fetched) are candidates
    const FRESHNESS_MS = freshnessDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const filteredItems = inventoryItems.filter((item) => {
      if (!item.lastFetched) return true;
      return now - new Date(item.lastFetched).getTime() >= FRESHNESS_MS;
    });

    // Cap by both the configured batch size AND the actual API calls available right now.
    // Each item uses 2 API calls (sold + stock), so divide available calls by 2.
    const availableApiCalls = Math.max(0, apiCallCeiling - callsLast24h);
    const availableItems = Math.floor(availableApiCalls / 2);
    const cappedMaxItems = Math.min(effectiveMaxItems, availableItems);
    const itemsToProcess = filteredItems.slice(0, cappedMaxItems);

    pomSyncProgress.itemsTotal = itemsToProcess.length;

    console.log(`[Price-o-Matic Sync] Found ${inventoryItems.length} candidates, ${filteredItems.length} stale (>${freshnessDays}d), processing ${itemsToProcess.length} (batch cap: ${effectiveMaxItems}, available API calls: ${availableApiCalls} → ${availableItems} items at 2 calls/item, zeroStockSkip: ${zeroStockSkip})`);

    if (itemsToProcess.length === 0) {
      const reason = filteredItems.length === 0
        ? `All ${inventoryItems.length} inventory items are up-to-date (fetched within last ${freshnessDays} days). Nothing to sync.`
        : availableApiCalls <= 0
          ? `No API calls remaining (${apiCallCeiling}/${apiCallCeiling} used in last 24h). Try again later.`
          : 'No items to process.';
      console.log(`[Price-o-Matic Sync] ${reason}`);
      pomSyncProgress = { active: false, itemsProcessed: 0, itemsTotal: 0, apiCallsAtStart: pomSyncProgress.apiCallsAtStart, itemsNew: 0, itemsRefreshed: 0 };
      return { itemsUpdated: 0, itemsSkipped: 0, apiCallsUsed: 0, stopped: true, stopReason: reason };
    }

    // Process each item — oldest-fetched first.
    // Each item makes 2 BL API calls: stock price guide + sold price guide.
    for (const item of itemsToProcess) {
      try {
        if (pomShutdownRequested) {
          stopped = true;
          stopReason = 'Sync interrupted by server shutdown.';
          console.log(`[Price-o-Matic Sync] ${stopReason}`);
          break;
        }
        if (pomSyncStopRequested) {
          stopped = true;
          stopReason = 'Sync stopped by user request.';
          console.log(`[Price-o-Matic Sync] ${stopReason}`);
          break;
        }

        // Check raw API usage every 10 items against the platform-level ceiling (not the org-level default)
        if (itemsUpdated % 10 === 0) {
          const checkAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const [usageCheck] = await db
            .select({ count: sql<number>`count(*)` })
            .from(blApiCalls)
            .where(and(eq(blApiCalls.orgId, orgId), gte(blApiCalls.timestamp, checkAgo)));
          const currentCalls = Number(usageCheck?.count) || 0;
          
          if (currentCalls + 2 > apiCallCeiling) {
            stopped = true;
            stopReason = `Approaching API limit: ${currentCalls}/${apiCallCeiling} calls (need 2 per item). Stopping at configured ceiling.`;
            console.log(`[Price-o-Matic Sync] ${stopReason}`);
            break;
          }
        }

        // Fetch price data — full sync (2 API calls: sold + stock price guides)
        // Item details are sourced from local blInventory (already synced).
        // Both guides are fetched so suggested price can be computed.
        await fetchPriceOMagicData(
          item.itemNo,
          item.itemType,
          item.colorId || undefined,
          item.newOrUsed,
          undefined,
          undefined,
          false, // fetch both sold + stock (2 API calls per item)
          {
            name: item.itemName,
            imageUrl: item.imageUrl,
            thumbnailUrl: item.thumbnailUrl,
            categoryId: item.categoryId,
          },
          undefined,
          orgId,
          true, // forceRefresh — POM already filtered stale items; always fetch live data
        );

        itemsUpdated++;
        if (item.lastFetched) {
          pomSyncProgress.itemsRefreshed++;
        } else {
          pomSyncProgress.itemsNew++;
        }
        pomSyncProgress.itemsProcessed = itemsUpdated + itemsSkipped;
        
        if ((itemsUpdated + itemsSkipped) % 100 === 0) {
          console.log(`[Price-o-Matic Sync] Progress: ${itemsUpdated + itemsSkipped}/${itemsToProcess.length} items (${pomSyncProgress.itemsNew} new, ${pomSyncProgress.itemsRefreshed} refreshed, ${itemsSkipped} skipped)`);
        }

      } catch (error) {
        console.error(`[Price-o-Matic Sync] Error processing item ${item.itemNo}:`, error);
        itemsSkipped++;
        pomSyncProgress.itemsProcessed = itemsUpdated + itemsSkipped;
        
        // If it's a rate limit error, stop immediately
        if (error instanceof Error && error.message.includes('rate limit')) {
          stopped = true;
          stopReason = error.message;
          break;
        }
      }
    }

    const finalAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [finalUsage] = await db
      .select({ count: sql<number>`count(*)` })
      .from(blApiCalls)
      .where(and(eq(blApiCalls.orgId, orgId), gte(blApiCalls.timestamp, finalAgo)));
    const finalCalls = Number(finalUsage?.count) || 0;
    apiCallsUsed = Math.max(0, finalCalls - pomSyncProgress.apiCallsAtStart);
    console.log(`[Price-o-Matic Sync] Completed: ${pomSyncProgress.itemsNew} new, ${pomSyncProgress.itemsRefreshed} refreshed, ${itemsSkipped} skipped, ${apiCallsUsed} API calls used`);
    pomSyncProgress = { active: false, itemsProcessed: itemsUpdated, itemsTotal: itemsToProcess.length, apiCallsAtStart: pomSyncProgress.apiCallsAtStart, itemsNew: pomSyncProgress.itemsNew, itemsRefreshed: pomSyncProgress.itemsRefreshed };

    return {
      itemsUpdated,
      itemsSkipped,
      apiCallsUsed,
      stopped,
      stopReason,
    };

  } catch (error) {
    console.error('[Price-o-Matic Sync] Fatal error:', error);
    pomSyncProgress = { ...pomSyncProgress, active: false };
    throw error;
  }
}

export async function fetchPriceOMagicData(
  itemNo: string,
  itemType: string,
  colorId?: number,
  newOrUsed: string = 'N',
  _premiumPercentage: number = 15,
  _config: any = null,
  skipStock: boolean = false,
  localItemData?: { name?: string | null; imageUrl?: string | null; thumbnailUrl?: string | null; categoryId?: number | null },
  apiCounter?: { count: number },
  orgId: string = PLATFORM_ORG_ID,
  forceRefresh: boolean = false
): Promise<any> {
  try {
    // POM uses a 6-month cache window — price data doesn't need to be fresher than that for bulk sync.
    // Pass forceRefresh=true (BrickSpotter) to skip the cache and always call the BL API live.
    if (!forceRefresh) {
      const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
      const existingCache = await db
        .select()
        .from(priceGuideCache)
        .where(
          and(
            sql`upper(${priceGuideCache.itemNo}) = upper(${itemNo})`,
            eq(priceGuideCache.itemType, itemType),
            colorId ? eq(priceGuideCache.colorId, colorId) : sql`${priceGuideCache.colorId} IS NULL`,
            eq(priceGuideCache.newOrUsed, newOrUsed),
            gte(priceGuideCache.fetchedAt, sixMonthsAgo)
          )
        )
        .limit(1);
      if (existingCache.length > 0) {
        console.log(`[Price-o-Matic] Using cached data for ${itemType}/${itemNo}${colorId ? `/${colorId}` : ''}/${newOrUsed}`);
        return existingCache[0];
      }
    }

    console.log(`[Price-o-Matic] Fetching fresh data for ${itemType}/${itemNo}${colorId ? `/${colorId}` : ''}/${newOrUsed}`);

    // Convert item type code to BrickLink API format (P -> PART, M -> MINIFIG, etc.)
    // Handle both single-letter codes (P, M, S) and full words (PART, MINIFIG, SET)
    const itemTypeMap: Record<string, string> = {
      'P': 'PART',
      'M': 'MINIFIG', 
      'S': 'SET',
      'B': 'BOOK',
      'G': 'GEAR',
      'C': 'CATALOG',
      'I': 'INSTRUCTION',
      'O': 'ORIGINAL_BOX',
      'U': 'UNSORTED_LOT'
    };
    const upperItemType = itemType.toUpperCase();
    const apiItemType = itemTypeMap[upperItemType] || upperItemType;

    // Fetch item details — skip if local data provided (scheduled sync uses blInventory table)
    const itemDetailsEndpoint = `/items/${apiItemType}/${itemNo}`;
    let itemDetails: any = null;
    if (!localItemData) {
      const { data } = await bricklinkCatalogRequest(itemDetailsEndpoint, undefined, orgId);
      if (apiCounter) apiCounter.count += 1;
      itemDetails = data;
    }

    const stockPriceEndpoint = `/items/${apiItemType}/${itemNo}/price`;

    // Fetch price guide - stock (skipped in score-only sync mode to save API quota)
    let stockPriceData: any = null;
    if (!skipStock) {
      const stockPriceParams: Record<string, string> = { 
        guide_type: 'stock',
        new_or_used: newOrUsed
      };
      if (colorId) {
        stockPriceParams.color_id = colorId.toString();
      }
      const { data } = await bricklinkCatalogRequest(stockPriceEndpoint, stockPriceParams, orgId);
      if (apiCounter) apiCounter.count += 1;
      stockPriceData = data;
    }

    // Fetch price guide - sold (always — needed for opportunity score)
    const soldPriceParams: Record<string, string> = { 
      guide_type: 'sold',
      new_or_used: newOrUsed
    };
    if (colorId) {
      soldPriceParams.color_id = colorId.toString();
    }
    const { data: soldPriceData } = await bricklinkCatalogRequest(stockPriceEndpoint, soldPriceParams, orgId);
    if (apiCounter) apiCounter.count += 1;

    // Parse raw market data from BrickLink API responses
    const stockAvgPrice = (stockPriceData?.avg_price && parseFloat(stockPriceData.avg_price) > 0) ? parseFloat(stockPriceData.avg_price) : null;
    const soldP85Price = computeWeightedPercentile(soldPriceData?.price_detail, 85);
    const soldAvgPrice = soldP85Price ?? (soldPriceData?.avg_price ? parseFloat(soldPriceData.avg_price) : null);

    // When skipStock=true, preserve existing stock data from cache so previous data isn't lost
    let preservedStock: { stockAvgPrice?: string | null; stockMinPrice?: string | null; stockMaxPrice?: string | null; stockQuantity?: number | null; stockTotalLots?: number | null } = {};
    if (skipStock) {
      const existingRec = await db
        .select({
          stockAvgPrice: priceGuideCache.stockAvgPrice,
          stockMinPrice: priceGuideCache.stockMinPrice,
          stockMaxPrice: priceGuideCache.stockMaxPrice,
          stockQuantity: priceGuideCache.stockQuantity,
          stockTotalLots: priceGuideCache.stockTotalLots,
        })
        .from(priceGuideCache)
        .where(
          and(
            sql`upper(${priceGuideCache.itemNo}) = upper(${itemNo})`,
            eq(priceGuideCache.itemType, itemType),
            colorId ? eq(priceGuideCache.colorId, colorId) : sql`${priceGuideCache.colorId} IS NULL`,
            eq(priceGuideCache.newOrUsed, newOrUsed)
          )
        )
        .limit(1);
      if (existingRec.length > 0) preservedStock = existingRec[0];
    }

    // Merge and store data
    const mergedData = {
      itemNo,
      itemType,
      colorId: colorId || null,
      newOrUsed,
      
      // Item details — prefer local blInventory data when provided (saves 1 API call/item)
      itemName: localItemData?.name || itemDetails?.name || null,
      imageUrl: localItemData?.imageUrl || itemDetails?.image_url || null,
      thumbnailUrl: localItemData?.thumbnailUrl || itemDetails?.thumbnail_url || null,
      categoryId: localItemData?.categoryId || itemDetails?.category_id || null,
      weight: itemDetails?.weight ? itemDetails.weight.toString() : null,
      dimensionX: itemDetails?.dim_x ? itemDetails.dim_x.toString() : null,
      dimensionY: itemDetails?.dim_y ? itemDetails.dim_y.toString() : null,
      dimensionZ: itemDetails?.dim_z ? itemDetails.dim_z.toString() : null,
      yearReleased: itemDetails?.year_released || null,
      
      // Stock price guide (preserved from cache when skipStock=true, fetched fresh otherwise)
      stockAvgPrice: skipStock ? (preservedStock.stockAvgPrice ?? null) : (stockAvgPrice?.toString() || null),
      stockMinPrice: skipStock ? (preservedStock.stockMinPrice ?? null) : (stockPriceData?.min_price ? stockPriceData.min_price.toString() : null),
      stockMaxPrice: skipStock ? (preservedStock.stockMaxPrice ?? null) : (stockPriceData?.max_price ? stockPriceData.max_price.toString() : null),
      stockQuantity: skipStock ? (preservedStock.stockQuantity ?? null) : (sumPriceDetailQty(stockPriceData?.price_detail)),
      stockTotalLots: skipStock ? (preservedStock.stockTotalLots ?? null) : (stockPriceData?.unit_quantity || null),
      
      // Sold price guide
      soldAvgPrice: soldAvgPrice?.toString() || null,
      soldMinPrice: soldPriceData?.min_price ? soldPriceData.min_price.toString() : null,
      soldMaxPrice: soldPriceData?.max_price ? soldPriceData.max_price.toString() : null,
      soldQuantity: sumPriceDetailQty(soldPriceData?.price_detail),
      soldTotalLots: soldPriceData?.unit_quantity || null, // Number of lots/listings
    };

    // Delete old cache entry if exists
    // Case-insensitive delete — handles parts like "x161" stored lowercase but looked up as "X161"
    await db
      .delete(priceGuideCache)
      .where(
        and(
          sql`upper(${priceGuideCache.itemNo}) = upper(${itemNo})`,
          eq(priceGuideCache.itemType, itemType),
          colorId ? eq(priceGuideCache.colorId, colorId) : sql`${priceGuideCache.colorId} IS NULL`,
          eq(priceGuideCache.newOrUsed, newOrUsed)
        )
      );

    // Insert new cache entry
    const [insertedData] = await db
      .insert(priceGuideCache)
      .values([mergedData])
      .returning();

    console.log(`[Price-o-Matic] Cached data for ${itemType}/${itemNo}${colorId ? `/${colorId}` : ''}`);

    // Backfill bl_catalog — the SOT for item names, categories, and images.
    // bl_catalog is keyed (itemNo, itemType, colorId). We upsert one row per unique lot colorId
    // so the join in browse/insights queries can find it by exact colorId match.
    // COALESCE in the SET clause ensures we never overwrite a good value with null.
    const catalogItemName = localItemData?.name || itemDetails?.name || null;
    const catalogCategoryId = localItemData?.categoryId || itemDetails?.category_id || null;
    const catalogImageUrl = localItemData?.imageUrl || itemDetails?.image_url || null;
    const catalogThumbnailUrl = localItemData?.thumbnailUrl || itemDetails?.thumbnail_url || null;
    if (catalogItemName || catalogCategoryId) {
      try {
        await db
          .insert(blCatalog)
          .values({
            itemNo,
            itemType: apiItemType,
            colorId: colorId ?? 0,
            itemName: catalogItemName,
            categoryId: catalogCategoryId,
            imageUrl: catalogImageUrl,
            thumbnailUrl: catalogThumbnailUrl,
          })
          .onConflictDoUpdate({
            target: [blCatalog.itemNo, blCatalog.itemType, blCatalog.colorId],
            set: {
              itemName: sql`COALESCE(EXCLUDED.item_name, bl_catalog.item_name)`,
              categoryId: sql`COALESCE(EXCLUDED.category_id, bl_catalog.category_id)`,
              imageUrl: sql`COALESCE(EXCLUDED.image_url, bl_catalog.image_url)`,
              thumbnailUrl: sql`COALESCE(EXCLUDED.thumbnail_url, bl_catalog.thumbnail_url)`,
              updatedAt: new Date(),
            },
          });
      } catch (catalogErr) {
        console.warn(`[Price-o-Matic] bl_catalog upsert failed for ${apiItemType}/${itemNo} (non-fatal):`, catalogErr);
      }
    }

    // Append to price history — pure insert, never overwrites, builds time-series beyond BL's 6-month cap
    try {
      const today = new Date().toISOString().split('T')[0];
      const PERCENTILES = [10, 25, 50, 75, 85, 95] as const;
      const soldPct = computePercentiles(soldPriceData?.price_detail, [...PERCENTILES]);
      const stockPct = !skipStock ? computePercentiles(stockPriceData?.price_detail, [...PERCENTILES]) : {} as Record<number, number | null>;
      const p = (map: Record<number, number | null>, n: number) => map[n]?.toString() ?? null;

      await db.insert(partPriceHistory).values({
        itemNo,
        itemType,
        colorId: colorId || null,
        newOrUsed,
        snapshotDate: today,

        stockAvgPrice: (!skipStock && stockPriceData?.avg_price) ? stockPriceData.avg_price.toString() : null,
        stockMinPrice: (!skipStock && stockPriceData?.min_price) ? stockPriceData.min_price.toString() : null,
        stockMaxPrice: (!skipStock && stockPriceData?.max_price) ? stockPriceData.max_price.toString() : null,
        stockUnitQty:  (!skipStock && stockPriceData?.unit_quantity) ? parseInt(stockPriceData.unit_quantity.toString()) : null,
        stockTotalLots:(!skipStock && stockPriceData?.total_lots)    ? parseInt(stockPriceData.total_lots.toString())    : null,
        stockQtyAvg:   (!skipStock && stockPriceData?.qty_avg)       ? parseInt(stockPriceData.qty_avg.toString())       : null,
        stockP10: p(stockPct, 10), stockP25: p(stockPct, 25), stockP50: p(stockPct, 50),
        stockP75: p(stockPct, 75), stockP85: p(stockPct, 85), stockP95: p(stockPct, 95),

        soldAvgPrice: soldPriceData?.avg_price ? soldPriceData.avg_price.toString() : null,
        soldMinPrice: soldPriceData?.min_price  ? soldPriceData.min_price.toString()  : null,
        soldMaxPrice: soldPriceData?.max_price  ? soldPriceData.max_price.toString()  : null,
        soldUnitQty:  soldPriceData?.unit_quantity ? parseInt(soldPriceData.unit_quantity.toString()) : null,
        soldTotalLots:soldPriceData?.total_lots   ? parseInt(soldPriceData.total_lots.toString())   : null,
        soldQtyAvg:   soldPriceData?.qty_avg      ? parseInt(soldPriceData.qty_avg.toString())      : null,
        soldP10: p(soldPct, 10), soldP25: p(soldPct, 25), soldP50: p(soldPct, 50),
        soldP75: p(soldPct, 75), soldP85: p(soldPct, 85), soldP95: p(soldPct, 95),
      });
    } catch (histErr) {
      console.warn(`[Price-o-Matic] History snapshot failed for ${itemType}/${itemNo} (non-fatal):`, histErr);
    }

    // Store the official BrickLink catalog weight and dimensions in bl_inventory (not my_weight, which is user's own field)
    if (itemDetails?.weight || itemDetails?.dim_x || itemDetails?.dim_y || itemDetails?.dim_z) {
      try {
        const inventoryQuery = colorId 
          ? and(
              eq(blInventory.itemNo, itemNo),
              eq(blInventory.itemType, itemType),
              eq(blInventory.colorId, colorId)
            )
          : and(
              eq(blInventory.itemNo, itemNo),
              eq(blInventory.itemType, itemType)
            );

        const catalogUpdates: Record<string, any> = {};
        if (itemDetails.weight) catalogUpdates.blCatalogWeight = itemDetails.weight.toString();
        if (itemDetails.dim_x) catalogUpdates.blDimensionX = itemDetails.dim_x.toString();
        if (itemDetails.dim_y) catalogUpdates.blDimensionY = itemDetails.dim_y.toString();
        if (itemDetails.dim_z) catalogUpdates.blDimensionZ = itemDetails.dim_z.toString();

        if (Object.keys(catalogUpdates).length > 0) {
          // Dual-write: update bl_inventory (legacy) and bl_catalog (new)
          await db.update(blInventory).set(catalogUpdates).where(inventoryQuery);

          const catalogRow: Record<string, any> = {
            itemNo,
            itemType,
            colorId: colorId ?? 0,
          };
          if (itemDetails.weight) catalogRow.blCatalogWeight = itemDetails.weight.toString();
          if (itemDetails.dim_x) catalogRow.blDimensionX = itemDetails.dim_x.toString();
          if (itemDetails.dim_y) catalogRow.blDimensionY = itemDetails.dim_y.toString();
          if (itemDetails.dim_z) catalogRow.blDimensionZ = itemDetails.dim_z.toString();
          catalogRow.updatedAt = new Date();

          await db.insert(blCatalog).values(catalogRow as any).onConflictDoUpdate({
            target: [blCatalog.itemNo, blCatalog.itemType, blCatalog.colorId],
            set: {
              blCatalogWeight: sql`COALESCE(EXCLUDED.bl_catalog_weight, bl_catalog.bl_catalog_weight)`,
              blDimensionX: sql`COALESCE(EXCLUDED.bl_dimension_x, bl_catalog.bl_dimension_x)`,
              blDimensionY: sql`COALESCE(EXCLUDED.bl_dimension_y, bl_catalog.bl_dimension_y)`,
              blDimensionZ: sql`COALESCE(EXCLUDED.bl_dimension_z, bl_catalog.bl_dimension_z)`,
              updatedAt: sql`NOW()`,
            },
          });
        }

        console.log(`[Price-o-Matic] Stored catalog data for ${itemType}/${itemNo}${colorId ? `/${colorId}` : ''}: ${itemDetails.weight}g, dims: ${itemDetails.dim_x}×${itemDetails.dim_y}×${itemDetails.dim_z}mm`);
      } catch (error) {
        console.error('[Price-o-Matic] Error storing catalog data:', error);
        // Don't throw - this is a nice-to-have feature
      }
    }

    // Write BL catalog thumbnail to bl_catalog
    // Only fill if currently null (Rebrickable images have priority)
    if (itemDetails?.thumbnail_url) {
      try {
        const rawThumb = itemDetails.thumbnail_url as string;
        const thumbUrl = rawThumb.startsWith('//') ? `https:${rawThumb}` : rawThumb;
        await db.insert(blCatalog).values({
          itemNo,
          itemType,
          colorId: colorId ?? 0,
          imageUrl: thumbUrl,
          thumbnailUrl: thumbUrl,
        }).onConflictDoUpdate({
          target: [blCatalog.itemNo, blCatalog.itemType, blCatalog.colorId],
          set: {
            imageUrl: sql`COALESCE(bl_catalog.image_url, EXCLUDED.image_url)`,
            thumbnailUrl: sql`COALESCE(bl_catalog.thumbnail_url, EXCLUDED.thumbnail_url)`,
            updatedAt: sql`NOW()`,
          },
        });
      } catch (error) {
        console.error('[Price-o-Matic] Error updating inventory image:', error);
      }
    }
    
    return insertedData;
  } catch (error) {
    console.error('[Price-o-Matic] Error fetching data:', error);
    throw error;
  }
}

// Search BrickLink catalog for an item with pricing data
export async function searchBricklinkCatalogItem(
  itemNo: string,
  itemType: string = 'PART',
  orgId: string = PLATFORM_ORG_ID
): Promise<any> {
  try {
    console.log(`[BrickLink Catalog Search] Searching for ${itemType}/${itemNo}`);
    
    // Fetch item details from catalog
    const { data: itemDetails } = await bricklinkCatalogRequest(`/items/${itemType}/${itemNo}`, undefined, orgId);
    
    if (!itemDetails) {
      throw new Error('Item not found in BrickLink catalog');
    }

    // Fetch price guide data - stock
    const stockPriceParams: Record<string, string> = { guide_type: 'stock', new_or_used: 'N' };
    const stockPriceEndpoint = `/items/${itemType}/${itemNo}/price`;
    const { data: stockPriceData } = await bricklinkCatalogRequest(stockPriceEndpoint, stockPriceParams, orgId);

    // Fetch price guide data - sold
    const soldPriceParams: Record<string, string> = { guide_type: 'sold', new_or_used: 'N' };
    const { data: soldPriceData } = await bricklinkCatalogRequest(stockPriceEndpoint, soldPriceParams, orgId);

    // Calculate suggested price with supply adjustment
    const stockAvgPrice = (stockPriceData?.avg_price && parseFloat(stockPriceData.avg_price) > 0) ? parseFloat(stockPriceData.avg_price) : null;
    const soldAvgPrice = soldPriceData?.avg_price ? parseFloat(soldPriceData.avg_price) : null;
    const stockTotalLots = stockPriceData?.unit_quantity ? parseInt(stockPriceData.unit_quantity.toString()) : 0; // Number of lots/listings available
    const suggestedPrice = calculateSuggestedPriceWithSupply(stockAvgPrice, soldAvgPrice, stockTotalLots);

    return {
      itemNo: itemDetails.no,
      itemName: itemDetails.name,
      itemType: itemDetails.type,
      categoryId: itemDetails.category_id,
      imageUrl: itemDetails.image_url,
      thumbnailUrl: itemDetails.thumbnail_url,
      weight: itemDetails.weight,
      dimensionX: itemDetails.dim_x,
      dimensionY: itemDetails.dim_y,
      dimensionZ: itemDetails.dim_z,
      yearReleased: itemDetails.year_released,
      // Pricing data
      stockAvgPrice: stockAvgPrice?.toString() || null,
      stockMinPrice: stockPriceData?.min_price ? stockPriceData.min_price.toString() : null,
      stockMaxPrice: stockPriceData?.max_price ? stockPriceData.max_price.toString() : null,
      stockTotalLots, // Already correctly calculated above using unit_quantity
      soldAvgPrice: soldAvgPrice?.toString() || null,
      soldMinPrice: soldPriceData?.min_price ? soldPriceData.min_price.toString() : null,
      soldMaxPrice: soldPriceData?.max_price ? soldPriceData.max_price.toString() : null,
      soldTotalLots: soldPriceData?.unit_quantity ? parseInt(soldPriceData.unit_quantity.toString()) : 0, // Number of sold lots
      suggestedPrice: suggestedPrice.toString(),
    };
  } catch (error) {
    console.error('[BrickLink Catalog Search] Error:', error);
    throw error;
  }
}

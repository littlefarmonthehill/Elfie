import { db } from "../db";
import { blCategories, blColors, blInventory, blApiCalls, appSettings, priceGuideCache, setPartRelationships } from "@shared/schema";
import { eq, gte, sql, inArray, and, gt } from "drizzle-orm";
import OAuth from "oauth-1.0a";
import crypto from "crypto";
import { syncRebrickableSetParts } from "./rebrickable";
import { scheduleImageFetchForNewItems } from "./rebrickable-images";
import { syncLock } from "./sync-lock";
import { batchEmbedInventory, batchEmbedSets } from "./embeddings";
import { syncBrickLinkToBrickOwl } from "./brickowl";
import { saveXMLBackup } from "./export";

export interface BricklinkSyncResult {
  categoriesAdded: number;
  categoriesUpdated: number;
  colorsAdded: number;
  colorsUpdated: number;
  inventoryAdded: number;
  inventoryUpdated: number;
  totalApiCalls: number;
  rateLimitWarning?: string;
  rebrickableSets?: number;
  rebrickableParts?: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  callsLast24h: number;
  warning?: string;
  blocked?: boolean;
}

// Clean token values - remove any non-alphanumeric characters that may have been added
const cleanToken = (value: string) => value.replace(/[^A-Z0-9]/gi, '');

// Check rate limit status for the last 24 hours
export async function checkRateLimit(): Promise<RateLimitStatus> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const recentCalls = await db
    .select({ count: sql<number>`count(*)` })
    .from(blApiCalls)
    .where(gte(blApiCalls.timestamp, twentyFourHoursAgo));
  
  const callsLast24h = Number(recentCalls[0]?.count) || 0;
  
  // Block at 4500 calls to preserve quota for Price-o-Matic
  if (callsLast24h >= 4500) {
    return {
      allowed: false,
      callsLast24h,
      blocked: true,
      warning: `API limit reached: ${callsLast24h}/5000 calls in 24 hours. Please wait before syncing again.`,
    };
  }
  
  // Warn at 2500 calls
  if (callsLast24h >= 2500) {
    return {
      allowed: true,
      callsLast24h,
      warning: `API usage warning: ${callsLast24h}/5000 calls in 24 hours. Approaching rate limit.`,
    };
  }
  
  return {
    allowed: true,
    callsLast24h,
  };
}

// Track an API call
async function trackApiCall(endpoint: string, success: boolean = true): Promise<void> {
  await db.insert(blApiCalls).values({
    endpoint,
    success,
  });
}

// Make a BrickLink API request with rate limiting (GET)
export async function bricklinkRequest(endpoint: string, queryParams?: Record<string, string>): Promise<{ data: any; apiCalls: number }> {
  // Get credentials from database settings (with fallback to env vars)
  const [settings] = await db.select().from(appSettings).limit(1);
  
  const consumerKey = settings?.bricklinkConsumerKey || process.env.BRICKLINK_CONSUMER_KEY || '';
  const consumerSecret = settings?.bricklinkConsumerSecret || process.env.BRICKLINK_CONSUMER_SECRET || '';
  const tokenValue = settings?.bricklinkTokenValue || process.env.BRICKLINK_TOKEN_VALUE || '';
  const tokenSecret = settings?.bricklinkTokenSecret || process.env.BRICKLINK_TOKEN_SECRET || '';
  
  if (!consumerKey || !consumerSecret || !tokenValue || !tokenSecret) {
    throw new Error('BrickLink credentials not configured. Please add them in Settings.');
  }

  // Check rate limit before making request
  const rateLimit = await checkRateLimit();
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
  if (queryParams) {
    const params = new URLSearchParams(queryParams);
    url = `${url}?${params.toString()}`;
  }
  
  // For GET requests, query params must be in the URL, not the data field
  const requestData = { url, method: 'GET' };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));
  
  console.log(`[OAuth Debug] Request URL: ${url}`);
  console.log(`[OAuth Debug] Auth Header:`, authHeader);
  console.log(`[OAuth Debug] Consumer Key: ${process.env.BRICKLINK_CONSUMER_KEY?.substring(0, 10)}...`);
  console.log(`[OAuth Debug] Token Value: ${process.env.BRICKLINK_TOKEN_VALUE?.substring(0, 10)}...`);
  
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
    await trackApiCall(endpoint, success);
  }
}

// Make a BrickLink API PUT request (for updating inventory)
async function bricklinkPutRequest(endpoint: string, body: any): Promise<{ data: any; apiCalls: number }> {
  // Get credentials from database settings (with fallback to env vars)
  const [settings] = await db.select().from(appSettings).limit(1);
  
  const consumerKey = settings?.bricklinkConsumerKey || process.env.BRICKLINK_CONSUMER_KEY || '';
  const consumerSecret = settings?.bricklinkConsumerSecret || process.env.BRICKLINK_CONSUMER_SECRET || '';
  const tokenValue = settings?.bricklinkTokenValue || process.env.BRICKLINK_TOKEN_VALUE || '';
  const tokenSecret = settings?.bricklinkTokenSecret || process.env.BRICKLINK_TOKEN_SECRET || '';
  
  if (!consumerKey || !consumerSecret || !tokenValue || !tokenSecret) {
    throw new Error('BrickLink credentials not configured. Please add them in Settings.');
  }

  // Check rate limit before making request
  const rateLimit = await checkRateLimit();
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
    await trackApiCall(endpoint, success);
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
  delta: number
): Promise<{ success: boolean; error?: string }> {
  try {
    if (delta === 0) return { success: true };
    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
    console.log(`Adjusting BrickLink inventory ${inventoryId} by ${deltaStr}...`);
    
    await bricklinkPutRequest(`/inventories/${inventoryId}`, {
      quantity: deltaStr,
    });
    
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
  updates: Record<string, any>
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`Updating BrickLink inventory ${inventoryId} with:`, updates);
    
    await bricklinkPutRequest(`/inventories/${inventoryId}`, updates);
    
    console.log(`✓ BrickLink: Updated inventory ${inventoryId}`);
    return { success: true };
  } catch (error: any) {
    console.error(`✗ BrickLink update failed for inventory ${inventoryId}:`, error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

export async function syncBricklinkCategories(): Promise<{ added: number; updated: number; apiCalls: number }> {
  try {
    const { data: responseData, apiCalls } = await bricklinkRequest('/categories');
    
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

export async function syncBricklinkColors(): Promise<{ added: number; updated: number; apiCalls: number }> {
  try {
    const { data: responseData, apiCalls } = await bricklinkRequest('/colors');
    
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

export async function syncBricklinkInventory(): Promise<{ added: number; updated: number; apiCalls: number }> {
  try {
    const { syncProgressTracker } = await import('./sync-progress');
    syncProgressTracker.start();
    
    console.log('📥 Downloading all inventory data from BrickLink API...');
    syncProgressTracker.update('Downloading inventory from BrickLink...', 10);
    
    // Fetch all inventory without status filters - BrickLink will return everything
    const { data: responseData, apiCalls } = await bricklinkRequest('/inventories');
    
    const items = Array.isArray(responseData) ? responseData : [];
    console.log(`✓ Downloaded ${items.length} items from BrickLink`);
    syncProgressTracker.update(`Downloaded ${items.length} items from BrickLink`, 25, { itemsDownloaded: items.length });
    
    if (items.length === 0) {
      console.log('No inventory items received from BrickLink');
      return { added: 0, updated: 0, apiCalls };
    }

    console.log(`First item sample:`, JSON.stringify(items[0]).substring(0, 200));
    
    // Get all existing inventory IDs in one query for comparison
    const existingItems = await db.select({ id: blInventory.id }).from(blInventory);
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
          itemName: item.item.name || null,
          itemType: item.item.type,
          colorId: item.color_id || 0,
          colorName: item.color_name || null,
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
          categoryId: item.item.category_id || 0,
          dateCreated: item.date_created ? new Date(item.date_created) : null,
          saleRate: item.sale_rate || null,
          tierPrice1: item.tier_price1 || null,
          tierPrice2: item.tier_price2 || null,
          tierPrice3: item.tier_price3 || null,
          tierQuantity1: item.tier_quantity1 || null,
          tierQuantity2: item.tier_quantity2 || null,
          tierQuantity3: item.tier_quantity3 || null,
          myWeight: item.my_weight || null,
        }));
        
        await db.insert(blInventory).values(values);
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
      if (newPartItems.length > 0) {
        scheduleImageFetchForNewItems(newPartItems);
      }
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
          .where(inArray(blInventory.id, batchIds));
        
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
          existing.itemName !== (item.item.name || null) ||
          existing.itemType !== item.item.type ||
          existing.colorId !== (item.color_id || 0) ||
          existing.newOrUsed !== item.new_or_used ||
          existing.categoryId !== (item.item.category_id || 0) ||
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
              itemName: item.item.name || null,
              itemType: item.item.type,
              colorId: item.color_id || 0,
              colorName: item.color_name || null,
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
              categoryId: item.item.category_id || 0,
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
            .where(eq(blInventory.id, Number(item.inventory_id)));
          updated++;
        }
        
        const updateProgress = 85 + Math.round(((i + batch.length) / itemsToUpdate.length) * 10); // 85-95%
        syncProgressTracker.update(`Updated ${updated}/${itemsToUpdate.length} items`, updateProgress, { itemsUpdated: updated });
        console.log(`Updated batch ${Math.floor(i / BATCH_SIZE) + 1}: ${updated}/${itemsToUpdate.length} items`);
      }
    }

    console.log(`BrickLink inventory sync complete: ${added} added, ${updated} updated`);
    syncProgressTracker.complete(added, updated);
    return { added, updated, apiCalls };
  } catch (error) {
    console.error('Error syncing BrickLink inventory:', error);
    const { syncProgressTracker } = await import('./sync-progress');
    syncProgressTracker.error(error instanceof Error ? error.message : 'Sync failed');
    throw error;
  }
}

// OLD VERSION WITH STATUS FILTERS - KEPT FOR REFERENCE
async function syncBricklinkInventoryByStatus(): Promise<{ added: number; updated: number; apiCalls: number }> {
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
        const { data: responseData, apiCalls } = await bricklinkRequest('/inventories', { status });
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
              categoryId: item.item.category_id || 0,
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

export async function syncBricklinkData(options?: { 
  includePlatformSync?: boolean 
}): Promise<BricklinkSyncResult> {
  const { includePlatformSync = false } = options || {};
  
  // Acquire inventory sync lock to prevent order sync conflicts
  const lockAcquired = await syncLock.acquireInventoryLock();
  if (!lockAcquired) {
    throw new Error('Inventory sync already in progress');
  }

  try {
    // Check rate limit before starting sync
    const rateLimit = await checkRateLimit();
    
    console.log('\n🔄 Starting comprehensive inventory sync...');
    
    // Step 1: Sync in order: categories, colors, inventory
    console.log('📦 Step 1/5: Syncing BrickLink data...');
    const categoriesResult = await syncBricklinkCategories();
    const colorsResult = await syncBricklinkColors();
    const inventoryResult = await syncBricklinkInventory();
    
    // Step 2: Sync Rebrickable set-part relationships (doesn't use BrickLink API)
    console.log('🧩 Step 2/5: Syncing Rebrickable set-part relationships...');
    let rebrickableResult = { setsAdded: 0, partsProcessed: 0 };
    try {
      rebrickableResult = await syncRebrickableSetParts();
      console.log(`✓ Rebrickable sync complete: ${rebrickableResult.setsAdded} sets, ${rebrickableResult.partsProcessed} part relationships`);
    } catch (error) {
      console.error('✗ Rebrickable sync failed (non-fatal):', error);
    }

    // Step 3: Schedule embedding generation in background
    console.log('🧠 Step 3/5: Scheduling AI embeddings (background)...');
    try {
      const { createEmbeddingJob } = await import('./embedding-worker');
      await createEmbeddingJob('inventory', 'bricklink_sync');
      console.log('✓ Inventory embedding job scheduled');
    } catch (error) {
      console.error('✗ Failed to schedule inventory embeddings (non-fatal):', error);
    }

    // Step 4: Schedule set embeddings in background (if Rebrickable sync was successful)
    console.log('🎯 Step 4/5: Scheduling set embeddings (background)...');
    if (rebrickableResult.setsAdded > 0 || rebrickableResult.partsProcessed > 0) {
      try {
        const { createEmbeddingJob } = await import('./embedding-worker');
        await createEmbeddingJob('sets', 'bricklink_sync');
        console.log('✓ Set embedding job scheduled');
      } catch (error) {
        console.error('✗ Failed to schedule set embeddings (non-fatal):', error);
      }
    }

    // Step 5: Sync Rebrickable images for items without images
    console.log('🖼️  Step 5/6: Syncing Rebrickable images...');
    try {
      const [settings] = await db.select().from(appSettings).limit(1);
      if (settings?.rebrickableImageSyncEnabled) {
        const { syncRebrickableImages } = await import('./rebrickable-images');
        const imageResult = await syncRebrickableImages();
        console.log(`✓ Rebrickable images: ${imageResult.imagesFetched} fetched, ${imageResult.errors} errors`);
      } else {
        console.log('⏭️ Rebrickable image sync disabled in settings');
      }
    } catch (error) {
      console.error('✗ Rebrickable image sync failed (non-fatal):', error);
    }

    // Step 6: Sync inventory to all sales platforms (currently BrickOwl)
    // Only run if includePlatformSync is true (used by automated sync, not manual sync)
    if (includePlatformSync) {
      console.log('🌐 Step 6/7: Syncing inventory to sales platforms...');
      try {
        // Only sync if BrickOwl credentials are configured
        const [settings] = await db.select().from(appSettings).limit(1);
        if (settings?.brickowlApiKey) {
          console.log('Syncing to BrickOwl...');
          const syncResult = await syncBrickLinkToBrickOwl(100); // Limit to 100 items per sync
          console.log(`✓ BrickOwl sync: ${syncResult.lotsCreated} created, ${syncResult.lotsUpdated} updated, ${syncResult.lotsSkipped} skipped`);
        } else {
          console.log('⏭️ BrickOwl credentials not configured, skipping platform sync');
        }
      } catch (error) {
        console.error('✗ Platform sync failed (non-fatal):', error);
      }
    } else {
      console.log('⏭️ Step 6/7: Platform sync skipped (use automated sync or manual platform sync)');
    }

    const totalApiCalls = categoriesResult.apiCalls + colorsResult.apiCalls + inventoryResult.apiCalls;

    console.log('\n✅ Comprehensive inventory sync complete!');

    // Step 7: Automatically save XML backup for manual restore
    try {
      const backupFilename = await saveXMLBackup();
      console.log(`💾 XML backup saved: ${backupFilename}`);
    } catch (error) {
      console.error('✗ XML backup failed (non-fatal):', error);
    }

    return {
      categoriesAdded: categoriesResult.added,
      categoriesUpdated: categoriesResult.updated,
      colorsAdded: colorsResult.added,
      colorsUpdated: colorsResult.updated,
      inventoryAdded: inventoryResult.added,
      inventoryUpdated: inventoryResult.updated,
      totalApiCalls,
      rateLimitWarning: rateLimit.warning,
      rebrickableSets: rebrickableResult.setsAdded,
      rebrickableParts: rebrickableResult.partsProcessed,
    };
  } finally {
    // Always release the lock, even if sync fails
    syncLock.releaseInventoryLock();
  }
}

// ====== PRICE-O-MAGIC FUNCTIONS ======

// Make a BrickLink Catalog API request (different base URL)
async function bricklinkCatalogRequest(endpoint: string, queryParams?: Record<string, string>): Promise<{ data: any; apiCalls: number }> {
  const [settings] = await db.select().from(appSettings).limit(1);
  
  console.log('[Price-o-Matic Debug] Settings loaded:', {
    hasSettings: !!settings,
    consumerKey: settings?.bricklinkConsumerKey ? 'present' : 'missing',
    consumerSecret: settings?.bricklinkConsumerSecret ? 'present' : 'missing',
    tokenValue: settings?.bricklinkTokenValue ? 'present' : 'missing',
    tokenSecret: settings?.bricklinkTokenSecret ? 'present' : 'missing',
  });
  
  const consumerKey = settings?.bricklinkConsumerKey || process.env.BRICKLINK_CONSUMER_KEY || '';
  const consumerSecret = settings?.bricklinkConsumerSecret || process.env.BRICKLINK_CONSUMER_SECRET || '';
  const tokenValue = settings?.bricklinkTokenValue || process.env.BRICKLINK_TOKEN_VALUE || '';
  const tokenSecret = settings?.bricklinkTokenSecret || process.env.BRICKLINK_TOKEN_SECRET || '';
  
  if (!consumerKey || !consumerSecret || !tokenValue || !tokenSecret) {
    console.error('[Price-o-Matic Debug] Missing credentials:', {
      consumerKey: consumerKey ? 'present' : 'MISSING',
      consumerSecret: consumerSecret ? 'present' : 'MISSING',
      tokenValue: tokenValue ? 'present' : 'MISSING',
      tokenSecret: tokenSecret ? 'present' : 'MISSING',
    });
    throw new Error('BrickLink credentials not configured. Please add them in Settings.');
  }

  // Check rate limit
  const rateLimit = await checkRateLimit();
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
  if (queryParams) {
    const params = new URLSearchParams(queryParams);
    url = `${url}?${params.toString()}`;
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
    await trackApiCall(endpoint, success);
  }
}

// Calculate Price-O-Matic suggested price with premium
function calculateSuggestedPrice(
  stockAvgPrice: number | null,
  soldAvgPrice: number | null,
  premiumPercentage: number = 15
): number {
  // Use stock average as base, fall back to sold average
  const basePrice = stockAvgPrice || soldAvgPrice || 0;
  
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
};

export async function getPomFormulaConfig(): Promise<PomFormulaConfig> {
  try {
    const [settings] = await db.select().from(appSettings).limit(1);
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
  stockTotalLots: number = 0,
  basePremiumPercentage: number = 10,
  itemType: string = 'PART',
  config: PomFormulaConfig = POM_FORMULA_DEFAULTS
): number {
  const basePrice = stockAvgPrice || soldAvgPrice || 0;
  
  if (basePrice === 0) {
    return 0;
  }
  
  // Use minifig-specific base premium if applicable
  let totalPremium = (itemType === 'MINIFIG' || itemType === 'M')
    ? config.minifigPremium
    : config.basePremium;
  
  // Apply scarcity bonus tiers
  if (stockTotalLots < config.scarcityThreshold1) {
    totalPremium += config.scarcityBonus1;
  } else if (stockTotalLots < config.scarcityThreshold2) {
    totalPremium += config.scarcityBonus2;
  } else if (stockTotalLots < config.scarcityThreshold3) {
    totalPremium += config.scarcityBonus3;
  }
  
  const suggestedPrice = basePrice * (1 + totalPremium / 100);
  return Number(suggestedPrice.toFixed(2));
}

// Fetch and cache Price-o-Matic data for an item
// Sync Price-o-Matic data for up to N inventory items (default from settings)
export async function syncPriceOMagicCache(maxItems?: number): Promise<{
  itemsUpdated: number;
  itemsSkipped: number;
  apiCallsUsed: number;
  stopped: boolean;
  stopReason?: string;
}> {
  // Load settings-based config at sync start
  const pomConfig = await getPomFormulaConfig();
  const [pomSettings] = await db.select({
    pomBatchSize: appSettings.pomBatchSize,
    pomApiCallLimit: appSettings.pomApiCallLimit,
  }).from(appSettings).limit(1);

  const effectiveMaxItems = maxItems ?? pomSettings?.pomBatchSize ?? 1500;
  const apiCallCeiling = pomSettings?.pomApiCallLimit ?? 4500;

  console.log(`[Price-o-Matic Sync] Starting sync for up to ${effectiveMaxItems} items (API ceiling: ${apiCallCeiling})`);
  
  let itemsUpdated = 0;
  let itemsSkipped = 0;
  let apiCallsUsed = 0;
  let stopped = false;
  let stopReason: string | undefined;

  try {
    // Get initial rate limit status
    const initialRateLimit = await checkRateLimit();
    if (!initialRateLimit.allowed) {
      return {
        itemsUpdated: 0,
        itemsSkipped: 0,
        apiCallsUsed: 0,
        stopped: true,
        stopReason: initialRateLimit.warning || 'API rate limit exceeded',
      };
    }

    // Load tier refresh settings
    const [tierSettings] = await db.select({
      pomTier1RefreshDays: appSettings.pomTier1RefreshDays,
      pomTier2RefreshDays: appSettings.pomTier2RefreshDays,
      pomTier3RefreshDays: appSettings.pomTier3RefreshDays,
      pomTier4RefreshDays: appSettings.pomTier4RefreshDays,
      pomQtyPromoteThreshold: appSettings.pomQtyPromoteThreshold,
      pomQtyDemoteThreshold: appSettings.pomQtyDemoteThreshold,
    }).from(appSettings).limit(1);

    const tier1Days = tierSettings?.pomTier1RefreshDays ?? 1;
    const tier2Days = tierSettings?.pomTier2RefreshDays ?? 3;
    const tier3Days = tierSettings?.pomTier3RefreshDays ?? 7;
    const tier4Days = tierSettings?.pomTier4RefreshDays ?? 30;
    const qtyPromote = tierSettings?.pomQtyPromoteThreshold ?? 5;
    const qtyDemote = tierSettings?.pomQtyDemoteThreshold ?? 500;

    // Build tier-priority-ordered queue with quantity overrides
    // Tier ordering: 1 (daily) → 2 (every few days) → 3 (weekly) → 4 (monthly)
    // Quantity overrides: stock ≤ qtyPromote → promote 1 tier; stock ≥ qtyDemote → demote 1 tier
    // Only include items whose cache is stale relative to their effective tier's refresh period
    const inventoryItems = await db
      .select({
        id: blInventory.id,
        itemNo: blInventory.itemNo,
        itemType: blInventory.itemType,
        colorId: blInventory.colorId,
        newOrUsed: blInventory.newOrUsed,
        quantity: blInventory.quantity,
        categoryTier: blCategories.priorityTier,
        cacheId: priceGuideCache.id,
        lastFetched: priceGuideCache.fetchedAt,
      })
      .from(blInventory)
      .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
      .leftJoin(
        priceGuideCache,
        and(
          eq(blInventory.itemNo, priceGuideCache.itemNo),
          eq(blInventory.itemType, priceGuideCache.itemType),
          sql`(${blInventory.colorId} = ${priceGuideCache.colorId} OR (${blInventory.colorId} IS NULL AND ${priceGuideCache.colorId} IS NULL))`,
          sql`${blInventory.newOrUsed} = ${priceGuideCache.newOrUsed}`
        )
      )
      .where(gt(blInventory.quantity, 0))
      .orderBy(
        // Sort by effective tier priority (tier1 first), then staleness within each tier
        sql`
          CASE
            WHEN COALESCE(${blInventory.quantity}, 0) <= ${qtyPromote} THEN
              GREATEST(1, (CASE COALESCE(${blCategories.priorityTier}, 'tier2')
                WHEN 'tier1' THEN 1 WHEN 'tier2' THEN 1 WHEN 'tier3' THEN 2 WHEN 'tier4' THEN 3
                ELSE 1 END))
            WHEN COALESCE(${blInventory.quantity}, 0) >= ${qtyDemote} THEN
              LEAST(4, (CASE COALESCE(${blCategories.priorityTier}, 'tier2')
                WHEN 'tier1' THEN 2 WHEN 'tier2' THEN 3 WHEN 'tier3' THEN 4 WHEN 'tier4' THEN 4
                ELSE 3 END))
            ELSE
              (CASE COALESCE(${blCategories.priorityTier}, 'tier2')
                WHEN 'tier1' THEN 1 WHEN 'tier2' THEN 2 WHEN 'tier3' THEN 3 WHEN 'tier4' THEN 4
                ELSE 2 END)
          END ASC,
          COALESCE(${priceGuideCache.fetchedAt}, '1970-01-01'::timestamp) ASC
        `
      )
      .limit(100000); // Fetch all candidates — JS filter + slice enforces the real batch limit below

    // Filter out items that don't need refresh yet based on their effective tier
    const tierRefreshMs: Record<string, number> = {
      tier1: tier1Days * 86400000,
      tier2: tier2Days * 86400000,
      tier3: tier3Days * 86400000,
      tier4: tier4Days * 86400000,
    };
    const now = Date.now();
    const filteredItems = inventoryItems.filter((item) => {
      if (!item.lastFetched) return true; // Never fetched — always include
      const baseTier = item.categoryTier || 'tier2';
      const qty = item.quantity ?? 0;
      let effectiveTier = baseTier;
      if (qty <= qtyPromote) {
        const tierNum = parseInt(baseTier.replace('tier', '')) || 2;
        effectiveTier = `tier${Math.max(1, tierNum - 1)}`;
      } else if (qty >= qtyDemote) {
        const tierNum = parseInt(baseTier.replace('tier', '')) || 2;
        effectiveTier = `tier${Math.min(4, tierNum + 1)}`;
      }
      const refreshMs = tierRefreshMs[effectiveTier] ?? tierRefreshMs.tier2;
      return now - new Date(item.lastFetched).getTime() >= refreshMs;
    });

    // Apply batch size limit AFTER stale filtering so T1 freshness never blocks T2–T4 stale items
    const itemsToProcess = filteredItems.slice(0, effectiveMaxItems);

    console.log(`[Price-o-Matic Sync] Found ${inventoryItems.length} candidates, ${filteredItems.length} stale (${filteredItems.length - itemsToProcess.length} deferred to next run), processing ${itemsToProcess.length}`);

    // Process each item in tier-priority order
    for (const item of itemsToProcess) {
      try {
        // Check rate limit before each batch (every 10 items) to avoid hitting hard limit
        if (itemsUpdated % 10 === 0) {
          const currentRateLimit = await checkRateLimit();
          
          // Stop at configured ceiling to preserve quota
          if (currentRateLimit.callsLast24h >= apiCallCeiling) {
            stopped = true;
            stopReason = `Approaching API limit: ${currentRateLimit.callsLast24h}/5000 calls. Stopping at configured ceiling of ${apiCallCeiling}.`;
            console.log(`[Price-o-Matic Sync] ${stopReason}`);
            break;
          }
        }

        // Fetch price data (uses 3 API calls per item)
        await fetchPriceOMagicData(
          item.itemNo,
          item.itemType,
          item.colorId || undefined,
          item.newOrUsed,
          pomConfig.basePremium,
          pomConfig
        );

        itemsUpdated++;
        apiCallsUsed += 3; // Track approximate API usage
        
        // Log progress every 100 items
        if (itemsUpdated % 100 === 0) {
          console.log(`[Price-o-Matic Sync] Progress: ${itemsUpdated}/${inventoryItems.length} items updated`);
        }

      } catch (error) {
        console.error(`[Price-o-Matic Sync] Error processing item ${item.itemNo}:`, error);
        itemsSkipped++;
        
        // If it's a rate limit error, stop immediately
        if (error instanceof Error && error.message.includes('rate limit')) {
          stopped = true;
          stopReason = error.message;
          break;
        }
      }
    }

    console.log(`[Price-o-Matic Sync] Completed: ${itemsUpdated} updated, ${itemsSkipped} skipped, ${apiCallsUsed} API calls used`);

    return {
      itemsUpdated,
      itemsSkipped,
      apiCallsUsed,
      stopped,
      stopReason,
    };

  } catch (error) {
    console.error('[Price-o-Matic Sync] Fatal error:', error);
    throw error;
  }
}

export async function fetchPriceOMagicData(
  itemNo: string,
  itemType: string,
  colorId?: number,
  newOrUsed: string = 'N',
  premiumPercentage: number = 15,
  config: PomFormulaConfig = POM_FORMULA_DEFAULTS
): Promise<any> {
  try {
    // Check if we have cached data less than 24 hours old
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const existingCache = await db
      .select()
      .from(priceGuideCache)
      .where(
        and(
          eq(priceGuideCache.itemNo, itemNo),
          eq(priceGuideCache.itemType, itemType),
          colorId ? eq(priceGuideCache.colorId, colorId) : sql`${priceGuideCache.colorId} IS NULL`,
          eq(priceGuideCache.newOrUsed, newOrUsed),
          gte(priceGuideCache.fetchedAt, twentyFourHoursAgo)
        )
      )
      .limit(1);
    
    if (existingCache.length > 0) {
      console.log(`[Price-o-Matic] Using cached data for ${itemType}/${itemNo}${colorId ? `/${colorId}` : ''}/${newOrUsed}`);
      return existingCache[0];
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

    // Fetch item details
    const itemDetailsEndpoint = `/items/${apiItemType}/${itemNo}`;
    const { data: itemDetails } = await bricklinkCatalogRequest(itemDetailsEndpoint);

    // Fetch price guide - stock
    const stockPriceParams: Record<string, string> = { 
      guide_type: 'stock',
      new_or_used: newOrUsed
    };
    if (colorId) {
      stockPriceParams.color_id = colorId.toString();
    }
    const stockPriceEndpoint = `/items/${apiItemType}/${itemNo}/price`;
    const { data: stockPriceData } = await bricklinkCatalogRequest(stockPriceEndpoint, stockPriceParams);

    // Fetch price guide - sold
    const soldPriceParams: Record<string, string> = { 
      guide_type: 'sold',
      new_or_used: newOrUsed
    };
    if (colorId) {
      soldPriceParams.color_id = colorId.toString();
    }
    const { data: soldPriceData } = await bricklinkCatalogRequest(stockPriceEndpoint, soldPriceParams);

    // Calculate suggested price with supply adjustment
    const stockAvgPrice = stockPriceData?.avg_price ? parseFloat(stockPriceData.avg_price) : null;
    const soldAvgPrice = soldPriceData?.avg_price ? parseFloat(soldPriceData.avg_price) : null;
    const stockTotalLots = stockPriceData?.unit_quantity ? parseInt(stockPriceData.unit_quantity.toString()) : 0; // Number of lots/listings
    const suggestedPrice = calculateSuggestedPriceWithSupply(stockAvgPrice, soldAvgPrice, stockTotalLots, premiumPercentage, apiItemType, config);

    // Merge and store data
    const mergedData = {
      itemNo,
      itemType,
      colorId: colorId || null,
      newOrUsed,
      
      // Item details
      itemName: itemDetails?.name || null,
      imageUrl: itemDetails?.image_url || null,
      thumbnailUrl: itemDetails?.thumbnail_url || null,
      categoryId: itemDetails?.category_id || null,
      weight: itemDetails?.weight ? itemDetails.weight.toString() : null,
      dimensionX: itemDetails?.dim_x ? itemDetails.dim_x.toString() : null,
      dimensionY: itemDetails?.dim_y ? itemDetails.dim_y.toString() : null,
      dimensionZ: itemDetails?.dim_z ? itemDetails.dim_z.toString() : null,
      yearReleased: itemDetails?.year_released || null,
      
      // Stock price guide
      stockAvgPrice: stockAvgPrice?.toString() || null,
      stockMinPrice: stockPriceData?.min_price ? stockPriceData.min_price.toString() : null,
      stockMaxPrice: stockPriceData?.max_price ? stockPriceData.max_price.toString() : null,
      stockQuantity: stockPriceData?.qty_avg || null,
      stockTotalLots: stockPriceData?.unit_quantity || null, // Number of lots/listings
      
      // Sold price guide
      soldAvgPrice: soldAvgPrice?.toString() || null,
      soldMinPrice: soldPriceData?.min_price ? soldPriceData.min_price.toString() : null,
      soldMaxPrice: soldPriceData?.max_price ? soldPriceData.max_price.toString() : null,
      soldQuantity: soldPriceData?.qty_avg || null,
      soldTotalLots: soldPriceData?.unit_quantity || null, // Number of lots/listings
      
      // Price-O-Matic
      suggestedPrice: suggestedPrice.toString(),
      premiumPercentage,
    };

    // Delete old cache entry if exists
    await db
      .delete(priceGuideCache)
      .where(
        and(
          eq(priceGuideCache.itemNo, itemNo),
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
    
    // Update inventory weight if we have weight data and inventory weight is null
    if (itemDetails?.weight) {
      try {
        const inventoryQuery = colorId 
          ? and(
              eq(blInventory.itemNo, itemNo),
              eq(blInventory.itemType, itemType),
              eq(blInventory.colorId, colorId),
              sql`${blInventory.myWeight} IS NULL`
            )
          : and(
              eq(blInventory.itemNo, itemNo),
              eq(blInventory.itemType, itemType),
              sql`${blInventory.myWeight} IS NULL`
            );

        const updatedCount = await db
          .update(blInventory)
          .set({ myWeight: itemDetails.weight.toString() })
          .where(inventoryQuery);

        if (updatedCount) {
          console.log(`[Price-o-Matic] Updated weight for ${itemType}/${itemNo}${colorId ? `/${colorId}` : ''} to ${itemDetails.weight}g`);
        }
      } catch (error) {
        console.error('[Price-o-Matic] Error updating inventory weight:', error);
        // Don't throw - this is a nice-to-have feature
      }
    }

    // Write back the BL catalog thumbnail to bl_inventory (more reliable than constructed CDN URLs)
    // Only update if the stored URL is null (Rebrickable images are preserved)
    if (itemDetails?.thumbnail_url) {
      try {
        const rawThumb = itemDetails.thumbnail_url as string;
        const thumbUrl = rawThumb.startsWith('//') ? `https:${rawThumb}` : rawThumb;
        const imgQuery = colorId
          ? and(eq(blInventory.itemNo, itemNo), eq(blInventory.itemType, itemType), eq(blInventory.colorId, colorId), sql`${blInventory.imageUrl} IS NULL`)
          : and(eq(blInventory.itemNo, itemNo), eq(blInventory.itemType, itemType), sql`${blInventory.imageUrl} IS NULL`);
        await db.update(blInventory).set({ imageUrl: thumbUrl, thumbnailUrl: thumbUrl }).where(imgQuery);
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
  itemType: string = 'PART'
): Promise<any> {
  try {
    console.log(`[BrickLink Catalog Search] Searching for ${itemType}/${itemNo}`);
    
    // Fetch item details from catalog
    const { data: itemDetails } = await bricklinkCatalogRequest(`/items/${itemType}/${itemNo}`);
    
    if (!itemDetails) {
      throw new Error('Item not found in BrickLink catalog');
    }

    // Fetch price guide data - stock
    const stockPriceParams: Record<string, string> = { guide_type: 'stock', new_or_used: 'N' };
    const stockPriceEndpoint = `/items/${itemType}/${itemNo}/price`;
    const { data: stockPriceData } = await bricklinkCatalogRequest(stockPriceEndpoint, stockPriceParams);

    // Fetch price guide data - sold
    const soldPriceParams: Record<string, string> = { guide_type: 'sold', new_or_used: 'N' };
    const { data: soldPriceData } = await bricklinkCatalogRequest(stockPriceEndpoint, soldPriceParams);

    // Calculate suggested price with supply adjustment
    const stockAvgPrice = stockPriceData?.avg_price ? parseFloat(stockPriceData.avg_price) : null;
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

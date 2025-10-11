import { db } from "../db";
import { blCategories, blColors, blInventory, blApiCalls, appSettings, priceGuideCache } from "@shared/schema";
import { eq, gte, sql, inArray, and } from "drizzle-orm";
import OAuth from "oauth-1.0a";
import crypto from "crypto";

export interface BricklinkSyncResult {
  categoriesAdded: number;
  categoriesUpdated: number;
  colorsAdded: number;
  colorsUpdated: number;
  inventoryAdded: number;
  inventoryUpdated: number;
  totalApiCalls: number;
  rateLimitWarning?: string;
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
  
  // Block at 4750 calls
  if (callsLast24h >= 4750) {
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

// Make a BrickLink API request with rate limiting
async function bricklinkRequest(endpoint: string, queryParams?: Record<string, string>): Promise<{ data: any; apiCalls: number }> {
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

export async function syncBricklinkInventory(): Promise<{ added: number; updated: number; apiCalls: number }> {
  try {
    console.log('Starting BrickLink inventory sync (fetching ALL inventory without filters)...');
    
    // Fetch all inventory without status filters - BrickLink will return everything
    const { data: responseData, apiCalls } = await bricklinkRequest('/inventories');
    
    const items = Array.isArray(responseData) ? responseData : [];
    console.log(`Received ${items.length} total inventory items from BrickLink`);
    
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
    
    console.log(`Processing: ${newItems.length} new items, ${existingItemsToCheck.length} existing items to check`);
    
    // Batch insert new items (PostgreSQL supports large batch inserts)
    let added = 0;
    if (newItems.length > 0) {
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
    }
    
    // For existing items, check if they need updates (quantity or price changes)
    let updated = 0;
    if (existingItemsToCheck.length > 0) {
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
        console.log(`Fetched existing details batch ${Math.floor(i / FETCH_BATCH_SIZE) + 1}: ${existingDetails.length}/${existingItemsToCheck.length} items`);
      }
      
      const existingMap = new Map(existingDetails.map(item => [item.id, item]));
      
      // Batch update items that have changed
      const BATCH_SIZE = 500;
      const itemsToUpdate = existingItemsToCheck.filter(item => {
        const existing = existingMap.get(Number(item.inventory_id));
        if (!existing) return false;
        
        // Normalize numeric values
        const apiUnitPrice = parseFloat(item.unit_price || "0");
        const existingUnitPrice = parseFloat(existing.unitPrice || "0");
        
        // Normalize boolean values from BrickLink (true/false or possibly undefined)
        const apiIsRetain = !!item.is_retain;
        const apiIsStockRoom = !!item.is_stock_room;
        
        return (
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
      });
      
      console.log(`Found ${itemsToUpdate.length} items needing updates`);
      
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
        
        console.log(`Updated batch ${Math.floor(i / BATCH_SIZE) + 1}: ${updated}/${itemsToUpdate.length} items`);
      }
    }

    console.log(`BrickLink inventory sync complete: ${added} added, ${updated} updated`);
    return { added, updated, apiCalls };
  } catch (error) {
    console.error('Error syncing BrickLink inventory:', error);
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

export async function syncBricklinkData(): Promise<BricklinkSyncResult> {
  // Check rate limit before starting sync
  const rateLimit = await checkRateLimit();
  
  // Sync in order: categories, colors, then inventory
  const categoriesResult = await syncBricklinkCategories();
  const colorsResult = await syncBricklinkColors();
  const inventoryResult = await syncBricklinkInventory();

  const totalApiCalls = categoriesResult.apiCalls + colorsResult.apiCalls + inventoryResult.apiCalls;

  return {
    categoriesAdded: categoriesResult.added,
    categoriesUpdated: categoriesResult.updated,
    colorsAdded: colorsResult.added,
    colorsUpdated: colorsResult.updated,
    inventoryAdded: inventoryResult.added,
    inventoryUpdated: inventoryResult.updated,
    totalApiCalls,
    rateLimitWarning: rateLimit.warning,
  };
}

// ====== PRICE-O-MAGIC FUNCTIONS ======

// Make a BrickLink Catalog API request (different base URL)
async function bricklinkCatalogRequest(endpoint: string, queryParams?: Record<string, string>): Promise<{ data: any; apiCalls: number }> {
  const [settings] = await db.select().from(appSettings).limit(1);
  
  const consumerKey = settings?.bricklinkConsumerKey || process.env.BRICKLINK_CONSUMER_KEY || '';
  const consumerSecret = settings?.bricklinkConsumerSecret || process.env.BRICKLINK_CONSUMER_SECRET || '';
  const tokenValue = settings?.bricklinkTokenValue || process.env.BRICKLINK_TOKEN_VALUE || '';
  const tokenSecret = settings?.bricklinkTokenSecret || process.env.BRICKLINK_TOKEN_SECRET || '';
  
  if (!consumerKey || !consumerSecret || !tokenValue || !tokenSecret) {
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

  // Catalog API uses /api/v1 instead of /api/store/v1
  let url = `https://api.bricklink.com/api/v1${endpoint}`;
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

// Fetch and cache Price-O-Magic data for an item
export async function fetchPriceOMagicData(
  itemNo: string,
  itemType: string,
  colorId?: number,
  premiumPercentage: number = 15
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
          gte(priceGuideCache.fetchedAt, twentyFourHoursAgo)
        )
      )
      .limit(1);
    
    if (existingCache.length > 0) {
      console.log(`[Price-O-Magic] Using cached data for ${itemType}/${itemNo}${colorId ? `/${colorId}` : ''}`);
      return existingCache[0];
    }

    console.log(`[Price-O-Magic] Fetching fresh data for ${itemType}/${itemNo}${colorId ? `/${colorId}` : ''}`);

    // Fetch item details
    const itemDetailsEndpoint = `/catalog/items/${itemType}/${itemNo}`;
    const { data: itemDetails } = await bricklinkCatalogRequest(itemDetailsEndpoint);

    // Fetch price guide - stock
    const stockPriceParams: Record<string, string> = { guide_type: 'stock' };
    if (colorId) {
      stockPriceParams.color_id = colorId.toString();
    }
    const stockPriceEndpoint = `/catalog/items/${itemType}/${itemNo}/price`;
    const { data: stockPriceData } = await bricklinkCatalogRequest(stockPriceEndpoint, stockPriceParams);

    // Fetch price guide - sold
    const soldPriceParams: Record<string, string> = { guide_type: 'sold' };
    if (colorId) {
      soldPriceParams.color_id = colorId.toString();
    }
    const { data: soldPriceData } = await bricklinkCatalogRequest(stockPriceEndpoint, soldPriceParams);

    // Calculate suggested price
    const stockAvgPrice = stockPriceData?.avg_price ? parseFloat(stockPriceData.avg_price) : null;
    const soldAvgPrice = soldPriceData?.avg_price ? parseFloat(soldPriceData.avg_price) : null;
    const suggestedPrice = calculateSuggestedPrice(stockAvgPrice, soldAvgPrice, premiumPercentage);

    // Merge and store data
    const mergedData = {
      itemNo,
      itemType,
      colorId: colorId || null,
      
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
      stockTotalLots: stockPriceData?.total_qty || null,
      
      // Sold price guide
      soldAvgPrice: soldAvgPrice?.toString() || null,
      soldMinPrice: soldPriceData?.min_price ? soldPriceData.min_price.toString() : null,
      soldMaxPrice: soldPriceData?.max_price ? soldPriceData.max_price.toString() : null,
      soldQuantity: soldPriceData?.qty_avg || null,
      soldTotalLots: soldPriceData?.total_qty || null,
      
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
          colorId ? eq(priceGuideCache.colorId, colorId) : sql`${priceGuideCache.colorId} IS NULL`
        )
      );

    // Insert new cache entry
    const [insertedData] = await db
      .insert(priceGuideCache)
      .values([mergedData])
      .returning();

    console.log(`[Price-O-Magic] Cached data for ${itemType}/${itemNo}${colorId ? `/${colorId}` : ''}`);
    
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
          console.log(`[Price-O-Magic] Updated weight for ${itemType}/${itemNo}${colorId ? `/${colorId}` : ''} to ${itemDetails.weight}g`);
        }
      } catch (error) {
        console.error('[Price-O-Magic] Error updating inventory weight:', error);
        // Don't throw - this is a nice-to-have feature
      }
    }
    
    return insertedData;
  } catch (error) {
    console.error('[Price-O-Magic] Error fetching data:', error);
    throw error;
  }
}

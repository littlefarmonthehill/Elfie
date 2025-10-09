import { db } from "../db";
import { blCategories, blColors, blInventory, blApiCalls } from "@shared/schema";
import { eq, gte, sql } from "drizzle-orm";
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

// BrickLink OAuth setup
const oauth = new OAuth({
  consumer: {
    key: process.env.BRICKLINK_CONSUMER_KEY || '',
    secret: process.env.BRICKLINK_CONSUMER_SECRET || '',
  },
  signature_method: 'HMAC-SHA1',
  hash_function(baseString, key) {
    return crypto.createHmac('sha1', key).update(baseString).digest('base64');
  },
});

// Clean token values - remove any non-alphanumeric characters that may have been added
const cleanToken = (value: string) => value.replace(/[^A-Z0-9]/gi, '');

const token = {
  key: cleanToken(process.env.BRICKLINK_TOKEN_VALUE || ''),
  secret: cleanToken(process.env.BRICKLINK_TOKEN_SECRET || ''),
};

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
  if (!process.env.BRICKLINK_CONSUMER_KEY || !process.env.BRICKLINK_CONSUMER_SECRET || 
      !process.env.BRICKLINK_TOKEN_VALUE || !process.env.BRICKLINK_TOKEN_SECRET) {
    throw new Error('BrickLink credentials not configured. Please add them in Settings.');
  }

  // Check rate limit before making request
  const rateLimit = await checkRateLimit();
  if (!rateLimit.allowed) {
    throw new Error(rateLimit.warning || 'API rate limit exceeded');
  }

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
    
    let added = 0;
    let updated = 0;

    for (const category of categories) {
      const existing = await db.select().from(blCategories).where(eq(blCategories.id, category.category_id));
      
      if (existing.length === 0) {
        await db.insert(blCategories).values({
          id: category.category_id,
          name: category.category_name,
        });
        added++;
      } else if (existing[0].name !== category.category_name) {
        await db.update(blCategories)
          .set({ name: category.category_name, updatedAt: new Date() })
          .where(eq(blCategories.id, category.category_id));
        updated++;
      }
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
    
    let added = 0;
    let updated = 0;

    for (const color of colors) {
      const existing = await db.select().from(blColors).where(eq(blColors.id, color.color_id));
      
      if (existing.length === 0) {
        await db.insert(blColors).values({
          id: color.color_id,
          name: color.color_name,
          rgb: color.color_code || '000000',
          type: color.color_type || 'solid',
        });
        added++;
      } else {
        const needsUpdate = existing[0].name !== color.color_name || 
                            existing[0].rgb !== (color.color_code || '000000') || 
                            existing[0].type !== (color.color_type || 'solid');
        if (needsUpdate) {
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
      }
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
    
    // Separate items into new and existing
    const newItems = items.filter(item => !existingIds.has(item.inventory_id));
    const existingItemsToCheck = items.filter(item => existingIds.has(item.inventory_id));
    
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
          itemType: item.item.type,
          colorId: item.color_id || 0,
          quantity: item.quantity,
          newOrUsed: item.new_or_used,
          unitPrice: item.unit_price,
          myCost: item.my_cost || "0",
          categoryId: item.item.category_id || 0,
        }));
        
        await db.insert(blInventory).values(values);
        added += batch.length;
        console.log(`Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${added}/${newItems.length} new items`);
      }
    }
    
    // For existing items, check if they need updates (quantity or price changes)
    let updated = 0;
    if (existingItemsToCheck.length > 0) {
      // Get full details of existing items that might need updates
      const existingDetails = await db.select()
        .from(blInventory)
        .where(sql`${blInventory.id} = ANY(${existingItemsToCheck.map(i => i.inventory_id)})`);
      
      const existingMap = new Map(existingDetails.map(item => [item.id, item]));
      
      // Batch update items that have changed
      const BATCH_SIZE = 500;
      const itemsToUpdate = existingItemsToCheck.filter(item => {
        const existing = existingMap.get(item.inventory_id);
        const apiMyCost = parseFloat(item.my_cost || "0");
        const existingMyCost = parseFloat(existing.myCost || "0");
        const apiUnitPrice = parseFloat(item.unit_price || "0");
        const existingUnitPrice = parseFloat(existing.unitPrice || "0");
        
        return existing && (
          existing.quantity !== item.quantity || 
          Math.abs(existingUnitPrice - apiUnitPrice) > 0.001 ||
          Math.abs(existingMyCost - apiMyCost) > 0.0001
        );
      });
      
      console.log(`Found ${itemsToUpdate.length} items needing updates`);
      
      for (let i = 0; i < itemsToUpdate.length; i += BATCH_SIZE) {
        const batch = itemsToUpdate.slice(i, i + BATCH_SIZE);
        
        // Update each item in the batch
        for (const item of batch) {
          await db.update(blInventory)
            .set({ 
              quantity: item.quantity,
              unitPrice: item.unit_price,
              myCost: item.my_cost || "0",
              updatedAt: new Date() 
            })
            .where(eq(blInventory.id, item.inventory_id));
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

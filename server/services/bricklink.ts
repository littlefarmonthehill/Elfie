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

const token = {
  key: process.env.BRICKLINK_TOKEN_VALUE || '',
  secret: process.env.BRICKLINK_TOKEN_SECRET || '',
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
async function bricklinkRequest(endpoint: string): Promise<{ data: any; apiCalls: number }> {
  if (!process.env.BRICKLINK_CONSUMER_KEY || !process.env.BRICKLINK_CONSUMER_SECRET || 
      !process.env.BRICKLINK_TOKEN_VALUE || !process.env.BRICKLINK_TOKEN_SECRET) {
    throw new Error('BrickLink credentials not configured. Please add them in Settings.');
  }

  // Check rate limit before making request
  const rateLimit = await checkRateLimit();
  if (!rateLimit.allowed) {
    throw new Error(rateLimit.warning || 'API rate limit exceeded');
  }

  const url = `https://api.bricklink.com/api/store/v1${endpoint}`;
  const authHeader = oauth.toHeader(oauth.authorize({ url, method: 'GET' }, token));
  
  let success = false;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
      },
    });

    success = response.ok;

    if (!response.ok) {
      throw new Error(`BrickLink API error: ${response.statusText}`);
    }

    const json = await response.json();
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
    // Use the single /inventories endpoint to get all inventory in one call
    const { data: responseData, apiCalls } = await bricklinkRequest('/inventories');
    
    let added = 0;
    let updated = 0;

    // BrickLink API returns data directly as an array
    const items = Array.isArray(responseData) ? responseData : [];

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

    return { added, updated, apiCalls };
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

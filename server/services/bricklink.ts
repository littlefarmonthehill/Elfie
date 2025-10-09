import { db } from "../db";
import { blCategories, blColors, blInventory } from "@shared/schema";
import { eq } from "drizzle-orm";
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

async function bricklinkRequest(endpoint: string): Promise<{ data: any[], apiCalls: number }> {
  if (!process.env.BRICKLINK_CONSUMER_KEY || !process.env.BRICKLINK_CONSUMER_SECRET || 
      !process.env.BRICKLINK_TOKEN_VALUE || !process.env.BRICKLINK_TOKEN_SECRET) {
    throw new Error('BrickLink credentials not configured. Please add them in Settings.');
  }

  let allResults: any[] = [];
  let currentUrl = `https://api.bricklink.com/api/store/v1${endpoint}`;
  let apiCalls = 0;
  
  while (currentUrl) {
    const authHeader = oauth.toHeader(oauth.authorize({ url: currentUrl, method: 'GET' }, token));
    
    const response = await fetch(currentUrl, {
      method: 'GET',
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
      },
    });

    apiCalls++;

    if (!response.ok) {
      throw new Error(`BrickLink API error: ${response.statusText}`);
    }

    const json = await response.json();
    const data = json.data;
    const meta = json.meta;
    
    // Accumulate results
    if (Array.isArray(data)) {
      allResults = allResults.concat(data);
    } else {
      allResults.push(data);
    }
    
    // Check for next page
    currentUrl = meta?.next ? `https://api.bricklink.com${meta.next}` : '';
  }
  
  return { data: allResults, apiCalls };
}

export async function syncBricklinkCategories(): Promise<{ added: number; updated: number; apiCalls: number }> {
  try {
    const { data: categories, apiCalls } = await bricklinkRequest('/categories');
    
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
    const { data: colors, apiCalls } = await bricklinkRequest('/colors');
    
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
    const { data: inventories, apiCalls } = await bricklinkRequest('/inventories');
    
    let added = 0;
    let updated = 0;

    for (const item of inventories) {
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
  // Sync in order: categories, colors, then inventory
  const categoriesResult = await syncBricklinkCategories();
  const colorsResult = await syncBricklinkColors();
  const inventoryResult = await syncBricklinkInventory();

  return {
    categoriesAdded: categoriesResult.added,
    categoriesUpdated: categoriesResult.updated,
    colorsAdded: colorsResult.added,
    colorsUpdated: colorsResult.updated,
    inventoryAdded: inventoryResult.added,
    inventoryUpdated: inventoryResult.updated,
    totalApiCalls: categoriesResult.apiCalls + colorsResult.apiCalls + inventoryResult.apiCalls,
  };
}

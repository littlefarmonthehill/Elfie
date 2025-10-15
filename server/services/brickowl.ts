import { db } from "../db";
import { appSettings, blInventory, blColors } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface BrickOwlSyncResult {
  lotsCreated: number;
  lotsUpdated: number;
  lotsSkipped: number;
  errors: string[];
  totalApiCalls: number;
}

export interface BrickOwlInventoryLot {
  lot_id: string;
  boid: string;
  color_id: number;
  quantity: number;
  price: string;
  condition: string;
  for_sale: number;
  external_lot_ids?: string[];
}

// Make a BrickOwl API GET request
async function brickowlGet(endpoint: string, params?: Record<string, string>): Promise<any> {
  // Get API key from database settings
  const [settings] = await db.select().from(appSettings).limit(1);
  
  const apiKey = settings?.brickowlApiKey;
  
  if (!apiKey) {
    throw new Error('BrickOwl API key not configured. Please add it in Settings > API Credentials.');
  }

  // Build URL with API key and params
  const queryParams = new URLSearchParams({ key: apiKey, ...params });
  const url = `https://api.brickowl.com/v1${endpoint}?${queryParams.toString()}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`BrickOwl API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Make a BrickOwl API POST request
async function brickowlPost(endpoint: string, data: Record<string, any>): Promise<any> {
  // Get API key from database settings
  const [settings] = await db.select().from(appSettings).limit(1);
  
  const apiKey = settings?.brickowlApiKey;
  
  if (!apiKey) {
    throw new Error('BrickOwl API key not configured. Please add it in Settings > API Credentials.');
  }

  // BrickOwl requires application/x-www-form-urlencoded for POST
  const formData = new URLSearchParams({ key: apiKey, ...data });
  const url = `https://api.brickowl.com/v1${endpoint}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BrickOwl API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}

// Get BrickOwl inventory list
export async function getBrickOwlInventory(activeOnly: boolean = true): Promise<BrickOwlInventoryLot[]> {
  const params = { active_only: activeOnly ? '1' : '0' };
  const response = await brickowlGet('/inventory/list', params);
  
  // BrickOwl API returns { inventory: [...] }
  return Array.isArray(response) ? response : (response.inventory || []);
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
  external_id_1?: string;
}): Promise<any> {
  return brickowlPost('/inventory/create', {
    ...(data.boid && { boid: data.boid }),
    ...(data.bl_item_no && { bl_item_no: data.bl_item_no }),
    ...(data.color_id && { color_id: data.color_id.toString() }),
    quantity: data.quantity.toString(),
    price: data.price.toFixed(3),
    ...(data.condition && { condition: data.condition }),
    ...(data.for_sale !== undefined && { for_sale: data.for_sale.toString() }),
    ...(data.external_id_1 && { external_id_1: data.external_id_1 }),
  });
}

// Update an existing lot on BrickOwl
export async function updateBrickOwlLot(data: {
  lot_id?: string;
  external_id_1?: string;
  absolute_quantity?: number;
  price?: number;
  for_sale?: number;
}): Promise<any> {
  const updateData: Record<string, string> = {};
  
  if (data.lot_id) updateData.lot_id = data.lot_id;
  if (data.external_id_1) updateData.external_id_1 = data.external_id_1;
  if (data.absolute_quantity !== undefined) updateData.absolute_quantity = data.absolute_quantity.toString();
  if (data.price !== undefined) updateData.price = data.price.toFixed(3);
  if (data.for_sale !== undefined) updateData.for_sale = data.for_sale.toString();
  
  return brickowlPost('/inventory/update', updateData);
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

// Lookup BOID from BrickLink item number
export async function lookupBoid(blItemNo: string, type: string = 'Part'): Promise<string | null> {
  try {
    const normalizedType = normalizeBrickLinkItemType(type);
    
    const result = await brickowlGet('/catalog/id_lookup', {
      id: blItemNo,
      type: normalizedType,
      id_type: 'bl_item_no',
    });
    
    // Result is an array of possible BOIDs
    if (Array.isArray(result) && result.length > 0) {
      return result[0].boid || result[0];
    }
    
    return null;
  } catch (error) {
    console.error(`Failed to lookup BOID for ${blItemNo}:`, error);
    return null;
  }
}

// Map BrickLink color ID to BrickOwl color ID
export async function mapColorId(bricklinkColorId: number): Promise<number | null> {
  // Get BrickLink color from database
  const [blColor] = await db
    .select()
    .from(blColors)
    .where(eq(blColors.id, bricklinkColorId))
    .limit(1);
  
  if (!blColor) {
    return null;
  }

  // BrickOwl color mapping (simplified - may need full mapping table)
  // For now, return the same ID (many colors have same IDs on both platforms)
  // TODO: Implement full color mapping table if needed
  return bricklinkColorId;
}

// Sync a single inventory item from BrickLink to BrickOwl
export async function syncInventoryItem(blItem: typeof blInventory.$inferSelect): Promise<{
  success: boolean;
  action: 'created' | 'updated' | 'skipped';
  error?: string;
}> {
  try {
    // Lookup BOID from BrickLink item number
    const boid = await lookupBoid(blItem.itemNo, blItem.itemType);
    
    if (!boid) {
      return {
        success: false,
        action: 'skipped',
        error: `Could not find BOID for BrickLink item ${blItem.itemNo}`,
      };
    }

    // Map color ID
    const colorId = blItem.colorId ? await mapColorId(blItem.colorId) : null;
    
    if (!colorId && blItem.itemType === 'Part') {
      return {
        success: false,
        action: 'skipped',
        error: `Could not map color ID ${blItem.colorId} for item ${blItem.itemNo}`,
      };
    }

    // Check if lot already exists on BrickOwl (using BrickLink inventory ID as external_id_1)
    const existingResponse = await brickowlGet('/inventory/list', {
      external_id_1: blItem.id.toString(),
    });

    // BrickOwl API returns { inventory: [...] } or sometimes just an array
    const existingLots = Array.isArray(existingResponse) 
      ? existingResponse 
      : (existingResponse.inventory || []);

    // Map BrickLink condition to BrickOwl condition
    const condition = blItem.newOrUsed === 'N' ? 'new' : 'used';

    if (existingLots.length > 0) {
      // Update existing lot
      await updateBrickOwlLot({
        external_id_1: blItem.id.toString(),
        absolute_quantity: blItem.quantity,
        price: blItem.unitPrice ? parseFloat(blItem.unitPrice) : 0,
        condition,
        for_sale: 1,
      });
      
      return { success: true, action: 'updated' };
    } else {
      // Create new lot
      await createBrickOwlLot({
        boid,
        color_id: colorId || undefined,
        quantity: blItem.quantity,
        price: blItem.unitPrice ? parseFloat(blItem.unitPrice) : 0,
        condition,
        for_sale: 1,
        external_id_1: blItem.id.toString(),
      });
      
      return { success: true, action: 'created' };
    }
  } catch (error) {
    return {
      success: false,
      action: 'skipped',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Sync all BrickLink inventory to BrickOwl
export async function syncBrickLinkToBrickOwl(limit?: number): Promise<BrickOwlSyncResult> {
  const result: BrickOwlSyncResult = {
    lotsCreated: 0,
    lotsUpdated: 0,
    lotsSkipped: 0,
    errors: [],
    totalApiCalls: 0,
  };

  // Get BrickLink inventory
  let query = db.select().from(blInventory);
  if (limit) {
    query = query.limit(limit) as any;
  }
  
  const blItems = await query;
  
  console.log(`Syncing ${blItems.length} items from BrickLink to BrickOwl...`);

  // Sync each item
  for (const item of blItems) {
    const syncResult = await syncInventoryItem(item);
    result.totalApiCalls += 2; // Estimate: lookup + create/update
    
    if (syncResult.success) {
      if (syncResult.action === 'created') {
        result.lotsCreated++;
      } else if (syncResult.action === 'updated') {
        result.lotsUpdated++;
      }
    } else {
      result.lotsSkipped++;
      if (syncResult.error) {
        result.errors.push(`${item.itemNo}: ${syncResult.error}`);
      }
    }

    // Add delay to avoid rate limiting (600 req/min = ~10 req/sec)
    await new Promise(resolve => setTimeout(resolve, 120));
  }

  return result;
}

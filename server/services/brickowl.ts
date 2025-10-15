import { db } from "../db";
import { appSettings, blInventory, blColors } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

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
  const payload = {
    ...(data.boid && { boid: data.boid }),
    ...(data.bl_item_no && { bl_item_no: data.bl_item_no }),
    ...(data.color_id !== undefined && { color_id: data.color_id.toString() }),
    quantity: data.quantity.toString(),
    price: data.price.toFixed(3),
    ...(data.condition && { condition: data.condition }),
    ...(data.for_sale !== undefined && { for_sale: data.for_sale.toString() }),
    ...(data.external_id_1 && { external_id_1: data.external_id_1 }),
  };
  console.log('[BrickOwl] Creating lot with payload:', JSON.stringify(payload));
  return brickowlPost('/inventory/create', payload);
}

// Update an existing lot on BrickOwl
export async function updateBrickOwlLot(data: {
  lot_id?: string;
  external_id_1?: string;
  absolute_quantity?: number;
  price?: number;
  condition?: string;
  for_sale?: number;
}): Promise<any> {
  const updateData: Record<string, string> = {};
  
  if (data.lot_id) updateData.lot_id = data.lot_id;
  if (data.external_id_1) updateData.external_id_1 = data.external_id_1;
  if (data.absolute_quantity !== undefined) updateData.absolute_quantity = data.absolute_quantity.toString();
  if (data.price !== undefined) updateData.price = data.price.toFixed(3);
  if (data.condition) updateData.condition = data.condition;
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
    
    console.log(`Looking up BOID for ${blItemNo} (type: ${type} → ${normalizedType})`);
    
    const result = await brickowlGet('/catalog/id_lookup', {
      id: blItemNo,
      type: normalizedType,
      id_type: 'bl_item_no',
    });
    
    console.log(`BOID lookup result for ${blItemNo}:`, JSON.stringify(result).substring(0, 200));
    
    // BrickOwl returns: {"boids": ["123456"]} or sometimes an array directly
    let boids: string[] = [];
    
    if (result.boids && Array.isArray(result.boids)) {
      boids = result.boids;
    } else if (Array.isArray(result)) {
      boids = result.map((item: any) => item.boid || item);
    }
    
    if (boids.length > 0) {
      const boid = boids[0];
      console.log(`✓ Found BOID for ${blItemNo}: ${boid}`);
      return boid;
    }
    
    console.log(`✗ No BOID found for ${blItemNo}`);
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
    console.log(`[Color Map] BrickLink color ${bricklinkColorId} not found in database`);
    return null;
  }

  console.log(`[Color Map] Looking up BrickOwl color for BrickLink color ${bricklinkColorId} (${blColor.name})`);
  
  try {
    // Use BrickOwl's catalog/id_lookup to find color ID by name
    const result = await brickowlGet('/catalog/id_lookup', {
      id: blColor.name,
      type: 'Color',
      id_type: 'name',
    });
    
    console.log(`[Color Map] BrickOwl color lookup result for "${blColor.name}":`, JSON.stringify(result).substring(0, 200));
    
    // Extract color ID from response
    let colorIds: string[] = [];
    if (result.boids && Array.isArray(result.boids)) {
      colorIds = result.boids;
    } else if (Array.isArray(result)) {
      colorIds = result.map((item: any) => item.boid || item);
    }
    
    if (colorIds.length > 0) {
      const brickOwlColorId = parseInt(colorIds[0]);
      console.log(`[Color Map] ✓ Mapped BrickLink color ${bricklinkColorId} (${blColor.name}) → BrickOwl color ${brickOwlColorId}`);
      return brickOwlColorId;
    }
    
    console.log(`[Color Map] ✗ No BrickOwl color found for "${blColor.name}"`);
    return null;
  } catch (error) {
    console.error(`[Color Map] Error mapping color ${bricklinkColorId}:`, error);
    return null;
  }
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

    // Map color ID (colorId can be 0 for "Not Applicable")
    console.log(`[Sync] Item ${blItem.itemNo} has colorId: ${blItem.colorId}, type: ${blItem.itemType}`);
    const colorId = blItem.colorId !== null && blItem.colorId !== undefined 
      ? await mapColorId(blItem.colorId) 
      : null;
    console.log(`[Sync] Mapped colorId for ${blItem.itemNo}: ${colorId}`);
    
    if (colorId === null && blItem.itemType === 'PART') {
      console.log(`[Sync] Skipping ${blItem.itemNo} - no color mapped`);
      return {
        success: false,
        action: 'skipped',
        error: `Could not map color ID ${blItem.colorId} for item ${blItem.itemNo}`,
      };
    }
    console.log(`[Sync] Item ${blItem.itemNo} passed color check, proceeding to sync...`);

    // Skip checking if lot exists - BrickOwl's inventory/list endpoint with external_id_1
    // filter returns "You must provide an ID" error. Just try to create and let BrickOwl
    // handle duplicates if they exist.
    const existingLots: any[] = [];

    // Map BrickLink condition to BrickOwl condition
    // Business logic per user's inventory policy:
    // - BrickLink "New" → BrickOwl "new"
    // - BrickLink "Used" → BrickOwl "usedg" (Used Good)
    const condition = blItem.newOrUsed === 'N' ? 'new' : 'usedg';

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
        color_id: colorId !== null ? colorId : undefined,
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

// Find BrickLink items that are NOT in BrickOwl
export async function findUnsyncedItems(limit: number = 5): Promise<(typeof blInventory.$inferSelect)[]> {
  try {
    // Get all BrickOwl inventory
    const brickowlInventory = await getBrickOwlInventory(false); // Get all, not just active
    
    console.log(`BrickOwl returned ${brickowlInventory.length} lots`);
    console.log(`Sample lot:`, brickowlInventory[0] ? JSON.stringify(brickowlInventory[0]).substring(0, 200) : 'none');
    
    // Extract BrickLink IDs from BrickOwl's external_id_1 field
    // BrickOwl stores our BrickLink inventory ID in external_id_1
    const syncedBlIds = brickowlInventory
      .map(lot => {
        // Try multiple possible fields where external ID might be stored
        const externalId = (lot as any).external_id_1 || (lot as any).external_id || (lot as any).externalId;
        return externalId ? parseInt(externalId) : null;
      })
      .filter((id): id is number => id !== null && !isNaN(id));
    
    console.log(`Found ${syncedBlIds.length} BrickLink items already in BrickOwl (via external_id_1)`);
    if (syncedBlIds.length > 0) {
      console.log(`Sample synced IDs:`, syncedBlIds.slice(0, 5));
    }
    
    // Get BrickLink items that are NOT in the synced list
    const unsyncedItems = await db
      .select()
      .from(blInventory)
      .where(sql`${blInventory.id} NOT IN (${sql.join(syncedBlIds.length > 0 ? syncedBlIds : [-1], sql`, `)})`)
      .limit(limit);
    
    console.log(`Found ${unsyncedItems.length} unsynced BrickLink items (limit: ${limit})`);
    
    return unsyncedItems;
  } catch (error) {
    console.error('Error finding unsynced items:', error);
    // Fallback: just return first N items from BrickLink
    return db.select().from(blInventory).limit(limit);
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

// Sync only unsynced BrickLink items to BrickOwl
export async function syncUnsyncedItems(limit: number = 5): Promise<BrickOwlSyncResult> {
  const result: BrickOwlSyncResult = {
    lotsCreated: 0,
    lotsUpdated: 0,
    lotsSkipped: 0,
    errors: [],
    totalApiCalls: 0,
  };

  // Find unsynced items
  const unsyncedItems = await findUnsyncedItems(limit);
  
  if (unsyncedItems.length === 0) {
    console.log('No unsynced items found!');
    return result;
  }
  
  console.log(`Syncing ${unsyncedItems.length} unsynced items from BrickLink to BrickOwl...`);
  console.log('Items to sync:', unsyncedItems.map(item => `${item.itemNo} (ID: ${item.id})`).join(', '));

  // Sync each item
  for (const item of unsyncedItems) {
    const syncResult = await syncInventoryItem(item);
    result.totalApiCalls += 2; // Estimate: lookup + create/update
    
    if (syncResult.success) {
      if (syncResult.action === 'created') {
        result.lotsCreated++;
        console.log(`✓ Created: ${item.itemNo} (${item.colorName || 'N/A'}) - ID: ${item.id}`);
      } else if (syncResult.action === 'updated') {
        result.lotsUpdated++;
        console.log(`✓ Updated: ${item.itemNo} (${item.colorName || 'N/A'}) - ID: ${item.id}`);
      }
    } else {
      result.lotsSkipped++;
      console.log(`✗ Skipped: ${item.itemNo} - ${syncResult.error}`);
      if (syncResult.error) {
        result.errors.push(`${item.itemNo}: ${syncResult.error}`);
      }
    }

    // Add delay to avoid rate limiting (600 req/min = ~10 req/sec)
    await new Promise(resolve => setTimeout(resolve, 120));
  }

  return result;
}

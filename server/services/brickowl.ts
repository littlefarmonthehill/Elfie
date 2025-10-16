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
  qty: string;
  quantity?: number; // Alternative field name
  price: string;
  condition: string;
  full_con?: string; // Full condition name
  for_sale: number;
  external_lot_ids?: {
    other?: string;
    external_id_1?: string;
  };
  personal_note?: string; // Internal notes (BrickLink remarks)
  public_note?: string;   // Public notes (BrickLink description)
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
  
  // BrickOwl API returns array directly or { inventory: [...] }
  const lots = Array.isArray(response) ? response : (response.inventory || []);
  
  // Debug: Check external_lot_ids structure
  if (lots.length > 0) {
    const firstLot = lots[0];
    console.log(`[BrickOwl Inventory] First lot keys: ${Object.keys(firstLot).join(', ')}`);
    console.log(`[BrickOwl Inventory] external_lot_ids:`, JSON.stringify(firstLot.external_lot_ids || null));
    
    // Find a lot that has external_id_1 set
    const lotWithExternal = lots.find((lot: any) => lot.external_lot_ids?.external_id_1);
    if (lotWithExternal) {
      console.log(`[BrickOwl Inventory] Sample lot WITH external_id_1:`, JSON.stringify(lotWithExternal.external_lot_ids));
    } else {
      console.log(`[BrickOwl Inventory] No lots found with external_id_1 set!`);
    }
  }
  
  return lots;
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
  personal_note?: string;
  public_note?: string;
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
    ...(data.personal_note && { personal_note: data.personal_note }),
    ...(data.public_note && { public_note: data.public_note }),
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
  personal_note?: string;
  public_note?: string;
}): Promise<any> {
  const updateData: Record<string, string> = {};
  
  if (data.lot_id) updateData.lot_id = data.lot_id;
  if (data.external_id_1) updateData.external_id_1 = data.external_id_1;
  if (data.absolute_quantity !== undefined) updateData.absolute_quantity = data.absolute_quantity.toString();
  if (data.price !== undefined) updateData.price = data.price.toFixed(3);
  if (data.condition) updateData.condition = data.condition;
  if (data.for_sale !== undefined) updateData.for_sale = data.for_sale.toString();
  if (data.personal_note !== undefined) updateData.personal_note = data.personal_note;
  if (data.public_note !== undefined) updateData.public_note = data.public_note;
  
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
    // Use BrickOwl's catalog/id_lookup to find color ID by BrickLink ID
    const result = await brickowlGet('/catalog/id_lookup', {
      id: bricklinkColorId.toString(),
      type: 'Color',
      id_type: 'bl_id',
    });
    
    console.log(`[Color Map] BrickOwl color lookup result for BrickLink ID ${bricklinkColorId}:`, JSON.stringify(result).substring(0, 200));
    
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
export async function syncInventoryItem(
  blItem: typeof blInventory.$inferSelect,
  brickowlInventory?: any[]
): Promise<{
  success: boolean;
  action: 'created' | 'updated' | 'skipped';
  error?: string;
}> {
  try {
    // SIMPLIFIED APPROACH: Use BrickLink inventory ID stored in external_lot_ids.other
    // If BrickOwl lot has external_lot_ids.other = BrickLink inventory ID → UPDATE
    // If not found → CREATE new lot
    
    // If inventory not provided, fetch it (for backwards compatibility)
    if (!brickowlInventory) {
      brickowlInventory = await getBrickOwlInventory(false);
    }
    
    // Find existing BrickOwl lot by BrickLink inventory ID
    const existingLot = brickowlInventory.find((lot: any) => 
      lot.external_lot_ids?.other === blItem.id.toString()
    );

    const newPrice = blItem.unitPrice ? parseFloat(blItem.unitPrice) : 0;
    const condition = blItem.newOrUsed === 'N' ? 'new' : 'usedg';

    if (existingLot) {
      // UPDATE existing lot
      const existingQty = parseInt(existingLot.qty);
      const existingPrice = parseFloat(existingLot.price);
      
      // Check if anything changed
      const qtyChanged = existingQty !== blItem.quantity;
      const priceChanged = Math.abs(existingPrice - newPrice) > 0.001;
      const remarksChanged = (existingLot.personal_note || '') !== (blItem.remarks || '');
      const descriptionChanged = (existingLot.public_note || '') !== (blItem.description || '');
      
      if (qtyChanged || priceChanged || remarksChanged || descriptionChanged) {
        console.log(`[Sync] Updating ${blItem.itemNo} (BL inv ${blItem.id}): Qty ${existingQty} → ${blItem.quantity}, Price $${existingPrice} → $${newPrice}, Remarks: ${remarksChanged ? 'changed' : 'same'}, Description: ${descriptionChanged ? 'changed' : 'same'}`);
        
        await updateBrickOwlLot({
          lot_id: existingLot.lot_id,
          absolute_quantity: blItem.quantity,
          price: newPrice,
          condition,
          for_sale: 1,
          personal_note: blItem.remarks || undefined,
          public_note: blItem.description || undefined,
        });
        
        return { success: true, action: 'updated' };
      } else {
        console.log(`[Sync] Skipping ${blItem.itemNo} - no changes detected`);
        return { success: true, action: 'skipped' };
      }
    } else {
      // CREATE new lot
      // Lookup BOID only when creating new lots
      const boid = await lookupBoid(blItem.itemNo, blItem.itemType);
      
      if (!boid) {
        return {
          success: false,
          action: 'skipped',
          error: `Could not find BOID for BrickLink item ${blItem.itemNo}`,
        };
      }

      console.log(`[Sync] Creating new lot for ${blItem.itemNo} (BL inv ${blItem.id})`);
      await createBrickOwlLot({
        boid,
        quantity: blItem.quantity,
        price: newPrice,
        condition,
        for_sale: 1,
        external_id_1: blItem.id.toString(), // Store BrickLink inventory ID
        personal_note: blItem.remarks || undefined,      // Internal notes (bin location, etc.)
        public_note: blItem.description || undefined,    // Public notes (condition, etc.)
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
    
    // Note: With BOID+condition matching, we can't efficiently pre-determine "unsynced" items
    // because we'd need to lookup BOID for every BrickLink item (29k+ API calls!)
    // Instead, just return first N items and let syncInventoryItem determine create vs update
    const unsyncedItems = await db
      .select()
      .from(blInventory)
      .limit(limit);
    
    console.log(`Selected ${unsyncedItems.length} BrickLink items to sync (limit: ${limit})`);
    
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

  // Fetch BrickOwl inventory once for efficiency
  const brickowlInventory = await getBrickOwlInventory(false);
  console.log(`Fetched ${brickowlInventory.length} lots from BrickOwl for comparison`);

  // Sync each item
  for (const item of blItems) {
    const syncResult = await syncInventoryItem(item, brickowlInventory);
    result.totalApiCalls += 2; // Estimate: lookup + create/update
    
    if (syncResult.success) {
      if (syncResult.action === 'created') {
        result.lotsCreated++;
      } else if (syncResult.action === 'updated') {
        result.lotsUpdated++;
      } else if (syncResult.action === 'skipped') {
        result.lotsSkipped++;
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

  // Fetch BrickOwl inventory once for efficiency (to detect updates vs creates)
  const brickowlInventory = await getBrickOwlInventory(false);

  // Sync each item
  for (const item of unsyncedItems) {
    const syncResult = await syncInventoryItem(item, brickowlInventory);
    result.totalApiCalls += 2; // Estimate: lookup + create/update
    
    if (syncResult.success) {
      if (syncResult.action === 'created') {
        result.lotsCreated++;
        console.log(`✓ Created: ${item.itemNo} (${item.colorName || 'N/A'}) - ID: ${item.id}`);
      } else if (syncResult.action === 'updated') {
        result.lotsUpdated++;
        console.log(`✓ Updated: ${item.itemNo} (${item.colorName || 'N/A'}) - ID: ${item.id}`);
      } else if (syncResult.action === 'skipped') {
        result.lotsSkipped++;
        console.log(`○ No changes: ${item.itemNo} (${item.colorName || 'N/A'}) - ID: ${item.id}`);
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

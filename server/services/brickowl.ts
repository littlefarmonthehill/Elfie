import { db } from "../db";
import { appSettings, blInventory, blColors } from "@shared/schema";
import { eq, isNotNull, sql } from "drizzle-orm";

// Decode HTML entities from BrickLink notes (&#39; → ', &#40; → (, &#41; → ), etc.)
function decodeHtmlEntities(text: string | null | undefined): string {
  if (!text) return '';
  
  const entityMap: Record<string, string> = {
    '&#39;': "'",
    '&#40;': '(',
    '&#41;': ')',
    '&quot;': '"',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&#x27;': "'",
    '&#x2F;': '/',
  };
  
  let decoded = text;
  for (const [entity, char] of Object.entries(entityMap)) {
    decoded = decoded.replace(new RegExp(entity, 'g'), char);
  }
  
  return decoded;
}

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
  // Get API key from database settings — filter for a row that has the key configured
  const [settings] = await db.select().from(appSettings).where(isNotNull(appSettings.brickowlApiKey)).limit(1);
  
  const apiKey = settings?.brickowlApiKey || process.env.BRICKOWL_API_KEY;
  
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
  // Get API key from database settings — filter for a row that has the key configured
  const [settings] = await db.select().from(appSettings).where(isNotNull(appSettings.brickowlApiKey)).limit(1);
  
  const apiKey = settings?.brickowlApiKey || process.env.BRICKOWL_API_KEY;
  
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
  external_id?: string;  // Use external_id (not external_id_1) to store as external_lot_ids.other
  personal_note?: string;
  public_note?: string;
}): Promise<any> {
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
    ...(data.external_id && { external_id: data.external_id }),  // external_id becomes external_lot_ids.other
    ...(decodedPersonalNote && { personal_note: decodedPersonalNote }),
    ...(decodedPublicNote && { public_note: decodedPublicNote }),
  };
  console.log('[BrickOwl] Creating lot with payload:', JSON.stringify(payload));
  return brickowlPost('/inventory/create', payload);
}

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
}): Promise<any> {
  const updateData: Record<string, string> = {};
  
  if (data.lot_id) updateData.lot_id = data.lot_id;
  if (data.external_id_1) updateData.external_id_1 = data.external_id_1;
  if (data.external_id) updateData.external_id = data.external_id;
  if (data.absolute_quantity !== undefined) updateData.absolute_quantity = data.absolute_quantity.toString();
  if (data.price !== undefined) updateData.price = data.price.toFixed(3);
  if (data.condition) updateData.condition = data.condition;
  if (data.for_sale !== undefined) updateData.for_sale = data.for_sale.toString();
  
  // Decode HTML entities from notes before sending to BrickOwl
  if (data.personal_note !== undefined) {
    updateData.personal_note = decodeHtmlEntities(data.personal_note);
  }
  if (data.public_note !== undefined) {
    updateData.public_note = decodeHtmlEntities(data.public_note);
  }
  
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
  brickowlInventory?: any[],
  mode: 'analysis' | 'full_control' | 'quantity_only' = 'full_control'
): Promise<{
  success: boolean;
  action: 'created' | 'updated' | 'skipped';
  error?: string;
}> {
  try {
    // If inventory not provided, fetch it (for backwards compatibility)
    if (!brickowlInventory) {
      brickowlInventory = await getBrickOwlInventory(false);
    }

    const newPrice = blItem.unitPrice ? parseFloat(blItem.unitPrice) : 0;
    const condition = blItem.newOrUsed === 'N' ? 'new' : 'usedg';

    // ─── STEP 1: Match by BrickLink inventory ID tag (fast, reliable) ───────
    // Lots our sync previously created/tagged will always be found here.
    const taggedLot = brickowlInventory.find((lot: any) =>
      lot.external_lot_ids?.other === blItem.id.toString()
    );

    if (taggedLot) {
      const existingQty = parseInt(taggedLot.qty);
      const existingPrice = parseFloat(taggedLot.price);
      const qtyChanged = existingQty !== blItem.quantity;
      const priceChanged = Math.abs(existingPrice - newPrice) > 0.001;
      const remarksChanged = (taggedLot.personal_note || '') !== (blItem.remarks || '');
      const descriptionChanged = (taggedLot.public_note || '') !== (blItem.description || '');

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
      const untaggedMatches = brickowlInventory.filter((lot: any) =>
        lot.boid === boid && lot.condition === condition
      );

      if (untaggedMatches.length === 1) {
        // Exactly one pre-existing lot for this part + condition — safe to adopt it.
        const untaggedLot = untaggedMatches[0];
        if (mode === 'analysis') {
          console.log(`[Sync] Analysis: would adopt pre-existing BrickOwl lot ${untaggedLot.lot_id} for ${blItem.itemNo} — skipping write`);
          return { success: true, action: 'skipped' };
        }
        console.log(`[Sync] Adopting pre-existing BrickOwl lot ${untaggedLot.lot_id} for ${blItem.itemNo} (BOID ${boid}) and tagging with BL inv ID ${blItem.id}`);
        await updateBrickOwlLot({
          lot_id: untaggedLot.lot_id,
          external_id: blItem.id.toString(), // Tag it so future syncs use Step 1
          absolute_quantity: blItem.quantity,
          price: newPrice,
          condition,
          for_sale: 1,
          personal_note: blItem.remarks || undefined,
          public_note: blItem.description || undefined,
        });
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
          error: `${untaggedMatches.length} duplicate untagged BrickOwl lots found for ${blItem.itemNo} (BOID ${boid}, condition: ${condition}). Clean up duplicates on BrickOwl first.`,
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

    if (mode === 'analysis' || mode === 'quantity_only') {
      // Analysis mode: read-only, never write anything — just build comparison data
      // Quantity-only mode: never create new listings, only update existing ones
      console.log(`[Sync] Skipping ${blItem.itemNo} (${mode} mode — no existing BrickOwl lot)`);
      return { success: true, action: 'skipped' };
    }

    console.log(`[Sync] Creating new lot for ${blItem.itemNo} (BL inv ${blItem.id})`);
    await createBrickOwlLot({
      boid,
      quantity: blItem.quantity,
      price: newPrice,
      condition,
      for_sale: 1,
      external_id: blItem.id.toString(), // Tag immediately so future syncs find it in Step 1
      personal_note: blItem.remarks || undefined,
      public_note: blItem.description || undefined,
    });

    return { success: true, action: 'created' };
  } catch (error) {
    return {
      success: false,
      action: 'skipped',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Sync all BrickLink inventory to BrickOwl
export async function syncBrickLinkToBrickOwl(limit?: number, mode: 'analysis' | 'full_control' | 'quantity_only' = 'full_control', onProgress?: (processed: number, total: number) => void): Promise<BrickOwlSyncResult> {
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
  let processed = 0;
  for (const item of blItems) {
    processed++;
    onProgress?.(processed, blItems.length);
    const syncResult = await syncInventoryItem(item, brickowlInventory, mode);
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

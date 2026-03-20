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

// ─── Batch up to 50 inventory/update calls in one HTTP request ──────────────
// BrickOwl bulk/batch endpoint: POST /v1/bulk/batch
// Rate limit: 100 batch requests/min → 600ms between calls
// Throughput: 50 items × 100 batches/min = 5,000 updates/min
async function brickowlBatch(
  requests: Array<{ endpoint: string; request_method: 'GET' | 'POST'; params: Record<string, any>[] }>
): Promise<any[]> {
  const [settings] = await db.select().from(appSettings).where(isNotNull(appSettings.brickowlApiKey)).limit(1);
  const apiKey = settings?.brickowlApiKey || process.env.BRICKOWL_API_KEY;
  if (!apiKey) throw new Error('BrickOwl API key not configured. Please add it in Settings > API Credentials.');

  const formData = new URLSearchParams({
    key: apiKey,
    requests: JSON.stringify(requests),
  });

  const response = await fetch('https://api.brickowl.com/v1/bulk/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BrickOwl Batch API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : (data.responses || []);
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
  mode: 'analysis' | 'full_control' | 'quantity_only' = 'full_control',
  taggedLotMap?: Map<string, any>
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
    // Use the pre-built Map for O(1) lookup when available; fall back to linear scan.
    const taggedLot = taggedLotMap
      ? taggedLotMap.get(blItem.id.toString())
      : brickowlInventory.find((lot: any) => lot.external_lot_ids?.other === blItem.id.toString());

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

// ─── Industry-standard delta sync with bulk batching ─────────────────────────
//
// Strategy:
//   Phase 1 — Pure in-memory comparison (no API calls, no delays).
//             Classify every BL item into one of three buckets:
//               toUpdate  — tagged lot exists in BO and fields have changed
//               toAdopt   — no tagged lot; needs BOID lookup (full_control only)
//               skipped   — no changes or read-only mode
//
//   Phase 2 — Apply writes via BrickOwl's bulk/batch endpoint (max 50 per call,
//             100 calls/min → 600ms gap between batches).
//             Throughput: 50 × 100 = 5,000 lots/min for changed items only.
//             Items with no changes never touch the API.
//
// Compared to the old per-item loop (120ms × N items regardless of changes),
// this is typically 10–100× faster for a normal sync where most lots are stable.

export async function syncBrickLinkToBrickOwl(
  limit?: number,
  mode: 'analysis' | 'full_control' | 'quantity_only' = 'full_control',
  onProgress?: (processed: number, total: number) => void
): Promise<BrickOwlSyncResult> {
  const result: BrickOwlSyncResult = {
    lotsCreated: 0,
    lotsUpdated: 0,
    lotsSkipped: 0,
    errors: [],
    totalApiCalls: 0,
  };

  // ── Fetch both inventories once ──────────────────────────────────────────
  let query = db.select().from(blInventory);
  if (limit) query = query.limit(limit) as any;
  const blItems = await query;

  console.log(`[ChannelSync] ${blItems.length} BrickLink items to compare`);

  const brickowlInventory = await getBrickOwlInventory(false);
  console.log(`[ChannelSync] ${brickowlInventory.length} BrickOwl lots fetched`);

  // O(1) lookup: BL inventory ID → BrickOwl lot (tagged lots only)
  const taggedLotMap = new Map<string, any>();
  for (const lot of brickowlInventory) {
    const extId = lot.external_lot_ids?.other;
    if (extId) taggedLotMap.set(extId, lot);
  }

  // ── Phase 1: In-memory delta detection (no API calls) ────────────────────
  type UpdateJob = {
    blItemNo: string;
    lot_id: string;
    absolute_quantity: number;
    price: number;
    condition: string;
    personal_note?: string;
    public_note?: string;
    external_id?: string; // set when adopting an untagged lot
  };

  const toUpdate: UpdateJob[] = [];
  const toAdopt: Array<typeof blItems[number]> = []; // needs BOID lookup

  let phaseProgress = 0;
  for (const item of blItems) {
    phaseProgress++;
    // In analysis mode report progress during Phase 1 (there is no Phase 2)
    if (mode === 'analysis') onProgress?.(phaseProgress, blItems.length);

    const newPrice = item.unitPrice ? parseFloat(item.unitPrice) : 0;
    const condition = item.newOrUsed === 'N' ? 'new' : 'usedg';

    const taggedLot = taggedLotMap.get(item.id.toString());

    if (taggedLot) {
      const qtyChanged       = parseInt(taggedLot.qty) !== item.quantity;
      const priceChanged     = Math.abs(parseFloat(taggedLot.price) - newPrice) > 0.001;
      const remarksChanged   = (taggedLot.personal_note || '') !== (item.remarks || '');
      const descChanged      = (taggedLot.public_note   || '') !== (item.description || '');

      if (qtyChanged || priceChanged || remarksChanged || descChanged) {
        if (mode === 'analysis') {
          result.lotsSkipped++; // analysis: report discrepancy but don't write
        } else {
          toUpdate.push({
            blItemNo: item.itemNo,
            lot_id: taggedLot.lot_id,
            absolute_quantity: item.quantity,
            price: newPrice,
            condition,
            personal_note: decodeHtmlEntities(item.remarks  || '') || undefined,
            public_note:   decodeHtmlEntities(item.description || '') || undefined,
          });
        }
      } else {
        result.lotsSkipped++;
      }
    } else if (mode === 'full_control') {
      // No tagged lot — queue for BOID lookup (Phase 2b)
      toAdopt.push(item);
    } else {
      // quantity_only / analysis: nothing to do for untagged items
      result.lotsSkipped++;
    }
  }

  console.log(
    `[ChannelSync] Phase 1 complete — ${toUpdate.length} to update, ` +
    `${toAdopt.length} to adopt/create, ${result.lotsSkipped} skipped`
  );

  if (mode === 'analysis') return result; // analysis stops here

  // ── Phase 2a: Batch-update changed tagged lots ───────────────────────────
  // BrickOwl bulk/batch: max 50 requests per call, 100 calls/min (600ms gap)
  const BATCH_SIZE = 50;
  const BATCH_GAP_MS = 600;
  let updateProgress = 0;
  const totalPhase2 = toUpdate.length + toAdopt.length;

  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);

    // BrickOwl batch API requires params as an ARRAY: [{"lot_id":"...","absolute_quantity":2}]
    // NOT a plain object — the API returns {"error":"Invalid JSON"} if you send an object.
    const batchRequests = chunk.map(job => ({
      endpoint: 'inventory/update',
      request_method: 'POST' as const,
      params: [{
        lot_id: job.lot_id,
        absolute_quantity: job.absolute_quantity, // number, not string — this is JSON
        price: job.price.toFixed(3),
        condition: job.condition,
        for_sale: 1,
        ...(job.personal_note !== undefined && { personal_note: job.personal_note }),
        ...(job.public_note   !== undefined && { public_note:   job.public_note   }),
        ...(job.external_id   !== undefined && { external_id:   job.external_id   }),
      }],
    }));

    try {
      const responses = await brickowlBatch(batchRequests);
      result.totalApiCalls++;

      // Count successes/errors per response
      responses.forEach((resp: any, idx: number) => {
        const job = chunk[idx];
        if (resp && (resp.status === 'OK' || resp.lot_id || resp.success)) {
          result.lotsUpdated++;
          console.log(`[ChannelSync] ✓ Updated lot ${job.lot_id} (${job.blItemNo}) qty→${job.absolute_quantity}`);
        } else {
          result.errors.push(`${job.blItemNo}: batch update failed — ${JSON.stringify(resp)}`);
          result.lotsSkipped++;
        }
      });

      // If the batch returned fewer responses than requests, mark the rest as errors
      if (responses.length < chunk.length) {
        for (let j = responses.length; j < chunk.length; j++) {
          result.errors.push(`${chunk[j].blItemNo}: no response in batch`);
          result.lotsSkipped++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      chunk.forEach(job => {
        result.errors.push(`${job.blItemNo}: ${msg}`);
        result.lotsSkipped++;
      });
      console.error(`[ChannelSync] Batch error (chunk ${i}–${i + chunk.length}):`, msg);
    }

    updateProgress += chunk.length;
    onProgress?.(updateProgress, totalPhase2);

    if (i + BATCH_SIZE < toUpdate.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_GAP_MS));
    }
  }

  // ── Phase 2b: Adopt / create untagged lots (full_control only) ───────────
  // Each item needs an individual BOID lookup first, so these remain sequential.
  // Rate limit: individual calls at 600 req/min → 100ms gap.
  const INDIVIDUAL_GAP_MS = 100;

  for (const item of toAdopt) {
    const newPrice = item.unitPrice ? parseFloat(item.unitPrice) : 0;
    const condition = item.newOrUsed === 'N' ? 'new' : 'usedg';

    const boid = await lookupBoid(item.itemNo, item.itemType);
    result.totalApiCalls++;

    if (!boid) {
      result.errors.push(`${item.itemNo}: BOID lookup failed`);
      result.lotsSkipped++;
    } else {
      const untagged = brickowlInventory.filter(
        (lot: any) => lot.boid === boid && lot.condition === condition
      );

      if (untagged.length === 1) {
        // Adopt single pre-existing untagged lot
        try {
          await updateBrickOwlLot({
            lot_id: untagged[0].lot_id,
            external_id: item.id.toString(),
            absolute_quantity: item.quantity,
            price: newPrice,
            condition,
            for_sale: 1,
            personal_note: item.remarks    || undefined,
            public_note:   item.description || undefined,
          });
          result.lotsUpdated++;
          result.totalApiCalls++;
          console.log(`[ChannelSync] ✓ Adopted lot ${untagged[0].lot_id} for ${item.itemNo}`);
        } catch (err) {
          result.errors.push(`${item.itemNo}: adopt failed — ${err instanceof Error ? err.message : err}`);
          result.lotsSkipped++;
        }
      } else if (untagged.length > 1) {
        const ids = untagged.map((l: any) => l.lot_id).join(', ');
        result.errors.push(`${item.itemNo}: ${untagged.length} ambiguous untagged lots (${ids}) — resolve on BrickOwl first`);
        result.lotsSkipped++;
      } else {
        // Create new lot
        try {
          await createBrickOwlLot({
            boid,
            quantity: item.quantity,
            price: newPrice,
            condition,
            for_sale: 1,
            external_id: item.id.toString(),
            personal_note: item.remarks    || undefined,
            public_note:   item.description || undefined,
          });
          result.lotsCreated++;
          result.totalApiCalls++;
          console.log(`[ChannelSync] ✓ Created lot for ${item.itemNo} (BOID ${boid})`);
        } catch (err) {
          result.errors.push(`${item.itemNo}: create failed — ${err instanceof Error ? err.message : err}`);
          result.lotsSkipped++;
        }
      }
    }

    updateProgress++;
    onProgress?.(updateProgress, totalPhase2);
    await new Promise(resolve => setTimeout(resolve, INDIVIDUAL_GAP_MS));
  }

  console.log(
    `[ChannelSync] Done — ${result.lotsUpdated} updated, ${result.lotsCreated} created, ` +
    `${result.lotsSkipped} skipped, ${result.errors.length} errors, ` +
    `${result.totalApiCalls} API calls`
  );

  return result;
}

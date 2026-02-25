import { db } from "../db";
import { blInventory } from "@shared/schema";
import { sql, inArray } from "drizzle-orm";
import https from "https";

export interface RebrickableImageSyncResult {
  imagesProcessed: number;
  imagesFetched: number;
  errors: number;
}

export interface BulkImageSyncResult {
  totalBatches: number;
  totalImagesProcessed: number;
  totalImagesFetched: number;
  totalErrors: number;
  completed: boolean;
}

const REBRICKABLE_API_KEY = process.env.REBRICKABLE_API_KEY;
const REBRICKABLE_API_BASE = 'https://rebrickable.com/api/v3';

// ── Color mapping cache ───────────────────────────────────────────────────────
// Rebrickable and BrickLink use different color ID systems.
// We fetch the mapping once and cache it for the server lifetime.
let colorMapCache: Map<number, number> | null = null; // BL colorId → Rebrickable colorId

async function getBlToRebrickableColorMap(): Promise<Map<number, number>> {
  if (colorMapCache) return colorMapCache;
  if (!REBRICKABLE_API_KEY) return new Map();

  console.log('[Rebrickable Images] Fetching color ID mapping from Rebrickable...');

  return new Promise((resolve) => {
    const url = `${REBRICKABLE_API_BASE}/lego/colors/?key=${REBRICKABLE_API_KEY}&page_size=300`;
    const request = https.get(url, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try {
          if (response.statusCode === 200) {
            const json = JSON.parse(data);
            const map = new Map<number, number>();
            for (const color of json.results ?? []) {
              const blIds: number[] = color.external_ids?.BrickLink?.ext_ids ?? [];
              for (const blId of blIds) {
                map.set(blId, color.id);
              }
            }
            colorMapCache = map;
            console.log(`[Rebrickable Images] Color map built: ${map.size} BrickLink colors mapped`);
            resolve(map);
          } else {
            console.error(`[Rebrickable Images] Color map fetch failed: HTTP ${response.statusCode}`);
            resolve(new Map());
          }
        } catch (e) {
          console.error('[Rebrickable Images] Color map parse error:', e);
          resolve(new Map());
        }
      });
    });
    request.on('error', (e) => {
      console.error('[Rebrickable Images] Color map request error:', e);
      resolve(new Map());
    });
    request.setTimeout(15000, () => { request.destroy(); resolve(new Map()); });
  });
}

// Invalidate cache (call after a long server uptime to refresh mappings)
export function invalidateColorMapCache() {
  colorMapCache = null;
}

// ── Core image fetch using Rebrickable color IDs ──────────────────────────────
async function fetchPartImageUrl(
  partNum: string,
  rbColorId: number,
  retryCount: number = 0
): Promise<string | null> {
  if (!REBRICKABLE_API_KEY) return null;

  return new Promise((resolve) => {
    const url = `${REBRICKABLE_API_BASE}/lego/parts/${partNum}/colors/${rbColorId}/?key=${REBRICKABLE_API_KEY}`;

    const request = https.get(url, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', async () => {
        try {
          if (response.statusCode === 200) {
            const json = JSON.parse(data);
            const imageUrl = json.part_img_url ?? null;
            if (imageUrl) {
              console.log(`[Rebrickable Images] ✓ ${partNum} color ${rbColorId} → ${imageUrl}`);
            }
            resolve(imageUrl);
          } else if (response.statusCode === 404) {
            resolve(null);
          } else if (response.statusCode === 429) {
            if (retryCount < 3) {
              const wait = Math.min(30000, 5000 * Math.pow(2, retryCount));
              console.warn(`[Rebrickable Images] Rate limit — waiting ${wait}ms (retry ${retryCount + 1}/3)`);
              await new Promise(r => setTimeout(r, wait));
              resolve(await fetchPartImageUrl(partNum, rbColorId, retryCount + 1));
            } else {
              console.error(`[Rebrickable Images] Max retries reached for ${partNum} color ${rbColorId}`);
              resolve(null);
            }
          } else {
            console.error(`[Rebrickable Images] HTTP ${response.statusCode} for ${partNum} color ${rbColorId}`);
            resolve(null);
          }
        } catch (e) {
          console.error(`[Rebrickable Images] Parse error for ${partNum}:`, e);
          resolve(null);
        }
      });
    });
    request.on('error', (e) => {
      console.error(`[Rebrickable Images] Request error for ${partNum}:`, e);
      resolve(null);
    });
    request.setTimeout(30000, () => {
      request.destroy();
      resolve(null);
    });
  });
}

// ── Public helper: fetch image by BrickLink color ID ─────────────────────────
// Used by inventory sync for newly added items
export async function fetchImageByBlColor(
  partNum: string,
  blColorId: number
): Promise<string | null> {
  const colorMap = await getBlToRebrickableColorMap();
  const rbColorId = colorMap.get(blColorId);
  if (rbColorId === undefined) {
    console.log(`[Rebrickable Images] No RB mapping for BL color ${blColorId} (part ${partNum})`);
    return null;
  }
  return fetchPartImageUrl(partNum, rbColorId);
}

// ── Post-inventory-sync: background image fetch for newly inserted items ──────
// Called fire-and-forget after inventory sync inserts new items.
// Rate-limited to avoid hammering Rebrickable (1 request per 3.5 seconds).
export function scheduleImageFetchForNewItems(
  newItems: Array<{ id: number; itemNo: string; colorId: number | null; itemType: string }>
) {
  const partsOnly = newItems.filter(
    (item) => item.itemType === 'PART' && item.colorId !== null && item.itemNo
  );
  if (partsOnly.length === 0) return;

  console.log(`[Rebrickable Images] Scheduling background image fetch for ${partsOnly.length} new parts...`);

  // Fire-and-forget — intentionally not awaited
  (async () => {
    const colorMap = await getBlToRebrickableColorMap();
    let fetched = 0;
    for (const item of partsOnly) {
      try {
        const rbColorId = colorMap.get(item.colorId!);
        if (rbColorId === undefined) continue;
        const imageUrl = await fetchPartImageUrl(item.itemNo, rbColorId);
        if (imageUrl) {
          await db.update(blInventory)
            .set({ imageUrl, thumbnailUrl: imageUrl })
            .where(sql`${blInventory.id} = ${item.id} AND ${blInventory.imageUrl} IS NULL`);
          fetched++;
        }
      } catch (e) {
        console.error(`[Rebrickable Images] Error fetching image for new item ${item.itemNo}:`, e);
      }
      // Rate limit: 3.5s between requests (Rebrickable allows ~1000/day free)
      await new Promise(r => setTimeout(r, 3500));
    }
    console.log(`[Rebrickable Images] Background fetch complete: ${fetched}/${partsOnly.length} images obtained`);
  })();
}

// ── Batch sync: fill images for existing inventory items that have none ────────
export async function syncRebrickableImages(): Promise<RebrickableImageSyncResult> {
  if (!REBRICKABLE_API_KEY) {
    console.error('[Rebrickable Images] REBRICKABLE_API_KEY not set');
    return { imagesProcessed: 0, imagesFetched: 0, errors: 1 };
  }

  // Build color map first
  const colorMap = await getBlToRebrickableColorMap();
  if (colorMap.size === 0) {
    console.error('[Rebrickable Images] Empty color map — skipping sync');
    return { imagesProcessed: 0, imagesFetched: 0, errors: 1 };
  }

  console.log('[Rebrickable Images] Starting image sync for items without images...');

  let imagesProcessed = 0;
  let imagesFetched = 0;
  let errors = 0;

  try {
    const itemsWithoutImages = await db
      .select({ id: blInventory.id, itemNo: blInventory.itemNo, colorId: blInventory.colorId })
      .from(blInventory)
      .where(sql`(${blInventory.imageUrl} IS NULL OR ${blInventory.imageUrl} = '') AND ${blInventory.itemType} = 'PART'`)
      .limit(100);

    console.log(`[Rebrickable Images] Found ${itemsWithoutImages.length} PART items without images`);
    if (itemsWithoutImages.length === 0) return { imagesProcessed: 0, imagesFetched: 0, errors: 0 };

    for (const item of itemsWithoutImages) {
      imagesProcessed++;
      try {
        if (item.colorId === null) continue;

        const rbColorId = colorMap.get(item.colorId);
        if (rbColorId === undefined) {
          console.log(`[Rebrickable Images] No RB color mapping for BL color ${item.colorId} (${item.itemNo})`);
          continue;
        }

        const imageUrl = await fetchPartImageUrl(item.itemNo, rbColorId);
        if (imageUrl) {
          await db.update(blInventory)
            .set({ imageUrl, thumbnailUrl: imageUrl })
            .where(sql`${blInventory.id} = ${item.id}`);
          imagesFetched++;
          console.log(`[Rebrickable Images] ✓ Saved image for ${item.itemNo} (BL:${item.colorId}→RB:${rbColorId})`);
        }
      } catch (e) {
        console.error(`[Rebrickable Images] Error for ${item.itemNo}:`, e);
        errors++;
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log(`[Rebrickable Images] Sync complete: ${imagesFetched} fetched, ${errors} errors`);
    return { imagesProcessed, imagesFetched, errors };
  } catch (e) {
    console.error('[Rebrickable Images] Sync failed:', e);
    throw e;
  }
}

// ── Bulk sync driver ──────────────────────────────────────────────────────────
export async function bulkSyncRebrickableImages(maxBatches = 500): Promise<BulkImageSyncResult> {
  if (!REBRICKABLE_API_KEY) {
    return { totalBatches: 0, totalImagesProcessed: 0, totalImagesFetched: 0, totalErrors: 1, completed: false };
  }

  console.log('[Rebrickable Images] Starting BULK image sync...');
  let totalBatches = 0;
  let totalImagesProcessed = 0;
  let totalImagesFetched = 0;
  let totalErrors = 0;
  let hasMore = true;

  while (hasMore && totalBatches < maxBatches) {
    totalBatches++;
    console.log(`[Rebrickable Images] Batch ${totalBatches}/${maxBatches}...`);
    const result = await syncRebrickableImages();
    totalImagesProcessed += result.imagesProcessed;
    totalImagesFetched += result.imagesFetched;
    totalErrors += result.errors;
    if (result.imagesProcessed === 0) {
      hasMore = false;
      console.log('[Rebrickable Images] Bulk sync complete — no more items');
    } else {
      console.log(`[Rebrickable Images] Progress: ${totalImagesFetched} total images across ${totalBatches} batches`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  return {
    totalBatches,
    totalImagesProcessed,
    totalImagesFetched,
    totalErrors,
    completed: !hasMore,
  };
}

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

// ── Color mapping cache ────────────────────────────────────────────────────────
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

export function invalidateColorMapCache() {
  colorMapCache = null;
}

// ── Core image fetch ──────────────────────────────────────────────────────────
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
            resolve(json.part_img_url ?? null);
          } else if (response.statusCode === 404) {
            resolve(null);
          } else if (response.statusCode === 429) {
            if (retryCount < 3) {
              const wait = Math.min(30000, 5000 * Math.pow(2, retryCount));
              console.warn(`[Rebrickable Images] Rate limit — waiting ${wait}ms (retry ${retryCount + 1}/3)`);
              await new Promise(r => setTimeout(r, wait));
              resolve(await fetchPartImageUrl(partNum, rbColorId, retryCount + 1));
            } else {
              console.error(`[Rebrickable Images] Max retries reached for ${partNum}/${rbColorId}`);
              resolve(null);
            }
          } else {
            console.error(`[Rebrickable Images] HTTP ${response.statusCode} for ${partNum}/${rbColorId}`);
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    });
    request.on('error', () => resolve(null));
    request.setTimeout(30000, () => { request.destroy(); resolve(null); });
  });
}

// ── Optimisation 1: copy images from existing inventory rows ──────────────────
// Many lots share the same (itemNo, colorId). If ANY row already has an image
// for that pair we can fill the rest with a single SQL join — no API call needed.
async function copyImagesFromExistingInventory(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE bl_inventory AS target
    SET    image_url     = source.image_url,
           thumbnail_url = source.thumbnail_url
    FROM (
      SELECT DISTINCT ON (item_no, color_id)
             item_no, color_id, image_url, thumbnail_url
      FROM   bl_inventory
      WHERE  image_url IS NOT NULL AND image_url != ''
             AND item_type = 'PART'
    ) AS source
    WHERE  target.image_url IS NULL
      AND  target.item_no   = source.item_no
      AND  target.color_id  = source.color_id
      AND  target.item_type = 'PART'
  `);
  return (result as any).rowCount ?? 0;
}

// ── Optimisation 2: fetch image by BL color ID (public helper) ────────────────
export async function fetchImageByBlColor(
  partNum: string,
  blColorId: number
): Promise<string | null> {
  const colorMap = await getBlToRebrickableColorMap();
  const rbColorId = colorMap.get(blColorId);
  if (rbColorId === undefined) return null;
  return fetchPartImageUrl(partNum, rbColorId);
}

// ── Post-inventory-sync: background image fetch for newly inserted items ───────
// Three-stage approach:
//   Stage 1 — SQL copy: fill any item whose (itemNo, colorId) already has an image
//             elsewhere in inventory. Zero API calls.
//   Stage 2 — De-duplicate: group remaining items by (itemNo, colorId) so we make
//             exactly ONE API call per unique pair instead of one per lot.
//   Stage 3 — Batch update: after each API hit, write the URL to ALL matching rows
//             in one UPDATE statement.
export function scheduleImageFetchForNewItems(
  newItems: Array<{ id: number; itemNo: string; colorId: number | null; itemType: string }>
) {
  const partsOnly = newItems.filter(
    (item) => item.itemType === 'PART' && item.colorId !== null && item.itemNo
  );
  if (partsOnly.length === 0) return;

  console.log(`[Rebrickable Images] Scheduling background fetch for ${partsOnly.length} new parts...`);

  (async () => {
    try {
      // Stage 1: SQL copy — instant fill for items sharing a known (itemNo, colorId)
      const copied = await copyImagesFromExistingInventory();
      if (copied > 0) {
        console.log(`[Rebrickable Images] Stage 1: copied ${copied} images from existing inventory (0 API calls)`);
      }

      // Stage 2: find which new items STILL have no image after the SQL copy
      const ids = partsOnly.map(i => i.id);
      const stillMissing = await db
        .select({ id: blInventory.id, itemNo: blInventory.itemNo, colorId: blInventory.colorId })
        .from(blInventory)
        .where(sql`${blInventory.id} = ANY(ARRAY[${sql.join(ids.map(id => sql`${id}`), sql`, `)}]::int[])
                   AND (${blInventory.imageUrl} IS NULL OR ${blInventory.imageUrl} = '')`);

      if (stillMissing.length === 0) {
        console.log('[Rebrickable Images] All new items covered by SQL copy — no API calls needed');
        return;
      }

      // Stage 3: de-duplicate by (itemNo, colorId) — one API call per unique pair
      const seen = new Set<string>();
      const uniquePairs: Array<{ itemNo: string; colorId: number }> = [];
      for (const item of stillMissing) {
        if (item.colorId === null) continue;
        const key = `${item.itemNo}_${item.colorId}`;
        if (!seen.has(key)) { seen.add(key); uniquePairs.push({ itemNo: item.itemNo, colorId: item.colorId }); }
      }

      console.log(`[Rebrickable Images] Stage 2: ${stillMissing.length} items → ${uniquePairs.length} unique (part, color) pairs need API fetch`);

      const colorMap = await getBlToRebrickableColorMap();
      let fetched = 0;

      for (const pair of uniquePairs) {
        const rbColorId = colorMap.get(pair.colorId);
        if (rbColorId === undefined) continue;

        const imageUrl = await fetchPartImageUrl(pair.itemNo, rbColorId);
        if (imageUrl) {
          // Update ALL rows with this (itemNo, colorId) — covers every condition/lot
          await db.update(blInventory)
            .set({ imageUrl, thumbnailUrl: imageUrl })
            .where(sql`${blInventory.itemNo} = ${pair.itemNo}
                       AND ${blInventory.colorId} = ${pair.colorId}
                       AND (${blInventory.imageUrl} IS NULL OR ${blInventory.imageUrl} = '')`);
          fetched++;
          console.log(`[Rebrickable Images] ✓ ${pair.itemNo} color ${pair.colorId} → saved`);
        }

        // Rate limit: conservative delay between API calls
        await new Promise(r => setTimeout(r, 3000));
      }

      console.log(`[Rebrickable Images] Background fetch complete: ${fetched}/${uniquePairs.length} pairs obtained (covered ${stillMissing.length} items)`);
    } catch (e) {
      console.error('[Rebrickable Images] Background fetch error:', e);
    }
  })();
}

// ── Batch sync: fill existing inventory items that have no image ───────────────
export async function syncRebrickableImages(): Promise<RebrickableImageSyncResult> {
  if (!REBRICKABLE_API_KEY) {
    return { imagesProcessed: 0, imagesFetched: 0, errors: 1 };
  }

  // Stage 1: SQL copy fills items for free before any API call
  const copied = await copyImagesFromExistingInventory();
  if (copied > 0) {
    console.log(`[Rebrickable Images] SQL copy filled ${copied} items from existing inventory`);
  }

  const colorMap = await getBlToRebrickableColorMap();
  if (colorMap.size === 0) {
    return { imagesProcessed: 0, imagesFetched: 0, errors: 1 };
  }

  // Stage 2: query only items still missing, de-duplicated by (itemNo, colorId)
  const itemsWithoutImages = await db.execute(sql`
    SELECT DISTINCT ON (item_no, color_id)
           id, item_no AS "itemNo", color_id AS "colorId"
    FROM   bl_inventory
    WHERE  (image_url IS NULL OR image_url = '')
      AND  item_type = 'PART'
      AND  color_id IS NOT NULL
    LIMIT  100
  `) as any;

  const items = (itemsWithoutImages.rows ?? itemsWithoutImages) as Array<{ id: number; itemNo: string; colorId: number }>;

  if (items.length === 0) {
    return { imagesProcessed: 0, imagesFetched: 0, errors: 0 };
  }

  console.log(`[Rebrickable Images] ${items.length} unique (part, color) pairs need API fetch`);

  let imagesFetched = 0;
  let errors = 0;

  for (const item of items) {
    try {
      const rbColorId = colorMap.get(item.colorId);
      if (rbColorId === undefined) continue;

      const imageUrl = await fetchPartImageUrl(item.itemNo, rbColorId);
      if (imageUrl) {
        // Update ALL rows with this (itemNo, colorId) in one statement
        await db.update(blInventory)
          .set({ imageUrl, thumbnailUrl: imageUrl })
          .where(sql`${blInventory.itemNo} = ${item.itemNo}
                     AND ${blInventory.colorId} = ${item.colorId}
                     AND (${blInventory.imageUrl} IS NULL OR ${blInventory.imageUrl} = '')`);
        imagesFetched++;
      }
    } catch (e) {
      console.error(`[Rebrickable Images] Error for ${item.itemNo}:`, e);
      errors++;
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`[Rebrickable Images] Sync complete: ${imagesFetched} fetched, ${errors} errors`);
  return { imagesProcessed: items.length, imagesFetched, errors };
}

// ── Bulk sync driver ───────────────────────────────────────────────────────────
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
    const result = await syncRebrickableImages();
    totalImagesProcessed += result.imagesProcessed;
    totalImagesFetched += result.imagesFetched;
    totalErrors += result.errors;
    if (result.imagesProcessed === 0) {
      hasMore = false;
    } else {
      console.log(`[Rebrickable Images] Progress: ${totalImagesFetched} images across ${totalBatches} batches`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  return { totalBatches, totalImagesProcessed, totalImagesFetched, totalErrors, completed: !hasMore };
}

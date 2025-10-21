import { db } from "../db";
import { blInventory } from "@shared/schema";
import { isNull, sql } from "drizzle-orm";
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

// Fetch part image URL from Rebrickable API
async function fetchPartImageUrl(partNum: string, colorId: number): Promise<string | null> {
  if (!REBRICKABLE_API_KEY) {
    console.error('[Rebrickable Images] API key not configured');
    return null;
  }

  return new Promise((resolve) => {
    const url = `${REBRICKABLE_API_BASE}/lego/parts/${partNum}/colors/${colorId}/?key=${REBRICKABLE_API_KEY}`;
    
    https.get(url, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        try {
          if (response.statusCode === 200) {
            const json = JSON.parse(data);
            // Return the part_img_url which points to LDraw renders
            const imageUrl = json.part_img_url;
            if (imageUrl) {
              resolve(imageUrl);
            } else {
              console.warn(`[Rebrickable Images] No image URL for part ${partNum} color ${colorId}`);
              resolve(null);
            }
          } else if (response.statusCode === 404) {
            // Part-color combination doesn't exist in Rebrickable
            resolve(null);
          } else {
            console.error(`[Rebrickable Images] API error ${response.statusCode} for part ${partNum} color ${colorId}`);
            resolve(null);
          }
        } catch (error) {
          console.error(`[Rebrickable Images] Parse error for part ${partNum}:`, error);
          resolve(null);
        }
      });
    }).on('error', (error) => {
      console.error(`[Rebrickable Images] Request error for part ${partNum}:`, error);
      resolve(null);
    });
  });
}

// Sync images for inventory items without images
export async function syncRebrickableImages(): Promise<RebrickableImageSyncResult> {
  console.log('[Rebrickable Images] Starting image sync for items without images...');
  
  if (!REBRICKABLE_API_KEY) {
    console.error('[Rebrickable Images] REBRICKABLE_API_KEY not set in environment variables');
    return {
      imagesProcessed: 0,
      imagesFetched: 0,
      errors: 1,
    };
  }

  let imagesProcessed = 0;
  let imagesFetched = 0;
  let errors = 0;

  try {
    // Find all inventory items without images
    const itemsWithoutImages = await db
      .select({
        id: blInventory.id,
        itemNo: blInventory.itemNo,
        colorId: blInventory.colorId,
      })
      .from(blInventory)
      .where(
        sql`${blInventory.imageUrl} IS NULL OR ${blInventory.imageUrl} = ''`
      )
      .limit(100); // Process in batches to avoid rate limiting

    console.log(`[Rebrickable Images] Found ${itemsWithoutImages.length} items without images`);

    if (itemsWithoutImages.length === 0) {
      console.log('[Rebrickable Images] All items already have images');
      return {
        imagesProcessed: 0,
        imagesFetched: 0,
        errors: 0,
      };
    }

    // Process each item
    for (const item of itemsWithoutImages) {
      try {
        imagesProcessed++;
        
        // Skip if colorId is null
        if (item.colorId === null) {
          continue;
        }
        
        // Fetch image URL from Rebrickable
        const imageUrl = await fetchPartImageUrl(item.itemNo, item.colorId);
        
        if (imageUrl) {
          // Update the inventory item with the image URL
          await db
            .update(blInventory)
            .set({ 
              imageUrl: imageUrl,
              thumbnailUrl: imageUrl, // Use same URL for both
            })
            .where(sql`${blInventory.id} = ${item.id}`);
          
          imagesFetched++;
          
          if (imagesFetched % 10 === 0) {
            console.log(`[Rebrickable Images] Fetched ${imagesFetched}/${itemsWithoutImages.length} images...`);
          }
        }
        
        // Rate limiting: small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`[Rebrickable Images] Error processing item ${item.itemNo}:`, error);
        errors++;
      }
    }

    console.log(`[Rebrickable Images] ✓ Sync complete: ${imagesFetched} images fetched, ${errors} errors`);
    
    return {
      imagesProcessed,
      imagesFetched,
      errors,
    };
    
  } catch (error) {
    console.error('[Rebrickable Images] Sync failed:', error);
    throw error;
  }
}

// Bulk sync: keep fetching images until all items have them
export async function bulkSyncRebrickableImages(maxBatches: number = 500): Promise<BulkImageSyncResult> {
  console.log('[Rebrickable Images] Starting BULK image sync...');
  
  if (!REBRICKABLE_API_KEY) {
    console.error('[Rebrickable Images] REBRICKABLE_API_KEY not set in environment variables');
    return {
      totalBatches: 0,
      totalImagesProcessed: 0,
      totalImagesFetched: 0,
      totalErrors: 1,
      completed: false,
    };
  }

  let totalBatches = 0;
  let totalImagesProcessed = 0;
  let totalImagesFetched = 0;
  let totalErrors = 0;
  let hasMoreImages = true;

  try {
    while (hasMoreImages && totalBatches < maxBatches) {
      totalBatches++;
      
      console.log(`[Rebrickable Images] 🔄 Starting batch ${totalBatches}/${maxBatches}...`);
      
      // Run one batch sync
      const batchResult = await syncRebrickableImages();
      
      totalImagesProcessed += batchResult.imagesProcessed;
      totalImagesFetched += batchResult.imagesFetched;
      totalErrors += batchResult.errors;
      
      // Check if there are more images to fetch
      if (batchResult.imagesProcessed === 0) {
        hasMoreImages = false;
        console.log('[Rebrickable Images] ✅ No more images to fetch - bulk sync complete!');
      } else {
        console.log(`[Rebrickable Images] 📊 Progress: ${totalImagesFetched} total images fetched across ${totalBatches} batches`);
        
        // Small delay between batches to be respectful to API
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    const completed = !hasMoreImages;
    
    if (!completed) {
      console.log(`[Rebrickable Images] ⚠️ Reached max batch limit (${maxBatches}). Some images may remain unfetched.`);
    }

    console.log(`[Rebrickable Images] 🎉 Bulk sync finished: ${totalBatches} batches, ${totalImagesFetched} images fetched, ${totalErrors} errors`);
    
    return {
      totalBatches,
      totalImagesProcessed,
      totalImagesFetched,
      totalErrors,
      completed,
    };
    
  } catch (error) {
    console.error('[Rebrickable Images] Bulk sync failed:', error);
    throw error;
  }
}

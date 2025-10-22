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

// Fetch part image URL from Rebrickable API with retry logic and timeout
async function fetchPartImageUrl(partNum: string, colorId: number, retryCount: number = 0): Promise<string | null> {
  if (!REBRICKABLE_API_KEY) {
    console.error('[Rebrickable Images] API key not configured');
    return null;
  }

  return new Promise((resolve) => {
    const url = `${REBRICKABLE_API_BASE}/lego/parts/${partNum}/colors/${colorId}/?key=${REBRICKABLE_API_KEY}`;
    
    console.log(`[Rebrickable Images] Fetching image for part ${partNum} color ${colorId}...`);
    
    const request = https.get(url, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', async () => {
        try {
          if (response.statusCode === 200) {
            const json = JSON.parse(data);
            // Return the part_img_url which points to LDraw renders
            const imageUrl = json.part_img_url;
            if (imageUrl) {
              console.log(`[Rebrickable Images] ✓ Found image for part ${partNum} color ${colorId}`);
              resolve(imageUrl);
            } else {
              console.warn(`[Rebrickable Images] No image URL for part ${partNum} color ${colorId}`);
              resolve(null);
            }
          } else if (response.statusCode === 404) {
            // Part-color combination doesn't exist in Rebrickable
            console.log(`[Rebrickable Images] Part ${partNum} color ${colorId} not found (404)`);
            resolve(null);
          } else if (response.statusCode === 429) {
            // Rate limit hit - implement exponential backoff
            if (retryCount < 3) {
              const waitTime = Math.min(30000, 5000 * Math.pow(2, retryCount)); // 5s, 10s, 20s
              console.warn(`[Rebrickable Images] Rate limit hit for ${partNum} color ${colorId}. Waiting ${waitTime}ms before retry ${retryCount + 1}/3...`);
              await new Promise(r => setTimeout(r, waitTime));
              const result = await fetchPartImageUrl(partNum, colorId, retryCount + 1);
              resolve(result);
            } else {
              console.error(`[Rebrickable Images] Max retries reached for part ${partNum} color ${colorId}`);
              resolve(null);
            }
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

    // Set 30 second timeout for the request
    request.setTimeout(30000, () => {
      console.error(`[Rebrickable Images] Timeout for part ${partNum} color ${colorId} - request took >30s`);
      request.destroy();
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
    for (let i = 0; i < itemsWithoutImages.length; i++) {
      const item = itemsWithoutImages[i];
      try {
        imagesProcessed++;
        
        console.log(`[Rebrickable Images] Processing item ${i + 1}/${itemsWithoutImages.length}: ${item.itemNo} (color ${item.colorId})`);
        
        // Skip if colorId is null
        if (item.colorId === null) {
          console.log(`[Rebrickable Images] Skipping ${item.itemNo} - no color ID`);
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
          console.log(`[Rebrickable Images] ✓ Updated database for ${item.itemNo} (${imagesFetched}/${itemsWithoutImages.length} fetched so far)`);
        } else {
          console.log(`[Rebrickable Images] ✗ No image found for ${item.itemNo} color ${item.colorId}`);
        }
        
        // Rate limiting: longer delay between requests to respect API limits
        // Rebrickable has strict rate limits, so we use 3 second delays
        console.log(`[Rebrickable Images] Waiting 3 seconds before next request...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        
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
        
        // Longer delay between batches to respect strict API rate limits
        await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second delay between batches
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

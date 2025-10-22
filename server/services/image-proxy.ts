import sharp from 'sharp';
import https from 'https';
import http from 'http';
import { db } from '../db';
import { blInventory } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';

interface CachedImage {
  buffer: Buffer;
  timestamp: number;
}

const MAX_CACHE_SIZE = 500; // Maximum number of cached images
const imageCache = new Map<string, CachedImage>();
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const WHITE_THRESHOLD = 240; // Pixels above this value are considered white
const FETCH_TIMEOUT_MS = 10000; // 10 second timeout
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB maximum

export async function fetchImageFromUrl(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    let redirectCount = 0;
    const maxRedirects = 5;
    
    const fetchWithRedirect = (targetUrl: string) => {
      const request = protocol.get(targetUrl, { timeout: FETCH_TIMEOUT_MS }, (response) => {
        // Handle redirects
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          if (redirectCount >= maxRedirects) {
            console.error('[Image Proxy] Too many redirects');
            resolve(null);
            return;
          }
          redirectCount++;
          fetchWithRedirect(response.headers.location);
          return;
        }
        
        if (response.statusCode !== 200) {
          console.error(`[Image Proxy] Failed to fetch image: ${response.statusCode}`);
          resolve(null);
          return;
        }

        const chunks: Buffer[] = [];
        let totalSize = 0;
        
        response.on('data', (chunk) => {
          totalSize += chunk.length;
          if (totalSize > MAX_IMAGE_SIZE) {
            console.error('[Image Proxy] Image too large, aborting');
            request.destroy();
            resolve(null);
            return;
          }
          chunks.push(chunk);
        });
        
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', (error) => {
          console.error('[Image Proxy] Error fetching image:', error);
          resolve(null);
        });
      });
      
      request.on('timeout', () => {
        console.error('[Image Proxy] Request timeout');
        request.destroy();
        resolve(null);
      });
      
      request.on('error', (error) => {
        console.error('[Image Proxy] Request error:', error);
        resolve(null);
      });
    };
    
    fetchWithRedirect(url);
  });
}

export async function removeWhiteBackground(imageBuffer: Buffer): Promise<Buffer> {
  try {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    
    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixelArray = new Uint8ClampedArray(data.buffer);
    const channels = info.channels;

    for (let i = 0; i < pixelArray.length; i += channels) {
      const r = pixelArray[i];
      const g = pixelArray[i + 1];
      const b = pixelArray[i + 2];

      if (r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD) {
        pixelArray[i + 3] = 0;
      }
    }

    const processedImage = await sharp(Buffer.from(pixelArray.buffer), {
      raw: {
        width: info.width,
        height: info.height,
        channels: channels
      }
    })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();

    return processedImage;
  } catch (error) {
    console.error('[Image Proxy] Error removing white background:', error);
    throw error;
  }
}

function evictOldestCacheEntries(): void {
  if (imageCache.size <= MAX_CACHE_SIZE) return;
  
  const entries = Array.from(imageCache.entries())
    .sort((a, b) => a[1].timestamp - b[1].timestamp);
  
  const toRemove = entries.slice(0, imageCache.size - MAX_CACHE_SIZE);
  toRemove.forEach(([key]) => imageCache.delete(key));
  
  console.log(`[Image Proxy] Evicted ${toRemove.length} old cache entries`);
}

export async function getProcessedPartImage(partNum: string, colorId: number): Promise<Buffer | null> {
  const cacheKey = `${partNum}-${colorId}`;
  
  const cached = imageCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
    console.log(`[Image Proxy] Cache hit for ${cacheKey}`);
    return cached.buffer;
  }

  try {
    const inventoryItem = await db
      .select({ imageUrl: blInventory.imageUrl })
      .from(blInventory)
      .where(and(
        eq(blInventory.itemNo, partNum),
        eq(blInventory.colorId, colorId)
      ))
      .limit(1);

    if (!inventoryItem.length || !inventoryItem[0].imageUrl) {
      const anyInventoryItem = await db
        .select({ imageUrl: blInventory.imageUrl })
        .from(blInventory)
        .where(and(
          eq(blInventory.itemNo, partNum),
          sql`${blInventory.imageUrl} IS NOT NULL AND ${blInventory.imageUrl} != ''`
        ))
        .limit(1);
      
      if (!anyInventoryItem.length) {
        console.warn(`[Image Proxy] No image URL found for ${partNum} (any color)`);
        return null;
      }
      
      const imageUrl = anyInventoryItem[0].imageUrl!;
      console.log(`[Image Proxy] Using fallback image for ${cacheKey} from ${imageUrl}`);
      
      const originalBuffer = await fetchImageFromUrl(imageUrl);
      if (!originalBuffer) {
        return null;
      }

      const processedBuffer = await removeWhiteBackground(originalBuffer);
      
      evictOldestCacheEntries();
      imageCache.set(cacheKey, {
        buffer: processedBuffer,
        timestamp: Date.now()
      });

      console.log(`[Image Proxy] Successfully processed and cached ${cacheKey} (fallback)`);
      return processedBuffer;
    }

    const imageUrl = inventoryItem[0].imageUrl;
    console.log(`[Image Proxy] Fetching image for ${cacheKey} from ${imageUrl}`);

    const originalBuffer = await fetchImageFromUrl(imageUrl);
    if (!originalBuffer) {
      return null;
    }

    const processedBuffer = await removeWhiteBackground(originalBuffer);

    evictOldestCacheEntries();
    imageCache.set(cacheKey, {
      buffer: processedBuffer,
      timestamp: Date.now()
    });

    console.log(`[Image Proxy] Successfully processed and cached ${cacheKey}`);
    return processedBuffer;
  } catch (error) {
    console.error(`[Image Proxy] Error processing image for ${partNum} color ${colorId}:`, error);
    return null;
  }
}

export function clearImageCache(partNum?: string, colorId?: number): void {
  if (partNum && colorId !== undefined) {
    const cacheKey = `${partNum}-${colorId}`;
    imageCache.delete(cacheKey);
    console.log(`[Image Proxy] Cleared cache for ${cacheKey}`);
  } else {
    imageCache.clear();
    console.log('[Image Proxy] Cleared entire image cache');
  }
}

export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: imageCache.size,
    keys: Array.from(imageCache.keys())
  };
}

// Process any Rebrickable image URL directly (no database lookup needed)
export async function processImageFromUrl(imageUrl: string): Promise<Buffer | null> {
  // Use URL as cache key
  const cacheKey = `url:${imageUrl}`;
  
  const cached = imageCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
    console.log(`[Image Proxy] Cache hit for URL`);
    return cached.buffer;
  }

  try {
    console.log(`[Image Proxy] Fetching image from ${imageUrl}`);

    const originalBuffer = await fetchImageFromUrl(imageUrl);
    if (!originalBuffer) {
      return null;
    }

    // Check if Remove.bg API key is available for better background removal
    const removeBgApiKey = process.env.REMOVEBG_API_KEY;
    let processedBuffer: Buffer;

    if (removeBgApiKey) {
      console.log(`[Image Proxy] Using Remove.bg API for background removal`);
      try {
        processedBuffer = await removeBackgroundWithRemoveBg(originalBuffer, removeBgApiKey);
      } catch (error) {
        console.warn(`[Image Proxy] Remove.bg failed, falling back to original image:`, error);
        processedBuffer = originalBuffer;
      }
    } else {
      // No API key - just return original image without processing
      console.log(`[Image Proxy] No Remove.bg API key, serving original image`);
      processedBuffer = originalBuffer;
    }

    evictOldestCacheEntries();
    imageCache.set(cacheKey, {
      buffer: processedBuffer,
      timestamp: Date.now()
    });

    console.log(`[Image Proxy] Successfully processed and cached image from URL`);
    return processedBuffer;
  } catch (error) {
    console.error(`[Image Proxy] Error processing image from URL:`, error);
    return null;
  }
}

async function removeBackgroundWithRemoveBg(imageBuffer: Buffer, apiKey: string): Promise<Buffer> {
  const FormData = (await import('form-data')).default;
  const formData = new FormData();
  formData.append('image_file', imageBuffer, { filename: 'image.png' });
  formData.append('size', 'auto');
  formData.append('format', 'png');

  const response = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
    },
    body: formData as any,
  });

  if (!response.ok) {
    throw new Error(`Remove.bg API error: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Persistent image store — the single authoritative layer for LEGO part images.
 *
 * Pipeline (every call goes through this chain):
 *   L1  in-memory Map cache  (process lifetime, max 500 entries, 24 h TTL)
 *   L2  Replit Object Storage (permanent, survives restarts and CDN outages)
 *   L3  BrickLink CDN         (fetched once, then promoted to L2)
 *
 * All consumers — image proxy (UI/PDF), CLIP catalog worker, BrickSpotter
 * confirm-embedding, catalog-detail scheduler, Rebrickable image sync — call
 * getOrFetchImage() so they all operate on the same processed PNG bytes.
 *
 * Storage key format:  images/{typeCode}/{colorId}/{itemNo}.png
 *   typeCode: pn (PART), mn (MINIFIG), sn (SET), gn (GEAR)
 */

import { objectStorageClient } from '../replit_integrations/object_storage/objectStorage';
import { db } from '../db';
import { blCatalog } from '@shared/schema';
import { and, eq, isNull, or, ne, sql } from 'drizzle-orm';
import { fetchImageFromUrl, removeWhiteBackground, canonicalBricklinkImageUrl } from './image-proxy';

// ── In-memory L1 cache ────────────────────────────────────────────────────────

interface CachedEntry { buffer: Buffer; ts: number }
const L1: Map<string, CachedEntry> = new Map();
const L1_TTL_MS  = 24 * 60 * 60 * 1000; // 24 h
const L1_MAX     = 500;

function l1Get(key: string): Buffer | null {
  const e = L1.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > L1_TTL_MS) { L1.delete(key); return null; }
  return e.buffer;
}

function l1Set(key: string, buffer: Buffer) {
  if (L1.size >= L1_MAX) {
    const oldest = [...L1.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, Math.floor(L1_MAX / 4));
    oldest.forEach(([k]) => L1.delete(k));
  }
  L1.set(key, { buffer, ts: Date.now() });
}

// ── Object-storage helpers ────────────────────────────────────────────────────

function getBucketConfig(): { bucketName: string; baseDir: string } | null {
  const raw = process.env.PUBLIC_OBJECT_SEARCH_PATHS ?? '';
  const first = raw.split(',').map(p => p.trim()).find(p => p.length > 0);
  if (!first) return null;
  const parts = first.replace(/^\//, '').split('/');
  if (parts.length < 1 || !parts[0]) return null;
  return { bucketName: parts[0], baseDir: parts.slice(1).join('/') || 'public' };
}

function storageObjectName(typeCode: string, colorId: number, itemNo: string): string {
  return `images/${typeCode}/${colorId}/${itemNo}.png`;
}

function storageKey(itemType: string, colorId: number, itemNo: string): string {
  const t = itemType.toUpperCase();
  const code =
    t === 'P' || t === 'PART'    ? 'pn' :
    t === 'M' || t === 'MINIFIG' ? 'mn' :
    t === 'S' || t === 'SET'     ? 'sn' :
    t === 'G' || t === 'GEAR'    ? 'gn' : 'other';
  return storageObjectName(code, colorId, itemNo);
}

async function readFromObjectStorage(key: string): Promise<Buffer | null> {
  const cfg = getBucketConfig();
  if (!cfg) return null;
  try {
    const objectName = `${cfg.baseDir}/${key}`;
    const bucket = objectStorageClient.bucket(cfg.bucketName);
    const file   = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [content] = await file.download();
    return content as Buffer;
  } catch (err: any) {
    console.warn(`[ImageStore] Object storage read error for ${key}: ${err.message}`);
    return null;
  }
}

async function writeToObjectStorage(key: string, buffer: Buffer): Promise<boolean> {
  const cfg = getBucketConfig();
  if (!cfg) return false;
  try {
    const objectName = `${cfg.baseDir}/${key}`;
    const bucket = objectStorageClient.bucket(cfg.bucketName);
    const file   = bucket.file(objectName);
    await file.save(buffer, { contentType: 'image/png', resumable: false });
    return true;
  } catch (err: any) {
    console.warn(`[ImageStore] Object storage write error for ${key}: ${err.message}`);
    return false;
  }
}

async function markStoredInDb(
  itemType: string,
  itemNo: string,
  colorId: number,
  key: string,
): Promise<void> {
  try {
    await db.update(blCatalog)
      .set({ storedImageKey: key, imageFetchFailed: false, updatedAt: new Date() })
      .where(and(
        eq(blCatalog.itemNo,    itemNo),
        eq(blCatalog.itemType,  itemType),
        eq(blCatalog.colorId,   colorId),
      ));
  } catch {
    // Best-effort — don't fail image serving if DB update fails
  }
}

async function markFetchFailedInDb(
  itemType: string,
  itemNo: string,
  colorId: number,
): Promise<void> {
  try {
    await db.update(blCatalog)
      .set({ imageFetchFailed: true, updatedAt: new Date() })
      .where(and(
        eq(blCatalog.itemNo,   itemNo),
        eq(blCatalog.itemType, itemType),
        eq(blCatalog.colorId,  colorId),
      ));
  } catch {
    // Best-effort
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check whether an image is already in object storage, without fetching it.
 * Useful for deciding whether to trigger a background store job.
 */
export async function isImageStored(
  itemType: string,
  itemNo: string,
  colorId: number,
): Promise<boolean> {
  const rows = await db
    .select({ key: blCatalog.storedImageKey })
    .from(blCatalog)
    .where(and(
      eq(blCatalog.itemNo,   itemNo),
      eq(blCatalog.itemType, itemType),
      eq(blCatalog.colorId,  colorId),
    ))
    .limit(1)
    .catch(() => []);
  return !!rows[0]?.key;
}

/**
 * Core fetch: L1 → L2 → L3.
 * Fetches from CDN if not in L1/L2, processes (white-bg removal), stores in L2,
 * updates DB, and returns the processed buffer.
 *
 * Returns null if no image can be obtained from any source.
 */
export async function getOrFetchImage(
  itemType: string,
  itemNo: string,
  colorId: number,
): Promise<Buffer | null> {
  const key = storageKey(itemType, colorId, itemNo);
  const l1Key = `${itemType}:${itemNo}:${colorId}`;

  // L1 — in-memory
  const cached = l1Get(l1Key);
  if (cached) return cached;

  // L2 — object storage
  const stored = await readFromObjectStorage(key);
  if (stored) {
    l1Set(l1Key, stored);
    return stored;
  }

  // L3 — CDN fetch
  const cdnUrl = canonicalBricklinkImageUrl(itemType, itemNo, colorId);
  if (!cdnUrl) return null;

  const rawBuffer = await fetchImageFromUrl(cdnUrl, true);
  if (!rawBuffer) {
    // Record the 404 so the harvester doesn't waste time re-trying this item
    markFetchFailedInDb(itemType, itemNo, colorId).catch(() => {});
    return null;
  }

  // Process: remove white background → consistent PNG for both display and CLIP
  let processed: Buffer;
  try {
    processed = await removeWhiteBackground(rawBuffer);
  } catch {
    processed = rawBuffer;
  }

  // Promote to L1 immediately so the caller gets the buffer
  l1Set(l1Key, processed);

  // Promote to L2 + update DB in background — don't block the caller
  (async () => {
    const ok = await writeToObjectStorage(key, processed);
    if (ok) {
      await markStoredInDb(itemType, itemNo, colorId, key);
      console.log(`[ImageStore] Stored ${key} in object storage`);
    }
  })().catch(err => console.warn(`[ImageStore] Background promote error: ${err.message}`));

  return processed;
}

/**
 * Fire-and-forget: schedules background fetch + storage for a known item.
 * Called by catalog-detail-scheduler and rebrickable-images after writing a new URL —
 * ensures the bytes end up in object storage without blocking the scheduler.
 */
export function enqueueImageStore(
  itemType: string,
  itemNo: string,
  colorId: number,
): void {
  // Skip item types with no CDN images
  const t = itemType.toUpperCase();
  if (!['P', 'PART', 'M', 'MINIFIG', 'S', 'SET', 'G', 'GEAR'].includes(t)) return;

  getOrFetchImage(itemType, itemNo, colorId).catch(err =>
    console.warn(`[ImageStore] enqueueImageStore error (${itemType}/${itemNo}/${colorId}): ${err.message}`)
  );
}

/**
 * Expose the L1 cache stats (used by existing getCacheStats in image-proxy).
 */
export function getStoreCacheStats(): { size: number; keys: string[] } {
  return { size: L1.size, keys: [...L1.keys()] };
}

// ── Background image harvester ────────────────────────────────────────────────

const HARVESTER_BATCH_SIZE  = 20;   // rows per query
const HARVESTER_INTERVAL_MS = 500;  // 500 ms between requests → ~2 req/sec
const HARVESTER_CYCLE_MS    = 60_000; // pause between full sweeps (1 minute)

let _harvesterRunning = false;

/**
 * Start the background image harvester on server boot.
 *
 * Continuously walks `bl_catalog WHERE stored_image_key IS NULL
 * AND image_fetch_failed IS NOT TRUE AND item_type IN (harvestable types)`
 * in batches of 20, attempting to fetch and store each image at 2 req/sec.
 *
 * When a CDN fetch fails, `image_fetch_failed` is set to true and the row
 * is skipped on future sweeps. Successfully stored rows are skipped once
 * `stored_image_key` is non-null.
 *
 * The harvester is idempotent — safe to call multiple times (only one instance runs).
 */
export function startImageHarvester(): void {
  if (_harvesterRunning) return;
  _harvesterRunning = true;

  (async () => {
    console.log('[ImageHarvester] Started — backfilling stored_image_key in bl_catalog');
    let totalStored  = 0;
    let totalFailed  = 0;
    let sweepCount   = 0;

    while (true) {
      try {
        sweepCount++;
        let batchOffset = 0;
        let sweepStored = 0;
        let sweepFailed = 0;

        while (true) {
          // Fetch a batch of rows that still need images
          const rows = await db
            .select({
              itemNo:   blCatalog.itemNo,
              itemType: blCatalog.itemType,
              colorId:  blCatalog.colorId,
            })
            .from(blCatalog)
            .where(and(
              isNull(blCatalog.storedImageKey),
              or(
                isNull(blCatalog.imageFetchFailed),
                ne(blCatalog.imageFetchFailed, true),
              ),
              sql`${blCatalog.itemType} = ANY(ARRAY['P','PART','M','MINIFIG','S','SET','G','GEAR'])`,
            ))
            .limit(HARVESTER_BATCH_SIZE)
            .offset(batchOffset)
            .catch(() => [] as { itemNo: string; itemType: string; colorId: number }[]);

          if (rows.length === 0) break;

          for (const { itemNo, itemType, colorId } of rows) {
            try {
              const buf = await getOrFetchImage(itemType, itemNo, colorId);
              if (buf) { sweepStored++; totalStored++; }
              else      { sweepFailed++; totalFailed++; }
            } catch {
              sweepFailed++;
              totalFailed++;
            }
            // Rate-limit: 2 images/sec
            await new Promise<void>(r => setTimeout(r, HARVESTER_INTERVAL_MS));
          }

          batchOffset += HARVESTER_BATCH_SIZE;
        }

        if (sweepStored > 0 || sweepFailed > 0) {
          console.log(`[ImageHarvester] Sweep #${sweepCount} — stored: ${sweepStored}, failed: ${sweepFailed} (totals: ${totalStored}/${totalStored + totalFailed})`);
        }

      } catch (err: any) {
        console.warn(`[ImageHarvester] Sweep error: ${err.message}`);
      }

      // Pause before the next sweep
      await new Promise<void>(r => setTimeout(r, HARVESTER_CYCLE_MS));
    }
  })().catch(err => console.error(`[ImageHarvester] Fatal: ${err.message}`));
}

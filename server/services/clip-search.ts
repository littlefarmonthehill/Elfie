/**
 * CLIP-based visual similarity search for Brick Spotter 3000.
 *
 * Stores 512-dim CLIP ViT-B/32 embeddings in the scan_embeddings table and
 * searches them via pgvector cosine distance (<=>).
 *
 * Two embedding sources:
 *   'catalog' — BrickLink CDN reference images (batch-built)
 *   'scan'    — confirmed crops from real Brick Spotter scans (higher quality)
 */

import { db } from '../db';
import { scanEmbeddings } from '../../shared/schema';
import { sql, eq, and } from 'drizzle-orm';
import { embedUrl } from './segmentClient';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClipMatch {
  itemNo: string;
  itemType: string;
  colorId: number | null;
  source: string;
  similarity: number;
}

export interface CatalogBuildProgress {
  done: number;
  total: number;
  current?: string;
  errors: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a float[] as a PostgreSQL vector literal: '[0.1,0.2,...]' */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

// ── Core search ───────────────────────────────────────────────────────────────

/**
 * Find the closest catalog/scan embeddings to a given CLIP vector.
 * Returns up to `limit` matches whose cosine similarity exceeds `minSimilarity`.
 */
export async function findNearestParts(
  embedding: number[],
  limit = 5,
  minSimilarity = 0.60,
): Promise<ClipMatch[]> {
  if (embedding.length !== 512) {
    throw new Error(`Expected 512-dim embedding, got ${embedding.length}`);
  }
  const vecLit = toVectorLiteral(embedding);

  const rows = await db.execute<{
    item_no: string;
    item_type: string;
    color_id: number | null;
    source: string;
    similarity: number;
  }>(sql`
    SELECT
      item_no,
      item_type,
      color_id,
      source,
      1 - (embedding <=> ${vecLit}::vector) AS similarity
    FROM scan_embeddings
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vecLit}::vector
    LIMIT ${limit}
  `);

  return (rows.rows ?? [])
    .filter((r) => r.similarity >= minSimilarity)
    .map((r) => ({
      itemNo: r.item_no,
      itemType: r.item_type,
      colorId: r.color_id,
      source: r.source,
      similarity: Number(r.similarity),
    }));
}

// ── Storage ───────────────────────────────────────────────────────────────────

/** Upsert (by itemNo+colorId+source) a CLIP embedding into scan_embeddings. */
export async function storeScanEmbedding(
  itemNo: string,
  colorId: number | null,
  embedding: number[],
  source: 'catalog' | 'scan',
  itemType = 'PART',
): Promise<void> {
  if (embedding.length !== 512) {
    throw new Error(`Expected 512-dim embedding, got ${embedding.length}`);
  }
  const vecLit = toVectorLiteral(embedding);

  await db.execute(sql`
    INSERT INTO scan_embeddings (item_no, item_type, color_id, embedding, source, clip_model)
    VALUES (
      ${itemNo}, ${itemType}, ${colorId}, ${vecLit}::vector, ${source}, 'ViT-B/32'
    )
    ON CONFLICT DO NOTHING
  `);
}

// ── Catalog builder ───────────────────────────────────────────────────────────

/** BrickLink CDN image URL for a part+color combo. */
export function catalogImageUrl(itemNo: string, colorId: number): string {
  return `https://img.bricklink.com/ItemImage/PN/${colorId}/${itemNo}.png`;
}

/**
 * Batch-embed BrickLink inventory items into scan_embeddings using CDN reference
 * images.  Skips items that already have a 'catalog' embedding.
 *
 * @param items  Array of { itemNo, colorId, itemType? }
 * @param onProgress  Optional callback invoked after each batch
 * @param batchSize  Items per concurrent batch (default 5)
 */
export async function buildCatalogEmbeddings(
  items: Array<{ itemNo: string; colorId: number; itemType?: string }>,
  onProgress?: (p: CatalogBuildProgress) => void,
  batchSize = 5,
): Promise<CatalogBuildProgress> {
  const state: CatalogBuildProgress = { done: 0, total: items.length, errors: 0 };

  // Load items that already have catalog embeddings
  const existingRows = await db.execute<{ item_no: string; color_id: number }>(sql`
    SELECT item_no, color_id FROM scan_embeddings WHERE source = 'catalog'
  `);
  const existing = new Set(
    (existingRows.rows ?? []).map((r) => `${r.item_no}:${r.color_id}`)
  );

  const pending = items.filter(
    (it) => !existing.has(`${it.itemNo}:${it.colorId}`)
  );
  state.total = pending.length;

  if (pending.length === 0) {
    onProgress?.(state);
    return state;
  }

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async (item) => {
        const url = catalogImageUrl(item.itemNo, item.colorId);
        try {
          const embedding = await embedUrl(url);
          await storeScanEmbedding(
            item.itemNo,
            item.colorId,
            embedding,
            'catalog',
            item.itemType ?? 'PART',
          );
        } catch (err: any) {
          // 404/403 = no image on BrickLink CDN for this part/color — silently skip
          const msg = err?.message ?? '';
          if (!msg.includes('404') && !msg.includes('image not available') && !msg.includes('403')) {
            state.errors++;
          }
        }
      })
    );
    state.done += batch.length;
    state.current = batch[batch.length - 1]?.itemNo;
    onProgress?.(state);
  }

  return state;
}

// ── Status ────────────────────────────────────────────────────────────────────

export async function getCatalogEmbeddingStats(): Promise<{
  total: number;
  catalog: number;
  scan: number;
}> {
  const rows = await db.execute<{ source: string; cnt: string }>(sql`
    SELECT source, COUNT(*)::text AS cnt FROM scan_embeddings GROUP BY source
  `);
  let catalog = 0, scan = 0;
  for (const r of rows.rows ?? []) {
    if (r.source === 'catalog') catalog = Number(r.cnt);
    else if (r.source === 'scan')    scan    = Number(r.cnt);
  }
  return { total: catalog + scan, catalog, scan };
}

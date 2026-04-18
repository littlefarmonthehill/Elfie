/**
 * CLIP Self-Training — captures new embeddings from real usage so the local
 * recognizer wins more often over time and Brickognize gets called less.
 *
 * Two side-effects fire on every successful Brickognize identification:
 *  1. The user's actual cropped piece is embedded with the predicted partNo
 *     (source='scan', provenance='scan:<scanId>:<cropIdx>'). Assumed correct
 *     unless the user later explicitly rejects it via removeScanEmbedding().
 *  2. Brickognize's own catalog image URL is downloaded + embedded
 *     (source='brickognize', provenance='bk:<imgUrl>'). Sibling angles
 *     (/1.webp, /2.webp …) are probed opportunistically.
 *
 * All work is fire-and-forget; failures are logged but never block the scan.
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';
import { embedCrop, embedUrl } from './segmentClient';

interface BrickognizeItem {
  id: string;
  name?: string;
  img_url?: string;
  score?: number;
}

const toVecLit = (e: number[]) => `[${e.join(',')}]`;

/**
 * Insert an embedding row idempotently — uniqueness keyed on (item_no, source, provenance).
 * Returns true if inserted, false if a row with the same provenance already existed.
 */
async function insertEmbedding(
  itemNo: string,
  itemType: string,
  embedding: number[],
  source: string,
  provenance: string,
): Promise<boolean> {
  const exists = await db.execute<{ id: string }>(sql`
    SELECT id FROM bl_catalog_clip_embeddings
    WHERE item_no = ${itemNo} AND source = ${source} AND provenance = ${provenance}
    LIMIT 1
  `).then(r => r.rows ?? []);
  if (exists.length > 0) return false;

  await db.execute(sql`
    INSERT INTO bl_catalog_clip_embeddings (item_no, item_type, color_id, embedding, source, clip_model, provenance)
    VALUES (${itemNo}, ${itemType}, NULL, ${toVecLit(embedding)}::vector, ${source}, 'ViT-B/32', ${provenance})
  `);
  return true;
}

/**
 * Probe sibling URLs of a Brickognize thumbnail.
 * Brickognize hosts variants at .../part/<id>/0.webp, /1.webp, /2.webp, …
 * We try indices 1-3 (index 0 is the URL we already have).
 */
function siblingUrls(baseUrl: string): string[] {
  const m = baseUrl.match(/^(.*)\/(\d+)\.(webp|jpg|jpeg|png)(\?.*)?$/i);
  if (!m) return [];
  const [, prefix, , ext, q] = m;
  const out: string[] = [];
  for (let i = 1; i <= 3; i++) {
    out.push(`${prefix}/${i}.${ext}${q ?? ''}`);
  }
  return out;
}

/**
 * Train from one accepted Brickognize prediction.
 * - cropBuffer: the JPEG bytes the user actually scanned (whole-figure crop)
 * - prediction: the top Brickognize item
 * - itemType: 'PART' | 'MINIFIG' | 'SET'
 */
export async function trainFromBrickognizeResult(
  prediction: BrickognizeItem,
  cropBuffer: Buffer | null,
  itemType: string,
  scanId: number,
  cropIdx: number,
): Promise<{ scan: boolean; brickognize: number }> {
  const out = { scan: false, brickognize: 0 };
  const partNo = prediction?.id;
  if (!partNo) return out;

  // 1. Embed the user's actual crop with the predicted partNo (assumed-correct).
  if (cropBuffer && cropBuffer.length > 0) {
    try {
      const emb = await embedCrop(cropBuffer);
      const inserted = await insertEmbedding(
        partNo, itemType, emb, 'scan', `scan:${scanId}:${cropIdx}`,
      );
      out.scan = inserted;
      if (inserted) {
        console.log(`[ClipSelfTrain] +scan ${itemType} ${partNo} from scan ${scanId} crop ${cropIdx}`);
      }
    } catch (err: any) {
      console.warn(`[ClipSelfTrain] scan-embed failed for ${partNo}: ${err?.message ?? err}`);
    }
  }

  // 2. Embed Brickognize's primary image, plus probe up to 3 sibling angles.
  if (prediction.img_url) {
    const urls = [prediction.img_url, ...siblingUrls(prediction.img_url)];
    for (const url of urls) {
      try {
        const emb = await embedUrl(url);
        const inserted = await insertEmbedding(
          partNo, itemType, emb, 'brickognize', `bk:${url}`,
        );
        if (inserted) {
          out.brickognize++;
          console.log(`[ClipSelfTrain] +brickognize ${itemType} ${partNo} from ${url}`);
        }
      } catch {
        // Sibling URLs frequently 404 (most parts only have 1 image); silent.
      }
    }
  }

  return out;
}

/**
 * Remove the scan-sourced embedding for a specific scan piece.
 * Called when the user rejects an identification ("mark wrong").
 */
export async function removeScanEmbedding(scanId: number, cropIdx: number): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM bl_catalog_clip_embeddings
    WHERE source = 'scan' AND provenance = ${`scan:${scanId}:${cropIdx}`}
  `);
  const count = (result as any).rowCount ?? 0;
  if (count > 0) {
    console.log(`[ClipSelfTrain] -scan removed ${count} embedding(s) for scan ${scanId} crop ${cropIdx}`);
  }
  return count;
}

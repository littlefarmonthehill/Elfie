/**
 * CLIP Augmentation Worker — generates synthetic embedding variants from each
 * existing catalog/universal image so a single canonical photo produces multiple
 * vectors covering small rotations and lighting changes.
 *
 * For each unique partNo with a 'catalog' or 'universal' embedding (and no
 * 'augmented' rows yet), we:
 *   1. Re-fetch the source image via the image store
 *   2. Generate 4 sharp-based variants (rotate +15°, -15°, brighter, darker)
 *   3. Embed each via CLIP and insert as source='augmented'
 *
 * The worker:
 *  - Auto-resumes on boot (idempotent — uses provenance to skip done rows)
 *  - Pauses while a Brick Spotter scan is active to avoid CLIP contention
 *  - Runs at low rate (1 part / sec) so it never disrupts other work
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';
import { embedCrop, isScanActive } from './segmentClient';
import { getOrFetchImage } from './image-store';

interface State {
  running: boolean;
  shouldStop: boolean;
  augmented: number;
  noImage: number;
  failed: number;
  current: string;
  startedAt: number;
}

let _worker: State | null = null;

export function getAugmentationState() { return _worker; }

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const toVecLit = (e: number[]) => `[${e.join(',')}]`;

interface Variant { idx: number; buf: Buffer }

async function buildVariants(srcBuffer: Buffer): Promise<Variant[]> {
  const { default: sharp } = await import('sharp');
  const out: Variant[] = [];
  // Rotate ±15° (background fill = white)
  try { out.push({ idx: 0, buf: await sharp(srcBuffer).rotate(15,  { background: { r: 255, g: 255, b: 255 } }).jpeg().toBuffer() }); } catch {}
  try { out.push({ idx: 1, buf: await sharp(srcBuffer).rotate(-15, { background: { r: 255, g: 255, b: 255 } }).jpeg().toBuffer() }); } catch {}
  // Brightness / contrast jitter
  try { out.push({ idx: 2, buf: await sharp(srcBuffer).modulate({ brightness: 1.20 }).jpeg().toBuffer() }); } catch {}
  try { out.push({ idx: 3, buf: await sharp(srcBuffer).modulate({ brightness: 0.80 }).jpeg().toBuffer() }); } catch {}
  return out;
}

async function processOnePart(itemNo: string, itemType: string, sourceId: string): Promise<'augmented' | 'no_image' | 'failed'> {
  let buffer: Buffer | null = null;
  try {
    buffer = await getOrFetchImage(itemType === 'MINIFIG' ? 'MINIFIG' : 'PART', itemNo, null as any).catch(() => null);
    if (!buffer) {
      // Try common color fallbacks for parts
      for (const c of [1, 71, 15, 4, 5, 11]) {
        buffer = await getOrFetchImage('PART', itemNo, c).catch(() => null);
        if (buffer) break;
      }
    }
  } catch {
    buffer = null;
  }
  if (!buffer) return 'no_image';

  let variants: Variant[];
  try {
    variants = await buildVariants(buffer);
  } catch {
    return 'failed';
  }
  if (variants.length === 0) return 'failed';

  let inserted = 0;
  for (const v of variants) {
    try {
      const emb = await embedCrop(v.buf);
      await db.execute(sql`
        INSERT INTO bl_catalog_clip_embeddings (item_no, item_type, color_id, embedding, source, clip_model, provenance)
        VALUES (${itemNo}, ${itemType}, NULL, ${toVecLit(emb)}::vector, 'augmented', 'ViT-B/32', ${`aug:${sourceId}:${v.idx}`})
      `);
      inserted++;
    } catch {
      // skip failed variant; continue
    }
  }
  return inserted > 0 ? 'augmented' : 'failed';
}

export async function startAugmentationWorker(): Promise<void> {
  if (_worker?.running) {
    console.log('[ClipAugmentation] Worker already running');
    return;
  }

  // Find parts that have a catalog or universal embedding but no augmented one yet.
  const rows = await db.execute<{ item_no: string; item_type: string; src_id: string }>(sql`
    SELECT DISTINCT ON (e.item_no, e.item_type)
      e.item_no, e.item_type, e.id::text AS src_id
    FROM bl_catalog_clip_embeddings e
    WHERE e.source IN ('catalog', 'universal')
      AND NOT EXISTS (
        SELECT 1 FROM bl_catalog_clip_embeddings a
        WHERE a.item_no = e.item_no AND a.item_type = e.item_type AND a.source = 'augmented'
      )
    ORDER BY e.item_no, e.item_type
  `).then(r => r.rows ?? []);

  if (rows.length === 0) {
    console.log('[ClipAugmentation] Nothing to do — all eligible parts already augmented');
    return;
  }

  _worker = {
    running: true, shouldStop: false,
    augmented: 0, noImage: 0, failed: 0,
    current: '', startedAt: Date.now(),
  };

  console.log(`[ClipAugmentation] Starting — ${rows.length} parts to augment`);

  (async () => {
    try {
      for (const row of rows) {
        if (_worker?.shouldStop) break;

        // Pause while a scan is running
        while (isScanActive()) await sleep(500);

        _worker!.current = row.item_no;
        const result = await processOnePart(row.item_no, row.item_type, row.src_id).catch(() => 'failed' as const);
        if (result === 'augmented') _worker!.augmented++;
        else if (result === 'no_image') _worker!.noImage++;
        else _worker!.failed++;

        if ((_worker!.augmented + _worker!.failed + _worker!.noImage) % 50 === 0) {
          console.log(`[ClipAugmentation] ${_worker!.augmented} done, ${_worker!.noImage} no-image, ${_worker!.failed} failed`);
        }

        await sleep(1000);
      }
    } finally {
      console.log(`[ClipAugmentation] Worker finished: ${_worker?.augmented} augmented, ${_worker?.noImage} no-image, ${_worker?.failed} failed`);
      if (_worker) _worker.running = false;
    }
  })();
}

export function stopAugmentationWorker(): void {
  if (_worker) _worker.shouldStop = true;
}

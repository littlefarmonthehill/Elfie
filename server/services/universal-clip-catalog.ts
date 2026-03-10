/**
 * Universal CLIP Catalog — background worker that embeds every known BrickLink
 * part into bl_catalog_clip_embeddings (source='universal') so BrickSpotter can recognize
 * parts outside your inventory.
 *
 * Flow:
 *  1. importFromRebrickable() — downloads Rebrickable parts CSV, populates
 *     universal_catalog_queue (idempotent — skips existing rows)
 *  2. startUniversalWorker()  — processes 'pending' rows at ~1/sec, pauses
 *     during active scans, survives server restarts
 *  3. stopUniversalWorker()   — graceful stop (finishes current item)
 */

import { db } from '../db';
import { universalCatalogQueue, blCatalog } from '../../shared/schema';
import { sql, eq } from 'drizzle-orm';
import { embedUrl, isScanActive } from './segmentClient';
import * as https from 'https';
import * as zlib from 'zlib';

// ── State ──────────────────────────────────────────────────────────────────────

interface WorkerState {
  running: boolean;
  shouldStop: boolean;
  embedded: number;
  noImage: number;
  failed: number;
  current: string;
  startedAt: number;
}

let _worker: WorkerState | null = null;
let _importing = false;
let _lastImportedAt: number | null = null;

export function getUniversalCatalogState() { return _worker; }
export function isUniversalImporting()     { return _importing; }
export function getLastImportedAt()        { return _lastImportedAt; }

// ── Helpers ────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** BrickLink neutral part image — shape-focused, no color context. */
function partImageUrl(partNo: string): string {
  return `https://img.bricklink.com/ItemImage/PL/${partNo}.png`;
}

/** Fetch a gzipped URL and return the decompressed text. */
function fetchGzipped(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'PlanetBrick-Catalog-Builder/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      const gunzip = zlib.createGunzip();
      const chunks: Buffer[] = [];
      const stream = res.pipe(gunzip);
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** Minimal CSV line parser — handles double-quoted fields with embedded commas. */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQ = !inQ; }
    } else if (c === ',' && !inQ) {
      fields.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

// ── Import ─────────────────────────────────────────────────────────────────────

export interface ImportResult { imported: number; skipped: number; total: number }

/**
 * Download the Rebrickable parts CSV and populate universal_catalog_queue.
 * Idempotent — existing rows are left untouched (ON CONFLICT DO NOTHING).
 */
export async function importFromRebrickable(): Promise<ImportResult> {
  if (_importing) throw new Error('Import already in progress');
  _importing = true;

  try {
    console.log('[Universal Catalog] Downloading Rebrickable parts CSV…');
    const raw = await fetchGzipped('https://rebrickable.com/media/downloads/parts.csv.gz');

    const lines = raw.split('\n');
    const header = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const partNumIdx = header.indexOf('part_num');
    const nameIdx    = header.indexOf('name');
    if (partNumIdx === -1) throw new Error('part_num column not found in CSV');

    console.log(`[Universal Catalog] Parsing ${lines.length.toLocaleString()} CSV lines…`);

    const BATCH = 1000;
    let imported = 0;
    let skipped  = 0;
    const batch: { partNo: string; partName: string | null }[] = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const rows = batch.map(p => ({
        partNo:   p.partNo,
        partName: p.partName,
        status:   'pending' as const,
      }));
      const result = await db.insert(universalCatalogQueue)
        .values(rows)
        .onConflictDoNothing()
        .returning({ partNo: universalCatalogQueue.partNo });
      imported += result.length;
      skipped  += rows.length - result.length;

      // Also seed bl_catalog with names from Rebrickable.
      // colorId=0 = color-agnostic base part entry.
      // COALESCE preserves any name already written by POM/BL sync — Rebrickable
      // names are only used as a fallback when no BL name exists yet.
      const catalogRows = batch
        .filter(p => p.partName)
        .map(p => ({ itemNo: p.partNo, itemType: 'P' as const, colorId: 0, itemName: p.partName }));
      if (catalogRows.length > 0) {
        await db.insert(blCatalog)
          .values(catalogRows)
          .onConflictDoUpdate({
            target: [blCatalog.itemNo, blCatalog.itemType, blCatalog.colorId],
            set: { itemName: sql`COALESCE(bl_catalog.item_name, EXCLUDED.item_name)` },
          });
      }

      batch.length = 0;
    };

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols   = parseCSVLine(line);
      const partNo = cols[partNumIdx]?.trim().replace(/^"|"$/g, '');
      if (!partNo) continue;
      const partName = nameIdx >= 0 ? (cols[nameIdx]?.trim().replace(/^"|"$/g, '') || null) : null;
      batch.push({ partNo, partName });
      if (batch.length >= BATCH) await flush();
    }
    await flush();

    const total = imported + skipped;
    _lastImportedAt = Date.now();
    console.log(`[Universal Catalog] Import complete — ${imported.toLocaleString()} new, ${skipped.toLocaleString()} already existed`);
    return { imported, skipped, total };
  } finally {
    _importing = false;
  }
}

/**
 * Reset stale no_image / failed rows back to 'pending' so the worker retries
 * them. Pass olderThanDays=0 to retry everything regardless of age.
 * Returns the number of rows reset.
 */
export async function retryStaleItems(olderThanDays: number = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  let result: { partNo: string }[];
  if (olderThanDays <= 0) {
    result = await db.execute<{ partNo: string }>(
      sql`UPDATE universal_catalog_queue
          SET status = 'pending', attempted_at = NULL, error_msg = NULL
          WHERE status IN ('no_image', 'failed')
          RETURNING part_no AS "partNo"`
    ).then(r => r.rows ?? []);
  } else {
    result = await db.execute<{ partNo: string }>(
      sql`UPDATE universal_catalog_queue
          SET status = 'pending', attempted_at = NULL, error_msg = NULL
          WHERE status IN ('no_image', 'failed')
            AND (attempted_at IS NULL OR attempted_at < ${cutoff.toISOString()}::timestamptz)
          RETURNING part_no AS "partNo"`
    ).then(r => r.rows ?? []);
  }

  const count = result.length;
  console.log(`[Universal Catalog] Reset ${count} stale items back to 'pending'`);
  return count;
}

// ── Worker ─────────────────────────────────────────────────────────────────────

// Number of parts to process concurrently per batch.
// Flask is threaded so parallel URL fetches (the dominant case) run in separate
// threads.  For no_image items (BrickLink 404, sub-second) this gives ~5x
// throughput vs sequential processing.  CLIP inference is CPU-bound so it
// serialises in Python regardless; 5 is a safe concurrency for the URL tier.
const WORKER_CONCURRENCY = 5;

async function processOnePart(partNo: string): Promise<void> {
  try {
    const url = partImageUrl(partNo);
    const embedding = await embedUrl(url);

    // Store in bl_catalog_clip_embeddings with source='universal'
    const vecLit = `[${embedding.join(',')}]`;
    await db.execute(sql`
      INSERT INTO bl_catalog_clip_embeddings (item_no, item_type, color_id, embedding, source, clip_model)
      VALUES (${partNo}, 'PART', NULL, ${vecLit}::vector, 'universal', 'ViT-B/32')
      ON CONFLICT DO NOTHING
    `);

    await db.execute(sql`
      UPDATE universal_catalog_queue
      SET status = 'embedded', attempted_at = NOW()
      WHERE part_no = ${partNo}
    `);

    if (_worker) _worker.embedded++;
  } catch (err: any) {
    const msg    = err?.message ?? '';
    const status = (msg.includes('404') || msg.includes('image not available') || msg.includes('403'))
      ? 'no_image' : 'failed';

    await db.execute(sql`
      UPDATE universal_catalog_queue
      SET status = ${status}, attempted_at = NOW(), error_msg = ${msg.slice(0, 200)}
      WHERE part_no = ${partNo}
    `);

    if (_worker) {
      if (status === 'no_image') _worker.noImage++;
      else _worker.failed++;
    }
  }
}

export async function startUniversalWorker(): Promise<void> {
  if (_worker?.running) {
    console.log('[Universal Catalog] Worker already running');
    return;
  }

  const [pendingRow] = await db.execute<{ cnt: string }>(
    sql`SELECT COUNT(*)::text AS cnt FROM universal_catalog_queue WHERE status = 'pending'`
  ).then(r => r.rows ?? []);
  const totalPending = Number(pendingRow?.cnt ?? 0);

  if (totalPending === 0) {
    console.log('[Universal Catalog] No pending items — nothing to do');
    return;
  }

  _worker = {
    running: true,
    shouldStop: false,
    embedded: 0,
    noImage: 0,
    failed: 0,
    current: '',
    startedAt: Date.now(),
  };

  console.log(`[Universal Catalog] Worker started — ${totalPending.toLocaleString()} parts to embed (batch=${WORKER_CONCURRENCY})`);

  // Run entirely in background
  (async () => {
    let totalProcessed = 0;

    while (!_worker!.shouldStop) {
      // Yield to active scans
      while (isScanActive()) {
        await sleep(2000);
        if (_worker!.shouldStop) break;
      }
      if (_worker!.shouldStop) break;

      // Grab next batch of pending parts
      const rows = await db.execute<{ part_no: string }>(
        sql`SELECT part_no FROM universal_catalog_queue WHERE status = 'pending' LIMIT ${WORKER_CONCURRENCY}`
      ).then(r => r.rows ?? []);

      if (rows.length === 0) break; // All done

      _worker!.current = rows[0].part_no;

      // Process batch concurrently — Flask is threaded so URL fetches parallelise
      await Promise.all(rows.map(r => processOnePart(r.part_no)));

      totalProcessed += rows.length;

      if (totalProcessed % 1000 === 0 || totalProcessed <= 100) {
        const w = _worker!;
        console.log(`[Universal Catalog] ${totalProcessed.toLocaleString()} processed — ${w.embedded} embedded, ${w.noImage} no-image, ${w.failed} failed`);
      }

      // Short yield between batches — no artificial per-item throttle needed since
      // the BrickLink URL fetches themselves provide natural rate-limiting
      await sleep(50);
    }

    const w = _worker!;
    console.log(`[Universal Catalog] Worker finished — ${w.embedded} embedded, ${w.noImage} no-image, ${w.failed} failed`);
    _worker!.running = false;
  })().catch(e => {
    console.error('[Universal Catalog] Worker crashed:', e.message);
    if (_worker) _worker.running = false;
  });
}

export function stopUniversalWorker(): void {
  if (_worker?.running) {
    _worker.shouldStop = true;
    console.log('[Universal Catalog] Stop signal sent — will finish current item');
  }
}

// ── Status ─────────────────────────────────────────────────────────────────────

export interface UniversalCatalogStatus {
  queueSize:       number;
  pending:         number;
  embedded:        number;
  noImage:         number;
  failed:          number;
  universalInDb:   number;  // rows in bl_catalog_clip_embeddings with source='universal'
  workerRunning:   boolean;
  workerEmbedded:  number;
  workerNoImage:   number;
  workerFailed:    number;
  workerCurrent:   string;
  workerStartedAt: number | null;
  importing:       boolean;
  lastImportedAt:  number | null;  // unix ms when CSV was last downloaded
}

export async function getUniversalCatalogStatus(): Promise<UniversalCatalogStatus> {
  const queueRows = await db.execute<{ status: string; cnt: string }>(
    sql`SELECT status, COUNT(*)::text AS cnt FROM universal_catalog_queue GROUP BY status`
  ).then(r => r.rows ?? []);

  const counts: Record<string, number> = {};
  for (const r of queueRows) counts[r.status] = Number(r.cnt);

  const [dbRow] = await db.execute<{ cnt: string }>(
    sql`SELECT COUNT(*)::text AS cnt FROM bl_catalog_clip_embeddings WHERE source = 'universal'`
  ).then(r => r.rows ?? []);

  const queueSize = Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    queueSize,
    pending:        counts['pending']  ?? 0,
    embedded:       counts['embedded'] ?? 0,
    noImage:        counts['no_image'] ?? 0,
    failed:         counts['failed']   ?? 0,
    universalInDb:  Number(dbRow?.cnt ?? 0),
    workerRunning:  _worker?.running  ?? false,
    workerEmbedded: _worker?.embedded ?? 0,
    workerNoImage:  _worker?.noImage  ?? 0,
    workerFailed:   _worker?.failed   ?? 0,
    workerCurrent:  _worker?.current  ?? '',
    workerStartedAt: _worker?.startedAt ?? null,
    importing:       _importing,
    lastImportedAt:  _lastImportedAt,
  };
}

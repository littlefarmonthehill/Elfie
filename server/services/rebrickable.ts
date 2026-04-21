import { db } from "../db";
import { setPartRelationships, partRelationships, rbColors, syncMetadata, blInventory, PLATFORM_ORG_ID } from "@shared/schema";
import type { InsertInventoryHistory } from "@shared/schema";
import { sql, eq, and, inArray, isNotNull } from "drizzle-orm";
import { recordInventoryChanges } from "./inventory-history";
import { syncMinifigIdMappings } from "./rebrickable-images";
import https from "https";
import { parse } from "csv-parse";
import { createGunzip } from "zlib";
import { Readable } from "stream";

const ORG_ID = PLATFORM_ORG_ID;
const SYNC_ID = 'rebrickable_set_parts';

let isRunning = false;
export function getRebrickableSyncIsRunning() { return isRunning; }

export interface RebrickableSyncResult {
  setsAdded: number;
  setsUpdated: number;
  partsProcessed: number;
}

// Download and parse Rebrickable inventory_parts.csv using streaming
export async function syncRebrickableSetParts(forceRefresh = false): Promise<RebrickableSyncResult> {
  if (isRunning) {
    throw new Error('Rebrickable set-parts sync is already running');
  }
  isRunning = true;

  // Mark in_progress in sync metadata
  await db.insert(syncMetadata).values({
    id: SYNC_ID,
    lastSyncStatus: 'in_progress',
    lastSyncTime: new Date(),
    recordsAdded: 0,
    recordsUpdated: 0,
    orgId: ORG_ID,
  }).onConflictDoUpdate({
    target: syncMetadata.id,
    set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date(), errorMessage: null },
  });

  try {
    console.log('[Rebrickable] Starting set-part relationships sync...');
    
    // Check if we already have data
    const existingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(setPartRelationships);
    
    const recordCount = Number(existingCount[0]?.count || 0);
    
    if (recordCount > 0 && !forceRefresh) {
      console.log(`[Rebrickable] ✓ Already have ${recordCount.toLocaleString()} relationships - skipping (use forceRefresh to re-sync)`);
      
      const setCount = await db
        .selectDistinct({ setNum: setPartRelationships.setNum })
        .from(setPartRelationships);

      await db.insert(syncMetadata).values({
        id: SYNC_ID,
        lastSyncStatus: 'success',
        lastSyncTime: new Date(),
        recordsAdded: 0,
        recordsUpdated: recordCount,
        orgId: ORG_ID,
      }).onConflictDoUpdate({
        target: syncMetadata.id,
        set: { lastSyncStatus: 'success', updatedAt: new Date(), recordsUpdated: recordCount, errorMessage: null },
      });

      isRunning = false;
      return { setsAdded: 0, setsUpdated: 0, partsProcessed: recordCount };
    }

    if (forceRefresh && recordCount > 0) {
      console.log(`[Rebrickable] Force refresh — clearing ${recordCount.toLocaleString()} existing relationships...`);
      await db.execute(sql`TRUNCATE TABLE set_part_relationships RESTART IDENTITY`);
    }
    
    console.log('[Rebrickable] No existing data found - performing full sync...');
    
    // Step 1: Build set_num → set_name mapping from sets.csv
    console.log('[Rebrickable] Step 1: Downloading sets.csv to get set names...');
    const setsUrl = 'https://cdn.rebrickable.com/media/downloads/sets.csv.gz';
    const setNamesMap = new Map<string, string>(); // set_num → set_name
    
    await new Promise<void>(async (resolve, reject) => {
      try {
        const stream = await downloadStream(setsUrl);
        const gunzip = createGunzip();
        const parser = parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });
        
        let setCount = 0;
        parser.on('data', (record) => {
          if (record.set_num && record.name) {
            setNamesMap.set(record.set_num, record.name);
            setCount++;
          }
        });
        
        parser.on('end', () => {
          console.log(`[Rebrickable] Loaded ${setCount} set names`);
          resolve();
        });
        
        parser.on('error', reject);
        stream.pipe(gunzip).pipe(parser);
        stream.on('error', reject);
        gunzip.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
    
    // Step 2: Build inventory_id → set_num mapping from inventories.csv
    console.log('[Rebrickable] Step 2: Downloading inventories.csv to map inventory IDs to sets...');
    const inventoriesUrl = 'https://cdn.rebrickable.com/media/downloads/inventories.csv.gz';
    const inventoryMap = new Map<string, string>(); // inventory_id → set_num
    
    await new Promise<void>(async (resolve, reject) => {
      try {
        const stream = await downloadStream(inventoriesUrl);
        const gunzip = createGunzip();
        const parser = parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });
        
        let invCount = 0;
        parser.on('data', (record) => {
          if (record.id && record.set_num) {
            inventoryMap.set(record.id, record.set_num);
            invCount++;
          }
        });
        
        parser.on('end', () => {
          console.log(`[Rebrickable] Loaded ${invCount} inventory mappings`);
          resolve();
        });
        
        parser.on('error', reject);
        stream.pipe(gunzip).pipe(parser);
        stream.on('error', reject);
        gunzip.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
    
    // Step 3: Stream inventory_parts.csv and join with inventory map
    console.log('[Rebrickable] Step 3: Downloading inventory_parts.csv and building set-part relationships...');
    const partsUrl = 'https://cdn.rebrickable.com/media/downloads/inventory_parts.csv.gz';
    
    let partsProcessed = 0;
    let batch: any[] = [];
    const BATCH_SIZE = 1000;
    const LOG_INTERVAL = 10000;
    
    // Stream inventory_parts and join with inventory map
    await new Promise<void>(async (resolve, reject) => {
      try {
        const stream = await downloadStream(partsUrl);
        const gunzip = createGunzip();
        const parser = parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });
      
      let recordCount = 0;
      parser.on('data', async (record) => {
        recordCount++;
        
        // Look up set_num from inventory map
        const inventoryId = record.inventory_id;
        const setNum = inventoryMap.get(inventoryId);
        const partNum = record.part_num;
        
        // Skip records with missing critical data
        if (!setNum || !partNum) {
          return;
        }
        
        // Look up set name
        const setName = setNamesMap.get(setNum) || null;
        
        // Add to batch
        batch.push({
          setNum,
          setName,
          partNum,
          colorId: (() => {
            // BUG FIX: `parseInt('0') || null` evaluates to null because 0 is falsy,
            // which silently dropped color id 0 (= Black) for ~250k rows.
            // Treat empty/non-numeric as NULL but keep 0 and negative ids intact.
            const raw = (record.color_id ?? '').toString().trim();
            if (raw === '') return null;
            const n = parseInt(raw, 10);
            return Number.isFinite(n) ? n : null;
          })(),
          quantity: parseInt(record.quantity) || 0,
        });
        
        // When batch is full, pause stream and insert
        if (batch.length >= BATCH_SIZE) {
          parser.pause();
          
          try {
            await db.insert(setPartRelationships).values(batch);
            partsProcessed += batch.length;
            
            if (partsProcessed % LOG_INTERVAL === 0 || partsProcessed < LOG_INTERVAL) {
              console.log(`[Rebrickable] Processed ${partsProcessed} relationships...`);
            }
            
            batch = []; // Clear batch
            parser.resume();
          } catch (error) {
            console.error('[Rebrickable] Error inserting batch:', error);
            parser.destroy();
            reject(error);
          }
        }
      });
      
      parser.on('end', async () => {
        console.log(`[Rebrickable] Parser ended. Total records seen: ${recordCount}`);
        // Insert remaining records in final batch
        if (batch.length > 0) {
          try {
            await db.insert(setPartRelationships).values(batch);
            partsProcessed += batch.length;
            console.log(`[Rebrickable] Processed final batch: ${batch.length} relationships`);
          } catch (error) {
            console.error('[Rebrickable] Error inserting final batch:', error);
            reject(error);
            return;
          }
        }
        
        console.log(`[Rebrickable] Successfully synced ${partsProcessed} set-part relationships`);
        resolve();
      });
      
      parser.on('error', (error) => {
        console.error('[Rebrickable] Parser error:', error);
        reject(error);
      });
      
      // Pipe: download → gunzip → parser
      stream.pipe(gunzip).pipe(parser);
      
      stream.on('error', (error) => {
        console.error('[Rebrickable] Download error:', error);
        reject(error);
      });
      
      gunzip.on('error', (error) => {
        console.error('[Rebrickable] Gunzip error:', error);
        reject(error);
      });
      } catch (error) {
        console.error('[Rebrickable] Setup error:', error);
        reject(error);
      }
    });
    
    // Get unique set count
    const setCount = await db
      .selectDistinct({ setNum: setPartRelationships.setNum })
      .from(setPartRelationships);
    
    console.log(`[Rebrickable] Found ${setCount.length} unique sets`);

    await db.insert(syncMetadata).values({
      id: SYNC_ID,
      lastSyncStatus: 'success',
      lastSyncTime: new Date(),
      recordsAdded: partsProcessed,
      recordsUpdated: 0,
      orgId: ORG_ID,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncStatus: 'success',
        updatedAt: new Date(),
        recordsAdded: partsProcessed,
        recordsUpdated: 0,
        errorMessage: null,
      },
    });

    isRunning = false;
    return {
      setsAdded: setCount.length,
      setsUpdated: 0,
      partsProcessed,
    };
  } catch (error: any) {
    isRunning = false;
    console.error('[Rebrickable] Sync failed:', error);
    await db.insert(syncMetadata).values({
      id: SYNC_ID,
      lastSyncStatus: 'error',
      lastSyncTime: new Date(),
      recordsAdded: 0,
      recordsUpdated: 0,
      errorMessage: error.message,
      orgId: ORG_ID,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: { lastSyncStatus: 'error', updatedAt: new Date(), errorMessage: error.message },
    }).catch(() => {});
    throw error;
  }
}

// ─── Part Relationships Sync ─────────────────────────────────────────────────

let partRelSyncRunning = false;
export function getPartRelSyncIsRunning() { return partRelSyncRunning; }

/**
 * Downloads Rebrickable's part_relationships.csv.gz and stores all rows in
 * the `part_relationships` table.  Type 'A' rows represent alternate parts.
 *
 * Safe to run multiple times — truncates and re-inserts each run.
 */
export async function syncRebrickablePartRelationships(forceRefresh = false): Promise<{ rowsInserted: number; newAlternates: number }> {
  if (partRelSyncRunning) throw new Error('Part relationships sync already running');

  if (!forceRefresh) {
    const [{ cnt }] = await db.select({ cnt: sql<number>`COUNT(*)::int` }).from(partRelationships);
    if (cnt > 0) {
      console.log(`[PartRel] Already populated (${cnt} rows) — skipping. Pass forceRefresh=true to re-sync.`);
      return { rowsInserted: cnt, newAlternates: 0 };
    }
  }

  partRelSyncRunning = true;
  try {
    // ── Snapshot existing type-A pairs before overwriting so we can diff ─────
    // On first population the set is empty, making every alternate "new" —
    // that's intentional: it seeds history with the current state of Rebrickable
    // for parts already in inventory.
    const oldAlts = await db
      .select({ child: partRelationships.childPartNum, parent: partRelationships.parentPartNum })
      .from(partRelationships)
      .where(eq(partRelationships.relType, 'A'));
    const oldAltPairs = new Set<string>(oldAlts.map(r => `${r.child}:${r.parent}`));
    console.log(`[PartRel] Snapshot: ${oldAltPairs.size} existing type-A pairs loaded for diff.`);

    // ── Download & parse ─────────────────────────────────────────────────────
    const url = 'https://cdn.rebrickable.com/media/downloads/part_relationships.csv.gz';
    console.log('[PartRel] Downloading part_relationships.csv.gz…');

    const records: { relType: string; childPartNum: string; parentPartNum: string }[] = [];

    await new Promise<void>(async (resolve, reject) => {
      try {
        const stream = await downloadStream(url);
        const gunzip = createGunzip();
        const parser = parse({ columns: true, skip_empty_lines: true, trim: true });

        parser.on('data', (row: any) => {
          if (row.rel_type && row.child_part_num && row.parent_part_num) {
            records.push({ relType: row.rel_type, childPartNum: row.child_part_num, parentPartNum: row.parent_part_num });
          }
        });
        parser.on('end', resolve);
        parser.on('error', reject);
        stream.pipe(gunzip).pipe(parser);
        stream.on('error', reject);
        gunzip.on('error', reject);
      } catch (err) { reject(err); }
    });

    // ── Diff: find newly-added type-A alternate relationships ─────────────────
    let newAlternateCount = 0;
    const addedAlts = records.filter(
      r => r.relType === 'A' && !oldAltPairs.has(`${r.childPartNum}:${r.parentPartNum}`)
    );
    console.log(`[PartRel] Diff: ${addedAlts.length} new type-A alternate(s) detected.`);

    if (addedAlts.length > 0) {
      // Look up inventory lots matching the child part numbers (across all orgs)
      const childNums = [...new Set(addedAlts.map(r => r.childPartNum))];
      const CHUNK = 500;
      const matchingLots: { id: number; orgId: string; itemNo: string; colorId: number | null }[] = [];
      for (let i = 0; i < childNums.length; i += CHUNK) {
        const chunk = childNums.slice(i, i + CHUNK);
        const rows = await db
          .select({ id: blInventory.id, orgId: blInventory.orgId, itemNo: blInventory.itemNo, colorId: blInventory.colorId })
          .from(blInventory)
          .where(and(inArray(blInventory.itemNo, chunk), isNotNull(blInventory.orgId)));
        matchingLots.push(...rows.filter(r => r.orgId != null) as any);
      }

      // Map itemNo → list of lots for fast lookup
      const lotsByItemNo = new Map<string, typeof matchingLots>();
      for (const lot of matchingLots) {
        if (!lotsByItemNo.has(lot.itemNo)) lotsByItemNo.set(lot.itemNo, []);
        lotsByItemNo.get(lot.itemNo)!.push(lot);
      }

      // Build history entries — one per affected lot
      const historyEntries: InsertInventoryHistory[] = [];
      const changedAt = new Date();
      for (const alt of addedAlts) {
        for (const lot of lotsByItemNo.get(alt.childPartNum) ?? []) {
          historyEntries.push({
            orgId: lot.orgId!,
            inventoryId: lot.id,
            itemNo: lot.itemNo,
            colorId: lot.colorId ?? null,
            changedAt,
            source: 'rebrickable',
            sourceRef: null,
            field: 'part_alternate',
            oldValue: null,
            newValue: alt.parentPartNum,
          });
        }
      }

      await recordInventoryChanges(historyEntries);
      newAlternateCount = addedAlts.length;
      console.log(`[PartRel] Wrote ${historyEntries.length} history entries for ${addedAlts.length} new alternate relationship(s).`);
    }

    // ── Truncate and re-insert ────────────────────────────────────────────────
    console.log(`[PartRel] Downloaded ${records.length} rows. Truncating old data…`);
    await db.delete(partRelationships);

    const BATCH = 1000;
    for (let i = 0; i < records.length; i += BATCH) {
      await db.insert(partRelationships).values(records.slice(i, i + BATCH));
    }

    console.log(`[PartRel] Inserted ${records.length} part relationships.`);
    return { rowsInserted: records.length, newAlternates: newAlternateCount };
  } finally {
    partRelSyncRunning = false;
  }
}

// ─── Rebrickable Colors Sync ─────────────────────────────────────────────────
// Pulls color metadata from the Rebrickable API and stores the BrickLink
// mapping in `rb_colors`. Required for set-composition matching because
// `set_part_relationships.color_id` uses Rebrickable IDs while
// `bl_inventory.color_id` uses BrickLink IDs (they only partially overlap).
let colorsSyncRunning = false;
export function getRbColorsSyncIsRunning() { return colorsSyncRunning; }

export async function syncRebrickableColors(): Promise<{ inserted: number; mapped: number }> {
  if (colorsSyncRunning) throw new Error('Rebrickable colors sync already running');
  const apiKey = process.env.REBRICKABLE_API_KEY;
  if (!apiKey) throw new Error('REBRICKABLE_API_KEY not set');

  colorsSyncRunning = true;
  try {
    console.log('[RbColors] Fetching colors from Rebrickable API…');
    const fetchPage = (url: string): Promise<any> =>
      new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => {
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
      });

    const rows: { id: number; name: string; rgb: string | null; isTrans: boolean; blColorId: number | null }[] = [];
    let url: string | null = `https://rebrickable.com/api/v3/lego/colors/?key=${apiKey}&page_size=300`;
    while (url) {
      const json: any = await fetchPage(url);
      for (const c of json.results ?? []) {
        const blIds: number[] = c.external_ids?.BrickLink?.ext_ids ?? [];
        rows.push({
          id: c.id,
          name: c.name || `Color ${c.id}`,
          rgb: c.rgb || null,
          isTrans: !!c.is_trans,
          blColorId: blIds[0] ?? null,
        });
      }
      url = json.next || null;
    }

    console.log(`[RbColors] Upserting ${rows.length} colors…`);
    await db.delete(rbColors);
    if (rows.length > 0) {
      const BATCH = 200;
      for (let i = 0; i < rows.length; i += BATCH) {
        await db.insert(rbColors).values(rows.slice(i, i + BATCH));
      }
    }
    const mapped = rows.filter(r => r.blColorId != null).length;
    console.log(`[RbColors] Done. ${rows.length} colors, ${mapped} mapped to BrickLink.`);
    return { inserted: rows.length, mapped };
  } finally {
    colorsSyncRunning = false;
  }
}

// ─── Rebrickable Set Minifigs Sync ───────────────────────────────────────────
// Streams `inventory_minifigs.csv` and inserts each minifig as an additional
// "part" row in `set_part_relationships` with `part_num = "fig-XXXXX"` and
// `color_id = NULL`.  This makes minifigs appear in the Set Completion view.
let minifigSyncRunning = false;
export function getMinifigSyncIsRunning() { return minifigSyncRunning; }

export async function syncRebrickableSetMinifigs(): Promise<{ inserted: number }> {
  if (minifigSyncRunning) throw new Error('Rebrickable minifig sync already running');
  if (isRunning) throw new Error('Set-parts sync is currently running; try again shortly');
  minifigSyncRunning = true;
  try {
    console.log('[RbMinifigs] Loading set name + inventory→set maps…');
    // Reuse the existing CSVs to map inventory_id → set_num and set_num → set_name
    const setNamesMap = new Map<string, string>();
    await new Promise<void>(async (resolve, reject) => {
      try {
        const stream = await downloadStream('https://cdn.rebrickable.com/media/downloads/sets.csv.gz');
        const parser = parse({ columns: true, skip_empty_lines: true, trim: true });
        parser.on('data', (r: any) => { if (r.set_num && r.name) setNamesMap.set(r.set_num, r.name); });
        parser.on('end', () => resolve());
        parser.on('error', reject);
        stream.pipe(createGunzip()).pipe(parser);
        stream.on('error', reject);
      } catch (e) { reject(e); }
    });

    const inventoryMap = new Map<string, string>();
    await new Promise<void>(async (resolve, reject) => {
      try {
        const stream = await downloadStream('https://cdn.rebrickable.com/media/downloads/inventories.csv.gz');
        const parser = parse({ columns: true, skip_empty_lines: true, trim: true });
        parser.on('data', (r: any) => { if (r.id && r.set_num) inventoryMap.set(r.id, r.set_num); });
        parser.on('end', () => resolve());
        parser.on('error', reject);
        stream.pipe(createGunzip()).pipe(parser);
        stream.on('error', reject);
      } catch (e) { reject(e); }
    });

    console.log(`[RbMinifigs] Maps built (${setNamesMap.size} sets, ${inventoryMap.size} inventories). Removing prior minifig rows…`);
    // Idempotent: clear out previously imported minifig rows so re-runs don't duplicate
    await db.execute(sql`DELETE FROM set_part_relationships WHERE part_num LIKE 'fig-%'`);

    console.log('[RbMinifigs] Streaming inventory_minifigs.csv…');
    let inserted = 0;
    let batch: any[] = [];
    const BATCH_SIZE = 1000;

    await new Promise<void>(async (resolve, reject) => {
      try {
        const stream = await downloadStream('https://cdn.rebrickable.com/media/downloads/inventory_minifigs.csv.gz');
        const parser = parse({ columns: true, skip_empty_lines: true, trim: true });

        parser.on('data', async (record: any) => {
          const setNum = inventoryMap.get(record.inventory_id);
          const fig = record.fig_num;
          if (!setNum || !fig) return;
          batch.push({
            setNum,
            setName: setNamesMap.get(setNum) || null,
            partNum: fig,
            colorId: null,
            quantity: parseInt(record.quantity) || 1,
          });
          if (batch.length >= BATCH_SIZE) {
            parser.pause();
            try {
              await db.insert(setPartRelationships).values(batch);
              inserted += batch.length;
              batch = [];
              parser.resume();
            } catch (err) {
              parser.destroy();
              reject(err);
            }
          }
        });

        parser.on('end', async () => {
          if (batch.length > 0) {
            try {
              await db.insert(setPartRelationships).values(batch);
              inserted += batch.length;
            } catch (err) { return reject(err); }
          }
          resolve();
        });
        parser.on('error', reject);
        stream.pipe(createGunzip()).pipe(parser);
        stream.on('error', reject);
      } catch (err) { reject(err); }
    });

    console.log(`[RbMinifigs] Inserted ${inserted} minifig rows into set_part_relationships.`);
    return { inserted };
  } finally {
    minifigSyncRunning = false;
  }
}

// ─── Rebrickable Unified Lane ────────────────────────────────────────────────
// Runs Colors → Set Parts → Set Minifigs in sequence as a single pipeline,
// mirroring how the BrickLink Inventory sync chains Colors → Categories →
// Inventory. Status is reported under the existing `rebrickable_set_parts`
// sync_metadata row so the schedule + UI continue to work unchanged.
//
// `force = false` (incremental):
//   • Colors  → always re-pull (~5s, small + idempotent)
//   • Sets    → skipped if already populated (no API call needed)
//   • Minifigs→ always re-run (clears + re-inserts fig-% rows, ~2–4 min)
//
// `force = true` (full rebuild):
//   • Truncates set_part_relationships and re-streams all CSVs.
let allLaneRunning = false;
export function getRebrickableAllRunning() {
  return allLaneRunning || isRunning || colorsSyncRunning || minifigSyncRunning;
}

export async function syncRebrickableAll(force = false): Promise<{
  colors: { inserted: number; mapped: number };
  setParts: RebrickableSyncResult;
  minifigs: { inserted: number };
}> {
  if (allLaneRunning) throw new Error('Rebrickable lane is already running');
  allLaneRunning = true;

  // Stamp in_progress on the canonical sync row up front so the UI shows it.
  await db.insert(syncMetadata).values({
    id: SYNC_ID,
    lastSyncStatus: 'in_progress',
    lastSyncTime: new Date(),
    recordsAdded: 0,
    recordsUpdated: 0,
    orgId: ORG_ID,
  }).onConflictDoUpdate({
    target: syncMetadata.id,
    set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date(), errorMessage: null },
  });

  const t0 = Date.now();
  try {
    console.log(`[RbLane] ▶ Starting unified Rebrickable sync (force=${force})…`);

    console.log('[RbLane] ① Colors…');
    const colors = await syncRebrickableColors();

    console.log('[RbLane] ② Set Parts…');
    const setParts = await syncRebrickableSetParts(force);

    console.log('[RbLane] ③ Set Minifigs…');
    const minifigs = await syncRebrickableSetMinifigs();

    // Resolve fig-XXXXXX → BrickLink minifig item_no (sw0001a, cty0966…) into
    // part_id_mappings so the Set Completion view can display BL identifiers
    // and join bl_catalog (item_type='MINIFIG') for official names + images.
    // Self-throttling: only fetches minifigs not yet in part_id_mappings.
    console.log('[RbLane] ④ Minifig BL ID mappings…');
    try {
      const figMap = await syncMinifigIdMappings();
      console.log(`[RbLane] ④ Mapped ${figMap.saved}/${figMap.processed} minifig BL IDs.`);
    } catch (err: any) {
      console.warn('[RbLane] ④ Minifig BL ID mapping failed (non-fatal):', err?.message);
    }

    const totalRows = colors.inserted + setParts.partsProcessed + minifigs.inserted;
    const elapsedMs = Date.now() - t0;
    console.log(`[RbLane] ✓ Done in ${(elapsedMs / 1000).toFixed(1)}s — colors:${colors.inserted}, set-parts:${setParts.partsProcessed}, minifigs:${minifigs.inserted}`);

    await db.update(syncMetadata)
      .set({
        lastSyncStatus: 'success',
        lastSyncTime: new Date(),
        recordsAdded: force ? totalRows : 0,
        recordsUpdated: totalRows,
        updatedAt: new Date(),
        errorMessage: null,
      })
      .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, SYNC_ID)));

    return { colors, setParts, minifigs };
  } catch (err: any) {
    console.error('[RbLane] ✗ Failed:', err?.message);
    await db.update(syncMetadata)
      .set({
        lastSyncStatus: 'error',
        lastSyncTime: new Date(),
        updatedAt: new Date(),
        errorMessage: err?.message?.slice(0, 500) || 'Unknown error',
      })
      .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, SYNC_ID)));
    throw err;
  } finally {
    allLaneRunning = false;
  }
}

// Helper function to create a download stream (follows redirects)
function downloadStream(url: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadStream(redirectUrl).then(resolve).catch(reject);
          return;
        }
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download file: ${response.statusCode}`));
        return;
      }
      
      // Return the response stream directly
      resolve(response as Readable);
    }).on('error', (error) => {
      reject(error);
    });

    // Add 30-second timeout to prevent indefinite hanging
    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error(`Request timeout after 30 seconds for URL: ${url}`));
    });
  });
}

import { db } from "../db";
import { setPartRelationships, partRelationships, syncMetadata, blInventory, PLATFORM_ORG_ID } from "@shared/schema";
import type { InsertInventoryHistory } from "@shared/schema";
import { sql, eq, and, inArray, isNotNull } from "drizzle-orm";
import { recordInventoryChanges } from "./inventory-history";
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
          colorId: parseInt(record.color_id) || null,
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
    // ── Snapshot existing type-A pairs before overwriting ────────────────────
    // Only on re-syncs (cnt > 0). On first-ever population we skip diffing to
    // avoid flooding the history log with tens-of-thousands of "new" entries.
    const existingCnt = await db.select({ cnt: sql<number>`COUNT(*)::int` }).from(partRelationships);
    const isFirstPopulation = existingCnt[0].cnt === 0;

    const oldAltPairs = new Set<string>();
    if (!isFirstPopulation) {
      const oldAlts = await db
        .select({ child: partRelationships.childPartNum, parent: partRelationships.parentPartNum })
        .from(partRelationships)
        .where(eq(partRelationships.relType, 'A'));
      for (const r of oldAlts) oldAltPairs.add(`${r.child}:${r.parent}`);
      console.log(`[PartRel] Snapshot: ${oldAltPairs.size} existing type-A pairs loaded for diff.`);
    }

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
    if (!isFirstPopulation) {
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

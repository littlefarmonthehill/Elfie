import { db } from "../db";
import { setPartRelationships } from "@shared/schema";
import { sql } from "drizzle-orm";
import https from "https";
import { parse } from "csv-parse";
import { createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

export interface RebrickableSyncResult {
  setsAdded: number;
  setsUpdated: number;
  partsProcessed: number;
}

// Download and parse Rebrickable inventory_parts.csv using streaming
export async function syncRebrickableSetParts(): Promise<RebrickableSyncResult> {
  try {
    console.log('[Rebrickable] Starting set-part relationships sync...');
    
    // Clear existing data before importing
    await db.delete(setPartRelationships);
    console.log('[Rebrickable] Cleared existing set-part relationships');
    
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
    
    return {
      setsAdded: setCount.length,
      setsUpdated: 0,
      partsProcessed,
    };
  } catch (error) {
    console.error('[Rebrickable] Sync failed:', error);
    throw error;
  }
}

// Helper function to create a download stream (follows redirects)
function downloadStream(url: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
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
  });
}

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
    
    // Download URL from Rebrickable's downloads page
    // https://rebrickable.com/downloads/
    const csvUrl = 'https://cdn.rebrickable.com/media/downloads/inventory_parts.csv.gz';
    
    console.log('[Rebrickable] Downloading and streaming CSV...');
    
    // Clear existing data before importing
    await db.delete(setPartRelationships);
    console.log('[Rebrickable] Cleared existing set-part relationships');
    
    let partsProcessed = 0;
    let batch: any[] = [];
    const BATCH_SIZE = 1000;
    const LOG_INTERVAL = 10000;
    
    // Stream: download → gunzip → parse → batch insert
    await new Promise<void>((resolve, reject) => {
      const stream = downloadStream(csvUrl);
      const gunzip = createGunzip();
      const parser = parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
      
      parser.on('data', async (record) => {
        // Add to batch
        batch.push({
          setNum: record.set_num || record.inv_part_id?.split('-')[0], // Fallback to parsing from ID
          setName: null, // inventory_parts.csv doesn't include set names
          partNum: record.part_num,
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

// Helper function to create a download stream
function downloadStream(url: string): Readable {
  return new Readable({
    read() {
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            const redirectedStream = downloadStream(redirectUrl);
            redirectedStream.pipe(this);
            return;
          }
        }
        
        if (response.statusCode !== 200) {
          this.destroy(new Error(`Failed to download file: ${response.statusCode}`));
          return;
        }
        
        response.on('data', (chunk) => {
          this.push(chunk);
        });
        
        response.on('end', () => {
          this.push(null); // Signal end of stream
        });
        
        response.on('error', (error) => {
          this.destroy(error);
        });
      }).on('error', (error) => {
        this.destroy(error);
      });
    }
  });
}

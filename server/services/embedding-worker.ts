import { db } from "../db";
import { embeddingJobs, blInventory, orders, setPartRelationships } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { batchEmbedInventory, batchEmbedOrders, batchEmbedSets } from "./embeddings";

let processingJobs: Set<string> = new Set();
let workerInterval: NodeJS.Timeout | null = null;

/**
 * Start the background worker that processes embedding jobs
 */
export function startEmbeddingWorker() {
  if (workerInterval) {
    console.log('⚠️  Embedding worker already running');
    return;
  }

  console.log('🤖 Embedding worker started');
  
  // Check for pending jobs every 10 seconds
  workerInterval = setInterval(async () => {
    await processNextJob();
  }, 10000);

  // Also process immediately on startup
  processNextJob();
}

/**
 * Stop the background worker
 */
export function stopEmbeddingWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('🛑 Embedding worker stopped');
  }
}

/**
 * Process the next pending embedding job
 */
async function processNextJob() {
  try {
    // Find the oldest pending job whose type isn't already being processed
    const pendingJobs = await db
      .select()
      .from(embeddingJobs)
      .where(eq(embeddingJobs.status, 'pending'))
      .orderBy(embeddingJobs.createdAt);

    if (pendingJobs.length === 0) {
      return; // No pending jobs
    }

    // Find first job whose type isn't already processing
    const job = pendingJobs.find(j => !processingJobs.has(j.jobType));
    
    if (!job) {
      return; // All pending job types are already being processed
    }

    // Mark this job type as processing
    processingJobs.add(job.jobType);

    console.log(`🧠 Processing embedding job ${job.id} (${job.jobType})`);

    // Mark as processing
    await db
      .update(embeddingJobs)
      .set({
        status: 'processing',
        startedAt: new Date(),
      })
      .where(eq(embeddingJobs.id, job.id));

    try {
      // Process based on job type
      switch (job.jobType) {
        case 'inventory': {
          // First, get items that don't have embeddings yet
          const unembeddedItems = await db.execute(sql`
            SELECT bi.id
            FROM bl_inventory bi
            LEFT JOIN inventory_embeddings ie ON bi.id = ie.inventory_id
            WHERE ie.inventory_id IS NULL
            ORDER BY bi.id
            LIMIT 100
          `);
          
          if (unembeddedItems.rows.length > 0) {
            // Process items without embeddings first
            const inventoryIds = unembeddedItems.rows.map((r: any) => r.id);
            await batchEmbedInventory(inventoryIds);
            console.log(`  ✓ Embedded ${inventoryIds.length} inventory items (new)`);
          } else {
            // All items have embeddings, update recently changed ones
            const recentInventory = await db
              .select({ id: blInventory.id })
              .from(blInventory)
              .orderBy(sql`${blInventory.updatedAt} DESC`)
              .limit(100);
            
            if (recentInventory.length > 0) {
              const inventoryIds = recentInventory.map(i => i.id);
              await batchEmbedInventory(inventoryIds);
              console.log(`  ✓ Re-embedded ${inventoryIds.length} inventory items (updated)`);
            }
          }
          break;
        }
        case 'sets': {
          // Get unique set numbers that don't have embeddings yet
          const newSets = await db.execute(sql`
            SELECT DISTINCT spr.set_num 
            FROM set_part_relationships spr
            LEFT JOIN set_part_embeddings spe ON spr.set_num = spe.set_num
            WHERE spe.set_num IS NULL
            LIMIT 50
          `);
          
          if (newSets.rows.length > 0) {
            const setNumbers = newSets.rows.map((r: any) => r.set_num);
            await batchEmbedSets(setNumbers);
            console.log(`  ✓ Embedded ${setNumbers.length} LEGO sets`);
          }
          break;
        }
        case 'orders': {
          // First, get orders that don't have embeddings yet
          const unembeddedOrders = await db.execute(sql`
            SELECT o.id
            FROM orders o
            LEFT JOIN order_embeddings oe ON o.id = oe.order_id
            WHERE oe.order_id IS NULL
            ORDER BY o.order_date DESC
            LIMIT 50
          `);
          
          if (unembeddedOrders.rows.length > 0) {
            // Process orders without embeddings first
            const orderIds = unembeddedOrders.rows.map((r: any) => r.id);
            await batchEmbedOrders(orderIds);
            console.log(`  ✓ Embedded ${orderIds.length} orders (new)`);
          } else {
            // All orders have embeddings, update recently changed ones
            const recentOrders = await db
              .select({ id: orders.id })
              .from(orders)
              .orderBy(sql`${orders.updatedAt} DESC`)
              .limit(50);
            
            if (recentOrders.length > 0) {
              const orderIds = recentOrders.map(o => o.id);
              await batchEmbedOrders(orderIds);
              console.log(`  ✓ Re-embedded ${orderIds.length} orders (updated)`);
            }
          }
          break;
        }
        default:
          throw new Error(`Unknown job type: ${job.jobType}`);
      }

      // Mark as completed
      await db
        .update(embeddingJobs)
        .set({
          status: 'completed',
          completedAt: new Date(),
        })
        .where(eq(embeddingJobs.id, job.id));

      console.log(`✅ Embedding job ${job.id} completed successfully`);
    } catch (error) {
      console.error(`❌ Embedding job ${job.id} failed:`, error);

      // Mark as failed
      await db
        .update(embeddingJobs)
        .set({
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
        })
        .where(eq(embeddingJobs.id, job.id));
    } finally {
      // Remove this job type from processing set
      processingJobs.delete(job.jobType);
    }
  } catch (error) {
    console.error('Error processing embedding job:', error);
  }
}

/**
 * Create a new embedding job
 */
export async function createEmbeddingJob(jobType: 'inventory' | 'sets' | 'orders', triggeredBy: string) {
  const [job] = await db
    .insert(embeddingJobs)
    .values({
      jobType,
      status: 'pending',
      triggeredBy,
    })
    .returning();

  console.log(`📋 Created embedding job ${job.id} for ${jobType}`);
  return job;
}

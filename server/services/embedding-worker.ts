import { db } from "../db";
import { embeddingJobs, blInventory, orders, orderDetails, setPartRelationships } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { batchEmbedInventory, batchEmbedOrders, batchEmbedOrderDetails, batchEmbedSets } from "./embeddings";

let processingJobs: Set<string> = new Set();
let workerInterval: NodeJS.Timeout | null = null;

/**
 * Start the background worker that processes embedding jobs
 */
export async function startEmbeddingWorker() {
  if (workerInterval) {
    console.log('⚠️  Embedding worker already running');
    return;
  }

  // Reset any jobs that were left in 'processing' state by a previous server run.
  // Without this, restarting the server permanently orphans in-flight jobs.
  try {
    const reset = await db
      .update(embeddingJobs)
      .set({ status: 'pending' })
      .where(eq(embeddingJobs.status, 'processing'))
      .returning({ id: embeddingJobs.id });
    if (reset.length > 0) {
      console.log(`🔄 Resumed ${reset.length} embedding job(s) interrupted by last restart`);
    }
  } catch (e: any) {
    console.error('[EmbeddingWorker] Could not reset stuck jobs (non-fatal):', e.message);
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
      // Track whether there are more items left after this batch
      let hasMore = false;

      // Process based on job type
      switch (job.jobType) {
        case 'inventory': {
          const BATCH = 100;
          const unembeddedItems = await db.execute(sql`
            SELECT bi.id
            FROM bl_inventory bi
            LEFT JOIN inventory_embeddings ie ON bi.id = ie.inventory_id
            WHERE ie.inventory_id IS NULL
            ORDER BY bi.id
            LIMIT ${BATCH}
          `);
          
          if (unembeddedItems.rows.length > 0) {
            const existingCount = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM inventory_embeddings`);
            const isOnboarding = (existingCount.rows[0] as any)?.cnt < 10;
            const inventoryIds = unembeddedItems.rows.map((r: any) => r.id);
            const results = await batchEmbedInventory(inventoryIds, isOnboarding);
            const succeeded = results.filter((r: any) => r?.success).length;
            console.log(`  ✓ Embedded ${succeeded}/${inventoryIds.length} inventory items (new)`);
            // Guard: if nothing actually embedded, do not re-queue — would loop
            // forever on the same items hitting whatever soft error blocked them.
            if (succeeded === 0) {
              throw new Error(`Inventory embed batch had 0 successes out of ${inventoryIds.length}`);
            }
            // If we got a full batch (and made progress) there are likely more remaining
            hasMore = unembeddedItems.rows.length >= BATCH;
          } else {
            // All items have embeddings — do a maintenance re-embed of recent changes
            const recentInventory = await db
              .select({ id: blInventory.id })
              .from(blInventory)
              .orderBy(sql`${blInventory.updatedAt} DESC`)
              .limit(BATCH);
            
            if (recentInventory.length > 0) {
              const inventoryIds = recentInventory.map(i => i.id);
              await batchEmbedInventory(inventoryIds);
              console.log(`  ✓ Re-embedded ${inventoryIds.length} inventory items (updated)`);
            }
            // Maintenance pass — no more "new" items, let job complete
            hasMore = false;
          }
          break;
        }
        case 'sets': {
          const BATCH = 50;
          const newSets = await db.execute(sql`
            SELECT DISTINCT spr.set_num 
            FROM set_part_relationships spr
            LEFT JOIN set_part_embeddings spe ON spr.set_num = spe.set_num
            WHERE spe.set_num IS NULL
            LIMIT ${BATCH}
          `);
          
          if (newSets.rows.length > 0) {
            const setNumbers = newSets.rows.map((r: any) => r.set_num);
            await batchEmbedSets(setNumbers);
            console.log(`  ✓ Embedded ${setNumbers.length} LEGO sets`);
            hasMore = newSets.rows.length >= BATCH;
          }
          break;
        }
        case 'orders': {
          const BATCH = 50;
          const unembeddedOrders = await db.execute(sql`
            SELECT o.id
            FROM orders o
            LEFT JOIN order_embeddings oe ON o.id = oe.order_id
            WHERE oe.order_id IS NULL
            ORDER BY o.order_date DESC
            LIMIT ${BATCH}
          `);
          
          if (unembeddedOrders.rows.length > 0) {
            const existingCount = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM order_embeddings`);
            const isOnboarding = (existingCount.rows[0] as any)?.cnt < 10;
            const orderIds = unembeddedOrders.rows.map((r: any) => r.id);
            await batchEmbedOrders(orderIds, isOnboarding);
            console.log(`  ✓ Embedded ${orderIds.length} orders (new)`);
            hasMore = unembeddedOrders.rows.length >= BATCH;
          } else {
            // All orders have embeddings — maintenance re-embed of recent changes
            const recentOrders = await db
              .select({ id: orders.id })
              .from(orders)
              .orderBy(sql`${orders.updatedAt} DESC`)
              .limit(BATCH);
            
            if (recentOrders.length > 0) {
              const orderIds = recentOrders.map(o => o.id);
              await batchEmbedOrders(orderIds);
              console.log(`  ✓ Re-embedded ${orderIds.length} orders (updated)`);
            }
            hasMore = false;
          }
          break;
        }
        case 'order_details': {
          const BATCH = 25;
          const unembeddedDetails = await db.execute(sql`
            SELECT od.id, od.order_id
            FROM order_details od
            LEFT JOIN order_detail_embeddings ode ON od.id = ode.order_detail_id
            WHERE ode.order_detail_id IS NULL
            ORDER BY od.id
            LIMIT ${BATCH}
          `);
          
          if (unembeddedDetails.rows.length > 0) {
            const uniqueOrderIds = Array.from(new Set(unembeddedDetails.rows.map((r: any) => r.order_id))).slice(0, 10);
            await batchEmbedOrderDetails(uniqueOrderIds);
            console.log(`  ✓ Embedded order details for ${uniqueOrderIds.length} orders`);
            hasMore = unembeddedDetails.rows.length >= BATCH;
          } else {
            const recentDetails = await db.execute(sql`
              SELECT DISTINCT od.order_id
              FROM order_details od
              INNER JOIN orders o ON od.order_id = o.id
              ORDER BY o.updated_at DESC
              LIMIT 10
            `);
            
            if (recentDetails.rows.length > 0) {
              const orderIds = recentDetails.rows.map((r: any) => r.order_id);
              await batchEmbedOrderDetails(orderIds);
              console.log(`  ✓ Re-embedded order details for ${orderIds.length} orders (updated)`);
            }
            hasMore = false;
          }
          break;
        }
        default:
          throw new Error(`Unknown job type: ${job.jobType}`);
      }

      if (hasMore) {
        // Reset to pending so the worker picks up the next batch automatically
        await db
          .update(embeddingJobs)
          .set({ status: 'pending' })
          .where(eq(embeddingJobs.id, job.id));
        console.log(`🔁 Job ${job.id} (${job.jobType}) has more items — rescheduled`);
      } else {
        // All done (or maintenance pass finished)
        await db
          .update(embeddingJobs)
          .set({
            status: 'completed',
            completedAt: new Date(),
          })
          .where(eq(embeddingJobs.id, job.id));
        console.log(`✅ Embedding job ${job.id} completed successfully`);
      }
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
export async function createEmbeddingJob(jobType: 'inventory' | 'sets' | 'orders' | 'order_details', triggeredBy: string) {
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

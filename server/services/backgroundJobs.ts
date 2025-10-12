import { db } from '../db';
import { blInventory, orders, inventoryEmbeddings, orderEmbeddings } from '@shared/schema';
import { eq, sql, notInArray } from 'drizzle-orm';
import { embedInventoryItem, embedOrder } from './embeddings';

interface JobStatus {
  id: string;
  type: 'inventory' | 'orders';
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  progress: {
    current: number;
    total: number;
    percentage: number;
  };
  batchSize: number;
  itemsProcessed: number;
  errors: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

class BackgroundJobManager {
  private jobs: Map<string, JobStatus> = new Map();
  private runningJobs: Set<string> = new Set();

  /**
   * Start a background embedding job
   */
  async startEmbeddingJob(
    type: 'inventory' | 'orders',
    batchSize: number = 30
  ): Promise<string> {
    const jobId = `${type}-${Date.now()}`;
    
    // Check if there's already a running job of this type
    const existingJob = Array.from(this.jobs.values()).find(
      j => j.type === type && j.status === 'running'
    );
    
    if (existingJob) {
      throw new Error(`A ${type} embedding job is already running`);
    }

    // Get total items to process
    const total = await this.getUnembeddedCount(type);
    
    const job: JobStatus = {
      id: jobId,
      type,
      status: 'running',
      progress: {
        current: 0,
        total,
        percentage: 0,
      },
      batchSize,
      itemsProcessed: 0,
      errors: 0,
      startedAt: new Date(),
    };

    this.jobs.set(jobId, job);
    this.runningJobs.add(jobId);

    // Start processing in background (don't await)
    this.processJob(jobId).catch(err => {
      console.error(`Job ${jobId} failed:`, err);
      const job = this.jobs.get(jobId);
      if (job) {
        job.status = 'error';
        job.error = err.message;
        this.runningJobs.delete(jobId);
      }
    });

    return jobId;
  }

  /**
   * Stop a running job
   */
  stopJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') {
      return false;
    }

    job.status = 'paused';
    this.runningJobs.delete(jobId);
    return true;
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): JobStatus | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs
   */
  getAllJobs(): JobStatus[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get active job for a type
   */
  getActiveJob(type: 'inventory' | 'orders'): JobStatus | undefined {
    return Array.from(this.jobs.values()).find(
      j => j.type === type && (j.status === 'running' || j.status === 'paused')
    );
  }

  /**
   * Process a job in the background
   */
  private async processJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      while (job.status === 'running') {
        // Get next batch of unembedded items
        const items = await this.getUnembeddedItems(job.type, job.batchSize);
        
        if (items.length === 0) {
          // Job complete
          job.status = 'completed';
          job.completedAt = new Date();
          job.progress.percentage = 100;
          this.runningJobs.delete(jobId);
          break;
        }

        // Process batch
        for (const item of items) {
          if (job.status !== 'running') break;

          try {
            if (job.type === 'inventory') {
              await embedInventoryItem(item.id);
            } else {
              await embedOrder(item.id);
            }
            job.itemsProcessed++;
          } catch (error: any) {
            console.error(`Error embedding ${job.type} ${item.id}:`, error);
            job.errors++;
          }

          // Update progress
          job.progress.current = job.itemsProcessed;
          const total = await this.getUnembeddedCount(job.type);
          job.progress.total = total + job.itemsProcessed;
          job.progress.percentage = Math.round(
            (job.itemsProcessed / job.progress.total) * 100
          );

          // Small delay to avoid overwhelming the API
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Check if job was stopped
        if (job.status !== 'running') {
          break;
        }
      }
    } catch (error: any) {
      console.error(`Job ${jobId} error:`, error);
      job.status = 'error';
      job.error = error.message;
      this.runningJobs.delete(jobId);
    }
  }

  /**
   * Get count of unembedded items
   */
  private async getUnembeddedCount(type: 'inventory' | 'orders'): Promise<number> {
    if (type === 'inventory') {
      const embeddedIds = await db
        .select({ id: inventoryEmbeddings.inventoryId })
        .from(inventoryEmbeddings);
      
      const embedded = embeddedIds.map(e => e.id);
      
      if (embedded.length === 0) {
        const result = await db.execute(sql`SELECT COUNT(*) as count FROM bl_inventory`);
        return parseInt(String((result.rows[0] as any)?.count || '0'));
      }
      
      const result = await db.execute(sql`
        SELECT COUNT(*) as count 
        FROM bl_inventory 
        WHERE id NOT IN (${sql.join(embedded.map(id => sql`${id}`), sql`, `)})
      `);
      return parseInt(String((result.rows[0] as any)?.count || '0'));
    } else {
      const embeddedIds = await db
        .select({ id: orderEmbeddings.orderId })
        .from(orderEmbeddings);
      
      const embedded = embeddedIds.map(e => e.id);
      
      if (embedded.length === 0) {
        const result = await db.execute(sql`SELECT COUNT(*) as count FROM orders`);
        return parseInt(String((result.rows[0] as any)?.count || '0'));
      }
      
      const result = await db.execute(sql`
        SELECT COUNT(*) as count 
        FROM orders 
        WHERE id NOT IN (${sql.join(embedded.map(id => sql`${id}`), sql`, `)})
      `);
      return parseInt(String((result.rows[0] as any)?.count || '0'));
    }
  }

  /**
   * Get unembedded items
   */
  private async getUnembeddedItems(
    type: 'inventory' | 'orders',
    limit: number
  ): Promise<{ id: any }[]> {
    if (type === 'inventory') {
      const embeddedIds = await db
        .select({ id: inventoryEmbeddings.inventoryId })
        .from(inventoryEmbeddings);
      
      const embedded = embeddedIds.map(e => e.id);
      
      if (embedded.length === 0) {
        return await db
          .select({ id: blInventory.id })
          .from(blInventory)
          .limit(limit);
      }
      
      return await db
        .select({ id: blInventory.id })
        .from(blInventory)
        .where(notInArray(blInventory.id, embedded))
        .limit(limit);
    } else {
      const embeddedIds = await db
        .select({ id: orderEmbeddings.orderId })
        .from(orderEmbeddings);
      
      const embedded = embeddedIds.map(e => e.id);
      
      if (embedded.length === 0) {
        return await db
          .select({ id: orders.id })
          .from(orders)
          .limit(limit);
      }
      
      return await db
        .select({ id: orders.id })
        .from(orders)
        .where(notInArray(orders.id, embedded))
        .limit(limit);
    }
  }
}

// Singleton instance
export const jobManager = new BackgroundJobManager();

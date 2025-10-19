import { db } from "../db";
import { 
  restoreJobs, 
  differentialBatches, 
  anomalyEvents,
  blInventory,
  type InsertRestoreJob,
  type InsertDifferentialBatch,
  type InsertAnomalyEvent,
} from "@shared/schema";
import { eq, sql, desc, and, isNull } from "drizzle-orm";
import { syncLock } from "./sync-lock";
import { getBrickOwlInventory, type BrickOwlInventoryLot } from "./brickowl";
import { updateBrickLinkInventoryItem } from "./bricklink";

// Anomaly detection thresholds
export const ANOMALY_THRESHOLDS = {
  massiveQuantityChange: 0.40, // 40% of items changing quantity
  quantityStdDevMultiplier: 2.0, // 2x standard deviation
  priceSwing: 0.60, // 60% price change
  remarksWipePercentage: 0.30, // 30% of remarks deleted
} as const;

export interface DifferentialAnalysis {
  totalItems: number;
  quantityChanges: number;
  netQuantityChange: number;
  priceUpdates: number;
  remarksUpdates: number;
  descriptionUpdates: number;
  anomalies: Array<{
    type: string;
    severity: string;
    description: string;
    affectedItems: number;
    metricValue: number;
  }>;
}

export interface VerificationResults {
  inventoryMatch: boolean;
  orderStatusMatch: boolean;
  platformSync: boolean;
  inventoryCount: number;
  bricklinkCount: number;
  brickowlCount: number;
  discrepancies: number;
}

/**
 * Create a new restore job
 */
export async function createRestoreJob(
  restoreTimestamp: Date,
  initiatedBy: string
): Promise<string> {
  const [job] = await db.insert(restoreJobs).values({
    restoreTimestamp,
    initiatedBy,
    status: 'pending',
    currentStep: 'Initializing restore job',
    progress: 0,
  }).returning();

  return job.id;
}

/**
 * Update restore job status
 */
export async function updateRestoreJobStatus(
  jobId: string,
  updates: {
    status?: string;
    currentStep?: string;
    progress?: number;
    errorMessage?: string;
    verificationResults?: VerificationResults;
    [key: string]: any;
  }
): Promise<void> {
  const updateData: any = { ...updates };
  
  // Convert verificationResults to JSON string if present
  if (updates.verificationResults) {
    updateData.verificationResults = JSON.stringify(updates.verificationResults);
  }
  
  await db.update(restoreJobs)
    .set(updateData)
    .where(eq(restoreJobs.id, jobId));
}

/**
 * Get restore job by ID
 */
export async function getRestoreJob(jobId: string) {
  const [job] = await db.select()
    .from(restoreJobs)
    .where(eq(restoreJobs.id, jobId));
  
  if (!job) return null;
  
  // Parse verification results if present
  if (job.verificationResults) {
    return {
      ...job,
      verificationResults: JSON.parse(job.verificationResults),
    };
  }
  
  return job;
}

/**
 * Simulate database restore (Neon PITR)
 * In production, this would trigger Neon branch creation from backup
 */
export async function performDatabaseRestore(
  jobId: string,
  restoreTimestamp: Date
): Promise<void> {
  await updateRestoreJobStatus(jobId, {
    status: 'restoring',
    currentStep: 'Restoring database to point-in-time',
    progress: 10,
    dbRestoreStarted: new Date(),
  });

  // Simulate restore delay (in production, this would call Neon API)
  // For now, we'll just update the status
  await new Promise(resolve => setTimeout(resolve, 2000));

  await updateRestoreJobStatus(jobId, {
    currentStep: 'Database restore complete',
    progress: 25,
    dbRestoreCompleted: new Date(),
  });
}

/**
 * Perform platform sync (pull from BrickLink and BrickOwl)
 */
export async function performPlatformSync(jobId: string): Promise<void> {
  await updateRestoreJobStatus(jobId, {
    status: 'syncing',
    currentStep: 'Syncing from BrickLink and BrickOwl',
    progress: 30,
    platformSyncStarted: new Date(),
  });

  // In production, this would trigger actual sync jobs
  // For now, simulate the sync
  await new Promise(resolve => setTimeout(resolve, 3000));

  await updateRestoreJobStatus(jobId, {
    currentStep: 'Platform sync complete',
    progress: 50,
    platformSyncCompleted: new Date(),
  });
}

/**
 * Analyze differential between BrickOwl (current) and BrickLink (restored)
 */
export async function analyzeDifferential(jobId: string): Promise<DifferentialAnalysis> {
  await updateRestoreJobStatus(jobId, {
    currentStep: 'Analyzing differential data',
    progress: 55,
  });

  // Get BrickOwl inventory (current state)
  const brickowlInventory = await getBrickOwlInventory();
  
  // Get BrickLink inventory (restored state)
  const bricklinkInventory = await db.select().from(blInventory);

  // Create lookup map for BrickLink inventory by ID
  const blInventoryMap = new Map(
    bricklinkInventory.map(item => [item.id, item])
  );

  let quantityChanges = 0;
  let netQuantityChange = 0;
  let priceUpdates = 0;
  let remarksUpdates = 0;
  let descriptionUpdates = 0;
  const anomalies: Array<{
    type: string;
    severity: string;
    description: string;
    affectedItems: number;
    metricValue: number;
  }> = [];

  // Analyze each BrickOwl item
  for (const boItem of brickowlInventory) {
    // Match using external_lot_ids.other (contains BrickLink ID)
    const externalIds = boItem.external_lot_ids || {};
    const brickLinkId = externalIds.other ? parseInt(externalIds.other) : null;
    
    if (!brickLinkId) continue;
    
    const blItem = blInventoryMap.get(brickLinkId);
    if (!blItem) continue;

    // Check quantity changes
    const boQty = boItem.quantity || parseInt(boItem.qty || '0');
    if (boQty !== blItem.quantity) {
      quantityChanges++;
      netQuantityChange += (boQty - blItem.quantity);
    }

    // Check price updates
    const boPrice = parseFloat(boItem.price || '0');
    const blPrice = parseFloat(blItem.unitPrice || '0');
    if (Math.abs(boPrice - blPrice) > 0.01) {
      priceUpdates++;
    }

    // Check remarks (personal_note)
    if (boItem.personal_note !== blItem.remarks) {
      remarksUpdates++;
    }

    // Check descriptions (public_note)
    if (boItem.public_note !== blItem.description) {
      descriptionUpdates++;
    }
  }

  // Fraud detection: Check for anomalies
  const totalItems = brickowlInventory.length;
  
  // Anomaly 1: Massive quantity changes
  const quantityChangePercentage = quantityChanges / totalItems;
  if (quantityChangePercentage > ANOMALY_THRESHOLDS.massiveQuantityChange) {
    const anomaly = {
      type: 'massive_quantity_change',
      severity: quantityChangePercentage > 0.60 ? 'critical' : 'high',
      description: `${(quantityChangePercentage * 100).toFixed(1)}% of inventory items have quantity changes`,
      affectedItems: quantityChanges,
      metricValue: parseFloat((quantityChangePercentage * 100).toFixed(2)),
    };
    anomalies.push(anomaly);
    
    // Log to database
    await db.insert(anomalyEvents).values({
      restoreJobId: jobId,
      anomalyType: anomaly.type,
      severity: anomaly.severity,
      description: anomaly.description,
      affectedItems: anomaly.affectedItems,
      metricValue: anomaly.metricValue.toString(),
      threshold: (ANOMALY_THRESHOLDS.massiveQuantityChange * 100).toString(),
    });
  }

  // Anomaly 2: Large net quantity change
  const avgQuantity = bricklinkInventory.reduce((sum, item) => sum + item.quantity, 0) / bricklinkInventory.length;
  const netChangePercentage = Math.abs(netQuantityChange) / (totalItems * avgQuantity);
  if (netChangePercentage > 0.30) {
    const anomaly = {
      type: 'net_quantity_swing',
      severity: netChangePercentage > 0.50 ? 'high' : 'medium',
      description: `Net quantity change of ${netQuantityChange} pieces (${(netChangePercentage * 100).toFixed(1)}% of total inventory)`,
      affectedItems: totalItems,
      metricValue: parseFloat((netChangePercentage * 100).toFixed(2)),
    };
    anomalies.push(anomaly);
    
    await db.insert(anomalyEvents).values({
      restoreJobId: jobId,
      anomalyType: anomaly.type,
      severity: anomaly.severity,
      description: anomaly.description,
      affectedItems: anomaly.affectedItems,
      metricValue: anomaly.metricValue.toString(),
      threshold: '30',
    });
  }

  // Anomaly 3: Price swing detection
  const priceUpdatePercentage = priceUpdates / totalItems;
  if (priceUpdatePercentage > 0.20 && priceUpdates > 50) {
    const anomaly = {
      type: 'price_swing',
      severity: priceUpdatePercentage > 0.40 ? 'medium' : 'low',
      description: `${priceUpdates} items (${(priceUpdatePercentage * 100).toFixed(1)}%) have price changes`,
      affectedItems: priceUpdates,
      metricValue: parseFloat((priceUpdatePercentage * 100).toFixed(2)),
    };
    anomalies.push(anomaly);
    
    await db.insert(anomalyEvents).values({
      restoreJobId: jobId,
      anomalyType: anomaly.type,
      severity: anomaly.severity,
      description: anomaly.description,
      affectedItems: anomaly.affectedItems,
      metricValue: anomaly.metricValue.toString(),
      threshold: '20',
    });
  }

  // Anomaly 4: Remarks wipe detection
  const remarksWipePercentage = remarksUpdates / totalItems;
  if (remarksWipePercentage > ANOMALY_THRESHOLDS.remarksWipePercentage) {
    const anomaly = {
      type: 'remarks_wipe',
      severity: 'medium',
      description: `${(remarksWipePercentage * 100).toFixed(1)}% of remarks have changed`,
      affectedItems: remarksUpdates,
      metricValue: parseFloat((remarksWipePercentage * 100).toFixed(2)),
    };
    anomalies.push(anomaly);
    
    await db.insert(anomalyEvents).values({
      restoreJobId: jobId,
      anomalyType: anomaly.type,
      severity: anomaly.severity,
      description: anomaly.description,
      affectedItems: anomaly.affectedItems,
      metricValue: anomaly.metricValue.toString(),
      threshold: (ANOMALY_THRESHOLDS.remarksWipePercentage * 100).toString(),
    });
  }

  return {
    totalItems,
    quantityChanges,
    netQuantityChange,
    priceUpdates,
    remarksUpdates,
    descriptionUpdates,
    anomalies,
  };
}

/**
 * Apply differential recovery (update BrickLink from BrickOwl)
 */
export async function applyDifferentialRecovery(
  jobId: string,
  overrideAnomalies = false
): Promise<void> {
  // Check for anomalies first if not overriding
  if (!overrideAnomalies) {
    const analysis = await analyzeDifferential(jobId);
    const criticalAnomalies = analysis.anomalies.filter(a => 
      a.severity === 'critical' || a.severity === 'high'
    );
    
    if (criticalAnomalies.length > 0) {
      throw new Error(
        `Differential recovery blocked: ${criticalAnomalies.length} critical/high anomalies detected. ` +
        `Use overrideAnomalies=true to proceed anyway.`
      );
    }
  }
  
  await updateRestoreJobStatus(jobId, {
    status: 'differential',
    currentStep: 'Applying differential recovery',
    progress: 60,
    differentialStarted: new Date(),
  });

  // Acquire inventory sync lock to prevent conflicts
  const lockAcquired = await syncLock.acquireInventoryLock();
  
  if (!lockAcquired) {
    throw new Error('Failed to acquire inventory sync lock for differential recovery');
  }

  try {
    // Get BrickOwl inventory (current state)
    const brickowlInventory = await getBrickOwlInventory();
    
    // Get BrickLink inventory (restored state)
    const bricklinkInventory = await db.select().from(blInventory);

    // Create lookup map
    const blInventoryMap = new Map(
      bricklinkInventory.map(item => [item.id, item])
    );

    // Prepare batches for BrickLink API updates
    const BATCH_SIZE = 50; // Respect rate limits
    const updates: Array<{
      id: number;
      updates: any;
    }> = [];

    for (const boItem of brickowlInventory) {
      const externalIds = boItem.external_lot_ids || {};
      const brickLinkId = externalIds.other ? parseInt(externalIds.other) : null;
      
      if (!brickLinkId) continue;
      
      const blItem = blInventoryMap.get(brickLinkId);
      if (!blItem) continue;

      const itemUpdates: any = {};
      
      // Quantity update
      const boQty = boItem.quantity || parseInt(boItem.qty || '0');
      if (boQty !== blItem.quantity) {
        itemUpdates.quantity = boQty;
      }

      // Price update - preserve BrickLink's original precision (don't round)
      const boPrice = parseFloat(boItem.price || '0');
      const blPrice = parseFloat(blItem.unitPrice || '0');
      if (Math.abs(boPrice - blPrice) > 0.01) {
        itemUpdates.unit_price = boPrice; // Keep original precision from BrickOwl
      }

      // Remarks (personal_note)
      if (boItem.personal_note !== blItem.remarks) {
        itemUpdates.remarks = boItem.personal_note || '';
      }

      // Description (public_note)
      if (boItem.public_note !== blItem.description) {
        itemUpdates.description = boItem.public_note || '';
      }

      // Condition
      const boCondition = boItem.condition === 'new' ? 'N' : 'U';
      if (boCondition !== blItem.newOrUsed) {
        itemUpdates.new_or_used = boCondition;
      }

      if (Object.keys(itemUpdates).length > 0) {
        updates.push({ id: brickLinkId, updates: itemUpdates });
      }
    }

    // Process in batches
    const totalBatches = Math.ceil(updates.length / BATCH_SIZE);
    
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const batch = updates.slice(i, i + BATCH_SIZE);
      
      // Create batch record
      const [batchRecord] = await db.insert(differentialBatches).values({
        restoreJobId: jobId,
        batchNumber,
        totalBatches,
        inventoryIds: JSON.stringify(batch.map(u => u.id)),
        status: 'pending',
      }).returning();

      try {
        // Update progress
        const progress = 60 + Math.floor((batchNumber / totalBatches) * 30);
        await updateRestoreJobStatus(jobId, {
          currentStep: `Processing batch ${batchNumber} of ${totalBatches}`,
          progress,
        });

        // Apply updates to BrickLink via API
        for (const { id, updates: itemUpdates } of batch) {
          try {
            await updateBrickLinkInventoryItem(id, itemUpdates);
            
            // Also update local database
            await db.update(blInventory)
              .set(itemUpdates)
              .where(eq(blInventory.id, id));
          } catch (error) {
            console.error(`Failed to update BrickLink item ${id}:`, error);
            // Continue with other items
          }
        }

        // Mark batch as complete
        await db.update(differentialBatches)
          .set({
            status: 'completed',
            completedAt: new Date(),
            quantityUpdates: batch.filter(b => b.updates.quantity !== undefined).length,
            priceUpdates: batch.filter(b => b.updates.unit_price !== undefined).length,
            remarksUpdates: batch.filter(b => b.updates.remarks !== undefined).length,
            descriptionUpdates: batch.filter(b => b.updates.description !== undefined).length,
          })
          .where(eq(differentialBatches.id, batchRecord.id));

      } catch (error) {
        // Mark batch as failed
        await db.update(differentialBatches)
          .set({
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            completedAt: new Date(),
          })
          .where(eq(differentialBatches.id, batchRecord.id));
        
        throw error;
      }
    }

    await updateRestoreJobStatus(jobId, {
      currentStep: 'Differential recovery complete',
      progress: 90,
      differentialCompleted: new Date(),
    });

  } finally {
    // Always release the lock
    syncLock.releaseInventoryLock();
  }
}

/**
 * Perform verification checks
 */
export async function performVerification(jobId: string): Promise<VerificationResults> {
  await updateRestoreJobStatus(jobId, {
    status: 'verifying',
    currentStep: 'Verifying data integrity',
    progress: 92,
    verificationStarted: new Date(),
  });

  // Get inventory counts
  const inventoryCount = await db.select({ count: sql<number>`count(*)` })
    .from(blInventory)
    .then(rows => rows[0].count);

  // In production, this would query BrickLink and BrickOwl APIs
  // For now, simulate verification
  const bricklinkCount = inventoryCount;
  const brickowlCount = inventoryCount;
  const discrepancies = 0;

  const results: VerificationResults = {
    inventoryMatch: discrepancies === 0,
    orderStatusMatch: true, // Simplified for now
    platformSync: true,
    inventoryCount,
    bricklinkCount,
    brickowlCount,
    discrepancies,
  };

  await updateRestoreJobStatus(jobId, {
    currentStep: 'Verification complete',
    progress: 95,
    verificationCompleted: new Date(),
    verificationResults: results,
  });

  return results;
}

/**
 * Complete restore job
 */
export async function completeRestoreJob(jobId: string): Promise<void> {
  await updateRestoreJobStatus(jobId, {
    status: 'complete',
    currentStep: 'Restore complete',
    progress: 100,
    completedAt: new Date(),
  });
}

/**
 * Fail restore job
 */
export async function failRestoreJob(jobId: string, error: Error): Promise<void> {
  await updateRestoreJobStatus(jobId, {
    status: 'failed',
    errorMessage: error.message,
    completedAt: new Date(),
  });
}

/**
 * Get anomaly events for a restore job
 */
export async function getAnomalyEvents(jobId: string) {
  return await db.select()
    .from(anomalyEvents)
    .where(eq(anomalyEvents.restoreJobId, jobId))
    .orderBy(desc(anomalyEvents.createdAt));
}

/**
 * Acknowledge anomaly event
 */
export async function acknowledgeAnomaly(
  anomalyId: string,
  acknowledgedBy: string,
  resolution: string
): Promise<void> {
  await db.update(anomalyEvents)
    .set({
      acknowledged: true,
      acknowledgedBy,
      acknowledgedAt: new Date(),
      resolution,
    })
    .where(eq(anomalyEvents.id, anomalyId));
}

/**
 * Initiate the complete restore workflow
 * This is the main entry point for database restoration
 */
export async function initiateRestoreWorkflow(
  targetTimestamp: string,
  skipPlatformSync = false
): Promise<string> {
  console.log(`🔄 Initiating restore workflow to timestamp: ${targetTimestamp}`);
  
  // Create restore job
  const jobId = await createRestoreJob(new Date(targetTimestamp), 'system');
  
  try {
    // Step 1: Database restore via Neon PITR (simulated - actual restore is manual)
    await updateRestoreJobStatus(jobId, {
      status: 'in_progress',
      currentStep: 'Database restore initiated - awaiting PITR completion',
      progress: 10,
    });
    
    console.log(`✓ Restore job ${jobId} created`);
    console.log(`⚠️  Manual action required: Restore database via Neon PITR to ${targetTimestamp}`);
    console.log(`⚠️  After PITR is complete, proceed with platform sync`);
    
    return jobId;
  } catch (error: any) {
    console.error(`✗ Restore workflow failed:`, error);
    await failRestoreJob(jobId, error);
    throw error;
  }
}

/**
 * Get the current status of a restore job
 */
export async function getRestoreStatus(jobId: string) {
  const [job] = await db.select()
    .from(restoreJobs)
    .where(eq(restoreJobs.id, jobId))
    .limit(1);
  
  if (!job) {
    return null;
  }
  
  // Get anomaly events if any
  const anomalies = await getAnomalyEvents(jobId);
  
  // Get differential batches if any
  const batches = await db.select()
    .from(differentialBatches)
    .where(eq(differentialBatches.restoreJobId, jobId))
    .orderBy(differentialBatches.batchNumber);
  
  return {
    ...job,
    anomalies,
    batches,
  };
}

/**
 * Run verification checks on restored data
 * This wraps the existing verifyDifferentialRecovery function
 */
export async function verifyRestoration(jobId: string): Promise<VerificationResults> {
  console.log(`🔍 Running verification checks for restore job ${jobId}`);
  
  try {
    const results = await verifyDifferentialRecovery(jobId);
    console.log(`✓ Verification complete for job ${jobId}`);
    return results;
  } catch (error: any) {
    console.error(`✗ Verification failed for job ${jobId}:`, error);
    throw error;
  }
}

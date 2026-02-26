import { db } from "../db";
import { appSettings, orders } from "@shared/schema";
import { syncBrickLinkOrders } from "./bricklink-order-sync";
import { syncBrickOwlOrders } from "./brickowl-order-sync";
import { syncLock } from "./sync-lock";
import { batchEmbedOrders, batchEmbedOrderDetails } from "./embeddings";
import { sql } from "drizzle-orm";
import { checkStuckInventoryDeductions } from "./sync-issue-service";

let syncInterval: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Start the automatic order sync scheduler
 * 
 * This checks app_settings for ordersSyncEnabled and ordersSyncFrequency,
 * then runs syncs for all platforms (ShipStation, BrickLink, BrickOwl) on schedule.
 */
export async function startOrderSyncScheduler() {
  console.log('🕒 Order sync scheduler initialized');
  
  // Initial check and sync
  await checkAndRunSync();
  
  // Check every minute if we should run a sync based on settings
  setInterval(async () => {
    await checkAndRunSync();
  }, 60 * 1000); // Check every minute
}

/**
 * Check settings and run sync if enabled and due
 */
async function checkAndRunSync() {
  try {
    // Get current settings
    const [settings] = await db
      .select()
      .from(appSettings)
      .limit(1);
    
    if (!settings) {
      return; // No settings configured yet
    }
    
    // Check if order sync is enabled
    if (!settings.ordersSyncEnabled) {
      return; // Sync is disabled
    }
    
    // Check if we should run based on frequency
    const frequencyMs = settings.ordersSyncFrequency * 60 * 1000;
    const now = Date.now();
    
    // Get last sync time from any platform (use the most recent)
    const lastSyncKey = 'last_order_sync_check';
    const lastSyncTime = (global as any)[lastSyncKey] || 0;
    
    if (now - lastSyncTime < frequencyMs) {
      return; // Not time yet
    }
    
    // Prevent concurrent syncs
    if (isRunning) {
      console.log('⏭️ Order sync already in progress, skipping this cycle');
      return;
    }
    
    // Update last sync time
    (global as any)[lastSyncKey] = now;
    
    // Run the sync
    await runAllPlatformSyncs(settings);
    
  } catch (error) {
    console.error('❌ Error in order sync scheduler:', error);
  }
}

/**
 * Run order syncs for all configured platforms
 * Respects inventory sync lock - will queue if inventory sync is running
 */
async function runAllPlatformSyncs(settings: any) {
  // Check if inventory sync is running
  if (syncLock.isInventorySyncRunning()) {
    console.log('⏸️ Inventory sync in progress - queueing order sync');
    
    // Queue this sync to run after inventory completes
    await syncLock.queueOrderSync(async () => {
      await executeOrderSync(settings);
    });
    return;
  }

  // No inventory sync running, execute immediately
  await executeOrderSync(settings);
}

/**
 * Execute the actual order sync logic
 */
async function executeOrderSync(settings: any) {
  isRunning = true;
  console.log('\n🔄 Starting scheduled order sync for all platforms...');
  
  const results = {
    shipstation: { success: false, error: null as any },
    bricklink: { success: false, error: null as any, ordersAdded: 0 },
    brickowl: { success: false, error: null as any, ordersAdded: 0 },
  };
  
  // Track order IDs for embedding
  const newOrderIds: string[] = [];
  
  try {
    // 1. Sync ShipStation orders (DEPRECATED - using EasyPost for shipping now)
    // ShipStation is no longer used for order syncing
    results.shipstation.success = true; // Mark as success (not used)
    
    // 2. Sync BrickLink orders (if credentials configured)
    if (settings.bricklinkConsumerKey && settings.bricklinkConsumerSecret && 
        settings.bricklinkTokenValue && settings.bricklinkTokenSecret) {
      try {
        console.log('🧱 Syncing BrickLink orders...');
        const blResult = await syncBrickLinkOrders(
          settings.bricklinkConsumerKey,
          settings.bricklinkConsumerSecret,
          settings.bricklinkTokenValue,
          settings.bricklinkTokenSecret,
          { fullSync: false } // Incremental sync
        );
        results.bricklink.success = true;
        results.bricklink.ordersAdded = blResult.ordersAdded;
        console.log('✅ BrickLink sync complete');
        
        // Track newly added orders for embedding
        if (blResult.ordersAdded > 0) {
          const recentOrders = await db.execute(sql`
            SELECT id FROM orders 
            WHERE marketplace = 'BrickLink'
            ORDER BY synced_at DESC 
            LIMIT ${blResult.ordersAdded}
          `);
          newOrderIds.push(...recentOrders.rows.map((r: any) => r.id));
        }
      } catch (error: any) {
        results.bricklink.error = error.message;
        console.error('❌ BrickLink sync failed:', error.message);
      }
    } else {
      console.log('⏭️ BrickLink credentials not configured, skipping');
    }
    
    // 3. Sync BrickOwl orders (if credentials configured)
    if (settings.brickowlApiKey) {
      try {
        console.log('🦉 Syncing BrickOwl orders...');
        const boResult = await syncBrickOwlOrders(
          settings.brickowlApiKey,
          { fullSync: false } // Incremental sync
        );
        results.brickowl.success = true;
        results.brickowl.ordersAdded = boResult.ordersAdded;
        console.log('✅ BrickOwl sync complete');
        
        // Track newly added orders for embedding
        if (boResult.ordersAdded > 0) {
          const recentOrders = await db.execute(sql`
            SELECT id FROM orders 
            WHERE marketplace = 'BrickOwl'
            ORDER BY synced_at DESC 
            LIMIT ${boResult.ordersAdded}
          `);
          newOrderIds.push(...recentOrders.rows.map((r: any) => r.id));
        }
      } catch (error: any) {
        results.brickowl.error = error.message;
        console.error('❌ BrickOwl sync failed:', error.message);
      }
    } else {
      console.log('⏭️ BrickOwl credentials not configured, skipping');
    }
    
    // 4. Generate embeddings for new orders and their order details
    if (newOrderIds.length > 0) {
      console.log(`🧠 Generating AI embeddings for ${newOrderIds.length} new orders...`);
      try {
        // Embed orders
        await batchEmbedOrders(newOrderIds);
        console.log(`  ✓ Generated order embeddings`);
        
        // Embed order details (line items)
        await batchEmbedOrderDetails(newOrderIds);
        console.log(`  ✓ Generated order detail embeddings`);
        
        console.log(`✓ Embeddings complete for ${newOrderIds.length} orders`);
      } catch (error) {
        console.error('✗ Order embedding failed (non-fatal):', error);
      }
    }
    
    // 5. Sync Stripe refunds (if key configured)
    if (process.env.STRIPE_SECRET_KEY) {
      try {
        console.log('💳 Syncing Stripe refunds...');
        const { syncStripeRefunds } = await import('./stripe-refunds');
        const stripeResult = await syncStripeRefunds(90); // Look back 90 days
        if (stripeResult.matched > 0) {
          console.log(`✅ Stripe sync: ${stripeResult.matched} new refunds matched to orders`);
        } else if (stripeResult.alreadySynced > 0) {
          console.log(`✅ Stripe sync: ${stripeResult.alreadySynced} refunds already synced`);
        } else {
          console.log(`✅ Stripe sync: no new refunds`);
        }
      } catch (error: any) {
        console.error('❌ Stripe refund sync failed (non-fatal):', error.message);
        // Non-fatal — don't block order sync
      }
    }

    // 6. Check for orders where inventory was never deducted (silent failure detector)
    await checkStuckInventoryDeductions();
    
    // Summary
    const successCount = Object.values(results).filter(r => r.success).length;
    const totalAttempted = Object.values(results).filter(r => r.success || r.error).length;
    const totalOrdersAdded = results.bricklink.ordersAdded + results.brickowl.ordersAdded;
    
    console.log(`\n✨ Order sync complete: ${successCount}/${totalAttempted} platforms successful, ${totalOrdersAdded} new orders`);
    
  } finally {
    isRunning = false;
  }
}

/**
 * Stop the order sync scheduler
 */
export function stopOrderSyncScheduler() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('🛑 Order sync scheduler stopped');
  }
}

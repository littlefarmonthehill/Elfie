import { db } from "../db";
import { appSettings } from "@shared/schema";
import { syncBrickLinkOrders } from "./bricklink-order-sync";
import { syncBrickOwlOrders } from "./brickowl-order-sync";

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
 */
async function runAllPlatformSyncs(settings: any) {
  isRunning = true;
  console.log('\n🔄 Starting scheduled order sync for all platforms...');
  
  const results = {
    shipstation: { success: false, error: null as any },
    bricklink: { success: false, error: null as any },
    brickowl: { success: false, error: null as any },
  };
  
  try {
    // 1. Sync ShipStation orders (DEPRECATED - using EasyPost for shipping now)
    // ShipStation is no longer used for order syncing
    results.shipstation.success = true; // Mark as success (not used)
    
    // 2. Sync BrickLink orders (if credentials configured)
    if (settings.bricklinkConsumerKey && settings.bricklinkConsumerSecret && 
        settings.bricklinkTokenValue && settings.bricklinkTokenSecret) {
      try {
        console.log('🧱 Syncing BrickLink orders...');
        await syncBrickLinkOrders(
          settings.bricklinkConsumerKey,
          settings.bricklinkConsumerSecret,
          settings.bricklinkTokenValue,
          settings.bricklinkTokenSecret,
          { fullSync: false } // Incremental sync
        );
        results.bricklink.success = true;
        console.log('✅ BrickLink sync complete');
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
        await syncBrickOwlOrders(
          settings.brickowlApiKey,
          { fullSync: false } // Incremental sync
        );
        results.brickowl.success = true;
        console.log('✅ BrickOwl sync complete');
      } catch (error: any) {
        results.brickowl.error = error.message;
        console.error('❌ BrickOwl sync failed:', error.message);
      }
    } else {
      console.log('⏭️ BrickOwl credentials not configured, skipping');
    }
    
    // Summary
    const successCount = Object.values(results).filter(r => r.success).length;
    const totalAttempted = Object.values(results).filter(r => r.success || r.error).length;
    console.log(`\n✨ Order sync complete: ${successCount}/${totalAttempted} platforms successful`);
    
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

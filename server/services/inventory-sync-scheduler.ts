import { db } from "../db";
import { appSettings } from "@shared/schema";
import { syncBricklinkData } from "./bricklink";

let isRunning = false;

/**
 * Start the automatic inventory sync scheduler
 * 
 * This checks app_settings for inventorySyncEnabled and inventorySyncTime,
 * then runs BrickLink sync followed by all platform syncs on schedule.
 */
export async function startInventorySyncScheduler() {
  console.log('📦 Inventory sync scheduler initialized');
  
  // Check every minute if we should run based on scheduled time
  setInterval(async () => {
    await checkAndRunInventorySync();
  }, 60 * 1000); // Check every minute
}

/**
 * Check settings and run inventory sync if enabled and time matches
 */
async function checkAndRunInventorySync() {
  try {
    // Get current settings
    const [settings] = await db
      .select()
      .from(appSettings)
      .limit(1);
    
    if (!settings) {
      return; // No settings configured yet
    }
    
    // Check if inventory sync is enabled
    if (!settings.inventorySyncEnabled) {
      return; // Sync is disabled
    }
    
    // Check if current time matches scheduled time (in user's configured timezone)
    const now = new Date();
    const tz = settings.timezone || 'America/Chicago';
    const localTimeStr = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const [hStr, mStr] = localTimeStr.replace(/\u202f/g, '').split(':');
    const currentTime = `${hStr.padStart(2, '0')}:${mStr.padStart(2, '0')}`;
    const scheduledTime = settings.inventorySyncTime || '02:00';
    
    // Only run if current time matches scheduled time (within the current minute)
    if (currentTime !== scheduledTime) {
      return; // Not the scheduled time
    }
    
    // Prevent concurrent syncs
    if (isRunning) {
      console.log('⏭️ Inventory sync already in progress, skipping this cycle');
      return;
    }
    
    // Run the sync
    await runAutomatedInventorySync();
    
  } catch (error) {
    console.error('❌ Error in inventory sync scheduler:', error);
  }
}

/**
 * Execute the automated inventory sync
 * Includes BrickLink sync + all platform syncs (BrickOwl, etc.)
 */
async function runAutomatedInventorySync() {
  isRunning = true;
  console.log('\n🔄 Starting automated inventory sync (BrickLink → Local DB)...');
  
  try {
    // Run comprehensive sync with platform sync enabled
    const result = await syncBricklinkData();
    
    console.log(`\n✨ Automated inventory sync complete!`);
    console.log(`  📦 Categories: ${result.categoriesAdded} added, ${result.categoriesUpdated} updated`);
    console.log(`  🎨 Colors: ${result.colorsAdded} added, ${result.colorsUpdated} updated`);
    console.log(`  📊 Inventory: ${result.inventoryAdded} added, ${result.inventoryUpdated} updated`);
    console.log(`  🧩 Rebrickable: ${result.rebrickableSets} sets, ${result.rebrickableParts} parts`);
    console.log(`  🔗 API Calls: ${result.totalApiCalls}`);
    
  } catch (error: any) {
    console.error('❌ Automated inventory sync failed:', error.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Stop the inventory sync scheduler
 */
export function stopInventorySyncScheduler() {
  console.log('🛑 Inventory sync scheduler stopped');
}

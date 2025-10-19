/**
 * Sync Lock Manager
 * 
 * Prevents race conditions between inventory and order syncs.
 * Order syncs are paused when inventory sync is running to prevent
 * inventory count conflicts.
 */

class SyncLockManager {
  private inventorySyncRunning = false;
  private orderSyncQueue: Array<() => Promise<void>> = [];
  private processingQueue = false;

  /**
   * Acquire inventory sync lock
   * This will block new order syncs until released
   */
  async acquireInventoryLock(): Promise<boolean> {
    if (this.inventorySyncRunning) {
      console.log('⚠️ Inventory sync already running');
      return false;
    }

    this.inventorySyncRunning = true;
    console.log('🔒 Inventory sync lock acquired');
    return true;
  }

  /**
   * Release inventory sync lock
   * This will trigger processing of any queued order syncs
   */
  releaseInventoryLock(): void {
    this.inventorySyncRunning = false;
    console.log('🔓 Inventory sync lock released');
    
    // Process any queued order syncs
    this.processQueue();
  }

  /**
   * Check if inventory sync is running
   */
  isInventorySyncRunning(): boolean {
    return this.inventorySyncRunning;
  }

  /**
   * Queue an order sync operation (will execute when inventory sync completes)
   */
  async queueOrderSync(syncFn: () => Promise<void>): Promise<void> {
    if (!this.inventorySyncRunning) {
      // No lock, execute immediately
      await syncFn();
      return;
    }

    console.log('⏸️ Order sync queued (waiting for inventory sync to complete)');
    this.orderSyncQueue.push(syncFn);
  }

  /**
   * Process all queued order syncs
   */
  private async processQueue(): Promise<void> {
    if (this.processingQueue || this.orderSyncQueue.length === 0) {
      return;
    }

    this.processingQueue = true;
    console.log(`▶️ Processing ${this.orderSyncQueue.length} queued order sync(s)`);

    while (this.orderSyncQueue.length > 0) {
      const syncFn = this.orderSyncQueue.shift();
      if (syncFn) {
        try {
          await syncFn();
        } catch (error) {
          console.error('❌ Queued order sync failed:', error);
        }
      }
    }

    this.processingQueue = false;
    console.log('✅ Queue processing complete');
  }

  /**
   * Get current lock status
   */
  getStatus() {
    return {
      inventorySyncRunning: this.inventorySyncRunning,
      queuedOrderSyncs: this.orderSyncQueue.length,
      processingQueue: this.processingQueue,
    };
  }
}

// Global singleton instance
export const syncLock = new SyncLockManager();

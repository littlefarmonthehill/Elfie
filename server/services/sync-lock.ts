/**
 * Global Sync Lock Manager
 *
 * A single mutex for all long-running sync jobs:
 *   • Inventory Sync   (BrickLink → Local DB)
 *   • Order Sync       (BrickLink/BrickOwl → Local DB)
 *   • Price-o-Matic    (price cache refresh)
 *   • Channel Sync     (Local DB → BrickOwl)
 *
 * Only one sync may run at a time.  Callers receive a boolean from acquire()
 * and must call release() in a finally block.
 */

class SyncLockManager {
  private activeSyncs = new Set<string>();
  private blockedOnce = new Set<string>();

  /**
   * Try to acquire the global lock for `name`.
   * Returns false (and logs the blocker once) if any other sync is already running.
   */
  acquire(name: string): boolean {
    if (this.activeSyncs.size > 0) {
      const running = [...this.activeSyncs].join(', ');
      const key = `${name}:${running}`;
      if (!this.blockedOnce.has(key)) {
        this.blockedOnce.add(key);
        console.log(`⚠️  ${name} blocked — already running: ${running}`);
      }
      return false;
    }
    this.activeSyncs.add(name);
    console.log(`🔒 ${name} acquired sync lock`);
    return true;
  }

  /** Release the lock held by `name`. */
  release(name: string): void {
    this.activeSyncs.delete(name);
    this.blockedOnce.clear();
    console.log(`🔓 ${name} released sync lock`);
  }

  /** True if any sync is currently running. */
  isRunning(): boolean {
    return this.activeSyncs.size > 0;
  }

  /** Names of all currently-running syncs (0 or 1 in normal operation). */
  getActive(): string[] {
    return [...this.activeSyncs];
  }

  // ── Backward-compat shims used by bricklink.ts ──────────────────────────────
  async acquireInventoryLock(): Promise<boolean> {
    return this.acquire('Inventory Sync');
  }

  releaseInventoryLock(): void {
    this.release('Inventory Sync');
  }

  isInventorySyncRunning(): boolean {
    return this.activeSyncs.has('Inventory Sync');
  }
}

// Global singleton
export const syncLock = new SyncLockManager();

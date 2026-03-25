/**
 * Global Sync Lock Manager
 *
 * A mutex for long-running sync jobs with a compatibility map.
 * Compatible syncs (e.g. Order Sync + Price-o-Matic) are allowed to run
 * concurrently. All other pairs are mutually exclusive.
 *
 *   • Inventory Sync   (BrickLink → Local DB)
 *   • Order Sync       (BrickLink/BrickOwl → Local DB)   ← compatible with POM
 *   • Price-o-Matic    (price cache refresh)              ← compatible with Order Sync
 *   • Channel Sync     (Local DB → BrickOwl)
 *   • CatalogDetail    (BrickLink catalog enrichment)
 */

// Pairs that are allowed to run at the same time
const COMPATIBLE_PAIRS: Array<[string, string]> = [
  ['Order Sync', 'Price-o-Matic'],
];

function buildCompatibilityMap(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [a, b] of COMPATIBLE_PAIRS) {
    if (!map.has(a)) map.set(a, new Set());
    if (!map.has(b)) map.set(b, new Set());
    map.get(a)!.add(b);
    map.get(b)!.add(a);
  }
  return map;
}

const COMPAT = buildCompatibilityMap();

class SyncLockManager {
  private activeSyncs = new Set<string>();
  private blockedOnce = new Set<string>();

  /** Names that would block `name` from starting (excludes compatible peers). */
  getBlockersFor(name: string): string[] {
    const compatible = COMPAT.get(name) ?? new Set<string>();
    return [...this.activeSyncs].filter(s => !compatible.has(s));
  }

  /** True if `name` cannot start right now due to an incompatible sync running. */
  isBlockedFor(name: string): boolean {
    return this.getBlockersFor(name).length > 0;
  }

  /**
   * Try to acquire the lock for `name`.
   * Returns false if an incompatible sync is already running.
   */
  acquire(name: string): boolean {
    const blockers = this.getBlockersFor(name);
    if (blockers.length > 0) {
      const key = `${name}:${blockers.join(',')}`;
      if (!this.blockedOnce.has(key)) {
        this.blockedOnce.add(key);
        console.log(`⚠️  ${name} blocked — already running: ${blockers.join(', ')}`);
      }
      return false;
    }
    this.activeSyncs.add(name);
    const peers = [...this.activeSyncs].filter(s => s !== name);
    if (peers.length > 0) {
      console.log(`🔒 ${name} acquired sync lock (running alongside: ${peers.join(', ')})`);
    } else {
      console.log(`🔒 ${name} acquired sync lock`);
    }
    return true;
  }

  /** Release the lock held by `name`. */
  release(name: string): void {
    this.activeSyncs.delete(name);
    this.blockedOnce.clear();
    console.log(`🔓 ${name} released sync lock`);
  }

  /** True if ANY sync is currently running. */
  isRunning(): boolean {
    return this.activeSyncs.size > 0;
  }

  /** Names of all currently-running syncs. */
  getActive(): string[] {
    return [...this.activeSyncs];
  }

}

// Global singleton
export const syncLock = new SyncLockManager();

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
 *
 * Safety: every lock has a maximum age of MAX_LOCK_AGE_MS. If a scheduler
 * crashes before calling release(), the stale lock is automatically evicted
 * on the next acquire() or isBlockedFor() call, preventing permanent deadlock.
 */

// Locks older than this are considered stale and auto-released.
const MAX_LOCK_AGE_MS = 30 * 60 * 1000; // 30 minutes

// Pairs that are allowed to run at the same time
const COMPATIBLE_PAIRS: Array<[string, string]> = [
  ['Order Sync',   'Price-o-Matic'],
  // Channel Sync drives Inventory Sync internally (Step 0: BrickLink → local DB).
  // Declaring them compatible lets syncBricklinkData acquire its own lock while
  // Channel Sync already holds its lock, so Step 0 actually runs instead of
  // silently falling through to stale local DB data.
  ['Channel Sync', 'Inventory Sync'],
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
  private lockStarted = new Map<string, number>(); // name → Date.now() when acquired
  private blockedOnce = new Set<string>();

  /** Evict any locks that have been held longer than MAX_LOCK_AGE_MS. */
  private evictStaleLocks(): void {
    const now = Date.now();
    for (const [name, startedAt] of this.lockStarted) {
      if (now - startedAt > MAX_LOCK_AGE_MS) {
        const ageMin = Math.round((now - startedAt) / 60000);
        console.warn(`[SyncLock] Auto-releasing stale lock "${name}" (held ${ageMin}m — probable crash without release)`);
        this.activeSyncs.delete(name);
        this.lockStarted.delete(name);
        this.blockedOnce.clear();
      }
    }
  }

  /** Names that would block `name` from starting (excludes compatible peers). */
  getBlockersFor(name: string): string[] {
    this.evictStaleLocks();
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
    const blockers = this.getBlockersFor(name); // evicts stale locks first
    if (blockers.length > 0) {
      const key = `${name}:${blockers.join(',')}`;
      if (!this.blockedOnce.has(key)) {
        this.blockedOnce.add(key);
        console.log(`⚠️  ${name} blocked — already running: ${blockers.join(', ')}`);
      }
      return false;
    }
    this.activeSyncs.add(name);
    this.lockStarted.set(name, Date.now());
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
    this.lockStarted.delete(name);
    this.blockedOnce.clear();
    console.log(`🔓 ${name} released sync lock`);
  }

  /** True if ANY sync is currently running. */
  isRunning(): boolean {
    this.evictStaleLocks();
    return this.activeSyncs.size > 0;
  }

  /** Names of all currently-running syncs. */
  getActive(): string[] {
    this.evictStaleLocks();
    return [...this.activeSyncs];
  }
}

// Global singleton
export const syncLock = new SyncLockManager();

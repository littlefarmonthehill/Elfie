/**
 * In-memory sync progress tracker
 * Stores real-time progress updates during BrickLink sync operations
 */

type SyncProgress = {
  status: 'idle' | 'syncing' | 'complete' | 'error';
  currentStep: string;
  progress: number; // 0-100
  details: {
    itemsDownloaded?: number;
    itemsAdded?: number;
    itemsUpdated?: number;
    itemsChecked?: number;
    totalItems?: number;
  };
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
};

class SyncProgressTracker {
  private progress: SyncProgress = {
    status: 'idle',
    currentStep: 'Ready',
    progress: 0,
    details: {},
  };

  /**
   * Start a new sync operation
   */
  start() {
    this.progress = {
      status: 'syncing',
      currentStep: 'Initializing...',
      progress: 0,
      details: {},
      startedAt: new Date(),
    };
  }

  /**
   * Update sync progress
   */
  update(step: string, progress: number, details?: Partial<SyncProgress['details']>) {
    this.progress.currentStep = step;
    this.progress.progress = Math.min(100, Math.max(0, progress));
    if (details) {
      this.progress.details = { ...this.progress.details, ...details };
    }
  }

  /**
   * Mark sync as complete
   */
  complete(itemsAdded: number, itemsUpdated: number) {
    this.progress = {
      ...this.progress,
      status: 'complete',
      currentStep: 'Sync complete',
      progress: 100,
      completedAt: new Date(),
      details: {
        ...this.progress.details,
        itemsAdded,
        itemsUpdated,
      },
    };

    // Reset to idle after 10 seconds
    setTimeout(() => {
      if (this.progress.status === 'complete') {
        this.progress = {
          status: 'idle',
          currentStep: 'Ready',
          progress: 0,
          details: {},
        };
      }
    }, 10000);
  }

  /**
   * Mark sync as failed
   */
  error(message: string) {
    this.progress = {
      ...this.progress,
      status: 'error',
      currentStep: 'Sync failed',
      error: message,
      completedAt: new Date(),
    };

    // Reset to idle after 10 seconds
    setTimeout(() => {
      if (this.progress.status === 'error') {
        this.progress = {
          status: 'idle',
          currentStep: 'Ready',
          progress: 0,
          details: {},
        };
      }
    }, 10000);
  }

  /**
   * Get current progress
   */
  get(): SyncProgress {
    return { ...this.progress };
  }

  /**
   * Check if sync is currently running
   */
  isRunning(): boolean {
    return this.progress.status === 'syncing';
  }
}

// Export singleton instance
export const syncProgressTracker = new SyncProgressTracker();

import { Injectable, Logger } from '@nestjs/common';
import { TelescopeEntry } from '../interfaces/telescope-entry.interface';

export interface BufferConfig {
  enabled: boolean;
  maxBufferSize: number;
  flushInterval: number;
  maxBatchSize: number;
  priorityFlushThreshold: number;
  retryAttempts: number;
  retryDelay: number;
}

export interface BufferStats {
  currentBufferSize: number;
  totalEntries: number;
  totalFlushes: number;
  totalFailures: number;
  lastFlushTime: number;
  averageFlushSize: number;
  bufferUtilization: number;
}

interface BufferedEntry {
  entry: TelescopeEntry;
  timestamp: number;
  priority: number;
  retryCount: number;
}

@Injectable()
export class BufferedEntryManagerService {
  private readonly logger = new Logger(BufferedEntryManagerService.name);

  private readonly buffer: BufferedEntry[] = [];
  private readonly config: BufferConfig;
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushInProgress = false;
  private readonly stats: BufferStats;

  constructor(
    config: Partial<BufferConfig> = {},
    private readonly flushHandler: (entries: TelescopeEntry[]) => Promise<void>,
  ) {
    this.config = {
      enabled: true,
      maxBufferSize: 1000,
      flushInterval: 5000, // 5 seconds
      maxBatchSize: 100,
      priorityFlushThreshold: 50,
      retryAttempts: 3,
      retryDelay: 1000,
      ...config,
    };

    this.stats = {
      currentBufferSize: 0,
      totalEntries: 0,
      totalFlushes: 0,
      totalFailures: 0,
      lastFlushTime: 0,
      averageFlushSize: 0,
      bufferUtilization: 0,
    };

    if (this.config.enabled) {
      this.startFlushTimer();
    }

    this.logger.debug('Buffered Entry Manager initialized', this.config);
  }

  /**
   * Add entry to buffer with priority support
   */
  async addEntry(entry: TelescopeEntry, priority: number = 1): Promise<void> {
    if (!this.config.enabled) {
      // If buffering is disabled, flush immediately
      try {
        await this.flushHandler([entry]);
      } catch (error) {
        this.logger.error('Failed to flush entry immediately:', error);
        throw error;
      }
      return;
    }

    try {
      const bufferedEntry: BufferedEntry = {
        entry,
        timestamp: Date.now(),
        priority,
        retryCount: 0,
      };

      this.buffer.push(bufferedEntry);
      this.stats.totalEntries++;
      this.stats.currentBufferSize = this.buffer.length;
      this.updateBufferUtilization();

      // Check if we need immediate flush
      if (this.shouldFlushImmediately()) {
        await this.flushBuffer();
      }
    } catch (error) {
      this.logger.error('Failed to add entry to buffer:', error);
      throw error;
    }
  }

  /**
   * Add multiple entries as a batch
   */
  async addBatch(entries: TelescopeEntry[], priority: number = 1): Promise<void> {
    if (!this.config.enabled) {
      try {
        await this.flushHandler(entries);
      } catch (error) {
        this.logger.error('Failed to flush batch immediately:', error);
        throw error;
      }
      return;
    }

    try {
      const timestamp = Date.now();
      const bufferedEntries: BufferedEntry[] = entries.map((entry) => ({
        entry,
        timestamp,
        priority,
        retryCount: 0,
      }));

      this.buffer.push(...bufferedEntries);
      this.stats.totalEntries += entries.length;
      this.stats.currentBufferSize = this.buffer.length;
      this.updateBufferUtilization();

      // Check if we need immediate flush
      if (this.shouldFlushImmediately()) {
        await this.flushBuffer();
      }
    } catch (error) {
      this.logger.error('Failed to add batch to buffer:', error);
      throw error;
    }
  }

  /**
   * Force flush buffer immediately
   */
  async flush(): Promise<void> {
    await this.flushBuffer();
  }

  /**
   * Get buffer statistics
   */
  getStats(): BufferStats {
    return { ...this.stats };
  }

  /**
   * Get current buffer size
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Check if buffer is healthy
   */
  isHealthy(): boolean {
    return this.stats.bufferUtilization < 0.9 && !this.isFlushInProgress;
  }

  /**
   * Clear buffer (emergency use only)
   */
  clearBuffer(): void {
    const clearedCount = this.buffer.length;
    this.buffer.splice(0);
    this.stats.currentBufferSize = 0;
    this.updateBufferUtilization();

    this.logger.warn(`Buffer cleared: ${clearedCount} entries removed`);
  }

  onDestroy(): void {
    this.shutdown();
  }

  /**
   * Shutdown buffer manager
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining entries
    if (this.buffer.length > 0) {
      this.logger.debug(`Flushing ${this.buffer.length} remaining entries on shutdown`);
      await this.flushBuffer();
    }

    this.logger.debug('Buffered Entry Manager shutdown complete');
  }

  private shouldFlushImmediately(): boolean {
    // Check buffer size limits
    if (this.buffer.length >= this.config.maxBufferSize) {
      return true;
    }

    // Check priority threshold
    const highPriorityCount = this.buffer.filter((entry) => entry.priority >= 5).length;
    if (highPriorityCount >= this.config.priorityFlushThreshold) {
      return true;
    }

    // Check for critical entries (priority >= 8)
    const hasCriticalEntries = this.buffer.some((entry) => entry.priority >= 8);
    if (hasCriticalEntries) {
      return true;
    }

    return false;
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(async () => {
      if (this.buffer.length > 0 && !this.isFlushInProgress) {
        await this.flushBuffer();
      }
    }, this.config.flushInterval);
  }

  private async flushBuffer(): Promise<void> {
    if (this.isFlushInProgress || this.buffer.length === 0) {
      return;
    }

    this.isFlushInProgress = true;
    const startTime = Date.now();

    try {
      // Sort by priority (highest first) and timestamp (oldest first)
      this.buffer.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.timestamp - b.timestamp;
      });

      // Process in batches
      while (this.buffer.length > 0) {
        const batchSize = Math.min(this.config.maxBatchSize, this.buffer.length);
        const batch = this.buffer.splice(0, batchSize);

        await this.processBatch(batch);
      }

      // Update stats
      this.stats.totalFlushes++;
      this.stats.lastFlushTime = Date.now();
      this.stats.currentBufferSize = this.buffer.length;
      this.updateBufferUtilization();
      this.updateAverageFlushSize();

      const duration = Date.now() - startTime;
      this.logger.debug(`Buffer flushed successfully in ${duration}ms`);
    } catch (error) {
      this.logger.error('Buffer flush failed:', error);
      this.stats.totalFailures++;

      // Re-add failed entries to buffer for retry
      // Note: In a real implementation, you might want more sophisticated retry logic
    } finally {
      this.isFlushInProgress = false;
    }
  }

  private async processBatch(batch: BufferedEntry[]): Promise<void> {
    const entries = batch.map((bufferedEntry) => bufferedEntry.entry);

    try {
      await this.flushHandler(entries);
    } catch (error) {
      // Handle failed entries with retry logic
      await this.handleFailedBatch(batch, error);
    }
  }

  private async handleFailedBatch(batch: BufferedEntry[], error: Error): Promise<void> {
    this.logger.warn(`Batch flush failed, attempting retry:`, error.message);

    const retryableBatch: BufferedEntry[] = [];

    for (const bufferedEntry of batch) {
      if (bufferedEntry.retryCount < this.config.retryAttempts) {
        bufferedEntry.retryCount++;
        retryableBatch.push(bufferedEntry);
      } else {
        this.logger.error(`Entry failed after ${this.config.retryAttempts} attempts, dropping:`, {
          entryId: bufferedEntry.entry.id,
          type: bufferedEntry.entry.type,
        });
      }
    }

    if (retryableBatch.length > 0) {
      // Wait before retry
      await this.sleep(this.config.retryDelay * retryableBatch[0].retryCount);

      // Add back to buffer for retry
      this.buffer.unshift(...retryableBatch);
    }
  }

  private updateBufferUtilization(): void {
    this.stats.bufferUtilization = this.buffer.length / this.config.maxBufferSize;
  }

  private updateAverageFlushSize(): void {
    if (this.stats.totalFlushes > 0) {
      this.stats.averageFlushSize = this.stats.totalEntries / this.stats.totalFlushes;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

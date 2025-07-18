import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { TelescopeEntry } from '../interfaces/telescope-entry.interface';
import { TelescopeConfig } from '../interfaces/telescope-config.interface';
import { StorageManagerService } from '../../storage/storage-manager.service';
import { v4 as uuid } from 'uuid';

@Injectable()
export class EnhancedEntryManagerService implements OnModuleInit {
  private readonly logger = new Logger(EnhancedEntryManagerService.name);
  private readonly batchQueues = new Map<string, TelescopeEntry[]>();
  private readonly retryQueue: TelescopeEntry[] = [];
  private readonly metrics = new ProcessingMetrics();
  private sequenceCounter = 0;
  private processingIntervals = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly storageManager: StorageManagerService,
    @Inject('TELESCOPE_CONFIG') private readonly config: TelescopeConfig
  ) {}

  async onModuleInit(): Promise<void> {
    this.startBatchProcessors();
    this.startRetryProcessor();
    this.startMetricsReporting();
  }

  async process(entry: TelescopeEntry): Promise<void> {
    // Ensure entry has required fields
    this.ensureEntryFields(entry);
    
    try {
      // Route to appropriate processing method
      const queueKey = this.getQueueKey(entry);
      
      if (this.shouldBatch(entry)) {
        await this.addToQueue(queueKey, entry);
      } else {
        await this.processImmediate(entry);
      }
      
      this.metrics.recordEntry(entry);
    } catch (error) {
      this.logger.error(`Failed to process entry ${entry.id}:`, error);
      this.metrics.recordError();
    }
  }

  async processBatch(entries: TelescopeEntry[]): Promise<void> {
    // Ensure all entries have required fields
    entries.forEach(entry => this.ensureEntryFields(entry));
    
    try {
      // Group entries by queue for more efficient processing
      const queueGroups = this.groupEntriesByQueue(entries);
      
      for (const [queueKey, queueEntries] of queueGroups) {
        if (this.shouldBatch(queueEntries[0])) {
          await this.addToQueue(queueKey, ...queueEntries);
        } else {
          // Process immediate entries in parallel
          await Promise.all(queueEntries.map(entry => this.processImmediate(entry)));
        }
      }
      
      entries.forEach(entry => this.metrics.recordEntry(entry));
    } catch (error) {
      this.logger.error('Failed to process batch:', error);
      this.metrics.recordError();
    }
  }

  private getQueueKey(entry: TelescopeEntry): string {
    // Critical entries get their own queue
    if (entry.tags.includes('critical')) return 'critical';
    
    // Error entries get priority queue
    if (entry.tags.includes('error') || entry.tags.includes('exception')) return 'error';
    
    // Performance entries get their own queue
    if (entry.tags.includes('performance')) return 'performance';
    
    // DevTools entries get their own queue
    if (entry.type.startsWith('devtools')) return 'devtools';
    
    // Route by entry type
    switch (entry.type) {
      case 'request':
        return 'request';
      case 'query':
        return 'query';
      case 'job':
        return 'job';
      case 'cache':
        return 'cache';
      default:
        return 'default';
    }
  }

  private shouldBatch(entry: TelescopeEntry): boolean {
    // Critical entries bypass batching for immediate processing
    if (entry.tags.includes('critical')) return false;
    
    // Error entries bypass batching for immediate processing
    if (entry.tags.includes('error') || entry.tags.includes('exception')) return false;
    
    // Large entries bypass batching to avoid memory issues
    const entrySize = JSON.stringify(entry).length;
    if (entrySize > 100000) { // 100KB
      this.logger.warn(`Large entry ${entry.id} (${entrySize} bytes) bypassing batch`);
      return false;
    }
    
    // Real-time entries bypass batching
    if (entry.tags.includes('realtime')) return false;
    
    return this.config.storage.batch.enabled;
  }

  private async addToQueue(queueKey: string, ...entries: TelescopeEntry[]): Promise<void> {
    if (!this.batchQueues.has(queueKey)) {
      this.batchQueues.set(queueKey, []);
    }
    
    const queue = this.batchQueues.get(queueKey)!;
    queue.push(...entries);
    
    // Check if queue should be flushed
    const queueConfig = this.getQueueConfig(queueKey);
    if (queue.length >= queueConfig.batchSize) {
      await this.flushQueue(queueKey);
    }
  }

  private async flushQueue(queueKey: string): Promise<void> {
    const queue = this.batchQueues.get(queueKey);
    if (!queue || queue.length === 0) return;

    const entries = queue.splice(0);
    
    try {
      await this.storageManager.storeBatch(entries);
      this.metrics.recordBatch(entries.length, true);
      this.logger.debug(`Flushed queue '${queueKey}' with ${entries.length} entries`);
    } catch (error) {
      this.logger.error(`Failed to flush queue '${queueKey}':`, error);
      
      // Add to retry queue based on priority
      if (queueKey === 'critical' || queueKey === 'error') {
        this.retryQueue.unshift(...entries); // Add to front for priority
      } else {
        this.retryQueue.push(...entries);
      }
      
      this.metrics.recordBatch(entries.length, false);
    }
  }

  private async processImmediate(entry: TelescopeEntry): Promise<void> {
    try {
      await this.storageManager.store(entry);
      this.metrics.recordImmediate(true);
      this.logger.debug(`Processed immediate entry: ${entry.id}`);
    } catch (error) {
      this.logger.error(`Failed to process immediate entry ${entry.id}:`, error);
      
      // Add to retry queue
      this.retryQueue.push(entry);
      this.metrics.recordImmediate(false);
    }
  }

  private async processRetryQueue(): Promise<void> {
    if (this.retryQueue.length === 0) return;

    const maxRetries = 10;
    const entries = this.retryQueue.splice(0, maxRetries);
    
    for (const entry of entries) {
      try {
        await this.storageManager.store(entry);
        this.metrics.recordRetry(true);
        this.logger.debug(`Retry successful for entry: ${entry.id}`);
      } catch (error) {
        // Add back to retry queue with exponential backoff
        this.retryQueue.push(entry);
        this.metrics.recordRetry(false);
        this.logger.warn(`Retry failed for entry ${entry.id}:`, error);
      }
    }
  }

  private startBatchProcessors(): void {
    if (!this.config.storage.batch.enabled) return;

    // Start processors for each queue type
    const queueTypes = ['default', 'devtools', 'request', 'query', 'job', 'cache', 'performance'];
    
    for (const queueKey of queueTypes) {
      const queueConfig = this.getQueueConfig(queueKey);
      
      const interval = setInterval(async () => {
        const queue = this.batchQueues.get(queueKey);
        if (queue && queue.length > 0) {
          await this.flushQueue(queueKey);
        }
      }, queueConfig.flushInterval);
      
      this.processingIntervals.set(queueKey, interval);
    }
  }

  private startRetryProcessor(): void {
    // Process retry queue every 30 seconds
    setInterval(async () => {
      await this.processRetryQueue();
    }, 30000);
  }

  private startMetricsReporting(): void {
    // Report metrics every 5 minutes
    setInterval(() => {
      this.reportMetrics();
    }, 300000);
  }

  private reportMetrics(): void {
    const metrics = this.metrics.getMetrics();
    this.logger.log(`Processing metrics: ${JSON.stringify(metrics)}`);
    
    // Reset metrics for next period
    this.metrics.reset();
  }

  private ensureEntryFields(entry: TelescopeEntry): void {
    if (!entry.id) {
      entry.id = `tel_${uuid()}`;
    }
    
    if (!entry.timestamp) {
      entry.timestamp = new Date();
    }
    
    if (!entry.sequence) {
      entry.sequence = ++this.sequenceCounter;
    }
    
    if (!entry.familyHash) {
      entry.familyHash = this.generateFamilyHash(entry);
    }
    
    if (!entry.tags) {
      entry.tags = [];
    }
  }

  private generateFamilyHash(entry: TelescopeEntry): string {
    // Generate hash based on entry type and key content
    const hashInput = `${entry.type}:${JSON.stringify(entry.content).substring(0, 100)}`;
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      const char = hashInput.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private getQueueConfig(queueKey: string): QueueConfig {
    const baseConfig = {
      batchSize: this.config.storage.batch.size,
      flushInterval: this.config.storage.batch.flushInterval
    };

    // Override for specific queue types
    switch (queueKey) {
      case 'critical':
        return { batchSize: 1, flushInterval: 100 }; // Process immediately
      case 'error':
        return { batchSize: 5, flushInterval: 1000 }; // Fast processing
      case 'performance':
        return { batchSize: baseConfig.batchSize * 2, flushInterval: baseConfig.flushInterval * 2 }; // Larger batches
      case 'devtools':
        return { batchSize: baseConfig.batchSize, flushInterval: baseConfig.flushInterval * 3 }; // Less frequent
      default:
        return baseConfig;
    }
  }

  private groupEntriesByQueue(entries: TelescopeEntry[]): Map<string, TelescopeEntry[]> {
    const groups = new Map<string, TelescopeEntry[]>();
    
    for (const entry of entries) {
      const queueKey = this.getQueueKey(entry);
      
      if (!groups.has(queueKey)) {
        groups.set(queueKey, []);
      }
      
      groups.get(queueKey)!.push(entry);
    }
    
    return groups;
  }

  // Public methods for monitoring
  getMetrics(): ProcessingMetrics {
    return this.metrics;
  }

  getQueueStatus(): Record<string, QueueStatus> {
    const status: Record<string, QueueStatus> = {};
    
    for (const [queueKey, queue] of this.batchQueues) {
      status[queueKey] = {
        name: queueKey,
        size: queue.length,
        config: this.getQueueConfig(queueKey)
      };
    }
    
    status['retry'] = {
      name: 'retry',
      size: this.retryQueue.length,
      config: { batchSize: 10, flushInterval: 30000 }
    };
    
    return status;
  }

  async forceFlushAll(): Promise<void> {
    const flushPromises = Array.from(this.batchQueues.keys()).map(queueKey => 
      this.flushQueue(queueKey)
    );
    
    await Promise.all(flushPromises);
    this.logger.log('All queues flushed');
  }

  // Cleanup method
  async cleanup(): Promise<void> {
    // Clear all intervals
    for (const [queueKey, interval] of this.processingIntervals) {
      clearInterval(interval);
    }
    
    // Flush all remaining entries
    await this.forceFlushAll();
    
    // Process retry queue one last time
    await this.processRetryQueue();
    
    this.logger.log('Enhanced entry manager cleaned up');
  }
}

class ProcessingMetrics {
  private entriesProcessed = 0;
  private batchesProcessed = 0;
  private batchesSuccessful = 0;
  private immediateProcessed = 0;
  private immediateSuccessful = 0;
  private retriesAttempted = 0;
  private retriesSuccessful = 0;
  private errors = 0;
  private startTime = Date.now();

  recordEntry(entry: TelescopeEntry): void {
    this.entriesProcessed++;
  }

  recordBatch(size: number, success: boolean): void {
    this.batchesProcessed++;
    if (success) {
      this.batchesSuccessful++;
    } else {
      this.errors += size;
    }
  }

  recordImmediate(success: boolean): void {
    this.immediateProcessed++;
    if (success) {
      this.immediateSuccessful++;
    } else {
      this.errors++;
    }
  }

  recordRetry(success: boolean): void {
    this.retriesAttempted++;
    if (success) {
      this.retriesSuccessful++;
    }
  }

  recordError(): void {
    this.errors++;
  }

  getMetrics(): MetricsSnapshot {
    const elapsed = Date.now() - this.startTime;
    const throughput = this.entriesProcessed / (elapsed / 1000); // entries per second
    
    return {
      entriesProcessed: this.entriesProcessed,
      batchesProcessed: this.batchesProcessed,
      batchSuccessRate: this.batchesProcessed > 0 ? this.batchesSuccessful / this.batchesProcessed : 0,
      immediateProcessed: this.immediateProcessed,
      immediateSuccessRate: this.immediateProcessed > 0 ? this.immediateSuccessful / this.immediateProcessed : 0,
      retriesAttempted: this.retriesAttempted,
      retrySuccessRate: this.retriesAttempted > 0 ? this.retriesSuccessful / this.retriesAttempted : 0,
      errors: this.errors,
      throughput: throughput,
      elapsedSeconds: elapsed / 1000
    };
  }

  reset(): void {
    this.entriesProcessed = 0;
    this.batchesProcessed = 0;
    this.batchesSuccessful = 0;
    this.immediateProcessed = 0;
    this.immediateSuccessful = 0;
    this.retriesAttempted = 0;
    this.retriesSuccessful = 0;
    this.errors = 0;
    this.startTime = Date.now();
  }
}

interface QueueConfig {
  batchSize: number;
  flushInterval: number;
}

interface QueueStatus {
  name: string;
  size: number;
  config: QueueConfig;
}

interface MetricsSnapshot {
  entriesProcessed: number;
  batchesProcessed: number;
  batchSuccessRate: number;
  immediateProcessed: number;
  immediateSuccessRate: number;
  retriesAttempted: number;
  retrySuccessRate: number;
  errors: number;
  throughput: number;
  elapsedSeconds: number;
}
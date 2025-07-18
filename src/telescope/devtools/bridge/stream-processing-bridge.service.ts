import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Subject, timer, Subscription } from 'rxjs';
import { 
  bufferTime, 
  filter, 
  mergeMap, 
  retry, 
  tap, 
  throttleTime,
  catchError,
  finalize 
} from 'rxjs/operators';
import { of } from 'rxjs';

import { DevToolsBridgeService } from './devtools-bridge.service';
import { TelescopeService } from '../../core/services/telescope.service';
import { EnhancedEntryManagerService } from '../../core/services/enhanced-entry-manager.service';
import { MetricsService, BatchResult } from '../../core/services/metrics.service';
import { TelescopeEntry } from '../../core/interfaces/telescope-entry.interface';
import { TelescopeConfig } from '../../core/interfaces/telescope-config.interface';

export interface ProcessingError {
  message: string;
  stack?: string;
  entry?: TelescopeEntry;
  timestamp: Date;
  retryCount: number;
}

export interface StreamConfiguration {
  bufferTimeMs: number;
  maxBufferSize: number;
  maxConcurrentBatches: number;
  retryDelayMs: number;
  maxRetries: number;
  errorThrottleMs: number;
}

@Injectable()
export class StreamProcessingBridgeService extends DevToolsBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamProcessingBridgeService.name);
  private readonly entryStream = new Subject<TelescopeEntry>();
  private readonly errorStream = new Subject<ProcessingError>();
  private subscriptions: Subscription[] = [];
  private isProcessing = false;
  
  private readonly streamConfig: StreamConfiguration = {
    bufferTimeMs: 1000,
    maxBufferSize: 100,
    maxConcurrentBatches: 3,
    retryDelayMs: 1000,
    maxRetries: 3,
    errorThrottleMs: 5000
  };

  constructor(
    telescopeService: TelescopeService,
    entryManager: EnhancedEntryManagerService,
    private readonly metricsService: MetricsService,
    @Inject('TELESCOPE_CONFIG') config: TelescopeConfig
  ) {
    super(telescopeService, entryManager, config);
    this.updateStreamConfig(config);
  }

  async onModuleInit(): Promise<void> {
    this.setupStreams();
    this.isProcessing = true;
    this.logger.log('Stream processing bridge initialized');
  }

  async onModuleDestroy(): Promise<void> {
    this.isProcessing = false;
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.entryStream.complete();
    this.errorStream.complete();
    this.logger.log('Stream processing bridge destroyed');
  }

  private updateStreamConfig(config: TelescopeConfig): void {
    if (config.storage?.batch) {
      this.streamConfig.bufferTimeMs = config.storage.batch.flushInterval || 1000;
      this.streamConfig.maxBufferSize = config.storage.batch.size || 100;
    }
    
    // Update other stream config based on overall config
    if (config.features?.realTimeUpdates === false) {
      this.streamConfig.bufferTimeMs = Math.max(this.streamConfig.bufferTimeMs, 5000);
    }
  }

  private setupStreams(): void {
    // Main entry processing stream
    const entrySubscription = this.entryStream
      .pipe(
        bufferTime(this.streamConfig.bufferTimeMs, null, this.streamConfig.maxBufferSize),
        filter(entries => entries.length > 0),
        tap(entries => this.logger.debug(`Processing batch of ${entries.length} entries`)),
        mergeMap(entries => this.processBatchSafely(entries), this.streamConfig.maxConcurrentBatches),
        retry({
          count: this.streamConfig.maxRetries,
          delay: (error, retryCount) => {
            this.logger.warn(`Batch processing failed, retry ${retryCount}:`, error.message);
            return timer(this.streamConfig.retryDelayMs * Math.pow(2, retryCount - 1));
          }
        }),
        catchError(error => {
          this.logger.error('Stream processing failed after retries:', error);
          this.errorStream.next({
            message: `Stream processing failed: ${error.message}`,
            stack: error.stack,
            timestamp: new Date(),
            retryCount: this.streamConfig.maxRetries
          });
          return of(null); // Continue stream
        }),
        finalize(() => this.logger.debug('Entry stream finalized'))
      )
      .subscribe({
        next: (result) => {
          if (result) {
            this.handleBatchResults(result);
          }
        },
        error: (error) => {
          this.logger.error('Unhandled stream error:', error);
          this.errorStream.next({
            message: `Unhandled stream error: ${error.message}`,
            stack: error.stack,
            timestamp: new Date(),
            retryCount: 0
          });
        }
      });

    // Error handling stream
    const errorSubscription = this.errorStream
      .pipe(
        throttleTime(this.streamConfig.errorThrottleMs),
        tap(error => {
          this.logger.error('Stream processing error:', {
            message: error.message,
            timestamp: error.timestamp,
            retryCount: error.retryCount
          });
        })
      )
      .subscribe();

    this.subscriptions.push(entrySubscription, errorSubscription);
  }

  private async processBatchSafely(entries: TelescopeEntry[]): Promise<BatchResult> {
    const startTime = Date.now();
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      this.logger.debug(`Starting batch processing: ${batchId}`);
      
      // Add batch ID to all entries
      const entriesWithBatch = entries.map(entry => ({
        ...entry,
        batchId
      }));
      
      // Process through the enhanced entry manager
      await this.entryManager.processBatch(entriesWithBatch);
      
      const result: BatchResult = {
        processed: entries.length,
        failed: 0,
        duration: Date.now() - startTime,
        success: true,
        timestamp: new Date()
      };
      
      this.logger.debug(`Batch processed successfully: ${batchId} (${result.duration}ms)`);
      return result;
      
    } catch (error) {
      const result: BatchResult = {
        processed: 0,
        failed: entries.length,
        duration: Date.now() - startTime,
        success: false,
        error: error.message,
        timestamp: new Date()
      };
      
      this.logger.error(`Batch processing failed: ${batchId}`, error);
      
      // Try to process entries individually as fallback
      const individualResults = await this.fallbackToIndividualProcessing(entries);
      result.processed = individualResults.processed;
      result.failed = individualResults.failed;
      
      if (result.processed > 0) {
        result.success = true;
        this.logger.warn(`Batch partially recovered: ${result.processed}/${entries.length} entries processed`);
      }
      
      return result;
    }
  }

  private async fallbackToIndividualProcessing(entries: TelescopeEntry[]): Promise<{processed: number, failed: number}> {
    let processed = 0;
    let failed = 0;
    
    for (const entry of entries) {
      try {
        await this.entryManager.process(entry);
        processed++;
      } catch (error) {
        failed++;
        this.logger.debug(`Individual entry processing failed: ${entry.id}`, error.message);
      }
    }
    
    return { processed, failed };
  }

  private handleBatchResults(result: BatchResult): void {
    this.metricsService.recordBatchProcessing(result);
    
    if (result.success) {
      this.logger.debug(`Batch processed: ${result.processed} entries in ${result.duration}ms`);
    } else {
      this.logger.warn(`Batch failed: ${result.failed} entries failed, ${result.processed} recovered`);
    }
  }

  // Override the parent method to use stream processing
  async processDevToolsEntry(entry: any, type: string): Promise<void> {
    if (!this.isProcessing) {
      this.logger.warn('Stream processing is not active, dropping entry');
      return;
    }
    
    try {
      const telescopeEntry = this.transformToTelescopeFormat(entry, type);
      
      // Add to stream for processing
      this.entryStream.next(telescopeEntry);
      
    } catch (error) {
      this.logger.error('Failed to transform DevTools entry:', error);
      this.errorStream.next({
        message: `Transformation failed: ${error.message}`,
        stack: error.stack,
        timestamp: new Date(),
        retryCount: 0
      });
    }
  }

  // Enhanced transformation with better error handling
  protected transformToTelescopeFormat(entry: any, type: string): TelescopeEntry {
    try {
      const baseEntry = super.transformToTelescopeFormat(entry, type);
      
      // Add stream-specific enhancements
      return {
        ...baseEntry,
        tags: [
          ...baseEntry.tags,
          'stream-processed',
          `stream-${this.streamConfig.bufferTimeMs}ms`
        ],
        content: {
          ...baseEntry.content,
          streamMetadata: {
            processedAt: new Date().toISOString(),
            streamConfig: this.streamConfig
          }
        }
      };
    } catch (error) {
      this.logger.error('Transformation failed:', error);
      throw new Error(`Failed to transform entry: ${error.message}`);
    }
  }

  // Public API for monitoring
  getStreamMetrics(): {
    entriesInQueue: number;
    errorCount: number;
    averageProcessingTime: number;
    throughput: number;
    isProcessing: boolean;
    subscriptions: number;
  } {
    const baseMetrics = this.metricsService.getStreamMetrics();
    
    return {
      ...baseMetrics,
      entriesInQueue: (this.entryStream as any).observers?.length || 0,
      isProcessing: this.isProcessing,
      subscriptions: this.subscriptions.length
    };
  }

  getStreamConfiguration(): StreamConfiguration {
    return { ...this.streamConfig };
  }

  // Update stream configuration at runtime
  updateStreamConfiguration(config: Partial<StreamConfiguration>): void {
    Object.assign(this.streamConfig, config);
    this.logger.log('Stream configuration updated:', config);
  }

  // Force flush current buffer
  async flushBuffer(): Promise<void> {
    this.logger.log('Forcing stream buffer flush');
    // This is a simplified implementation - in practice, you'd need to trigger the buffer
    // by emitting a special signal or using a different approach
    return Promise.resolve();
  }

  // Get health status
  getHealthStatus(): {
    isHealthy: boolean;
    issues: string[];
    lastProcessedAt?: Date;
  } {
    const issues: string[] = [];
    const metrics = this.getStreamMetrics();
    
    if (!this.isProcessing) {
      issues.push('Stream processing is not active');
    }
    
    if (metrics.errorCount > 10) {
      issues.push(`High error count: ${metrics.errorCount}`);
    }
    
    if (metrics.averageProcessingTime > 5000) {
      issues.push(`High average processing time: ${metrics.averageProcessingTime}ms`);
    }
    
    if (metrics.throughput < 1) {
      issues.push(`Low throughput: ${metrics.throughput} entries/second`);
    }
    
    return {
      isHealthy: issues.length === 0,
      issues,
      lastProcessedAt: metrics.lastProcessedAt
    };
  }
}
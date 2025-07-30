import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import {
  TelescopeEntry,
  TelescopeEntryFilter,
  TelescopeEntryResult,
} from '../interfaces/telescope-entry.interface';
import { TelescopeConfig } from '../interfaces/telescope-config.interface';
import { EntryManagerService } from './entry-manager.service';
import { StorageService } from '../../storage/storage.service';
import { CircuitBreakerService, CircuitBreakerResult } from './circuit-breaker.service';

@Injectable()
export class TelescopeService implements OnModuleInit {
  private readonly logger = new Logger(TelescopeService.name);
  private readonly circuitBreakers = {
    entryProcessing: 'telescope-entry-processing',
    batchProcessing: 'telescope-batch-processing',
    storage: 'telescope-storage',
    queries: 'telescope-queries',
  };

  constructor(
    private readonly entryManager: EntryManagerService,
    private readonly storageService: StorageService,
    private readonly circuitBreakerService: CircuitBreakerService,
    @Inject('TELESCOPE_CONFIG') private readonly config: TelescopeConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    this.initializeCircuitBreakers();
  }

  private initializeCircuitBreakers(): void {
    // Initialize circuit breakers with different configurations based on operation type
    this.circuitBreakerService.createCircuit(this.circuitBreakers.entryProcessing, {
      failureThreshold: 5,
      timeoutThreshold: 3000,
      resetTimeout: 30000,
      halfOpenMaxCalls: 2,
      successThreshold: 3,
    });

    this.circuitBreakerService.createCircuit(this.circuitBreakers.batchProcessing, {
      failureThreshold: 3,
      timeoutThreshold: 10000, // Longer timeout for batch operations
      resetTimeout: 60000,
      halfOpenMaxCalls: 1,
      successThreshold: 2,
    });

    this.circuitBreakerService.createCircuit(this.circuitBreakers.storage, {
      failureThreshold: 10,
      timeoutThreshold: 5000,
      resetTimeout: 45000,
      halfOpenMaxCalls: 3,
      successThreshold: 5,
    });

    this.circuitBreakerService.createCircuit(this.circuitBreakers.queries, {
      failureThreshold: 8,
      timeoutThreshold: 8000,
      resetTimeout: 30000,
      halfOpenMaxCalls: 2,
      successThreshold: 3,
    });

    this.logger.log('Circuit breakers initialized for Telescope service');
  }

  async record(entry: TelescopeEntry): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const result = await this.circuitBreakerService.execute(
      this.circuitBreakers.entryProcessing,
      async () => {
        await this.entryManager.process(entry);
        return entry.id;
      },
      async () => {
        // Fallback: Log entry locally without processing
        this.logger.warn(`Fallback triggered for entry: ${entry.type} - ${entry.id}`);
        return entry.id;
      },
    );

    if (result.success) {
      this.logger.debug(`Recorded entry: ${entry.type} - ${entry.id} (${result.executionTime}ms)`);
      if (result.fromCache) {
        this.logger.warn(`Entry processed via fallback: ${entry.id}`);
      }
    } else {
      const errorMessage = result.error instanceof Error ? result.error.message : 'Unknown error';
      this.logger.error(
        `Failed to record entry ${entry.id}: ${errorMessage} (Circuit: ${result.circuitState})`,
      );

      // Optionally throw for critical operations
      if (entry.type === 'exception') {
        throw result.error || new Error(`Critical entry failed: ${entry.id}`);
      }
    }
  }

  async recordBatch(entries: TelescopeEntry[]): Promise<void> {
    if (!this.config.enabled || entries.length === 0) {
      return;
    }

    const result = await this.circuitBreakerService.execute(
      this.circuitBreakers.batchProcessing,
      async () => {
        await this.entryManager.processBatch(entries);
        return entries.length;
      },
      async () => {
        // Fallback: Process entries individually with circuit breaker
        this.logger.warn(
          `Batch processing failed, falling back to individual processing for ${entries.length} entries`,
        );
        let processedCount = 0;

        for (const entry of entries) {
          try {
            await this.record(entry);
            processedCount++;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.warn(
              `Failed to process individual entry in fallback: ${entry.id} - ${errorMessage}`,
            );
          }
        }

        return processedCount;
      },
    );

    if (result.success) {
      this.logger.debug(`Recorded batch: ${result.data} entries (${result.executionTime}ms)`);
      if (result.fromCache) {
        this.logger.warn(`Batch processed via fallback: ${result.data}/${entries.length} entries`);
      }
    } else {
      const errorMessage = result.error instanceof Error ? result.error.message : 'Unknown error';
      this.logger.error(
        `Failed to record batch: ${errorMessage} (Circuit: ${result.circuitState})`,
      );

      // Don't throw for batch operations, but log the failure
      // The fallback should have handled individual processing
    }
  }

  async find(filter?: TelescopeEntryFilter): Promise<TelescopeEntryResult> {
    const result = await this.circuitBreakerService.execute(
      this.circuitBreakers.queries,
      async () => {
        return await this.storageService.find(filter);
      },
      async () => {
        // Fallback: Return empty result with warning
        this.logger.warn('Storage query failed, returning empty result');
        return {
          entries: [],
          total: 0,
          hasMore: false,
        };
      },
    );

    if (!result.success) {
      const errorMessage = result.error instanceof Error ? result.error.message : 'Unknown error';
      this.logger.error(`Query failed: ${errorMessage} (Circuit: ${result.circuitState})`);
    }

    return result.data || { entries: [], total: 0, hasMore: false };
  }

  async findById(id: string): Promise<TelescopeEntry | null> {
    const result = await this.circuitBreakerService.execute(
      this.circuitBreakers.queries,
      async () => {
        return await this.storageService.findById(id);
      },
      async () => {
        // Fallback: Return null
        this.logger.warn(`Entry query by ID failed: ${id}`);
        return null;
      },
    );

    if (!result.success) {
      const errorMessage = result.error instanceof Error ? result.error.message : 'Unknown error';
      this.logger.error(
        `FindById failed for ${id}: ${errorMessage} (Circuit: ${result.circuitState})`,
      );
    }

    return result.data || null;
  }

  async getEntries(
    filter?: TelescopeEntryFilter,
    startDate?: Date,
    endDate?: Date,
  ): Promise<TelescopeEntry[]> {
    const searchFilter = {
      ...filter,
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
    };

    const result = await this.circuitBreakerService.execute(
      this.circuitBreakers.queries,
      async () => {
        const queryResult = await this.storageService.find(searchFilter);
        return queryResult.entries;
      },
      async () => {
        // Fallback: Return empty array
        this.logger.warn('Entries query failed, returning empty array');
        return [];
      },
    );

    if (!result.success) {
      const errorMessage = result.error instanceof Error ? result.error.message : 'Unknown error';
      this.logger.error(`GetEntries failed: ${errorMessage} (Circuit: ${result.circuitState})`);
    }

    return result.data || [];
  }

  async clear(): Promise<void> {
    const result = await this.circuitBreakerService.execute(
      this.circuitBreakers.storage,
      async () => {
        await this.storageService.clear();
        return true;
      },
      async () => {
        this.logger.warn('Clear operation failed, storage may still contain entries');
        return false;
      },
    );

    if (result.success) {
      this.logger.log('Telescope entries cleared');
    } else {
      const errorMessage = result.error instanceof Error ? result.error.message : 'Unknown error';
      this.logger.error(
        `Clear operation failed: ${errorMessage} (Circuit: ${result.circuitState})`,
      );
      throw result.error || new Error('Clear operation failed');
    }
  }

  async prune(): Promise<number> {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - this.config.storage.retention.hours);

    const result = await this.circuitBreakerService.execute(
      this.circuitBreakers.storage,
      async () => {
        return await this.storageService.prune(cutoffTime);
      },
      async () => {
        this.logger.warn('Prune operation failed, old entries may still exist');
        return 0;
      },
    );

    if (result.success) {
      this.logger.log(`Pruned ${result.data} old entries`);
      return result.data || 0;
    } else {
      const errorMessage = result.error instanceof Error ? result.error.message : 'Unknown error';
      this.logger.error(
        `Prune operation failed: ${errorMessage} (Circuit: ${result.circuitState})`,
      );
      return 0;
    }
  }

  async getStats(): Promise<any> {
    const result = await this.circuitBreakerService.execute(
      this.circuitBreakers.storage,
      async () => {
        return await this.storageService.getStats();
      },
      async () => {
        this.logger.warn('Storage stats unavailable, returning basic info');
        return {
          totalEntries: 0,
          entriesByType: {},
          sizeInBytes: 0,
        };
      },
    );

    const storageStats = result.data || {
      totalEntries: 0,
      entriesByType: {},
      sizeInBytes: 0,
    };

    // Get circuit breaker stats
    const circuitStats = {
      entryProcessing: this.circuitBreakerService.getStats(this.circuitBreakers.entryProcessing),
      batchProcessing: this.circuitBreakerService.getStats(this.circuitBreakers.batchProcessing),
      storage: this.circuitBreakerService.getStats(this.circuitBreakers.storage),
      queries: this.circuitBreakerService.getStats(this.circuitBreakers.queries),
    };

    return {
      ...storageStats,
      config: {
        enabled: this.config.enabled,
        environment: this.config.environment,
        storageDriver: this.config.storage.driver,
        retentionHours: this.config.storage.retention.hours,
      },
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      circuitBreakers: circuitStats,
      healthStatus: {
        storage: result.success,
        overallHealth: Object.values(circuitStats).every((stat) => stat && stat.state === 'closed'),
      },
    };
  }

  // Circuit breaker management methods
  getCircuitBreakerStats(): Record<string, any> {
    return {
      entryProcessing: this.circuitBreakerService.getStats(this.circuitBreakers.entryProcessing),
      batchProcessing: this.circuitBreakerService.getStats(this.circuitBreakers.batchProcessing),
      storage: this.circuitBreakerService.getStats(this.circuitBreakers.storage),
      queries: this.circuitBreakerService.getStats(this.circuitBreakers.queries),
    };
  }

  resetCircuitBreaker(
    type: 'entryProcessing' | 'batchProcessing' | 'storage' | 'queries',
  ): boolean {
    const circuitName = this.circuitBreakers[type];
    return this.circuitBreakerService.reset(circuitName);
  }

  forceOpenCircuitBreaker(
    type: 'entryProcessing' | 'batchProcessing' | 'storage' | 'queries',
  ): boolean {
    const circuitName = this.circuitBreakers[type];
    return this.circuitBreakerService.forceOpen(circuitName);
  }

  forceCloseCircuitBreaker(
    type: 'entryProcessing' | 'batchProcessing' | 'storage' | 'queries',
  ): boolean {
    const circuitName = this.circuitBreakers[type];
    return this.circuitBreakerService.forceClose(circuitName);
  }
}

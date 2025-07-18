import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { StorageDriver, StorageStats } from './interfaces/storage.interface';
import { TelescopeEntry, TelescopeEntryFilter, TelescopeEntryResult } from '../core/interfaces/telescope-entry.interface';
import { TelescopeConfig } from '../core/interfaces/telescope-config.interface';
import { MemoryStorageDriver } from './drivers/memory-storage.driver';
import { FileStorageDriver } from './drivers/file-storage.driver';
import { RedisStorageDriver } from './drivers/redis-storage.driver';

@Injectable()
export class StorageManagerService implements StorageDriver, OnModuleInit {
  private readonly logger = new Logger(StorageManagerService.name);
  private drivers = new Map<string, StorageDriver>();
  private primaryDriver: StorageDriver;
  private fallbackDriver?: StorageDriver;
  private healthStatus = new Map<string, boolean>();

  constructor(
    @Inject('TELESCOPE_CONFIG') private readonly config: TelescopeConfig
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initializeDrivers();
    this.startHealthChecks();
  }

  private async initializeDrivers(): Promise<void> {
    try {
      // Register all available drivers
      this.drivers.set('memory', new MemoryStorageDriver());
      this.drivers.set('file', new FileStorageDriver(this.config.storage));
      this.drivers.set('redis', new RedisStorageDriver(this.config.storage));
      
      // Set primary driver
      const primaryDriverName = this.config.storage.driver;
      this.primaryDriver = this.drivers.get(primaryDriverName);
      
      if (!this.primaryDriver) {
        this.logger.warn(`Primary driver '${primaryDriverName}' not available, falling back to memory`);
        this.primaryDriver = this.drivers.get('memory')!;
      }
      
      // Set fallback driver if configured
      const fallbackDriverName = this.config.storage.fallback;
      if (fallbackDriverName && fallbackDriverName !== primaryDriverName) {
        this.fallbackDriver = this.drivers.get(fallbackDriverName);
        if (!this.fallbackDriver) {
          this.logger.warn(`Fallback driver '${fallbackDriverName}' not available`);
        }
      }
      
      this.logger.log(`Storage manager initialized with primary: ${primaryDriverName}, fallback: ${fallbackDriverName || 'none'}`);
      
      // Initial health check
      await this.checkAllDriversHealth();
    } catch (error) {
      this.logger.error('Failed to initialize storage drivers:', error);
      throw error;
    }
  }

  async store(entry: TelescopeEntry): Promise<void> {
    return this.executeWithFallback(
      async () => {
        await this.primaryDriver.store(entry);
        this.logger.debug(`Stored entry ${entry.id} with primary driver`);
      },
      async () => {
        if (this.fallbackDriver) {
          await this.fallbackDriver.store(entry);
          this.logger.debug(`Stored entry ${entry.id} with fallback driver`);
        }
      },
      'store'
    );
  }

  async storeBatch(entries: TelescopeEntry[]): Promise<void> {
    return this.executeWithFallback(
      async () => {
        await this.primaryDriver.storeBatch(entries);
        this.logger.debug(`Stored batch of ${entries.length} entries with primary driver`);
      },
      async () => {
        if (this.fallbackDriver) {
          await this.fallbackDriver.storeBatch(entries);
          this.logger.debug(`Stored batch of ${entries.length} entries with fallback driver`);
        }
      },
      'storeBatch'
    );
  }

  async find(filter?: TelescopeEntryFilter): Promise<TelescopeEntryResult> {
    return this.executeWithFallback(
      () => this.primaryDriver.find(filter),
      () => this.fallbackDriver?.find(filter),
      'find'
    );
  }

  async findById(id: string): Promise<TelescopeEntry | null> {
    return this.executeWithFallback(
      () => this.primaryDriver.findById(id),
      () => this.fallbackDriver?.findById(id),
      'findById'
    );
  }

  async delete(id: string): Promise<boolean> {
    return this.executeWithFallback(
      () => this.primaryDriver.delete(id),
      () => this.fallbackDriver?.delete(id),
      'delete'
    );
  }

  async clear(): Promise<void> {
    return this.executeWithFallback(
      () => this.primaryDriver.clear(),
      () => this.fallbackDriver?.clear(),
      'clear'
    );
  }

  async prune(olderThan: Date): Promise<number> {
    return this.executeWithFallback(
      () => this.primaryDriver.prune(olderThan),
      () => this.fallbackDriver?.prune(olderThan),
      'prune'
    );
  }

  async getStats(): Promise<StorageStats> {
    return this.executeWithFallback(
      () => this.primaryDriver.getStats(),
      () => this.fallbackDriver?.getStats(),
      'getStats'
    );
  }

  private async executeWithFallback<T>(
    primary: () => Promise<T>,
    fallback?: () => Promise<T>,
    operation?: string
  ): Promise<T> {
    try {
      const result = await primary();
      return result;
    } catch (error) {
      this.logger.warn(`Primary storage failed for ${operation}: ${error.message}`);
      
      if (fallback) {
        try {
          const result = await fallback();
          this.logger.log(`Fallback storage succeeded for ${operation}`);
          return result;
        } catch (fallbackError) {
          this.logger.error(`Fallback storage failed for ${operation}: ${fallbackError.message}`);
          throw error; // Throw original error
        }
      }
      
      throw error;
    }
  }

  // Health check methods
  async checkAllDriversHealth(): Promise<void> {
    for (const [name, driver] of this.drivers) {
      try {
        const isHealthy = await this.checkDriverHealth(driver);
        this.healthStatus.set(name, isHealthy);
        
        if (isHealthy) {
          this.logger.debug(`Driver '${name}' is healthy`);
        } else {
          this.logger.warn(`Driver '${name}' is unhealthy`);
        }
      } catch (error) {
        this.logger.error(`Health check failed for driver '${name}':`, error);
        this.healthStatus.set(name, false);
      }
    }
  }

  private async checkDriverHealth(driver: StorageDriver): Promise<boolean> {
    try {
      // Check if driver has health check method
      if ('healthCheck' in driver && typeof driver.healthCheck === 'function') {
        return await (driver as any).healthCheck();
      }
      
      // Fallback: try to get stats
      await driver.getStats();
      return true;
    } catch (error) {
      return false;
    }
  }

  private startHealthChecks(): void {
    // Run health checks periodically
    setInterval(async () => {
      await this.checkAllDriversHealth();
    }, 30000); // Every 30 seconds
  }

  // Public methods for monitoring
  getDriverHealth(): Record<string, boolean> {
    return Object.fromEntries(this.healthStatus);
  }

  async getDetailedStats(): Promise<{
    primary: string;
    fallback?: string;
    health: Record<string, boolean>;
    stats: StorageStats;
  }> {
    const stats = await this.getStats();
    
    return {
      primary: this.config.storage.driver,
      fallback: this.config.storage.fallback,
      health: this.getDriverHealth(),
      stats
    };
  }

  getPrimaryDriver(): StorageDriver {
    return this.primaryDriver;
  }

  getFallbackDriver(): StorageDriver | undefined {
    return this.fallbackDriver;
  }

  getAvailableDrivers(): string[] {
    return Array.from(this.drivers.keys());
  }

  async switchPrimaryDriver(driverName: string): Promise<void> {
    const newDriver = this.drivers.get(driverName);
    if (!newDriver) {
      throw new Error(`Driver '${driverName}' not available`);
    }

    const isHealthy = await this.checkDriverHealth(newDriver);
    if (!isHealthy) {
      throw new Error(`Driver '${driverName}' is not healthy`);
    }

    this.primaryDriver = newDriver;
    this.logger.log(`Switched primary driver to: ${driverName}`);
  }

  // Cleanup method
  async cleanup(): Promise<void> {
    for (const [name, driver] of this.drivers) {
      try {
        if ('cleanup' in driver && typeof driver.cleanup === 'function') {
          await (driver as any).cleanup();
          this.logger.debug(`Cleaned up driver: ${name}`);
        }
      } catch (error) {
        this.logger.error(`Failed to cleanup driver '${name}':`, error);
      }
    }
  }
}
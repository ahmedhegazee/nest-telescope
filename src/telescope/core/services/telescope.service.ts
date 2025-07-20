import { Injectable, Logger, Inject } from '@nestjs/common';
import { TelescopeEntry, TelescopeEntryFilter, TelescopeEntryResult } from '../interfaces/telescope-entry.interface';
import { TelescopeConfig } from '../interfaces/telescope-config.interface';
import { EntryManagerService } from './entry-manager.service';
import { StorageService } from '../../storage/storage.service';

@Injectable()
export class TelescopeService {
  private readonly logger = new Logger(TelescopeService.name);

  constructor(
    private readonly entryManager: EntryManagerService,
    private readonly storageService: StorageService,
    @Inject('TELESCOPE_CONFIG') private readonly config: TelescopeConfig
  ) {}

  async record(entry: TelescopeEntry): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      await this.entryManager.process(entry);
      this.logger.debug(`Recorded entry: ${entry.type} - ${entry.id}`);
    } catch (error) {
      this.logger.error(`Failed to record entry: ${error.message}`);
    }
  }

  async recordBatch(entries: TelescopeEntry[]): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      await this.entryManager.processBatch(entries);
      this.logger.debug(`Recorded batch: ${entries.length} entries`);
    } catch (error) {
      this.logger.error(`Failed to record batch: ${error.message}`);
    }
  }

  async find(filter?: TelescopeEntryFilter): Promise<TelescopeEntryResult> {
    return this.storageService.find(filter);
  }

  async findById(id: string): Promise<TelescopeEntry | null> {
    return this.storageService.findById(id);
  }

  async getEntries(filter?: TelescopeEntryFilter, startDate?: Date, endDate?: Date): Promise<TelescopeEntry[]> {
    const searchFilter = {
      ...filter,
      ...(startDate && { startDate }),
      ...(endDate && { endDate })
    };
    
    const result = await this.storageService.find(searchFilter);
    return result.entries;
  }

  async clear(): Promise<void> {
    await this.storageService.clear();
    this.logger.log('Telescope entries cleared');
  }

  async prune(): Promise<number> {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - this.config.storage.retention.hours);
    
    const prunedCount = await this.storageService.prune(cutoffTime);
    this.logger.log(`Pruned ${prunedCount} old entries`);
    
    return prunedCount;
  }

  async getStats(): Promise<any> {
    const storageStats = await this.storageService.getStats();
    
    return {
      ...storageStats,
      config: {
        enabled: this.config.enabled,
        environment: this.config.environment,
        storageDriver: this.config.storage.driver,
        retentionHours: this.config.storage.retention.hours
      },
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }
}
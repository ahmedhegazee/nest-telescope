import { Injectable, Logger, Inject } from '@nestjs/common';
import { TelescopeEntry } from '../interfaces/telescope-entry.interface';
import { TelescopeConfig } from '../interfaces/telescope-config.interface';
import { StorageService } from '../../storage/storage.service';
import { v4 as uuid } from 'uuid';

@Injectable()
export class EntryManagerService {
  private readonly logger = new Logger(EntryManagerService.name);
  private readonly batchQueue: TelescopeEntry[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private sequenceCounter = 0;

  constructor(
    private readonly storageService: StorageService,
    @Inject('TELESCOPE_CONFIG') private readonly config: TelescopeConfig
  ) {
    // Start periodic batch flushing
    this.startBatchProcessor();
  }

  async process(entry: TelescopeEntry): Promise<void> {
    // Ensure entry has required fields
    this.ensureEntryFields(entry);

    if (this.config.storage.batch.enabled) {
      await this.addToBatch(entry);
    } else {
      await this.storageService.store(entry);
    }
  }

  async processBatch(entries: TelescopeEntry[]): Promise<void> {
    // Ensure all entries have required fields
    entries.forEach(entry => this.ensureEntryFields(entry));
    
    await this.storageService.storeBatch(entries);
  }

  async addToBatch(entry: TelescopeEntry): Promise<void> {
    this.batchQueue.push(entry);

    // Flush if batch size reached
    if (this.batchQueue.length >= this.config.storage.batch.size) {
      await this.flushBatch();
    }
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

  private startBatchProcessor(): void {
    if (!this.config.storage.batch.enabled) return;

    // Periodic batch flushing
    setInterval(async () => {
      if (this.batchQueue.length > 0) {
        await this.flushBatch();
      }
    }, this.config.storage.batch.flushInterval);
  }

  private async flushBatch(): Promise<void> {
    if (this.batchQueue.length === 0) return;

    const entries = this.batchQueue.splice(0);
    
    try {
      await this.storageService.storeBatch(entries);
      this.logger.debug(`Flushed batch: ${entries.length} entries`);
    } catch (error) {
      this.logger.error(`Failed to flush batch: ${error.message}`);
      // Re-add entries to queue for retry
      this.batchQueue.unshift(...entries);
    }

    // Clear timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }
}
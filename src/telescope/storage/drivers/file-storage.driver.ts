import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { StorageDriver, StorageStats } from '../interfaces/storage.interface';
import { TelescopeEntry, TelescopeEntryFilter, TelescopeEntryResult } from '../../core/interfaces/telescope-entry.interface';

interface FileEntry {
  filename: string;
  type: string;
  timestamp: Date;
  tags: string[];
  familyHash: string;
  sequence: number;
}

@Injectable()
export class FileStorageDriver implements StorageDriver {
  private readonly logger = new Logger(FileStorageDriver.name);
  private readonly storageDir: string;
  private readonly indexFile: string;
  private index: Map<string, FileEntry> = new Map();
  private initialized = false;

  constructor(config?: any) {
    this.storageDir = config?.file?.directory || './telescope-storage';
    this.indexFile = path.join(this.storageDir, 'index.json');
    this.initializeStorage();
  }

  private async initializeStorage(): Promise<void> {
    if (this.initialized) return;
    
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      await this.loadIndex();
      this.initialized = true;
      this.logger.log(`File storage initialized at: ${this.storageDir}`);
    } catch (error) {
      this.logger.error('Failed to initialize file storage:', error);
      throw error;
    }
  }

  async store(entry: TelescopeEntry): Promise<void> {
    await this.ensureInitialized();
    
    const filename = `${entry.id}.json`;
    const filepath = path.join(this.storageDir, filename);
    
    try {
      await fs.writeFile(filepath, JSON.stringify(entry, null, 2));
      
      // Update index
      this.index.set(entry.id, {
        filename,
        type: entry.type,
        timestamp: entry.timestamp,
        tags: entry.tags,
        familyHash: entry.familyHash,
        sequence: entry.sequence
      });
      
      await this.saveIndex();
      this.logger.debug(`Stored entry: ${entry.id}`);
    } catch (error) {
      this.logger.error(`Failed to store entry ${entry.id}:`, error);
      throw error;
    }
  }

  async storeBatch(entries: TelescopeEntry[]): Promise<void> {
    await this.ensureInitialized();
    
    try {
      // Process entries in parallel with limited concurrency
      const concurrency = 5;
      const chunks = this.chunkArray(entries, concurrency);
      
      for (const chunk of chunks) {
        await Promise.all(chunk.map(entry => this.store(entry)));
      }
      
      this.logger.debug(`Stored batch of ${entries.length} entries`);
    } catch (error) {
      this.logger.error('Failed to store batch:', error);
      throw error;
    }
  }

  async find(filter?: TelescopeEntryFilter): Promise<TelescopeEntryResult> {
    await this.ensureInitialized();
    
    let filteredEntries = Array.from(this.index.values());

    // Apply filters
    if (filter?.type) {
      filteredEntries = filteredEntries.filter(entry => entry.type === filter.type);
    }

    if (filter?.tags && filter.tags.length > 0) {
      filteredEntries = filteredEntries.filter(entry =>
        filter.tags!.some(tag => entry.tags.includes(tag))
      );
    }

    if (filter?.dateFrom) {
      filteredEntries = filteredEntries.filter(entry => 
        entry.timestamp >= filter.dateFrom!
      );
    }

    if (filter?.dateTo) {
      filteredEntries = filteredEntries.filter(entry => 
        entry.timestamp <= filter.dateTo!
      );
    }

    // Sort by timestamp desc
    filteredEntries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Pagination
    const offset = filter?.offset || 0;
    const limit = filter?.limit || 100;
    const total = filteredEntries.length;
    const paginatedEntries = filteredEntries.slice(offset, offset + limit);

    // Load full entries
    const entries = await Promise.all(
      paginatedEntries.map(async (indexEntry) => {
        try {
          const filepath = path.join(this.storageDir, indexEntry.filename);
          const content = await fs.readFile(filepath, 'utf-8');
          return JSON.parse(content) as TelescopeEntry;
        } catch (error) {
          this.logger.error(`Failed to load entry ${indexEntry.filename}:`, error);
          // Remove from index if file doesn't exist
          this.index.delete(indexEntry.filename.replace('.json', ''));
          return null;
        }
      })
    );

    return {
      entries: entries.filter(entry => entry !== null) as TelescopeEntry[],
      total,
      hasMore: offset + limit < total
    };
  }

  async findById(id: string): Promise<TelescopeEntry | null> {
    await this.ensureInitialized();
    
    const indexEntry = this.index.get(id);
    if (!indexEntry) return null;

    try {
      const filepath = path.join(this.storageDir, indexEntry.filename);
      const content = await fs.readFile(filepath, 'utf-8');
      return JSON.parse(content) as TelescopeEntry;
    } catch (error) {
      this.logger.error(`Failed to load entry ${id}:`, error);
      // Remove from index if file doesn't exist
      this.index.delete(id);
      await this.saveIndex();
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureInitialized();
    
    const indexEntry = this.index.get(id);
    if (!indexEntry) return false;

    try {
      const filepath = path.join(this.storageDir, indexEntry.filename);
      await fs.unlink(filepath);
      this.index.delete(id);
      await this.saveIndex();
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete entry ${id}:`, error);
      return false;
    }
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    
    try {
      // Delete all entry files
      const files = await fs.readdir(this.storageDir);
      const deletePromises = files
        .filter(file => file.endsWith('.json') && file !== 'index.json')
        .map(file => fs.unlink(path.join(this.storageDir, file)));
      
      await Promise.all(deletePromises);
      
      // Clear index
      this.index.clear();
      await this.saveIndex();
      
      this.logger.log('File storage cleared');
    } catch (error) {
      this.logger.error('Failed to clear file storage:', error);
      throw error;
    }
  }

  async prune(olderThan: Date): Promise<number> {
    await this.ensureInitialized();
    
    const entriesToDelete = Array.from(this.index.entries())
      .filter(([_, entry]) => entry.timestamp < olderThan);
    
    let deletedCount = 0;
    
    for (const [id, entry] of entriesToDelete) {
      try {
        const filepath = path.join(this.storageDir, entry.filename);
        await fs.unlink(filepath);
        this.index.delete(id);
        deletedCount++;
      } catch (error) {
        this.logger.error(`Failed to delete entry ${id} during pruning:`, error);
      }
    }
    
    if (deletedCount > 0) {
      await this.saveIndex();
      this.logger.log(`Pruned ${deletedCount} entries`);
    }
    
    return deletedCount;
  }

  async getStats(): Promise<StorageStats> {
    await this.ensureInitialized();
    
    const entries = Array.from(this.index.values());
    const entriesByType: Record<string, number> = {};
    let oldestEntry: Date | undefined;
    let newestEntry: Date | undefined;

    for (const entry of entries) {
      // Count by type
      entriesByType[entry.type] = (entriesByType[entry.type] || 0) + 1;

      // Track oldest/newest
      if (!oldestEntry || entry.timestamp < oldestEntry) {
        oldestEntry = entry.timestamp;
      }
      if (!newestEntry || entry.timestamp > newestEntry) {
        newestEntry = entry.timestamp;
      }
    }

    // Calculate storage size
    let sizeInBytes = 0;
    try {
      const files = await fs.readdir(this.storageDir);
      for (const file of files) {
        const filepath = path.join(this.storageDir, file);
        const stats = await fs.stat(filepath);
        sizeInBytes += stats.size;
      }
    } catch (error) {
      this.logger.error('Failed to calculate storage size:', error);
    }

    return {
      totalEntries: entries.length,
      entriesByType,
      oldestEntry,
      newestEntry,
      sizeInBytes
    };
  }

  // Health check method
  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      // Test write and read
      const testFile = path.join(this.storageDir, 'health-check.json');
      await fs.writeFile(testFile, JSON.stringify({ test: true }));
      await fs.readFile(testFile);
      await fs.unlink(testFile);
      return true;
    } catch (error) {
      return false;
    }
  }

  private async loadIndex(): Promise<void> {
    try {
      const content = await fs.readFile(this.indexFile, 'utf-8');
      const indexData = JSON.parse(content);
      
      // Convert timestamp strings back to Date objects
      for (const [id, entry] of Object.entries(indexData)) {
        (entry as any).timestamp = new Date((entry as any).timestamp);
      }
      
      this.index = new Map(Object.entries(indexData));
      this.logger.debug(`Loaded index with ${this.index.size} entries`);
    } catch (error) {
      // Index doesn't exist yet, start with empty index
      this.index = new Map();
      this.logger.debug('Started with empty index');
    }
  }

  private async saveIndex(): Promise<void> {
    try {
      const indexData = Object.fromEntries(this.index);
      await fs.writeFile(this.indexFile, JSON.stringify(indexData, null, 2));
    } catch (error) {
      this.logger.error('Failed to save index:', error);
      throw error;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initializeStorage();
    }
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}
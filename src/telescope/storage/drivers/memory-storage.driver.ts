import { Injectable } from '@nestjs/common';
import { StorageDriver, StorageStats } from '../interfaces/storage.interface';
import { TelescopeEntry, TelescopeEntryFilter, TelescopeEntryResult } from '../../core/interfaces/telescope-entry.interface';

@Injectable()
export class MemoryStorageDriver implements StorageDriver {
  private entries: TelescopeEntry[] = [];
  private maxEntries = 10000;

  async store(entry: TelescopeEntry): Promise<void> {
    this.entries.push(entry);
    this.enforceMaxEntries();
  }

  async storeBatch(entries: TelescopeEntry[]): Promise<void> {
    this.entries.push(...entries);
    this.enforceMaxEntries();
  }

  async find(filter?: TelescopeEntryFilter): Promise<TelescopeEntryResult> {
    let filteredEntries = [...this.entries];

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
      filteredEntries = filteredEntries.filter(entry => entry.timestamp >= filter.dateFrom!);
    }

    if (filter?.dateTo) {
      filteredEntries = filteredEntries.filter(entry => entry.timestamp <= filter.dateTo!);
    }

    // Sort by timestamp (newest first)
    filteredEntries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    const offset = filter?.offset || 0;
    const limit = filter?.limit || 100;
    const total = filteredEntries.length;
    const paginatedEntries = filteredEntries.slice(offset, offset + limit);

    return {
      entries: paginatedEntries,
      total,
      hasMore: offset + limit < total
    };
  }

  async findById(id: string): Promise<TelescopeEntry | null> {
    return this.entries.find(entry => entry.id === id) || null;
  }

  async delete(id: string): Promise<boolean> {
    const index = this.entries.findIndex(entry => entry.id === id);
    if (index >= 0) {
      this.entries.splice(index, 1);
      return true;
    }
    return false;
  }

  async clear(): Promise<void> {
    this.entries = [];
  }

  async prune(olderThan: Date): Promise<number> {
    const originalLength = this.entries.length;
    this.entries = this.entries.filter(entry => entry.timestamp > olderThan);
    return originalLength - this.entries.length;
  }

  async getStats(): Promise<StorageStats> {
    const entriesByType: Record<string, number> = {};
    let oldestEntry: Date | undefined;
    let newestEntry: Date | undefined;

    for (const entry of this.entries) {
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

    return {
      totalEntries: this.entries.length,
      entriesByType,
      oldestEntry,
      newestEntry,
      sizeInBytes: JSON.stringify(this.entries).length
    };
  }

  private enforceMaxEntries(): void {
    if (this.entries.length > this.maxEntries) {
      // Remove oldest entries
      this.entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }
}
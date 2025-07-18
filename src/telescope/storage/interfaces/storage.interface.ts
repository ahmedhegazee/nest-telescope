import { TelescopeEntry, TelescopeEntryFilter, TelescopeEntryResult } from '../../core/interfaces/telescope-entry.interface';

export interface StorageDriver {
  store(entry: TelescopeEntry): Promise<void>;
  storeBatch(entries: TelescopeEntry[]): Promise<void>;
  find(filter?: TelescopeEntryFilter): Promise<TelescopeEntryResult>;
  findById(id: string): Promise<TelescopeEntry | null>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
  prune(olderThan: Date): Promise<number>;
  getStats(): Promise<StorageStats>;
}

export interface StorageStats {
  totalEntries: number;
  entriesByType: Record<string, number>;
  oldestEntry?: Date;
  newestEntry?: Date;
  sizeInBytes?: number;
}
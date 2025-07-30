import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, interval, BehaviorSubject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

export interface MemoryRetentionPolicy {
  maxSize: number;                    // Maximum number of items
  maxAge: number;                     // Maximum age in milliseconds
  compressionThreshold: number;       // Compress when reaching this percentage
  evictionStrategy: 'fifo' | 'lifo' | 'lru' | 'lfu' | 'ttl';
  checkInterval: number;              // Memory check interval in ms
  enabled: boolean;
}

export interface MemoryCollectionConfig {
  id: string;
  policy: MemoryRetentionPolicy;
  itemSizeEstimator?: (item: any) => number;
  itemAgeExtractor?: (item: any) => Date;
  onEviction?: (items: any[]) => void;
  onCompression?: (items: any[]) => any[];
}

export interface MemoryUsageStats {
  totalCollections: number;
  totalItems: number;
  estimatedSize: number;             // Estimated memory usage in bytes
  collectionsOverThreshold: number;
  lastCleanup: Date | null;
  cleanupCount: number;
  evictedItems: number;
  compressedItems: number;
}

export interface CollectionStats {
  id: string;
  itemCount: number;
  estimatedSize: number;
  oldestItem: Date | null;
  newestItem: Date | null;
  lastEviction: Date | null;
  evictedCount: number;
  compressionRatio: number;
  policy: MemoryRetentionPolicy;
}

interface ManagedItem<T> {
  data: T;
  timestamp: Date;
  accessCount: number;
  lastAccessed: Date;
  size: number;
}

class ManagedCollection<T> {
  private items: ManagedItem<T>[] = [];
  private totalEvicted = 0;
  private totalCompressed = 0;
  private lastEviction: Date | null = null;
  private compressionRatio = 1;

  constructor(
    private readonly config: MemoryCollectionConfig,
    private readonly logger: Logger
  ) {}

  add(item: T): void {
    const timestamp = this.config.itemAgeExtractor ? this.config.itemAgeExtractor(item) : new Date();
    const size = this.config.itemSizeEstimator ? this.config.itemSizeEstimator(item) : this.estimateSize(item);

    const managedItem: ManagedItem<T> = {
      data: item,
      timestamp,
      accessCount: 0,
      lastAccessed: new Date(),
      size
    };

    this.items.push(managedItem);
    this.enforceRetentionPolicy();
  }

  addBatch(items: T[]): void {
    const timestamp = new Date();
    const managedItems = items.map(item => ({
      data: item,
      timestamp: this.config.itemAgeExtractor ? this.config.itemAgeExtractor(item) : timestamp,
      accessCount: 0,
      lastAccessed: timestamp,
      size: this.config.itemSizeEstimator ? this.config.itemSizeEstimator(item) : this.estimateSize(item)
    }));

    this.items.push(...managedItems);
    this.enforceRetentionPolicy();
  }

  getAll(): T[] {
    return this.items.map(item => {
      item.accessCount++;
      item.lastAccessed = new Date();
      return item.data;
    });
  }

  getRecent(count: number): T[] {
    const recent = this.items
      .slice(-count)
      .map(item => {
        item.accessCount++;
        item.lastAccessed = new Date();
        return item.data;
      });
    return recent;
  }

  filter(predicate: (item: T) => boolean): T[] {
    return this.items
      .filter(managedItem => predicate(managedItem.data))
      .map(item => {
        item.accessCount++;
        item.lastAccessed = new Date();
        return item.data;
      });
  }

  clear(): void {
    const count = this.items.length;
    this.items = [];
    this.logger.debug(`Cleared collection ${this.config.id}: ${count} items`);
  }

  size(): number {
    return this.items.length;
  }

  enforceRetentionPolicy(): void {
    if (!this.config.policy.enabled) return;

    const policy = this.config.policy;
    let itemsToEvict: ManagedItem<T>[] = [];

    // Age-based eviction
    if (policy.maxAge > 0) {
      const cutoffTime = Date.now() - policy.maxAge;
      const ageEvictions = this.items.filter(item => item.timestamp.getTime() < cutoffTime);
      itemsToEvict.push(...ageEvictions);
    }

    // Size-based eviction
    if (policy.maxSize > 0 && this.items.length > policy.maxSize) {
      const excess = this.items.length - policy.maxSize;
      const sizeEvictions = this.selectItemsForEviction(excess);
      itemsToEvict.push(...sizeEvictions);
    }

    // Compression check
    if (policy.compressionThreshold > 0) {
      const thresholdSize = Math.floor(policy.maxSize * policy.compressionThreshold);
      if (this.items.length > thresholdSize) {
        this.performCompression();
      }
    }

    // Execute evictions
    if (itemsToEvict.length > 0) {
      this.evictItems(itemsToEvict);
    }
  }

  private selectItemsForEviction(count: number): ManagedItem<T>[] {
    const strategy = this.config.policy.evictionStrategy;
    const sorted = [...this.items];

    switch (strategy) {
      case 'fifo':
        return sorted.slice(0, count);
      
      case 'lifo':
        return sorted.slice(-count);
      
      case 'lru':
        sorted.sort((a, b) => a.lastAccessed.getTime() - b.lastAccessed.getTime());
        return sorted.slice(0, count);
      
      case 'lfu':
        sorted.sort((a, b) => a.accessCount - b.accessCount);
        return sorted.slice(0, count);
      
      case 'ttl':
        sorted.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        return sorted.slice(0, count);
      
      default:
        return sorted.slice(0, count);
    }
  }

  private evictItems(itemsToEvict: ManagedItem<T>[]): void {
    if (itemsToEvict.length === 0) return;

    const evictedData = itemsToEvict.map(item => item.data);
    
    // Call eviction callback if provided
    if (this.config.onEviction) {
      try {
        this.config.onEviction(evictedData);
      } catch (error) {
        this.logger.warn(`Eviction callback failed for collection ${this.config.id}: ${error}`);
      }
    }

    // Remove items
    this.items = this.items.filter(item => !itemsToEvict.includes(item));
    
    this.totalEvicted += itemsToEvict.length;
    this.lastEviction = new Date();
    
    this.logger.debug(`Evicted ${itemsToEvict.length} items from collection ${this.config.id} using ${this.config.policy.evictionStrategy} strategy`);
  }

  private performCompression(): void {
    if (!this.config.onCompression) return;

    try {
      const originalCount = this.items.length;
      const compressedData = this.config.onCompression(this.items.map(item => item.data));
      
      if (compressedData.length < originalCount) {
        // Replace items with compressed data
        const timestamp = new Date();
        this.items = compressedData.map(data => ({
          data,
          timestamp,
          accessCount: 0,
          lastAccessed: timestamp,
          size: this.config.itemSizeEstimator ? this.config.itemSizeEstimator(data) : this.estimateSize(data)
        }));

        this.totalCompressed += (originalCount - compressedData.length);
        this.compressionRatio = compressedData.length / originalCount;
        
        this.logger.debug(`Compressed collection ${this.config.id}: ${originalCount} → ${compressedData.length} items`);
      }
    } catch (error) {
      this.logger.warn(`Compression failed for collection ${this.config.id}: ${error}`);
    }
  }

  private estimateSize(item: any): number {
    if (typeof item === 'string') {
      return item.length * 2; // Rough estimate for UTF-16
    }
    
    if (typeof item === 'object' && item !== null) {
      try {
        return JSON.stringify(item).length * 2;
      } catch {
        return 1000; // Default estimate for objects that can't be serialized
      }
    }
    
    return 100; // Default size for primitives
  }

  getStats(): CollectionStats {
    const now = new Date();
    const sizes = this.items.map(item => item.size);
    const timestamps = this.items.map(item => item.timestamp);
    
    return {
      id: this.config.id,
      itemCount: this.items.length,
      estimatedSize: sizes.reduce((sum, size) => sum + size, 0),
      oldestItem: timestamps.length > 0 ? new Date(Math.min(...timestamps.map(t => t.getTime()))) : null,
      newestItem: timestamps.length > 0 ? new Date(Math.max(...timestamps.map(t => t.getTime()))) : null,
      lastEviction: this.lastEviction,
      evictedCount: this.totalEvicted,
      compressionRatio: this.compressionRatio,
      policy: this.config.policy
    };
  }
}

@Injectable()
export class MemoryManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MemoryManagerService.name);
  private readonly collections = new Map<string, ManagedCollection<any>>();
  private readonly destroy$ = new Subject<void>();
  private readonly statsSubject = new BehaviorSubject<MemoryUsageStats>(this.getInitialStats());
  
  private cleanupCount = 0;
  private lastCleanup: Date | null = null;

  constructor() {
    this.startMemoryMonitoring();
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Memory Manager Service initialized');
  }

  onModuleDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  createCollection<T>(config: MemoryCollectionConfig): string {
    const collection = new ManagedCollection<T>(config, this.logger);
    this.collections.set(config.id, collection);
    this.logger.log(`Created managed collection: ${config.id} (maxSize: ${config.policy.maxSize}, maxAge: ${config.policy.maxAge}ms)`);
    return config.id;
  }

  addToCollection<T>(collectionId: string, item: T): void {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }
    collection.add(item);
  }

  addBatchToCollection<T>(collectionId: string, items: T[]): void {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }
    collection.addBatch(items);
  }

  getFromCollection<T>(collectionId: string): T[] {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }
    return collection.getAll();
  }

  getRecentFromCollection<T>(collectionId: string, count: number): T[] {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }
    return collection.getRecent(count);
  }

  filterCollection<T>(collectionId: string, predicate: (item: T) => boolean): T[] {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }
    return collection.filter(predicate);
  }

  clearCollection(collectionId: string): void {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }
    collection.clear();
  }

  removeCollection(collectionId: string): boolean {
    return this.collections.delete(collectionId);
  }

  getCollectionStats(collectionId: string): CollectionStats | null {
    const collection = this.collections.get(collectionId);
    return collection ? collection.getStats() : null;
  }

  getAllCollectionStats(): CollectionStats[] {
    return Array.from(this.collections.values()).map(collection => collection.getStats());
  }

  getMemoryUsage(): MemoryUsageStats {
    const stats = this.getAllCollectionStats();
    const totalItems = stats.reduce((sum, stat) => sum + stat.itemCount, 0);
    const estimatedSize = stats.reduce((sum, stat) => sum + stat.estimatedSize, 0);
    const collectionsOverThreshold = stats.filter(stat => 
      stat.policy.compressionThreshold > 0 && 
      stat.itemCount > Math.floor(stat.policy.maxSize * stat.policy.compressionThreshold)
    ).length;

    return {
      totalCollections: this.collections.size,
      totalItems,
      estimatedSize,
      collectionsOverThreshold,
      lastCleanup: this.lastCleanup,
      cleanupCount: this.cleanupCount,
      evictedItems: stats.reduce((sum, stat) => sum + stat.evictedCount, 0),
      compressedItems: stats.reduce((sum, stat) => sum + Math.floor(stat.itemCount * (1 - stat.compressionRatio)), 0)
    };
  }

  getMemoryUsageStream(): Observable<MemoryUsageStats> {
    return this.statsSubject.asObservable();
  }

  forceCleanup(): void {
    this.logger.log('Forcing memory cleanup across all collections');
    
    this.collections.forEach((collection, id) => {
      try {
        collection.enforceRetentionPolicy();
      } catch (error) {
        this.logger.error(`Failed to cleanup collection ${id}: ${error}`);
      }
    });
    
    this.cleanupCount++;
    this.lastCleanup = new Date();
    this.updateStats();
  }

  // Utility methods for common retention policies
  static createTimelinePolicy(maxItems: number = 1000, maxHours: number = 24): MemoryRetentionPolicy {
    return {
      maxSize: maxItems,
      maxAge: maxHours * 60 * 60 * 1000,
      compressionThreshold: 0.8,
      evictionStrategy: 'fifo',
      checkInterval: 300000, // 5 minutes
      enabled: true
    };
  }

  static createMetricsPolicy(maxItems: number = 5000, maxDays: number = 7): MemoryRetentionPolicy {
    return {
      maxSize: maxItems,
      maxAge: maxDays * 24 * 60 * 60 * 1000,
      compressionThreshold: 0.7,
      evictionStrategy: 'lru',
      checkInterval: 600000, // 10 minutes
      enabled: true
    };
  }

  static createAlertPolicy(maxItems: number = 10000, maxDays: number = 30): MemoryRetentionPolicy {
    return {
      maxSize: maxItems,
      maxAge: maxDays * 24 * 60 * 60 * 1000,
      compressionThreshold: 0.9,
      evictionStrategy: 'ttl',
      checkInterval: 900000, // 15 minutes
      enabled: true
    };
  }

  private startMemoryMonitoring(): void {
    // Monitor memory usage every 30 seconds
    interval(30000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.updateStats();
        this.checkMemoryPressure();
      });

    // Cleanup check every 5 minutes
    interval(300000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.performPeriodicCleanup();
      });
  }

  private updateStats(): void {
    const stats = this.getMemoryUsage();
    this.statsSubject.next(stats);
  }

  private checkMemoryPressure(): void {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    const heapTotalMB = usage.heapTotal / 1024 / 1024;
    const heapUsagePercent = (heapUsedMB / heapTotalMB) * 100;

    if (heapUsagePercent > 80) {
      this.logger.warn(`High memory usage detected: ${heapUsagePercent.toFixed(1)}% (${heapUsedMB.toFixed(1)}MB/${heapTotalMB.toFixed(1)}MB)`);
      this.forceCleanup();
    }
  }

  private performPeriodicCleanup(): void {
    this.collections.forEach((collection, id) => {
      try {
        collection.enforceRetentionPolicy();
      } catch (error) {
        this.logger.error(`Periodic cleanup failed for collection ${id}: ${error}`);
      }
    });

    this.cleanupCount++;
    this.lastCleanup = new Date();
  }

  private getInitialStats(): MemoryUsageStats {
    return {
      totalCollections: 0,
      totalItems: 0,
      estimatedSize: 0,
      collectionsOverThreshold: 0,
      lastCleanup: null,
      cleanupCount: 0,
      evictedItems: 0,
      compressedItems: 0
    };
  }
}
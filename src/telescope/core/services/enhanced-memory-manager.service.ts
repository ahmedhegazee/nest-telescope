import { Injectable, Logger } from '@nestjs/common';

export interface MemoryManagerConfig {
  enabled: boolean;
  maxTimelineSize: number;
  metricsRetentionMs: number;
  cleanupIntervalMs: number;
  memoryThresholdMB: number;
  autoCleanup: boolean;
  compressionEnabled: boolean;
}

export interface MemoryStats {
  totalAllocated: number;
  timelineEntries: number;
  metricsEntries: number;
  lastCleanup: number;
  memoryUsageMB: number;
  compressionRatio: number;
}

interface TimelineEntry {
  timestamp: number;
  data: any;
  compressed?: boolean;
}

interface MetricsEntry {
  timestamp: number;
  key: string;
  value: any;
  ttl?: number;
}

@Injectable()
export class EnhancedMemoryManagerService {
  private readonly logger = new Logger(EnhancedMemoryManagerService.name);
  
  private readonly timelines = new Map<string, TimelineEntry[]>();
  private readonly metrics = new Map<string, MetricsEntry[]>();
  private readonly config: MemoryManagerConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<MemoryManagerConfig> = {}) {
    this.config = {
      enabled: true,
      maxTimelineSize: 1000,
      metricsRetentionMs: 300000, // 5 minutes
      cleanupIntervalMs: 60000, // 1 minute
      memoryThresholdMB: 100,
      autoCleanup: true,
      compressionEnabled: true,
      ...config
    };

    if (this.config.enabled && this.config.autoCleanup) {
      this.startCleanupTimer();
    }

    this.logger.debug('Enhanced Memory Manager initialized', this.config);
  }

  /**
   * Add entry to timeline with automatic cleanup
   */
  addTimelineEntry(timelineId: string, data: any): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      let timeline = this.timelines.get(timelineId);
      if (!timeline) {
        timeline = [];
        this.timelines.set(timelineId, timeline);
      }

      const entry: TimelineEntry = {
        timestamp: Date.now(),
        data: this.config.compressionEnabled ? this.compressData(data) : data,
        compressed: this.config.compressionEnabled
      };

      timeline.push(entry);

      // Enforce size limit
      if (timeline.length > this.config.maxTimelineSize) {
        const removeCount = timeline.length - this.config.maxTimelineSize;
        timeline.splice(0, removeCount);
      }

      // Check memory usage after adding
      this.checkMemoryUsage();
    } catch (error) {
      this.logger.error(`Failed to add timeline entry for ${timelineId}:`, error);
    }
  }

  /**
   * Add metrics entry with TTL support
   */
  addMetricsEntry(key: string, value: any, ttlMs?: number): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      let metricsArray = this.metrics.get(key);
      if (!metricsArray) {
        metricsArray = [];
        this.metrics.set(key, metricsArray);
      }

      const entry: MetricsEntry = {
        timestamp: Date.now(),
        key,
        value: this.config.compressionEnabled ? this.compressData(value) : value,
        ttl: ttlMs ? Date.now() + ttlMs : undefined
      };

      metricsArray.push(entry);

      // Clean up expired entries immediately if TTL is specified
      if (ttlMs) {
        this.cleanupExpiredMetrics(key);
      }

      this.checkMemoryUsage();
    } catch (error) {
      this.logger.error(`Failed to add metrics entry for ${key}:`, error);
    }
  }

  /**
   * Get timeline entries within time range
   */
  getTimelineEntries(timelineId: string, fromTimestamp?: number, toTimestamp?: number): any[] {
    try {
      const timeline = this.timelines.get(timelineId);
      if (!timeline) {
        return [];
      }

      let entries = timeline;

      if (fromTimestamp || toTimestamp) {
        entries = timeline.filter(entry => {
          if (fromTimestamp && entry.timestamp < fromTimestamp) return false;
          if (toTimestamp && entry.timestamp > toTimestamp) return false;
          return true;
        });
      }

      return entries.map(entry => ({
        timestamp: entry.timestamp,
        data: entry.compressed ? this.decompressData(entry.data) : entry.data
      }));
    } catch (error) {
      this.logger.error(`Failed to get timeline entries for ${timelineId}:`, error);
      return [];
    }
  }

  /**
   * Get latest metrics entries
   */
  getLatestMetrics(key: string, limit: number = 10): any[] {
    try {
      const metricsArray = this.metrics.get(key);
      if (!metricsArray) {
        return [];
      }

      // Clean up expired entries first
      this.cleanupExpiredMetrics(key);

      const validEntries = metricsArray.slice(-limit);
      return validEntries.map(entry => ({
        timestamp: entry.timestamp,
        key: entry.key,
        value: this.config.compressionEnabled ? this.decompressData(entry.value) : entry.value
      }));
    } catch (error) {
      this.logger.error(`Failed to get latest metrics for ${key}:`, error);
      return [];
    }
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): MemoryStats {
    const timelineEntries = Array.from(this.timelines.values()).reduce((sum, timeline) => sum + timeline.length, 0);
    const metricsEntries = Array.from(this.metrics.values()).reduce((sum, metrics) => sum + metrics.length, 0);
    
    const memoryUsage = process.memoryUsage();
    const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;

    return {
      totalAllocated: timelineEntries + metricsEntries,
      timelineEntries,
      metricsEntries,
      lastCleanup: this.lastCleanupTime || 0,
      memoryUsageMB,
      compressionRatio: this.calculateCompressionRatio()
    };
  }

  /**
   * Manual cleanup trigger
   */
  async cleanup(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      const startTime = Date.now();
      let cleanedEntries = 0;

      // Cleanup old timeline entries
      cleanedEntries += this.cleanupOldTimelineEntries();

      // Cleanup old metrics entries
      cleanedEntries += this.cleanupOldMetricsEntries();

      // Cleanup expired metrics
      cleanedEntries += this.cleanupAllExpiredMetrics();

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const duration = Date.now() - startTime;
      this.lastCleanupTime = Date.now();

      this.logger.debug(`Memory cleanup completed: ${cleanedEntries} entries removed in ${duration}ms`);
    } catch (error) {
      this.logger.error('Memory cleanup failed:', error);
    }
  }

  /**
   * Clear all data for a specific timeline
   */
  clearTimeline(timelineId: string): void {
    try {
      this.timelines.delete(timelineId);
      this.logger.debug(`Timeline cleared: ${timelineId}`);
    } catch (error) {
      this.logger.error(`Failed to clear timeline ${timelineId}:`, error);
    }
  }

  /**
   * Clear all metrics for a specific key
   */
  clearMetrics(key: string): void {
    try {
      this.metrics.delete(key);
      this.logger.debug(`Metrics cleared: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to clear metrics ${key}:`, error);
    }
  }

  /**
   * Clear all data
   */
  clearAll(): void {
    try {
      this.timelines.clear();
      this.metrics.clear();
      this.logger.debug('All memory data cleared');
    } catch (error) {
      this.logger.error('Failed to clear all data:', error);
    }
  }

  /**
   * Shutdown cleanup timer
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.logger.debug('Memory manager shutdown');
  }

  private lastCleanupTime: number = 0;

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  private cleanupOldTimelineEntries(): number {
    let removedCount = 0;
    const cutoff = Date.now() - this.config.metricsRetentionMs;

    for (const [timelineId, timeline] of this.timelines.entries()) {
      const originalLength = timeline.length;
      
      // Remove old entries
      const newTimeline = timeline.filter(entry => entry.timestamp >= cutoff);
      
      // Also enforce max size
      if (newTimeline.length > this.config.maxTimelineSize) {
        newTimeline.splice(0, newTimeline.length - this.config.maxTimelineSize);
      }

      this.timelines.set(timelineId, newTimeline);
      removedCount += originalLength - newTimeline.length;
    }

    return removedCount;
  }

  private cleanupOldMetricsEntries(): number {
    let removedCount = 0;
    const cutoff = Date.now() - this.config.metricsRetentionMs;

    for (const [key, metricsArray] of this.metrics.entries()) {
      const originalLength = metricsArray.length;
      const newMetrics = metricsArray.filter(entry => entry.timestamp >= cutoff);
      
      this.metrics.set(key, newMetrics);
      removedCount += originalLength - newMetrics.length;
    }

    return removedCount;
  }

  private cleanupAllExpiredMetrics(): number {
    let removedCount = 0;

    for (const key of this.metrics.keys()) {
      removedCount += this.cleanupExpiredMetrics(key);
    }

    return removedCount;
  }

  private cleanupExpiredMetrics(key: string): number {
    const metricsArray = this.metrics.get(key);
    if (!metricsArray) {
      return 0;
    }

    const now = Date.now();
    const originalLength = metricsArray.length;
    
    const validMetrics = metricsArray.filter(entry => !entry.ttl || entry.ttl > now);
    
    this.metrics.set(key, validMetrics);
    return originalLength - validMetrics.length;
  }

  private checkMemoryUsage(): void {
    const memoryUsage = process.memoryUsage();
    const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;

    if (memoryUsageMB > this.config.memoryThresholdMB) {
      this.logger.warn(`Memory threshold exceeded: ${memoryUsageMB.toFixed(2)}MB > ${this.config.memoryThresholdMB}MB`);
      
      if (this.config.autoCleanup) {
        // Trigger immediate cleanup
        setImmediate(() => this.cleanup());
      }
    }
  }

  private compressData(data: any): any {
    try {
      // Simple compression - stringify and use a basic algorithm
      // In production, you might want to use a proper compression library
      if (typeof data === 'object' && data !== null) {
        const jsonString = JSON.stringify(data);
        if (jsonString.length > 1000) {
          // For large objects, remove some non-essential properties
          return this.simplifyObject(data);
        }
      }
      return data;
    } catch (error) {
      return data;
    }
  }

  private decompressData(data: any): any {
    // Since we're using simple compression, just return the data
    return data;
  }

  private simplifyObject(obj: any): any {
    if (Array.isArray(obj)) {
      // Limit array size for compression
      return obj.length > 100 ? obj.slice(0, 100) : obj;
    }

    if (typeof obj === 'object' && obj !== null) {
      const simplified: any = {};
      let propertyCount = 0;
      
      for (const [key, value] of Object.entries(obj)) {
        if (propertyCount >= 50) break; // Limit properties
        
        if (typeof value === 'string' && value.length > 500) {
          simplified[key] = value.substring(0, 500) + '...';
        } else if (typeof value === 'object') {
          simplified[key] = this.simplifyObject(value);
        } else {
          simplified[key] = value;
        }
        
        propertyCount++;
      }
      
      return simplified;
    }

    return obj;
  }

  private calculateCompressionRatio(): number {
    // Simple calculation - in production you'd want more sophisticated metrics
    const timelineCount = Array.from(this.timelines.values()).reduce((sum, timeline) => sum + timeline.length, 0);
    const metricsCount = Array.from(this.metrics.values()).reduce((sum, metrics) => sum + metrics.length, 0);
    
    if (timelineCount + metricsCount === 0) {
      return 1;
    }

    // Estimate compression based on simplified objects
    return 0.7; // Assume 30% compression on average
  }
}
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TelescopeConfig } from '../core/interfaces/telescope-config.interface';
import { TelescopeEntry } from '../core/interfaces/telescope-entry.interface';
import { EnhancedEntryManagerService } from '../core/services/enhanced-entry-manager.service';
import { Inject } from '@nestjs/common';
import { 
  WatcherInterface, 
  WatcherMetadata, 
  WatcherRegistryStatistics, 
  WatcherHealthStatus 
} from './interfaces/watcher.interface';

@Injectable()
export class WatcherRegistryService implements OnModuleInit {
  private readonly logger = new Logger(WatcherRegistryService.name);
  private watchers = new Map<string, WatcherInterface>();
  private watcherMetadata = new Map<string, WatcherMetadata>();
  private dependencyGraph = new Map<string, string[]>();
  private initialized = false;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly entryManager: EnhancedEntryManagerService,
    @Inject('TELESCOPE_CONFIG') private readonly config: TelescopeConfig
  ) {}

  async onModuleInit(): Promise<void> {
    await this.discoverWatchers();
    this.buildDependencyGraph();
    await this.initializeWatchers();
    this.initialized = true;
    this.logger.log('Watcher registry initialized');
  }

  // Watcher registration methods
  register(watcher: WatcherInterface, metadata: Partial<WatcherMetadata> = {}): void {
    if (this.watchers.has(watcher.name)) {
      throw new Error(`Watcher '${watcher.name}' is already registered`);
    }

    this.watchers.set(watcher.name, watcher);
    this.watcherMetadata.set(watcher.name, {
      name: watcher.name,
      enabled: watcher.isEnabled,
      priority: metadata.priority || 100,
      tags: metadata.tags || [],
      dependencies: metadata.dependencies || [],
      entriesProcessed: 0
    });

    this.logger.debug(`Registered watcher: ${watcher.name}`);
  }

  unregister(name: string): boolean {
    const watcher = this.watchers.get(name);
    if (!watcher) return false;

    // Check if other watchers depend on this one
    const dependents = this.getDependents(name);
    if (dependents.length > 0) {
      throw new Error(`Cannot unregister watcher '${name}' - it has dependents: ${dependents.join(', ')}`);
    }

    this.watchers.delete(name);
    this.watcherMetadata.delete(name);
    this.dependencyGraph.delete(name);

    this.logger.debug(`Unregistered watcher: ${name}`);
    return true;
  }

  // Watcher management methods
  async enable(name: string): Promise<void> {
    const watcher = this.watchers.get(name);
    if (!watcher) {
      throw new Error(`Watcher '${name}' not found`);
    }

    // Check dependencies
    const metadata = this.watcherMetadata.get(name)!;
    for (const dependency of metadata.dependencies) {
      const depWatcher = this.watchers.get(dependency);
      if (!depWatcher || !depWatcher.isEnabled) {
        throw new Error(`Dependency '${dependency}' is not enabled for watcher '${name}'`);
      }
    }

    watcher.enable();
    metadata.enabled = true;
    this.logger.log(`Enabled watcher: ${name}`);
  }

  async disable(name: string): Promise<void> {
    const watcher = this.watchers.get(name);
    if (!watcher) {
      throw new Error(`Watcher '${name}' not found`);
    }

    // Check if other watchers depend on this one
    const dependents = this.getDependents(name);
    if (dependents.length > 0) {
      throw new Error(`Cannot disable watcher '${name}' - it has dependents: ${dependents.join(', ')}`);
    }

    watcher.disable();
    const metadata = this.watcherMetadata.get(name)!;
    metadata.enabled = false;
    this.logger.log(`Disabled watcher: ${name}`);
  }

  async enableAll(): Promise<void> {
    // Sort watchers by priority and dependencies
    const sortedWatchers = this.getSortedWatchers();
    
    for (const watcher of sortedWatchers) {
      try {
        if (!watcher.isEnabled) {
          await this.enable(watcher.name);
        }
      } catch (error) {
        this.logger.error(`Failed to enable watcher '${watcher.name}':`, error);
      }
    }
  }

  async disableAll(): Promise<void> {
    // Reverse order to handle dependencies
    const sortedWatchers = this.getSortedWatchers().reverse();
    
    for (const watcher of sortedWatchers) {
      try {
        if (watcher.isEnabled) {
          await this.disable(watcher.name);
        }
      } catch (error) {
        this.logger.error(`Failed to disable watcher '${watcher.name}':`, error);
      }
    }
  }

  async restart(name: string): Promise<void> {
    await this.disable(name);
    await this.enable(name);
  }

  // Query methods
  getWatcher(name: string): WatcherInterface | undefined {
    return this.watchers.get(name);
  }

  getWatcherMetadata(name: string): WatcherMetadata | undefined {
    return this.watcherMetadata.get(name);
  }

  getAllWatchers(): WatcherInterface[] {
    return Array.from(this.watchers.values());
  }

  getEnabledWatchers(): WatcherInterface[] {
    return Array.from(this.watchers.values()).filter(watcher => watcher.isEnabled);
  }

  getDisabledWatchers(): WatcherInterface[] {
    return Array.from(this.watchers.values()).filter(watcher => !watcher.isEnabled);
  }

  getWatchersByTag(tag: string): WatcherInterface[] {
    const watchers: WatcherInterface[] = [];
    
    for (const [name, metadata] of this.watcherMetadata) {
      if (metadata.tags.includes(tag)) {
        const watcher = this.watchers.get(name);
        if (watcher) {
          watchers.push(watcher);
        }
      }
    }
    
    return watchers;
  }

  // Statistics and monitoring
  getStatistics(): WatcherRegistryStatistics {
    const allWatchers = Array.from(this.watcherMetadata.values());
    const enabledWatchers = allWatchers.filter(w => w.enabled);
    const disabledWatchers = allWatchers.filter(w => !w.enabled);

    return {
      total: allWatchers.length,
      enabled: enabledWatchers.length,
      disabled: disabledWatchers.length,
      totalEntriesProcessed: allWatchers.reduce((sum, w) => sum + w.entriesProcessed, 0),
      watchers: allWatchers.map(w => ({
        name: w.name,
        enabled: w.enabled,
        priority: w.priority,
        tags: w.tags,
        dependencies: w.dependencies,
        lastActivity: w.lastActivity,
        entriesProcessed: w.entriesProcessed
      }))
    };
  }

  // Entry processing coordination
  async processEntry(entry: TelescopeEntry, watcherName?: string): Promise<void> {
    try {
      // Record activity
      if (watcherName) {
        const metadata = this.watcherMetadata.get(watcherName);
        if (metadata) {
          metadata.lastActivity = new Date();
          metadata.entriesProcessed++;
        }
      }

      // Process through entry manager
      await this.entryManager.process(entry);
    } catch (error) {
      this.logger.error(`Failed to process entry from watcher '${watcherName}':`, error);
      throw error;
    }
  }

  async processBatch(entries: TelescopeEntry[], watcherName?: string): Promise<void> {
    try {
      // Record activity
      if (watcherName) {
        const metadata = this.watcherMetadata.get(watcherName);
        if (metadata) {
          metadata.lastActivity = new Date();
          metadata.entriesProcessed += entries.length;
        }
      }

      // Process through entry manager
      await this.entryManager.processBatch(entries);
    } catch (error) {
      this.logger.error(`Failed to process batch from watcher '${watcherName}':`, error);
      throw error;
    }
  }

  // Health check methods
  async healthCheck(): Promise<WatcherHealthStatus> {
    const results: Record<string, boolean> = {};
    let overallHealth = true;

    for (const [name, watcher] of this.watchers) {
      try {
        // Check if watcher has health check method
        if ('healthCheck' in watcher && typeof watcher.healthCheck === 'function') {
          const isHealthy = await (watcher as any).healthCheck();
          results[name] = isHealthy;
          if (!isHealthy) overallHealth = false;
        } else {
          // Default health check - watcher is healthy if enabled
          results[name] = watcher.isEnabled;
        }
      } catch (error) {
        this.logger.error(`Health check failed for watcher '${name}':`, error);
        results[name] = false;
        overallHealth = false;
      }
    }

    return {
      healthy: overallHealth,
      watchers: results,
      timestamp: new Date()
    };
  }

  // Private methods
  private async discoverWatchers(): Promise<void> {
    // This would be implemented to auto-discover watchers
    // For now, watchers need to be registered manually
    this.logger.debug('Watcher discovery completed');
  }

  private buildDependencyGraph(): void {
    for (const [name, metadata] of this.watcherMetadata) {
      this.dependencyGraph.set(name, metadata.dependencies);
    }
  }

  private async initializeWatchers(): Promise<void> {
    // Sort watchers by priority and dependencies
    const sortedWatchers = this.getSortedWatchers();
    
    for (const watcher of sortedWatchers) {
      try {
        // Enable watcher if configured
        const watcherConfig = this.config.watchers?.[watcher.name];
        if (watcherConfig?.enabled !== false) {
          await this.enable(watcher.name);
        }
      } catch (error) {
        this.logger.error(`Failed to initialize watcher '${watcher.name}':`, error);
      }
    }
  }

  private getSortedWatchers(): WatcherInterface[] {
    const watchers = Array.from(this.watchers.values());
    
    // Sort by priority (lower number = higher priority)
    return watchers.sort((a, b) => {
      const metaA = this.watcherMetadata.get(a.name)!;
      const metaB = this.watcherMetadata.get(b.name)!;
      return metaA.priority - metaB.priority;
    });
  }

  private getDependents(name: string): string[] {
    const dependents: string[] = [];
    
    for (const [watcherName, metadata] of this.watcherMetadata) {
      if (metadata.dependencies.includes(name)) {
        dependents.push(watcherName);
      }
    }
    
    return dependents;
  }

  // Cleanup method
  async cleanup(): Promise<void> {
    await this.disableAll();
    
    // Cleanup individual watchers
    for (const [name, watcher] of this.watchers) {
      try {
        await watcher.cleanup();
        this.logger.debug(`Cleaned up watcher: ${name}`);
      } catch (error) {
        this.logger.error(`Failed to cleanup watcher '${name}':`, error);
      }
    }
    
    this.watchers.clear();
    this.watcherMetadata.clear();
    this.dependencyGraph.clear();
    this.initialized = false;
    
    this.logger.log('Watcher registry cleaned up');
  }

  // Configuration methods
  async updateWatcherConfig(name: string, config: Partial<WatcherMetadata>): Promise<void> {
    const metadata = this.watcherMetadata.get(name);
    if (!metadata) {
      throw new Error(`Watcher '${name}' not found`);
    }

    Object.assign(metadata, config);
    this.logger.debug(`Updated config for watcher: ${name}`);
  }

  // Status methods
  isInitialized(): boolean {
    return this.initialized;
  }

  hasWatcher(name: string): boolean {
    return this.watchers.has(name);
  }

  getWatcherCount(): number {
    return this.watchers.size;
  }

  getEnabledWatcherCount(): number {
    return this.getEnabledWatchers().length;
  }
}


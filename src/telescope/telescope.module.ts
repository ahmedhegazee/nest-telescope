import { Module, DynamicModule, Logger } from '@nestjs/common';
import { DevtoolsModule } from '@nestjs/devtools-integration';
import { ConfigModule } from '@nestjs/config';
import { TelescopeService } from './core/services/telescope.service';
import { DevToolsBridgeService } from './devtools/bridge/devtools-bridge.service';
import { EntryManagerService } from './core/services/entry-manager.service';
import { EnhancedEntryManagerService } from './core/services/enhanced-entry-manager.service';
import { StorageService } from './storage/storage.service';
import { StorageManagerService } from './storage/storage-manager.service';
import { MemoryStorageDriver } from './storage/drivers/memory-storage.driver';
import { FileStorageDriver } from './storage/drivers/file-storage.driver';
import { RedisStorageDriver } from './storage/drivers/redis-storage.driver';
import { WatcherRegistryService } from './watchers/watcher-registry.service';
import { defaultTelescopeConfig, TelescopeConfig } from './core/interfaces/telescope-config.interface';

// Week 7 services and modules
import { AnalyticsService } from './core/services/analytics.service';
import { PerformanceCorrelationService } from './core/services/performance-correlation.service';
import { ExportReportingService } from './core/services/export-reporting.service';
import { JobWatcherService } from './watchers/job/job-watcher.service';
import { CacheWatcherService } from './watchers/cache/cache-watcher.service';
import { BullAdapterService } from './watchers/job/bull-adapter.service';
import { Week7AnalyticsController } from './dashboard/controllers/week7-analytics.controller';

@Module({
  providers: [Logger]
})
export class TelescopeModule {
  static forRoot(config: Partial<TelescopeConfig> = {}): DynamicModule {
    const mergedConfig = { ...defaultTelescopeConfig, ...config };
    
    const imports = [
      // DevTools Integration - FIRST
      DevtoolsModule.register({
        http: mergedConfig.devtools.enabled,
        port: mergedConfig.devtools.port,
      }),
      
      // Configuration
      ConfigModule.forFeature(() => ({
        telescope: mergedConfig
      })),
      
    ];

    // Database storage is not available without TypeORM installation
    
    return {
      module: TelescopeModule,
      imports,
      controllers: [Week7AnalyticsController],
      providers: [
        // Configuration Provider
        {
          provide: 'TELESCOPE_CONFIG',
          useValue: mergedConfig
        },
        
        // Storage Drivers - configured with factory providers
        {
          provide: MemoryStorageDriver,
          useFactory: () => new MemoryStorageDriver()
        },
        {
          provide: FileStorageDriver,
          useFactory: (config: TelescopeConfig) => new FileStorageDriver(config.storage),
          inject: ['TELESCOPE_CONFIG']
        },
        {
          provide: RedisStorageDriver,
          useFactory: (config: TelescopeConfig) => new RedisStorageDriver(config.storage),
          inject: ['TELESCOPE_CONFIG']
        },
        
        // Storage Manager
        StorageManagerService,
        
        // Core Services
        StorageService,
        EntryManagerService,
        EnhancedEntryManagerService,
        TelescopeService,
        DevToolsBridgeService,
        
        // Watcher Registry
        WatcherRegistryService,
        
        // Week 7 Core Services
        AnalyticsService,
        PerformanceCorrelationService,
        ExportReportingService,
        
        // Week 7 Watcher Services
        {
          provide: 'JOB_WATCHER_CONFIG',
          useFactory: (config: TelescopeConfig) => config.watchers?.job || {},
          inject: ['TELESCOPE_CONFIG']
        },
        JobWatcherService,
        BullAdapterService,
        {
          provide: 'CACHE_WATCHER_CONFIG',
          useFactory: (config: TelescopeConfig) => config.watchers?.cache || {},
          inject: ['TELESCOPE_CONFIG']
        },
        CacheWatcherService,
        
        // Logger
        Logger
      ],
      exports: [
        TelescopeService,
        DevToolsBridgeService,
        StorageManagerService,
        WatcherRegistryService,
        AnalyticsService,
        PerformanceCorrelationService,
        ExportReportingService,
        JobWatcherService,
        CacheWatcherService,
        'TELESCOPE_CONFIG'
      ]
    };
  }
}
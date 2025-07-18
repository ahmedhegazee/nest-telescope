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
      }))
    ];

    // Database storage is not available without TypeORM installation
    
    return {
      module: TelescopeModule,
      imports,
      providers: [
        // Configuration Provider
        {
          provide: 'TELESCOPE_CONFIG',
          useValue: mergedConfig
        },
        
        // Storage Drivers
        MemoryStorageDriver,
        FileStorageDriver,
        RedisStorageDriver,
        
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
        
        // Logger
        Logger
      ],
      exports: [
        TelescopeService,
        DevToolsBridgeService,
        StorageManagerService,
        WatcherRegistryService,
        'TELESCOPE_CONFIG'
      ]
    };
  }
}
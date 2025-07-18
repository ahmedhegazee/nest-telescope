import { Module, DynamicModule, Logger } from '@nestjs/common';
import { DevtoolsModule } from '@nestjs/devtools-integration';
import { ConfigModule } from '@nestjs/config';
import { TelescopeService } from './core/services/telescope.service';
import { DevToolsBridgeService } from './devtools/bridge/devtools-bridge.service';
import { EntryManagerService } from './core/services/entry-manager.service';
import { StorageService } from './storage/storage.service';
import { MemoryStorageDriver } from './storage/drivers/memory-storage.driver';
import { defaultTelescopeConfig, TelescopeConfig } from './core/interfaces/telescope-config.interface';

@Module({
  providers: [Logger]
})
export class TelescopeModule {
  static forRoot(config: Partial<TelescopeConfig> = {}): DynamicModule {
    const mergedConfig = { ...defaultTelescopeConfig, ...config };
    
    return {
      module: TelescopeModule,
      imports: [
        // DevTools Integration - FIRST
        DevtoolsModule.register({
          http: mergedConfig.devtools.enabled,
          port: mergedConfig.devtools.port,
        }),
        
        // Configuration
        ConfigModule.forFeature(() => ({
          telescope: mergedConfig
        }))
      ],
      providers: [
        // Configuration Provider
        {
          provide: 'TELESCOPE_CONFIG',
          useValue: mergedConfig
        },
        
        // Storage Drivers
        MemoryStorageDriver,
        
        // Core Services
        StorageService,
        EntryManagerService,
        TelescopeService,
        DevToolsBridgeService,
        
        // Logger
        Logger
      ],
      exports: [
        TelescopeService,
        DevToolsBridgeService,
        'TELESCOPE_CONFIG'
      ]
    };
  }
}
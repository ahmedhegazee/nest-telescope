import { Module, DynamicModule, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelescopeService } from './core/services/telescope.service';
import { EntryManagerService } from './core/services/entry-manager.service';
import { StorageService } from './storage/storage.service';
import { StorageManagerService } from './storage/storage-manager.service';
import { MemoryStorageDriver } from './storage/drivers/memory-storage.driver';
import { FileStorageDriver } from './storage/drivers/file-storage.driver';
import { RedisStorageDriver } from './storage/drivers/redis-storage.driver';
import { WatcherRegistryService } from './watchers/watcher-registry.service';
import {
  defaultTelescopeConfig,
  TelescopeConfig,
} from './core/interfaces/telescope-config.interface';

@Module({
  providers: [Logger],
})
export class TelescopeModule {
  static forRoot(config: Partial<TelescopeConfig> = {}): DynamicModule {
    const mergedConfig = { ...defaultTelescopeConfig, ...config };

    // Build providers conditionally based on configuration and available dependencies
    const providers = this.buildProviders(mergedConfig);
    const imports = this.buildImports(mergedConfig);
    const exports = this.buildExports(mergedConfig);
    const controllers = this.buildControllers(mergedConfig);

    return {
      module: TelescopeModule,
      imports,
      controllers,
      providers,
      exports,
    };
  }

  private static buildImports(config: TelescopeConfig): any[] {
    const imports = [];

    // Configuration
    imports.push(
      ConfigModule.forFeature(() => ({
        telescope: config,
      })),
    );

    return imports;
  }

  private static buildProviders(config: TelescopeConfig): any[] {
    const providers = [];

    // Core Configuration Provider
    providers.push({
      provide: 'TELESCOPE_CONFIG',
      useValue: config,
    });

    // Core Services (always available)
    providers.push(
      StorageService,
      EntryManagerService,
      TelescopeService,
      WatcherRegistryService,
      Logger,
    );

    // Storage Drivers - configured with factory providers
    providers.push(
      {
        provide: MemoryStorageDriver,
        useFactory: () => new MemoryStorageDriver(),
      },
      {
        provide: FileStorageDriver,
        useFactory: (cfg: TelescopeConfig) => new FileStorageDriver(cfg.storage),
        inject: ['TELESCOPE_CONFIG'],
      },
    );

    // Redis Storage (conditional)
    if (this.isDependencyAvailable('redis')) {
      providers.push({
        provide: RedisStorageDriver,
        useFactory: (cfg: TelescopeConfig) => new RedisStorageDriver(cfg.storage),
        inject: ['TELESCOPE_CONFIG'],
      });
    }

    // Storage Manager
    providers.push(StorageManagerService);

    return providers;
  }

  private static buildControllers(config: TelescopeConfig): any[] {
    const controllers: any[] = [];
    return controllers;
  }

  private static buildExports(config: TelescopeConfig): any[] {
    const exports = [
      'TELESCOPE_CONFIG',
      TelescopeService,
      StorageManagerService,
      WatcherRegistryService,
    ];
    return exports;
  }

  private static isFeatureEnabled(config: TelescopeConfig, feature: string): boolean {
    return true;
  }

  private static isDependencyAvailable(dependency: string): boolean {
    try {
      switch (dependency) {
        case 'redis':
          require.resolve('redis');
          return true;
        case 'bull':
          require.resolve('bull');
          return true;
        case 'typeorm':
          require.resolve('typeorm');
          return true;
        case '@nestjs/bull':
          require.resolve('@nestjs/bull');
          return true;
        case 'puppeteer':
          require.resolve('puppeteer');
          return true;
        default:
          return false;
      }
    } catch (error) {
      Logger.warn(`Optional dependency '${dependency}' not available: ${(error as Error).message}`);
      return false;
    }
  }
}

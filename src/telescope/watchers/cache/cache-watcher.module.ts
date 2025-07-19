import { Module, DynamicModule } from '@nestjs/common';
import { CacheWatcherService } from './cache-watcher.service';
import { CacheWatcherConfig, defaultCacheWatcherConfig } from './cache-watcher.config';

@Module({})
export class CacheWatcherModule {
  static forRoot(config: Partial<CacheWatcherConfig> = {}): DynamicModule {
    const cacheWatcherConfig = { ...defaultCacheWatcherConfig, ...config };

    return {
      module: CacheWatcherModule,
      providers: [
        {
          provide: 'CACHE_WATCHER_CONFIG',
          useValue: cacheWatcherConfig,
        },
        CacheWatcherService,
      ],
      exports: [CacheWatcherService],
    };
  }

  static forRootAsync(options: {
    useFactory: (...args: any[]) => Promise<CacheWatcherConfig> | CacheWatcherConfig;
    inject?: any[];
  }): DynamicModule {
    return {
      module: CacheWatcherModule,
      providers: [
        {
          provide: 'CACHE_WATCHER_CONFIG',
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        CacheWatcherService,
      ],
      exports: [CacheWatcherService],
    };
  }
}
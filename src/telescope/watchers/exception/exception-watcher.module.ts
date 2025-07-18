import { Module, DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ExceptionWatcherService } from './exception-watcher.service';
import { ExceptionWatcherFilter } from './exception-watcher.filter';
import { ExceptionWatcherConfig, defaultExceptionWatcherConfig } from './exception-watcher.config';

@Module({})
export class ExceptionWatcherModule {
  static forRoot(config: Partial<ExceptionWatcherConfig> = {}): DynamicModule {
    const exceptionWatcherConfig = { ...defaultExceptionWatcherConfig, ...config };

    return {
      module: ExceptionWatcherModule,
      providers: [
        {
          provide: 'EXCEPTION_WATCHER_CONFIG',
          useValue: exceptionWatcherConfig,
        },
        ExceptionWatcherService,
        {
          provide: APP_FILTER,
          useClass: ExceptionWatcherFilter,
        },
      ],
      exports: [ExceptionWatcherService],
    };
  }

  static forRootAsync(options: {
    useFactory: (...args: any[]) => Promise<ExceptionWatcherConfig> | ExceptionWatcherConfig;
    inject?: any[];
  }): DynamicModule {
    return {
      module: ExceptionWatcherModule,
      providers: [
        {
          provide: 'EXCEPTION_WATCHER_CONFIG',
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        ExceptionWatcherService,
        {
          provide: APP_FILTER,
          useClass: ExceptionWatcherFilter,
        },
      ],
      exports: [ExceptionWatcherService],
    };
  }
}
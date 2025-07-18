import { Module, DynamicModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RequestWatcherService } from './request-watcher.service';
import { RequestWatcherInterceptor } from './request-watcher.interceptor';
import { RequestMetricsService } from './request-metrics.service';
import { RequestSessionTracker } from './request-session-tracker.service';
import { TelescopeService } from '../../core/services/telescope.service';
import { TelescopeConfig } from '../../core/interfaces/telescope-config.interface';

@Module({})
export class RequestWatcherModule {
  static forRoot(config: TelescopeConfig): DynamicModule {
    const providers = [
      RequestWatcherService,
      RequestMetricsService,
      RequestSessionTracker,
      {
        provide: APP_INTERCEPTOR,
        useClass: RequestWatcherInterceptor,
      },
    ];

    return {
      module: RequestWatcherModule,
      providers,
      exports: [RequestWatcherService, RequestMetricsService, RequestSessionTracker],
    };
  }
}
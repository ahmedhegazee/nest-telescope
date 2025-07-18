import { Module, DynamicModule, OnModuleInit } from '@nestjs/common';
import { QueryWatcherService } from './query-watcher.service';
import { QueryWatcherInterceptor } from './query-watcher.interceptor';
import { QueryAnalyzerService } from './query-analyzer.service';
import { ConnectionPoolMonitorService } from './connection-pool-monitor.service';
import { QueryMetricsService } from './query-metrics.service';
import { TelescopeService } from '../../core/services/telescope.service';
import { TelescopeConfig } from '../../core/interfaces/telescope-config.interface';
import { QueryWatcherConfig } from './query-watcher.config';
import { DataSource } from 'typeorm';

@Module({})
export class QueryWatcherModule implements OnModuleInit {
  constructor(
    private readonly queryInterceptor: QueryWatcherInterceptor,
    private readonly connectionMonitor: ConnectionPoolMonitorService
  ) {}

  static forRoot(config: QueryWatcherConfig): DynamicModule {
    const providers = [
      QueryWatcherService,
      QueryWatcherInterceptor,
      QueryAnalyzerService,
      ConnectionPoolMonitorService,
      QueryMetricsService,
      {
        provide: 'QUERY_WATCHER_CONFIG',
        useValue: config,
      },
    ];

    return {
      module: QueryWatcherModule,
      providers,
      exports: [
        QueryWatcherService,
        QueryAnalyzerService,
        ConnectionPoolMonitorService,
        QueryMetricsService,
      ],
    };
  }

  async onModuleInit(): Promise<void> {
    // Initialize query interception
    await this.queryInterceptor.setupInterception();
    
    // Connection pool monitoring is initialized via OnModuleInit lifecycle
  }
}
import { Module, DynamicModule } from '@nestjs/common';
import { JobWatcherService } from './job-watcher.service';
import { BullAdapterService } from './bull-adapter.service';
import { JobWatcherConfig, defaultJobWatcherConfig } from './job-watcher.config';

@Module({})
export class JobWatcherModule {
  static forRoot(config: Partial<JobWatcherConfig> = {}): DynamicModule {
    const jobWatcherConfig = { ...defaultJobWatcherConfig, ...config };

    return {
      module: JobWatcherModule,
      providers: [
        {
          provide: 'JOB_WATCHER_CONFIG',
          useValue: jobWatcherConfig,
        },
        JobWatcherService,
        BullAdapterService,
      ],
      exports: [JobWatcherService, BullAdapterService],
    };
  }

  static forRootAsync(options: {
    useFactory: (...args: any[]) => Promise<JobWatcherConfig> | JobWatcherConfig;
    inject?: any[];
  }): DynamicModule {
    return {
      module: JobWatcherModule,
      providers: [
        {
          provide: 'JOB_WATCHER_CONFIG',
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        JobWatcherService,
        BullAdapterService,
      ],
      exports: [JobWatcherService, BullAdapterService],
    };
  }
}
# Week 7: Job & Cache Monitoring

**Complete monitoring coverage with Bull/BullMQ job watcher, cache operations monitoring, performance correlation, advanced analytics, and export/reporting capabilities.**

## Overview

Week 7 implements comprehensive monitoring for job queues and cache operations, providing complete visibility into your application's asynchronous operations and data access patterns. This includes advanced analytics, performance correlation across all watchers, and flexible export/reporting capabilities.

## Features Implemented

### 1. Job Watcher (Bull/BullMQ Integration)
- **Queue Monitoring**: Track job execution across all Bull/BullMQ queues
- **Performance Metrics**: Monitor job execution times, failure rates, and queue health
- **Bull Adapter**: Automatic discovery and integration with Bull/BullMQ instances
- **Real-time Updates**: Live job status updates and performance streaming

### 2. Cache Watcher (Redis Monitoring)
- **Operation Tracking**: Monitor cache hits, misses, and operations
- **Performance Analysis**: Track cache response times and efficiency
- **Key Pattern Analysis**: Identify frequently accessed keys and patterns
- **Health Monitoring**: Track cache instance health and performance

### 3. Performance Correlation Service
- **Cross-Watcher Correlation**: Link requests, queries, jobs, cache operations, and exceptions
- **Bottleneck Detection**: Identify performance bottlenecks across system components
- **Recommendation Engine**: Generate optimization recommendations
- **Health Scoring**: Calculate system health scores based on performance metrics

### 4. Advanced Analytics Service
- **User Analytics**: Track user behavior and activity patterns
- **Performance Analytics**: Comprehensive performance analysis with trends
- **Error Analytics**: Error pattern analysis and anomaly detection
- **System Health**: Overall system health scoring and monitoring

### 5. Export & Reporting Service
- **Data Export**: Export monitoring data in JSON, CSV, and PDF formats
- **Report Generation**: Generate comprehensive reports in HTML and PDF
- **Flexible Filtering**: Filter by date range, user, type, and custom criteria
- **Automated Reporting**: Support for scheduled report generation

## Installation & Setup

### 1. Basic Setup

```typescript
import { Module } from '@nestjs/common';
import { TelescopeModule } from '@telescope/core';

@Module({
  imports: [
    TelescopeModule.forRoot({
      // Enable Week 7 features
      watchers: {
        job: {
          enabled: true,
          trackJobExecution: true,
          enablePerformanceTracking: true,
          slowJobThreshold: 5000, // 5 seconds
          alertThresholds: {
            failureRate: 10, // 10%
            avgExecutionTime: 10000, // 10 seconds
          },
        },
        cache: {
          enabled: true,
          trackCacheOperations: true,
          enablePerformanceTracking: true,
          slowOperationThreshold: 100, // 100ms
          alertThresholds: {
            hitRate: 80, // 80%
            avgResponseTime: 50, // 50ms
          },
        },
      },
      // Enable advanced features
      enablePerformanceCorrelation: true,
      enableAdvancedAnalytics: true,
      enableExportReporting: true,
    }),
  ],
})
export class AppModule {}
```

### 2. Job Watcher Configuration

```typescript
import { JobWatcherModule } from '@telescope/watchers/job';

@Module({
  imports: [
    JobWatcherModule.forRoot({
      enabled: true,
      trackJobExecution: true,
      enablePerformanceTracking: true,
      enableAlerts: true,
      
      // Bull/BullMQ Integration
      bullIntegration: {
        enabled: true,
        autoDiscoverQueues: true,
        trackJobProgress: true,
        trackJobResults: true,
      },
      
      // Performance Thresholds
      slowJobThreshold: 5000, // 5 seconds
      maxJobExecutionTime: 300000, // 5 minutes
      
      // Alert Configuration
      alertThresholds: {
        failureRate: 10, // 10%
        avgExecutionTime: 10000, // 10 seconds
        queueSize: 1000, // 1000 jobs
        stalledJobs: 5, // 5 stalled jobs
        timeWindow: 300000, // 5 minutes
      },
      
      // Data Retention
      maxHistorySize: 10000,
      retentionPeriod: 86400000, // 24 hours
      
      // Filtering
      excludeJobTypes: ['maintenance', 'cleanup'],
      includeJobTypes: [], // Empty = include all
      sampleRate: 1.0, // 100% sampling
    }),
  ],
})
export class AppModule {}
```

### 3. Cache Watcher Configuration

```typescript
import { CacheWatcherModule } from '@telescope/watchers/cache';

@Module({
  imports: [
    CacheWatcherModule.forRoot({
      enabled: true,
      trackCacheOperations: true,
      enablePerformanceTracking: true,
      enableAlerts: true,
      
      // Operation Tracking
      trackHitMiss: true,
      trackOperationTime: true,
      captureValues: false, // Security: don't capture values by default
      
      // Performance Thresholds
      slowOperationThreshold: 100, // 100ms
      maxOperationTime: 5000, // 5 seconds
      
      // Alert Configuration
      alertThresholds: {
        hitRate: 80, // 80%
        missRate: 20, // 20%
        avgResponseTime: 50, // 50ms
        errorRate: 5, // 5%
        memoryUsage: 80, // 80%
        connectionCount: 100, // 100 connections
        timeWindow: 300000, // 5 minutes
      },
      
      // Data Sanitization
      sanitizeKeys: true,
      sanitizeValues: true,
      maxKeyLength: 200,
      maxValueSize: 1024, // 1KB
      sensitiveKeyPatterns: ['auth:*', 'session:*', 'token:*'],
      
      // Filtering
      excludeOperations: [], // Empty = include all
      excludeKeyPatterns: ['temp:*', 'debug:*'],
      includeKeyPatterns: [], // Empty = include all
      sampleRate: 1.0, // 100% sampling
    }),
  ],
})
export class AppModule {}
```

## Usage Examples

### 1. Job Monitoring

```typescript
import { Injectable } from '@nestjs/common';
import { JobWatcherService } from '@telescope/watchers/job';

@Injectable()
export class JobService {
  constructor(private jobWatcher: JobWatcherService) {}

  // Monitor job execution
  async processJob(jobData: any): Promise<void> {
    const context = {
      id: `job-${Date.now()}`,
      jobId: jobData.id,
      queueName: 'email-queue',
      jobName: 'send-email',
      timestamp: new Date(),
      status: 'active',
      priority: 1,
      attempts: 1,
      maxAttempts: 3,
      data: jobData,
    };

    // Track job start
    this.jobWatcher.trackJob(context);

    try {
      // Process job
      await this.sendEmail(jobData);
      
      // Track job completion
      this.jobWatcher.trackJob({
        ...context,
        status: 'completed',
        duration: Date.now() - context.timestamp.getTime(),
        result: { success: true },
      });
    } catch (error) {
      // Track job failure
      this.jobWatcher.trackJob({
        ...context,
        status: 'failed',
        duration: Date.now() - context.timestamp.getTime(),
        error: { message: error.message, stack: error.stack },
      });
    }
  }

  // Get job metrics
  async getJobMetrics() {
    const metrics = this.jobWatcher.getMetrics();
    return {
      totalJobs: metrics.totalJobs,
      completedJobs: metrics.completedJobs,
      failedJobs: metrics.failedJobs,
      averageExecutionTime: metrics.averageExecutionTime,
      failureRate: metrics.failureRate,
      topFailedJobs: metrics.topFailedJobs,
    };
  }

  // Get queue health
  async getQueueHealth(queueName: string) {
    return this.jobWatcher.getQueueHealth(queueName);
  }
}
```

### 2. Cache Monitoring

```typescript
import { Injectable } from '@nestjs/common';
import { CacheWatcherService } from '@telescope/watchers/cache';

@Injectable()
export class CacheService {
  constructor(private cacheWatcher: CacheWatcherService) {}

  // Track cache operations
  async get(key: string): Promise<any> {
    const startTime = Date.now();
    
    try {
      const value = await this.redis.get(key);
      const duration = Date.now() - startTime;
      
      // Track cache operation
      this.cacheWatcher.trackCacheOperation({
        id: `cache-${Date.now()}`,
        timestamp: new Date(),
        operation: 'get',
        key,
        value,
        hit: value !== null,
        startTime: new Date(startTime),
        duration,
        cacheInstance: 'redis-primary',
      });
      
      return value;
    } catch (error) {
      // Track cache error
      this.cacheWatcher.trackCacheOperation({
        id: `cache-${Date.now()}`,
        timestamp: new Date(),
        operation: 'get',
        key,
        hit: false,
        startTime: new Date(startTime),
        duration: Date.now() - startTime,
        error: { message: error.message, code: 'CACHE_ERROR' },
        cacheInstance: 'redis-primary',
      });
      
      throw error;
    }
  }

  // Get cache metrics
  async getCacheMetrics() {
    const metrics = this.cacheWatcher.getMetrics();
    return {
      totalOperations: metrics.totalOperations,
      hitCount: metrics.hitCount,
      missCount: metrics.missCount,
      hitRate: metrics.hitRate,
      averageResponseTime: metrics.averageResponseTime,
      topKeyPatterns: metrics.topKeyPatterns,
    };
  }

  // Get cache health
  async getCacheHealth(instance?: string) {
    return this.cacheWatcher.getCacheHealth(instance);
  }
}
```

### 3. Performance Correlation

```typescript
import { Injectable } from '@nestjs/common';
import { PerformanceCorrelationService } from '@telescope/core/services';

@Injectable()
export class PerformanceService {
  constructor(
    private performanceCorrelation: PerformanceCorrelationService,
  ) {}

  // Get correlated performance data
  async getPerformanceCorrelation(traceId: string) {
    return this.performanceCorrelation.getCorrelationsByTraceId(traceId);
  }

  // Get performance metrics
  async getPerformanceMetrics() {
    const metrics = this.performanceCorrelation.getMetrics();
    return {
      totalRequests: metrics.totalRequests,
      averageResponseTime: metrics.averageResponseTime,
      errorRate: metrics.errorRate,
      bottlenecks: metrics.bottlenecks,
      correlations: metrics.correlations,
    };
  }

  // Get bottlenecks by component
  async getBottlenecks(component: string) {
    return this.performanceCorrelation.getBottlenecksByComponent(component);
  }

  // Get recent correlations
  async getRecentCorrelations(limit: number = 10) {
    return this.performanceCorrelation.getRecentCorrelations(limit);
  }
}
```

### 4. Advanced Analytics

```typescript
import { Injectable } from '@nestjs/common';
import { AnalyticsService } from '@telescope/core/services';

@Injectable()
export class DashboardService {
  constructor(private analytics: AnalyticsService) {}

  // Get comprehensive analytics
  async getAnalytics(startDate?: Date, endDate?: Date) {
    const analytics = this.analytics.getAnalytics(startDate, endDate);
    
    return {
      user: {
        totalUsers: analytics.userAnalytics.totalUsers,
        activeUsers: analytics.userAnalytics.activeUsers,
        topUsers: analytics.userAnalytics.topUsers,
      },
      performance: {
        averageResponseTime: analytics.performanceAnalytics.averageResponseTime,
        totalRequests: analytics.performanceAnalytics.totalRequests,
        slowestEndpoints: analytics.performanceAnalytics.slowestEndpoints,
        performanceDistribution: analytics.performanceAnalytics.performanceDistribution,
        trends: analytics.performanceAnalytics.trends,
      },
      errors: {
        totalErrors: analytics.errorAnalytics.totalErrors,
        errorsByType: analytics.errorAnalytics.errorsByType,
        topErrors: analytics.errorAnalytics.topErrors,
        anomalies: analytics.errorAnalytics.anomalies,
      },
      system: {
        healthScore: analytics.systemHealth.score,
        status: analytics.systemHealth.status,
        recommendations: analytics.systemHealth.recommendations,
      },
    };
  }

  // Get performance trends
  async getPerformanceTrends() {
    const analytics = this.analytics.getAnalytics();
    return analytics.performanceAnalytics.trends;
  }

  // Get error analysis
  async getErrorAnalysis() {
    const analytics = this.analytics.getAnalytics();
    return analytics.errorAnalytics;
  }
}
```

### 5. Export & Reporting

```typescript
import { Injectable } from '@nestjs/common';
import { ExportReportingService, ExportFormat, ReportFormat } from '@telescope/core/services';

@Injectable()
export class ReportingService {
  constructor(private exportReporting: ExportReportingService) {}

  // Export data
  async exportData(options: {
    format: ExportFormat;
    types: string[];
    startDate?: Date;
    endDate?: Date;
    userId?: string;
    limit?: number;
  }) {
    return this.exportReporting.exportData(options);
  }

  // Generate performance report
  async generatePerformanceReport(format: ReportFormat = ReportFormat.HTML) {
    return this.exportReporting.generateReport({
      type: 'performance',
      format,
      title: 'Performance Analysis Report',
      includeCharts: true,
      includeTables: true,
      includeRecommendations: true,
    });
  }

  // Generate user activity report
  async generateUserActivityReport(format: ReportFormat = ReportFormat.PDF) {
    return this.exportReporting.generateReport({
      type: 'user-activity',
      format,
      title: 'User Activity Report',
      includeCharts: true,
      includeTables: true,
    });
  }

  // Generate error analysis report
  async generateErrorReport(format: ReportFormat = ReportFormat.HTML) {
    return this.exportReporting.generateReport({
      type: 'error-analysis',
      format,
      title: 'Error Analysis Report',
      includeCharts: true,
      includeTables: true,
      includeRecommendations: true,
    });
  }

  // Generate system health report
  async generateSystemHealthReport(format: ReportFormat = ReportFormat.PDF) {
    return this.exportReporting.generateReport({
      type: 'system-health',
      format,
      title: 'System Health Report',
      includeCharts: true,
      includeTables: true,
      includeRecommendations: true,
    });
  }
}
```

## API Endpoints

### 1. Job Monitoring Endpoints

```typescript
import { Controller, Get, Param, Query } from '@nestjs/common';
import { JobWatcherService } from '@telescope/watchers/job';

@Controller('telescope/jobs')
export class JobController {
  constructor(private jobWatcher: JobWatcherService) {}

  @Get('metrics')
  async getMetrics() {
    return this.jobWatcher.getMetrics();
  }

  @Get('recent')
  async getRecentJobs(@Query('limit') limit: number = 50) {
    return this.jobWatcher.getRecentJobs(limit);
  }

  @Get('queue/:queueName')
  async getJobsByQueue(@Param('queueName') queueName: string) {
    return this.jobWatcher.getJobsByQueue(queueName);
  }

  @Get('health/:queueName')
  async getQueueHealth(@Param('queueName') queueName: string) {
    return this.jobWatcher.getQueueHealth(queueName);
  }
}
```

### 2. Cache Monitoring Endpoints

```typescript
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CacheWatcherService } from '@telescope/watchers/cache';

@Controller('telescope/cache')
export class CacheController {
  constructor(private cacheWatcher: CacheWatcherService) {}

  @Get('metrics')
  async getMetrics() {
    return this.cacheWatcher.getMetrics();
  }

  @Get('recent')
  async getRecentOperations(@Query('limit') limit: number = 50) {
    return this.cacheWatcher.getRecentOperations(limit);
  }

  @Get('health/:instance?')
  async getCacheHealth(@Param('instance') instance?: string) {
    return this.cacheWatcher.getCacheHealth(instance);
  }
}
```

### 3. Analytics Endpoints

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from '@telescope/core/services';

@Controller('telescope/analytics')
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  @Get()
  async getAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.analytics.getAnalytics(start, end);
  }

  @Get('performance')
  async getPerformanceAnalytics() {
    const analytics = this.analytics.getAnalytics();
    return analytics.performanceAnalytics;
  }

  @Get('users')
  async getUserAnalytics() {
    const analytics = this.analytics.getAnalytics();
    return analytics.userAnalytics;
  }

  @Get('errors')
  async getErrorAnalytics() {
    const analytics = this.analytics.getAnalytics();
    return analytics.errorAnalytics;
  }
}
```

### 4. Export & Reporting Endpoints

```typescript
import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ExportReportingService, ExportFormat, ReportFormat } from '@telescope/core/services';

@Controller('telescope/export')
export class ExportController {
  constructor(private exportReporting: ExportReportingService) {}

  @Get('data')
  async exportData(
    @Query('format') format: ExportFormat,
    @Query('types') types: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('userId') userId?: string,
    @Query('limit') limit?: number,
    @Res() res?: Response,
  ) {
    const result = await this.exportReporting.exportData({
      format,
      types: types.split(','),
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      userId,
      limit: limit ? parseInt(limit) : undefined,
    });

    if (res) {
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.data);
    }

    return result;
  }

  @Get('report')
  async generateReport(
    @Query('type') type: string,
    @Query('format') format: ReportFormat,
    @Query('title') title?: string,
    @Res() res?: Response,
  ) {
    const result = await this.exportReporting.generateReport({
      type,
      format,
      title,
      includeCharts: true,
      includeTables: true,
      includeRecommendations: true,
    });

    if (res) {
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.content);
    }

    return result;
  }
}
```

## Performance Optimization

### 1. Job Monitoring Optimization

```typescript
// Optimize job tracking with sampling
const jobWatcherConfig = {
  sampleRate: 0.1, // Track 10% of jobs
  maxHistorySize: 5000, // Limit memory usage
  excludeJobTypes: ['maintenance', 'cleanup'], // Exclude low-priority jobs
  enableBatching: true, // Batch job updates
  batchSize: 100,
  batchInterval: 5000, // 5 seconds
};
```

### 2. Cache Monitoring Optimization

```typescript
// Optimize cache tracking
const cacheWatcherConfig = {
  sampleRate: 0.5, // Track 50% of operations
  captureValues: false, // Don't capture values for performance
  maxValueSize: 100, // Limit value size
  excludeKeyPatterns: ['temp:*', 'session:*'], // Exclude temporary keys
  enableBatching: true,
  batchSize: 200,
  batchInterval: 3000, // 3 seconds
};
```

### 3. Performance Correlation Optimization

```typescript
// Optimize correlation processing
const correlationConfig = {
  maxActiveTraces: 10000, // Limit active traces
  correlationTimeout: 30000, // 30 seconds
  enableBatching: true,
  batchSize: 50,
  batchInterval: 2000, // 2 seconds
  enableCaching: true,
  cacheSize: 1000,
  cacheTTL: 300000, // 5 minutes
};
```

## Security Considerations

### 1. Data Sanitization

```typescript
// Configure data sanitization
const securityConfig = {
  sanitizeKeys: true,
  sanitizeValues: true,
  sensitiveKeyPatterns: [
    'auth:*',
    'session:*',
    'token:*',
    'password:*',
    'secret:*',
  ],
  sensitiveFields: [
    'password',
    'token',
    'secret',
    'key',
    'auth',
    'session',
  ],
  maxKeyLength: 200,
  maxValueSize: 1024,
};
```

### 2. Access Control

```typescript
// Secure telescope endpoints
@Controller('telescope')
@UseGuards(AuthGuard, AdminGuard)
export class TelescopeController {
  // Only admin users can access telescope data
}
```

## Best Practices

### 1. Job Monitoring
- Use appropriate sampling rates for high-volume queues
- Exclude maintenance and cleanup jobs from monitoring
- Set realistic alerting thresholds
- Monitor queue health regularly
- Track job failure patterns

### 2. Cache Monitoring
- Don't capture sensitive values
- Use key pattern analysis for optimization
- Monitor hit/miss ratios
- Set appropriate alert thresholds
- Track cache instance health

### 3. Performance Correlation
- Use trace IDs for request correlation
- Limit active trace tracking
- Set appropriate correlation timeouts
- Monitor bottleneck patterns
- Act on performance recommendations

### 4. Analytics & Reporting
- Schedule regular report generation
- Use appropriate date ranges for analysis
- Export data for external analysis
- Monitor system health trends
- Set up automated alerting

## Integration with Existing Systems

### 1. Bull/BullMQ Integration

```typescript
// Automatic Bull integration
import { BullModule } from '@nestjs/bull';
import { JobWatcherModule } from '@telescope/watchers/job';

@Module({
  imports: [
    BullModule.forRoot({
      redis: {
        host: 'localhost',
        port: 6379,
      },
    }),
    BullModule.registerQueue({
      name: 'email-queue',
    }),
    JobWatcherModule.forRoot({
      bullIntegration: {
        enabled: true,
        autoDiscoverQueues: true,
      },
    }),
  ],
})
export class AppModule {}
```

### 2. Redis Integration

```typescript
// Redis cache integration
import { CacheModule } from '@nestjs/cache-manager';
import { CacheWatcherModule } from '@telescope/watchers/cache';

@Module({
  imports: [
    CacheModule.register({
      store: 'redis',
      host: 'localhost',
      port: 6379,
    }),
    CacheWatcherModule.forRoot({
      redisIntegration: {
        enabled: true,
        autoDiscoverInstances: true,
      },
    }),
  ],
})
export class AppModule {}
```

## Troubleshooting

### Common Issues

1. **High Memory Usage**: Reduce history size and sampling rate
2. **Performance Impact**: Enable batching and increase batch intervals
3. **Missing Job Data**: Check Bull/BullMQ integration configuration
4. **Cache Monitoring Issues**: Verify Redis connection and permissions
5. **Export Failures**: Check file system permissions and disk space

### Debugging

```typescript
// Enable debug logging
const telescopeConfig = {
  debug: true,
  logLevel: 'verbose',
  enableMetrics: true,
  enableHealthChecks: true,
};
```

## Migration Guide

### From Week 6 to Week 7

1. **Install New Dependencies**:
   ```bash
   npm install @telescope/watchers
   ```

2. **Update Configuration**:
   ```typescript
   // Add new watcher configurations
   const config = {
     watchers: {
       job: { enabled: true },
       cache: { enabled: true },
     },
     enablePerformanceCorrelation: true,
     enableAdvancedAnalytics: true,
   };
   ```

3. **Update Imports**:
   ```typescript
   import { JobWatcherModule } from '@telescope/watchers/job';
   import { CacheWatcherModule } from '@telescope/watchers/cache';
   ```

4. **Test Integration**:
   ```bash
   npm test -- --testNamePattern="Week 7"
   ```

## Conclusion

Week 7 provides comprehensive monitoring coverage for your NestJS application, including job queues, cache operations, performance correlation, advanced analytics, and flexible export/reporting capabilities. This completes the core monitoring functionality and provides a solid foundation for production deployment.

The implementation includes extensive testing, security considerations, performance optimizations, and integration guidelines to ensure reliable operation in production environments.
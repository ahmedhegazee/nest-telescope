/**
 * Week 7 Examples: Job & Cache Monitoring
 * 
 * This file contains comprehensive examples for implementing and using
 * the Week 7 features: Job Watcher, Cache Watcher, Performance Correlation,
 * Advanced Analytics, and Export/Reporting capabilities.
 */

import { Module, Injectable, Controller, Get, Post, Body, Query, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { BullModule, Process, Processor } from '@nestjs/bull';
import { CacheModule, CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';

// Import Week 7 modules and services
import { JobWatcherModule, JobWatcherService } from '@telescope/watchers/job';
import { CacheWatcherModule, CacheWatcherService } from '@telescope/watchers/cache';
import { 
  PerformanceCorrelationService,
  AnalyticsService,
  ExportReportingService,
  ExportFormat,
  ReportFormat
} from '@telescope/core/services';

// =============================================================================
// 1. COMPLETE APPLICATION SETUP
// =============================================================================

@Module({
  imports: [
    // Bull/BullMQ Setup
    BullModule.forRoot({
      redis: {
        host: 'localhost',
        port: 6379,
      },
    }),
    BullModule.registerQueue({
      name: 'email-queue',
    }),
    BullModule.registerQueue({
      name: 'image-processing-queue',
    }),
    
    // Cache Setup
    CacheModule.register({
      store: 'redis',
      host: 'localhost',
      port: 6379,
      ttl: 3600, // 1 hour
    }),
    
    // Week 7 Telescope Modules
    JobWatcherModule.forRoot({
      enabled: true,
      trackJobExecution: true,
      enablePerformanceTracking: true,
      enableAlerts: true,
      
      // Bull Integration
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
        queueSize: 1000,
        stalledJobs: 5,
        timeWindow: 300000, // 5 minutes
      },
      
      // Filtering and Sampling
      excludeJobTypes: ['maintenance', 'cleanup'],
      sampleRate: 1.0, // 100% sampling for demo
    }),
    
    CacheWatcherModule.forRoot({
      enabled: true,
      trackCacheOperations: true,
      enablePerformanceTracking: true,
      enableAlerts: true,
      
      // Security Settings
      captureValues: false, // Don't capture values for security
      sanitizeKeys: true,
      sanitizeValues: true,
      
      // Performance Thresholds
      slowOperationThreshold: 100, // 100ms
      maxOperationTime: 5000, // 5 seconds
      
      // Alert Configuration
      alertThresholds: {
        hitRate: 80, // 80%
        avgResponseTime: 50, // 50ms
        errorRate: 5, // 5%
        timeWindow: 300000, // 5 minutes
      },
      
      // Key Pattern Filtering
      excludeKeyPatterns: ['temp:*', 'debug:*'],
      sensitiveKeyPatterns: ['auth:*', 'session:*', 'token:*'],
    }),
  ],
  providers: [
    EmailService,
    ImageProcessingService,
    UserService,
    MonitoringService,
    ReportingService,
    AnalyticsService,
    ExportReportingService,
    PerformanceCorrelationService,
  ],
  controllers: [
    JobController,
    CacheController,
    AnalyticsController,
    ExportController,
    DemoController,
  ],
})
export class Week7ExampleModule {}

// =============================================================================
// 2. JOB PROCESSING WITH MONITORING
// =============================================================================

@Injectable()
export class EmailService {
  constructor(
    @Inject('BullQueue_email-queue') private emailQueue: any,
    private jobWatcher: JobWatcherService,
  ) {}

  // Add email job to queue
  async sendEmail(emailData: {
    to: string;
    subject: string;
    body: string;
    userId?: string;
  }) {
    const job = await this.emailQueue.add('send-email', emailData, {
      priority: 1,
      attempts: 3,
      backoff: 'exponential',
    });

    // Track job creation
    this.jobWatcher.trackJob({
      id: `email-job-${job.id}`,
      jobId: job.id,
      queueName: 'email-queue',
      jobName: 'send-email',
      timestamp: new Date(),
      status: 'waiting',
      priority: 1,
      attempts: 0,
      maxAttempts: 3,
      data: { to: emailData.to, subject: emailData.subject },
      userId: emailData.userId,
    });

    return job;
  }

  // Get email queue metrics
  async getEmailMetrics() {
    const metrics = this.jobWatcher.getMetrics();
    const queueHealth = this.jobWatcher.getQueueHealth('email-queue');
    
    return {
      queue: 'email-queue',
      metrics: {
        totalJobs: metrics.totalJobs,
        completedJobs: metrics.completedJobs,
        failedJobs: metrics.failedJobs,
        averageExecutionTime: metrics.averageExecutionTime,
        failureRate: metrics.failureRate,
      },
      health: queueHealth,
    };
  }
}

@Processor('email-queue')
export class EmailProcessor {
  constructor(private jobWatcher: JobWatcherService) {}

  @Process('send-email')
  async handleSendEmail(job: any) {
    const startTime = Date.now();
    
    try {
      // Track job start
      this.jobWatcher.trackJob({
        id: `email-job-${job.id}`,
        jobId: job.id,
        queueName: 'email-queue',
        jobName: 'send-email',
        timestamp: new Date(),
        status: 'active',
        priority: job.opts.priority || 1,
        attempts: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts || 3,
        data: job.data,
        userId: job.data.userId,
      });

      // Simulate email sending
      await this.simulateEmailSending(job.data);
      
      const duration = Date.now() - startTime;
      
      // Track job completion
      this.jobWatcher.trackJob({
        id: `email-job-${job.id}`,
        jobId: job.id,
        queueName: 'email-queue',
        jobName: 'send-email',
        timestamp: new Date(),
        status: 'completed',
        priority: job.opts.priority || 1,
        attempts: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts || 3,
        duration,
        result: { success: true, sentAt: new Date() },
        userId: job.data.userId,
      });

      return { success: true, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Track job failure
      this.jobWatcher.trackJob({
        id: `email-job-${job.id}`,
        jobId: job.id,
        queueName: 'email-queue',
        jobName: 'send-email',
        timestamp: new Date(),
        status: 'failed',
        priority: job.opts.priority || 1,
        attempts: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts || 3,
        duration,
        error: {
          message: error.message,
          stack: error.stack,
          code: 'EMAIL_SEND_ERROR',
        },
        userId: job.data.userId,
      });

      throw error;
    }
  }

  private async simulateEmailSending(data: any): Promise<void> {
    // Simulate variable processing time
    const delay = Math.random() * 3000 + 1000; // 1-4 seconds
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Simulate occasional failures
    if (Math.random() < 0.1) { // 10% failure rate
      throw new Error('SMTP server timeout');
    }
  }
}

// =============================================================================
// 3. CACHE OPERATIONS WITH MONITORING
// =============================================================================

@Injectable()
export class UserService {
  constructor(
    @Inject(CACHE_MANAGER) private cache: Cache,
    private cacheWatcher: CacheWatcherService,
  ) {}

  // Get user with cache monitoring
  async getUser(userId: string): Promise<any> {
    const cacheKey = `user:${userId}`;
    const startTime = Date.now();
    
    try {
      // Try to get from cache first
      const cachedUser = await this.cache.get(cacheKey);
      const duration = Date.now() - startTime;
      
      if (cachedUser) {
        // Track cache hit
        this.cacheWatcher.trackCacheOperation({
          id: `cache-${Date.now()}`,
          timestamp: new Date(),
          operation: 'get',
          key: cacheKey,
          value: cachedUser,
          hit: true,
          startTime: new Date(startTime),
          duration,
          cacheInstance: 'redis-primary',
          userId,
        });
        
        return cachedUser;
      }
      
      // Cache miss - fetch from database
      const user = await this.fetchUserFromDatabase(userId);
      
      // Track cache miss
      this.cacheWatcher.trackCacheOperation({
        id: `cache-${Date.now()}`,
        timestamp: new Date(),
        operation: 'get',
        key: cacheKey,
        hit: false,
        startTime: new Date(startTime),
        duration,
        cacheInstance: 'redis-primary',
        userId,
      });
      
      // Store in cache
      await this.setUserCache(userId, user);
      
      return user;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Track cache error
      this.cacheWatcher.trackCacheOperation({
        id: `cache-${Date.now()}`,
        timestamp: new Date(),
        operation: 'get',
        key: cacheKey,
        hit: false,
        startTime: new Date(startTime),
        duration,
        error: {
          message: error.message,
          code: 'CACHE_ERROR',
        },
        cacheInstance: 'redis-primary',
        userId,
      });
      
      throw error;
    }
  }

  // Set user in cache with monitoring
  async setUserCache(userId: string, user: any): Promise<void> {
    const cacheKey = `user:${userId}`;
    const startTime = Date.now();
    
    try {
      await this.cache.set(cacheKey, user, 3600); // 1 hour TTL
      const duration = Date.now() - startTime;
      
      // Track cache set operation
      this.cacheWatcher.trackCacheOperation({
        id: `cache-${Date.now()}`,
        timestamp: new Date(),
        operation: 'set',
        key: cacheKey,
        value: user,
        hit: false, // Set operations are not hits
        startTime: new Date(startTime),
        duration,
        cacheInstance: 'redis-primary',
        userId,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Track cache error
      this.cacheWatcher.trackCacheOperation({
        id: `cache-${Date.now()}`,
        timestamp: new Date(),
        operation: 'set',
        key: cacheKey,
        value: user,
        hit: false,
        startTime: new Date(startTime),
        duration,
        error: {
          message: error.message,
          code: 'CACHE_SET_ERROR',
        },
        cacheInstance: 'redis-primary',
        userId,
      });
      
      throw error;
    }
  }

  // Delete user from cache with monitoring
  async deleteUserCache(userId: string): Promise<void> {
    const cacheKey = `user:${userId}`;
    const startTime = Date.now();
    
    try {
      await this.cache.del(cacheKey);
      const duration = Date.now() - startTime;
      
      // Track cache delete operation
      this.cacheWatcher.trackCacheOperation({
        id: `cache-${Date.now()}`,
        timestamp: new Date(),
        operation: 'del',
        key: cacheKey,
        hit: false,
        startTime: new Date(startTime),
        duration,
        cacheInstance: 'redis-primary',
        userId,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Track cache error
      this.cacheWatcher.trackCacheOperation({
        id: `cache-${Date.now()}`,
        timestamp: new Date(),
        operation: 'del',
        key: cacheKey,
        hit: false,
        startTime: new Date(startTime),
        duration,
        error: {
          message: error.message,
          code: 'CACHE_DELETE_ERROR',
        },
        cacheInstance: 'redis-primary',
        userId,
      });
      
      throw error;
    }
  }

  // Get cache metrics
  async getCacheMetrics() {
    const metrics = this.cacheWatcher.getMetrics();
    const health = this.cacheWatcher.getCacheHealth('redis-primary');
    
    return {
      instance: 'redis-primary',
      metrics: {
        totalOperations: metrics.totalOperations,
        hitCount: metrics.hitCount,
        missCount: metrics.missCount,
        hitRate: metrics.hitRate,
        averageResponseTime: metrics.averageResponseTime,
        topKeyPatterns: metrics.topKeyPatterns,
      },
      health,
    };
  }

  private async fetchUserFromDatabase(userId: string): Promise<any> {
    // Simulate database fetch
    const delay = Math.random() * 500 + 100; // 100-600ms
    await new Promise(resolve => setTimeout(resolve, delay));
    
    return {
      id: userId,
      name: `User ${userId}`,
      email: `user${userId}@example.com`,
      createdAt: new Date(),
      lastLogin: new Date(),
    };
  }
}

// =============================================================================
// 4. PERFORMANCE CORRELATION AND ANALYTICS
// =============================================================================

@Injectable()
export class MonitoringService {
  constructor(
    private performanceCorrelation: PerformanceCorrelationService,
    private analytics: AnalyticsService,
  ) {}

  // Get comprehensive performance overview
  async getPerformanceOverview() {
    const correlationMetrics = this.performanceCorrelation.getMetrics();
    const analytics = this.analytics.getAnalytics();
    
    return {
      correlation: {
        totalRequests: correlationMetrics.totalRequests,
        averageResponseTime: correlationMetrics.averageResponseTime,
        errorRate: correlationMetrics.errorRate,
        bottlenecks: correlationMetrics.bottlenecks,
      },
      analytics: {
        users: analytics.userAnalytics,
        performance: analytics.performanceAnalytics,
        errors: analytics.errorAnalytics,
        systemHealth: analytics.systemHealth,
      },
    };
  }

  // Get bottleneck analysis
  async getBottleneckAnalysis() {
    const databaseBottlenecks = this.performanceCorrelation.getBottlenecksByComponent('database');
    const cacheBottlenecks = this.performanceCorrelation.getBottlenecksByComponent('cache');
    const jobBottlenecks = this.performanceCorrelation.getBottlenecksByComponent('job');
    
    return {
      database: databaseBottlenecks,
      cache: cacheBottlenecks,
      jobs: jobBottlenecks,
      recommendations: this.generateRecommendations(databaseBottlenecks, cacheBottlenecks, jobBottlenecks),
    };
  }

  // Get recent performance correlations
  async getRecentCorrelations(limit: number = 10) {
    return this.performanceCorrelation.getRecentCorrelations(limit);
  }

  // Get performance correlation by trace ID
  async getCorrelationByTraceId(traceId: string) {
    return this.performanceCorrelation.getCorrelationsByTraceId(traceId);
  }

  // Generate performance recommendations
  private generateRecommendations(dbBottlenecks: any[], cacheBottlenecks: any[], jobBottlenecks: any[]): string[] {
    const recommendations = [];
    
    if (dbBottlenecks.length > 0) {
      recommendations.push('Consider optimizing database queries or adding indexes');
      recommendations.push('Review slow queries and consider query optimization');
    }
    
    if (cacheBottlenecks.length > 0) {
      recommendations.push('Review cache hit rates and consider cache warming strategies');
      recommendations.push('Consider increasing cache TTL for frequently accessed data');
    }
    
    if (jobBottlenecks.length > 0) {
      recommendations.push('Review job processing times and consider job optimization');
      recommendations.push('Consider scaling job workers or optimizing job logic');
    }
    
    return recommendations;
  }
}

// =============================================================================
// 5. REPORTING AND EXPORT SERVICE
// =============================================================================

@Injectable()
export class ReportingService {
  constructor(
    private exportReporting: ExportReportingService,
    private analytics: AnalyticsService,
  ) {}

  // Generate daily performance report
  async generateDailyReport(date: Date = new Date()) {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);
    
    return this.exportReporting.generateReport({
      type: 'performance',
      format: ReportFormat.HTML,
      title: `Daily Performance Report - ${date.toDateString()}`,
      startDate,
      endDate,
      includeCharts: true,
      includeTables: true,
      includeRecommendations: true,
    });
  }

  // Generate weekly system health report
  async generateWeeklyHealthReport() {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    
    return this.exportReporting.generateReport({
      type: 'system-health',
      format: ReportFormat.PDF,
      title: 'Weekly System Health Report',
      startDate,
      endDate,
      includeCharts: true,
      includeTables: true,
      includeRecommendations: true,
    });
  }

  // Export user activity data
  async exportUserActivity(startDate: Date, endDate: Date, format: ExportFormat = ExportFormat.CSV) {
    return this.exportReporting.exportData({
      format,
      types: ['request', 'query', 'cache', 'job'],
      startDate,
      endDate,
      fields: ['id', 'type', 'timestamp', 'userId', 'content'],
    });
  }

  // Export error analysis data
  async exportErrorAnalysis(startDate: Date, endDate: Date) {
    return this.exportReporting.exportData({
      format: ExportFormat.JSON,
      types: ['exception'],
      startDate,
      endDate,
      fields: ['id', 'timestamp', 'content'],
    });
  }
}

// =============================================================================
// 6. REST API CONTROLLERS
// =============================================================================

@Controller('api/telescope/jobs')
export class JobController {
  constructor(
    private jobWatcher: JobWatcherService,
    private emailService: EmailService,
  ) {}

  @Get('metrics')
  async getJobMetrics() {
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

  @Post('email')
  async sendEmail(@Body() emailData: any) {
    return this.emailService.sendEmail(emailData);
  }

  @Get('email/metrics')
  async getEmailMetrics() {
    return this.emailService.getEmailMetrics();
  }
}

@Controller('api/telescope/cache')
export class CacheController {
  constructor(
    private cacheWatcher: CacheWatcherService,
    private userService: UserService,
  ) {}

  @Get('metrics')
  async getCacheMetrics() {
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

  @Get('user/:userId')
  async getUser(@Param('userId') userId: string) {
    return this.userService.getUser(userId);
  }

  @Get('user/metrics')
  async getUserCacheMetrics() {
    return this.userService.getCacheMetrics();
  }
}

@Controller('api/telescope/analytics')
export class AnalyticsController {
  constructor(
    private analytics: AnalyticsService,
    private monitoring: MonitoringService,
  ) {}

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
  async getPerformanceOverview() {
    return this.monitoring.getPerformanceOverview();
  }

  @Get('bottlenecks')
  async getBottleneckAnalysis() {
    return this.monitoring.getBottleneckAnalysis();
  }

  @Get('correlations')
  async getRecentCorrelations(@Query('limit') limit: number = 10) {
    return this.monitoring.getRecentCorrelations(limit);
  }

  @Get('correlation/:traceId')
  async getCorrelation(@Param('traceId') traceId: string) {
    return this.monitoring.getCorrelationByTraceId(traceId);
  }
}

@Controller('api/telescope/export')
export class ExportController {
  constructor(
    private reporting: ReportingService,
    private exportReporting: ExportReportingService,
  ) {}

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

  @Get('report/daily')
  async generateDailyReport(
    @Query('date') date?: string,
    @Res() res?: Response,
  ) {
    const reportDate = date ? new Date(date) : new Date();
    const result = await this.reporting.generateDailyReport(reportDate);

    if (res) {
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.content);
    }

    return result;
  }

  @Get('report/weekly')
  async generateWeeklyReport(@Res() res?: Response) {
    const result = await this.reporting.generateWeeklyHealthReport();

    if (res) {
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.content);
    }

    return result;
  }

  @Get('user-activity')
  async exportUserActivity(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('format') format: ExportFormat = ExportFormat.CSV,
    @Res() res?: Response,
  ) {
    const result = await this.reporting.exportUserActivity(
      new Date(startDate),
      new Date(endDate),
      format,
    );

    if (res) {
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.data);
    }

    return result;
  }
}

// =============================================================================
// 7. DEMO CONTROLLER FOR TESTING
// =============================================================================

@Controller('api/demo')
export class DemoController {
  constructor(
    private emailService: EmailService,
    private userService: UserService,
    private monitoring: MonitoringService,
  ) {}

  @Post('load-test')
  async runLoadTest(@Body() options: {
    requests?: number;
    jobs?: number;
    users?: number;
    duration?: number;
  }) {
    const {
      requests = 100,
      jobs = 50,
      users = 20,
      duration = 60000, // 1 minute
    } = options;

    const startTime = Date.now();
    const promises = [];

    // Generate requests
    for (let i = 0; i < requests; i++) {
      promises.push(
        this.userService.getUser(`user-${i % users}`).catch(() => null)
      );
    }

    // Generate jobs
    for (let i = 0; i < jobs; i++) {
      promises.push(
        this.emailService.sendEmail({
          to: `user${i % users}@example.com`,
          subject: `Test Email ${i}`,
          body: `This is test email ${i}`,
          userId: `user-${i % users}`,
        }).catch(() => null)
      );
    }

    // Wait for all operations to complete or timeout
    await Promise.allSettled(promises);

    const endTime = Date.now();
    const actualDuration = endTime - startTime;

    return {
      success: true,
      duration: actualDuration,
      requests: requests,
      jobs: jobs,
      users: users,
      summary: await this.monitoring.getPerformanceOverview(),
    };
  }

  @Get('simulate-errors')
  async simulateErrors() {
    const errors = [];

    // Simulate various error scenarios
    for (let i = 0; i < 10; i++) {
      try {
        if (i % 3 === 0) {
          throw new Error('Database connection timeout');
        } else if (i % 3 === 1) {
          throw new Error('Cache server unavailable');
        } else {
          throw new Error('Job processing failed');
        }
      } catch (error) {
        errors.push({
          type: error.message,
          timestamp: new Date(),
        });
      }
    }

    return {
      success: true,
      errorsSimulated: errors.length,
      errors,
    };
  }

  @Get('health-check')
  async healthCheck() {
    const jobMetrics = await this.emailService.getEmailMetrics();
    const cacheMetrics = await this.userService.getCacheMetrics();
    const performanceOverview = await this.monitoring.getPerformanceOverview();

    return {
      status: 'healthy',
      timestamp: new Date(),
      jobs: jobMetrics,
      cache: cacheMetrics,
      performance: performanceOverview,
    };
  }
}

// =============================================================================
// 8. CONFIGURATION EXAMPLES
// =============================================================================

/**
 * Production Configuration Example
 */
export const productionConfig = {
  jobWatcher: {
    enabled: true,
    sampleRate: 0.1, // 10% sampling in production
    maxHistorySize: 5000,
    excludeJobTypes: ['maintenance', 'cleanup', 'backup'],
    alertThresholds: {
      failureRate: 5, // 5% failure rate
      avgExecutionTime: 30000, // 30 seconds
      queueSize: 10000,
      stalledJobs: 10,
    },
  },
  cacheWatcher: {
    enabled: true,
    sampleRate: 0.05, // 5% sampling in production
    captureValues: false, // Never capture values in production
    maxHistorySize: 10000,
    excludeKeyPatterns: ['session:*', 'temp:*', 'debug:*'],
    alertThresholds: {
      hitRate: 85, // 85% hit rate
      avgResponseTime: 25, // 25ms
      errorRate: 2, // 2% error rate
    },
  },
  performanceCorrelation: {
    maxActiveTraces: 5000,
    correlationTimeout: 60000, // 1 minute
    enableBatching: true,
    batchSize: 100,
    batchInterval: 5000,
  },
  analytics: {
    enableCaching: true,
    cacheSize: 1000,
    cacheTTL: 300000, // 5 minutes
    enableTrends: true,
    enableAnomalyDetection: true,
  },
  export: {
    maxRecordsPerExport: 100000,
    enableCompression: true,
    enableEncryption: true,
    retentionPeriod: 2592000000, // 30 days
  },
};

/**
 * Development Configuration Example
 */
export const developmentConfig = {
  jobWatcher: {
    enabled: true,
    sampleRate: 1.0, // 100% sampling in development
    maxHistorySize: 1000,
    excludeJobTypes: [],
    alertThresholds: {
      failureRate: 20, // 20% failure rate (more lenient)
      avgExecutionTime: 60000, // 1 minute
      queueSize: 1000,
      stalledJobs: 5,
    },
  },
  cacheWatcher: {
    enabled: true,
    sampleRate: 1.0, // 100% sampling in development
    captureValues: true, // Capture values for debugging
    maxHistorySize: 2000,
    excludeKeyPatterns: [],
    alertThresholds: {
      hitRate: 70, // 70% hit rate (more lenient)
      avgResponseTime: 100, // 100ms
      errorRate: 10, // 10% error rate
    },
  },
  performanceCorrelation: {
    maxActiveTraces: 1000,
    correlationTimeout: 30000, // 30 seconds
    enableBatching: false, // Disable batching for real-time debugging
  },
  analytics: {
    enableCaching: false, // Disable caching for real-time data
    enableTrends: true,
    enableAnomalyDetection: true,
  },
  export: {
    maxRecordsPerExport: 10000,
    enableCompression: false,
    enableEncryption: false,
    retentionPeriod: 86400000, // 1 day
  },
};

export { Week7ExampleModule };
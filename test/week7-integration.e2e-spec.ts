import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Redis } from 'ioredis';

// Import Week 7 modules and services
import { TelescopeModule } from '../src/telescope/telescope.module';
import { JobWatcherService } from '../src/telescope/watchers/job/job-watcher.service';
import { CacheWatcherService } from '../src/telescope/watchers/cache/cache-watcher.service';
import { AnalyticsService } from '../src/telescope/core/services/analytics.service';
import { PerformanceCorrelationService } from '../src/telescope/core/services/performance-correlation.service';
import { ExportReportingService } from '../src/telescope/core/services/export-reporting.service';
import { Week7AnalyticsController } from '../src/telescope/dashboard/controllers/week7-analytics.controller';

describe('Week 7 Integration Tests (e2e)', () => {
  let app: INestApplication;
  let jobWatcherService: JobWatcherService;
  let cacheWatcherService: CacheWatcherService;
  let analyticsService: AnalyticsService;
  let performanceCorrelationService: PerformanceCorrelationService;
  let exportReportingService: ExportReportingService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TelescopeModule.forRoot({
          watchers: {
            job: {
              enabled: true,
              trackJobExecution: true,
              enablePerformanceTracking: true,
              slowJobThreshold: 1000,
              alertThresholds: {
                failureRate: 10,
                avgExecutionTime: 5000,
                queueSize: 100,
                stalledJobs: 5,
                timeWindow: 300000,
              },
            },
            cache: {
              enabled: true,
              trackCacheOperations: true,
              enablePerformanceTracking: true,
              slowOperationThreshold: 100,
              alertThresholds: {
                hitRate: 80,
                missRate: 20,
                avgResponseTime: 50,
                errorRate: 5,
                memoryUsage: 80,
                connectionCount: 100,
                timeWindow: 300000,
              },
              redisIntegration: {
                enabled: true,
                autoDiscoverInstances: false, // Disable for testing
                monitorCommands: true,
                trackSlowQueries: true,
                slowQueryThreshold: 100,
                trackMemoryUsage: true,
                trackConnectionPool: true,
              },
            },
          },
          enablePerformanceCorrelation: true,
          enableAdvancedAnalytics: true,
          enableExportReporting: true,
        }),
      ],
      controllers: [Week7AnalyticsController],
    }).compile();

    app = moduleFixture.createNestApplication();
    
    // Get service instances
    jobWatcherService = moduleFixture.get<JobWatcherService>(JobWatcherService);
    cacheWatcherService = moduleFixture.get<CacheWatcherService>(CacheWatcherService);
    analyticsService = moduleFixture.get<AnalyticsService>(AnalyticsService);
    performanceCorrelationService = moduleFixture.get<PerformanceCorrelationService>(PerformanceCorrelationService);
    exportReportingService = moduleFixture.get<ExportReportingService>(ExportReportingService);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Job Watcher Integration', () => {
    it('should track job execution', async () => {
      const jobContext = {
        id: 'test-job-1',
        jobId: 'job-123',
        queueName: 'test-queue',
        jobName: 'test-job',
        timestamp: new Date(),
        status: 'active' as any,
        priority: 1,
        attempts: 1,
        maxAttempts: 3,
        startTime: new Date(),
        traceId: 'trace-123',
      };

      // Track job start
      jobWatcherService.trackJob(jobContext);

      // Complete the job
      jobWatcherService.trackJob({
        ...jobContext,
        status: 'completed' as any,
        endTime: new Date(),
        duration: 1500,
        result: { success: true },
      });

      const metrics = jobWatcherService.getMetrics();
      expect(metrics.totalJobs).toBeGreaterThan(0);
      expect(metrics.completedJobs).toBeGreaterThan(0);
    });

    it('should provide job metrics via API', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/jobs/metrics')
        .expect(200);

      expect(response.body).toHaveProperty('totalJobs');
      expect(response.body).toHaveProperty('completedJobs');
      expect(response.body).toHaveProperty('failedJobs');
      expect(response.body).toHaveProperty('averageExecutionTime');
      expect(response.body).toHaveProperty('healthScore');
    });

    it('should get recent jobs', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/jobs/recent?limit=10')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should get queue health', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/jobs/health')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Cache Watcher Integration', () => {
    it('should track cache operations', async () => {
      const cacheContext = {
        id: 'cache-op-1',
        timestamp: new Date(),
        operation: 'get' as any,
        key: 'test:key:123',
        hit: true,
        startTime: new Date(),
        duration: 25,
        cacheInstance: 'redis-test',
        cacheType: 'redis',
        traceId: 'trace-123',
      };

      cacheWatcherService.trackCacheOperation(cacheContext);

      const metrics = cacheWatcherService.getMetrics();
      expect(metrics.totalOperations).toBeGreaterThan(0);
      expect(metrics.hitCount).toBeGreaterThan(0);
    });

    it('should provide cache metrics via API', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/cache/metrics')
        .expect(200);

      expect(response.body).toHaveProperty('totalOperations');
      expect(response.body).toHaveProperty('hitCount');
      expect(response.body).toHaveProperty('missCount');
      expect(response.body).toHaveProperty('hitRate');
      expect(response.body).toHaveProperty('averageResponseTime');
    });

    it('should get recent cache operations', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/cache/recent?limit=10')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should get cache health', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/cache/health')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Performance Correlation Integration', () => {
    it('should correlate watcher data', async () => {
      const testData = {
        traceId: 'correlation-test-123',
        requestId: 'req-123',
        userId: 'user-123',
        duration: 1500,
        responseStatus: 200,
      };

      // Simulate request data
      performanceCorrelationService.correlateWatcherData('request', testData);
      
      // Simulate query data
      performanceCorrelationService.correlateWatcherData('query', {
        ...testData,
        duration: 500,
        table: 'users',
      });

      // Simulate cache data
      performanceCorrelationService.correlateWatcherData('cache', {
        ...testData,
        duration: 25,
        hit: true,
      });

      const metrics = performanceCorrelationService.getMetrics();
      expect(metrics.totalRequests).toBeGreaterThanOrEqual(0);
    });

    it('should provide performance metrics via API', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/correlation/metrics')
        .expect(200);

      expect(response.body).toHaveProperty('totalRequests');
      expect(response.body).toHaveProperty('averageResponseTime');
      expect(response.body).toHaveProperty('errorRate');
    });

    it('should get recent correlations', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/correlation/recent?limit=10')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should get active traces', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/correlation/active-traces')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Advanced Analytics Integration', () => {
    it('should provide comprehensive analytics', async () => {
      const analytics = analyticsService.getAnalytics();

      expect(analytics).toHaveProperty('timestamp');
      expect(analytics).toHaveProperty('overview');
      expect(analytics).toHaveProperty('performance');
      expect(analytics).toHaveProperty('errors');
      expect(analytics).toHaveProperty('database');
      expect(analytics).toHaveProperty('cache');
      expect(analytics).toHaveProperty('jobs');
      expect(analytics).toHaveProperty('users');
      expect(analytics).toHaveProperty('trends');
      expect(analytics).toHaveProperty('alerts');
    });

    it('should provide analytics via API', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/advanced')
        .expect(200);

      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('overview');
      expect(response.body.overview).toHaveProperty('totalRequests');
      expect(response.body.overview).toHaveProperty('totalErrors');
      expect(response.body.overview).toHaveProperty('averageResponseTime');
    });

    it('should provide time-range analytics', async () => {
      const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const end = new Date();
      
      const response = await request(app.getHttpServer())
        .get(`/telescope/analytics/advanced?startDate=${start.toISOString()}&endDate=${end.toISOString()}`)
        .expect(200);

      expect(response.body).toHaveProperty('timeRange');
    });

    it('should provide specific analytics sections', async () => {
      // Test performance analytics
      const perfResponse = await request(app.getHttpServer())
        .get('/telescope/analytics/advanced/performance')
        .expect(200);
      expect(perfResponse.body).toHaveProperty('responseTimeDistribution');

      // Test error analytics
      const errorResponse = await request(app.getHttpServer())
        .get('/telescope/analytics/advanced/errors')
        .expect(200);
      expect(errorResponse.body).toHaveProperty('errorDistribution');

      // Test user analytics
      const userResponse = await request(app.getHttpServer())
        .get('/telescope/analytics/advanced/users')
        .expect(200);
      expect(userResponse.body).toHaveProperty('activeUsers');

      // Test trends
      const trendsResponse = await request(app.getHttpServer())
        .get('/telescope/analytics/advanced/trends')
        .expect(200);
      expect(trendsResponse.body).toHaveProperty('trafficTrends');
    });
  });

  describe('Export & Reporting Integration', () => {
    it('should export data in JSON format', async () => {
      const exportData = {
        format: 'json',
        type: 'analytics',
        timeRange: {
          start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          end: new Date().toISOString(),
        },
        includeMetadata: true,
      };

      const response = await request(app.getHttpServer())
        .post('/telescope/analytics/export/data')
        .send(exportData)
        .expect(200);

      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('metadata');
      expect(response.body.metadata).toHaveProperty('recordCount');
    });

    it('should export data in CSV format', async () => {
      const exportData = {
        format: 'csv',
        type: 'raw',
        limit: 100,
      };

      const response = await request(app.getHttpServer())
        .post('/telescope/analytics/export/data')
        .send(exportData)
        .expect(200);

      expect(response.body).toHaveProperty('success');
    });

    it('should generate performance report', async () => {
      const reportData = {
        type: 'performance',
        title: 'Test Performance Report',
        timeRange: {
          start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          end: new Date().toISOString(),
        },
        format: 'html',
        includeCharts: true,
      };

      const response = await request(app.getHttpServer())
        .post('/telescope/analytics/export/report')
        .send(reportData)
        .expect(200);

      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('metadata');
      expect(response.body.metadata).toHaveProperty('title');
    });

    it('should get export history', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/export/history')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should get report templates', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/export/templates')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('System Health & Dashboard Integration', () => {
    it('should provide comprehensive system health overview', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/health/overview')
        .expect(200);

      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('jobs');
      expect(response.body).toHaveProperty('cache');
      expect(response.body).toHaveProperty('performance');
      expect(response.body).toHaveProperty('system');

      expect(response.body.jobs).toHaveProperty('healthScore');
      expect(response.body.cache).toHaveProperty('hitRate');
      expect(response.body.performance).toHaveProperty('averageResponseTime');
      expect(response.body.system).toHaveProperty('totalRequests');
    });

    it('should provide comprehensive dashboard data', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/dashboard/data')
        .expect(200);

      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('jobs');
      expect(response.body).toHaveProperty('cache');
      expect(response.body).toHaveProperty('analytics');
      expect(response.body).toHaveProperty('correlation');

      // Verify nested structure
      expect(response.body.jobs).toHaveProperty('metrics');
      expect(response.body.jobs).toHaveProperty('recentJobs');
      expect(response.body.jobs).toHaveProperty('queueHealth');

      expect(response.body.cache).toHaveProperty('metrics');
      expect(response.body.cache).toHaveProperty('recentOperations');
      expect(response.body.cache).toHaveProperty('health');

      expect(response.body.analytics).toHaveProperty('overview');
      expect(response.body.analytics).toHaveProperty('performance');
      expect(response.body.analytics).toHaveProperty('trends');

      expect(response.body.correlation).toHaveProperty('metrics');
      expect(response.body.correlation).toHaveProperty('recentCorrelations');
    });

    it('should acknowledge alerts', async () => {
      const alertId = 'test-alert-123';
      
      const response = await request(app.getHttpServer())
        .post(`/telescope/analytics/alerts/${alertId}/acknowledge`)
        .expect(200);

      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('alertId', alertId);
      expect(response.body).toHaveProperty('acknowledgedAt');
    });
  });

  describe('Real-time Streams', () => {
    it('should provide job metrics stream', (done) => {
      const stream = jobWatcherService.getMetricsStream();
      
      const subscription = stream.subscribe({
        next: (metrics) => {
          expect(metrics).toHaveProperty('totalJobs');
          expect(metrics).toHaveProperty('healthScore');
          subscription.unsubscribe();
          done();
        },
        error: done,
      });

      // Trigger an update by tracking a job
      jobWatcherService.trackJob({
        id: 'stream-test-job',
        jobId: 'job-stream',
        queueName: 'stream-queue',
        jobName: 'stream-test',
        timestamp: new Date(),
        status: 'completed' as any,
        priority: 1,
        attempts: 1,
        maxAttempts: 3,
        duration: 100,
      });
    });

    it('should provide cache metrics stream', (done) => {
      const stream = cacheWatcherService.getMetricsStream();
      
      const subscription = stream.subscribe({
        next: (metrics) => {
          expect(metrics).toHaveProperty('totalOperations');
          expect(metrics).toHaveProperty('hitRate');
          subscription.unsubscribe();
          done();
        },
        error: done,
      });

      // Trigger an update by tracking a cache operation
      cacheWatcherService.trackCacheOperation({
        id: 'stream-cache-op',
        timestamp: new Date(),
        operation: 'get' as any,
        key: 'stream:test',
        hit: true,
        startTime: new Date(),
        duration: 10,
      });
    });

    it('should provide analytics stream', (done) => {
      const stream = analyticsService.getAnalyticsStream();
      
      const subscription = stream.subscribe({
        next: (analytics) => {
          expect(analytics).toHaveProperty('timestamp');
          expect(analytics).toHaveProperty('overview');
          subscription.unsubscribe();
          done();
        },
        error: done,
      });

      // The analytics service should emit updates periodically
      setTimeout(() => {
        subscription.unsubscribe();
        done();
      }, 6000); // Wait for periodic update
    });
  });

  describe('Error Handling & Edge Cases', () => {
    it('should handle invalid export format', async () => {
      const exportData = {
        format: 'invalid',
        type: 'analytics',
      };

      const response = await request(app.getHttpServer())
        .post('/telescope/analytics/export/data')
        .send(exportData)
        .expect(400);
    });

    it('should handle missing trace ID in correlation lookup', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/correlation/trace/nonexistent')
        .expect(200);

      expect(response.body).toBeNull();
    });

    it('should handle invalid time range in analytics', async () => {
      const response = await request(app.getHttpServer())
        .get('/telescope/analytics/advanced?startDate=invalid&endDate=invalid')
        .expect(400);
    });
  });

  describe('Performance Tests', () => {
    it('should handle high volume job tracking', async () => {
      const startTime = Date.now();
      const jobCount = 1000;

      for (let i = 0; i < jobCount; i++) {
        jobWatcherService.trackJob({
          id: `perf-job-${i}`,
          jobId: `job-${i}`,
          queueName: 'perf-queue',
          jobName: 'perf-test',
          timestamp: new Date(),
          status: 'completed' as any,
          priority: 1,
          attempts: 1,
          maxAttempts: 3,
          duration: Math.random() * 1000,
        });
      }

      const endTime = Date.now();
      const processingTime = endTime - startTime;
      
      expect(processingTime).toBeLessThan(5000); // Should process 1000 jobs in under 5 seconds
      
      const metrics = jobWatcherService.getMetrics();
      expect(metrics.totalJobs).toBeGreaterThanOrEqual(jobCount);
    });

    it('should handle high volume cache operations', async () => {
      const startTime = Date.now();
      const opCount = 1000;

      for (let i = 0; i < opCount; i++) {
        cacheWatcherService.trackCacheOperation({
          id: `perf-cache-${i}`,
          timestamp: new Date(),
          operation: 'get' as any,
          key: `perf:key:${i}`,
          hit: Math.random() > 0.3, // 70% hit rate
          startTime: new Date(),
          duration: Math.random() * 100,
        });
      }

      const endTime = Date.now();
      const processingTime = endTime - startTime;
      
      expect(processingTime).toBeLessThan(5000); // Should process 1000 operations in under 5 seconds
      
      const metrics = cacheWatcherService.getMetrics();
      expect(metrics.totalOperations).toBeGreaterThanOrEqual(opCount);
    });
  });
});
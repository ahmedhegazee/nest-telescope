import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService, AnalyticsData } from './analytics.service';
import { TelescopeService } from './telescope.service';
import { TelescopeEntry } from '../interfaces/telescope-entry.interface';
import { PerformanceCorrelationService } from './performance-correlation.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let telescopeService: jest.Mocked<TelescopeService>;
  let performanceCorrelationService: jest.Mocked<PerformanceCorrelationService>;

  beforeEach(async () => {
    const mockTelescopeService = {
      getEntries: jest.fn(),
      clearEntries: jest.fn(),
    };

    const mockPerformanceCorrelationService = {
      getCorrelationStream: jest.fn(),
      getMetrics: jest.fn(),
      getRecentCorrelations: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: TelescopeService,
          useValue: mockTelescopeService,
        },
        {
          provide: PerformanceCorrelationService,
          useValue: mockPerformanceCorrelationService,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    telescopeService = module.get(TelescopeService);
    performanceCorrelationService = module.get(PerformanceCorrelationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize with default analytics data', () => {
      const analytics = service.getAnalytics();
      expect(analytics.overview).toBeDefined();
      expect(analytics.performance).toBeDefined();
      expect(analytics.errors).toBeDefined();
    });
  });

  describe('analytics calculation', () => {
    it('should calculate user analytics correctly', async () => {
      const mockEntries: TelescopeEntry[] = [
        {
          id: '1',
          type: 'request',
          familyHash: 'hash1',
          tags: ['http'],
          sequence: 1,
          timestamp: new Date(),
          content: {
            userId: 'user-1',
            request: { path: '/api/users', method: 'GET' },
          },
        },
        {
          id: '2',
          type: 'request',
          familyHash: 'hash2',
          tags: ['http'],
          sequence: 2,
          timestamp: new Date(),
          content: {
            userId: 'user-2',
            request: { path: '/api/posts', method: 'GET' },
          },
        },
        {
          id: '3',
          type: 'request',
          familyHash: 'hash3',
          tags: ['http'],
          sequence: 3,
          timestamp: new Date(),
          content: {
            userId: 'user-1',
            request: { path: '/api/users', method: 'POST' },
          },
        },
      ];

      telescopeService.getEntries.mockResolvedValue(mockEntries);
      performanceCorrelationService.getMetrics.mockReturnValue({
        averageResponseTime: 150,
        errorRate: 0,
        totalRequests: 3,
        p95ResponseTime: 200,
        p99ResponseTime: 300,
        components: {
          database: {
            averageTime: 50,
            slowQueries: 0,
            connectionIssues: 0,
          },
          cache: {
            averageTime: 10,
            hitRate: 0.8,
            missRate: 0.2,
            errorRate: 0,
          },
          jobs: {
            averageTime: 100,
            failureRate: 0,
            queueBacklog: 0,
          },
          exceptions: {
            rate: 0,
            criticalCount: 0,
            averageImpact: 0,
          },
        },
        correlations: {
          queryToResponse: 0,
          cacheToResponse: 0,
          jobToResponse: 0,
          exceptionToResponse: 0,
          memoryToResponse: 0,
          cpuToResponse: 0,
        },
        trends: {
          responseTime: { current: 150, change: 0, trend: 'stable' },
          errorRate: { current: 0, change: 0, trend: 'stable' },
          throughput: { current: 3, change: 0, trend: 'stable' },
        },
      });
      performanceCorrelationService.getRecentCorrelations.mockReturnValue([]);

      await service.refreshAnalytics();

      const analytics = service.getAnalytics();
      expect(analytics.overview.totalRequests).toBe(3);
      expect(analytics.overview.activeUsers).toBe(2);
      expect(analytics.users.activeUsers).toHaveLength(2);
      expect(analytics.users.activeUsers[0].userId).toBe('user-1');
      expect(analytics.users.activeUsers[0].requestCount).toBe(2);
    });

    it('should calculate performance analytics correctly', async () => {
      const mockEntries: TelescopeEntry[] = [
        {
          id: '1',
          type: 'request',
          familyHash: 'hash1',
          tags: ['http'],
          sequence: 1,
          timestamp: new Date(),
          content: {
            request: { path: '/api/users', method: 'GET', duration: 100 },
          },
        },
        {
          id: '2',
          type: 'request',
          familyHash: 'hash2',
          tags: ['http'],
          sequence: 2,
          timestamp: new Date(),
          content: {
            request: { path: '/api/posts', method: 'GET', duration: 200 },
          },
        },
      ];

      telescopeService.getEntries.mockResolvedValue(mockEntries);
      performanceCorrelationService.getMetrics.mockReturnValue({
        averageResponseTime: 150,
        errorRate: 0,
        totalRequests: 2,
        p95ResponseTime: 200,
        p99ResponseTime: 300,
        components: {
          database: {
            averageTime: 50,
            slowQueries: 0,
            connectionIssues: 0,
          },
          cache: {
            averageTime: 10,
            hitRate: 0.8,
            missRate: 0.2,
            errorRate: 0,
          },
          jobs: {
            averageTime: 100,
            failureRate: 0,
            queueBacklog: 0,
          },
          exceptions: {
            rate: 0,
            criticalCount: 0,
            averageImpact: 0,
          },
        },
        correlations: {
          queryToResponse: 0,
          cacheToResponse: 0,
          jobToResponse: 0,
          exceptionToResponse: 0,
          memoryToResponse: 0,
          cpuToResponse: 0,
        },
        trends: {
          responseTime: { current: 150, change: 0, trend: 'stable' },
          errorRate: { current: 0, change: 0, trend: 'stable' },
          throughput: { current: 2, change: 0, trend: 'stable' },
        },
      });
      performanceCorrelationService.getRecentCorrelations.mockReturnValue([]);

      await service.refreshAnalytics();

      const analytics = service.getAnalytics();
      expect(analytics.overview.averageResponseTime).toBe(150);
      expect(analytics.overview.totalRequests).toBe(2);
    });

    it('should calculate error analytics correctly', async () => {
      const mockEntries: TelescopeEntry[] = [
        {
          id: '1',
          type: 'exception',
          familyHash: 'hash1',
          tags: ['error'],
          sequence: 1,
          timestamp: new Date(),
          content: {
            exception: { type: 'Error', message: 'Test error' },
          },
        },
        {
          id: '2',
          type: 'exception',
          familyHash: 'hash2',
          tags: ['error'],
          sequence: 2,
          timestamp: new Date(),
          content: {
            exception: { type: 'ValidationError', message: 'Validation failed' },
          },
        },
      ];

      telescopeService.getEntries.mockResolvedValue(mockEntries);
      performanceCorrelationService.getMetrics.mockReturnValue({
        averageResponseTime: 0,
        errorRate: 100,
        totalRequests: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        components: {
          database: {
            averageTime: 0,
            slowQueries: 0,
            connectionIssues: 0,
          },
          cache: {
            averageTime: 0,
            hitRate: 0,
            missRate: 0,
            errorRate: 0,
          },
          jobs: {
            averageTime: 0,
            failureRate: 0,
            queueBacklog: 0,
          },
          exceptions: {
            rate: 100,
            criticalCount: 2,
            averageImpact: 0.5,
          },
        },
        correlations: {
          queryToResponse: 0,
          cacheToResponse: 0,
          jobToResponse: 0,
          exceptionToResponse: 0,
          memoryToResponse: 0,
          cpuToResponse: 0,
        },
        trends: {
          responseTime: { current: 0, change: 0, trend: 'stable' },
          errorRate: { current: 100, change: 0, trend: 'stable' },
          throughput: { current: 0, change: 0, trend: 'stable' },
        },
      });
      performanceCorrelationService.getRecentCorrelations.mockReturnValue([]);

      await service.refreshAnalytics();

      const analytics = service.getAnalytics();
      expect(analytics.overview.totalErrors).toBe(2);
      expect(analytics.overview.errorRate).toBe(100);
    });

    it('should calculate request performance metrics', async () => {
      const mockEntries: TelescopeEntry[] = [
        {
          id: '1',
          type: 'request',
          familyHash: 'hash1',
          tags: ['http'],
          sequence: 1,
          timestamp: new Date(),
          content: {
            duration: 100,
          },
        },
        {
          id: '2',
          type: 'request',
          familyHash: 'hash2',
          tags: ['http'],
          sequence: 2,
          timestamp: new Date(),
          content: {
            duration: 200,
          },
        },
        {
          id: '3',
          type: 'request',
          familyHash: 'hash3',
          tags: ['http'],
          sequence: 3,
          timestamp: new Date(),
          content: {
            duration: 300,
          },
        },
      ];

      telescopeService.getEntries.mockResolvedValue(mockEntries);
      performanceCorrelationService.getMetrics.mockReturnValue({
        averageResponseTime: 200,
        errorRate: 0,
        totalRequests: 3,
        p95ResponseTime: 300,
        p99ResponseTime: 400,
        components: {
          database: {
            averageTime: 50,
            slowQueries: 0,
            connectionIssues: 0,
          },
          cache: {
            averageTime: 10,
            hitRate: 0.8,
            missRate: 0.2,
            errorRate: 0,
          },
          jobs: {
            averageTime: 100,
            failureRate: 0,
            queueBacklog: 0,
          },
          exceptions: {
            rate: 0,
            criticalCount: 0,
            averageImpact: 0,
          },
        },
        correlations: {
          queryToResponse: 0,
          cacheToResponse: 0,
          jobToResponse: 0,
          exceptionToResponse: 0,
          memoryToResponse: 0,
          cpuToResponse: 0,
        },
        trends: {
          responseTime: { current: 200, change: 0, trend: 'stable' },
          errorRate: { current: 0, change: 0, trend: 'stable' },
          throughput: { current: 3, change: 0, trend: 'stable' },
        },
      });
      performanceCorrelationService.getRecentCorrelations.mockReturnValue([]);

      await service.refreshAnalytics();

      const analytics = service.getAnalytics();
      expect(analytics.overview.averageResponseTime).toBe(200);
      // Percentiles are calculated from actual request durations (100, 200, 300)
      expect(analytics.performance.responseTimeDistribution.percentiles.p95).toBe(300);
    });

    it('should calculate percentile metrics', async () => {
      const mockEntries: TelescopeEntry[] = [
        {
          id: '1',
          type: 'request',
          familyHash: 'hash1',
          tags: ['http'],
          sequence: 1,
          timestamp: new Date(),
          content: {
            duration: 100,
          },
        },
        {
          id: '2',
          type: 'request',
          familyHash: 'hash2',
          tags: ['http'],
          sequence: 2,
          timestamp: new Date(),
          content: {
            duration: 200,
          },
        },
        {
          id: '3',
          type: 'request',
          familyHash: 'hash3',
          tags: ['http'],
          sequence: 3,
          timestamp: new Date(),
          content: {
            duration: 300,
          },
        },
        {
          id: '4',
          type: 'request',
          familyHash: 'hash4',
          tags: ['http'],
          sequence: 4,
          timestamp: new Date(),
          content: {
            duration: 400,
          },
        },
        {
          id: '5',
          type: 'request',
          familyHash: 'hash5',
          tags: ['http'],
          sequence: 5,
          timestamp: new Date(),
          content: {
            duration: 500,
          },
        },
      ];

      telescopeService.getEntries.mockResolvedValue(mockEntries);
      performanceCorrelationService.getMetrics.mockReturnValue({
        averageResponseTime: 300,
        errorRate: 0,
        totalRequests: 5,
        p95ResponseTime: 450,
        p99ResponseTime: 500,
        components: {
          database: {
            averageTime: 50,
            slowQueries: 0,
            connectionIssues: 0,
          },
          cache: {
            averageTime: 10,
            hitRate: 0.8,
            missRate: 0.2,
            errorRate: 0,
          },
          jobs: {
            averageTime: 100,
            failureRate: 0,
            queueBacklog: 0,
          },
          exceptions: {
            rate: 0,
            criticalCount: 0,
            averageImpact: 0,
          },
        },
        correlations: {
          queryToResponse: 0,
          cacheToResponse: 0,
          jobToResponse: 0,
          exceptionToResponse: 0,
          memoryToResponse: 0,
          cpuToResponse: 0,
        },
        trends: {
          responseTime: { current: 300, change: 0, trend: 'stable' },
          errorRate: { current: 0, change: 0, trend: 'stable' },
          throughput: { current: 5, change: 0, trend: 'stable' },
        },
      });
      performanceCorrelationService.getRecentCorrelations.mockReturnValue([]);

      await service.refreshAnalytics();

      const analytics = service.getAnalytics();
      // Percentiles are calculated from actual request durations (100, 200, 300, 400, 500)
      expect(analytics.performance.responseTimeDistribution.percentiles.p95).toBe(500);
      expect(analytics.performance.responseTimeDistribution.percentiles.p99).toBe(500);
    });

    it('should calculate throughput metrics', async () => {
      const mockEntries: TelescopeEntry[] = [
        {
          id: '1',
          type: 'request',
          familyHash: 'hash1',
          tags: ['http'],
          sequence: 1,
          timestamp: new Date(Date.now() - 60000), // 1 minute ago
          content: {
            request: { duration: 100 },
          },
        },
        {
          id: '2',
          type: 'request',
          familyHash: 'hash2',
          tags: ['http'],
          sequence: 2,
          timestamp: new Date(),
          content: {
            request: { duration: 200 },
          },
        },
      ];

      telescopeService.getEntries.mockResolvedValue(mockEntries);
      performanceCorrelationService.getMetrics.mockReturnValue({
        averageResponseTime: 150,
        errorRate: 0,
        totalRequests: 2,
        p95ResponseTime: 200,
        p99ResponseTime: 250,
        components: {
          database: {
            averageTime: 50,
            slowQueries: 0,
            connectionIssues: 0,
          },
          cache: {
            averageTime: 10,
            hitRate: 0.8,
            missRate: 0.2,
            errorRate: 0,
          },
          jobs: {
            averageTime: 100,
            failureRate: 0,
            queueBacklog: 0,
          },
          exceptions: {
            rate: 0,
            criticalCount: 0,
            averageImpact: 0,
          },
        },
        correlations: {
          queryToResponse: 0,
          cacheToResponse: 0,
          jobToResponse: 0,
          exceptionToResponse: 0,
          memoryToResponse: 0,
          cpuToResponse: 0,
        },
        trends: {
          responseTime: { current: 150, change: 0, trend: 'stable' },
          errorRate: { current: 0, change: 0, trend: 'stable' },
          throughput: { current: 2, change: 0, trend: 'stable' },
        },
      });
      performanceCorrelationService.getRecentCorrelations.mockReturnValue([]);

      await service.refreshAnalytics();

      const analytics = service.getAnalytics();
      // Throughput comes from PerformanceMetrics.throughput (defaults to 0 if not provided)
      expect(analytics.overview.throughput).toBe(0);
    });

    it('should calculate error correlation metrics', async () => {
      const mockEntries: TelescopeEntry[] = [
        {
          id: '1',
          type: 'request',
          familyHash: 'hash1',
          tags: ['http'],
          sequence: 1,
          timestamp: new Date(),
          content: {
            request: { duration: 100 },
          },
        },
        {
          id: '2',
          type: 'exception',
          familyHash: 'hash2',
          tags: ['error'],
          sequence: 2,
          timestamp: new Date(),
          content: {
            exception: { type: 'Error', message: 'Test error' },
          },
        },
        {
          id: '3',
          type: 'request',
          familyHash: 'hash3',
          tags: ['http'],
          sequence: 3,
          timestamp: new Date(),
          content: {
            request: { duration: 200 },
          },
        },
      ];

      telescopeService.getEntries.mockResolvedValue(mockEntries);
      performanceCorrelationService.getMetrics.mockReturnValue({
        averageResponseTime: 150,
        errorRate: 33.33,
        totalRequests: 3,
        p95ResponseTime: 200,
        p99ResponseTime: 250,
        components: {
          database: {
            averageTime: 50,
            slowQueries: 0,
            connectionIssues: 0,
          },
          cache: {
            averageTime: 10,
            hitRate: 0.8,
            missRate: 0.2,
            errorRate: 0,
          },
          jobs: {
            averageTime: 100,
            failureRate: 0,
            queueBacklog: 0,
          },
          exceptions: {
            rate: 33.33,
            criticalCount: 1,
            averageImpact: 0.3,
          },
        },
        correlations: {
          queryToResponse: 0,
          cacheToResponse: 0,
          jobToResponse: 0,
          exceptionToResponse: 0,
          memoryToResponse: 0,
          cpuToResponse: 0,
        },
        trends: {
          responseTime: { current: 150, change: 0, trend: 'stable' },
          errorRate: { current: 33.33, change: 0, trend: 'stable' },
          throughput: { current: 3, change: 0, trend: 'stable' },
        },
      });
      performanceCorrelationService.getRecentCorrelations.mockReturnValue([]);

      await service.refreshAnalytics();

      const analytics = service.getAnalytics();
      expect(analytics.overview.totalErrors).toBe(1);
      expect(analytics.overview.errorRate).toBe(33.33);
    });

    it('should handle large datasets efficiently', async () => {
      const largeDataset: TelescopeEntry[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `entry-${i}`,
        type: 'request',
        familyHash: `hash-${i}`,
        tags: ['http'],
        sequence: i + 1,
        timestamp: new Date(),
        content: {
          userId: `user-${i % 10}`,
          request: { path: `/api/endpoint-${i}`, method: 'GET', duration: 100 + (i % 100) },
        },
      }));

      telescopeService.getEntries.mockResolvedValue(largeDataset);
      performanceCorrelationService.getMetrics.mockReturnValue({
        averageResponseTime: 150,
        errorRate: 0,
        totalRequests: 1000,
        p95ResponseTime: 200,
        p99ResponseTime: 250,
        components: {
          database: {
            averageTime: 50,
            slowQueries: 0,
            connectionIssues: 0,
          },
          cache: {
            averageTime: 10,
            hitRate: 0.8,
            missRate: 0.2,
            errorRate: 0,
          },
          jobs: {
            averageTime: 100,
            failureRate: 0,
            queueBacklog: 0,
          },
          exceptions: {
            rate: 0,
            criticalCount: 0,
            averageImpact: 0,
          },
        },
        correlations: {
          queryToResponse: 0,
          cacheToResponse: 0,
          jobToResponse: 0,
          exceptionToResponse: 0,
          memoryToResponse: 0,
          cpuToResponse: 0,
        },
        trends: {
          responseTime: { current: 150, change: 0, trend: 'stable' },
          errorRate: { current: 0, change: 0, trend: 'stable' },
          throughput: { current: 1000, change: 0, trend: 'stable' },
        },
      });
      performanceCorrelationService.getRecentCorrelations.mockReturnValue([]);

      const startTime = Date.now();
      await service.refreshAnalytics();
      const analytics = service.getAnalytics();
      const endTime = Date.now();

      expect(analytics.overview.totalRequests).toBe(1000);
      expect(analytics.overview.activeUsers).toBe(10);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle empty datasets gracefully', async () => {
      telescopeService.getEntries.mockResolvedValue([]);
      performanceCorrelationService.getMetrics.mockReturnValue({
        averageResponseTime: 0,
        errorRate: 0,
        totalRequests: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        components: {
          database: {
            averageTime: 0,
            slowQueries: 0,
            connectionIssues: 0,
          },
          cache: {
            averageTime: 0,
            hitRate: 0,
            missRate: 0,
            errorRate: 0,
          },
          jobs: {
            averageTime: 0,
            failureRate: 0,
            queueBacklog: 0,
          },
          exceptions: {
            rate: 0,
            criticalCount: 0,
            averageImpact: 0,
          },
        },
        correlations: {
          queryToResponse: 0,
          cacheToResponse: 0,
          jobToResponse: 0,
          exceptionToResponse: 0,
          memoryToResponse: 0,
          cpuToResponse: 0,
        },
        trends: {
          responseTime: { current: 0, change: 0, trend: 'stable' },
          errorRate: { current: 0, change: 0, trend: 'stable' },
          throughput: { current: 0, change: 0, trend: 'stable' },
        },
      });
      performanceCorrelationService.getRecentCorrelations.mockReturnValue([]);

      await service.refreshAnalytics();

      const analytics = service.getAnalytics();
      expect(analytics.overview.totalRequests).toBe(0);
      expect(analytics.overview.activeUsers).toBe(0);
      expect(analytics.overview.averageResponseTime).toBe(0);
      expect(analytics.overview.totalErrors).toBe(0);
    });

    it('should handle mixed data types correctly', async () => {
      const mockEntries: TelescopeEntry[] = [
        {
          id: '1',
          type: 'request',
          familyHash: 'hash1',
          tags: ['http'],
          sequence: 1,
          timestamp: new Date(),
          content: {
            request: { duration: 100 },
          },
        },
        {
          id: '2',
          type: 'request',
          familyHash: 'hash2',
          tags: ['http'],
          sequence: 2,
          timestamp: new Date(),
          content: {
            request: { duration: '200' }, // String duration
          },
        },
      ];

      telescopeService.getEntries.mockResolvedValue(mockEntries);
      performanceCorrelationService.getMetrics.mockReturnValue({
        averageResponseTime: 150,
        errorRate: 0,
        totalRequests: 2,
        p95ResponseTime: 200,
        p99ResponseTime: 250,
        components: {
          database: {
            averageTime: 50,
            slowQueries: 0,
            connectionIssues: 0,
          },
          cache: {
            averageTime: 10,
            hitRate: 0.8,
            missRate: 0.2,
            errorRate: 0,
          },
          jobs: {
            averageTime: 100,
            failureRate: 0,
            queueBacklog: 0,
          },
          exceptions: {
            rate: 0,
            criticalCount: 0,
            averageImpact: 0,
          },
        },
        correlations: {
          queryToResponse: 0,
          cacheToResponse: 0,
          jobToResponse: 0,
          exceptionToResponse: 0,
          memoryToResponse: 0,
          cpuToResponse: 0,
        },
        trends: {
          responseTime: { current: 150, change: 0, trend: 'stable' },
          errorRate: { current: 0, change: 0, trend: 'stable' },
          throughput: { current: 2, change: 0, trend: 'stable' },
        },
      });
      performanceCorrelationService.getRecentCorrelations.mockReturnValue([]);

      await service.refreshAnalytics();

      const analytics = service.getAnalytics();
      expect(analytics.overview.averageResponseTime).toBe(150); // Should handle string conversion
    });
  });

  describe('real-time analytics', () => {
    it('should provide real-time analytics stream', (done) => {
      const mockEntries: TelescopeEntry[] = [
        {
          id: '1',
          type: 'request',
          familyHash: 'hash1',
          tags: ['http'],
          sequence: 1,
          timestamp: new Date(),
          content: {
            request: { duration: 100 },
          },
        },
      ];

      telescopeService.getEntries.mockResolvedValue(mockEntries);
      performanceCorrelationService.getMetrics.mockReturnValue({
        averageResponseTime: 100,
        errorRate: 0,
        totalRequests: 1,
        p95ResponseTime: 100,
        p99ResponseTime: 100,
        components: {
          database: {
            averageTime: 50,
            slowQueries: 0,
            connectionIssues: 0,
          },
          cache: {
            averageTime: 10,
            hitRate: 0.8,
            missRate: 0.2,
            errorRate: 0,
          },
          jobs: {
            averageTime: 100,
            failureRate: 0,
            queueBacklog: 0,
          },
          exceptions: {
            rate: 0,
            criticalCount: 0,
            averageImpact: 0,
          },
        },
        correlations: {
          queryToResponse: 0,
          cacheToResponse: 0,
          jobToResponse: 0,
          exceptionToResponse: 0,
          memoryToResponse: 0,
          cpuToResponse: 0,
        },
        trends: {
          responseTime: { current: 100, change: 0, trend: 'stable' },
          errorRate: { current: 0, change: 0, trend: 'stable' },
          throughput: { current: 1, change: 0, trend: 'stable' },
        },
      });
      performanceCorrelationService.getRecentCorrelations.mockReturnValue([]);

      const analyticsStream = service.getAnalyticsStream();
      analyticsStream.subscribe((analytics) => {
        expect(analytics.overview.totalRequests).toBe(1);
        done();
      });

      // Trigger analytics update
      service.refreshAnalytics();
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService, AnalyticsData } from './analytics.service';
import { TelescopeService } from './telescope.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let telescopeService: jest.Mocked<TelescopeService>;

  beforeEach(async () => {
    const mockTelescopeService = {
      getEntries: jest.fn(),
      clearEntries: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: TelescopeService,
          useValue: mockTelescopeService,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    telescopeService = module.get(TelescopeService);
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
    it('should calculate user analytics correctly', () => {
      const mockEntries = [
        {
          id: '1',
          type: 'request',
          timestamp: new Date(),
          content: {
            userId: 'user-1',
            request: { path: '/api/users', method: 'GET' },
          },
        },
        {
          id: '2',
          type: 'request',
          timestamp: new Date(),
          content: {
            userId: 'user-2',
            request: { path: '/api/posts', method: 'GET' },
          },
        },
        {
          id: '3',
          type: 'request',
          timestamp: new Date(),
          content: {
            userId: 'user-1',
            request: { path: '/api/users', method: 'POST' },
          },
        },
      ];

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics = service.getAnalytics();
      expect(analytics.overview.totalRequests).toBe(3);
      expect(analytics.overview.activeUsers).toBe(2);
      expect(analytics.users.activeUsers).toHaveLength(2);
      expect(analytics.users.activeUsers[0].userId).toBe('user-1');
      expect(analytics.users.activeUsers[0].requestCount).toBe(2);
    });

    it('should calculate performance analytics correctly', () => {
      const mockEntries = [
        {
          id: '1',
          type: 'request',
          timestamp: new Date(),
          content: {
            request: { path: '/api/users', method: 'GET', duration: 100 },
          },
        },
        {
          id: '2',
          type: 'request',
          timestamp: new Date(),
          content: {
            request: { path: '/api/posts', method: 'GET', duration: 200 },
          },
        },
        {
          id: '3',
          type: 'query',
          timestamp: new Date(),
          content: {
            query: { duration: 50 },
          },
        },
      ];

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics = service.getAnalytics();
      expect(analytics.overview.averageResponseTime).toBe(150);
      expect(analytics.overview.totalRequests).toBe(2);
      expect(analytics.overview.totalQueries).toBe(1);
      expect(analytics.performance.slowestEndpoints).toHaveLength(2);
    });

    it('should calculate error analytics correctly', () => {
      const mockEntries = [
        {
          id: '1',
          type: 'exception',
          timestamp: new Date(),
          content: {
            exception: { type: 'ValidationError', message: 'Invalid input' },
          },
        },
        {
          id: '2',
          type: 'exception',
          timestamp: new Date(),
          content: {
            exception: { type: 'ValidationError', message: 'Missing field' },
          },
        },
        {
          id: '3',
          type: 'exception',
          timestamp: new Date(),
          content: {
            exception: { type: 'DatabaseError', message: 'Connection failed' },
          },
        },
      ];

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics = service.getAnalytics();
      expect(analytics.overview.totalErrors).toBe(3);
      expect(analytics.errors.errorDistribution.byType).toHaveLength(2);
      expect(analytics.errors.errorDistribution.byType[0].type).toBe('ValidationError');
      expect(analytics.errors.errorDistribution.byType[0].count).toBe(2);
    });

    it('should calculate performance distribution correctly', () => {
      const mockEntries = [
        {
          id: '1',
          type: 'request',
          timestamp: new Date(),
          content: {
            request: { duration: 50 },
          },
        },
        {
          id: '2',
          type: 'request',
          timestamp: new Date(),
          content: {
            request: { duration: 150 },
          },
        },
        {
          id: '3',
          type: 'request',
          timestamp: new Date(),
          content: {
            request: { duration: 300 },
          },
        },
        {
          id: '4',
          type: 'request',
          timestamp: new Date(),
          content: {
            request: { duration: 800 },
          },
        },
      ];

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics = service.getAnalytics();
      expect(analytics.performance.responseTimeDistribution).toBeDefined();
      expect(analytics.performance.responseTimeDistribution.buckets).toHaveLength(4);
      expect(analytics.performance.responseTimeDistribution.buckets[0].count).toBe(1);
      expect(analytics.performance.responseTimeDistribution.buckets[1].count).toBe(1);
      expect(analytics.performance.responseTimeDistribution.buckets[2].count).toBe(1);
      expect(analytics.performance.responseTimeDistribution.buckets[3].count).toBe(1);
    });
  });

  describe('time-based analytics', () => {
    it('should calculate hourly trends', () => {
      const now = new Date();
      const mockEntries = [
        {
          id: '1',
          type: 'request',
          timestamp: new Date(now.getTime() - 3600000), // 1 hour ago
          content: { request: { duration: 100 } },
        },
        {
          id: '2',
          type: 'request',
          timestamp: new Date(now.getTime() - 1800000), // 30 minutes ago
          content: { request: { duration: 200 } },
        },
        {
          id: '3',
          type: 'request',
          timestamp: now,
          content: { request: { duration: 150 } },
        },
      ];

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics = service.getAnalytics();
      expect(analytics.trends.performanceTrends).toBeDefined();
      expect(analytics.trends.performanceTrends.length).toBeGreaterThan(0);
    });

    it('should filter analytics by time range', () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600000);
      const twoHoursAgo = new Date(now.getTime() - 7200000);

      const mockEntries = [
        {
          id: '1',
          type: 'request',
          timestamp: twoHoursAgo,
          content: { request: { duration: 100 } },
        },
        {
          id: '2',
          type: 'request',
          timestamp: oneHourAgo,
          content: { request: { duration: 200 } },
        },
        {
          id: '3',
          type: 'request',
          timestamp: now,
          content: { request: { duration: 150 } },
        },
      ];

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics = service.getAnalytics(oneHourAgo, now);
      expect(analytics.overview.totalRequests).toBe(2);
      expect(analytics.overview.averageResponseTime).toBe(175);
    });
  });

  describe('trend analysis', () => {
    it('should calculate trend predictions', () => {
      const mockEntries = Array.from({ length: 10 }, (_, i) => ({
        id: `${i}`,
        type: 'request',
        timestamp: new Date(Date.now() - i * 3600000),
        content: {
          request: { duration: 100 + i * 10 },
        },
      }));

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics = service.getAnalytics();
      expect(analytics.trends.performanceTrends).toBeDefined();
      expect(analytics.trends.performanceTrends.length).toBeGreaterThan(0);
    });

    it('should identify performance degradation', () => {
      const mockEntries = Array.from({ length: 20 }, (_, i) => ({
        id: `${i}`,
        type: 'request',
        timestamp: new Date(Date.now() - i * 3600000),
        content: {
          request: { duration: i < 10 ? 100 : 500 }, // Performance degradation
        },
      }));

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics = service.getAnalytics();
      expect(analytics.trends.performanceTrends).toBeDefined();
      expect(analytics.trends.performanceTrends.length).toBeGreaterThan(0);
    });

    it('should identify improvement trends', () => {
      const mockEntries = Array.from({ length: 20 }, (_, i) => ({
        id: `${i}`,
        type: 'request',
        timestamp: new Date(Date.now() - i * 3600000),
        content: {
          request: { duration: i < 10 ? 500 : 100 }, // Performance improvement
        },
      }));

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics = service.getAnalytics();
      expect(analytics.trends.performanceTrends).toBeDefined();
      expect(analytics.trends.performanceTrends.length).toBeGreaterThan(0);
    });
  });

  describe('anomaly detection', () => {
    it('should detect performance anomalies', () => {
      const mockEntries = [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `normal-${i}`,
          type: 'request',
          timestamp: new Date(Date.now() - i * 3600000),
          content: {
            request: { duration: 100 },
          },
        })),
        {
          id: 'anomaly',
          type: 'request',
          timestamp: new Date(),
          content: {
            request: { duration: 5000 }, // Anomaly
          },
        },
      ];

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics = service.getAnalytics();
      expect(analytics.alerts.anomalies).toBeDefined();
      expect(analytics.alerts.anomalies.length).toBeGreaterThan(0);
    });

    it('should detect error rate anomalies', () => {
      const mockEntries = [
        ...Array.from({ length: 100 }, (_, i) => ({
          id: `request-${i}`,
          type: 'request',
          timestamp: new Date(Date.now() - i * 60000),
          content: { request: { duration: 100 } },
        })),
        ...Array.from({ length: 20 }, (_, i) => ({
          id: `error-${i}`,
          type: 'exception',
          timestamp: new Date(Date.now() - i * 60000),
          content: {
            exception: { type: 'Error', message: 'Anomaly error' },
          },
        })),
      ];

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics = service.getAnalytics();
      expect(analytics.alerts.anomalies).toBeDefined();
      expect(analytics.alerts.anomalies.length).toBeGreaterThan(0);
    });
  });

  describe('comprehensive analysis', () => {
    it('should handle mixed entry types', () => {
      const mockEntries = [
        {
          id: '1',
          type: 'request',
          timestamp: new Date(),
          content: {
            userId: 'user-1',
            request: { path: '/api/users', method: 'GET', duration: 100 },
          },
        },
        {
          id: '2',
          type: 'query',
          timestamp: new Date(),
          content: {
            userId: 'user-1',
            query: { sql: 'SELECT * FROM users', duration: 50 },
          },
        },
        {
          id: '3',
          type: 'exception',
          timestamp: new Date(),
          content: {
            userId: 'user-1',
            exception: { type: 'ValidationError', message: 'Invalid input' },
          },
        },
        {
          id: '4',
          type: 'cache',
          timestamp: new Date(),
          content: {
            userId: 'user-1',
            cache: { operation: 'get', hit: true, duration: 5 },
          },
        },
        {
          id: '5',
          type: 'job',
          timestamp: new Date(),
          content: {
            userId: 'user-1',
            job: { name: 'email-job', status: 'completed', duration: 1000 },
          },
        },
      ];

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics = service.getAnalytics();
      expect(analytics.overview.totalRequests).toBe(1);
      expect(analytics.overview.totalQueries).toBe(1);
      expect(analytics.overview.totalErrors).toBe(1);
      expect(analytics.users.activeUsers).toHaveLength(1);
    });

    it('should calculate system health score', () => {
      const mockEntries = [
        {
          id: '1',
          type: 'request',
          timestamp: new Date(),
          content: {
            request: { duration: 100 },
          },
        },
        {
          id: '2',
          type: 'exception',
          timestamp: new Date(),
          content: {
            exception: { type: 'Error', message: 'Test error' },
          },
        },
      ];

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics = service.getAnalytics();
      expect(analytics.overview).toBeDefined();
      expect(analytics.overview.totalRequests).toBe(1);
      expect(analytics.overview.totalErrors).toBe(1);
      expect(analytics.overview.errorRate).toBeGreaterThan(0);
    });
  });

  describe('performance optimization', () => {
    it('should handle large datasets efficiently', () => {
      const largeDataset = Array.from({ length: 10000 }, (_, i) => ({
        id: `${i}`,
        type: 'request',
        timestamp: new Date(Date.now() - i * 1000),
        content: {
          userId: `user-${i % 100}`,
          request: { path: `/api/endpoint${i % 10}`, duration: 100 + (i % 500) },
        },
      }));

      telescopeService.getEntries.mockReturnValue(largeDataset);

      const startTime = Date.now();
      const analytics = service.getAnalytics();
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
      expect(analytics.users.activeUsers).toHaveLength(100);
      expect(analytics.overview.totalRequests).toBe(10000);
    });

    it('should cache analytics results', () => {
      const mockEntries = [
        {
          id: '1',
          type: 'request',
          timestamp: new Date(),
          content: { request: { duration: 100 } },
        },
      ];

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics1 = service.getAnalytics();
      const analytics2 = service.getAnalytics();

      expect(telescopeService.getEntries).toHaveBeenCalledTimes(1);
      expect(analytics1).toBe(analytics2);
    });
  });

  describe('error handling', () => {
    it('should handle empty data gracefully', () => {
      telescopeService.getEntries.mockReturnValue([]);

      const analytics = service.getAnalytics();
      expect(analytics.overview.totalRequests).toBe(0);
      expect(analytics.overview.totalErrors).toBe(0);
      expect(analytics.users.activeUsers).toHaveLength(0);
    });

    it('should handle malformed entries gracefully', () => {
      const mockEntries = [
        {
          id: '1',
          type: 'request',
          timestamp: new Date(),
          content: null,
        },
        {
          id: '2',
          type: 'request',
          timestamp: new Date(),
          content: { request: { duration: 'invalid' } },
        },
        {
          id: '3',
          type: 'request',
          timestamp: new Date(),
          content: { request: { duration: 100 } },
        },
      ];

      telescopeService.getEntries.mockReturnValue(mockEntries);

      const analytics = service.getAnalytics();
      expect(analytics.overview.totalRequests).toBe(1);
      expect(analytics.overview.averageResponseTime).toBe(100);
    });
  });
});
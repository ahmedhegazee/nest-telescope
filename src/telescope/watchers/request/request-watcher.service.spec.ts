import { Test, TestingModule } from '@nestjs/testing';
import { RequestWatcherService } from './request-watcher.service';
import { TelescopeService } from '../../core/services/telescope.service';
import { TelescopeConfig } from '../../core/interfaces/telescope-config.interface';
import { RequestContext, ResponseContext } from './request-watcher.interceptor';

describe('RequestWatcherService', () => {
  let service: RequestWatcherService;
  let telescopeService: jest.Mocked<TelescopeService>;

  beforeEach(async () => {
    const mockTelescopeService = {
      record: jest.fn(),
    };

    const mockConfig: TelescopeConfig = {
      enabled: true,
      storage: {
        driver: 'memory',
        batch: {
          enabled: true,
          size: 100,
          flushInterval: 1000
        }
      },
      devtools: {
        enabled: true
      },
      watchers: {
        request: {
          enabled: true,
          excludePaths: ['/health', '/metrics'],
          sampling: {
            enabled: true,
            rate: 100,
            rules: [
              { path: '/api/health', rate: 10, priority: 1 },
              { path: '/api', method: 'POST', rate: 100, priority: 3 }
            ]
          },
          security: {
            maskSensitiveData: true,
            logResponseBodies: false,
            logSuccessfulResponseBodies: false,
            sensitiveKeys: ['password', 'token', 'secret']
          },
          performance: {
            slowRequestThreshold: 1000,
            collectMetrics: true
          }
        }
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestWatcherService,
        {
          provide: TelescopeService,
          useValue: mockTelescopeService,
        },
        {
          provide: 'TELESCOPE_CONFIG',
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<RequestWatcherService>(RequestWatcherService);
    telescopeService = module.get(TelescopeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.resetMetrics();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize with correct configuration', () => {
      const config = service.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.excludePaths).toContain('/health');
      expect(config.excludePaths).toContain('/metrics');
      expect(config.security.maskSensitiveData).toBe(true);
    });

    it('should initialize with empty metrics', () => {
      const metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.slowRequests).toBe(0);
      expect(metrics.errorRequests).toBe(0);
    });
  });

  describe('request tracking', () => {
    it('should track successful request', () => {
      const requestContext: RequestContext = {
        id: 'req-1',
        startTime: Date.now(),
        method: 'GET',
        url: '/api/users',
        headers: { 'user-agent': 'test' },
        query: {},
        body: null,
        userAgent: 'test',
        ip: '127.0.0.1',
        sessionId: 'session-1',
        userId: 'user-1',
        traceId: 'trace-1'
      };

      const responseContext: ResponseContext = {
        statusCode: 200,
        headers: {},
        body: null,
        size: 0,
        endTime: Date.now() + 100,
        duration: 100
      };

      service.trackRequest(requestContext, responseContext, null);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'request',
          content: expect.objectContaining({
            request: expect.objectContaining({
              method: 'GET',
              url: '/api/users',
              sessionId: 'session-1',
              userId: 'user-1'
            }),
            response: expect.objectContaining({
              statusCode: 200,
              duration: 100
            })
          })
        })
      );

      const metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(1);
    });

    it('should track error request', () => {
      const requestContext: RequestContext = {
        id: 'req-2',
        startTime: Date.now(),
        method: 'POST',
        url: '/api/users',
        headers: {},
        query: {},
        body: { name: 'test' },
        userAgent: 'test',
        ip: '127.0.0.1'
      };

      const responseContext: ResponseContext = {
        statusCode: 500,
        headers: {},
        body: { error: 'Internal Server Error' },
        size: 100,
        endTime: Date.now() + 200,
        duration: 200
      };

      const error = new Error('Database connection failed');

      service.trackRequest(requestContext, responseContext, error);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'request',
          content: expect.objectContaining({
            error: expect.objectContaining({
              message: 'Database connection failed',
              name: 'Error'
            })
          }),
          tags: expect.arrayContaining(['error', 'server-error'])
        })
      );

      const metrics = service.getMetrics();
      expect(metrics.errorRequests).toBe(1);
    });

    it('should track slow request', () => {
      const requestContext: RequestContext = {
        id: 'req-3',
        startTime: Date.now(),
        method: 'GET',
        url: '/api/slow',
        headers: {},
        query: {},
        body: null,
        userAgent: 'test',
        ip: '127.0.0.1'
      };

      const responseContext: ResponseContext = {
        statusCode: 200,
        headers: {},
        body: null,
        size: 0,
        endTime: Date.now() + 2000,
        duration: 2000
      };

      service.trackRequest(requestContext, responseContext, null);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining(['slow']),
          content: expect.objectContaining({
            performance: expect.objectContaining({
              slow: true
            })
          })
        })
      );

      const metrics = service.getMetrics();
      expect(metrics.slowRequests).toBe(1);
    });

    it('should not track when disabled', () => {
      // Create service with disabled config
      const disabledConfig: TelescopeConfig = {
        enabled: true,
        storage: { driver: 'memory' },
        devtools: { enabled: true },
        watchers: { request: { enabled: false } }
      };

      const module = Test.createTestingModule({
        providers: [
          RequestWatcherService,
          {
            provide: TelescopeService,
            useValue: { record: jest.fn() },
          },
          {
            provide: 'TELESCOPE_CONFIG',
            useValue: disabledConfig,
          },
        ],
      }).compile();

      const disabledService = module.get<RequestWatcherService>(RequestWatcherService);

      const requestContext: RequestContext = {
        id: 'req-4',
        startTime: Date.now(),
        method: 'GET',
        url: '/api/test',
        headers: {},
        query: {},
        body: null,
        userAgent: 'test',
        ip: '127.0.0.1'
      };

      const responseContext: ResponseContext = {
        statusCode: 200,
        headers: {},
        body: null,
        size: 0,
        endTime: Date.now() + 100,
        duration: 100
      };

      disabledService.trackRequest(requestContext, responseContext, null);

      expect(telescopeService.record).not.toHaveBeenCalled();
    });
  });

  describe('sampling', () => {
    it('should sample requests based on rules', () => {
      const mockRequest = {
        path: '/api/health',
        method: 'GET'
      } as any;

      // Mock Math.random to return 0.5 (50%)
      const originalRandom = Math.random;
      Math.random = jest.fn(() => 0.5);

      // Should not sample (rule says 10% for /api/health)
      expect(service.shouldSampleRequest(mockRequest)).toBe(false);

      // Should sample (rule says 100% for POST to /api)
      mockRequest.path = '/api/users';
      mockRequest.method = 'POST';
      expect(service.shouldSampleRequest(mockRequest)).toBe(true);

      Math.random = originalRandom;
    });

    it('should use default sampling rate when no rules match', () => {
      const mockRequest = {
        path: '/unknown',
        method: 'GET'
      } as any;

      const originalRandom = Math.random;
      Math.random = jest.fn(() => 0.5);

      // Should sample (default rate is 100%)
      expect(service.shouldSampleRequest(mockRequest)).toBe(true);

      Math.random = originalRandom;
    });
  });

  describe('security features', () => {
    it('should mask sensitive data in body', () => {
      const body = {
        username: 'test',
        password: 'secret123',
        token: 'abc123',
        data: 'normal data'
      };

      expect(service.shouldMaskBody(body)).toBe(true);
    });

    it('should not mask non-sensitive data', () => {
      const body = {
        username: 'test',
        data: 'normal data',
        count: 5
      };

      expect(service.shouldMaskBody(body)).toBe(false);
    });
  });

  describe('metrics collection', () => {
    beforeEach(() => {
      service.resetMetrics();
    });

    it('should collect request metrics', () => {
      // Track multiple requests
      for (let i = 0; i < 5; i++) {
        const requestContext: RequestContext = {
          id: `req-${i}`,
          startTime: Date.now(),
          method: 'GET',
          url: '/api/test',
          headers: {},
          query: {},
          body: null,
          userAgent: 'test',
          ip: '127.0.0.1'
        };

        const responseContext: ResponseContext = {
          statusCode: 200,
          headers: {},
          body: null,
          size: 0,
          endTime: Date.now() + 100,
          duration: 100
        };

        service.trackRequest(requestContext, responseContext, null);
      }

      const metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(5);
      expect(metrics.averageResponseTime).toBe(100);
      expect(metrics.statusCodeDistribution[200]).toBe(5);
      expect(metrics.methodDistribution['GET']).toBe(5);
    });

    it('should calculate requests per second', () => {
      // Track requests with timestamps
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        const requestContext: RequestContext = {
          id: `req-${i}`,
          startTime: now - (i * 10000), // 10 seconds apart
          method: 'GET',
          url: '/api/test',
          headers: {},
          query: {},
          body: null,
          userAgent: 'test',
          ip: '127.0.0.1'
        };

        const responseContext: ResponseContext = {
          statusCode: 200,
          headers: {},
          body: null,
          size: 0,
          endTime: now,
          duration: 100
        };

        service.trackRequest(requestContext, responseContext, null);
      }

      const metrics = service.getMetrics();
      expect(metrics.requestsPerSecond).toBeGreaterThan(0);
    });
  });

  describe('configuration', () => {
    it('should return excluded paths', () => {
      const excludedPaths = service.getExcludedPaths();
      expect(excludedPaths).toContain('/health');
      expect(excludedPaths).toContain('/metrics');
    });

    it('should return configuration', () => {
      const config = service.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.security.maskSensitiveData).toBe(true);
      expect(config.performance.slowRequestThreshold).toBe(1000);
    });
  });

  describe('metrics reset', () => {
    it('should reset metrics to initial state', () => {
      // Track some requests first
      const requestContext: RequestContext = {
        id: 'req-1',
        startTime: Date.now(),
        method: 'GET',
        url: '/api/test',
        headers: {},
        query: {},
        body: null,
        userAgent: 'test',
        ip: '127.0.0.1'
      };

      const responseContext: ResponseContext = {
        statusCode: 200,
        headers: {},
        body: null,
        size: 0,
        endTime: Date.now() + 100,
        duration: 100
      };

      service.trackRequest(requestContext, responseContext, null);

      let metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(1);

      // Reset and verify
      service.resetMetrics();
      metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.averageResponseTime).toBe(0);
      expect(Object.keys(metrics.statusCodeDistribution)).toHaveLength(0);
      expect(Object.keys(metrics.methodDistribution)).toHaveLength(0);
    });
  });
});
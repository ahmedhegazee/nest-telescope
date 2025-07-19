import { Test, TestingModule } from '@nestjs/testing';
import { CacheWatcherService, CacheContext, CacheOperation } from './cache-watcher.service';
import { TelescopeService } from '../../core/services/telescope.service';
import { CacheWatcherConfig, defaultCacheWatcherConfig } from './cache-watcher.config';

describe('CacheWatcherService', () => {
  let service: CacheWatcherService;
  let telescopeService: jest.Mocked<TelescopeService>;

  beforeEach(async () => {
    const mockTelescopeService = {
      record: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheWatcherService,
        {
          provide: TelescopeService,
          useValue: mockTelescopeService,
        },
        {
          provide: 'CACHE_WATCHER_CONFIG',
          useValue: defaultCacheWatcherConfig,
        },
      ],
    }).compile();

    service = module.get<CacheWatcherService>(CacheWatcherService);
    telescopeService = module.get(TelescopeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize with default metrics', () => {
      const metrics = service.getMetrics();
      expect(metrics.totalOperations).toBe(0);
      expect(metrics.hitCount).toBe(0);
      expect(metrics.missCount).toBe(0);
      expect(metrics.healthScore).toBe(100);
    });

    it('should start periodic processing on module init', async () => {
      await service.onModuleInit();
      // Module init should not throw
    });
  });

  describe('cache operation tracking', () => {
    it('should track cache hit', () => {
      const context: CacheContext = {
        id: 'cache-hit-1',
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: 'user:123',
        value: { id: 123, name: 'John' },
        hit: true,
        startTime: new Date(),
        duration: 10,
      };

      service.trackCacheOperation(context);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cache',
          content: expect.objectContaining({
            cache: expect.objectContaining({
              operation: 'get',
              key: 'user:123',
              hit: true,
            }),
          }),
        })
      );

      const metrics = service.getMetrics();
      expect(metrics.totalOperations).toBe(1);
      expect(metrics.hitCount).toBe(1);
      expect(metrics.hitRate).toBe(100);
    });

    it('should track cache miss', () => {
      const context: CacheContext = {
        id: 'cache-miss-1',
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: 'user:456',
        hit: false,
        startTime: new Date(),
        duration: 5,
      };

      service.trackCacheOperation(context);

      const metrics = service.getMetrics();
      expect(metrics.totalOperations).toBe(1);
      expect(metrics.missCount).toBe(1);
      expect(metrics.missRate).toBe(100);
    });

    it('should track cache error', () => {
      const context: CacheContext = {
        id: 'cache-error-1',
        timestamp: new Date(),
        operation: CacheOperation.SET,
        key: 'user:789',
        value: { id: 789, name: 'Jane' },
        hit: false,
        startTime: new Date(),
        duration: 50,
        error: { message: 'Connection timeout', code: 'TIMEOUT' },
      };

      service.trackCacheOperation(context);

      const metrics = service.getMetrics();
      expect(metrics.totalOperations).toBe(1);
      expect(metrics.errorCount).toBe(1);
      expect(metrics.errorRate).toBe(100);
    });

    it('should not track operation if disabled', () => {
      const disabledConfig = {
        ...defaultCacheWatcherConfig,
        enabled: false,
      };

      const disabledService = new CacheWatcherService(
        telescopeService,
        disabledConfig
      );

      const context: CacheContext = {
        id: 'disabled-cache-1',
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: 'test:key',
        hit: true,
        startTime: new Date(),
      };

      disabledService.trackCacheOperation(context);

      expect(telescopeService.record).not.toHaveBeenCalled();
    });

    it('should respect sampling rate', () => {
      const samplingConfig = {
        ...defaultCacheWatcherConfig,
        sampleRate: 0, // 0% sampling
      };

      const samplingService = new CacheWatcherService(
        telescopeService,
        samplingConfig
      );

      const context: CacheContext = {
        id: 'sampled-cache-1',
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: 'test:key',
        hit: true,
        startTime: new Date(),
      };

      samplingService.trackCacheOperation(context);

      expect(telescopeService.record).not.toHaveBeenCalled();
    });
  });

  describe('filtering and exclusions', () => {
    it('should exclude operations based on configuration', () => {
      const excludeConfig = {
        ...defaultCacheWatcherConfig,
        excludeOperations: ['get'],
      };

      const excludeService = new CacheWatcherService(
        telescopeService,
        excludeConfig
      );

      const context: CacheContext = {
        id: 'excluded-cache-1',
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: 'test:key',
        hit: true,
        startTime: new Date(),
      };

      excludeService.trackCacheOperation(context);

      expect(telescopeService.record).not.toHaveBeenCalled();
    });

    it('should exclude keys based on patterns', () => {
      const excludeConfig = {
        ...defaultCacheWatcherConfig,
        excludeKeyPatterns: ['temp:*', 'debug:*'],
      };

      const excludeService = new CacheWatcherService(
        telescopeService,
        excludeConfig
      );

      const context: CacheContext = {
        id: 'excluded-key-1',
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: 'temp:session:123',
        hit: true,
        startTime: new Date(),
      };

      excludeService.trackCacheOperation(context);

      expect(telescopeService.record).not.toHaveBeenCalled();
    });

    it('should include only specified key patterns', () => {
      const includeConfig = {
        ...defaultCacheWatcherConfig,
        includeKeyPatterns: ['user:*'],
      };

      const includeService = new CacheWatcherService(
        telescopeService,
        includeConfig
      );

      // Should be excluded
      const excludedContext: CacheContext = {
        id: 'excluded-pattern-1',
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: 'session:123',
        hit: true,
        startTime: new Date(),
      };

      includeService.trackCacheOperation(excludedContext);
      expect(telescopeService.record).not.toHaveBeenCalled();

      // Should be included
      const includedContext: CacheContext = {
        id: 'included-pattern-1',
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: 'user:123',
        hit: true,
        startTime: new Date(),
      };

      includeService.trackCacheOperation(includedContext);
      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cache',
          content: expect.objectContaining({
            cache: expect.objectContaining({
              key: 'user:123',
            }),
          }),
        })
      );
    });
  });

  describe('data sanitization', () => {
    it('should sanitize sensitive keys', () => {
      const context: CacheContext = {
        id: 'sensitive-key-1',
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: 'auth:token:abc123def456',
        hit: true,
        startTime: new Date(),
      };

      service.trackCacheOperation(context);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            cache: expect.objectContaining({
              key: expect.stringContaining('[HASH]'),
            }),
          }),
        })
      );
    });

    it('should sanitize large values', () => {
      const largeValue = 'x'.repeat(2000); // Larger than default maxValueSize
      
      const context: CacheContext = {
        id: 'large-value-1',
        timestamp: new Date(),
        operation: CacheOperation.SET,
        key: 'large:data',
        value: largeValue,
        hit: false,
        startTime: new Date(),
      };

      service.trackCacheOperation(context);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            value: expect.objectContaining({
              _truncated: true,
              _size: expect.any(Number),
            }),
          }),
        })
      );
    });

    it('should sanitize sensitive fields in values', () => {
      const sensitiveValue = {
        id: 123,
        name: 'John',
        password: 'secret123',
        token: 'abc123def456',
      };

      const context: CacheContext = {
        id: 'sensitive-value-1',
        timestamp: new Date(),
        operation: CacheOperation.SET,
        key: 'user:123',
        value: sensitiveValue,
        hit: false,
        startTime: new Date(),
      };

      const captureConfig = {
        ...defaultCacheWatcherConfig,
        captureValues: true,
      };

      const captureService = new CacheWatcherService(
        telescopeService,
        captureConfig
      );

      captureService.trackCacheOperation(context);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            value: expect.objectContaining({
              id: 123,
              name: 'John',
              password: '[REDACTED]',
              token: '[REDACTED]',
            }),
          }),
        })
      );
    });

    it('should limit key length', () => {
      const longKey = 'very:long:key:' + 'x'.repeat(300);
      
      const context: CacheContext = {
        id: 'long-key-1',
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: longKey,
        hit: true,
        startTime: new Date(),
      };

      service.trackCacheOperation(context);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            cache: expect.objectContaining({
              key: expect.stringMatching(/.*\.\.\.$/), // Should end with '...'
            }),
          }),
        })
      );
    });
  });

  describe('key pattern analysis', () => {
    it('should extract and track key patterns', () => {
      const keys = [
        'user:123',
        'user:456',
        'user:789',
        'session:abc123',
        'session:def456',
      ];

      keys.forEach((key, index) => {
        const context: CacheContext = {
          id: `pattern-${index}`,
          timestamp: new Date(),
          operation: CacheOperation.GET,
          key,
          hit: index < 3, // First 3 are hits
          startTime: new Date(),
          duration: 10,
        };

        service.trackCacheOperation(context);
      });

      const metrics = service.getMetrics();
      expect(metrics.topKeyPatterns).toHaveLength(2);
      
      const userPattern = metrics.topKeyPatterns.find(p => p.pattern.includes('user'));
      expect(userPattern).toBeDefined();
      expect(userPattern!.count).toBe(3);
      expect(userPattern!.hitRate).toBe(100);

      const sessionPattern = metrics.topKeyPatterns.find(p => p.pattern.includes('session'));
      expect(sessionPattern).toBeDefined();
      expect(sessionPattern!.count).toBe(2);
      expect(sessionPattern!.hitRate).toBe(0);
    });
  });

  describe('metrics calculation', () => {
    it('should calculate hit and miss rates correctly', () => {
      const operations = [
        { hit: true, duration: 5 },
        { hit: true, duration: 8 },
        { hit: false, duration: 15 },
        { hit: false, duration: 20 },
        { hit: true, duration: 6 },
      ];

      operations.forEach((op, index) => {
        const context: CacheContext = {
          id: `op-${index}`,
          timestamp: new Date(),
          operation: CacheOperation.GET,
          key: `key:${index}`,
          hit: op.hit,
          startTime: new Date(),
          duration: op.duration,
        };

        service.trackCacheOperation(context);
      });

      const metrics = service.getMetrics();
      expect(metrics.totalOperations).toBe(5);
      expect(metrics.hitCount).toBe(3);
      expect(metrics.missCount).toBe(2);
      expect(metrics.hitRate).toBe(60); // 3/5 * 100
      expect(metrics.missRate).toBe(40); // 2/5 * 100
    });

    it('should track slow operations', () => {
      const slowConfig = {
        ...defaultCacheWatcherConfig,
        slowOperationThreshold: 50, // 50ms
      };

      const slowService = new CacheWatcherService(
        telescopeService,
        slowConfig
      );

      const context: CacheContext = {
        id: 'slow-op-1',
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: 'slow:key',
        hit: true,
        startTime: new Date(),
        duration: 100, // 100ms
      };

      slowService.trackCacheOperation(context);

      const metrics = slowService.getMetrics();
      expect(metrics.slowOperations).toBe(1);
    });

    it('should calculate average response time', () => {
      const responseTimes = [10, 20, 30, 40, 50];

      responseTimes.forEach((time, index) => {
        const context: CacheContext = {
          id: `response-time-${index}`,
          timestamp: new Date(),
          operation: CacheOperation.GET,
          key: `key:${index}`,
          hit: true,
          startTime: new Date(),
          duration: time,
        };

        service.trackCacheOperation(context);
      });

      const metrics = service.getMetrics();
      expect(metrics.averageResponseTime).toBe(30); // (10+20+30+40+50)/5
    });
  });

  describe('alerting system', () => {
    it('should generate hit rate alerts', (done) => {
      const alertConfig = {
        ...defaultCacheWatcherConfig,
        alertThresholds: {
          hitRate: 80, // 80% threshold
          missRate: 20,
          avgResponseTime: 100,
          errorRate: 5,
          memoryUsage: 80,
          connectionCount: 100,
          timeWindow: 300000,
        },
      };

      const alertService = new CacheWatcherService(
        telescopeService,
        alertConfig
      );

      alertService.getAlertsStream().subscribe(alert => {
        expect(alert.type).toBe('hit_rate');
        expect(alert.severity).toBe('medium');
        expect(alert.message).toContain('hit rate below threshold');
        done();
      });

      // Create operations with low hit rate (20%)
      for (let i = 0; i < 5; i++) {
        const context: CacheContext = {
          id: `low-hit-${i}`,
          timestamp: new Date(),
          operation: CacheOperation.GET,
          key: `key:${i}`,
          hit: i === 0, // Only first one is a hit
          startTime: new Date(),
          duration: 10,
        };

        alertService.trackCacheOperation(context);
      }
    });

    it('should generate slow operation alerts', (done) => {
      const alertConfig = {
        ...defaultCacheWatcherConfig,
        alertThresholds: {
          hitRate: 0, // Low threshold to avoid hit rate alerts
          missRate: 100,
          avgResponseTime: 50, // 50ms threshold
          errorRate: 100,
          memoryUsage: 100,
          connectionCount: 1000,
          timeWindow: 300000,
        },
      };

      const alertService = new CacheWatcherService(
        telescopeService,
        alertConfig
      );

      alertService.getAlertsStream().subscribe(alert => {
        expect(alert.type).toBe('slow_operations');
        expect(alert.severity).toBe('medium');
        expect(alert.message).toContain('Slow cache operation');
        done();
      });

      const context: CacheContext = {
        id: 'slow-alert-1',
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: 'slow:key',
        hit: true,
        startTime: new Date(),
        duration: 100, // 100ms (above threshold)
      };

      alertService.trackCacheOperation(context);
    });
  });

  describe('health calculation', () => {
    it('should calculate cache health correctly', () => {
      // Add operations with good performance
      const goodOperations = [
        { hit: true, duration: 5 },
        { hit: true, duration: 8 },
        { hit: true, duration: 6 },
        { hit: false, duration: 15 },
      ];

      goodOperations.forEach((op, index) => {
        const context: CacheContext = {
          id: `health-${index}`,
          timestamp: new Date(),
          operation: CacheOperation.GET,
          key: `key:${index}`,
          hit: op.hit,
          startTime: new Date(),
          duration: op.duration,
          cacheInstance: 'test-cache',
        };

        service.trackCacheOperation(context);
      });

      const health = service.getCacheHealth('test-cache');
      expect(health).toBeDefined();
      expect(Array.isArray(health)).toBe(false);
      
      const cacheHealth = health as any;
      expect(cacheHealth.instance).toBe('test-cache');
      expect(cacheHealth.status).toBe('healthy');
      expect(cacheHealth.score).toBeGreaterThan(70);
    });

    it('should return all cache instances health', () => {
      const instances = ['cache-1', 'cache-2'];
      
      instances.forEach((instance, index) => {
        const context: CacheContext = {
          id: `multi-health-${index}`,
          timestamp: new Date(),
          operation: CacheOperation.GET,
          key: `key:${index}`,
          hit: true,
          startTime: new Date(),
          duration: 10,
          cacheInstance: instance,
        };

        service.trackCacheOperation(context);
      });

      const allHealth = service.getCacheHealth();
      expect(Array.isArray(allHealth)).toBe(true);
      expect((allHealth as any[]).length).toBe(2);
    });
  });

  describe('public API', () => {
    it('should provide metrics stream', (done) => {
      const metricsStream = service.getMetricsStream();
      
      metricsStream.subscribe(metrics => {
        expect(metrics).toBeDefined();
        expect(metrics.totalOperations).toBeGreaterThanOrEqual(0);
        done();
      });

      // Trigger metrics update
      const context: CacheContext = {
        id: 'stream-test',
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: 'stream:key',
        hit: true,
        startTime: new Date(),
      };

      service.trackCacheOperation(context);
    });

    it('should return recent operations', () => {
      const operations = Array.from({ length: 5 }, (_, i) => ({
        id: `recent-${i}`,
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: `key:${i}`,
        hit: true,
        startTime: new Date(),
      }));

      operations.forEach(op => service.trackCacheOperation(op));

      const recent = service.getRecentOperations(3);
      expect(recent).toHaveLength(3);
      expect(recent[0].id).toBe('recent-4'); // Most recent first
    });

    it('should return operations by type', () => {
      const operations = [
        { operation: CacheOperation.GET },
        { operation: CacheOperation.SET },
        { operation: CacheOperation.GET },
      ];

      operations.forEach((op, index) => {
        const context: CacheContext = {
          id: `type-${index}`,
          timestamp: new Date(),
          operation: op.operation,
          key: `key:${index}`,
          hit: true,
          startTime: new Date(),
        };

        service.trackCacheOperation(context);
      });

      const getOps = service.getOperationsByType(CacheOperation.GET);
      expect(getOps).toHaveLength(2);
      expect(getOps.every(op => op.operation === CacheOperation.GET)).toBe(true);
    });

    it('should acknowledge alerts', () => {
      const alerts: any[] = [];
      service.getAlertsStream().subscribe(alert => alerts.push(alert));

      // Generate an alert
      const context: CacheContext = {
        id: 'alert-test',
        timestamp: new Date(),
        operation: CacheOperation.GET,
        key: 'alert:key',
        hit: true,
        startTime: new Date(),
        duration: 200, // Slow operation
      };

      service.trackCacheOperation(context);

      // Wait for alert to be generated
      setTimeout(() => {
        if (alerts.length > 0) {
          const alert = alerts[0];
          
          const acknowledged = service.acknowledgeAlert(alert.id);
          expect(acknowledged).toBe(true);
          expect(alert.acknowledged).toBe(true);
        }
      }, 100);
    });
  });

  describe('cleanup and resource management', () => {
    it('should cleanup on destroy', () => {
      const destroySpy = jest.spyOn((service as any).destroy$, 'next');
      const completeSpy = jest.spyOn((service as any).destroy$, 'complete');

      service.onModuleDestroy();

      expect(destroySpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
    });

    it('should limit history size', () => {
      const maxSize = (service as any).maxHistorySize;
      
      // Add more operations than the limit
      for (let i = 0; i < maxSize + 100; i++) {
        const context: CacheContext = {
          id: `cleanup-${i}`,
          timestamp: new Date(),
          operation: CacheOperation.GET,
          key: `key:${i}`,
          hit: true,
          startTime: new Date(),
        };
        service.trackCacheOperation(context);
      }

      const history = (service as any).cacheHistory;
      expect(history.length).toBeLessThanOrEqual(maxSize);
    });
  });
});
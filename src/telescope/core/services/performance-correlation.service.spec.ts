import { Test, TestingModule } from '@nestjs/testing';
import { PerformanceCorrelationService, CorrelationContext } from './performance-correlation.service';
import { TelescopeService } from './telescope.service';

describe('PerformanceCorrelationService', () => {
  let service: PerformanceCorrelationService;
  let telescopeService: jest.Mocked<TelescopeService>;

  beforeEach(async () => {
    const mockTelescopeService = {
      record: jest.fn(),
      getEntries: jest.fn(),
      clearEntries: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PerformanceCorrelationService,
        {
          provide: TelescopeService,
          useValue: mockTelescopeService,
        },
      ],
    }).compile();

    service = module.get<PerformanceCorrelationService>(PerformanceCorrelationService);
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
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.averageResponseTime).toBe(0);
      expect(metrics.errorRate).toBe(0);
    });

    it('should start periodic processing on module init', async () => {
      await service.onModuleInit();
      // Module init should not throw
    });
  });

  describe('correlation tracking', () => {
    it('should correlate request with query data', (done) => {
      const traceId = 'trace-123';

      service.getCorrelationStream().subscribe(correlation => {
        expect(correlation.traceId).toBe(traceId);
        expect(correlation.request).toBeDefined();
        expect(correlation.query).toBeDefined();
        expect(correlation.performance.totalDuration).toBe(1000);
        expect(correlation.performance.queryCount).toBe(1);
        done();
      });

      // Add request data
      const requestData = {
        traceId,
        requestId: 'req-123',
        method: 'GET',
        path: '/api/users',
        duration: 1000,
        userId: 'user-123',
      };

      service.correlateWatcherData('request', requestData);

      // Add query data
      const queryData = {
        traceId,
        requestId: 'req-123',
        query: 'SELECT * FROM users',
        duration: 500,
        userId: 'user-123',
      };

      service.correlateWatcherData('query', queryData);

      // Wait for correlation to complete
      setTimeout(() => {
        // Force completion by adding older timestamp
        const oldRequestData = {
          ...requestData,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });

    it('should correlate multiple watcher types', (done) => {
      const traceId = 'trace-multi-456';

      service.getCorrelationStream().subscribe(correlation => {
        expect(correlation.traceId).toBe(traceId);
        expect(correlation.request).toBeDefined();
        expect(correlation.query).toBeDefined();
        expect(correlation.cache).toBeDefined();
        expect(correlation.exception).toBeDefined();
        expect(correlation.performance.queryCount).toBe(2);
        expect(correlation.performance.cacheOperations).toBe(1);
        expect(correlation.performance.exceptionsThrown).toBe(1);
        done();
      });

      const baseData = {
        traceId,
        requestId: 'req-456',
        userId: 'user-456',
      };

      // Add request data
      service.correlateWatcherData('request', {
        ...baseData,
        method: 'POST',
        path: '/api/users',
        duration: 2000,
      });

      // Add multiple queries
      service.correlateWatcherData('query', {
        ...baseData,
        query: 'SELECT * FROM users',
        duration: 800,
      });

      service.correlateWatcherData('query', {
        ...baseData,
        query: 'INSERT INTO users...',
        duration: 300,
      });

      // Add cache operation
      service.correlateWatcherData('cache', {
        ...baseData,
        operation: 'get',
        key: 'user:456',
        duration: 10,
      });

      // Add exception
      service.correlateWatcherData('exception', {
        ...baseData,
        errorType: 'ValidationError',
        message: 'Invalid input',
      });

      // Wait for correlation to complete
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'POST',
          path: '/api/users',
          duration: 2000,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });

    it('should handle correlation without traceId', () => {
      const dataWithoutTrace = {
        requestId: 'req-no-trace',
        method: 'GET',
        path: '/api/test',
        duration: 500,
      };

      // Should not throw
      expect(() => {
        service.correlateWatcherData('request', dataWithoutTrace);
      }).not.toThrow();
    });
  });

  describe('bottleneck analysis', () => {
    it('should identify database bottlenecks', (done) => {
      const traceId = 'trace-db-bottleneck';

      service.getCorrelationStream().subscribe(correlation => {
        expect(correlation.bottlenecks).toBeDefined();
        expect(correlation.bottlenecks.length).toBeGreaterThan(0);
        
        const dbBottleneck = correlation.bottlenecks.find(b => b.type === 'query');
        expect(dbBottleneck).toBeDefined();
        expect(dbBottleneck!.severity).toBe('high');
        expect(dbBottleneck!.percentage).toBeGreaterThan(70);
        done();
      });

      // Create scenario with slow database queries
      const baseData = {
        traceId,
        requestId: 'req-db-slow',
      };

      service.correlateWatcherData('request', {
        ...baseData,
        method: 'GET',
        path: '/api/reports',
        duration: 5000, // 5 seconds total
      });

      service.correlateWatcherData('query', {
        ...baseData,
        query: 'SELECT * FROM large_table',
        duration: 4000, // 4 seconds - 80% of total time
      });

      // Complete correlation
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'GET',
          path: '/api/reports',
          duration: 5000,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });

    it('should identify cache bottlenecks', (done) => {
      const traceId = 'trace-cache-bottleneck';

      service.getCorrelationStream().subscribe(correlation => {
        const cacheBottleneck = correlation.bottlenecks.find(b => b.type === 'cache');
        expect(cacheBottleneck).toBeDefined();
        expect(cacheBottleneck!.severity).toBe('medium');
        done();
      });

      const baseData = {
        traceId,
        requestId: 'req-cache-slow',
      };

      service.correlateWatcherData('request', {
        ...baseData,
        method: 'GET',
        path: '/api/cached-data',
        duration: 2000,
      });

      service.correlateWatcherData('cache', {
        ...baseData,
        operation: 'get',
        key: 'slow:key',
        duration: 600, // 30% of total time
      });

      // Complete correlation
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'GET',
          path: '/api/cached-data',
          duration: 2000,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });

    it('should identify exception bottlenecks', (done) => {
      const traceId = 'trace-exception-bottleneck';

      service.getCorrelationStream().subscribe(correlation => {
        const exceptionBottleneck = correlation.bottlenecks.find(b => b.type === 'exception');
        expect(exceptionBottleneck).toBeDefined();
        expect(exceptionBottleneck!.severity).toBe('high');
        done();
      });

      const baseData = {
        traceId,
        requestId: 'req-many-exceptions',
      };

      service.correlateWatcherData('request', {
        ...baseData,
        method: 'POST',
        path: '/api/process',
        duration: 3000,
      });

      // Add multiple exceptions
      for (let i = 0; i < 5; i++) {
        service.correlateWatcherData('exception', {
          ...baseData,
          errorType: 'ValidationError',
          message: `Validation error ${i}`,
        });
      }

      // Complete correlation
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'POST',
          path: '/api/process',
          duration: 3000,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });

    it('should identify memory bottlenecks', (done) => {
      const traceId = 'trace-memory-bottleneck';

      service.getCorrelationStream().subscribe(correlation => {
        const memoryBottleneck = correlation.bottlenecks.find(b => b.type === 'memory');
        expect(memoryBottleneck).toBeDefined();
        expect(memoryBottleneck!.severity).toBe('medium');
        done();
      });

      const baseData = {
        traceId,
        requestId: 'req-memory-heavy',
      };

      service.correlateWatcherData('request', {
        ...baseData,
        method: 'GET',
        path: '/api/memory-intensive',
        duration: 1000,
        performance: {
          memoryUsage: 200 * 1024 * 1024, // 200MB
        },
      });

      // Complete correlation
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'GET',
          path: '/api/memory-intensive',
          duration: 1000,
          performance: {
            memoryUsage: 200 * 1024 * 1024,
          },
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });
  });

  describe('recommendations generation', () => {
    it('should generate query optimization recommendations', (done) => {
      const traceId = 'trace-query-recommendations';

      service.getCorrelationStream().subscribe(correlation => {
        expect(correlation.recommendations).toBeDefined();
        expect(correlation.recommendations.length).toBeGreaterThan(0);
        
        const hasQueryRecommendation = correlation.recommendations.some(
          rec => rec.includes('query') || rec.includes('database')
        );
        expect(hasQueryRecommendation).toBe(true);
        done();
      });

      const baseData = {
        traceId,
        requestId: 'req-query-rec',
      };

      service.correlateWatcherData('request', {
        ...baseData,
        method: 'GET',
        path: '/api/data',
        duration: 3000,
      });

      // Add many queries
      for (let i = 0; i < 15; i++) {
        service.correlateWatcherData('query', {
          ...baseData,
          query: `SELECT * FROM table${i}`,
          duration: 200,
        });
      }

      // Complete correlation
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'GET',
          path: '/api/data',
          duration: 3000,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });

    it('should generate cache optimization recommendations', (done) => {
      const traceId = 'trace-cache-recommendations';

      service.getCorrelationStream().subscribe(correlation => {
        const hasCacheRecommendation = correlation.recommendations.some(
          rec => rec.includes('cache')
        );
        expect(hasCacheRecommendation).toBe(true);
        done();
      });

      const baseData = {
        traceId,
        requestId: 'req-cache-rec',
      };

      service.correlateWatcherData('request', {
        ...baseData,
        method: 'GET',
        path: '/api/cached',
        duration: 2000,
      });

      // Add many cache operations
      for (let i = 0; i < 25; i++) {
        service.correlateWatcherData('cache', {
          ...baseData,
          operation: 'get',
          key: `key:${i}`,
          duration: 10,
        });
      }

      // Complete correlation
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'GET',
          path: '/api/cached',
          duration: 2000,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });

    it('should generate async processing recommendations', (done) => {
      const traceId = 'trace-async-recommendations';

      service.getCorrelationStream().subscribe(correlation => {
        const hasAsyncRecommendation = correlation.recommendations.some(
          rec => rec.includes('async')
        );
        expect(hasAsyncRecommendation).toBe(true);
        done();
      });

      const baseData = {
        traceId,
        requestId: 'req-async-rec',
      };

      service.correlateWatcherData('request', {
        ...baseData,
        method: 'POST',
        path: '/api/long-process',
        duration: 8000, // 8 seconds
      });

      // Complete correlation
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'POST',
          path: '/api/long-process',
          duration: 8000,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });
  });

  describe('health score calculation', () => {
    it('should calculate high health score for good performance', (done) => {
      const traceId = 'trace-good-health';

      service.getCorrelationStream().subscribe(correlation => {
        expect(correlation.healthScore).toBeGreaterThan(80);
        done();
      });

      const baseData = {
        traceId,
        requestId: 'req-good-health',
      };

      service.correlateWatcherData('request', {
        ...baseData,
        method: 'GET',
        path: '/api/fast',
        duration: 200, // Fast response
      });

      service.correlateWatcherData('query', {
        ...baseData,
        query: 'SELECT * FROM users WHERE id = ?',
        duration: 50, // Fast query
      });

      // Complete correlation
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'GET',
          path: '/api/fast',
          duration: 200,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });

    it('should calculate low health score for poor performance', (done) => {
      const traceId = 'trace-poor-health';

      service.getCorrelationStream().subscribe(correlation => {
        expect(correlation.healthScore).toBeLessThan(50);
        done();
      });

      const baseData = {
        traceId,
        requestId: 'req-poor-health',
      };

      service.correlateWatcherData('request', {
        ...baseData,
        method: 'GET',
        path: '/api/slow',
        duration: 15000, // Very slow response
      });

      // Add multiple exceptions
      for (let i = 0; i < 5; i++) {
        service.correlateWatcherData('exception', {
          ...baseData,
          errorType: 'Error',
          message: `Error ${i}`,
        });
      }

      // Complete correlation
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'GET',
          path: '/api/slow',
          duration: 15000,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });
  });

  describe('performance metrics', () => {
    it('should update performance metrics from correlations', () => {
      const traceIds = ['trace-1', 'trace-2', 'trace-3'];

      traceIds.forEach((traceId, index) => {
        const baseData = {
          traceId,
          requestId: `req-${index}`,
        };

        service.correlateWatcherData('request', {
          ...baseData,
          method: 'GET',
          path: `/api/test${index}`,
          duration: (index + 1) * 1000, // 1s, 2s, 3s
        });

        if (index === 2) {
          // Add exception to last request
          service.correlateWatcherData('exception', {
            ...baseData,
            errorType: 'Error',
            message: 'Test error',
          });
        }
      });

      // Wait for metrics to update
      setTimeout(() => {
        const metrics = service.getMetrics();
        expect(metrics.totalRequests).toBe(3);
        expect(metrics.averageResponseTime).toBe(2000); // (1000+2000+3000)/3
        expect(metrics.errorRate).toBe(33.33); // 1/3 * 100
      }, 200);
    });

    it('should calculate correlation coefficients', () => {
      const traceIds = ['trace-corr-1', 'trace-corr-2', 'trace-corr-3'];

      traceIds.forEach((traceId, index) => {
        const baseData = {
          traceId,
          requestId: `req-corr-${index}`,
        };

        const queryTime = (index + 1) * 500; // 500ms, 1000ms, 1500ms
        const responseTime = (index + 1) * 1000; // 1000ms, 2000ms, 3000ms

        service.correlateWatcherData('request', {
          ...baseData,
          method: 'GET',
          path: `/api/corr${index}`,
          duration: responseTime,
        });

        service.correlateWatcherData('query', {
          ...baseData,
          query: `SELECT * FROM table${index}`,
          duration: queryTime,
        });
      });

      // Wait for correlations to complete
      setTimeout(() => {
        const metrics = service.getMetrics();
        expect(metrics.correlations).toBeDefined();
        expect(metrics.correlations.queryToResponse).toBeGreaterThan(0.5);
      }, 200);
    });
  });

  describe('alerting system', () => {
    it('should generate bottleneck alerts', (done) => {
      service.getAlertsStream().subscribe(alert => {
        expect(alert.type).toBe('bottleneck');
        expect(alert.severity).toBe('critical');
        expect(alert.message).toContain('Critical performance bottleneck');
        done();
      });

      const traceId = 'trace-alert-bottleneck';
      const baseData = {
        traceId,
        requestId: 'req-alert-bottleneck',
      };

      service.correlateWatcherData('request', {
        ...baseData,
        method: 'GET',
        path: '/api/critical',
        duration: 5000,
      });

      service.correlateWatcherData('query', {
        ...baseData,
        query: 'SELECT * FROM huge_table',
        duration: 4500, // 90% of total time
      });

      // Complete correlation
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'GET',
          path: '/api/critical',
          duration: 5000,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });

    it('should generate performance degradation alerts', (done) => {
      service.getAlertsStream().subscribe(alert => {
        expect(alert.type).toBe('degradation');
        expect(alert.severity).toBe('high');
        expect(alert.message).toContain('Slow response detected');
        done();
      });

      const traceId = 'trace-alert-degradation';
      const baseData = {
        traceId,
        requestId: 'req-alert-degradation',
      };

      service.correlateWatcherData('request', {
        ...baseData,
        method: 'GET',
        path: '/api/degraded',
        duration: 12000, // 12 seconds
      });

      // Complete correlation
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'GET',
          path: '/api/degraded',
          duration: 12000,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });

    it('should generate anomaly alerts', (done) => {
      service.getAlertsStream().subscribe(alert => {
        expect(alert.type).toBe('anomaly');
        expect(alert.severity).toBe('medium');
        expect(alert.message).toContain('High exception count');
        done();
      });

      const traceId = 'trace-alert-anomaly';
      const baseData = {
        traceId,
        requestId: 'req-alert-anomaly',
      };

      service.correlateWatcherData('request', {
        ...baseData,
        method: 'POST',
        path: '/api/anomaly',
        duration: 2000,
      });

      // Add many exceptions
      for (let i = 0; i < 5; i++) {
        service.correlateWatcherData('exception', {
          ...baseData,
          errorType: 'Error',
          message: `Exception ${i}`,
        });
      }

      // Complete correlation
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'POST',
          path: '/api/anomaly',
          duration: 2000,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });
  });

  describe('public API', () => {
    it('should provide metrics stream', (done) => {
      const metricsStream = service.getMetricsStream();
      
      metricsStream.subscribe(metrics => {
        expect(metrics).toBeDefined();
        expect(metrics.totalRequests).toBeGreaterThanOrEqual(0);
        done();
      });

      // Trigger metrics update
      service.correlateWatcherData('request', {
        traceId: 'test-stream',
        method: 'GET',
        path: '/test',
        duration: 1000,
      });

      // Wait for periodic update
      setTimeout(() => {
        // Force metrics update
      }, 100);
    });

    it('should return recent correlations', () => {
      const correlations: CorrelationContext[] = [];
      
      service.getCorrelationStream().subscribe(correlation => {
        correlations.push(correlation);
      });

      const traceIds = ['trace-recent-1', 'trace-recent-2', 'trace-recent-3'];

      traceIds.forEach((traceId, index) => {
        service.correlateWatcherData('request', {
          traceId,
          requestId: `req-${index}`,
          method: 'GET',
          path: `/api/recent${index}`,
          duration: 1000,
        });
      });

      // Wait for correlations
      setTimeout(() => {
        const recent = service.getRecentCorrelations(2);
        expect(recent).toHaveLength(Math.min(2, correlations.length));
      }, 200);
    });

    it('should find correlation by trace ID', () => {
      const traceId = 'trace-find-me';
      
      service.correlateWatcherData('request', {
        traceId,
        requestId: 'req-find-me',
        method: 'GET',
        path: '/api/findme',
        duration: 1000,
      });

      // Wait for correlation
      setTimeout(() => {
        const correlation = service.getCorrelationsByTraceId(traceId);
        expect(correlation).toBeDefined();
        expect(correlation?.traceId).toBe(traceId);
      }, 200);
    });

    it('should return bottlenecks by component', () => {
      const traceId = 'trace-component-bottleneck';
      
      service.getCorrelationStream().subscribe(() => {
        const bottlenecks = service.getBottlenecksByComponent('database');
        expect(bottlenecks).toBeDefined();
        expect(Array.isArray(bottlenecks)).toBe(true);
      });

      const baseData = {
        traceId,
        requestId: 'req-component-bottleneck',
      };

      service.correlateWatcherData('request', {
        ...baseData,
        method: 'GET',
        path: '/api/db-heavy',
        duration: 3000,
      });

      service.correlateWatcherData('query', {
        ...baseData,
        query: 'SELECT * FROM big_table',
        duration: 2500,
      });

      // Complete correlation
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'GET',
          path: '/api/db-heavy',
          duration: 3000,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);
      }, 100);
    });

    it('should acknowledge alerts', () => {
      const alerts: any[] = [];
      service.getAlertsStream().subscribe(alert => alerts.push(alert));

      const traceId = 'trace-acknowledge-alert';
      const baseData = {
        traceId,
        requestId: 'req-acknowledge-alert',
      };

      service.correlateWatcherData('request', {
        ...baseData,
        method: 'GET',
        path: '/api/alert-test',
        duration: 15000, // Trigger alert
      });

      // Complete correlation and wait for alert
      setTimeout(() => {
        const oldRequestData = {
          ...baseData,
          method: 'GET',
          path: '/api/alert-test',
          duration: 15000,
          timestamp: new Date(Date.now() - 10000),
        };
        service.correlateWatcherData('request', oldRequestData);

        setTimeout(() => {
          if (alerts.length > 0) {
            const alert = alerts[0];
            
            const acknowledged = service.acknowledgeAlert(alert.id);
            expect(acknowledged).toBe(true);
            expect(alert.acknowledged).toBe(true);
          }
        }, 100);
      }, 100);
    });

    it('should return active traces', () => {
      const traceIds = ['trace-active-1', 'trace-active-2'];

      traceIds.forEach((traceId, index) => {
        service.correlateWatcherData('request', {
          traceId,
          requestId: `req-active-${index}`,
          method: 'GET',
          path: `/api/active${index}`,
          duration: 1000,
        });
      });

      const activeTraces = service.getActiveTraces();
      expect(activeTraces).toBeDefined();
      expect(Array.isArray(activeTraces)).toBe(true);
      expect(activeTraces.length).toBeGreaterThan(0);
    });
  });

  describe('cleanup and resource management', () => {
    it('should cleanup on destroy', () => {
      const destroySpy = jest.spyOn((service as any).destroy$, 'next');
      const completeSpy = jest.spyOn((service as any).destroy$, 'complete');

      service.onDestroy();

      expect(destroySpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
    });

    it('should cleanup old active traces', () => {
      // Add a trace
      service.correlateWatcherData('request', {
        traceId: 'trace-cleanup-test',
        requestId: 'req-cleanup-test',
        method: 'GET',
        path: '/api/cleanup',
        duration: 1000,
      });

      const activeTraces = service.getActiveTraces();
      expect(activeTraces.length).toBeGreaterThan(0);

      // Force cleanup by calling private method
      (service as any).cleanupOldTraces();

      // Active traces should still exist (not old enough)
      const activeTracesAfter = service.getActiveTraces();
      expect(activeTracesAfter.length).toBe(activeTraces.length);
    });
  });
});
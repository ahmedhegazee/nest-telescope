import { Test, TestingModule } from '@nestjs/testing';
import { ExceptionWatcherService } from './exception-watcher.service';
import { TelescopeService } from '../../core/services/telescope.service';
import { ExceptionContext, ErrorSeverity, ErrorCategory } from './exception-watcher.filter';
import { ExceptionWatcherConfig, defaultExceptionWatcherConfig } from './exception-watcher.config';

describe('ExceptionWatcherService', () => {
  let service: ExceptionWatcherService;
  let telescopeService: jest.Mocked<TelescopeService>;

  beforeEach(async () => {
    const mockTelescopeService = {
      record: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExceptionWatcherService,
        {
          provide: TelescopeService,
          useValue: mockTelescopeService,
        },
        {
          provide: 'EXCEPTION_WATCHER_CONFIG',
          useValue: defaultExceptionWatcherConfig,
        },
      ],
    }).compile();

    service = module.get<ExceptionWatcherService>(ExceptionWatcherService);
    telescopeService = module.get(TelescopeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Clean up any global listeners
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize with default metrics', () => {
      const metrics = service.getMetrics();
      expect(metrics.totalExceptions).toBe(0);
      expect(metrics.uniqueExceptions).toBe(0);
      expect(metrics.errorRate).toBe(0);
      expect(metrics.criticalErrors).toBe(0);
    });

    it('should setup global exception handlers on module init', async () => {
      const originalProcessOn = process.on;
      process.on = jest.fn();

      await service.onModuleInit();

      expect(process.on).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
      expect(process.on).toHaveBeenCalledWith('uncaughtException', expect.any(Function));

      process.on = originalProcessOn;
    });

    it('should not setup handlers if config disabled', async () => {
      const disabledConfig = {
        ...defaultExceptionWatcherConfig,
        captureUnhandledRejections: false,
        captureUncaughtExceptions: false,
      };

      const disabledService = new ExceptionWatcherService(
        telescopeService,
        disabledConfig
      );

      const originalProcessOn = process.on;
      process.on = jest.fn();

      await disabledService.onModuleInit();

      expect(process.on).not.toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
      expect(process.on).not.toHaveBeenCalledWith('uncaughtException', expect.any(Function));

      process.on = originalProcessOn;
    });
  });

  describe('exception tracking', () => {
    it('should track exception with full context', () => {
      const context: ExceptionContext = {
        id: 'test-exception-1',
        timestamp: new Date(),
        error: new Error('Test error'),
        errorType: 'Error',
        errorMessage: 'Test error',
        statusCode: 500,
        classification: {
          type: 'system' as any,
          category: ErrorCategory.SERVER_ERROR,
          severity: ErrorSeverity.HIGH,
          fingerprint: 'test-fingerprint',
          groupId: 'test-group',
        },
        traceId: 'trace-123',
        requestId: 'req-456',
        userId: 'user-789',
      };

      service.trackException(context);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'exception',
          content: expect.objectContaining({
            exception: expect.objectContaining({
              id: 'test-exception-1',
              type: 'Error',
              message: 'Test error',
            }),
          }),
        })
      );

      const metrics = service.getMetrics();
      expect(metrics.totalExceptions).toBe(1);
      expect(metrics.highSeverityErrors).toBe(1);
    });

    it('should not track exception if disabled', () => {
      const disabledConfig = {
        ...defaultExceptionWatcherConfig,
        enabled: false,
      };

      const disabledService = new ExceptionWatcherService(
        telescopeService,
        disabledConfig
      );

      const context: ExceptionContext = {
        id: 'test-exception-1',
        timestamp: new Date(),
        error: new Error('Test error'),
        errorType: 'Error',
        errorMessage: 'Test error',
      };

      disabledService.trackException(context);

      expect(telescopeService.record).not.toHaveBeenCalled();
    });

    it('should handle tracking errors gracefully', () => {
      telescopeService.record.mockImplementation(() => {
        throw new Error('Telescope service error');
      });

      const context: ExceptionContext = {
        id: 'test-exception-1',
        timestamp: new Date(),
        error: new Error('Test error'),
        errorType: 'Error',
        errorMessage: 'Test error',
      };

      expect(() => service.trackException(context)).not.toThrow();
    });
  });

  describe('error grouping', () => {
    it('should group similar exceptions', () => {
      const context1: ExceptionContext = {
        id: 'exception-1',
        timestamp: new Date(),
        error: new Error('Database connection failed'),
        errorType: 'DatabaseError',
        errorMessage: 'Database connection failed',
        classification: {
          type: 'database' as any,
          category: ErrorCategory.DATABASE_ERROR,
          severity: ErrorSeverity.HIGH,
          fingerprint: 'db-fingerprint',
          groupId: 'db-group-1',
        },
      };

      const context2: ExceptionContext = {
        id: 'exception-2',
        timestamp: new Date(),
        error: new Error('Database connection failed'),
        errorType: 'DatabaseError',
        errorMessage: 'Database connection failed',
        classification: {
          type: 'database' as any,
          category: ErrorCategory.DATABASE_ERROR,
          severity: ErrorSeverity.HIGH,
          fingerprint: 'db-fingerprint',
          groupId: 'db-group-1',
        },
      };

      service.trackException(context1);
      service.trackException(context2);

      const groups = service.getExceptionGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].count).toBe(2);
      expect(groups[0].groupId).toBe('db-group-1');
    });

    it('should track affected users and requests', () => {
      const context1: ExceptionContext = {
        id: 'exception-1',
        timestamp: new Date(),
        error: new Error('Test error'),
        errorType: 'Error',
        errorMessage: 'Test error',
        userId: 'user-1',
        requestId: 'req-1',
        classification: {
          type: 'system' as any,
          category: ErrorCategory.SERVER_ERROR,
          severity: ErrorSeverity.MEDIUM,
          fingerprint: 'test-fingerprint',
          groupId: 'test-group',
        },
      };

      const context2: ExceptionContext = {
        id: 'exception-2',
        timestamp: new Date(),
        error: new Error('Test error'),
        errorType: 'Error',
        errorMessage: 'Test error',
        userId: 'user-2',
        requestId: 'req-2',
        classification: {
          type: 'system' as any,
          category: ErrorCategory.SERVER_ERROR,
          severity: ErrorSeverity.MEDIUM,
          fingerprint: 'test-fingerprint',
          groupId: 'test-group',
        },
      };

      service.trackException(context1);
      service.trackException(context2);

      const group = service.getExceptionGroup('test-group');
      expect(group).toBeDefined();
      expect(group!.affectedUsers.size).toBe(2);
      expect(group!.affectedRequests).toHaveLength(2);
    });
  });

  describe('metrics calculation', () => {
    it('should calculate error rates correctly', () => {
      const contexts = Array.from({ length: 10 }, (_, i) => ({
        id: `exception-${i}`,
        timestamp: new Date(),
        error: new Error(`Test error ${i}`),
        errorType: 'Error',
        errorMessage: `Test error ${i}`,
        classification: {
          type: 'system' as any,
          category: ErrorCategory.SERVER_ERROR,
          severity: i < 5 ? ErrorSeverity.HIGH : ErrorSeverity.LOW,
          fingerprint: `fingerprint-${i}`,
          groupId: `group-${i}`,
        },
      }));

      contexts.forEach(context => service.trackException(context));

      const metrics = service.getMetrics();
      expect(metrics.totalExceptions).toBe(10);
      expect(metrics.uniqueExceptions).toBe(10);
      expect(metrics.highSeverityErrors).toBe(5);
      expect(metrics.lowSeverityErrors).toBe(5);
    });

    it('should track top errors correctly', () => {
      // Create exceptions with different frequencies
      const createException = (id: string, groupId: string, count: number) => {
        for (let i = 0; i < count; i++) {
          const context: ExceptionContext = {
            id: `${id}-${i}`,
            timestamp: new Date(),
            error: new Error(`Error ${id}`),
            errorType: 'Error',
            errorMessage: `Error ${id}`,
            classification: {
              type: 'system' as any,
              category: ErrorCategory.SERVER_ERROR,
              severity: ErrorSeverity.MEDIUM,
              fingerprint: `fingerprint-${groupId}`,
              groupId,
            },
          };
          service.trackException(context);
        }
      };

      createException('A', 'group-A', 5);
      createException('B', 'group-B', 3);
      createException('C', 'group-C', 7);

      const metrics = service.getMetrics();
      expect(metrics.topErrors).toHaveLength(3);
      expect(metrics.topErrors[0].count).toBe(7); // Group C should be first
      expect(metrics.topErrors[1].count).toBe(5); // Group A should be second
      expect(metrics.topErrors[2].count).toBe(3); // Group B should be third
    });
  });

  describe('alerting system', () => {
    it('should generate error rate alerts', (done) => {
      const alertConfig = {
        ...defaultExceptionWatcherConfig,
        alertThresholds: {
          errorRate: 0.5, // 0.5 errors per second
          criticalErrors: 10,
          timeWindow: 60000, // 1 minute
        },
      };

      const alertService = new ExceptionWatcherService(telescopeService, alertConfig);

      alertService.getAlertsStream().subscribe(alert => {
        expect(alert.type).toBe('error_rate');
        expect(alert.severity).toBe('high');
        expect(alert.message).toContain('Error rate exceeded threshold');
        done();
      });

      // Create multiple exceptions in quick succession
      for (let i = 0; i < 10; i++) {
        const context: ExceptionContext = {
          id: `exception-${i}`,
          timestamp: new Date(),
          error: new Error(`Test error ${i}`),
          errorType: 'Error',
          errorMessage: `Test error ${i}`,
        };
        alertService.trackException(context);
      }
    });

    it('should generate critical error alerts', (done) => {
      const alertConfig = {
        ...defaultExceptionWatcherConfig,
        alertThresholds: {
          errorRate: 100, // High threshold to avoid rate alerts
          criticalErrors: 2,
          timeWindow: 60000,
        },
      };

      const alertService = new ExceptionWatcherService(telescopeService, alertConfig);

      alertService.getAlertsStream().subscribe(alert => {
        expect(alert.type).toBe('critical_errors');
        expect(alert.severity).toBe('critical');
        expect(alert.message).toContain('Critical errors exceeded threshold');
        done();
      });

      // Create critical exceptions
      for (let i = 0; i < 3; i++) {
        const context: ExceptionContext = {
          id: `critical-exception-${i}`,
          timestamp: new Date(),
          error: new Error(`Critical error ${i}`),
          errorType: 'CriticalError',
          errorMessage: `Critical error ${i}`,
          classification: {
            type: 'system' as any,
            category: ErrorCategory.SYSTEM_ERROR,
            severity: ErrorSeverity.CRITICAL,
            fingerprint: `critical-fingerprint-${i}`,
            groupId: `critical-group-${i}`,
          },
        };
        alertService.trackException(context);
      }
    });

    it('should generate new error alerts', (done) => {
      service.getAlertsStream().subscribe(alert => {
        expect(alert.type).toBe('new_error');
        expect(alert.severity).toBe('medium');
        expect(alert.message).toContain('New error type detected');
        done();
      });

      const context: ExceptionContext = {
        id: 'new-exception',
        timestamp: new Date(),
        error: new Error('New error type'),
        errorType: 'NewErrorType',
        errorMessage: 'New error type',
        classification: {
          type: 'system' as any,
          category: ErrorCategory.SYSTEM_ERROR,
          severity: ErrorSeverity.MEDIUM,
          fingerprint: 'new-fingerprint',
          groupId: 'new-group',
        },
      };

      service.trackException(context);
    });
  });

  describe('correlation', () => {
    it('should correlate exceptions with requests', () => {
      const context: ExceptionContext = {
        id: 'exception-1',
        timestamp: new Date(),
        error: new Error('Test error'),
        errorType: 'Error',
        errorMessage: 'Test error',
        traceId: 'trace-123',
        requestId: 'req-456',
      };

      service.trackException(context);

      // Verify correlation was stored
      expect(context.performance?.requestCorrelationId).toBe('trace-123');
    });

    it('should correlate exceptions with queries', () => {
      const context: ExceptionContext = {
        id: 'exception-1',
        timestamp: new Date(),
        error: new Error('Database error'),
        errorType: 'DatabaseError',
        errorMessage: 'Database error',
        traceId: 'trace-123',
      };

      service.trackException(context);

      // Verify correlation was stored
      expect(context.performance?.queryCorrelationId).toBe('trace-123');
    });

    it('should correlate exceptions with sessions', () => {
      const context: ExceptionContext = {
        id: 'exception-1',
        timestamp: new Date(),
        error: new Error('Session error'),
        errorType: 'SessionError',
        errorMessage: 'Session error',
        sessionId: 'session-789',
      };

      service.trackException(context);

      // Verify correlation was stored
      expect(context.performance?.sessionCorrelationId).toBe('session-789');
    });
  });

  describe('global exception handlers', () => {
    it('should handle unhandled promise rejections', () => {
      const spy = jest.spyOn(service, 'trackException');
      
      // Simulate unhandled rejection
      const error = new Error('Unhandled promise rejection');
      (service as any).handleUnhandledRejection(error, Promise.resolve());

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: 'UnhandledPromiseRejection',
          errorMessage: 'Unhandled promise rejection',
          classification: expect.objectContaining({
            severity: ErrorSeverity.HIGH,
          }),
        })
      );
    });

    it('should handle uncaught exceptions', () => {
      const spy = jest.spyOn(service, 'trackException');
      
      // Simulate uncaught exception
      const error = new Error('Uncaught exception');
      (service as any).handleUncaughtException(error);

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: 'UncaughtException',
          errorMessage: 'Uncaught exception',
          classification: expect.objectContaining({
            severity: ErrorSeverity.CRITICAL,
          }),
        })
      );
    });
  });

  describe('public API', () => {
    it('should provide metrics stream', (done) => {
      const metricsStream = service.getMetricsStream();
      
      metricsStream.subscribe(metrics => {
        expect(metrics).toBeDefined();
        expect(metrics.totalExceptions).toBeGreaterThanOrEqual(0);
        done();
      });

      // Trigger metrics update
      const context: ExceptionContext = {
        id: 'test-exception',
        timestamp: new Date(),
        error: new Error('Test error'),
        errorType: 'Error',
        errorMessage: 'Test error',
      };

      service.trackException(context);
    });

    it('should resolve exception groups', () => {
      const context: ExceptionContext = {
        id: 'exception-1',
        timestamp: new Date(),
        error: new Error('Test error'),
        errorType: 'Error',
        errorMessage: 'Test error',
        classification: {
          type: 'system' as any,
          category: ErrorCategory.SERVER_ERROR,
          severity: ErrorSeverity.MEDIUM,
          fingerprint: 'test-fingerprint',
          groupId: 'test-group',
        },
      };

      service.trackException(context);

      const resolved = service.resolveExceptionGroup('test-group', 'john.doe', 'Fixed the issue');
      expect(resolved).toBe(true);

      const group = service.getExceptionGroup('test-group');
      expect(group?.resolved).toBe(true);
      expect(group?.assignedTo).toBe('john.doe');
      expect(group?.notes).toBe('Fixed the issue');
    });

    it('should acknowledge alerts', () => {
      const alerts: any[] = [];
      service.getAlertsStream().subscribe(alert => alerts.push(alert));

      // Generate an alert
      const context: ExceptionContext = {
        id: 'new-exception',
        timestamp: new Date(),
        error: new Error('New error'),
        errorType: 'NewError',
        errorMessage: 'New error',
        classification: {
          type: 'system' as any,
          category: ErrorCategory.SYSTEM_ERROR,
          severity: ErrorSeverity.MEDIUM,
          fingerprint: 'new-fingerprint',
          groupId: 'new-group',
        },
      };

      service.trackException(context);

      // Wait for alert to be generated
      setTimeout(() => {
        expect(alerts.length).toBeGreaterThan(0);
        const alert = alerts[0];
        
        const acknowledged = service.acknowledgeAlert(alert.id);
        expect(acknowledged).toBe(true);
        expect(alert.acknowledged).toBe(true);
      }, 100);
    });

    it('should return recent exceptions', () => {
      const contexts = Array.from({ length: 5 }, (_, i) => ({
        id: `exception-${i}`,
        timestamp: new Date(),
        error: new Error(`Test error ${i}`),
        errorType: 'Error',
        errorMessage: `Test error ${i}`,
      }));

      contexts.forEach(context => service.trackException(context));

      const recent = service.getRecentExceptions(3);
      expect(recent).toHaveLength(3);
      expect(recent[0].id).toBe('exception-4'); // Most recent first
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

    it('should limit history size', () => {
      const maxSize = (service as any).maxHistorySize;
      
      // Add more exceptions than the limit
      for (let i = 0; i < maxSize + 100; i++) {
        const context: ExceptionContext = {
          id: `exception-${i}`,
          timestamp: new Date(),
          error: new Error(`Test error ${i}`),
          errorType: 'Error',
          errorMessage: `Test error ${i}`,
        };
        service.trackException(context);
      }

      const history = (service as any).exceptionHistory;
      expect(history.length).toBeLessThanOrEqual(maxSize);
    });
  });
});
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionPoolMonitorService } from './connection-pool-monitor.service';
import { DataSource } from 'typeorm';

describe('ConnectionPoolMonitorService', () => {
  let service: ConnectionPoolMonitorService;
  let dataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    const mockPool = {
      config: {
        max: 10,
        min: 2
      },
      acquiredCount: 3,
      idleCount: 2,
      waitingCount: 0,
      on: jest.fn()
    };

    const mockDataSource = {
      options: {
        type: 'postgres'
      },
      driver: {
        pool: mockPool
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionPoolMonitorService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<ConnectionPoolMonitorService>(ConnectionPoolMonitorService);
    dataSource = module.get(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.resetMetrics();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize with default metrics', () => {
      const metrics = service.getMetrics();
      expect(metrics.totalConnections).toBe(0);
      expect(metrics.activeConnections).toBe(0);
      expect(metrics.healthScore).toBe(100);
    });

    it('should setup monitoring on module init', async () => {
      await service.onModuleInit();
      expect((dataSource.driver as any).pool.on).toHaveBeenCalled();
    });
  });

  describe('metrics collection', () => {
    it('should collect basic pool metrics', () => {
      // Simulate pool state
      const pool = (dataSource.driver as any).pool;
      pool.acquiredCount = 3;
      pool.idleCount = 2;
      pool.waitingCount = 0;

      // Trigger metrics collection
      (service as any).collectMetrics();

      const metrics = service.getMetrics();
      expect(metrics.activeConnections).toBe(3);
      expect(metrics.idleConnections).toBe(2);
      expect(metrics.waitingConnections).toBe(0);
      expect(metrics.totalConnections).toBe(5);
    });

    it('should handle missing pool gracefully', () => {
      (dataSource.driver as any).pool = null;

      expect(() => (service as any).collectMetrics()).not.toThrow();
      
      const metrics = service.getMetrics();
      expect(metrics.totalConnections).toBe(0);
    });
  });

  describe('event handling', () => {
    it('should handle connection acquire events', () => {
      const pool = (dataSource.driver as any).pool;
      const mockClient = { id: 'test-client' };

      // Setup event listeners
      (service as any).setupPostgresPoolListeners(pool);

      // Get the registered acquire handler
      const acquireHandler = pool.on.mock.calls.find(call => call[0] === 'acquire')?.[1];
      expect(acquireHandler).toBeDefined();

      // Simulate acquire event
      acquireHandler(mockClient);

      const recentEvents = service.getRecentEvents(10);
      expect(recentEvents).toHaveLength(1);
      expect(recentEvents[0].type).toBe('acquire');
    });

    it('should handle connection release events', () => {
      const pool = (dataSource.driver as any).pool;
      const mockClient = { id: 'test-client' };

      // Setup event listeners
      (service as any).setupPostgresPoolListeners(pool);

      // Get the registered release handler
      const releaseHandler = pool.on.mock.calls.find(call => call[0] === 'release')?.[1];
      expect(releaseHandler).toBeDefined();

      // Simulate release event
      releaseHandler(mockClient);

      const recentEvents = service.getRecentEvents(10);
      expect(recentEvents).toHaveLength(1);
      expect(recentEvents[0].type).toBe('release');
    });

    it('should handle connection error events', () => {
      const pool = (dataSource.driver as any).pool;
      const mockClient = { id: 'test-client' };
      const mockError = new Error('Connection failed');

      // Setup event listeners
      (service as any).setupPostgresPoolListeners(pool);

      // Get the registered error handler
      const errorHandler = pool.on.mock.calls.find(call => call[0] === 'error')?.[1];
      expect(errorHandler).toBeDefined();

      // Simulate error event
      errorHandler(mockError, mockClient);

      const recentEvents = service.getRecentEvents(10);
      expect(recentEvents).toHaveLength(1);
      expect(recentEvents[0].type).toBe('error');
      expect(recentEvents[0].error).toBe('Connection failed');
    });

    it('should handle pools without event system', () => {
      const poolWithoutEvents = {
        config: { max: 10, min: 2 },
        acquiredCount: 0,
        idleCount: 0,
        waitingCount: 0
      };

      expect(() => (service as any).setupPoolEventListeners(poolWithoutEvents)).not.toThrow();
    });
  });

  describe('health score calculation', () => {
    it('should calculate health score based on utilization', () => {
      // Set up high utilization scenario
      const pool = (dataSource.driver as any).pool;
      pool.acquiredCount = 9; // 90% utilization
      pool.idleCount = 1;
      pool.waitingCount = 0;

      (service as any).collectMetrics();

      const metrics = service.getMetrics();
      expect(metrics.healthScore).toBeLessThan(100);
      expect(metrics.healthScore).toBeGreaterThan(50);
    });

    it('should penalize waiting connections', () => {
      const pool = (dataSource.driver as any).pool;
      pool.acquiredCount = 5;
      pool.idleCount = 0;
      pool.waitingCount = 3;

      (service as any).collectMetrics();

      const metrics = service.getMetrics();
      expect(metrics.healthScore).toBeLessThan(85);
    });

    it('should penalize recent errors', () => {
      const pool = (dataSource.driver as any).pool;
      
      // Simulate recent error event
      const errorEvent = {
        type: 'error' as const,
        timestamp: new Date(),
        error: 'Connection failed',
        poolState: { active: 5, idle: 2, waiting: 0 }
      };

      (service as any).recordEvent(errorEvent);
      (service as any).collectMetrics();

      const metrics = service.getMetrics();
      expect(metrics.healthScore).toBeLessThan(95);
    });
  });

  describe('alert system', () => {
    it('should generate high usage alerts', (done) => {
      const pool = (dataSource.driver as any).pool;
      pool.acquiredCount = 9; // 90% utilization
      pool.idleCount = 1;
      pool.waitingCount = 0;

      service.getAlertStream().subscribe(alert => {
        expect(alert.type).toBe('high_usage');
        expect(alert.severity).toBe('critical');
        expect(alert.message).toContain('90.0%');
        done();
      });

      // Trigger alert check
      (service as any).collectMetrics();
      (service as any).checkForAlerts();
    });

    it('should generate pool exhausted alerts', (done) => {
      const pool = (dataSource.driver as any).pool;
      pool.acquiredCount = 10;
      pool.idleCount = 0;
      pool.waitingCount = 3;
      pool.config.max = 10; // Ensure max is set to avoid high usage alert

      service.getAlertStream().subscribe(alert => {
        if (alert.type === 'pool_exhausted') {
          expect(alert.severity).toBe('high');
          expect(alert.message).toContain('3 connections waiting');
          done();
        }
      });

      (service as any).collectMetrics();
      (service as any).checkForAlerts();
    });

    it('should generate connection error alerts', (done) => {
      // Add recent error events
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        const errorEvent = {
          type: 'error' as const,
          timestamp: new Date(now - i * 1000),
          error: 'Connection failed',
          poolState: { active: 5, idle: 2, waiting: 0 }
        };
        (service as any).recordEvent(errorEvent);
      }

      service.getAlertStream().subscribe(alert => {
        expect(alert.type).toBe('connection_error');
        expect(alert.severity).toBe('medium');
        expect(alert.message).toContain('3 connection errors');
        done();
      });

      (service as any).checkForAlerts();
    });

    it('should generate connection leak alerts', (done) => {
      // Simulate long-running connections
      const longTime = Date.now() - 400000; // 6+ minutes ago
      (service as any).connectionCreationTimes.set('conn1', longTime);
      (service as any).connectionCreationTimes.set('conn2', longTime);

      service.getAlertStream().subscribe(alert => {
        expect(alert.type).toBe('connection_leak');
        expect(alert.severity).toBe('medium');
        expect(alert.message).toContain('2 connections have been active');
        done();
      });

      (service as any).checkForAlerts();
    });
  });

  describe('database driver support', () => {
    it('should support PostgreSQL pools', () => {
      const postgresPool = {
        config: { max: 10, min: 2 },
        acquiredCount: 3,
        idleCount: 2,
        waitingCount: 0,
        on: jest.fn()
      };

      expect(() => (service as any).setupPostgresPoolListeners(postgresPool)).not.toThrow();
      expect(postgresPool.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(postgresPool.on).toHaveBeenCalledWith('acquire', expect.any(Function));
      expect(postgresPool.on).toHaveBeenCalledWith('release', expect.any(Function));
      expect(postgresPool.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should support MySQL pools', () => {
      const mysqlPool = {
        config: { max: 10, min: 2 },
        acquiredCount: 3,
        idleCount: 2,
        waitingCount: 0,
        on: jest.fn()
      };

      expect(() => (service as any).setupMySQLPoolListeners(mysqlPool)).not.toThrow();
      expect(mysqlPool.on).toHaveBeenCalledWith('connection', expect.any(Function));
      expect(mysqlPool.on).toHaveBeenCalledWith('acquire', expect.any(Function));
      expect(mysqlPool.on).toHaveBeenCalledWith('release', expect.any(Function));
      expect(mysqlPool.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should handle unsupported database types gracefully', () => {
      (dataSource.options as any).type = 'sqlite';

      expect(() => (service as any).setupPoolEventListeners({})).not.toThrow();
    });
  });

  describe('streams and observables', () => {
    it('should provide metrics stream', (done) => {
      const metricsStream = service.getMetricsStream();
      let updateCount = 0;

      metricsStream.subscribe(metrics => {
        updateCount++;
        expect(metrics).toBeDefined();
        expect(metrics.lastUpdate).toBeInstanceOf(Date);
        
        if (updateCount === 1) {
          done();
        }
      });

      // Trigger metrics update
      (service as any).collectMetrics();
    });

    it('should provide event stream', (done) => {
      const eventStream = service.getEventStream();

      eventStream.subscribe(event => {
        expect(event.type).toBe('acquire');
        expect(event.timestamp).toBeInstanceOf(Date);
        done();
      });

      // Trigger event
      const testEvent = {
        type: 'acquire' as const,
        timestamp: new Date(),
        connectionId: 'test-conn',
        poolState: { active: 1, idle: 1, waiting: 0 }
      };

      (service as any).recordEvent(testEvent);
    });
  });

  describe('connection pool health', () => {
    it('should return healthy status for good metrics', () => {
      const pool = (dataSource.driver as any).pool;
      pool.acquiredCount = 3;
      pool.idleCount = 5;
      pool.waitingCount = 0;
      pool.config.max = 10;

      (service as any).collectMetrics();

      const health = service.getConnectionPoolHealth();
      expect(health.status).toBe('healthy');
      expect(health.score).toBeGreaterThan(70);
      expect(health.issues.length).toBeGreaterThanOrEqual(0);
    });

    it('should return warning status for degraded performance', () => {
      const pool = (dataSource.driver as any).pool;
      pool.acquiredCount = 8; // 80% utilization
      pool.idleCount = 2;
      pool.waitingCount = 0;
      pool.config.max = 10;

      (service as any).collectMetrics();

      const health = service.getConnectionPoolHealth();
      expect(health.status).toBe('warning');
      expect(health.score).toBeLessThan(100);
      expect(health.issues.length).toBeGreaterThan(0);
    });

    it('should return critical status for severe issues', () => {
      const pool = (dataSource.driver as any).pool;
      pool.acquiredCount = 10; // 100% utilization
      pool.idleCount = 0;
      pool.waitingCount = 5;
      pool.config.max = 10;

      // Add some error events
      const errorEvent = {
        type: 'error' as const,
        timestamp: new Date(),
        error: 'Connection failed',
        poolState: { active: 10, idle: 0, waiting: 5 }
      };

      (service as any).recordEvent(errorEvent);
      (service as any).collectMetrics();

      const health = service.getConnectionPoolHealth();
      expect(health.status).toBe('critical');
      expect(health.score).toBeLessThan(80);
      expect(health.issues.length).toBeGreaterThan(0);
      expect(health.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('cleanup and resource management', () => {
    it('should limit event history', () => {
      const maxEvents = 1000;
      
      // Add more events than the limit
      for (let i = 0; i < maxEvents + 100; i++) {
        const event = {
          type: 'acquire' as const,
          timestamp: new Date(),
          connectionId: `conn-${i}`,
          poolState: { active: 1, idle: 1, waiting: 0 }
        };

        (service as any).recordEvent(event);
      }

      const recentEvents = service.getRecentEvents(maxEvents + 100);
      expect(recentEvents.length).toBeLessThanOrEqual(maxEvents);
    });

    it('should reset metrics and cleanup', () => {
      // Add some data
      const event = {
        type: 'acquire' as const,
        timestamp: new Date(),
        connectionId: 'test-conn',
        poolState: { active: 1, idle: 1, waiting: 0 }
      };

      (service as any).recordEvent(event);
      (service as any).acquireTimestamps.set('test-conn', Date.now());
      (service as any).connectionCreationTimes.set('test-conn', Date.now());

      // Verify data exists
      expect(service.getRecentEvents()).toHaveLength(1);
      expect((service as any).acquireTimestamps.size).toBe(1);
      expect((service as any).connectionCreationTimes.size).toBe(1);

      // Reset
      service.resetMetrics();

      // Verify cleanup
      expect(service.getRecentEvents()).toHaveLength(0);
      expect((service as any).acquireTimestamps.size).toBe(0);
      expect((service as any).connectionCreationTimes.size).toBe(0);
    });

    it('should cleanup on module destroy', async () => {
      await service.onModuleDestroy();
      expect((service as any).destroy$.isStopped).toBe(true);
    });
  });

  describe('average calculations', () => {
    it('should calculate average acquire time', () => {
      const now = Date.now();
      
      // Simulate acquire/release cycles
      const connections = ['conn1', 'conn2', 'conn3'];
      connections.forEach((connId, i) => {
        const acquireTime = now - (i + 1) * 1000;
        (service as any).acquireTimestamps.set(connId, acquireTime);
        
        const releaseEvent = {
          type: 'release' as const,
          timestamp: new Date(now),
          connectionId: connId,
          duration: (i + 1) * 1000,
          poolState: { active: 1, idle: 1, waiting: 0 }
        };

        (service as any).recordEvent(releaseEvent);
      });

      const avgTime = (service as any).calculateAverageAcquireTime();
      expect(avgTime).toBe(2000); // (1000 + 2000 + 3000) / 3
    });

    it('should calculate average connection lifetime', () => {
      const now = Date.now();
      
      // Add connections with different creation times
      (service as any).connectionCreationTimes.set('conn1', now - 30000); // 30 seconds ago
      (service as any).connectionCreationTimes.set('conn2', now - 60000); // 60 seconds ago
      (service as any).connectionCreationTimes.set('conn3', now - 90000); // 90 seconds ago

      const avgLifetime = (service as any).calculateAverageConnectionLifetime();
      expect(avgLifetime).toBe(60000); // (30000 + 60000 + 90000) / 3
    });
  });
});
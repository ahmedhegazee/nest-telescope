import { Test, TestingModule } from '@nestjs/testing';
import { QueryMetricsService } from './query-metrics.service';
import { QueryContext } from './query-watcher.interceptor';
import { ConnectionPoolMetrics } from './connection-pool-monitor.service';

describe('QueryMetricsService', () => {
  let service: QueryMetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QueryMetricsService],
    }).compile();

    service = module.get<QueryMetricsService>(QueryMetricsService);
  });

  afterEach(() => {
    service.reset();
    service.destroy();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize with empty metrics', () => {
      const metrics = service.getMetrics();
      expect(metrics.totalQueries).toBe(0);
      expect(metrics.slowQueries).toBe(0);
      expect(metrics.averageQueryTime).toBe(0);
      expect(metrics.topSlowQueries).toHaveLength(0);
    });
  });

  describe('query recording', () => {
    it('should record basic query metrics', () => {
      const context: QueryContext = {
        id: 'query-1',
        sql: 'SELECT * FROM users WHERE id = $1',
        parameters: [1],
        startTime: Date.now(),
        duration: 150,
        operation: 'select',
        tableName: 'users'
      };

      service.recordQuery(context);

      const metrics = service.getMetrics();
      expect(metrics.totalQueries).toBe(1);
      expect(metrics.slowQueries).toBe(0);
      expect(metrics.averageQueryTime).toBe(150);
      expect(metrics.operationBreakdown.select.count).toBe(1);
      expect(metrics.operationBreakdown.select.averageTime).toBe(150);
    });

    it('should record slow query metrics', () => {
      const context: QueryContext = {
        id: 'slow-query',
        sql: 'SELECT * FROM large_table',
        parameters: [],
        startTime: Date.now(),
        duration: 2000,
        operation: 'select',
        tableName: 'large_table'
      };

      service.recordQuery(context);

      const metrics = service.getMetrics();
      expect(metrics.totalQueries).toBe(1);
      expect(metrics.slowQueries).toBe(1);
      expect(metrics.topSlowQueries).toHaveLength(1);
      expect(metrics.topSlowQueries[0].sql).toBe('SELECT * FROM large_table');
    });

    it('should record very slow query metrics', () => {
      const context: QueryContext = {
        id: 'very-slow-query',
        sql: 'SELECT * FROM huge_table',
        parameters: [],
        startTime: Date.now(),
        duration: 6000,
        operation: 'select',
        tableName: 'huge_table'
      };

      service.recordQuery(context);

      const metrics = service.getMetrics();
      expect(metrics.totalQueries).toBe(1);
      expect(metrics.verySlowQueries).toBe(1);
    });

    it('should record query with error', () => {
      const context: QueryContext = {
        id: 'error-query',
        sql: 'SELECT * FROM nonexistent_table',
        parameters: [],
        startTime: Date.now(),
        duration: 100,
        operation: 'select',
        error: new Error('Table does not exist')
      };

      service.recordQuery(context);

      const metrics = service.getMetrics();
      expect(metrics.totalQueries).toBe(1);
      expect(metrics.errorQueries).toBe(1);
      expect(metrics.operationBreakdown.select.errorCount).toBe(1);
      expect(metrics.operationBreakdown.select.errorRate).toBe(100);
    });
  });

  describe('operation breakdown', () => {
    it('should track different operation types', () => {
      const operations = [
        { operation: 'select', duration: 100 },
        { operation: 'insert', duration: 200 },
        { operation: 'update', duration: 300 },
        { operation: 'delete', duration: 400 },
        { operation: 'select', duration: 150 }
      ];

      operations.forEach((op, i) => {
        const context: QueryContext = {
          id: `query-${i}`,
          sql: `${op.operation.toUpperCase()} statement`,
          parameters: [],
          startTime: Date.now(),
          duration: op.duration,
          operation: op.operation as any
        };

        service.recordQuery(context);
      });

      const metrics = service.getMetrics();
      expect(metrics.operationBreakdown.select.count).toBe(2);
      expect(metrics.operationBreakdown.select.averageTime).toBe(125); // (100 + 150) / 2
      expect(metrics.operationBreakdown.insert.count).toBe(1);
      expect(metrics.operationBreakdown.update.count).toBe(1);
      expect(metrics.operationBreakdown.delete.count).toBe(1);
    });

    it('should calculate operation error rates', () => {
      // Record 3 select queries, 1 with error
      const queries = [
        { operation: 'select', duration: 100, hasError: false },
        { operation: 'select', duration: 200, hasError: true },
        { operation: 'select', duration: 150, hasError: false }
      ];

      queries.forEach((q, i) => {
        const context: QueryContext = {
          id: `query-${i}`,
          sql: 'SELECT * FROM users',
          parameters: [],
          startTime: Date.now(),
          duration: q.duration,
          operation: q.operation as any,
          error: q.hasError ? new Error('Query failed') : undefined
        };

        service.recordQuery(context);
      });

      const metrics = service.getMetrics();
      expect(metrics.operationBreakdown.select.count).toBe(3);
      expect(metrics.operationBreakdown.select.errorCount).toBe(1);
      expect(metrics.operationBreakdown.select.errorRate).toBeCloseTo(33.33, 2);
    });
  });

  describe('table metrics', () => {
    it('should track table-specific metrics', () => {
      const queries = [
        { tableName: 'users', duration: 100 },
        { tableName: 'users', duration: 200 },
        { tableName: 'posts', duration: 300 },
        { tableName: 'users', duration: 1500 } // slow query
      ];

      queries.forEach((q, i) => {
        const context: QueryContext = {
          id: `query-${i}`,
          sql: `SELECT * FROM ${q.tableName}`,
          parameters: [],
          startTime: Date.now(),
          duration: q.duration,
          operation: 'select',
          tableName: q.tableName
        };

        service.recordQuery(context);
      });

      const metrics = service.getMetrics();
      expect(metrics.tableMetrics.users.queryCount).toBe(3);
      expect(metrics.tableMetrics.users.slowQueryCount).toBe(1);
      expect(metrics.tableMetrics.users.averageQueryTime).toBeCloseTo(600, 0); // (100 + 200 + 1500) / 3
      expect(metrics.tableMetrics.posts.queryCount).toBe(1);
    });

    it('should track most common operations per table', () => {
      const queries = [
        { tableName: 'users', operation: 'select', duration: 100 },
        { tableName: 'users', operation: 'select', duration: 150 },
        { tableName: 'users', operation: 'insert', duration: 200 },
        { tableName: 'users', operation: 'update', duration: 300 }
      ];

      queries.forEach((q, i) => {
        const context: QueryContext = {
          id: `query-${i}`,
          sql: `${q.operation.toUpperCase()} statement`,
          parameters: [],
          startTime: Date.now(),
          duration: q.duration,
          operation: q.operation as any,
          tableName: q.tableName
        };

        service.recordQuery(context);
      });

      const tableMetrics = service.getTableMetrics('users');
      expect(tableMetrics).toBeDefined();
      expect(tableMetrics!.mostCommonOperations).toHaveLength(3);
      expect(tableMetrics!.mostCommonOperations[0].operation).toBe('select');
      expect(tableMetrics!.mostCommonOperations[0].count).toBe(2);
    });
  });

  describe('percentile calculations', () => {
    it('should calculate query time percentiles', async () => {
      const queryTimes = [50, 100, 150, 200, 300, 500, 1000, 2000, 3000, 5000];
      
      queryTimes.forEach((duration, i) => {
        const context: QueryContext = {
          id: `query-${i}`,
          sql: 'SELECT * FROM users',
          parameters: [],
          startTime: Date.now(),
          duration,
          operation: 'select'
        };

        service.recordQuery(context);
      });

      // Trigger manual percentile calculation
      (service as any).updatePercentiles();
      
      const metrics = service.getMetrics();
      expect(metrics.queryTimePercentiles.p50).toBeGreaterThan(0);
      expect(metrics.queryTimePercentiles.p95).toBeGreaterThanOrEqual(metrics.queryTimePercentiles.p50);
      expect(metrics.queryTimePercentiles.p99).toBeGreaterThanOrEqual(metrics.queryTimePercentiles.p95);
    });
  });

  describe('top slow queries', () => {
    it('should maintain top slow queries list', () => {
      const slowQueries = [
        { sql: 'SELECT * FROM users WHERE name LIKE "%test%"', duration: 2000 },
        { sql: 'SELECT * FROM posts JOIN users ON posts.user_id = users.id', duration: 3000 },
        { sql: 'SELECT * FROM users WHERE name LIKE "%test%"', duration: 1800 }, // duplicate
        { sql: 'SELECT COUNT(*) FROM large_table', duration: 4000 },
        { sql: 'SELECT * FROM comments WHERE content LIKE "%search%"', duration: 1200 }
      ];

      slowQueries.forEach((q, i) => {
        const context: QueryContext = {
          id: `query-${i}`,
          sql: q.sql,
          parameters: [],
          startTime: Date.now(),
          duration: q.duration,
          operation: 'select'
        };

        service.recordQuery(context);
      });

      const metrics = service.getMetrics();
      const topSlowQueries = metrics.topSlowQueries;
      
      expect(topSlowQueries).toHaveLength(4); // 4 unique queries
      expect(topSlowQueries[0].sql).toBe('SELECT COUNT(*) FROM large_table'); // Highest average
      
      // Check that duplicate query was aggregated
      const duplicateQuery = topSlowQueries.find(q => q.sql.includes('name LIKE "%test%"'));
      expect(duplicateQuery).toBeDefined();
      expect(duplicateQuery!.count).toBe(2);
      expect(duplicateQuery!.averageTime).toBe(1900); // (2000 + 1800) / 2
    });

    it('should limit top slow queries to 20', () => {
      // Generate 25 different slow queries
      for (let i = 0; i < 25; i++) {
        const context: QueryContext = {
          id: `query-${i}`,
          sql: `SELECT * FROM table_${i}`,
          parameters: [],
          startTime: Date.now(),
          duration: 1000 + i * 100,
          operation: 'select'
        };

        service.recordQuery(context);
      }

      const metrics = service.getMetrics();
      expect(metrics.topSlowQueries.length).toBeLessThanOrEqual(20);
      expect(metrics.topSlowQueries.length).toBeGreaterThan(0);
    });
  });

  describe('N+1 detection tracking', () => {
    it('should record N+1 detections', () => {
      service.recordNPlusOneDetection();
      service.recordNPlusOneDetection();

      const metrics = service.getMetrics();
      expect(metrics.nPlusOneDetections).toBe(2);
    });
  });

  describe('connection pool metrics', () => {
    it('should update connection pool metrics', () => {
      const connectionMetrics: ConnectionPoolMetrics = {
        totalConnections: 10,
        activeConnections: 5,
        idleConnections: 5,
        waitingConnections: 0,
        acquiredConnections: 100,
        releasedConnections: 95,
        createdConnections: 10,
        destroyedConnections: 0,
        poolSize: 10,
        maxConnections: 20,
        minConnections: 5,
        connectionTimeouts: 0,
        connectionErrors: 0,
        averageAcquireTime: 50,
        averageConnectionLifetime: 300000,
        healthScore: 85,
        lastUpdate: new Date()
      };

      service.updateConnectionPoolMetrics(connectionMetrics);

      const metrics = service.getMetrics();
      expect(metrics.connectionPoolMetrics).toEqual(connectionMetrics);
    });
  });

  describe('metrics stream', () => {
    it('should provide metrics stream', (done) => {
      const metricsStream = service.getMetricsStream();
      let updateCount = 0;

      const subscription = metricsStream.subscribe(metrics => {
        updateCount++;
        if (updateCount === 1) {
          expect(metrics.totalQueries).toBe(1);
          subscription.unsubscribe();
          done();
        }
      });

      // Record a query to trigger update
      const context: QueryContext = {
        id: 'stream-query',
        sql: 'SELECT 1',
        parameters: [],
        startTime: Date.now(),
        duration: 100,
        operation: 'select'
      };

      service.recordQuery(context);
    });
  });

  describe('utility methods', () => {
    beforeEach(() => {
      // Set up some test data
      const queries = [
        { sql: 'SELECT * FROM users', duration: 100, tableName: 'users' },
        { sql: 'SELECT * FROM posts', duration: 200, tableName: 'posts' },
        { sql: 'SELECT * FROM users', duration: 1500, tableName: 'users' }, // slow
        { sql: 'SELECT * FROM comments', duration: 300, tableName: 'comments' }
      ];

      queries.forEach((q, i) => {
        const context: QueryContext = {
          id: `query-${i}`,
          sql: q.sql,
          parameters: [],
          startTime: Date.now(),
          duration: q.duration,
          operation: 'select',
          tableName: q.tableName
        };

        service.recordQuery(context);
      });
    });

    it('should return slow queries with limit', () => {
      const slowQueries = service.getSlowQueries(1);
      expect(slowQueries).toHaveLength(1);
      expect(slowQueries[0].sql).toBe('SELECT * FROM users');
    });

    it('should return table metrics', () => {
      const userMetrics = service.getTableMetrics('users');
      expect(userMetrics).toBeDefined();
      expect(userMetrics!.queryCount).toBe(2);
      expect(userMetrics!.slowQueryCount).toBe(1);
    });

    it('should return top tables by query count', () => {
      const topTables = service.getTopTables(5);
      expect(topTables.length).toBeGreaterThan(0);
      expect(topTables[0].tableName).toBe('users'); // Most queries
      expect(topTables[0].metrics.queryCount).toBe(2);
    });

    it('should return slowest tables', () => {
      const slowestTables = service.getSlowestTables(1);
      expect(slowestTables).toHaveLength(1);
      expect(slowestTables[0].tableName).toBe('users'); // Highest average time
    });

    it('should return recent queries', () => {
      const recentQueries = service.getRecentQueries(2);
      expect(recentQueries).toHaveLength(2);
      expect(recentQueries[0].context.id).toBe('query-3'); // Most recent first
    });
  });

  describe('reset and destroy', () => {
    it('should reset metrics', () => {
      // Record some queries
      const context: QueryContext = {
        id: 'test-query',
        sql: 'SELECT * FROM users',
        parameters: [],
        startTime: Date.now(),
        duration: 100,
        operation: 'select'
      };

      service.recordQuery(context);
      service.recordNPlusOneDetection();

      let metrics = service.getMetrics();
      expect(metrics.totalQueries).toBe(1);
      expect(metrics.nPlusOneDetections).toBe(1);

      // Reset
      service.reset();

      metrics = service.getMetrics();
      expect(metrics.totalQueries).toBe(0);
      expect(metrics.nPlusOneDetections).toBe(0);
      expect(service.getRecentQueries()).toHaveLength(0);
    });

    it('should cleanup resources on destroy', () => {
      expect(() => service.destroy()).not.toThrow();
    });
  });
});
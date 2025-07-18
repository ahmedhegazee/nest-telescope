import { Test, TestingModule } from '@nestjs/testing';
import { QueryWatcherService } from './query-watcher.service';
import { TelescopeService } from '../../core/services/telescope.service';
import { TelescopeConfig } from '../../core/interfaces/telescope-config.interface';
import { QueryContext } from './query-watcher.interceptor';
import { QueryWatcherConfig } from './query-watcher.config';

describe('QueryWatcherService', () => {
  let service: QueryWatcherService;
  let telescopeService: jest.Mocked<TelescopeService>;

  beforeEach(async () => {
    const mockTelescopeService = {
      record: jest.fn(),
    };

    const mockConfig: QueryWatcherConfig = {
      enabled: true,
      priority: 1,
      tags: ['query', 'database'],
      dependencies: ['typeorm'],
      slowQueryThreshold: 1000,
      verySlowQueryThreshold: 5000,
      enableStackTrace: true,
      enableQueryAnalysis: true,
      enableOptimizationHints: true,
      maxQueryLength: 10000,
      excludeQueries: ['SELECT 1', 'SHOW TABLES'],
      sampleRate: 100,
      connectionPoolMonitoring: true
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryWatcherService,
        {
          provide: TelescopeService,
          useValue: mockTelescopeService,
        },
        {
          provide: 'QUERY_WATCHER_CONFIG',
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<QueryWatcherService>(QueryWatcherService);
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
      expect(config.slowQueryThreshold).toBe(1000);
      expect(config.verySlowQueryThreshold).toBe(5000);
      expect(config.enableStackTrace).toBe(true);
      expect(config.excludeQueries).toContain('SELECT 1');
    });

    it('should initialize with empty metrics', () => {
      const metrics = service.getMetrics();
      expect(metrics.totalQueries).toBe(0);
      expect(metrics.slowQueries).toBe(0);
      expect(metrics.errorQueries).toBe(0);
      expect(metrics.averageQueryTime).toBe(0);
    });
  });

  describe('query tracking', () => {
    it('should track fast query', () => {
      const context: QueryContext = {
        id: 'query-1',
        sql: 'SELECT * FROM users WHERE id = $1',
        parameters: [1],
        startTime: Date.now(),
        endTime: Date.now() + 100,
        duration: 100,
        operation: 'select',
        tableName: 'users',
        resultCount: 1
      };

      service.trackQuery(context);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'query',
          content: expect.objectContaining({
            query: expect.objectContaining({
              sql: 'SELECT * FROM users WHERE id = $1',
              duration: 100,
              operation: 'select',
              tableName: 'users',
              resultCount: 1
            }),
            performance: expect.objectContaining({
              duration: 100,
              slow: false,
              verySlow: false
            })
          })
        })
      );

      const metrics = service.getMetrics();
      expect(metrics.totalQueries).toBe(1);
      expect(metrics.slowQueries).toBe(0);
    });

    it('should track slow query', () => {
      const context: QueryContext = {
        id: 'query-2',
        sql: 'SELECT * FROM users',
        parameters: [],
        startTime: Date.now(),
        endTime: Date.now() + 2000,
        duration: 2000,
        operation: 'select',
        tableName: 'users',
        resultCount: 100
      };

      service.trackQuery(context);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'query',
          content: expect.objectContaining({
            performance: expect.objectContaining({
              slow: true,
              verySlow: false
            })
          }),
          tags: expect.arrayContaining(['query', 'slow'])
        })
      );

      const metrics = service.getMetrics();
      expect(metrics.slowQueries).toBeGreaterThan(0);
    });

    it('should track very slow query', () => {
      const context: QueryContext = {
        id: 'query-3',
        sql: 'SELECT * FROM users',
        parameters: [],
        startTime: Date.now(),
        endTime: Date.now() + 6000,
        duration: 6000,
        operation: 'select',
        tableName: 'users',
        resultCount: 1000
      };

      service.trackQuery(context);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            performance: expect.objectContaining({
              slow: true,
              verySlow: true
            })
          }),
          tags: expect.arrayContaining(['very-slow'])
        })
      );

      const metrics = service.getMetrics();
      expect(metrics.verySlowQueries).toBe(1);
    });

    it('should track query with error', () => {
      const error = new Error('Connection lost');
      const context: QueryContext = {
        id: 'query-4',
        sql: 'SELECT * FROM nonexistent_table',
        parameters: [],
        startTime: Date.now(),
        endTime: Date.now() + 500,
        duration: 500,
        operation: 'select',
        error
      };

      service.trackQuery(context);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            error: expect.objectContaining({
              message: 'Connection lost',
              name: 'Error'
            })
          }),
          tags: expect.arrayContaining(['error'])
        })
      );

      const metrics = service.getMetrics();
      expect(metrics.errorQueries).toBe(1);
    });

    it('should not track when disabled', async () => {
      // Create service with disabled config
      const disabledConfig: QueryWatcherConfig = {
        enabled: false,
        priority: 1,
        tags: ['query'],
        dependencies: ['typeorm'],
        slowQueryThreshold: 1000,
        verySlowQueryThreshold: 5000,
        enableStackTrace: true,
        enableQueryAnalysis: true,
        enableOptimizationHints: true,
        maxQueryLength: 10000,
        excludeQueries: ['SELECT 1'],
        sampleRate: 100,
        connectionPoolMonitoring: true
      };

      const module = await Test.createTestingModule({
        providers: [
          QueryWatcherService,
          {
            provide: TelescopeService,
            useValue: { record: jest.fn() },
          },
          {
            provide: 'QUERY_WATCHER_CONFIG',
            useValue: disabledConfig,
          },
        ],
      }).compile();

      const disabledService = module.get<QueryWatcherService>(QueryWatcherService);

      const context: QueryContext = {
        id: 'query-5',
        sql: 'SELECT 1',
        parameters: [],
        startTime: Date.now(),
        operation: 'select'
      };

      disabledService.trackQuery(context);

      expect(telescopeService.record).not.toHaveBeenCalled();
    });
  });

  describe('query exclusion', () => {
    it('should exclude configured queries', () => {
      const context: QueryContext = {
        id: 'query-6',
        sql: 'SELECT 1',
        parameters: [],
        startTime: Date.now(),
        operation: 'select'
      };

      service.trackQuery(context);

      expect(telescopeService.record).not.toHaveBeenCalled();
    });

    it('should exclude SHOW TABLES queries', () => {
      const context: QueryContext = {
        id: 'query-7',
        sql: 'SHOW TABLES',
        parameters: [],
        startTime: Date.now(),
        operation: 'raw'
      };

      service.trackQuery(context);

      expect(telescopeService.record).not.toHaveBeenCalled();
    });
  });

  describe('N+1 query detection', () => {
    it('should detect N+1 query pattern', () => {
      const baseTime = Date.now();
      const traceId = 'trace-123';
      
      // Simulate N+1 pattern with 5 identical queries
      for (let i = 0; i < 5; i++) {
        const context: QueryContext = {
          id: `query-n-${i}`,
          sql: 'SELECT * FROM posts WHERE user_id = $1',
          parameters: [i + 1],
          startTime: baseTime + i * 100,
          endTime: baseTime + i * 100 + 50,
          duration: 50,
          operation: 'select',
          entityName: 'Post',
          tableName: 'posts',
          traceId
        };

        service.trackQuery(context);
      }

      // Should create a separate N+1 entry
      expect(telescopeService.record).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'query',
          familyHash: 'n_plus_one:Post',
          content: expect.objectContaining({
            nPlusOne: expect.objectContaining({
              queryCount: 5,
              entity: 'Post',
              sql: 'SELECT * FROM posts WHERE user_id = $1'
            })
          }),
          tags: expect.arrayContaining(['n-plus-one', 'performance-issue'])
        })
      );
    });
  });

  describe('metrics collection', () => {
    beforeEach(() => {
      service.resetMetrics();
    });

    it('should collect basic metrics', () => {
      // Track multiple queries
      const queries = [
        { duration: 100, operation: 'select' as const, tableName: 'users' },
        { duration: 200, operation: 'insert' as const, tableName: 'users' },
        { duration: 1500, operation: 'select' as const, tableName: 'posts' }, // slow
        { duration: 50, operation: 'update' as const, tableName: 'users' },
        { duration: 6000, operation: 'select' as const, tableName: 'posts' }, // very slow
      ];

      queries.forEach((q, i) => {
        const context: QueryContext = {
          id: `query-${i}`,
          sql: `SELECT * FROM ${q.tableName}`,
          parameters: [],
          startTime: Date.now(),
          endTime: Date.now() + q.duration,
          duration: q.duration,
          operation: q.operation,
          tableName: q.tableName
        };

        service.trackQuery(context);
      });

      const metrics = service.getMetrics();
      expect(metrics.totalQueries).toBe(5);
      expect(metrics.slowQueries).toBe(2); // 1500ms and 6000ms
      expect(metrics.averageQueryTime).toBe((100 + 200 + 1500 + 50 + 6000) / 5);
    });

    it('should track operation distribution', () => {
      const operations = ['select', 'insert', 'update', 'delete', 'select'];
      
      operations.forEach((op, i) => {
        const context: QueryContext = {
          id: `query-${i}`,
          sql: `${op.toUpperCase()} statement`,
          parameters: [],
          startTime: Date.now(),
          duration: 100,
          operation: op as any
        };

        service.trackQuery(context);
      });

      const metrics = service.getMetrics();
      expect(metrics.operationDistribution.select).toBe(2);
      expect(metrics.operationDistribution.insert).toBe(1);
      expect(metrics.operationDistribution.update).toBe(1);
      expect(metrics.operationDistribution.delete).toBe(1);
    });

    it('should update top slow queries', () => {
      const slowQueries = [
        { sql: 'SELECT * FROM users', duration: 2000 },
        { sql: 'SELECT * FROM posts', duration: 3000 },
        { sql: 'SELECT * FROM users', duration: 1800 }, // duplicate
        { sql: 'SELECT * FROM comments', duration: 1200 },
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

        service.trackQuery(context);
      });

      const metrics = service.getMetrics();
      expect(metrics.topSlowQueries.length).toBe(3); // 3 unique queries
      expect(metrics.topSlowQueries[0].sql).toBe('SELECT * FROM posts'); // highest duration
      expect(metrics.topSlowQueries[1].count).toBe(2); // users query appeared twice
    });
  });

  describe('query analysis', () => {
    it('should analyze query for performance issues', () => {
      const context: QueryContext = {
        id: 'query-analyze',
        sql: 'SELECT * FROM users WHERE UPPER(name) = $1',
        parameters: ['JOHN'],
        startTime: Date.now(),
        duration: 2000,
        operation: 'select',
        tableName: 'users'
      };

      service.trackQuery(context);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            query: expect.objectContaining({
              sql: 'SELECT * FROM users WHERE UPPER(name) = $1',
              duration: 2000
            })
          })
        })
      );
    });

    it('should detect SELECT * usage', () => {
      const context: QueryContext = {
        id: 'query-select-star',
        sql: 'SELECT * FROM users',
        parameters: [],
        startTime: Date.now(),
        duration: 1500,
        operation: 'select',
        tableName: 'users'
      };

      service.trackQuery(context);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            query: expect.objectContaining({
              sql: 'SELECT * FROM users',
              duration: 1500
            })
          })
        })
      );
    });
  });

  describe('utility methods', () => {
    it('should return recent queries', () => {
      // Track some queries
      for (let i = 0; i < 3; i++) {
        const context: QueryContext = {
          id: `query-${i}`,
          sql: 'SELECT * FROM users',
          parameters: [],
          startTime: Date.now(),
          operation: 'select'
        };

        service.trackQuery(context);
      }

      const recentQueries = service.getRecentQueries(2);
      expect(recentQueries).toHaveLength(2);
      expect(recentQueries[0].id).toBe('query-2'); // Most recent first
    });

    it('should return slow queries', () => {
      // Track mix of fast and slow queries
      const queries = [
        { id: 'fast-1', duration: 100 },
        { id: 'slow-1', duration: 1500 },
        { id: 'fast-2', duration: 200 },
        { id: 'slow-2', duration: 2000 },
      ];

      queries.forEach(q => {
        const context: QueryContext = {
          id: q.id,
          sql: 'SELECT * FROM users',
          parameters: [],
          startTime: Date.now(),
          duration: q.duration,
          operation: 'select'
        };

        service.trackQuery(context);
      });

      const slowQueries = service.getSlowQueries();
      expect(slowQueries).toHaveLength(2);
      expect(slowQueries[0].id).toBe('slow-2'); // Slowest first
      expect(slowQueries[1].id).toBe('slow-1');
    });

    it('should reset metrics', () => {
      // Track some queries
      const context: QueryContext = {
        id: 'query-reset',
        sql: 'SELECT * FROM users',
        parameters: [],
        startTime: Date.now(),
        operation: 'select'
      };

      service.trackQuery(context);

      let metrics = service.getMetrics();
      expect(metrics.totalQueries).toBe(1);

      // Reset and verify
      service.resetMetrics();
      metrics = service.getMetrics();
      expect(metrics.totalQueries).toBe(0);
      expect(metrics.averageQueryTime).toBe(0);
      expect(service.getRecentQueries()).toHaveLength(0);
    });
  });
});
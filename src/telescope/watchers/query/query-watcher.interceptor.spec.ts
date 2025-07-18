import { Test, TestingModule } from '@nestjs/testing';
import { QueryWatcherInterceptor } from './query-watcher.interceptor';
import { QueryWatcherService } from './query-watcher.service';
import { DataSource, QueryRunner, SelectQueryBuilder, Repository } from 'typeorm';

describe('QueryWatcherInterceptor', () => {
  let interceptor: QueryWatcherInterceptor;
  let queryWatcherService: jest.Mocked<QueryWatcherService>;
  let dataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    const mockQueryWatcherService = {
      trackQuery: jest.fn(),
      getConfig: jest.fn().mockReturnValue({ enabled: true }),
    };

    const mockDataSource = {
      createQueryRunner: jest.fn(),
      createQueryBuilder: jest.fn(),
      getRepository: jest.fn(),
      manager: {
        createQueryBuilder: jest.fn(),
        getRepository: jest.fn(),
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryWatcherInterceptor,
        {
          provide: QueryWatcherService,
          useValue: mockQueryWatcherService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    interceptor = module.get<QueryWatcherInterceptor>(QueryWatcherInterceptor);
    queryWatcherService = module.get(QueryWatcherService);
    dataSource = module.get(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(interceptor).toBeDefined();
    });

    it('should setup interception when enabled', async () => {
      await interceptor.setupInterception();
      expect(dataSource.createQueryRunner).toHaveBeenCalled();
    });

    it('should not setup interception when disabled', async () => {
      queryWatcherService.getConfig.mockReturnValue({ 
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
      });
      
      await interceptor.setupInterception();
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });
  });

  describe('QueryRunner interception', () => {
    let mockQueryRunner: jest.Mocked<QueryRunner>;
    let originalQuery: jest.Mock;

    beforeEach(() => {
      originalQuery = jest.fn();
      mockQueryRunner = {
        query: originalQuery,
        connection: {
          options: {
            type: 'postgres',
            host: 'localhost',
            port: 5432,
            database: 'test_db'
          }
        }
      } as any;

      dataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
    });

    it('should intercept query execution', async () => {
      await interceptor.setupInterception();

      const testSql = 'SELECT * FROM users WHERE id = $1';
      const testParams = [1];
      const testResult = [{ id: 1, name: 'John' }];

      originalQuery.mockResolvedValue(testResult);

      // Execute query through intercepted method
      const result = await mockQueryRunner.query(testSql, testParams);

      expect(result).toEqual(testResult);
      expect(originalQuery).toHaveBeenCalledWith(testSql, testParams);
      expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: testSql,
          parameters: testParams,
          operation: 'select',
          resultCount: 1
        })
      );
    });

    it('should handle query errors', async () => {
      await interceptor.setupInterception();

      const testSql = 'SELECT * FROM nonexistent_table';
      const testError = new Error('Table does not exist');

      originalQuery.mockRejectedValue(testError);

      try {
        await mockQueryRunner.query(testSql);
      } catch (error) {
        expect(error).toBe(testError);
      }

      expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: testSql,
          error: testError,
          operation: 'select'
        })
      );
    });

    it('should detect different SQL operations', async () => {
      await interceptor.setupInterception();

      const testCases = [
        { sql: 'SELECT * FROM users', expectedOperation: 'select' },
        { sql: 'INSERT INTO users (name) VALUES ($1)', expectedOperation: 'insert' },
        { sql: 'UPDATE users SET name = $1 WHERE id = $2', expectedOperation: 'update' },
        { sql: 'DELETE FROM users WHERE id = $1', expectedOperation: 'delete' },
        { sql: 'SHOW TABLES', expectedOperation: 'raw' }
      ];

      originalQuery.mockResolvedValue([]);

      for (const testCase of testCases) {
        await mockQueryRunner.query(testCase.sql);
        
        expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            sql: testCase.sql,
            operation: testCase.expectedOperation
          })
        );
      }
    });

    it('should extract table names from queries', async () => {
      await interceptor.setupInterception();

      const testCases = [
        { sql: 'SELECT * FROM users', expectedTable: 'users' },
        { sql: 'INSERT INTO posts (title) VALUES ($1)', expectedTable: 'posts' },
        { sql: 'UPDATE comments SET content = $1 WHERE id = $2', expectedTable: 'comments' },
        { sql: 'DELETE FROM sessions WHERE expired_at < NOW()', expectedTable: 'sessions' }
      ];

      originalQuery.mockResolvedValue([]);

      for (const testCase of testCases) {
        await mockQueryRunner.query(testCase.sql);
        
        expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            sql: testCase.sql,
            tableName: testCase.expectedTable
          })
        );
      }
    });

    it('should capture stack traces', async () => {
      await interceptor.setupInterception();

      originalQuery.mockResolvedValue([]);

      await mockQueryRunner.query('SELECT 1');

      expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          stackTrace: expect.any(String)
        })
      );
    });

    it('should measure query duration', async () => {
      await interceptor.setupInterception();

      // Add delay to simulate query execution time
      originalQuery.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([]), 100)));

      const startTime = Date.now();
      await mockQueryRunner.query('SELECT 1');
      const endTime = Date.now();

      expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          duration: expect.any(Number),
          startTime: expect.any(Number),
          endTime: expect.any(Number)
        })
      );

      const trackedQuery = queryWatcherService.trackQuery.mock.calls[0][0];
      expect(trackedQuery.duration).toBeGreaterThan(0);
      expect(trackedQuery.startTime).toBeLessThanOrEqual(startTime);
      expect(trackedQuery.endTime).toBeGreaterThanOrEqual(endTime);
    });
  });

  describe('SelectQueryBuilder interception', () => {
    let mockQueryBuilder: jest.Mocked<SelectQueryBuilder<any>>;
    let originalGetMany: jest.Mock;
    let originalGetOne: jest.Mock;
    let originalGetRawMany: jest.Mock;

    beforeEach(() => {
      originalGetMany = jest.fn();
      originalGetOne = jest.fn();
      originalGetRawMany = jest.fn();

      mockQueryBuilder = {
        getMany: originalGetMany,
        getOne: originalGetOne,
        getRawMany: originalGetRawMany,
        getSql: jest.fn().mockReturnValue('SELECT * FROM users'),
        getParameters: jest.fn().mockReturnValue({}),
        expressionMap: {
          mainAlias: { metadata: { tableName: 'users' } }
        }
      } as any;

      dataSource.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    });

    it('should intercept getMany calls', async () => {
      await interceptor.setupInterception();

      const testResult = [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }];
      originalGetMany.mockResolvedValue(testResult);

      const result = await mockQueryBuilder.getMany();

      expect(result).toEqual(testResult);
      expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: 'SELECT * FROM users',
          operation: 'select',
          tableName: 'users',
          resultCount: 2
        })
      );
    });

    it('should intercept getOne calls', async () => {
      await interceptor.setupInterception();

      const testResult = { id: 1, name: 'John' };
      originalGetOne.mockResolvedValue(testResult);

      const result = await mockQueryBuilder.getOne();

      expect(result).toEqual(testResult);
      expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: 'SELECT * FROM users',
          operation: 'select',
          tableName: 'users',
          resultCount: 1
        })
      );
    });

    it('should intercept getRawMany calls', async () => {
      await interceptor.setupInterception();

      const testResult = [{ user_id: 1, user_name: 'John' }];
      originalGetRawMany.mockResolvedValue(testResult);

      const result = await mockQueryBuilder.getRawMany();

      expect(result).toEqual(testResult);
      expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: 'SELECT * FROM users',
          operation: 'select',
          resultCount: 1
        })
      );
    });

    it('should handle QueryBuilder errors', async () => {
      await interceptor.setupInterception();

      const testError = new Error('Query failed');
      originalGetMany.mockRejectedValue(testError);

      try {
        await mockQueryBuilder.getMany();
      } catch (error) {
        expect(error).toBe(testError);
      }

      expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          error: testError,
          operation: 'select'
        })
      );
    });
  });

  describe('Repository interception', () => {
    let mockRepository: jest.Mocked<Repository<any>>;
    let originalFind: jest.Mock;
    let originalFindOne: jest.Mock;
    let originalSave: jest.Mock;

    beforeEach(() => {
      originalFind = jest.fn();
      originalFindOne = jest.fn();
      originalSave = jest.fn();

      mockRepository = {
        find: originalFind,
        findOne: originalFindOne,
        save: originalSave,
        metadata: {
          tableName: 'users'
        }
      } as any;

      dataSource.getRepository.mockReturnValue(mockRepository);
    });

    it('should intercept repository find calls', async () => {
      await interceptor.setupInterception();

      const testResult = [{ id: 1, name: 'John' }];
      originalFind.mockResolvedValue(testResult);

      const result = await mockRepository.find();

      expect(result).toEqual(testResult);
      expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'select',
          tableName: 'users',
          resultCount: 1
        })
      );
    });

    it('should intercept repository findOne calls', async () => {
      await interceptor.setupInterception();

      const testResult = { id: 1, name: 'John' };
      originalFindOne.mockResolvedValue(testResult);

      const result = await mockRepository.findOne({ where: { id: 1 } });

      expect(result).toEqual(testResult);
      expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'select',
          tableName: 'users',
          resultCount: 1
        })
      );
    });

    it('should intercept repository save calls', async () => {
      await interceptor.setupInterception();

      const testEntity = { id: 1, name: 'John' };
      originalSave.mockResolvedValue(testEntity);

      const result = await mockRepository.save(testEntity);

      expect(result).toEqual(testEntity);
      expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'insert',
          tableName: 'users',
          resultCount: 1
        })
      );
    });

    it('should handle repository errors', async () => {
      await interceptor.setupInterception();

      const testError = new Error('Repository operation failed');
      originalFind.mockRejectedValue(testError);

      try {
        await mockRepository.find();
      } catch (error) {
        expect(error).toBe(testError);
      }

      expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          error: testError,
          operation: 'select'
        })
      );
    });
  });

  describe('utility methods', () => {
    it('should generate unique query IDs', () => {
      const id1 = (interceptor as any).generateQueryId();
      const id2 = (interceptor as any).generateQueryId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^query_\d+_[a-z0-9]+$/);
    });

    it('should detect SQL operations correctly', () => {
      const testCases = [
        { sql: 'SELECT * FROM users', expected: 'select' },
        { sql: '  select id from posts  ', expected: 'select' },
        { sql: 'INSERT INTO users (name) VALUES ($1)', expected: 'insert' },
        { sql: 'UPDATE users SET name = $1', expected: 'update' },
        { sql: 'DELETE FROM users WHERE id = $1', expected: 'delete' },
        { sql: 'SHOW TABLES', expected: 'raw' },
        { sql: 'EXPLAIN SELECT * FROM users', expected: 'raw' },
        { sql: 'CREATE TABLE test (id INT)', expected: 'raw' },
        { sql: '', expected: 'raw' }
      ];

      for (const testCase of testCases) {
        const result = (interceptor as any).detectOperation(testCase.sql);
        expect(result).toBe(testCase.expected);
      }
    });

    it('should extract table names correctly', () => {
      const testCases = [
        { sql: 'SELECT * FROM users', expected: 'users' },
        { sql: 'INSERT INTO posts (title) VALUES ($1)', expected: 'posts' },
        { sql: 'UPDATE comments SET content = $1 WHERE id = $2', expected: 'comments' },
        { sql: 'DELETE FROM sessions WHERE expired_at < NOW()', expected: 'sessions' },
        { sql: 'SELECT * FROM users u JOIN posts p ON u.id = p.user_id', expected: 'users' },
        { sql: 'select id from `table_with_backticks`', expected: 'table_with_backticks' },
        { sql: 'SELECT * FROM "quoted_table"', expected: 'quoted_table' },
        { sql: 'SHOW TABLES', expected: undefined },
        { sql: 'invalid sql', expected: undefined }
      ];

      for (const testCase of testCases) {
        const result = (interceptor as any).extractTableName(testCase.sql);
        expect(result).toBe(testCase.expected);
      }
    });

    it('should extract connection information', () => {
      const mockQueryRunner = {
        connection: {
          options: {
            type: 'postgres',
            host: 'localhost',
            port: 5432,
            database: 'test_db'
          }
        }
      };

      const connectionInfo = (interceptor as any).extractConnectionInfo(mockQueryRunner);

      expect(connectionInfo).toEqual({
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'test_db'
      });
    });

    it('should handle missing connection information', () => {
      const mockQueryRunner = {
        connection: {
          options: {}
        }
      };

      const connectionInfo = (interceptor as any).extractConnectionInfo(mockQueryRunner);

      expect(connectionInfo).toEqual({
        type: undefined,
        host: undefined,
        port: undefined,
        database: undefined
      });
    });

    it('should count results correctly', () => {
      const testCases = [
        { result: [], expected: 0 },
        { result: [{ id: 1 }], expected: 1 },
        { result: [{ id: 1 }, { id: 2 }, { id: 3 }], expected: 3 },
        { result: { id: 1 }, expected: 1 },
        { result: null, expected: 0 },
        { result: undefined, expected: 0 },
        { result: 'string', expected: 0 },
        { result: 42, expected: 0 }
      ];

      for (const testCase of testCases) {
        const result = (interceptor as any).countResults(testCase.result);
        expect(result).toBe(testCase.expected);
      }
    });

    it('should capture stack traces', () => {
      const stackTrace = (interceptor as any).captureStackTrace();
      
      expect(stackTrace).toBeDefined();
      expect(typeof stackTrace).toBe('string');
      expect(stackTrace).toContain('QueryWatcherInterceptor');
    });
  });

  describe('error handling', () => {
    it('should handle interception setup errors gracefully', async () => {
      dataSource.createQueryRunner.mockImplementation(() => {
        throw new Error('Cannot create query runner');
      });

      await expect(interceptor.setupInterception()).resolves.not.toThrow();
    });

    it('should handle missing DataSource gracefully', async () => {
      const interceptorWithoutDataSource = new QueryWatcherInterceptor(
        queryWatcherService,
        null as any
      );

      await expect(interceptorWithoutDataSource.setupInterception()).resolves.not.toThrow();
    });

    it('should handle malformed SQL gracefully', async () => {
      await interceptor.setupInterception();

      const mockQueryRunner = {
        query: jest.fn().mockResolvedValue([]),
        connection: {
          options: { type: 'postgres' }
        }
      };

      dataSource.createQueryRunner.mockReturnValue(mockQueryRunner as any);

      await mockQueryRunner.query('INVALID SQL STATEMENT');

      expect(queryWatcherService.trackQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: 'INVALID SQL STATEMENT',
          operation: 'raw'
        })
      );
    });
  });
});
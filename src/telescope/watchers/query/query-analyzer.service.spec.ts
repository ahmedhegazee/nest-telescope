import { Test, TestingModule } from '@nestjs/testing';
import { QueryAnalyzerService } from './query-analyzer.service';
import { DataSource } from 'typeorm';
import { QueryContext } from './query-watcher.interceptor';

describe('QueryAnalyzerService', () => {
  let service: QueryAnalyzerService;
  let dataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    const mockDataSource = {
      options: {
        type: 'postgres'
      },
      query: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryAnalyzerService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<QueryAnalyzerService>(QueryAnalyzerService);
    dataSource = module.get(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.clearPatterns();
  });

  describe('query analysis', () => {
    it('should analyze slow query and identify issues', async () => {
      const context: QueryContext = {
        id: 'query-1',
        sql: 'SELECT * FROM users WHERE UPPER(name) = $1',
        parameters: ['JOHN'],
        startTime: Date.now(),
        duration: 2000,
        operation: 'select',
        tableName: 'users'
      };

      const analysis = await service.analyzeQuery(context);

      expect(analysis.queryId).toBe('query-1');
      expect(analysis.duration).toBe(2000);
      expect(analysis.severity).toBe('slow');
      expect(analysis.issues).toHaveLength(2);
      
      // Should detect SELECT * usage
      expect(analysis.issues).toContainEqual(
        expect.objectContaining({
          type: 'full_table_scan',
          severity: 'medium',
          description: expect.stringContaining('SELECT *')
        })
      );
      
      // Should detect function in WHERE clause
      expect(analysis.issues).toContainEqual(
        expect.objectContaining({
          type: 'missing_index',
          severity: 'medium',
          description: expect.stringContaining('functions in WHERE clause')
        })
      );
    });

    it('should detect missing WHERE clause', async () => {
      const context: QueryContext = {
        id: 'query-2',
        sql: 'SELECT id, name FROM users',
        parameters: [],
        startTime: Date.now(),
        duration: 3000,
        operation: 'select',
        tableName: 'users'
      };

      const analysis = await service.analyzeQuery(context);

      expect(analysis.issues).toContainEqual(
        expect.objectContaining({
          type: 'full_table_scan',
          severity: 'high',
          description: expect.stringContaining('lacks WHERE clause')
        })
      );
    });

    it('should detect excessive JOINs', async () => {
      const context: QueryContext = {
        id: 'query-3',
        sql: `SELECT u.name, p.title, c.content, t.name, cat.name, auth.name
              FROM users u
              JOIN posts p ON u.id = p.user_id
              JOIN comments c ON p.id = c.post_id
              JOIN tags t ON p.id = t.post_id
              JOIN categories cat ON p.category_id = cat.id
              JOIN authors auth ON p.author_id = auth.id
              JOIN publishers pub ON auth.publisher_id = pub.id`,
        parameters: [],
        startTime: Date.now(),
        duration: 4000,
        operation: 'select',
        tableName: 'users'
      };

      const analysis = await service.analyzeQuery(context);

      expect(analysis.issues).toContainEqual(
        expect.objectContaining({
          type: 'excessive_joins',
          severity: 'high',
          description: expect.stringContaining('6 joins')
        })
      );
    });

    it('should detect IN subquery that could be optimized', async () => {
      const context: QueryContext = {
        id: 'query-4',
        sql: 'SELECT * FROM users WHERE id IN (SELECT user_id FROM posts WHERE published = true)',
        parameters: [],
        startTime: Date.now(),
        duration: 1500,
        operation: 'select',
        tableName: 'users'
      };

      const analysis = await service.analyzeQuery(context);

      expect(analysis.issues).toContainEqual(
        expect.objectContaining({
          type: 'subquery_performance',
          severity: 'medium',
          description: expect.stringContaining('IN with subquery')
        })
      );
    });

    it('should detect LIKE with leading wildcard', async () => {
      const context: QueryContext = {
        id: 'query-5',
        sql: 'SELECT * FROM users WHERE name LIKE \'%john%\'',
        parameters: [],
        startTime: Date.now(),
        duration: 1200,
        operation: 'select',
        tableName: 'users'
      };

      const analysis = await service.analyzeQuery(context);

      expect(analysis.issues).toContainEqual(
        expect.objectContaining({
          type: 'missing_index',
          severity: 'medium',
          description: expect.stringContaining('LIKE with leading wildcard')
        })
      );
    });

    it('should detect OR conditions in WHERE clause', async () => {
      const context: QueryContext = {
        id: 'query-6',
        sql: 'SELECT * FROM users WHERE name = $1 OR email = $2',
        parameters: ['john', 'john@example.com'],
        startTime: Date.now(),
        duration: 1800,
        operation: 'select',
        tableName: 'users'
      };

      const analysis = await service.analyzeQuery(context);

      expect(analysis.issues).toContainEqual(
        expect.objectContaining({
          type: 'missing_index',
          severity: 'medium',
          description: expect.stringContaining('OR conditions')
        })
      );
    });
  });

  describe('optimization hints', () => {
    it('should generate index suggestion for slow queries', async () => {
      const context: QueryContext = {
        id: 'query-7',
        sql: 'SELECT * FROM users WHERE created_at > $1 AND status = $2',
        parameters: ['2023-01-01', 'active'],
        startTime: Date.now(),
        duration: 2000,
        operation: 'select',
        tableName: 'users'
      };

      const analysis = await service.analyzeQuery(context);

      expect(analysis.optimizationHints).toContainEqual(
        expect.objectContaining({
          type: 'index_suggestion',
          priority: 'high',
          description: expect.stringContaining('database indexes'),
          estimatedImpact: expect.stringContaining('50-95%')
        })
      );
    });

    it('should generate query rewrite suggestion for subqueries', async () => {
      const context: QueryContext = {
        id: 'query-8',
        sql: 'SELECT * FROM users WHERE id IN (SELECT user_id FROM posts)',
        parameters: [],
        startTime: Date.now(),
        duration: 1500,
        operation: 'select',
        tableName: 'users'
      };

      const analysis = await service.analyzeQuery(context);

      expect(analysis.optimizationHints).toContainEqual(
        expect.objectContaining({
          type: 'query_rewrite',
          priority: 'medium',
          description: expect.stringContaining('Rewrite subqueries as JOINs')
        })
      );
    });

    it('should generate caching suggestion for frequent queries', async () => {
      const sql = 'SELECT * FROM users WHERE status = $1';
      
      // Track the same query multiple times to make it frequent
      for (let i = 0; i < 12; i++) {
        const context: QueryContext = {
          id: `query-${i}`,
          sql,
          parameters: ['active'],
          startTime: Date.now(),
          duration: 500,
          operation: 'select',
          tableName: 'users'
        };

        await service.analyzeQuery(context);
      }

      // Analyze one more time to trigger caching suggestion
      const context: QueryContext = {
        id: 'query-final',
        sql,
        parameters: ['active'],
        startTime: Date.now(),
        duration: 500,
        operation: 'select',
        tableName: 'users'
      };

      const analysis = await service.analyzeQuery(context);

      expect(analysis.optimizationHints).toContainEqual(
        expect.objectContaining({
          type: 'caching_opportunity',
          priority: 'medium',
          description: expect.stringContaining('frequently executed query')
        })
      );
    });
  });

  describe('execution plan analysis', () => {
    it('should analyze PostgreSQL execution plan', async () => {
      const mockExecutionPlan = [
        {
          'QUERY PLAN': [
            {
              'Plan': {
                'Node Type': 'Seq Scan',
                'Relation Name': 'users',
                'Total Cost': 15000,
                'Actual Rows': 50000,
                'Filter': 'name = $1'
              }
            }
          ]
        }
      ];

      dataSource.query.mockResolvedValue(mockExecutionPlan);

      const context: QueryContext = {
        id: 'query-plan',
        sql: 'SELECT * FROM users WHERE name = $1',
        parameters: ['john'],
        startTime: Date.now(),
        duration: 3000,
        operation: 'select',
        tableName: 'users'
      };

      const analysis = await service.analyzeQuery(context);

      expect(analysis.executionPlan).toBeDefined();
      expect(analysis.executionPlan!.totalCost).toBe(15000);
      expect(analysis.issues).toContainEqual(
        expect.objectContaining({
          type: 'full_table_scan',
          severity: 'high',
          description: expect.stringContaining('high execution cost')
        })
      );
    });

    it('should handle execution plan failures gracefully', async () => {
      dataSource.query.mockRejectedValue(new Error('Permission denied'));

      const context: QueryContext = {
        id: 'query-plan-fail',
        sql: 'SELECT * FROM users',
        parameters: [],
        startTime: Date.now(),
        duration: 1000,
        operation: 'select',
        tableName: 'users'
      };

      const analysis = await service.analyzeQuery(context);

      expect(analysis.executionPlan).toBeUndefined();
      expect(analysis.issues).toHaveLength(2); // Should still detect structural issues
    });
  });

  describe('query patterns', () => {
    it('should track query patterns', async () => {
      const queries = [
        'SELECT * FROM users WHERE id = $1',
        'SELECT * FROM users WHERE id = $1',
        'SELECT * FROM posts WHERE user_id = $1',
        'SELECT * FROM users WHERE id = $1'
      ];

      for (let i = 0; i < queries.length; i++) {
        const context: QueryContext = {
          id: `query-${i}`,
          sql: queries[i],
          parameters: [i + 1],
          startTime: Date.now(),
          duration: 100,
          operation: 'select'
        };

        await service.analyzeQuery(context);
      }

      const patterns = service.getQueryPatterns();
      expect(patterns).toHaveLength(2);
      
      const userPattern = patterns.find(p => p.pattern.includes('users'));
      expect(userPattern).toBeDefined();
      expect(userPattern!.count).toBe(3);
    });

    it('should identify slow query patterns', async () => {
      const queries = [
        { sql: 'SELECT * FROM users WHERE name LIKE $1', duration: 2000 },
        { sql: 'SELECT * FROM users WHERE name LIKE $1', duration: 1800 },
        { sql: 'SELECT * FROM posts WHERE title LIKE $1', duration: 500 },
      ];

      for (let i = 0; i < queries.length; i++) {
        const context: QueryContext = {
          id: `query-${i}`,
          sql: queries[i].sql,
          parameters: [`%test${i}%`],
          startTime: Date.now(),
          duration: queries[i].duration,
          operation: 'select'
        };

        await service.analyzeQuery(context);
      }

      const slowPatterns = service.getSlowQueryPatterns();
      expect(slowPatterns).toHaveLength(1);
      expect(slowPatterns[0].averageDuration).toBe(1900); // (2000 + 1800) / 2
    });
  });

  describe('severity determination', () => {
    it('should determine correct severity levels', async () => {
      const testCases = [
        { duration: 800, expectedSeverity: 'slow' },
        { duration: 3000, expectedSeverity: 'slow' },
        { duration: 7000, expectedSeverity: 'very_slow' },
        { duration: 15000, expectedSeverity: 'critical' }
      ];

      for (const testCase of testCases) {
        const context: QueryContext = {
          id: `query-${testCase.duration}`,
          sql: 'SELECT * FROM users',
          parameters: [],
          startTime: Date.now(),
          duration: testCase.duration,
          operation: 'select'
        };

        const analysis = await service.analyzeQuery(context);
        expect(analysis.severity).toBe(testCase.expectedSeverity);
      }
    });
  });

  describe('optimization suggestions', () => {
    it('should return optimization suggestions', async () => {
      // Generate some patterns first
      const context: QueryContext = {
        id: 'query-opt',
        sql: 'SELECT * FROM users WHERE name = $1',
        parameters: ['john'],
        startTime: Date.now(),
        duration: 2000,
        operation: 'select',
        tableName: 'users'
      };

      await service.analyzeQuery(context);

      const suggestions = service.getOptimizationSuggestions();
      expect(suggestions).toBeInstanceOf(Array);
      // Suggestions would be populated based on the actual implementation
    });

    it('should clear patterns and suggestions', async () => {
      const context: QueryContext = {
        id: 'query-clear',
        sql: 'SELECT * FROM users',
        parameters: [],
        startTime: Date.now(),
        duration: 1000,
        operation: 'select'
      };

      await service.analyzeQuery(context);

      expect(service.getQueryPatterns()).toHaveLength(1);

      service.clearPatterns();

      expect(service.getQueryPatterns()).toHaveLength(0);
      expect(service.getOptimizationSuggestions()).toHaveLength(0);
    });
  });
});
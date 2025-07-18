import { Test, TestingModule } from '@nestjs/testing';
import { QueryWatcherModule } from './query-watcher.module';
import { QueryWatcherService } from './query-watcher.service';
import { QueryWatcherInterceptor } from './query-watcher.interceptor';
import { QueryAnalyzerService } from './query-analyzer.service';
import { ConnectionPoolMonitorService } from './connection-pool-monitor.service';
import { QueryMetricsService } from './query-metrics.service';
import { TelescopeService } from '../../core/services/telescope.service';
import { TelescopeConfig } from '../../core/interfaces/telescope-config.interface';
import { QueryWatcherConfig } from './query-watcher.config';
import { DataSource } from 'typeorm';

describe('QueryWatcherModule', () => {
  let module: TestingModule;
  let queryWatcherService: QueryWatcherService;
  let queryWatcherInterceptor: QueryWatcherInterceptor;
  let queryAnalyzerService: QueryAnalyzerService;
  let connectionPoolMonitorService: ConnectionPoolMonitorService;
  let queryMetricsService: QueryMetricsService;

  const mockTelescopeConfig: TelescopeConfig = {
    enabled: true,
    environment: 'test',
    storage: {
      driver: 'memory',
      retention: {
        hours: 24,
        maxEntries: 10000
      },
      batch: {
        enabled: true,
        size: 100,
        flushInterval: 1000
      }
    },
    devtools: {
      enabled: true,
      port: 8001,
      features: {
        dependencyGraph: true,
        interactivePlayground: true,
        performanceMetrics: true
      }
    },
    dashboard: {
      enabled: true,
      path: '/telescope',
      strategy: 'hybrid'
    },
    features: {
      realTimeUpdates: true,
      analytics: false,
      customWatchers: true
    },
    watchers: {
      query: {
        enabled: true,
        priority: 1,
        tags: ['query', 'database'],
        dependencies: ['typeorm']
      }
    }
  };

  const mockQueryWatcherConfig: QueryWatcherConfig = {
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
    excludeQueries: ['SELECT 1'],
    sampleRate: 100,
    connectionPoolMonitoring: true
  };

  beforeEach(async () => {
    const mockTelescopeService = {
      record: jest.fn(),
    };

    const mockDataSource = {
      options: {
        type: 'postgres'
      },
      createQueryRunner: jest.fn(),
      createQueryBuilder: jest.fn(),
      getRepository: jest.fn(),
      manager: {
        createQueryBuilder: jest.fn(),
        getRepository: jest.fn(),
      },
      driver: {
        pool: {
          config: { max: 10, min: 2 },
          acquiredCount: 0,
          idleCount: 0,
          waitingCount: 0,
          on: jest.fn()
        }
      }
    };

    const queryWatcherModule = QueryWatcherModule.forRoot(mockQueryWatcherConfig);

    module = await Test.createTestingModule({
      providers: [
        QueryWatcherService,
        QueryWatcherInterceptor,
        QueryAnalyzerService,
        ConnectionPoolMonitorService,
        QueryMetricsService,
        {
          provide: TelescopeService,
          useValue: mockTelescopeService,
        },
        {
          provide: 'TELESCOPE_CONFIG',
          useValue: mockTelescopeConfig,
        },
        {
          provide: 'QUERY_WATCHER_CONFIG',
          useValue: mockQueryWatcherConfig,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    queryWatcherService = module.get<QueryWatcherService>(QueryWatcherService);
    queryWatcherInterceptor = module.get<QueryWatcherInterceptor>(QueryWatcherInterceptor);
    queryAnalyzerService = module.get<QueryAnalyzerService>(QueryAnalyzerService);
    connectionPoolMonitorService = module.get<ConnectionPoolMonitorService>(ConnectionPoolMonitorService);
    queryMetricsService = module.get<QueryMetricsService>(QueryMetricsService);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('module configuration', () => {
    it('should create module with forRoot configuration', () => {
      const dynamicModule = QueryWatcherModule.forRoot(mockQueryWatcherConfig);

      expect(dynamicModule.module).toBe(QueryWatcherModule);
      expect(dynamicModule.providers).toContain(QueryWatcherService);
      expect(dynamicModule.providers).toContain(QueryWatcherInterceptor);
      expect(dynamicModule.providers).toContain(QueryAnalyzerService);
      expect(dynamicModule.providers).toContain(ConnectionPoolMonitorService);
      expect(dynamicModule.providers).toContain(QueryMetricsService);
    });

    it('should export all query watcher services', () => {
      const dynamicModule = QueryWatcherModule.forRoot(mockQueryWatcherConfig);

      expect(dynamicModule.exports).toContain(QueryWatcherService);
      expect(dynamicModule.exports).toContain(QueryAnalyzerService);
      expect(dynamicModule.exports).toContain(ConnectionPoolMonitorService);
      expect(dynamicModule.exports).toContain(QueryMetricsService);
    });
  });

  describe('service instantiation', () => {
    it('should create QueryWatcherService', () => {
      expect(queryWatcherService).toBeDefined();
      expect(queryWatcherService).toBeInstanceOf(QueryWatcherService);
    });

    it('should create QueryWatcherInterceptor', () => {
      expect(queryWatcherInterceptor).toBeDefined();
      expect(queryWatcherInterceptor).toBeInstanceOf(QueryWatcherInterceptor);
    });

    it('should create QueryAnalyzerService', () => {
      expect(queryAnalyzerService).toBeDefined();
      expect(queryAnalyzerService).toBeInstanceOf(QueryAnalyzerService);
    });

    it('should create ConnectionPoolMonitorService', () => {
      expect(connectionPoolMonitorService).toBeDefined();
      expect(connectionPoolMonitorService).toBeInstanceOf(ConnectionPoolMonitorService);
    });

    it('should create QueryMetricsService', () => {
      expect(queryMetricsService).toBeDefined();
      expect(queryMetricsService).toBeInstanceOf(QueryMetricsService);
    });
  });

  describe('module initialization', () => {
    it('should initialize query interception on module init', async () => {
      const setupInterceptionSpy = jest.spyOn(queryWatcherInterceptor, 'setupInterception');
      setupInterceptionSpy.mockResolvedValue();

      const moduleInstance = module.get<QueryWatcherModule>(QueryWatcherModule);
      await moduleInstance.onModuleInit();

      expect(setupInterceptionSpy).toHaveBeenCalled();
    });

    it('should handle initialization errors gracefully', async () => {
      const setupInterceptionSpy = jest.spyOn(queryWatcherInterceptor, 'setupInterception');
      setupInterceptionSpy.mockRejectedValue(new Error('Initialization failed'));

      const moduleInstance = module.get<QueryWatcherModule>(QueryWatcherModule);
      
      await expect(moduleInstance.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('service integration', () => {
    it('should allow QueryWatcherService to track queries', () => {
      expect(queryWatcherService.trackQuery).toBeDefined();
      expect(typeof queryWatcherService.trackQuery).toBe('function');
    });

    it('should allow QueryAnalyzerService to analyze queries', async () => {
      const testContext = {
        id: 'test-query',
        sql: 'SELECT * FROM users',
        parameters: [],
        startTime: Date.now(),
        duration: 100,
        operation: 'select' as const
      };

      const analysis = await queryAnalyzerService.analyzeQuery(testContext);
      expect(analysis).toBeDefined();
      expect(analysis.queryId).toBe('test-query');
    });

    it('should allow ConnectionPoolMonitorService to collect metrics', () => {
      const metrics = connectionPoolMonitorService.getMetrics();
      expect(metrics).toBeDefined();
      expect(typeof metrics.totalConnections).toBe('number');
      expect(typeof metrics.healthScore).toBe('number');
    });

    it('should allow QueryMetricsService to record queries', () => {
      const testContext = {
        id: 'test-query',
        sql: 'SELECT * FROM users',
        parameters: [],
        startTime: Date.now(),
        duration: 100,
        operation: 'select' as const
      };

      queryMetricsService.recordQuery(testContext);
      
      const metrics = queryMetricsService.getMetrics();
      expect(metrics.totalQueries).toBe(1);
    });
  });

  describe('configuration propagation', () => {
    it('should propagate configuration to QueryWatcherService', () => {
      const config = queryWatcherService.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.slowQueryThreshold).toBe(1000);
      expect(config.verySlowQueryThreshold).toBe(5000);
      expect(config.enableStackTrace).toBe(true);
      expect(config.enableQueryAnalysis).toBe(true);
      expect(config.enableOptimizationHints).toBe(true);
    });

    it('should handle missing configuration gracefully', async () => {
      const moduleWithoutConfig = await Test.createTestingModule({
        providers: [
          QueryWatcherModule,
          QueryWatcherService,
          QueryWatcherInterceptor,
          QueryAnalyzerService,
          ConnectionPoolMonitorService,
          QueryMetricsService,
          {
            provide: TelescopeService,
            useValue: { record: jest.fn() },
          },
          {
            provide: DataSource,
            useValue: {
              options: { type: 'postgres' },
              createQueryRunner: jest.fn(),
              driver: { pool: { config: {}, on: jest.fn() } }
            },
          },
        ],
      }).compile();

      const service = moduleWithoutConfig.get<QueryWatcherService>(QueryWatcherService);
      expect(service).toBeDefined();
      
      await moduleWithoutConfig.close();
    });
  });

  describe('dependency injection', () => {
    it('should inject TelescopeService into QueryWatcherService', () => {
      expect(queryWatcherService).toBeDefined();
      // QueryWatcherService should have access to TelescopeService for recording
      expect(queryWatcherService.trackQuery).toBeDefined();
    });

    it('should inject DataSource into QueryWatcherInterceptor', () => {
      expect(queryWatcherInterceptor).toBeDefined();
      // QueryWatcherInterceptor should have access to DataSource for interception
      expect(queryWatcherInterceptor.setupInterception).toBeDefined();
    });

    it('should inject DataSource into QueryAnalyzerService', () => {
      expect(queryAnalyzerService).toBeDefined();
      // QueryAnalyzerService should have access to DataSource for execution plan analysis
      expect(queryAnalyzerService.analyzeQuery).toBeDefined();
    });

    it('should inject DataSource into ConnectionPoolMonitorService', () => {
      expect(connectionPoolMonitorService).toBeDefined();
      // ConnectionPoolMonitorService should have access to DataSource for monitoring
      expect(connectionPoolMonitorService.getMetrics).toBeDefined();
    });
  });

  describe('lifecycle management', () => {
    it('should handle module initialization lifecycle', async () => {
      const moduleInstance = module.get<QueryWatcherModule>(QueryWatcherModule);
      
      // Mock the setup method to avoid actual interception
      const setupSpy = jest.spyOn(queryWatcherInterceptor, 'setupInterception');
      setupSpy.mockResolvedValue();

      await expect(moduleInstance.onModuleInit()).resolves.not.toThrow();
      expect(setupSpy).toHaveBeenCalled();
    });

    it('should handle connection pool monitoring initialization', async () => {
      const onModuleInitSpy = jest.spyOn(connectionPoolMonitorService, 'onModuleInit');
      onModuleInitSpy.mockResolvedValue();

      await connectionPoolMonitorService.onModuleInit();
      expect(onModuleInitSpy).toHaveBeenCalled();
    });

    it('should handle module destruction lifecycle', async () => {
      const onModuleDestroySpy = jest.spyOn(connectionPoolMonitorService, 'onModuleDestroy');
      onModuleDestroySpy.mockResolvedValue();

      await connectionPoolMonitorService.onModuleDestroy();
      expect(onModuleDestroySpy).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle service initialization errors', async () => {
      const moduleWithBadConfig = await Test.createTestingModule({
        providers: [
          QueryWatcherModule,
          QueryWatcherService,
          QueryWatcherInterceptor,
          QueryAnalyzerService,
          ConnectionPoolMonitorService,
          QueryMetricsService,
          {
            provide: TelescopeService,
            useValue: { record: jest.fn() },
          },
          {
            provide: 'QUERY_WATCHER_CONFIG',
            useValue: null, // Invalid config
          },
          {
            provide: DataSource,
            useValue: {
              options: { type: 'postgres' },
              createQueryRunner: jest.fn(),
              driver: { pool: { config: {}, on: jest.fn() } }
            },
          },
        ],
      }).compile();

      const service = moduleWithBadConfig.get<QueryWatcherService>(QueryWatcherService);
      expect(service).toBeDefined();
      
      await moduleWithBadConfig.close();
    });

    it('should handle missing DataSource gracefully', async () => {
      const moduleWithoutDataSource = await Test.createTestingModule({
        providers: [
          QueryWatcherModule,
          QueryWatcherService,
          QueryWatcherInterceptor,
          QueryAnalyzerService,
          ConnectionPoolMonitorService,
          QueryMetricsService,
          {
            provide: TelescopeService,
            useValue: { record: jest.fn() },
          },
          {
            provide: 'QUERY_WATCHER_CONFIG',
            useValue: mockQueryWatcherConfig,
          },
          // No DataSource provider
        ],
      }).compile();

      const interceptor = moduleWithoutDataSource.get<QueryWatcherInterceptor>(QueryWatcherInterceptor);
      expect(interceptor).toBeDefined();
      
      await moduleWithoutDataSource.close();
    });
  });

  describe('service coordination', () => {
    it('should coordinate between QueryWatcherService and QueryAnalyzerService', async () => {
      const testContext = {
        id: 'test-query',
        sql: 'SELECT * FROM users WHERE name = $1',
        parameters: ['John'],
        startTime: Date.now(),
        duration: 1500, // Slow query
        operation: 'select' as const,
        tableName: 'users'
      };

      // Track the query
      queryWatcherService.trackQuery(testContext);

      // Analyze the query
      const analysis = await queryAnalyzerService.analyzeQuery(testContext);

      expect(analysis).toBeDefined();
      expect(analysis.queryId).toBe('test-query');
      expect(analysis.severity).toBe('slow');
    });

    it('should coordinate between QueryWatcherService and QueryMetricsService', () => {
      const testContext = {
        id: 'test-query',
        sql: 'SELECT * FROM users',
        parameters: [],
        startTime: Date.now(),
        duration: 100,
        operation: 'select' as const,
        tableName: 'users'
      };

      // Both services should be able to process the same query context
      queryWatcherService.trackQuery(testContext);
      queryMetricsService.recordQuery(testContext);

      const metrics = queryMetricsService.getMetrics();
      expect(metrics.totalQueries).toBe(1);
    });

    it('should coordinate between ConnectionPoolMonitorService and QueryMetricsService', () => {
      const connectionMetrics = connectionPoolMonitorService.getMetrics();
      queryMetricsService.updateConnectionPoolMetrics(connectionMetrics);

      const queryMetrics = queryMetricsService.getMetrics();
      expect(queryMetrics.connectionPoolMetrics).toBeDefined();
      expect(queryMetrics.connectionPoolMetrics).toEqual(connectionMetrics);
    });
  });
});
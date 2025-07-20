import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { TelescopeService } from '../services/telescope.service';
import { MetricsService } from '../services/metrics.service';
import { ResilientBridgeService } from '../../devtools/bridge/resilient-bridge.service';
import { TelescopeConfig } from '../interfaces/telescope-config.interface';

describe('HealthController', () => {
  let controller: HealthController;
  let telescopeService: jest.Mocked<TelescopeService>;
  let metricsService: jest.Mocked<MetricsService>;
  let resilientBridge: jest.Mocked<ResilientBridgeService>;

  beforeEach(async () => {
    const mockTelescopeService = {
      // Add telescope service methods as needed
    };

    const mockMetricsService = {
      getMetrics: jest.fn(),
      getPerformanceReport: jest.fn(),
    };

    const mockResilientBridge = {
      getHealthStatus: jest.fn(),
      getCircuitBreakerStatus: jest.fn(),
      getStreamMetrics: jest.fn(),
      getComprehensiveStatus: jest.fn(),
    };

    const mockConfig: TelescopeConfig = {
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
        analytics: true,
        customWatchers: true
      },
      watchers: {
        request: {
          enabled: true,
          priority: 1,
          tags: [],
          dependencies: []
        },
        query: {
          enabled: true,
          priority: 1,
          tags: [],
          dependencies: []
        }
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: TelescopeService,
          useValue: mockTelescopeService,
        },
        {
          provide: MetricsService,
          useValue: mockMetricsService,
        },
        {
          provide: ResilientBridgeService,
          useValue: mockResilientBridge,
        },
        {
          provide: 'TELESCOPE_CONFIG',
          useValue: mockConfig,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    telescopeService = module.get(TelescopeService);
    metricsService = module.get(MetricsService);
    resilientBridge = module.get(ResilientBridgeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getHealth', () => {
    it('should return healthy status when all services are healthy', async () => {
      // Mock healthy responses
      metricsService.getMetrics.mockReturnValue({
        totalEntries: 100,
        totalBatches: 10,
        successfulBatches: 10,
        failedBatches: 0,
        averageProcessingTime: 100,
        throughput: 10,
        errorRate: 0,
        uptime: 60000
      });

      metricsService.getPerformanceReport.mockReturnValue({
        metrics: {
          totalEntries: 100,
          totalBatches: 10,
          successfulBatches: 10,
          failedBatches: 0,
          averageProcessingTime: 100,
          throughput: 10,
          errorRate: 0,
          uptime: 60000
        },
        samples: {
          processingTimes: [100, 110, 90],
          recentBatches: 3
        },
        status: {
          isHealthy: true,
          alerts: []
        }
      });

      resilientBridge.getHealthStatus.mockReturnValue({
        isHealthy: true,
        issues: [],
        circuitBreakers: {},
        streamMetrics: {},
        lastHealthCheckAt: new Date()
      });

      resilientBridge.getCircuitBreakerStatus.mockReturnValue({
        storage: { state: 'closed', failures: 0 },
        devtools: { state: 'closed', failures: 0 }
      });

      resilientBridge.getStreamMetrics.mockReturnValue({
        entriesInQueue: 0,
        errorCount: 0,
        averageProcessingTime: 100,
        throughput: 10,
        isProcessing: true,
        subscriptions: 2
      });

      const result = await controller.getHealth();

      expect(result.status).toBe('healthy');
      expect(result.services.telescope.status).toBe('healthy');
      expect(result.services.metrics.status).toBe('healthy');
      expect(result.services.bridge.status).toBe('healthy');
      expect(result.services.storage.status).toBe('healthy');
      expect(result.metrics.totalEntries).toBe(100);
      expect(result.metrics.errorRate).toBe(0);
    });

    it('should return degraded status when some services have issues', async () => {
      metricsService.getMetrics.mockReturnValue({
        totalEntries: 100,
        totalBatches: 10,
        successfulBatches: 8,
        failedBatches: 2,
        averageProcessingTime: 100,
        throughput: 10,
        errorRate: 20,
        uptime: 60000
      });

      metricsService.getPerformanceReport.mockReturnValue({
        metrics: {
          totalEntries: 100,
          totalBatches: 10,
          successfulBatches: 8,
          failedBatches: 2,
          averageProcessingTime: 100,
          throughput: 10,
          errorRate: 20,
          uptime: 60000
        },
        samples: {
          processingTimes: [100, 110, 90],
          recentBatches: 3
        },
        status: {
          isHealthy: false,
          alerts: ['High error rate: 20.00%']
        }
      });

      resilientBridge.getHealthStatus.mockReturnValue({
        isHealthy: false,
        issues: ['High error count: 50'],
        circuitBreakers: {},
        streamMetrics: {},
        lastHealthCheckAt: new Date()
      });

      resilientBridge.getCircuitBreakerStatus.mockReturnValue({
        storage: { state: 'closed', failures: 0 },
        devtools: { state: 'half-open', failures: 2 }
      });

      const result = await controller.getHealth();

      expect(result.status).toBe('degraded');
      expect(result.services.metrics.status).toBe('degraded');
      expect(result.services.bridge.status).toBe('degraded');
    });

    it('should return unhealthy status when critical services fail', async () => {
      metricsService.getMetrics.mockImplementation(() => {
        throw new Error('Metrics service unavailable');
      });

      const result = await controller.getHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.services.telescope.status).toBe('unhealthy');
      expect(result.services.metrics.status).toBe('unhealthy');
      expect(result.services.bridge.status).toBe('unhealthy');
      expect(result.services.storage.status).toBe('unhealthy');
      expect(result.metrics.errorRate).toBe(100);
    });
  });

  describe('getDetailedHealth', () => {
    it('should return detailed health information', async () => {
      metricsService.getMetrics.mockReturnValue({
        totalEntries: 100,
        totalBatches: 10,
        successfulBatches: 10,
        failedBatches: 0,
        averageProcessingTime: 100,
        throughput: 10,
        errorRate: 0,
        uptime: 60000
      });

      metricsService.getPerformanceReport.mockReturnValue({
        metrics: {
          totalEntries: 100,
          totalBatches: 10,
          successfulBatches: 10,
          failedBatches: 0,
          averageProcessingTime: 100,
          throughput: 10,
          errorRate: 0,
          uptime: 60000
        },
        samples: {
          processingTimes: [100, 110, 90],
          recentBatches: 3
        },
        status: {
          isHealthy: true,
          alerts: []
        }
      });

      resilientBridge.getHealthStatus.mockReturnValue({
        isHealthy: true,
        issues: [],
        circuitBreakers: {},
        streamMetrics: {},
        lastHealthCheckAt: new Date()
      });

      resilientBridge.getCircuitBreakerStatus.mockReturnValue({
        storage: { state: 'closed', failures: 0 }
      });

      resilientBridge.getStreamMetrics.mockReturnValue({
        entriesInQueue: 0,
        errorCount: 0,
        averageProcessingTime: 100,
        throughput: 10,
        isProcessing: true,
        subscriptions: 2
      });

      resilientBridge.getComprehensiveStatus.mockReturnValue({
        bridge: {
          isHealthy: true,
          issues: [],
          circuitBreakers: {},
          streamMetrics: {},
          lastHealthCheckAt: new Date()
        },
        circuitBreakers: {},
        streamMetrics: {},
        configuration: {
          resilience: {
            circuitBreakerEnabled: true,
            fallbackEnabled: true,
            maxRetries: 3,
            retryDelayMs: 1000,
            healthCheckIntervalMs: 30000
          },
          stream: {}
        }
      });

      const result = await controller.getDetailedHealth();

      expect(result.status).toBe('healthy');
      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics.bridge).toBeDefined();
      expect(result.diagnostics.circuitBreakers).toBeDefined();
      expect(result.diagnostics.streamMetrics).toBeDefined();
      expect(result.diagnostics.configuration).toBeDefined();
      expect(result.diagnostics.performanceReport).toBeDefined();
    });
  });

  describe('getMetrics', () => {
    it('should return performance metrics', async () => {
      metricsService.getMetrics.mockReturnValue({
        totalEntries: 100,
        totalBatches: 10,
        successfulBatches: 10,
        failedBatches: 0,
        averageProcessingTime: 100,
        throughput: 10,
        errorRate: 0,
        uptime: 60000
      });

      metricsService.getPerformanceReport.mockReturnValue({
        metrics: {
          totalEntries: 100,
          totalBatches: 10,
          successfulBatches: 10,
          failedBatches: 0,
          averageProcessingTime: 100,
          throughput: 10,
          errorRate: 0,
          uptime: 60000
        },
        samples: {
          processingTimes: [100, 110, 90],
          recentBatches: 3
        },
        status: {
          isHealthy: true,
          alerts: []
        }
      });

      resilientBridge.getStreamMetrics.mockReturnValue({
        entriesInQueue: 0,
        errorCount: 0,
        averageProcessingTime: 100,
        throughput: 10,
        isProcessing: true,
        subscriptions: 2
      });

      const result = await controller.getMetrics();

      expect(result.timestamp).toBeDefined();
      expect(result.uptime).toBeDefined();
      expect(result.metrics).toBeDefined();
      expect(result.streamMetrics).toBeDefined();
      expect(result.performanceReport).toBeDefined();
    });
  });

  describe('getCircuitBreakers', () => {
    it('should return circuit breaker status', async () => {
      resilientBridge.getCircuitBreakerStatus.mockReturnValue({
        storage: { state: 'closed', failures: 0 },
        devtools: { state: 'open', failures: 5 }
      });

      resilientBridge.getHealthStatus.mockReturnValue({
        isHealthy: false,
        issues: ['DevTools circuit breaker open'],
        circuitBreakers: {
          storage: { state: 'closed', failures: 0 },
          devtools: { state: 'open', failures: 5 }
        },
        streamMetrics: {},
        lastHealthCheckAt: new Date()
      });

      const result = await controller.getCircuitBreakers();

      expect(result.timestamp).toBeDefined();
      expect(result.circuitBreakers).toBeDefined();
      expect(result.circuitBreakers.storage.state).toBe('closed');
      expect(result.circuitBreakers.devtools.state).toBe('open');
      expect(result.bridgeHealth).toBeDefined();
      expect(result.bridgeHealth.isHealthy).toBe(false);
    });
  });
});
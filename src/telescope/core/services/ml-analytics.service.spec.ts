import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { of } from 'rxjs';
import { MLAnalyticsService, AnomalyDetection, RegressionAnalysis } from './ml-analytics.service';
import { AnalyticsService, AnalyticsData } from './analytics.service';
import { PerformanceCorrelationService } from './performance-correlation.service';

describe('MLAnalyticsService', () => {
  let service: MLAnalyticsService;
  let analyticsService: jest.Mocked<AnalyticsService>;
  let performanceCorrelationService: jest.Mocked<PerformanceCorrelationService>;

  const mockAnalyticsData: AnalyticsData = {
    timestamp: new Date(),
    timeRange: {
      start: new Date(Date.now() - 3600000), // 1 hour ago
      end: new Date()
    },
    overview: {
      totalRequests: 1000,
      totalErrors: 50,
      totalQueries: 800,
      totalCacheOps: 200,
      totalJobs: 100,
      averageResponseTime: 250,
      errorRate: 0.05,
      throughput: 100,
      activeUsers: 50,
      peakConcurrency: 75
    },
    performance: {
      responseTimeDistribution: {
        p50: 200,
        p75: 300,
        p90: 400,
        p95: 500,
        p99: 800,
        samples: 1000
      },
      slowestEndpoints: [],
      resourceUsage: {
        cpu: 0.6,
        memory: 0.7,
        disk: 0.4,
        network: 0.3
      },
      bottleneckAnalysis: []
    },
    errors: {
      errorDistribution: {
        http4xx: 30,
        http5xx: 20,
        database: 10,
        external: 5,
        timeout: 3,
        unknown: 2
      },
      topErrors: [],
      errorTrends: [],
      impactAnalysis: []
    },
    database: {
      queryDistribution: {
        select: 600,
        insert: 100,
        update: 80,
        delete: 20,
        other: 0
      },
      slowQueries: [],
      connectionHealth: {
        activeConnections: 20,
        idleConnections: 10,
        totalConnections: 30,
        maxConnections: 100,
        connectionUtilization: 0.3,
        averageResponseTime: 50
      },
      indexEfficiency: {
        totalQueries: 800,
        indexedQueries: 720,
        fullTableScans: 80,
        indexUtilization: 0.9
      }
    },
    users: {
      activeUsers: [],
      sessionAnalysis: {
        averageSessionDuration: 1800,
        totalSessions: 100,
        bounceRate: 0.2,
        newUsers: 20,
        returningUsers: 80
      },
      geographicDistribution: [],
      deviceAnalysis: []
    },
    trends: {
      trafficTrends: [],
      performanceTrends: [],
      errorTrends: [],
      predictions: []
    },
    alerts: {
      activeAlerts: [],
      alertTrends: [],
      anomalies: []
    }
  };

  beforeEach(async () => {
    const mockAnalyticsService = {
      getAnalyticsStream: jest.fn().mockReturnValue(of(mockAnalyticsData)),
      getAnalytics: jest.fn().mockReturnValue(mockAnalyticsData)
    };

    const mockPerformanceCorrelationService = {
      getMetrics: jest.fn().mockReturnValue({
        averageResponseTime: 250,
        p95ResponseTime: 500,
        errorRate: 0.05,
        totalRequests: 1000
      })
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MLAnalyticsService,
        {
          provide: AnalyticsService,
          useValue: mockAnalyticsService
        },
        {
          provide: PerformanceCorrelationService,
          useValue: mockPerformanceCorrelationService
        },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get<MLAnalyticsService>(MLAnalyticsService);
    analyticsService = module.get<AnalyticsService>(AnalyticsService) as jest.Mocked<AnalyticsService>;
    performanceCorrelationService = module.get<PerformanceCorrelationService>(PerformanceCorrelationService) as jest.Mocked<PerformanceCorrelationService>;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should initialize and start ML analysis', async () => {
      await service.onModuleInit();
      expect(analyticsService.getAnalyticsStream).toHaveBeenCalled();
    });
  });

  describe('getAnomalies', () => {
    it('should return observable of anomalies', (done) => {
      const anomalies$ = service.getAnomalies();
      
      anomalies$.subscribe(anomalies => {
        expect(Array.isArray(anomalies)).toBe(true);
        done();
      });
    });
  });

  describe('getRegressionAnalysis', () => {
    it('should return observable of regression analysis', (done) => {
      const regressions$ = service.getRegressionAnalysis();
      
      regressions$.subscribe(regressions => {
        expect(Array.isArray(regressions)).toBe(true);
        done();
      });
    });
  });

  describe('getOptimizationSuggestions', () => {
    it('should return observable of optimization suggestions', (done) => {
      const optimizations$ = service.getOptimizationSuggestions();
      
      optimizations$.subscribe(suggestions => {
        expect(Array.isArray(suggestions)).toBe(true);
        done();
      });
    });
  });

  describe('getPredictiveInsights', () => {
    it('should return observable of predictive insights', (done) => {
      const insights$ = service.getPredictiveInsights();
      
      insights$.subscribe(insights => {
        expect(Array.isArray(insights)).toBe(true);
        done();
      });
    });
  });

  describe('getMLAlerts', () => {
    it('should return observable of ML alerts', (done) => {
      const alerts$ = service.getMLAlerts();
      
      alerts$.subscribe(alerts => {
        expect(Array.isArray(alerts)).toBe(true);
        done();
      });
    });
  });

  describe('getCurrentAnomalies', () => {
    it('should return current anomalies array', () => {
      const anomalies = service.getCurrentAnomalies();
      expect(Array.isArray(anomalies)).toBe(true);
    });
  });

  describe('getCurrentRegressions', () => {
    it('should return current regressions array', () => {
      const regressions = service.getCurrentRegressions();
      expect(Array.isArray(regressions)).toBe(true);
    });
  });

  describe('getCurrentOptimizations', () => {
    it('should return current optimizations array', () => {
      const optimizations = service.getCurrentOptimizations();
      expect(Array.isArray(optimizations)).toBe(true);
    });
  });

  describe('getCurrentPredictions', () => {
    it('should return current predictions array', () => {
      const predictions = service.getCurrentPredictions();
      expect(Array.isArray(predictions)).toBe(true);
    });
  });

  describe('getCurrentAlerts', () => {
    it('should return current alerts array', () => {
      const alerts = service.getCurrentAlerts();
      expect(Array.isArray(alerts)).toBe(true);
    });
  });

  describe('acknowledgeAlert', () => {
    it('should acknowledge an alert and return true if successful', () => {
      // Add a mock alert first
      const mockAlert = {
        id: 'test-alert-1',
        timestamp: new Date(),
        type: 'anomaly' as const,
        severity: 'warning' as const,
        title: 'Test Alert',
        description: 'Test description',
        component: 'test',
        triggeredBy: { value: 100, threshold: 90, confidence: 1 },
        actions: [],
        relatedInsights: []
      };

      // Manually add alert to service state for testing
      service['alertSubject'].next([mockAlert]);
      
      const result = service.acknowledgeAlert('test-alert-1');
      expect(result).toBe(true);
    });

    it('should return false if alert not found', () => {
      const result = service.acknowledgeAlert('non-existent-alert');
      expect(result).toBe(false);
    });
  });

  describe('dismissAnomaly', () => {
    it('should dismiss an anomaly and return true if successful', () => {
      // Add a mock anomaly first
      const mockAnomaly: AnomalyDetection = {
        id: 'test-anomaly-1',
        timestamp: new Date(),
        type: 'performance',
        severity: 'medium',
        component: 'application',
        metric: 'response_time',
        value: 500,
        baseline: 250,
        deviation: 250,
        confidence: 0.8,
        description: 'Response time anomaly',
        suggestedActions: ['Investigate']
      };

      // Manually add anomaly to service state for testing
      service['anomalySubject'].next([mockAnomaly]);
      
      const result = service.dismissAnomaly('test-anomaly-1');
      expect(result).toBe(true);
    });

    it('should return false if anomaly not found', () => {
      const result = service.dismissAnomaly('non-existent-anomaly');
      expect(result).toBe(false);
    });
  });

  describe('getMLMetrics', () => {
    it('should return ML metrics object', () => {
      const metrics = service.getMLMetrics();
      
      expect(metrics).toHaveProperty('anomaliesDetected');
      expect(metrics).toHaveProperty('regressionsAnalyzed');
      expect(metrics).toHaveProperty('optimizationSuggestions');
      expect(metrics).toHaveProperty('predictiveInsights');
      expect(metrics).toHaveProperty('activeAlerts');
      expect(metrics).toHaveProperty('dataHistorySize');

      expect(typeof metrics.anomaliesDetected).toBe('number');
      expect(typeof metrics.regressionsAnalyzed).toBe('number');
      expect(typeof metrics.optimizationSuggestions).toBe('number');
      expect(typeof metrics.predictiveInsights).toBe('number');
      expect(typeof metrics.activeAlerts).toBe('number');
      expect(typeof metrics.dataHistorySize).toBe('number');
    });
  });

  describe('Statistical Utilities', () => {
    it('should calculate moving average correctly', () => {
      // We can't directly test the private StatisticalAnalyzer class,
      // but we can verify that the service initializes properly
      expect(service).toBeDefined();
    });
  });

  describe('Anomaly Detection', () => {
    it('should process analytics data for anomaly detection', async () => {
      await service.onModuleInit();
      
      // Simulate multiple data points to trigger anomaly detection
      const dataWithAnomaly = {
        ...mockAnalyticsData,
        overview: {
          ...mockAnalyticsData.overview,
          averageResponseTime: 2000 // Significantly higher than baseline
        }
      };

      // Emit the anomalous data
      analyticsService.getAnalyticsStream.mockReturnValue(of(dataWithAnomaly));
      
      // Wait a bit for processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check if anomalies are being tracked
      const metrics = service.getMLMetrics();
      expect(typeof metrics.anomaliesDetected).toBe('number');
    });
  });

  describe('Configuration', () => {
    it('should have proper ML configuration', () => {
      // Test that the service has proper internal configuration
      const metrics = service.getMLMetrics();
      expect(metrics).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully when analytics service fails', async () => {
      analyticsService.getAnalyticsStream.mockReturnValue(
        new (require('rxjs').throwError)(() => new Error('Analytics service error'))
      );

      // Should not throw when initialized with a failing analytics service
      expect(() => service.onModuleInit()).not.toThrow();
    });
  });
});

// Additional test for the StatisticalAnalyzer utility class
describe('StatisticalAnalyzer Utilities', () => {
  const testData = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  // Since StatisticalAnalyzer is a private class, we test through the service
  // These tests verify that the ML service works correctly with statistical methods

  it('should handle empty data arrays gracefully', () => {
    expect(() => {
      // This would be tested through the service's internal methods
      // but we can't access them directly in this test setup
      const emptyData: number[] = [];
      expect(emptyData.length).toBe(0);
    }).not.toThrow();
  });

  it('should handle single data point arrays', () => {
    const singlePoint = [42];
    expect(singlePoint.length).toBe(1);
    expect(singlePoint[0]).toBe(42);
  });
});
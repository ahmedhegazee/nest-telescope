import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ResilientBridgeService } from './resilient-bridge.service';
import { StreamProcessingBridgeService } from './stream-processing-bridge.service';
import { CircuitBreakerOpenError } from './circuit-breaker';
import { TelescopeConfig } from '../../core/interfaces/telescope-config.interface';

describe('ResilientBridgeService', () => {
  let service: ResilientBridgeService;
  let streamBridge: jest.Mocked<StreamProcessingBridgeService>;
  let mockConfig: TelescopeConfig;

  beforeEach(async () => {
    const mockStreamBridge = {
      processDevToolsEntry: jest.fn(),
      getStreamMetrics: jest.fn(),
      getStreamConfiguration: jest.fn(),
      getHealthStatus: jest.fn(),
      flushBuffer: jest.fn(),
      updateStreamConfiguration: jest.fn(),
    };

    mockConfig = {
      enabled: true,
      storage: {
        driver: 'memory',
        batch: {
          enabled: true,
          size: 100,
          flushInterval: 1000
        }
      },
      devtools: {
        enabled: true,
        bridge: {
          resilience: {
            circuitBreakerEnabled: true,
            fallbackEnabled: true,
            maxRetries: 3,
            retryDelayMs: 100,
            healthCheckIntervalMs: 1000
          }
        }
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResilientBridgeService,
        {
          provide: StreamProcessingBridgeService,
          useValue: mockStreamBridge,
        },
        {
          provide: 'TELESCOPE_CONFIG',
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<ResilientBridgeService>(ResilientBridgeService);
    streamBridge = module.get(StreamProcessingBridgeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize with circuit breakers when enabled', async () => {
      await service.onModuleInit();
      
      const circuitBreakers = service.getCircuitBreakerStatus();
      expect(Object.keys(circuitBreakers)).toContain('storage');
      expect(Object.keys(circuitBreakers)).toContain('devtools');
      expect(Object.keys(circuitBreakers)).toContain('stream');
    });

    it('should start health checks on init', async () => {
      const healthCheckSpy = jest.spyOn(service as any, 'performHealthCheck');
      await service.onModuleInit();
      
      // Wait for initial health check
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(healthCheckSpy).toHaveBeenCalled();
    });
  });

  describe('processDevToolsEntryWithResilience', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should process entry successfully', async () => {
      const entry = { id: 'test-1', data: 'test-data' };
      const type = 'test-type';
      
      streamBridge.processDevToolsEntry.mockResolvedValue(undefined);
      
      await service.processDevToolsEntryWithResilience(entry, type);
      
      expect(streamBridge.processDevToolsEntry).toHaveBeenCalledWith(entry, type);
    });

    it('should retry on failure', async () => {
      const entry = { id: 'test-1', data: 'test-data' };
      const type = 'test-type';
      
      streamBridge.processDevToolsEntry
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValue(undefined);
      
      await service.processDevToolsEntryWithResilience(entry, type);
      
      expect(streamBridge.processDevToolsEntry).toHaveBeenCalledTimes(2);
    });

    it('should use fallback when circuit breaker is open', async () => {
      const entry = { id: 'test-1', data: 'test-data' };
      const type = 'test-type';
      
      // Force circuit breaker to open
      service.openCircuitBreaker('stream');
      
      const fallbackSpy = jest.spyOn(service as any, 'fallbackProcessing');
      fallbackSpy.mockResolvedValue(undefined);
      
      await service.processDevToolsEntryWithResilience(entry, type);
      
      expect(fallbackSpy).toHaveBeenCalledWith(entry, type);
    });

    it('should throw error after max retries', async () => {
      const entry = { id: 'test-1', data: 'test-data' };
      const type = 'test-type';
      
      streamBridge.processDevToolsEntry.mockRejectedValue(new Error('Persistent failure'));
      
      await expect(service.processDevToolsEntryWithResilience(entry, type))
        .rejects.toThrow('Persistent failure');
      
      expect(streamBridge.processDevToolsEntry).toHaveBeenCalledTimes(3);
    });
  });

  describe('health monitoring', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should return health status', () => {
      streamBridge.getStreamMetrics.mockReturnValue({
        entriesInQueue: 0,
        errorCount: 0,
        averageProcessingTime: 100,
        throughput: 10,
        isProcessing: true,
        subscriptions: 2
      });

      streamBridge.getHealthStatus.mockReturnValue({
        isHealthy: true,
        issues: [],
        lastProcessedAt: new Date()
      });

      const health = service.getHealthStatus();
      expect(health).toBeDefined();
      expect(health.isHealthy).toBe(true);
    });

    it('should detect unhealthy state', () => {
      streamBridge.getStreamMetrics.mockReturnValue({
        entriesInQueue: 0,
        errorCount: 100,
        averageProcessingTime: 15000,
        throughput: 0.1,
        isProcessing: false,
        subscriptions: 0
      });

      streamBridge.getHealthStatus.mockReturnValue({
        isHealthy: false,
        issues: ['Stream processing not active', 'High error count'],
        lastProcessedAt: new Date()
      });

      const health = service.getHealthStatus();
      expect(health.isHealthy).toBe(false);
      expect(health.issues.length).toBeGreaterThan(0);
    });
  });

  describe('circuit breaker management', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should open circuit breaker manually', () => {
      service.openCircuitBreaker('storage');
      
      const status = service.getCircuitBreakerStatus();
      expect(status.storage.state).toBe('open');
    });

    it('should close circuit breaker manually', () => {
      service.openCircuitBreaker('storage');
      service.closeCircuitBreaker('storage');
      
      const status = service.getCircuitBreakerStatus();
      expect(status.storage.state).toBe('closed');
    });

    it('should reset circuit breaker', () => {
      service.openCircuitBreaker('storage');
      service.resetCircuitBreaker('storage');
      
      const status = service.getCircuitBreakerStatus();
      expect(status.storage.state).toBe('closed');
      expect(status.storage.failures).toBe(0);
    });

    it('should reset all circuit breakers', () => {
      service.openCircuitBreaker('storage');
      service.openCircuitBreaker('devtools');
      service.resetAllCircuitBreakers();
      
      const status = service.getCircuitBreakerStatus();
      expect(status.storage.state).toBe('closed');
      expect(status.devtools.state).toBe('closed');
    });
  });

  describe('performance optimization integration', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should update stream configuration', () => {
      const newConfig = { bufferTimeMs: 2000, maxBufferSize: 200 };
      
      service.updateStreamConfiguration(newConfig);
      
      expect(streamBridge.updateStreamConfiguration).toHaveBeenCalledWith(newConfig);
    });

    it('should flush stream buffer', async () => {
      await service.flushStreamBuffer();
      
      expect(streamBridge.flushBuffer).toHaveBeenCalled();
    });

    it('should return comprehensive status', () => {
      streamBridge.getStreamMetrics.mockReturnValue({
        entriesInQueue: 0,
        errorCount: 0,
        averageProcessingTime: 100,
        throughput: 10,
        isProcessing: true,
        subscriptions: 2
      });

      streamBridge.getStreamConfiguration.mockReturnValue({
        bufferTimeMs: 1000,
        maxBufferSize: 100
      });

      const status = service.getComprehensiveStatus();
      
      expect(status.bridge).toBeDefined();
      expect(status.circuitBreakers).toBeDefined();
      expect(status.streamMetrics).toBeDefined();
      expect(status.configuration).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('should clean up resources on destroy', async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();
      
      // Health check interval should be cleared
      // Circuit breaker registry should be cleared
      const status = service.getCircuitBreakerStatus();
      expect(Object.keys(status)).toHaveLength(0);
    });
  });
});
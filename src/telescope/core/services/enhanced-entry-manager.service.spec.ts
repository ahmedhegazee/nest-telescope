import { Test, TestingModule } from '@nestjs/testing';
import { EnhancedEntryManagerService } from './enhanced-entry-manager.service';
import { StorageManagerService } from '../../storage/storage-manager.service';
import { MemoryStorageDriver } from '../../storage/drivers/memory-storage.driver';
import { TelescopeEntry } from '../interfaces/telescope-entry.interface';
import { TelescopeConfig } from '../interfaces/telescope-config.interface';

describe('EnhancedEntryManagerService', () => {
  let service: EnhancedEntryManagerService;
  let mockStorageManager: jest.Mocked<StorageManagerService>;

  const mockConfig: TelescopeConfig = {
    enabled: true,
    environment: 'test',
    devtools: {
      enabled: true,
      port: 8001,
      features: {
        dependencyGraph: true,
        interactivePlayground: true,
        performanceMetrics: true,
      },
    },
    storage: {
      driver: 'memory',
      fallback: 'memory',
      retention: { hours: 24, maxEntries: 1000 },
      batch: { enabled: false, size: 50, flushInterval: 5000 }, // Disable batching for tests
    },
    dashboard: {
      enabled: true,
      path: '/telescope',
      strategy: 'hybrid',
    },
    features: {
      realTimeUpdates: true,
      analytics: false,
      customWatchers: true,
    },
  };

  beforeEach(async () => {
    const mockStorageManagerService = {
      store: jest.fn(),
      storeBatch: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnhancedEntryManagerService,
        {
          provide: StorageManagerService,
          useValue: mockStorageManagerService,
        },
        {
          provide: 'TELESCOPE_CONFIG',
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<EnhancedEntryManagerService>(EnhancedEntryManagerService);
    mockStorageManager = module.get<StorageManagerService>(
      StorageManagerService
    ) as jest.Mocked<StorageManagerService>;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('process', () => {
    it('should process an entry immediately when batching is disabled', async () => {
      const entry: TelescopeEntry = {
        id: 'test-id',
        type: 'request',
        familyHash: 'hash123',
        content: { method: 'GET', url: '/test' },
        tags: ['http'],
        timestamp: new Date(),
        sequence: 1,
      };

      mockStorageManager.store.mockResolvedValue(undefined);

      await service.process(entry);

      expect(mockStorageManager.store).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-id',
          type: 'request',
          familyHash: 'hash123',
        })
      );
    });

    it('should add missing fields to entry', async () => {
      const entry: TelescopeEntry = {
        id: '',
        type: 'request',
        familyHash: '',
        content: { method: 'GET', url: '/test' },
        tags: [],
        timestamp: null as any,
        sequence: 0,
      };

      mockStorageManager.store.mockResolvedValue(undefined);

      await service.process(entry);

      expect(mockStorageManager.store).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^tel_/),
          type: 'request',
          familyHash: expect.any(String),
          timestamp: expect.any(Date),
          sequence: expect.any(Number),
          tags: expect.any(Array),
        })
      );
    });

    it('should route critical entries to immediate processing', async () => {
      const entry: TelescopeEntry = {
        id: 'critical-entry',
        type: 'request',
        familyHash: 'hash123',
        content: { method: 'GET', url: '/test' },
        tags: ['critical'],
        timestamp: new Date(),
        sequence: 1,
      };

      mockStorageManager.store.mockResolvedValue(undefined);

      await service.process(entry);

      expect(mockStorageManager.store).toHaveBeenCalledWith(entry);
    });

    it('should handle processing errors', async () => {
      const entry: TelescopeEntry = {
        id: 'test-id',
        type: 'request',
        familyHash: 'hash123',
        content: { method: 'GET', url: '/test' },
        tags: ['http'],
        timestamp: new Date(),
        sequence: 1,
      };

      mockStorageManager.store.mockRejectedValue(new Error('Storage error'));

      // Should not throw, but handle error gracefully
      await expect(service.process(entry)).resolves.not.toThrow();
    });
  });

  describe('processBatch', () => {
    it('should process multiple entries', async () => {
      const entries: TelescopeEntry[] = [
        {
          id: 'test-id-1',
          type: 'request',
          familyHash: 'hash123',
          content: { method: 'GET', url: '/test1' },
          tags: ['http'],
          timestamp: new Date(),
          sequence: 1,
        },
        {
          id: 'test-id-2',
          type: 'request',
          familyHash: 'hash456',
          content: { method: 'POST', url: '/test2' },
          tags: ['http'],
          timestamp: new Date(),
          sequence: 2,
        },
      ];

      mockStorageManager.store.mockResolvedValue(undefined);

      await service.processBatch(entries);

      expect(mockStorageManager.store).toHaveBeenCalledTimes(2);
    });

    it('should handle batch processing errors', async () => {
      const entries: TelescopeEntry[] = [
        {
          id: 'test-id-1',
          type: 'request',
          familyHash: 'hash123',
          content: { method: 'GET', url: '/test1' },
          tags: ['http'],
          timestamp: new Date(),
          sequence: 1,
        },
      ];

      mockStorageManager.store.mockRejectedValue(new Error('Storage error'));

      // Should not throw, but handle error gracefully
      await expect(service.processBatch(entries)).resolves.not.toThrow();
    });
  });

  describe('getMetrics', () => {
    it('should return processing metrics', () => {
      const metrics = service.getMetrics();
      
      expect(metrics).toBeDefined();
      expect(typeof metrics.getMetrics).toBe('function');
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue status', () => {
      const status = service.getQueueStatus();
      
      expect(status).toBeDefined();
      expect(status.retry).toBeDefined();
      expect(status.retry.name).toBe('retry');
    });
  });

  describe('forceFlushAll', () => {
    it('should flush all queues', async () => {
      await service.forceFlushAll();
      // Should complete without error
    });
  });

  describe('cleanup', () => {
    it('should cleanup resources', async () => {
      await service.cleanup();
      // Should complete without error
    });
  });
});
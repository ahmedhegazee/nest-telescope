import { Test, TestingModule } from '@nestjs/testing';
import { StorageManagerService } from './storage-manager.service';
import { MemoryStorageDriver } from './drivers/memory-storage.driver';
import { TelescopeEntry } from '../core/interfaces/telescope-entry.interface';
import { TelescopeConfig } from '../core/interfaces/telescope-config.interface';

describe('StorageManagerService', () => {
  let service: StorageManagerService;
  let mockConfig: TelescopeConfig;

  beforeEach(async () => {
    mockConfig = {
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
        batch: { enabled: true, size: 50, flushInterval: 5000 },
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageManagerService,
        {
          provide: 'TELESCOPE_CONFIG',
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<StorageManagerService>(StorageManagerService);
    
    // Wait for initialization
    await service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('store', () => {
    it('should store an entry using primary driver', async () => {
      const entry: TelescopeEntry = {
        id: 'test-id',
        type: 'request',
        familyHash: 'hash123',
        content: { method: 'GET', url: '/test' },
        tags: ['http'],
        timestamp: new Date(),
        sequence: 1,
      };

      await service.store(entry);

      // Verify the entry was stored
      const result = await service.findById('test-id');
      expect(result).toEqual(entry);
    });
  });

  describe('storeBatch', () => {
    it('should store multiple entries using primary driver', async () => {
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

      await service.storeBatch(entries);

      // Verify entries were stored
      const result1 = await service.findById('test-id-1');
      const result2 = await service.findById('test-id-2');
      expect(result1).toEqual(entries[0]);
      expect(result2).toEqual(entries[1]);
    });
  });

  describe('find', () => {
    it('should find entries using primary driver', async () => {
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
          type: 'query',
          familyHash: 'hash456',
          content: { sql: 'SELECT * FROM users' },
          tags: ['database'],
          timestamp: new Date(),
          sequence: 2,
        },
      ];

      await service.storeBatch(entries);

      const result = await service.find({ type: 'request' });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].type).toBe('request');
    });
  });

  describe('getStats', () => {
    it('should return storage statistics', async () => {
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
          type: 'query',
          familyHash: 'hash456',
          content: { sql: 'SELECT * FROM users' },
          tags: ['database'],
          timestamp: new Date(),
          sequence: 2,
        },
      ];

      await service.storeBatch(entries);

      const stats = await service.getStats();
      expect(stats.totalEntries).toBe(2);
      expect(stats.entriesByType.request).toBe(1);
      expect(stats.entriesByType.query).toBe(1);
    });
  });

  describe('getDetailedStats', () => {
    it('should return detailed statistics with driver info', async () => {
      const stats = await service.getDetailedStats();
      
      expect(stats.primary).toBe('memory');
      expect(stats.fallback).toBe('memory');
      expect(stats.health).toBeDefined();
      expect(stats.stats).toBeDefined();
    });
  });

  describe('getDriverHealth', () => {
    it('should return health status of all drivers', () => {
      const health = service.getDriverHealth();
      expect(health).toBeDefined();
      expect(typeof health.memory).toBe('boolean');
    });
  });

  describe('getAvailableDrivers', () => {
    it('should return list of available drivers', () => {
      const drivers = service.getAvailableDrivers();
      expect(drivers).toContain('memory');
      expect(drivers).toContain('file');
      expect(drivers).toContain('redis');
    });
  });

  describe('cleanup', () => {
    it('should cleanup all drivers', async () => {
      await service.cleanup();
      // No error should be thrown
    });
  });
});
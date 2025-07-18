import { Test, TestingModule } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import { WatcherRegistryService } from './watcher-registry.service';
import { EnhancedEntryManagerService } from '../core/services/enhanced-entry-manager.service';
import { WatcherInterface } from './interfaces/watcher.interface';
import { TelescopeConfig } from '../core/interfaces/telescope-config.interface';

// Mock watcher implementation
class MockWatcher implements WatcherInterface {
  private _enabled = false;
  
  constructor(public readonly name: string) {}
  
  get isEnabled(): boolean {
    return this._enabled;
  }
  
  enable(): void {
    this._enabled = true;
  }
  
  disable(): void {
    this._enabled = false;
  }
  
  async cleanup(): Promise<void> {
    // Mock cleanup
  }
  
  async healthCheck(): Promise<boolean> {
    return this._enabled;
  }
}

describe('WatcherRegistryService', () => {
  let service: WatcherRegistryService;
  let mockEntryManager: jest.Mocked<EnhancedEntryManagerService>;
  let mockModuleRef: jest.Mocked<ModuleRef>;

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
    watchers: {
      'test-watcher': { enabled: true, priority: 100 },
      'disabled-watcher': { enabled: false, priority: 200 },
    },
  };

  beforeEach(async () => {
    const mockEntryManagerService = {
      process: jest.fn(),
      processBatch: jest.fn(),
    };

    const mockModuleRefService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WatcherRegistryService,
        {
          provide: EnhancedEntryManagerService,
          useValue: mockEntryManagerService,
        },
        {
          provide: ModuleRef,
          useValue: mockModuleRefService,
        },
        {
          provide: 'TELESCOPE_CONFIG',
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<WatcherRegistryService>(WatcherRegistryService);
    mockEntryManager = module.get<EnhancedEntryManagerService>(
      EnhancedEntryManagerService
    ) as jest.Mocked<EnhancedEntryManagerService>;
    mockModuleRef = module.get<ModuleRef>(ModuleRef) as jest.Mocked<ModuleRef>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a watcher', () => {
      const watcher = new MockWatcher('test-watcher');
      
      service.register(watcher, {
        priority: 100,
        tags: ['test'],
        dependencies: [],
      });

      expect(service.hasWatcher('test-watcher')).toBe(true);
      expect(service.getWatcher('test-watcher')).toBe(watcher);
    });

    it('should throw error if watcher already exists', () => {
      const watcher = new MockWatcher('test-watcher');
      
      service.register(watcher);
      
      expect(() => service.register(watcher)).toThrow(
        "Watcher 'test-watcher' is already registered"
      );
    });
  });

  describe('unregister', () => {
    it('should unregister a watcher', () => {
      const watcher = new MockWatcher('test-watcher');
      
      service.register(watcher);
      expect(service.hasWatcher('test-watcher')).toBe(true);
      
      const result = service.unregister('test-watcher');
      
      expect(result).toBe(true);
      expect(service.hasWatcher('test-watcher')).toBe(false);
    });

    it('should return false if watcher does not exist', () => {
      const result = service.unregister('non-existent');
      
      expect(result).toBe(false);
    });

    it('should throw error if watcher has dependents', () => {
      const watcher1 = new MockWatcher('watcher1');
      const watcher2 = new MockWatcher('watcher2');
      
      service.register(watcher1);
      service.register(watcher2, { dependencies: ['watcher1'] });
      
      expect(() => service.unregister('watcher1')).toThrow(
        "Cannot unregister watcher 'watcher1' - it has dependents: watcher2"
      );
    });
  });

  describe('enable', () => {
    it('should enable a watcher', async () => {
      const watcher = new MockWatcher('test-watcher');
      
      service.register(watcher);
      await service.enable('test-watcher');
      
      expect(watcher.isEnabled).toBe(true);
    });

    it('should throw error if watcher does not exist', async () => {
      await expect(service.enable('non-existent')).rejects.toThrow(
        "Watcher 'non-existent' not found"
      );
    });

    it('should throw error if dependency is not enabled', async () => {
      const watcher1 = new MockWatcher('watcher1');
      const watcher2 = new MockWatcher('watcher2');
      
      service.register(watcher1);
      service.register(watcher2, { dependencies: ['watcher1'] });
      
      await expect(service.enable('watcher2')).rejects.toThrow(
        "Dependency 'watcher1' is not enabled for watcher 'watcher2'"
      );
    });
  });

  describe('disable', () => {
    it('should disable a watcher', async () => {
      const watcher = new MockWatcher('test-watcher');
      
      service.register(watcher);
      await service.enable('test-watcher');
      expect(watcher.isEnabled).toBe(true);
      
      await service.disable('test-watcher');
      expect(watcher.isEnabled).toBe(false);
    });

    it('should throw error if watcher does not exist', async () => {
      await expect(service.disable('non-existent')).rejects.toThrow(
        "Watcher 'non-existent' not found"
      );
    });

    it('should throw error if watcher has dependents', async () => {
      const watcher1 = new MockWatcher('watcher1');
      const watcher2 = new MockWatcher('watcher2');
      
      service.register(watcher1);
      service.register(watcher2, { dependencies: ['watcher1'] });
      
      await service.enable('watcher1');
      await service.enable('watcher2');
      
      await expect(service.disable('watcher1')).rejects.toThrow(
        "Cannot disable watcher 'watcher1' - it has dependents: watcher2"
      );
    });
  });

  describe('enableAll', () => {
    it('should enable all watchers respecting dependencies', async () => {
      const watcher1 = new MockWatcher('watcher1');
      const watcher2 = new MockWatcher('watcher2');
      const watcher3 = new MockWatcher('watcher3');
      
      service.register(watcher1, { priority: 100 });
      service.register(watcher2, { priority: 200, dependencies: ['watcher1'] });
      service.register(watcher3, { priority: 300 });
      
      await service.enableAll();
      
      expect(watcher1.isEnabled).toBe(true);
      expect(watcher2.isEnabled).toBe(true);
      expect(watcher3.isEnabled).toBe(true);
    });
  });

  describe('disableAll', () => {
    it('should disable all watchers in reverse order', async () => {
      const watcher1 = new MockWatcher('watcher1');
      const watcher2 = new MockWatcher('watcher2');
      
      service.register(watcher1, { priority: 100 });
      service.register(watcher2, { priority: 200, dependencies: ['watcher1'] });
      
      await service.enableAll();
      expect(watcher1.isEnabled).toBe(true);
      expect(watcher2.isEnabled).toBe(true);
      
      await service.disableAll();
      expect(watcher1.isEnabled).toBe(false);
      expect(watcher2.isEnabled).toBe(false);
    });
  });

  describe('getWatchersByTag', () => {
    it('should return watchers with specific tag', () => {
      const watcher1 = new MockWatcher('watcher1');
      const watcher2 = new MockWatcher('watcher2');
      const watcher3 = new MockWatcher('watcher3');
      
      service.register(watcher1, { tags: ['http', 'api'] });
      service.register(watcher2, { tags: ['database'] });
      service.register(watcher3, { tags: ['http'] });
      
      const httpWatchers = service.getWatchersByTag('http');
      
      expect(httpWatchers).toHaveLength(2);
      expect(httpWatchers.map(w => w.name)).toEqual(['watcher1', 'watcher3']);
    });
  });

  describe('getStatistics', () => {
    it('should return watcher statistics', async () => {
      const watcher1 = new MockWatcher('watcher1');
      const watcher2 = new MockWatcher('watcher2');
      
      service.register(watcher1, { priority: 100 });
      service.register(watcher2, { priority: 200 });
      
      await service.enable('watcher1');
      
      const stats = service.getStatistics();
      
      expect(stats.total).toBe(2);
      expect(stats.enabled).toBe(1);
      expect(stats.disabled).toBe(1);
      expect(stats.watchers).toHaveLength(2);
    });
  });

  describe('processEntry', () => {
    it('should process entry through entry manager', async () => {
      const entry = {
        id: 'test-entry',
        type: 'request',
        familyHash: 'hash123',
        content: { method: 'GET', url: '/test' },
        tags: ['http'],
        timestamp: new Date(),
        sequence: 1,
      };

      mockEntryManager.process.mockResolvedValue(undefined);

      await service.processEntry(entry, 'test-watcher');

      expect(mockEntryManager.process).toHaveBeenCalledWith(entry);
    });

    it('should update watcher metadata when processing entry', async () => {
      const watcher = new MockWatcher('test-watcher');
      service.register(watcher);

      const entry = {
        id: 'test-entry',
        type: 'request',
        familyHash: 'hash123',
        content: { method: 'GET', url: '/test' },
        tags: ['http'],
        timestamp: new Date(),
        sequence: 1,
      };

      mockEntryManager.process.mockResolvedValue(undefined);

      await service.processEntry(entry, 'test-watcher');

      const metadata = service.getWatcherMetadata('test-watcher');
      expect(metadata?.entriesProcessed).toBe(1);
      expect(metadata?.lastActivity).toBeInstanceOf(Date);
    });
  });

  describe('processBatch', () => {
    it('should process batch through entry manager', async () => {
      const entries = [
        {
          id: 'test-entry-1',
          type: 'request',
          familyHash: 'hash123',
          content: { method: 'GET', url: '/test1' },
          tags: ['http'],
          timestamp: new Date(),
          sequence: 1,
        },
        {
          id: 'test-entry-2',
          type: 'request',
          familyHash: 'hash456',
          content: { method: 'POST', url: '/test2' },
          tags: ['http'],
          timestamp: new Date(),
          sequence: 2,
        },
      ];

      mockEntryManager.processBatch.mockResolvedValue(undefined);

      await service.processBatch(entries, 'test-watcher');

      expect(mockEntryManager.processBatch).toHaveBeenCalledWith(entries);
    });

    it('should update watcher metadata when processing batch', async () => {
      const watcher = new MockWatcher('test-watcher');
      service.register(watcher);

      const entries = [
        {
          id: 'test-entry-1',
          type: 'request',
          familyHash: 'hash123',
          content: { method: 'GET', url: '/test1' },
          tags: ['http'],
          timestamp: new Date(),
          sequence: 1,
        },
        {
          id: 'test-entry-2',
          type: 'request',
          familyHash: 'hash456',
          content: { method: 'POST', url: '/test2' },
          tags: ['http'],
          timestamp: new Date(),
          sequence: 2,
        },
      ];

      mockEntryManager.processBatch.mockResolvedValue(undefined);

      await service.processBatch(entries, 'test-watcher');

      const metadata = service.getWatcherMetadata('test-watcher');
      expect(metadata?.entriesProcessed).toBe(2);
      expect(metadata?.lastActivity).toBeInstanceOf(Date);
    });
  });

  describe('healthCheck', () => {
    it('should return overall health status', async () => {
      const watcher1 = new MockWatcher('watcher1');
      const watcher2 = new MockWatcher('watcher2');
      
      service.register(watcher1);
      service.register(watcher2);
      
      await service.enable('watcher1');
      // watcher2 remains disabled
      
      const health = await service.healthCheck();
      
      expect(health.healthy).toBe(false); // One watcher is disabled
      expect(health.watchers['watcher1']).toBe(true);
      expect(health.watchers['watcher2']).toBe(false);
      expect(health.timestamp).toBeInstanceOf(Date);
    });

    it('should handle watcher health check errors', async () => {
      class FailingWatcher extends MockWatcher {
        async healthCheck(): Promise<boolean> {
          throw new Error('Health check failed');
        }
      }

      const watcher = new FailingWatcher('failing-watcher');
      service.register(watcher);

      const health = await service.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.watchers['failing-watcher']).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should cleanup all watchers', async () => {
      const watcher1 = new MockWatcher('watcher1');
      const watcher2 = new MockWatcher('watcher2');
      
      const cleanup1 = jest.spyOn(watcher1, 'cleanup');
      const cleanup2 = jest.spyOn(watcher2, 'cleanup');
      
      service.register(watcher1);
      service.register(watcher2);
      
      await service.enableAll();
      
      await service.cleanup();
      
      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
      expect(service.getWatcherCount()).toBe(0);
    });
  });
});
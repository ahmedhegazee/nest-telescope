import { FileStorageDriver } from './file-storage.driver';
import { TelescopeEntry } from '../../core/interfaces/telescope-entry.interface';
import { promises as fs } from 'fs';
import * as path from 'path';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn(),
    unlink: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
  },
}));

describe('FileStorageDriver', () => {
  let driver: FileStorageDriver;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Mock successful initialization
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.readFile.mockRejectedValue(new Error('ENOENT')); // Index doesn't exist initially
    
    driver = new FileStorageDriver({
      file: {
        directory: './test-storage',
      },
    });
    
    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 10));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('store', () => {
    it('should store a single entry', async () => {
      const entry: TelescopeEntry = {
        id: 'test-id',
        type: 'request',
        familyHash: 'hash123',
        content: { method: 'GET', url: '/test' },
        tags: ['http'],
        timestamp: new Date(),
        sequence: 1,
      };

      mockFs.writeFile.mockResolvedValue(undefined);

      await driver.store(entry);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        path.join('./test-storage', 'test-id.json'),
        JSON.stringify(entry, null, 2)
      );
      
      // Should also save index
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        path.join('./test-storage', 'index.json'),
        expect.stringContaining('test-id')
      );
    });
  });

  describe('storeBatch', () => {
    it('should store multiple entries', async () => {
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

      mockFs.writeFile.mockResolvedValue(undefined);

      await driver.storeBatch(entries);

      // Should write each entry file
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        path.join('./test-storage', 'test-id-1.json'),
        expect.any(String)
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        path.join('./test-storage', 'test-id-2.json'),
        expect.any(String)
      );
    });
  });

  describe('find', () => {
    it('should find entries with type filter', async () => {
      const entry = {
        id: 'test-id',
        type: 'request',
        familyHash: 'hash123',
        content: { method: 'GET', url: '/test' },
        tags: ['http'],
        timestamp: new Date().toISOString(),
        sequence: 1,
      };

      // Mock index loading
      const indexData = {
        'test-id': {
          filename: 'test-id.json',
          type: 'request',
          timestamp: entry.timestamp,
          tags: entry.tags,
          familyHash: entry.familyHash,
          sequence: entry.sequence,
        },
      };

      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(indexData)) // Load index
        .mockResolvedValueOnce(JSON.stringify(entry)); // Load entry file

      const result = await driver.find({ type: 'request', limit: 10 });

      expect(result.entries).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.entries[0].type).toBe('request');
    });

    it('should find entries with tag filter', async () => {
      const entry = {
        id: 'test-id',
        type: 'request',
        familyHash: 'hash123',
        content: { method: 'GET', url: '/test' },
        tags: ['http', 'api'],
        timestamp: new Date().toISOString(),
        sequence: 1,
      };

      const indexData = {
        'test-id': {
          filename: 'test-id.json',
          type: 'request',
          timestamp: entry.timestamp,
          tags: entry.tags,
          familyHash: entry.familyHash,
          sequence: entry.sequence,
        },
      };

      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(indexData))
        .mockResolvedValueOnce(JSON.stringify(entry));

      const result = await driver.find({ tags: ['http'], limit: 10 });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].tags).toContain('http');
    });

    it('should find entries with date range filter', async () => {
      const now = new Date();
      const entry = {
        id: 'test-id',
        type: 'request',
        familyHash: 'hash123',
        content: { method: 'GET', url: '/test' },
        tags: ['http'],
        timestamp: now.toISOString(),
        sequence: 1,
      };

      const indexData = {
        'test-id': {
          filename: 'test-id.json',
          type: 'request',
          timestamp: now.toISOString(),
          tags: entry.tags,
          familyHash: entry.familyHash,
          sequence: entry.sequence,
        },
      };

      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(indexData))
        .mockResolvedValueOnce(JSON.stringify(entry));

      const dateFrom = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
      const dateTo = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now

      const result = await driver.find({ dateFrom, dateTo, limit: 10 });

      expect(result.entries).toHaveLength(1);
    });

    it('should handle pagination', async () => {
      const entries = Array.from({ length: 15 }, (_, i) => ({
        id: `test-id-${i}`,
        type: 'request',
        familyHash: `hash${i}`,
        content: { method: 'GET', url: `/test${i}` },
        tags: ['http'],
        timestamp: new Date().toISOString(),
        sequence: i + 1,
      }));

      const indexData = entries.reduce((acc, entry) => {
        acc[entry.id] = {
          filename: `${entry.id}.json`,
          type: entry.type,
          timestamp: entry.timestamp,
          tags: entry.tags,
          familyHash: entry.familyHash,
          sequence: entry.sequence,
        };
        return acc;
      }, {} as any);

      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(indexData))
        .mockImplementation((filepath) => {
          const filename = path.basename(filepath as string);
          const entryId = filename.replace('.json', '');
          const entry = entries.find(e => e.id === entryId);
          return Promise.resolve(JSON.stringify(entry));
        });

      const result = await driver.find({ offset: 5, limit: 10 });

      expect(result.entries).toHaveLength(10);
      expect(result.total).toBe(15);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('findById', () => {
    it('should find entry by id', async () => {
      const entry = {
        id: 'test-id',
        type: 'request',
        familyHash: 'hash123',
        content: { method: 'GET', url: '/test' },
        tags: ['http'],
        timestamp: new Date().toISOString(),
        sequence: 1,
      };

      const indexData = {
        'test-id': {
          filename: 'test-id.json',
          type: 'request',
          timestamp: entry.timestamp,
          tags: entry.tags,
          familyHash: entry.familyHash,
          sequence: entry.sequence,
        },
      };

      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(indexData))
        .mockResolvedValueOnce(JSON.stringify(entry));

      const result = await driver.findById('test-id');

      expect(result).toEqual(entry);
    });

    it('should return null if entry not found', async () => {
      const indexData = {};

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(indexData));

      const result = await driver.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete entry by id', async () => {
      const indexData = {
        'test-id': {
          filename: 'test-id.json',
          type: 'request',
          timestamp: new Date().toISOString(),
          tags: ['http'],
          familyHash: 'hash123',
          sequence: 1,
        },
      };

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(indexData));
      mockFs.unlink.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await driver.delete('test-id');

      expect(result).toBe(true);
      expect(mockFs.unlink).toHaveBeenCalledWith(
        path.join('./test-storage', 'test-id.json')
      );
    });

    it('should return false if entry not found', async () => {
      const indexData = {};

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(indexData));

      const result = await driver.delete('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all entries', async () => {
      const indexData = {
        'test-id-1': { filename: 'test-id-1.json' },
        'test-id-2': { filename: 'test-id-2.json' },
      };

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(indexData));
      mockFs.readdir.mockResolvedValue(['test-id-1.json', 'test-id-2.json', 'index.json'] as any);
      mockFs.unlink.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await driver.clear();

      expect(mockFs.unlink).toHaveBeenCalledWith(
        path.join('./test-storage', 'test-id-1.json')
      );
      expect(mockFs.unlink).toHaveBeenCalledWith(
        path.join('./test-storage', 'test-id-2.json')
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        path.join('./test-storage', 'index.json'),
        '{}'
      );
    });
  });

  describe('prune', () => {
    it('should prune old entries', async () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
      const recentDate = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago

      const indexData = {
        'old-entry': {
          filename: 'old-entry.json',
          type: 'request',
          timestamp: oldDate.toISOString(),
          tags: ['http'],
          familyHash: 'hash1',
          sequence: 1,
        },
        'recent-entry': {
          filename: 'recent-entry.json',
          type: 'request',
          timestamp: recentDate.toISOString(),
          tags: ['http'],
          familyHash: 'hash2',
          sequence: 2,
        },
      };

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(indexData));
      mockFs.unlink.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const olderThan = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
      const result = await driver.prune(olderThan);

      expect(result).toBe(1);
      expect(mockFs.unlink).toHaveBeenCalledWith(
        path.join('./test-storage', 'old-entry.json')
      );
      expect(mockFs.unlink).not.toHaveBeenCalledWith(
        path.join('./test-storage', 'recent-entry.json')
      );
    });
  });

  describe('getStats', () => {
    it('should return storage statistics', async () => {
      const now = new Date();
      const indexData = {
        'entry-1': {
          filename: 'entry-1.json',
          type: 'request',
          timestamp: now.toISOString(),
          tags: ['http'],
          familyHash: 'hash1',
          sequence: 1,
        },
        'entry-2': {
          filename: 'entry-2.json',
          type: 'query',
          timestamp: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
          tags: ['db'],
          familyHash: 'hash2',
          sequence: 2,
        },
      };

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(indexData));
      mockFs.readdir.mockResolvedValue(['entry-1.json', 'entry-2.json', 'index.json'] as any);
      mockFs.stat.mockResolvedValue({ size: 1024 } as any);

      const result = await driver.getStats();

      expect(result.totalEntries).toBe(2);
      expect(result.entriesByType).toEqual({ request: 1, query: 1 });
      expect(result.oldestEntry).toBeInstanceOf(Date);
      expect(result.newestEntry).toBeInstanceOf(Date);
      expect(result.sizeInBytes).toBe(3072); // 3 files * 1024 bytes each
    });
  });

  describe('healthCheck', () => {
    it('should return true when file system is healthy', async () => {
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('{"test":true}');
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await driver.healthCheck();

      expect(result).toBe(true);
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        path.join('./test-storage', 'health-check.json'),
        '{"test":true}'
      );
    });

    it('should return false when file system is unhealthy', async () => {
      mockFs.writeFile.mockRejectedValue(new Error('Permission denied'));

      const result = await driver.healthCheck();

      expect(result).toBe(false);
    });
  });
});
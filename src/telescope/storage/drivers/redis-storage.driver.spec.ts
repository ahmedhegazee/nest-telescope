import { RedisStorageDriver } from './redis-storage.driver';
import { TelescopeEntry } from '../../core/interfaces/telescope-entry.interface';

// Mock ioredis
jest.mock('ioredis', () => {
  const MockRedis = jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    setex: jest.fn(),
    zadd: jest.fn(),
    hset: jest.fn(),
    expire: jest.fn(),
    pipeline: jest.fn(),
    zrevrange: jest.fn(),
    zrevrangebyscore: jest.fn(),
    hget: jest.fn(),
    get: jest.fn(),
    hgetall: jest.fn(),
    zrem: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(),
    zcard: jest.fn(),
    zrange: jest.fn(),
    zrangebyscore: jest.fn(),
    ping: jest.fn(),
    disconnect: jest.fn(),
  }));
  
  return { Redis: MockRedis };
});

describe('RedisStorageDriver', () => {
  let driver: RedisStorageDriver;
  let mockRedis: any;

  beforeEach(() => {
    const Redis = require('ioredis');
    driver = new RedisStorageDriver({
      redis: {
        host: 'localhost',
        port: 6379,
        ttl: 3600,
      },
    });
    mockRedis = (driver as any).redis;
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

      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.zadd.mockResolvedValue(1);
      mockRedis.hset.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      await driver.store(entry);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'telescope:entry:test-id',
        3600,
        JSON.stringify(entry)
      );
      expect(mockRedis.zadd).toHaveBeenCalledWith(
        'telescope:index:request',
        entry.timestamp.getTime(),
        'test-id'
      );
    });
  });

  describe('storeBatch', () => {
    it('should store multiple entries using pipeline', async () => {
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

      const mockPipeline = {
        setex: jest.fn(),
        zadd: jest.fn(),
        hset: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn().mockResolvedValue([]),
      };

      mockRedis.pipeline.mockReturnValue(mockPipeline);

      await driver.storeBatch(entries);

      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(mockPipeline.setex).toHaveBeenCalledTimes(2);
      expect(mockPipeline.zadd).toHaveBeenCalledTimes(4); // 2 for type index, 2 for timestamp index
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe('find', () => {
    it('should find entries with type filter', async () => {
      const entryData = {
        id: 'test-id',
        type: 'request',
        familyHash: 'hash123',
        content: { method: 'GET', url: '/test' },
        tags: ['http'],
        timestamp: new Date().toISOString(),
        sequence: 1,
      };

      mockRedis.zrevrange.mockResolvedValue(['test-id']);
      
      const mockPipeline = {
        get: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, JSON.stringify(entryData)]]),
      };

      mockRedis.pipeline.mockReturnValue(mockPipeline);

      const result = await driver.find({ type: 'request', limit: 10 });

      expect(result.entries).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(mockRedis.zrevrange).toHaveBeenCalledWith('telescope:index:request', 0, -1);
    });

    it('should find entries with date range filter', async () => {
      const dateFrom = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dateTo = new Date();

      mockRedis.zrevrangebyscore.mockResolvedValue(['test-id']);
      
      const mockPipeline = {
        get: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, JSON.stringify({})]]),
      };

      mockRedis.pipeline.mockReturnValue(mockPipeline);

      await driver.find({ dateFrom, dateTo, limit: 10 });

      expect(mockRedis.zrevrangebyscore).toHaveBeenCalledWith(
        'telescope:timestamp',
        dateTo.getTime(),
        dateFrom.getTime()
      );
    });

    it('should find entries with tag filter', async () => {
      mockRedis.zrevrange.mockResolvedValue(['test-id']);
      mockRedis.hget.mockResolvedValue('["http", "api"]');
      
      const mockPipeline = {
        get: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, JSON.stringify({})]]),
      };

      mockRedis.pipeline.mockReturnValue(mockPipeline);

      await driver.find({ tags: ['http'], limit: 10 });

      expect(mockRedis.hget).toHaveBeenCalledWith('telescope:meta:test-id', 'tags');
    });
  });

  describe('findById', () => {
    it('should find entry by id', async () => {
      const entryData = {
        id: 'test-id',
        type: 'request',
        familyHash: 'hash123',
        content: { method: 'GET', url: '/test' },
        tags: ['http'],
        timestamp: new Date().toISOString(),
        sequence: 1,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(entryData));

      const result = await driver.findById('test-id');

      expect(result).toEqual(expect.objectContaining({
        id: 'test-id',
        type: 'request',
        timestamp: expect.any(Date),
      }));
      expect(mockRedis.get).toHaveBeenCalledWith('telescope:entry:test-id');
    });

    it('should return null if entry not found', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await driver.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete entry by id', async () => {
      mockRedis.hgetall.mockResolvedValue({ type: 'request' });
      
      const mockPipeline = {
        del: jest.fn(),
        zrem: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, 1]]),
      };

      mockRedis.pipeline.mockReturnValue(mockPipeline);

      const result = await driver.delete('test-id');

      expect(result).toBe(true);
      expect(mockPipeline.del).toHaveBeenCalledWith('telescope:entry:test-id');
      expect(mockPipeline.zrem).toHaveBeenCalledWith('telescope:index:request', 'test-id');
    });

    it('should return false if entry not found', async () => {
      mockRedis.hgetall.mockResolvedValue({});

      const result = await driver.delete('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all telescope entries', async () => {
      mockRedis.keys.mockResolvedValue(['telescope:entry:1', 'telescope:entry:2']);
      mockRedis.del.mockResolvedValue(2);

      await driver.clear();

      expect(mockRedis.keys).toHaveBeenCalledWith('telescope:*');
      expect(mockRedis.del).toHaveBeenCalledWith('telescope:entry:1', 'telescope:entry:2');
    });
  });

  describe('prune', () => {
    it('should prune old entries', async () => {
      const olderThan = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      mockRedis.zrangebyscore.mockResolvedValue(['old-entry-1', 'old-entry-2']);
      mockRedis.hgetall.mockResolvedValue({ type: 'request' });
      
      const mockPipeline = {
        del: jest.fn(),
        zrem: jest.fn(),
        exec: jest.fn().mockResolvedValue([]),
      };

      mockRedis.pipeline.mockReturnValue(mockPipeline);

      const result = await driver.prune(olderThan);

      expect(result).toBe(2);
      expect(mockRedis.zrangebyscore).toHaveBeenCalledWith(
        'telescope:timestamp',
        0,
        olderThan.getTime()
      );
    });
  });

  describe('getStats', () => {
    it('should return storage statistics', async () => {
      mockRedis.zcard.mockResolvedValue(10);
      mockRedis.keys.mockResolvedValue(['telescope:index:request', 'telescope:index:query']);
      mockRedis.zrange.mockResolvedValue(['entry-1', '1234567890']);
      mockRedis.zrevrange.mockResolvedValue(['entry-2', '1234567890']);

      const result = await driver.getStats();

      expect(result.totalEntries).toBe(10);
      expect(result.entriesByType).toBeDefined();
      expect(result.oldestEntry).toBeInstanceOf(Date);
      expect(result.newestEntry).toBeInstanceOf(Date);
    });
  });

  describe('healthCheck', () => {
    it('should return true when Redis is healthy', async () => {
      mockRedis.ping.mockResolvedValue('PONG');

      const result = await driver.healthCheck();

      expect(result).toBe(true);
      expect(mockRedis.ping).toHaveBeenCalled();
    });

    it('should return false when Redis is unhealthy', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Connection failed'));

      const result = await driver.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should disconnect from Redis', async () => {
      mockRedis.disconnect.mockResolvedValue(undefined);

      await driver.cleanup();

      expect(mockRedis.disconnect).toHaveBeenCalled();
    });
  });
});
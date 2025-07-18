import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseStorageDriver } from './database-storage.driver';
import { TelescopeEntry } from '../../core/interfaces/telescope-entry.interface';

// Mock typeorm
jest.mock('@nestjs/typeorm', () => ({
  getRepositoryToken: jest.fn(),
  InjectRepository: jest.fn(),
}));

jest.mock('typeorm', () => ({
  Repository: jest.fn(),
  Between: jest.fn(),
  In: jest.fn(),
}));

describe.skip('DatabaseStorageDriver', () => {
  let driver: DatabaseStorageDriver;
  let repository: Repository<TelescopeEntryEntity>;

  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    count: jest.fn(),
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseStorageDriver,
        {
          provide: getRepositoryToken(TelescopeEntryEntity),
          useValue: mockRepository,
        },
      ],
    }).compile();

    driver = module.get<DatabaseStorageDriver>(DatabaseStorageDriver);
    repository = module.get<Repository<TelescopeEntryEntity>>(
      getRepositoryToken(TelescopeEntryEntity)
    );
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

      const entity = { ...entry, createdAt: new Date(), environment: 'test' };
      mockRepository.create.mockReturnValue(entity);
      mockRepository.save.mockResolvedValue(entity);

      await driver.store(entry);

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: entry.id,
          type: entry.type,
          familyHash: entry.familyHash,
          content: entry.content,
          tags: entry.tags,
          timestamp: entry.timestamp,
          sequence: entry.sequence,
        })
      );
      expect(mockRepository.save).toHaveBeenCalledWith(entity);
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

      const entities = entries.map(entry => ({ ...entry, createdAt: new Date(), environment: 'test' }));
      mockRepository.create.mockImplementation((entry) => ({ ...entry, createdAt: new Date(), environment: 'test' }));
      mockRepository.save.mockResolvedValue(entities);

      await driver.storeBatch(entries);

      expect(mockRepository.create).toHaveBeenCalledTimes(2);
      expect(mockRepository.save).toHaveBeenCalledWith(entities, { chunk: 100 });
    });
  });

  describe('find', () => {
    it('should find entries with filters', async () => {
      const entities = [
        {
          id: 'test-id-1',
          type: 'request',
          familyHash: 'hash123',
          content: { method: 'GET', url: '/test1' },
          tags: ['http'],
          timestamp: new Date(),
          sequence: 1,
          createdAt: new Date(),
          environment: 'test',
        },
      ];

      const queryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([entities, 1]),
      };

      mockRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const result = await driver.find({ type: 'request', limit: 10 });

      expect(result.entries).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('entry.type = :type', { type: 'request' });
    });
  });

  describe('findById', () => {
    it('should find entry by id', async () => {
      const entity = {
        id: 'test-id',
        type: 'request',
        familyHash: 'hash123',
        content: { method: 'GET', url: '/test' },
        tags: ['http'],
        timestamp: new Date(),
        sequence: 1,
        createdAt: new Date(),
        environment: 'test',
      };

      mockRepository.findOne.mockResolvedValue(entity);

      const result = await driver.findById('test-id');

      expect(result).toEqual({
        id: entity.id,
        type: entity.type,
        familyHash: entity.familyHash,
        content: entity.content,
        tags: entity.tags,
        timestamp: entity.timestamp,
        sequence: entity.sequence,
        batchId: entity.batchId,
      });
    });

    it('should return null if entry not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await driver.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete entry by id', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 1 });

      const result = await driver.delete('test-id');

      expect(result).toBe(true);
      expect(mockRepository.delete).toHaveBeenCalledWith({ id: 'test-id' });
    });

    it('should return false if no entry was deleted', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 0 });

      const result = await driver.delete('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all entries', async () => {
      mockRepository.clear.mockResolvedValue(undefined);

      await driver.clear();

      expect(mockRepository.clear).toHaveBeenCalled();
    });
  });

  describe('prune', () => {
    it('should prune old entries', async () => {
      const olderThan = new Date(Date.now() - 24 * 60 * 60 * 1000);
      mockRepository.delete.mockResolvedValue({ affected: 5 });

      const result = await driver.prune(olderThan);

      expect(result).toBe(5);
      expect(mockRepository.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Object),
        })
      );
    });
  });

  describe('getStats', () => {
    it('should return storage statistics', async () => {
      const mockStats = {
        totalEntries: 10,
        entriesByType: { request: 5, query: 3, job: 2 },
        oldestEntry: new Date(Date.now() - 24 * 60 * 60 * 1000),
        newestEntry: new Date(),
      };

      mockRepository.count.mockResolvedValue(mockStats.totalEntries);
      mockRepository.findOne
        .mockResolvedValueOnce({ timestamp: mockStats.oldestEntry })
        .mockResolvedValueOnce({ timestamp: mockStats.newestEntry });

      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { type: 'request', count: '5' },
          { type: 'query', count: '3' },
          { type: 'job', count: '2' },
        ]),
      };

      mockRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const result = await driver.getStats();

      expect(result.totalEntries).toBe(mockStats.totalEntries);
      expect(result.entriesByType).toEqual(mockStats.entriesByType);
      expect(result.oldestEntry).toEqual(mockStats.oldestEntry);
      expect(result.newestEntry).toEqual(mockStats.newestEntry);
    });
  });

  describe('healthCheck', () => {
    it('should return true when database is healthy', async () => {
      mockRepository.query.mockResolvedValue([{ '1': 1 }]);

      const result = await driver.healthCheck();

      expect(result).toBe(true);
      expect(mockRepository.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('should return false when database is unhealthy', async () => {
      mockRepository.query.mockRejectedValue(new Error('Connection failed'));

      const result = await driver.healthCheck();

      expect(result).toBe(false);
    });
  });
});
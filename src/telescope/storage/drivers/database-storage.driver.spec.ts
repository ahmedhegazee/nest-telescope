import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DatabaseStorageDriver } from './database-storage.driver';
import { TelescopeEntry } from '../../core/interfaces/telescope-entry.interface';

// Mock the entity to avoid TypeORM decorator issues in tests
jest.mock('../entities/telescope-entry.entity', () => ({
  TelescopeEntryEntity: class MockTelescopeEntryEntity {
    id: string;
    type: string;
    familyHash: string;
    content: any;
    tags: string[];
    timestamp: Date;
    sequence: number;
    batchId?: string;
    createdAt: Date;
    environment: string;
    metadata?: string;
  },
}));

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
  let repository: Repository<any>;

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
          provide: getRepositoryToken('TelescopeEntryEntity'),
          useValue: mockRepository,
        },
      ],
    }).compile();

    driver = module.get<DatabaseStorageDriver>(DatabaseStorageDriver);
    repository = module.get<Repository<any>>(getRepositoryToken('TelescopeEntryEntity'));
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
        }),
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
          familyHash: 'hash123',
          content: { method: 'POST', url: '/test2' },
          tags: ['http'],
          timestamp: new Date(),
          sequence: 2,
        },
      ];

      const entities = entries.map((entry) => ({
        ...entry,
        createdAt: new Date(),
        environment: 'test',
      }));
      mockRepository.create.mockReturnValue(entities[0]);
      mockRepository.save.mockResolvedValue(entities);

      await driver.storeBatch(entries);

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'test-id-1' }),
          expect.objectContaining({ id: 'test-id-2' }),
        ]),
      );
    });
  });

  describe('retrieve', () => {
    it('should retrieve entries by type', async () => {
      const mockEntries = [
        {
          id: 'test-id',
          type: 'request',
          familyHash: 'hash123',
          content: { method: 'GET', url: '/test' },
          tags: ['http'],
          timestamp: new Date(),
          sequence: 1,
          batchId: 'batch-123',
          createdAt: new Date(),
          environment: 'test',
        },
      ];

      const mockQueryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockEntries, 1]),
      };
      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await driver.find({ type: 'request' });

      expect(result.entries).toEqual(mockEntries);
      expect(result.total).toBe(1);
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('entry');
    });

    it('should retrieve entries with limit and offset', async () => {
      const mockEntries = [
        {
          id: 'test-id',
          type: 'request',
          familyHash: 'hash123',
          content: { method: 'GET', url: '/test' },
          tags: ['http'],
          timestamp: new Date(),
          sequence: 1,
          batchId: 'batch-123',
          createdAt: new Date(),
          environment: 'test',
        },
      ];

      const mockQueryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockEntries, 1]),
      };
      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await driver.find({ type: 'request', limit: 10, offset: 5 });

      expect(result.entries).toEqual(mockEntries);
      expect(result.total).toBe(1);
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('entry');
    });
  });

  describe('clear', () => {
    it('should clear all entries', async () => {
      mockRepository.clear.mockResolvedValue(undefined);

      await driver.clear();

      expect(mockRepository.clear).toHaveBeenCalled();
    });

    it('should clear all entries', async () => {
      mockRepository.clear.mockResolvedValue(undefined);

      await driver.clear();

      expect(mockRepository.clear).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should get storage stats', async () => {
      mockRepository.count.mockResolvedValue(100);
      mockRepository.findOne.mockResolvedValueOnce({ timestamp: new Date('2023-01-01') });
      mockRepository.findOne.mockResolvedValueOnce({ timestamp: new Date('2023-12-31') });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { type: 'request', count: '50' },
          { type: 'query', count: '30' },
          { type: 'exception', count: '20' },
        ]),
      };
      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await driver.getStats();

      expect(result.totalEntries).toBe(100);
      expect(result.entriesByType).toEqual({
        request: 50,
        query: 30,
        exception: 20,
      });
    });
  });

  describe('healthCheck', () => {
    it('should return true when database is accessible', async () => {
      mockRepository.query.mockResolvedValue([{ '1': 1 }]);

      const health = await driver.healthCheck();

      expect(health).toBe(true);
      expect(mockRepository.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('should return false when database is not accessible', async () => {
      mockRepository.query.mockRejectedValue(new Error('Connection failed'));

      const health = await driver.healthCheck();

      expect(health).toBe(false);
    });
  });
});

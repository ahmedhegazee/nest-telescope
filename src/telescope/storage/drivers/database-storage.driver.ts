import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { StorageDriver, StorageStats } from '../interfaces/storage.interface';
import { TelescopeEntry, TelescopeEntryFilter, TelescopeEntryResult } from '../../core/interfaces/telescope-entry.interface';
import { TelescopeEntryEntity } from '../entities/telescope-entry.entity';

@Injectable()
export class DatabaseStorageDriver implements StorageDriver {
  constructor(
    @InjectRepository(TelescopeEntryEntity)
    private readonly entryRepository: Repository<TelescopeEntryEntity>
  ) {}

  async store(entry: TelescopeEntry): Promise<void> {
    const entity = this.entryRepository.create({
      id: entry.id,
      type: entry.type,
      familyHash: entry.familyHash,
      content: entry.content,
      tags: entry.tags,
      timestamp: entry.timestamp,
      sequence: entry.sequence,
      batchId: entry.batchId,
      createdAt: new Date(),
      environment: process.env.NODE_ENV || 'development',
      metadata: entry.batchId ? JSON.stringify({ batchId: entry.batchId }) : undefined
    });

    await this.entryRepository.save(entity);
  }

  async storeBatch(entries: TelescopeEntry[]): Promise<void> {
    const entities = entries.map(entry => 
      this.entryRepository.create({
        id: entry.id,
        type: entry.type,
        familyHash: entry.familyHash,
        content: entry.content,
        tags: entry.tags,
        timestamp: entry.timestamp,
        sequence: entry.sequence,
        batchId: entry.batchId,
        createdAt: new Date(),
        environment: process.env.NODE_ENV || 'development',
        metadata: entry.batchId ? JSON.stringify({ batchId: entry.batchId }) : undefined
      })
    );

    await this.entryRepository.save(entities, { chunk: 100 });
  }

  async find(filter?: TelescopeEntryFilter): Promise<TelescopeEntryResult> {
    const queryBuilder = this.entryRepository.createQueryBuilder('entry');

    // Apply filters
    if (filter?.type) {
      queryBuilder.andWhere('entry.type = :type', { type: filter.type });
    }

    if (filter?.tags && filter.tags.length > 0) {
      queryBuilder.andWhere('entry.tags && :tags', { tags: filter.tags });
    }

    if (filter?.dateFrom && filter?.dateTo) {
      queryBuilder.andWhere('entry.timestamp BETWEEN :dateFrom AND :dateTo', {
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo
      });
    } else if (filter?.dateFrom) {
      queryBuilder.andWhere('entry.timestamp >= :dateFrom', { dateFrom: filter.dateFrom });
    } else if (filter?.dateTo) {
      queryBuilder.andWhere('entry.timestamp <= :dateTo', { dateTo: filter.dateTo });
    }

    // Order by timestamp desc
    queryBuilder.orderBy('entry.timestamp', 'DESC');

    // Pagination
    const offset = filter?.offset || 0;
    const limit = filter?.limit || 100;
    
    queryBuilder.skip(offset).take(limit);

    const [entities, total] = await queryBuilder.getManyAndCount();

    return {
      entries: entities.map(entity => this.entityToEntry(entity)),
      total,
      hasMore: offset + limit < total
    };
  }

  async findById(id: string): Promise<TelescopeEntry | null> {
    const entity = await this.entryRepository.findOne({ where: { id } });
    return entity ? this.entityToEntry(entity) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.entryRepository.delete({ id });
    return (result.affected || 0) > 0;
  }

  async clear(): Promise<void> {
    await this.entryRepository.clear();
  }

  async prune(olderThan: Date): Promise<number> {
    const result = await this.entryRepository.delete({
      timestamp: Between(new Date(0), olderThan)
    });
    return result.affected || 0;
  }

  async getStats(): Promise<StorageStats> {
    const [totalEntries, entriesByType, oldestEntry, newestEntry] = await Promise.all([
      this.entryRepository.count(),
      this.getEntriesByType(),
      this.entryRepository.findOne({ 
        order: { timestamp: 'ASC' },
        select: ['timestamp']
      }),
      this.entryRepository.findOne({ 
        order: { timestamp: 'DESC' },
        select: ['timestamp']
      })
    ]);

    return {
      totalEntries,
      entriesByType,
      oldestEntry: oldestEntry?.timestamp,
      newestEntry: newestEntry?.timestamp
    };
  }

  private async getEntriesByType(): Promise<Record<string, number>> {
    const result = await this.entryRepository
      .createQueryBuilder('entry')
      .select('entry.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .groupBy('entry.type')
      .getRawMany();

    return result.reduce((acc, row) => {
      acc[row.type] = parseInt(row.count);
      return acc;
    }, {});
  }

  private entityToEntry(entity: TelescopeEntryEntity): TelescopeEntry {
    return {
      id: entity.id,
      type: entity.type,
      familyHash: entity.familyHash,
      content: entity.content,
      tags: entity.tags,
      timestamp: entity.timestamp,
      sequence: entity.sequence,
      batchId: entity.batchId
    };
  }

  // Health check method
  async healthCheck(): Promise<boolean> {
    try {
      await this.entryRepository.query('SELECT 1');
      return true;
    } catch (error) {
      return false;
    }
  }
}
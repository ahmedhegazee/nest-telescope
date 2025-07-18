import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { StorageDriver, StorageStats } from '../interfaces/storage.interface';
import { TelescopeEntry, TelescopeEntryFilter, TelescopeEntryResult } from '../../core/interfaces/telescope-entry.interface';

@Injectable()
export class RedisStorageDriver implements StorageDriver {
  private readonly logger = new Logger(RedisStorageDriver.name);
  private readonly redis: Redis;
  private readonly keyPrefix = 'telescope';
  private readonly ttl: number;

  constructor(config?: any) {
    const redisConfig = config?.redis || {};
    
    this.redis = new Redis({
      host: redisConfig.host || 'localhost',
      port: redisConfig.port || 6379,
      password: redisConfig.password,
      db: redisConfig.db || 0,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      commandTimeout: 5000,
      ...redisConfig.options
    });

    this.ttl = redisConfig.ttl || 86400; // 24 hours default

    this.redis.on('connect', () => {
      this.logger.log('Redis connected');
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis error:', error);
    });
  }

  async store(entry: TelescopeEntry): Promise<void> {
    try {
      const key = this.getEntryKey(entry.id);
      const indexKey = this.getIndexKey(entry.type);
      const timestampKey = this.getTimestampKey();
      
      // Store entry data
      await this.redis.setex(key, this.ttl, JSON.stringify(entry));
      
      // Add to type index
      await this.redis.zadd(indexKey, entry.timestamp.getTime(), entry.id);
      
      // Add to global timestamp index
      await this.redis.zadd(timestampKey, entry.timestamp.getTime(), entry.id);
      
      // Store entry metadata for efficient filtering
      const metaKey = this.getMetaKey(entry.id);
      await this.redis.hset(metaKey, {
        type: entry.type,
        familyHash: entry.familyHash,
        tags: JSON.stringify(entry.tags),
        timestamp: entry.timestamp.getTime(),
        sequence: entry.sequence
      });
      await this.redis.expire(metaKey, this.ttl);
      
      this.logger.debug(`Stored entry: ${entry.id}`);
    } catch (error) {
      this.logger.error(`Failed to store entry ${entry.id}:`, error);
      throw error;
    }
  }

  async storeBatch(entries: TelescopeEntry[]): Promise<void> {
    if (entries.length === 0) return;
    
    try {
      const pipeline = this.redis.pipeline();
      
      for (const entry of entries) {
        const key = this.getEntryKey(entry.id);
        const indexKey = this.getIndexKey(entry.type);
        const timestampKey = this.getTimestampKey();
        const metaKey = this.getMetaKey(entry.id);
        
        // Store entry data
        pipeline.setex(key, this.ttl, JSON.stringify(entry));
        
        // Add to type index
        pipeline.zadd(indexKey, entry.timestamp.getTime(), entry.id);
        
        // Add to global timestamp index
        pipeline.zadd(timestampKey, entry.timestamp.getTime(), entry.id);
        
        // Store entry metadata
        pipeline.hset(metaKey, {
          type: entry.type,
          familyHash: entry.familyHash,
          tags: JSON.stringify(entry.tags),
          timestamp: entry.timestamp.getTime(),
          sequence: entry.sequence
        });
        pipeline.expire(metaKey, this.ttl);
      }
      
      await pipeline.exec();
      this.logger.debug(`Stored batch of ${entries.length} entries`);
    } catch (error) {
      this.logger.error('Failed to store batch:', error);
      throw error;
    }
  }

  async find(filter?: TelescopeEntryFilter): Promise<TelescopeEntryResult> {
    try {
      let candidateIds: string[] = [];
      
      // Get candidate IDs based on type filter
      if (filter?.type) {
        const indexKey = this.getIndexKey(filter.type);
        candidateIds = await this.redis.zrevrange(indexKey, 0, -1);
      } else {
        const timestampKey = this.getTimestampKey();
        candidateIds = await this.redis.zrevrange(timestampKey, 0, -1);
      }
      
      // Apply date range filter
      if (filter?.dateFrom || filter?.dateTo) {
        const minScore = filter.dateFrom ? filter.dateFrom.getTime() : 0;
        const maxScore = filter.dateTo ? filter.dateTo.getTime() : '+inf';
        
        if (filter?.type) {
          const indexKey = this.getIndexKey(filter.type);
          candidateIds = await this.redis.zrevrangebyscore(indexKey, maxScore, minScore);
        } else {
          const timestampKey = this.getTimestampKey();
          candidateIds = await this.redis.zrevrangebyscore(timestampKey, maxScore, minScore);
        }
      }
      
      // Apply tag filter
      if (filter?.tags && filter.tags.length > 0) {
        const filteredIds: string[] = [];
        
        for (const id of candidateIds) {
          const metaKey = this.getMetaKey(id);
          const tagsJson = await this.redis.hget(metaKey, 'tags');
          
          if (tagsJson) {
            const tags = JSON.parse(tagsJson);
            if (filter.tags.some(tag => tags.includes(tag))) {
              filteredIds.push(id);
            }
          }
        }
        
        candidateIds = filteredIds;
      }
      
      const total = candidateIds.length;
      
      // Apply pagination
      const offset = filter?.offset || 0;
      const limit = filter?.limit || 100;
      const paginatedIds = candidateIds.slice(offset, offset + limit);
      
      // Load full entries
      const entries: TelescopeEntry[] = [];
      
      if (paginatedIds.length > 0) {
        const pipeline = this.redis.pipeline();
        
        for (const id of paginatedIds) {
          const key = this.getEntryKey(id);
          pipeline.get(key);
        }
        
        const results = await pipeline.exec();
        
        for (const [error, result] of results || []) {
          if (!error && result) {
            try {
              const entry = JSON.parse(result as string);
              // Convert timestamp string back to Date
              if (entry.timestamp) {
                entry.timestamp = new Date(entry.timestamp);
              }
              entries.push(entry);
            } catch (parseError) {
              this.logger.error('Failed to parse entry:', parseError);
            }
          }
        }
      }
      
      return {
        entries,
        total,
        hasMore: offset + limit < total
      };
    } catch (error) {
      this.logger.error('Failed to find entries:', error);
      throw error;
    }
  }

  async findById(id: string): Promise<TelescopeEntry | null> {
    try {
      const key = this.getEntryKey(id);
      const result = await this.redis.get(key);
      
      if (!result) return null;
      
      const entry = JSON.parse(result);
      // Convert timestamp string back to Date
      if (entry.timestamp) {
        entry.timestamp = new Date(entry.timestamp);
      }
      
      return entry;
    } catch (error) {
      this.logger.error(`Failed to find entry ${id}:`, error);
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const pipeline = this.redis.pipeline();
      
      // Get entry metadata first
      const metaKey = this.getMetaKey(id);
      const meta = await this.redis.hgetall(metaKey);
      
      if (meta && meta.type) {
        const key = this.getEntryKey(id);
        const indexKey = this.getIndexKey(meta.type);
        const timestampKey = this.getTimestampKey();
        
        // Delete entry data
        pipeline.del(key);
        
        // Remove from indexes
        pipeline.zrem(indexKey, id);
        pipeline.zrem(timestampKey, id);
        
        // Delete metadata
        pipeline.del(metaKey);
        
        const results = await pipeline.exec();
        return results ? results[0][1] === 1 : false;
      }
      
      return false;
    } catch (error) {
      this.logger.error(`Failed to delete entry ${id}:`, error);
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      const pattern = `${this.keyPrefix}:*`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      
      this.logger.log('Redis storage cleared');
    } catch (error) {
      this.logger.error('Failed to clear Redis storage:', error);
      throw error;
    }
  }

  async prune(olderThan: Date): Promise<number> {
    try {
      const timestampKey = this.getTimestampKey();
      const maxScore = olderThan.getTime();
      
      // Get old entry IDs
      const oldIds = await this.redis.zrangebyscore(timestampKey, 0, maxScore);
      
      if (oldIds.length === 0) return 0;
      
      const pipeline = this.redis.pipeline();
      
      for (const id of oldIds) {
        // Get entry metadata
        const metaKey = this.getMetaKey(id);
        const meta = await this.redis.hgetall(metaKey);
        
        if (meta && meta.type) {
          const key = this.getEntryKey(id);
          const indexKey = this.getIndexKey(meta.type);
          
          // Delete entry data
          pipeline.del(key);
          
          // Remove from indexes
          pipeline.zrem(indexKey, id);
          pipeline.zrem(timestampKey, id);
          
          // Delete metadata
          pipeline.del(metaKey);
        }
      }
      
      await pipeline.exec();
      
      this.logger.log(`Pruned ${oldIds.length} entries from Redis`);
      return oldIds.length;
    } catch (error) {
      this.logger.error('Failed to prune Redis storage:', error);
      throw error;
    }
  }

  async getStats(): Promise<StorageStats> {
    try {
      const timestampKey = this.getTimestampKey();
      const totalEntries = await this.redis.zcard(timestampKey);
      
      // Get entries by type
      const typeKeys = await this.redis.keys(`${this.keyPrefix}:index:*`);
      const entriesByType: Record<string, number> = {};
      
      for (const key of typeKeys) {
        const type = key.split(':').pop();
        if (type) {
          const count = await this.redis.zcard(key);
          entriesByType[type] = count;
        }
      }
      
      // Get oldest and newest entries
      const oldestScore = await this.redis.zrange(timestampKey, 0, 0, 'WITHSCORES');
      const newestScore = await this.redis.zrevrange(timestampKey, 0, 0, 'WITHSCORES');
      
      const oldestEntry = oldestScore.length > 1 ? new Date(parseInt(oldestScore[1])) : undefined;
      const newestEntry = newestScore.length > 1 ? new Date(parseInt(newestScore[1])) : undefined;
      
      return {
        totalEntries,
        entriesByType,
        oldestEntry,
        newestEntry
      };
    } catch (error) {
      this.logger.error('Failed to get Redis storage stats:', error);
      throw error;
    }
  }

  // Health check method
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }

  // Cleanup method
  async cleanup(): Promise<void> {
    try {
      await this.redis.disconnect();
      this.logger.log('Redis connection closed');
    } catch (error) {
      this.logger.error('Failed to cleanup Redis connection:', error);
    }
  }

  private getEntryKey(id: string): string {
    return `${this.keyPrefix}:entry:${id}`;
  }

  private getIndexKey(type: string): string {
    return `${this.keyPrefix}:index:${type}`;
  }

  private getTimestampKey(): string {
    return `${this.keyPrefix}:timestamp`;
  }

  private getMetaKey(id: string): string {
    return `${this.keyPrefix}:meta:${id}`;
  }
}
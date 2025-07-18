import { Injectable, Logger } from '@nestjs/common';
import { DataSource, QueryRunner, SelectQueryBuilder } from 'typeorm';
import { QueryWatcherService } from './query-watcher.service';

export interface QueryContext {
  id: string;
  sql: string;
  parameters: any[];
  startTime: number;
  endTime?: number;
  duration?: number;
  connectionId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  stack?: string;
  operation: 'select' | 'insert' | 'update' | 'delete' | 'raw';
  entityName?: string;
  tableName?: string;
  affectedRows?: number;
  resultCount?: number;
  error?: Error;
}

export interface ConnectionInfo {
  id: string;
  database: string;
  host: string;
  port: number;
  username: string;
  poolSize: number;
  activeConnections: number;
  idleConnections: number;
  waitingConnections: number;
  acquiredConnections: number;
}

@Injectable()
export class QueryWatcherInterceptor {
  private readonly logger = new Logger(QueryWatcherInterceptor.name);
  private readonly originalMethods = new Map<string, Function>();
  private queryCounter = 0;

  constructor(
    private readonly queryWatcher: QueryWatcherService,
    private readonly dataSource: DataSource
  ) {}

  async setupInterception(): Promise<void> {
    try {
      await this.interceptQueryRunner();
      await this.interceptQueryBuilder();
      await this.interceptRepository();
      
      this.logger.log('Query interception setup completed');
    } catch (error) {
      this.logger.error('Failed to setup query interception:', error);
    }
  }

  private async interceptQueryRunner(): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    const originalQuery = queryRunner.query.bind(queryRunner);
    
    queryRunner.query = async (query: string, parameters?: any[]): Promise<any> => {
      const context = this.createQueryContext(query, parameters);
      
      try {
        const result = await originalQuery(query, parameters);
        
        context.endTime = Date.now();
        context.duration = context.endTime - context.startTime;
        context.resultCount = Array.isArray(result) ? result.length : 1;
        
        this.queryWatcher.trackQuery(context);
        
        return result;
      } catch (error) {
        context.endTime = Date.now();
        context.duration = context.endTime - context.startTime;
        context.error = error as Error;
        
        this.queryWatcher.trackQuery(context);
        
        throw error;
      }
    };
  }

  private async interceptQueryBuilder(): Promise<void> {
    const originalMethods = {
      getMany: SelectQueryBuilder.prototype.getMany,
      getOne: SelectQueryBuilder.prototype.getOne,
      getRawMany: SelectQueryBuilder.prototype.getRawMany,
      getRawOne: SelectQueryBuilder.prototype.getRawOne,
      getCount: SelectQueryBuilder.prototype.getCount,
      execute: SelectQueryBuilder.prototype.execute
    };

    SelectQueryBuilder.prototype.getMany = async function() {
      const context = this.createQueryBuilderContext(this, 'select');
      
      try {
        const result = await originalMethods.getMany.call(this);
        
        context.endTime = Date.now();
        context.duration = context.endTime - context.startTime;
        context.resultCount = result.length;
        
        this.queryWatcher.trackQuery(context);
        
        return result;
      } catch (error) {
        context.endTime = Date.now();
        context.duration = context.endTime - context.startTime;
        context.error = error as Error;
        
        this.queryWatcher.trackQuery(context);
        
        throw error;
      }
    }.bind(this);

    SelectQueryBuilder.prototype.getOne = async function() {
      const context = this.createQueryBuilderContext(this, 'select');
      
      try {
        const result = await originalMethods.getOne.call(this);
        
        context.endTime = Date.now();
        context.duration = context.endTime - context.startTime;
        context.resultCount = result ? 1 : 0;
        
        this.queryWatcher.trackQuery(context);
        
        return result;
      } catch (error) {
        context.endTime = Date.now();
        context.duration = context.endTime - context.startTime;
        context.error = error as Error;
        
        this.queryWatcher.trackQuery(context);
        
        throw error;
      }
    }.bind(this);

    SelectQueryBuilder.prototype.getRawMany = async function() {
      const context = this.createQueryBuilderContext(this, 'select');
      
      try {
        const result = await originalMethods.getRawMany.call(this);
        
        context.endTime = Date.now();
        context.duration = context.endTime - context.startTime;
        context.resultCount = result.length;
        
        this.queryWatcher.trackQuery(context);
        
        return result;
      } catch (error) {
        context.endTime = Date.now();
        context.duration = context.endTime - context.startTime;
        context.error = error as Error;
        
        this.queryWatcher.trackQuery(context);
        
        throw error;
      }
    }.bind(this);

    SelectQueryBuilder.prototype.getRawOne = async function() {
      const context = this.createQueryBuilderContext(this, 'select');
      
      try {
        const result = await originalMethods.getRawOne.call(this);
        
        context.endTime = Date.now();
        context.duration = context.endTime - context.startTime;
        context.resultCount = result ? 1 : 0;
        
        this.queryWatcher.trackQuery(context);
        
        return result;
      } catch (error) {
        context.endTime = Date.now();
        context.duration = context.endTime - context.startTime;
        context.error = error as Error;
        
        this.queryWatcher.trackQuery(context);
        
        throw error;
      }
    }.bind(this);

    SelectQueryBuilder.prototype.getCount = async function() {
      const context = this.createQueryBuilderContext(this, 'select');
      
      try {
        const result = await originalMethods.getCount.call(this);
        
        context.endTime = Date.now();
        context.duration = context.endTime - context.startTime;
        context.resultCount = 1;
        
        this.queryWatcher.trackQuery(context);
        
        return result;
      } catch (error) {
        context.endTime = Date.now();
        context.duration = context.endTime - context.startTime;
        context.error = error as Error;
        
        this.queryWatcher.trackQuery(context);
        
        throw error;
      }
    }.bind(this);

    SelectQueryBuilder.prototype.execute = async function() {
      const context = this.createQueryBuilderContext(this, 'raw');
      
      try {
        const result = await originalMethods.execute.call(this);
        
        context.endTime = Date.now();
        context.duration = context.endTime - context.startTime;
        context.affectedRows = result.affected || 0;
        
        this.queryWatcher.trackQuery(context);
        
        return result;
      } catch (error) {
        context.endTime = Date.now();
        context.duration = context.endTime - context.startTime;
        context.error = error as Error;
        
        this.queryWatcher.trackQuery(context);
        
        throw error;
      }
    }.bind(this);
  }

  private async interceptRepository(): Promise<void> {
    // Intercept repository methods like find, findOne, save, remove, etc.
    const repositories = this.dataSource.entityMetadatas.map(metadata => 
      this.dataSource.getRepository(metadata.target)
    );

    for (const repository of repositories) {
      this.interceptRepositoryMethods(repository);
    }
  }

  private interceptRepositoryMethods(repository: any): void {
    const methodsToIntercept = [
      'find', 'findOne', 'findOneBy', 'findBy', 'findAndCount', 'findAndCountBy',
      'count', 'countBy', 'save', 'insert', 'update', 'upsert', 'delete', 'remove'
    ];

    for (const methodName of methodsToIntercept) {
      if (typeof repository[methodName] === 'function') {
        const originalMethod = repository[methodName];
        
        repository[methodName] = async (...args: any[]) => {
          const context = this.createRepositoryContext(repository, methodName, args);
          
          try {
            const result = await originalMethod.apply(repository, args);
            
            context.endTime = Date.now();
            context.duration = context.endTime - context.startTime;
            
            if (Array.isArray(result)) {
              context.resultCount = result.length;
            } else if (result && typeof result === 'object') {
              context.resultCount = 1;
              context.affectedRows = result.affected || result.generatedMaps?.length || 1;
            }
            
            this.queryWatcher.trackQuery(context);
            
            return result;
          } catch (error) {
            context.endTime = Date.now();
            context.duration = context.endTime - context.startTime;
            context.error = error as Error;
            
            this.queryWatcher.trackQuery(context);
            
            throw error;
          }
        };
      }
    }
  }

  private createQueryContext(sql: string, parameters?: any[]): QueryContext {
    return {
      id: this.generateQueryId(),
      sql: sql.trim(),
      parameters: parameters || [],
      startTime: Date.now(),
      operation: this.detectOperationType(sql),
      tableName: this.extractTableName(sql),
      stack: this.captureStack(),
      traceId: this.generateTraceId()
    };
  }

  private createQueryBuilderContext(queryBuilder: any, operation: string): QueryContext {
    const sql = queryBuilder.getSql();
    const parameters = queryBuilder.getParameters();
    
    return {
      id: this.generateQueryId(),
      sql: sql.trim(),
      parameters: Object.values(parameters),
      startTime: Date.now(),
      operation: operation as any,
      entityName: queryBuilder.expressionMap?.mainAlias?.metadata?.name,
      tableName: queryBuilder.expressionMap?.mainAlias?.metadata?.tableName,
      stack: this.captureStack(),
      traceId: this.generateTraceId()
    };
  }

  private createRepositoryContext(repository: any, method: string, args: any[]): QueryContext {
    const entityName = repository.metadata?.name;
    const tableName = repository.metadata?.tableName;
    
    return {
      id: this.generateQueryId(),
      sql: `Repository.${method}`, // Will be replaced with actual SQL later
      parameters: args,
      startTime: Date.now(),
      operation: this.mapRepositoryMethodToOperation(method),
      entityName,
      tableName,
      stack: this.captureStack(),
      traceId: this.generateTraceId()
    };
  }

  private detectOperationType(sql: string): QueryContext['operation'] {
    const normalizedSql = sql.toLowerCase().trim();
    
    if (normalizedSql.startsWith('select')) return 'select';
    if (normalizedSql.startsWith('insert')) return 'insert';
    if (normalizedSql.startsWith('update')) return 'update';
    if (normalizedSql.startsWith('delete')) return 'delete';
    
    return 'raw';
  }

  private mapRepositoryMethodToOperation(method: string): QueryContext['operation'] {
    const selectMethods = ['find', 'findOne', 'findOneBy', 'findBy', 'findAndCount', 'findAndCountBy', 'count', 'countBy'];
    const insertMethods = ['save', 'insert'];
    const updateMethods = ['update', 'upsert'];
    const deleteMethods = ['delete', 'remove'];
    
    if (selectMethods.includes(method)) return 'select';
    if (insertMethods.includes(method)) return 'insert';
    if (updateMethods.includes(method)) return 'update';
    if (deleteMethods.includes(method)) return 'delete';
    
    return 'raw';
  }

  private extractTableName(sql: string): string | undefined {
    const normalizedSql = sql.toLowerCase().trim();
    
    // Extract table name from different SQL operations
    let match = normalizedSql.match(/from\s+`?(\w+)`?/i);
    if (match) return match[1];
    
    match = normalizedSql.match(/insert\s+into\s+`?(\w+)`?/i);
    if (match) return match[1];
    
    match = normalizedSql.match(/update\s+`?(\w+)`?/i);
    if (match) return match[1];
    
    match = normalizedSql.match(/delete\s+from\s+`?(\w+)`?/i);
    if (match) return match[1];
    
    return undefined;
  }

  private captureStack(): string {
    const stack = new Error().stack;
    if (!stack) return '';
    
    // Filter out internal TypeORM and interceptor frames
    const lines = stack.split('\n');
    const filteredLines = lines.filter(line => 
      !line.includes('QueryWatcherInterceptor') &&
      !line.includes('node_modules/typeorm') &&
      !line.includes('node_modules/@nestjs')
    );
    
    return filteredLines.slice(0, 10).join('\n');
  }

  private generateQueryId(): string {
    return `query_${Date.now()}_${++this.queryCounter}`;
  }

  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async getConnectionInfo(): Promise<ConnectionInfo> {
    const driver = this.dataSource.driver;
    const pool = (driver as any).pool;
    
    return {
      id: this.dataSource.name || 'default',
      database: this.dataSource.options.database as string,
      host: (this.dataSource.options as any).host || 'localhost',
      port: (this.dataSource.options as any).port || 5432,
      username: (this.dataSource.options as any).username || 'unknown',
      poolSize: pool?.config?.max || 10,
      activeConnections: pool?.totalCount || 0,
      idleConnections: pool?.idleCount || 0,
      waitingConnections: pool?.waitingCount || 0,
      acquiredConnections: pool?.acquiredCount || 0
    };
  }

  async cleanup(): Promise<void> {
    // Restore original methods if needed
    // This would be implemented if we stored references to original methods
    this.logger.log('Query interception cleanup completed');
  }
}
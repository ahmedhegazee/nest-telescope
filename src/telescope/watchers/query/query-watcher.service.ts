import { Injectable, Logger, Inject } from '@nestjs/common';
import { TelescopeService } from '../../core/services/telescope.service';
import { TelescopeEntry } from '../../core/interfaces/telescope-entry.interface';
import { TelescopeConfig } from '../../core/interfaces/telescope-config.interface';
import { QueryContext } from './query-watcher.interceptor';
import { QueryWatcherConfig, defaultQueryWatcherConfig } from './query-watcher.config';

export interface SlowQueryAnalysis {
  queryId: string;
  sql: string;
  duration: number;
  severity: 'slow' | 'very_slow' | 'critical';
  issues: QueryIssue[];
  optimizationHints: OptimizationHint[];
  affectedRows: number;
  executionPlan?: ExecutionPlan;
}

export interface QueryIssue {
  type: 'missing_index' | 'full_table_scan' | 'excessive_joins' | 'subquery_performance' | 'n_plus_one';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  suggestion: string;
  affectedTable?: string;
  affectedColumn?: string;
}

export interface OptimizationHint {
  type: 'index_suggestion' | 'query_rewrite' | 'schema_change' | 'caching_opportunity';
  priority: 'low' | 'medium' | 'high';
  description: string;
  implementation: string;
  estimatedImpact: string;
}

export interface ExecutionPlan {
  totalCost: number;
  rows: number;
  operations: ExecutionOperation[];
}

export interface ExecutionOperation {
  operation: string;
  table: string;
  cost: number;
  rows: number;
  filter?: string;
}

export interface QueryMetrics {
  totalQueries: number;
  slowQueries: number;
  verySlowQueries: number;
  errorQueries: number;
  averageQueryTime: number;
  queriesPerSecond: number;
  queryTimeDistribution: {
    fast: number;      // < 50ms
    normal: number;    // 50ms - 500ms
    slow: number;      // 500ms - 2s
    verySlow: number;  // > 2s
  };
  operationDistribution: {
    select: number;
    insert: number;
    update: number;
    delete: number;
    raw: number;
  };
  topSlowQueries: Array<{
    sql: string;
    duration: number;
    count: number;
    lastExecuted: Date;
  }>;
}

@Injectable()
export class QueryWatcherService {
  private readonly logger = new Logger(QueryWatcherService.name);
  private readonly config: QueryWatcherConfig;
  private readonly queryMetrics: QueryMetrics;
  private readonly queryHistory: QueryContext[] = [];
  private readonly maxHistorySize = 1000;
  private readonly recentQueries = new Map<string, QueryContext[]>();

  constructor(
    private readonly telescopeService: TelescopeService,
    @Inject('QUERY_WATCHER_CONFIG') queryWatcherConfig: QueryWatcherConfig
  ) {
    this.config = { ...defaultQueryWatcherConfig, ...queryWatcherConfig };
    this.queryMetrics = this.initializeMetrics();
  }


  private initializeMetrics(): QueryMetrics {
    return {
      totalQueries: 0,
      slowQueries: 0,
      verySlowQueries: 0,
      errorQueries: 0,
      averageQueryTime: 0,
      queriesPerSecond: 0,
      queryTimeDistribution: {
        fast: 0,
        normal: 0,
        slow: 0,
        verySlow: 0
      },
      operationDistribution: {
        select: 0,
        insert: 0,
        update: 0,
        delete: 0,
        raw: 0
      },
      topSlowQueries: []
    };
  }

  trackQuery(context: QueryContext): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Check if query should be excluded
      if (this.shouldExcludeQuery(context.sql)) {
        return;
      }

      // Check sampling rate
      if (Math.random() * 100 > this.config.sampleRate) {
        return;
      }

      // Add to history
      this.addToHistory(context);

      // Update metrics
      this.updateMetrics(context);

      // Create telescope entry
      const entry = this.createTelescopeEntry(context);
      this.telescopeService.record(entry);

      // Analyze slow queries
      if (context.duration && context.duration > this.config.slowQueryThreshold) {
        this.analyzeSlowQuery(context);
      }

      // Track for N+1 detection
      this.trackForNPlusOneDetection(context);

    } catch (error) {
      this.logger.error('Failed to track query:', error);
    }
  }

  private shouldExcludeQuery(sql: string): boolean {
    const normalizedSql = sql.trim().toUpperCase();
    
    return this.config.excludeQueries.some(excludePattern => 
      normalizedSql.startsWith(excludePattern.toUpperCase())
    );
  }

  private addToHistory(context: QueryContext): void {
    this.queryHistory.push(context);
    if (this.queryHistory.length > this.maxHistorySize) {
      this.queryHistory.shift();
    }
  }

  private updateMetrics(context: QueryContext): void {
    this.queryMetrics.totalQueries++;
    
    if (context.error) {
      this.queryMetrics.errorQueries++;
    }

    if (context.duration) {
      // Update average query time
      this.queryMetrics.averageQueryTime = 
        ((this.queryMetrics.averageQueryTime * (this.queryMetrics.totalQueries - 1)) + context.duration) / 
        this.queryMetrics.totalQueries;

      // Update time distribution
      if (context.duration < 50) {
        this.queryMetrics.queryTimeDistribution.fast++;
      } else if (context.duration < 500) {
        this.queryMetrics.queryTimeDistribution.normal++;
      } else if (context.duration < 2000) {
        this.queryMetrics.queryTimeDistribution.slow++;
        this.queryMetrics.slowQueries++;
      } else {
        this.queryMetrics.queryTimeDistribution.verySlow++;
        this.queryMetrics.verySlowQueries++;
      }

      // Update top slow queries
      this.updateTopSlowQueries(context);
    }

    // Update operation distribution
    this.queryMetrics.operationDistribution[context.operation]++;

    // Update queries per second (calculated from recent history)
    this.updateQueriesPerSecond();
  }

  private updateTopSlowQueries(context: QueryContext): void {
    if (!context.duration || context.duration < this.config.slowQueryThreshold) {
      return;
    }

    const existingQuery = this.queryMetrics.topSlowQueries.find(q => q.sql === context.sql);
    
    if (existingQuery) {
      existingQuery.count++;
      existingQuery.lastExecuted = new Date();
      if (context.duration > existingQuery.duration) {
        existingQuery.duration = context.duration;
      }
    } else {
      this.queryMetrics.topSlowQueries.push({
        sql: context.sql,
        duration: context.duration,
        count: 1,
        lastExecuted: new Date()
      });
    }

    // Keep only top 10 slow queries
    this.queryMetrics.topSlowQueries.sort((a, b) => b.duration - a.duration);
    if (this.queryMetrics.topSlowQueries.length > 10) {
      this.queryMetrics.topSlowQueries = this.queryMetrics.topSlowQueries.slice(0, 10);
    }
  }

  private updateQueriesPerSecond(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentQueries = this.queryHistory.filter(q => q.startTime > oneMinuteAgo);
    
    this.queryMetrics.queriesPerSecond = recentQueries.length / 60;
  }

  private createTelescopeEntry(context: QueryContext): TelescopeEntry {
    const entryId = `query_${context.id}`;
    const familyHash = this.generateFamilyHash(context);
    
    return {
      id: entryId,
      type: 'query',
      familyHash,
      content: {
        query: {
          id: context.id,
          sql: this.truncateQuery(context.sql),
          parameters: context.parameters,
          duration: context.duration,
          operation: context.operation,
          entityName: context.entityName,
          tableName: context.tableName,
          affectedRows: context.affectedRows,
          resultCount: context.resultCount,
          connectionId: context.connectionId,
          traceId: context.traceId,
          timestamp: new Date(context.startTime).toISOString()
        },
        performance: {
          duration: context.duration,
          slow: context.duration ? context.duration > this.config.slowQueryThreshold : false,
          verySlow: context.duration ? context.duration > this.config.verySlowQueryThreshold : false
        },
        error: context.error ? {
          message: context.error.message,
          stack: context.error.stack,
          name: context.error.name
        } : null,
        stack: this.config.enableStackTrace ? context.stack : null,
        analysis: context.duration && context.duration > this.config.slowQueryThreshold ? 
          this.getQueryAnalysis(context) : null
      },
      tags: this.generateTags(context),
      timestamp: new Date(context.startTime),
      sequence: context.startTime
    };
  }

  private generateFamilyHash(context: QueryContext): string {
    // Group similar queries together by normalizing the SQL
    const normalizedSql = this.normalizeQuery(context.sql);
    return `${context.operation}:${normalizedSql}`;
  }

  private normalizeQuery(sql: string): string {
    // Remove parameter values and normalize whitespace
    return sql
      .replace(/\$\d+/g, '?')           // Replace PostgreSQL parameters
      .replace(/\?/g, '?')             // Normalize parameters
      .replace(/\s+/g, ' ')            // Normalize whitespace
      .replace(/\d+/g, 'N')            // Replace numbers with N
      .replace(/'[^']*'/g, "'?'")      // Replace string literals
      .trim()
      .substring(0, 100);              // Limit length
  }

  private truncateQuery(sql: string): string {
    if (sql.length <= this.config.maxQueryLength) {
      return sql;
    }
    
    return sql.substring(0, this.config.maxQueryLength) + '... [truncated]';
  }

  private generateTags(context: QueryContext): string[] {
    const tags: string[] = ['query', `operation:${context.operation}`];
    
    if (context.entityName) {
      tags.push(`entity:${context.entityName}`);
    }
    
    if (context.tableName) {
      tags.push(`table:${context.tableName}`);
    }
    
    if (context.duration) {
      if (context.duration > this.config.verySlowQueryThreshold) {
        tags.push('very-slow');
      } else if (context.duration > this.config.slowQueryThreshold) {
        tags.push('slow');
      } else if (context.duration < 50) {
        tags.push('fast');
      }
    }
    
    if (context.error) {
      tags.push('error');
    }
    
    if (context.userId) {
      tags.push('user-query');
    }
    
    return tags;
  }

  private analyzeSlowQuery(context: QueryContext): void {
    if (!this.config.enableQueryAnalysis || !context.duration) {
      return;
    }

    try {
      const analysis = this.performQueryAnalysis(context);
      
      if (analysis.issues.length > 0) {
        this.logger.warn(`Slow query detected: ${context.id}`, {
          sql: context.sql,
          duration: context.duration,
          issues: analysis.issues.map(i => i.description)
        });
      }
    } catch (error) {
      this.logger.error('Failed to analyze slow query:', error);
    }
  }

  private performQueryAnalysis(context: QueryContext): SlowQueryAnalysis {
    const issues: QueryIssue[] = [];
    const optimizationHints: OptimizationHint[] = [];
    
    // Analyze SQL for common issues
    const sql = context.sql.toLowerCase();
    
    // Check for missing WHERE clause
    if (sql.includes('select') && !sql.includes('where') && !sql.includes('limit')) {
      issues.push({
        type: 'full_table_scan',
        severity: 'high',
        description: 'Query may be performing a full table scan',
        suggestion: 'Add appropriate WHERE clause or LIMIT to reduce scanned rows',
        affectedTable: context.tableName
      });
    }

    // Check for excessive JOINs
    const joinCount = (sql.match(/join/g) || []).length;
    if (joinCount > 5) {
      issues.push({
        type: 'excessive_joins',
        severity: 'medium',
        description: `Query has ${joinCount} joins which may impact performance`,
        suggestion: 'Consider denormalizing data or using separate queries',
        affectedTable: context.tableName
      });
    }

    // Check for subqueries
    if (sql.includes('(select') || sql.includes('exists (')) {
      issues.push({
        type: 'subquery_performance',
        severity: 'medium',
        description: 'Query contains subqueries that may be optimized',
        suggestion: 'Consider rewriting subqueries as JOINs or using CTEs',
        affectedTable: context.tableName
      });
    }

    // Generate optimization hints
    if (issues.length > 0) {
      optimizationHints.push({
        type: 'index_suggestion',
        priority: 'high',
        description: 'Consider adding database indexes',
        implementation: 'Analyze query execution plan and add indexes on filtered columns',
        estimatedImpact: 'Could reduce query time by 50-90%'
      });
    }

    return {
      queryId: context.id,
      sql: context.sql,
      duration: context.duration,
      severity: context.duration > this.config.verySlowQueryThreshold ? 'critical' : 'slow',
      issues,
      optimizationHints,
      affectedRows: context.affectedRows || 0
    };
  }

  private trackForNPlusOneDetection(context: QueryContext): void {
    if (context.operation !== 'select' || !context.entityName) {
      return;
    }

    const key = `${context.entityName}_${context.traceId}`;
    
    if (!this.recentQueries.has(key)) {
      this.recentQueries.set(key, []);
    }
    
    const queries = this.recentQueries.get(key)!;
    queries.push(context);
    
    // Keep only recent queries (last 10 seconds)
    const tenSecondsAgo = Date.now() - 10000;
    const recentQueries = queries.filter(q => q.startTime > tenSecondsAgo);
    this.recentQueries.set(key, recentQueries);
    
    // Detect N+1 pattern
    if (recentQueries.length > 3) {
      this.detectNPlusOnePattern(key, recentQueries);
    }
  }

  private detectNPlusOnePattern(key: string, queries: QueryContext[]): void {
    // Check if queries are similar (same normalized SQL)
    const normalizedQueries = queries.map(q => this.normalizeQuery(q.sql));
    const uniqueQueries = new Set(normalizedQueries);
    
    if (uniqueQueries.size === 1 && queries.length > 3) {
      this.logger.warn(`N+1 query pattern detected: ${key}`, {
        queryCount: queries.length,
        sql: queries[0].sql,
        entity: queries[0].entityName
      });
      
      // Create a specific telescope entry for N+1 detection
      this.createNPlusOneEntry(queries);
    }
  }

  private createNPlusOneEntry(queries: QueryContext[]): void {
    const firstQuery = queries[0];
    
    const entry: TelescopeEntry = {
      id: `n_plus_one_${firstQuery.id}`,
      type: 'query',
      familyHash: `n_plus_one:${firstQuery.entityName}`,
      content: {
        nPlusOne: {
          queryCount: queries.length,
          entity: firstQuery.entityName,
          sql: firstQuery.sql,
          totalDuration: queries.reduce((sum, q) => sum + (q.duration || 0), 0),
          queries: queries.map(q => ({
            id: q.id,
            duration: q.duration,
            parameters: q.parameters
          }))
        }
      },
      tags: ['query', 'n-plus-one', 'performance-issue', `entity:${firstQuery.entityName}`],
      timestamp: new Date(firstQuery.startTime),
      sequence: firstQuery.startTime
    };
    
    this.telescopeService.record(entry);
  }

  private getQueryAnalysis(context: QueryContext): SlowQueryAnalysis {
    return this.performQueryAnalysis(context);
  }

  // Public API
  getMetrics(): QueryMetrics {
    return { ...this.queryMetrics };
  }

  getConfig(): QueryWatcherConfig {
    return { ...this.config };
  }

  getRecentQueries(limit: number = 50): QueryContext[] {
    return this.queryHistory.slice(-limit);
  }

  getSlowQueries(limit: number = 20): QueryContext[] {
    return this.queryHistory
      .filter(q => q.duration && q.duration > this.config.slowQueryThreshold)
      .sort((a, b) => (b.duration || 0) - (a.duration || 0))
      .slice(0, limit);
  }

  resetMetrics(): void {
    Object.assign(this.queryMetrics, this.initializeMetrics());
    this.queryHistory.length = 0;
    this.recentQueries.clear();
  }
}
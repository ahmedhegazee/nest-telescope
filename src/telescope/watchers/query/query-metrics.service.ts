import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, interval } from 'rxjs';
import { map, scan, shareReplay, takeUntil } from 'rxjs/operators';
import { QueryContext } from './query-watcher.interceptor';
import { ConnectionPoolMetrics } from './connection-pool-monitor.service';

export interface QueryPerformanceMetrics {
  totalQueries: number;
  slowQueries: number;
  verySlowQueries: number;
  errorQueries: number;
  averageQueryTime: number;
  medianQueryTime: number;
  p95QueryTime: number;
  p99QueryTime: number;
  queriesPerSecond: number;
  queryTimePercentiles: {
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
  };
  operationBreakdown: {
    select: QueryOperationMetrics;
    insert: QueryOperationMetrics;
    update: QueryOperationMetrics;
    delete: QueryOperationMetrics;
    raw: QueryOperationMetrics;
  };
  tableMetrics: Record<string, TableMetrics>;
  timeWindowMetrics: {
    last5Minutes: QueryWindowMetrics;
    last15Minutes: QueryWindowMetrics;
    last30Minutes: QueryWindowMetrics;
    last60Minutes: QueryWindowMetrics;
  };
  topSlowQueries: SlowQueryInfo[];
  nPlusOneDetections: number;
  connectionPoolMetrics?: ConnectionPoolMetrics;
}

export interface QueryOperationMetrics {
  count: number;
  averageTime: number;
  errorCount: number;
  errorRate: number;
  slowCount: number;
  slowRate: number;
}

export interface TableMetrics {
  queryCount: number;
  averageQueryTime: number;
  slowQueryCount: number;
  errorCount: number;
  mostCommonOperations: Array<{
    operation: string;
    count: number;
    averageTime: number;
  }>;
  lastAccessed: Date;
}

export interface QueryWindowMetrics {
  queryCount: number;
  averageTime: number;
  slowQueryCount: number;
  errorCount: number;
  queriesPerSecond: number;
}

export interface SlowQueryInfo {
  sql: string;
  averageTime: number;
  count: number;
  lastExecuted: Date;
  tableName?: string;
  operation: string;
}

export interface QueryDataPoint {
  context: QueryContext;
  timestamp: Date;
}

@Injectable()
export class QueryMetricsService {
  private readonly logger = new Logger(QueryMetricsService.name);
  private readonly destroy$ = new Subject<void>();
  private readonly dataSubject = new Subject<QueryDataPoint>();
  private readonly queryHistory: QueryDataPoint[] = [];
  private readonly queryTimes: number[] = [];
  private readonly maxHistorySize = 10000;
  private readonly maxTimesSamples = 1000;

  private currentMetrics: QueryPerformanceMetrics = {
    totalQueries: 0,
    slowQueries: 0,
    verySlowQueries: 0,
    errorQueries: 0,
    averageQueryTime: 0,
    medianQueryTime: 0,
    p95QueryTime: 0,
    p99QueryTime: 0,
    queriesPerSecond: 0,
    queryTimePercentiles: {
      p50: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      p99: 0
    },
    operationBreakdown: {
      select: this.initializeOperationMetrics(),
      insert: this.initializeOperationMetrics(),
      update: this.initializeOperationMetrics(),
      delete: this.initializeOperationMetrics(),
      raw: this.initializeOperationMetrics()
    },
    tableMetrics: {},
    timeWindowMetrics: {
      last5Minutes: this.initializeWindowMetrics(),
      last15Minutes: this.initializeWindowMetrics(),
      last30Minutes: this.initializeWindowMetrics(),
      last60Minutes: this.initializeWindowMetrics()
    },
    topSlowQueries: [],
    nPlusOneDetections: 0
  };

  constructor() {
    this.setupMetricsProcessing();
    this.startPeriodicCalculations();
  }

  private initializeOperationMetrics(): QueryOperationMetrics {
    return {
      count: 0,
      averageTime: 0,
      errorCount: 0,
      errorRate: 0,
      slowCount: 0,
      slowRate: 0
    };
  }

  private initializeWindowMetrics(): QueryWindowMetrics {
    return {
      queryCount: 0,
      averageTime: 0,
      slowQueryCount: 0,
      errorCount: 0,
      queriesPerSecond: 0
    };
  }

  private setupMetricsProcessing(): void {
    this.dataSubject
      .pipe(
        scan((metrics, dataPoint) => this.updateMetrics(metrics, dataPoint), this.currentMetrics),
        shareReplay(1),
        takeUntil(this.destroy$)
      )
      .subscribe(metrics => {
        this.currentMetrics = metrics;
      });
  }

  private startPeriodicCalculations(): void {
    interval(30000) // Every 30 seconds
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.updateTimeWindowMetrics();
        this.updateQueriesPerSecond();
        this.updatePercentiles();
        this.cleanupOldData();
      });
  }

  recordQuery(context: QueryContext): void {
    const dataPoint: QueryDataPoint = {
      context,
      timestamp: new Date()
    };

    // Add to history
    this.queryHistory.push(dataPoint);
    if (this.queryHistory.length > this.maxHistorySize) {
      this.queryHistory.shift();
    }

    // Track query times for percentile calculations
    if (context.duration) {
      this.queryTimes.push(context.duration);
      if (this.queryTimes.length > this.maxTimesSamples) {
        this.queryTimes.shift();
      }
    }

    // Emit to metrics processor
    this.dataSubject.next(dataPoint);
  }

  private updateMetrics(
    current: QueryPerformanceMetrics,
    dataPoint: QueryDataPoint
  ): QueryPerformanceMetrics {
    const { context } = dataPoint;
    const updated = { ...current };

    // Update basic counters
    updated.totalQueries++;

    if (context.error) {
      updated.errorQueries++;
    }

    if (context.duration) {
      // Update average query time
      updated.averageQueryTime = this.calculateNewAverage(
        current.averageQueryTime,
        context.duration,
        updated.totalQueries
      );

      // Update slow query counts
      if (context.duration > 5000) {
        updated.verySlowQueries++;
      } else if (context.duration > 1000) {
        updated.slowQueries++;
      }
    }

    // Update operation breakdown
    updated.operationBreakdown = this.updateOperationMetrics(
      updated.operationBreakdown,
      context
    );

    // Update table metrics
    if (context.tableName) {
      updated.tableMetrics = this.updateTableMetrics(
        updated.tableMetrics,
        context
      );
    }

    // Update top slow queries
    if (context.duration && context.duration > 1000) {
      updated.topSlowQueries = this.updateTopSlowQueries(
        updated.topSlowQueries,
        context
      );
    }

    return updated;
  }

  private calculateNewAverage(currentAverage: number, newValue: number, totalCount: number): number {
    return ((currentAverage * (totalCount - 1)) + newValue) / totalCount;
  }

  private updateOperationMetrics(
    current: QueryPerformanceMetrics['operationBreakdown'],
    context: QueryContext
  ): QueryPerformanceMetrics['operationBreakdown'] {
    const updated = { ...current };
    const operation = context.operation;
    const metrics = { ...updated[operation] };

    metrics.count++;

    if (context.error) {
      metrics.errorCount++;
    }

    if (context.duration) {
      metrics.averageTime = this.calculateNewAverage(
        metrics.averageTime,
        context.duration,
        metrics.count
      );

      if (context.duration > 1000) {
        metrics.slowCount++;
      }
    }

    metrics.errorRate = (metrics.errorCount / metrics.count) * 100;
    metrics.slowRate = (metrics.slowCount / metrics.count) * 100;

    updated[operation] = metrics;
    return updated;
  }

  private updateTableMetrics(
    current: Record<string, TableMetrics>,
    context: QueryContext
  ): Record<string, TableMetrics> {
    const updated = { ...current };
    const tableName = context.tableName!;

    if (!updated[tableName]) {
      updated[tableName] = {
        queryCount: 0,
        averageQueryTime: 0,
        slowQueryCount: 0,
        errorCount: 0,
        mostCommonOperations: [],
        lastAccessed: new Date()
      };
    }

    const metrics = updated[tableName];
    metrics.queryCount++;
    metrics.lastAccessed = new Date();

    if (context.error) {
      metrics.errorCount++;
    }

    if (context.duration) {
      metrics.averageQueryTime = this.calculateNewAverage(
        metrics.averageQueryTime,
        context.duration,
        metrics.queryCount
      );

      if (context.duration > 1000) {
        metrics.slowQueryCount++;
      }
    }

    // Update most common operations
    const existingOp = metrics.mostCommonOperations.find(op => op.operation === context.operation);
    if (existingOp) {
      existingOp.count++;
      existingOp.averageTime = this.calculateNewAverage(
        existingOp.averageTime,
        context.duration || 0,
        existingOp.count
      );
    } else {
      metrics.mostCommonOperations.push({
        operation: context.operation,
        count: 1,
        averageTime: context.duration || 0
      });
    }

    // Keep only top 5 operations
    metrics.mostCommonOperations.sort((a, b) => b.count - a.count);
    metrics.mostCommonOperations = metrics.mostCommonOperations.slice(0, 5);

    return updated;
  }

  private updateTopSlowQueries(
    current: SlowQueryInfo[],
    context: QueryContext
  ): SlowQueryInfo[] {
    const updated = [...current];
    const sql = this.normalizeQuery(context.sql);
    
    const existingQuery = updated.find(q => this.normalizeQuery(q.sql) === sql);
    
    if (existingQuery) {
      existingQuery.count++;
      existingQuery.lastExecuted = new Date();
      existingQuery.averageTime = this.calculateNewAverage(
        existingQuery.averageTime,
        context.duration || 0,
        existingQuery.count
      );
    } else {
      updated.push({
        sql: context.sql,
        averageTime: context.duration || 0,
        count: 1,
        lastExecuted: new Date(),
        tableName: context.tableName,
        operation: context.operation
      });
    }

    // Keep only top 20 slow queries
    updated.sort((a, b) => b.averageTime - a.averageTime);
    return updated.slice(0, 20);
  }

  private normalizeQuery(sql: string): string {
    return sql
      .replace(/\$\d+/g, '?')
      .replace(/\?/g, '?')
      .replace(/\s+/g, ' ')
      .replace(/\d+/g, 'N')
      .replace(/'[^']*'/g, "'?'")
      .trim()
      .substring(0, 200);
  }

  private updateTimeWindowMetrics(): void {
    const now = Date.now();
    const windows = [
      { key: 'last5Minutes', milliseconds: 5 * 60 * 1000 },
      { key: 'last15Minutes', milliseconds: 15 * 60 * 1000 },
      { key: 'last30Minutes', milliseconds: 30 * 60 * 1000 },
      { key: 'last60Minutes', milliseconds: 60 * 60 * 1000 }
    ];

    for (const window of windows) {
      const cutoff = now - window.milliseconds;
      const windowQueries = this.queryHistory.filter(
        dataPoint => dataPoint.timestamp.getTime() > cutoff
      );

      const windowMetrics: QueryWindowMetrics = {
        queryCount: windowQueries.length,
        averageTime: 0,
        slowQueryCount: 0,
        errorCount: 0,
        queriesPerSecond: windowQueries.length / (window.milliseconds / 1000)
      };

      if (windowQueries.length > 0) {
        const totalTime = windowQueries.reduce(
          (sum, dp) => sum + (dp.context.duration || 0),
          0
        );
        windowMetrics.averageTime = totalTime / windowQueries.length;
        windowMetrics.slowQueryCount = windowQueries.filter(
          dp => dp.context.duration && dp.context.duration > 1000
        ).length;
        windowMetrics.errorCount = windowQueries.filter(
          dp => dp.context.error
        ).length;
      }

      (this.currentMetrics.timeWindowMetrics as any)[window.key] = windowMetrics;
    }
  }

  private updateQueriesPerSecond(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentQueries = this.queryHistory.filter(
      dataPoint => dataPoint.timestamp.getTime() > oneMinuteAgo
    );

    this.currentMetrics.queriesPerSecond = recentQueries.length / 60;
  }

  private updatePercentiles(): void {
    if (this.queryTimes.length === 0) return;

    const sortedTimes = [...this.queryTimes].sort((a, b) => a - b);
    
    this.currentMetrics.medianQueryTime = this.calculatePercentile(sortedTimes, 50);
    this.currentMetrics.p95QueryTime = this.calculatePercentile(sortedTimes, 95);
    this.currentMetrics.p99QueryTime = this.calculatePercentile(sortedTimes, 99);
    
    this.currentMetrics.queryTimePercentiles = {
      p50: this.calculatePercentile(sortedTimes, 50),
      p75: this.calculatePercentile(sortedTimes, 75),
      p90: this.calculatePercentile(sortedTimes, 90),
      p95: this.calculatePercentile(sortedTimes, 95),
      p99: this.calculatePercentile(sortedTimes, 99)
    };
  }

  private calculatePercentile(sortedArray: number[], percentile: number): number {
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)] || 0;
  }

  private cleanupOldData(): void {
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    
    // Remove old queries from history
    while (this.queryHistory.length > 0 && 
           this.queryHistory[0].timestamp.getTime() < twoHoursAgo) {
      this.queryHistory.shift();
    }
  }

  recordNPlusOneDetection(): void {
    this.currentMetrics.nPlusOneDetections++;
  }

  updateConnectionPoolMetrics(connectionMetrics: ConnectionPoolMetrics): void {
    this.currentMetrics.connectionPoolMetrics = connectionMetrics;
  }

  // Public API
  getMetrics(): QueryPerformanceMetrics {
    return { ...this.currentMetrics };
  }

  getMetricsStream(): Observable<QueryPerformanceMetrics> {
    return this.dataSubject.pipe(
      scan((metrics, dataPoint) => this.updateMetrics(metrics, dataPoint), this.currentMetrics),
      shareReplay(1)
    );
  }

  getSlowQueries(limit: number = 10): SlowQueryInfo[] {
    return this.currentMetrics.topSlowQueries.slice(0, limit);
  }

  getTableMetrics(tableName: string): TableMetrics | undefined {
    return this.currentMetrics.tableMetrics[tableName];
  }

  getTopTables(limit: number = 10): Array<{ tableName: string; metrics: TableMetrics }> {
    return Object.entries(this.currentMetrics.tableMetrics)
      .map(([tableName, metrics]) => ({ tableName, metrics }))
      .sort((a, b) => b.metrics.queryCount - a.metrics.queryCount)
      .slice(0, limit);
  }

  getSlowestTables(limit: number = 10): Array<{ tableName: string; metrics: TableMetrics }> {
    return Object.entries(this.currentMetrics.tableMetrics)
      .map(([tableName, metrics]) => ({ tableName, metrics }))
      .sort((a, b) => b.metrics.averageQueryTime - a.metrics.averageQueryTime)
      .slice(0, limit);
  }

  getRecentQueries(limit: number = 100): QueryDataPoint[] {
    return this.queryHistory.slice(-limit).reverse();
  }

  reset(): void {
    this.currentMetrics = {
      totalQueries: 0,
      slowQueries: 0,
      verySlowQueries: 0,
      errorQueries: 0,
      averageQueryTime: 0,
      medianQueryTime: 0,
      p95QueryTime: 0,
      p99QueryTime: 0,
      queriesPerSecond: 0,
      queryTimePercentiles: {
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        p99: 0
      },
      operationBreakdown: {
        select: this.initializeOperationMetrics(),
        insert: this.initializeOperationMetrics(),
        update: this.initializeOperationMetrics(),
        delete: this.initializeOperationMetrics(),
        raw: this.initializeOperationMetrics()
      },
      tableMetrics: {},
      timeWindowMetrics: {
        last5Minutes: this.initializeWindowMetrics(),
        last15Minutes: this.initializeWindowMetrics(),
        last30Minutes: this.initializeWindowMetrics(),
        last60Minutes: this.initializeWindowMetrics()
      },
      topSlowQueries: [],
      nPlusOneDetections: 0
    };
    
    this.queryHistory.length = 0;
    this.queryTimes.length = 0;
  }

  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { TelescopeService } from '../../core/services/telescope.service';
import { TelescopeEntry } from '../../core/interfaces/telescope-entry.interface';
import { CacheWatcherConfig, defaultCacheWatcherConfig } from './cache-watcher.config';
import { Observable, Subject, interval, BehaviorSubject } from 'rxjs';
import { map, takeUntil, shareReplay } from 'rxjs/operators';
import Redis from 'ioredis';

export interface CacheContext {
  id: string;
  timestamp: Date;
  operation: CacheOperation;
  key: string;
  keyPattern?: string;
  value?: any;
  ttl?: number;
  hit: boolean;
  
  // Execution info
  startTime: Date;
  endTime?: Date;
  duration?: number;
  
  // Performance metrics
  performance?: {
    executionTime?: number;
    memoryUsage?: number;
    networkLatency?: number;
    cpuUsage?: number;
  };
  
  // Cache info
  cacheInstance?: string;
  cacheType?: string;
  size?: number;
  
  // Connection info
  connectionId?: string;
  host?: string;
  port?: number;
  database?: number;
  
  // Result info
  result?: any;
  error?: any;
  
  // Correlation
  traceId?: string;
  requestId?: string;
  userId?: string;
  sessionId?: string;
  
  // Redis-specific
  redisCommand?: string;
  redisArgs?: any[];
}

export enum CacheOperation {
  GET = 'get',
  SET = 'set',
  DEL = 'del',
  EXISTS = 'exists',
  EXPIRE = 'expire',
  TTL = 'ttl',
  INCR = 'incr',
  DECR = 'decr',
  PUSH = 'push',
  POP = 'pop',
  FLUSH = 'flush',
  FLUSHALL = 'flushall',
  KEYS = 'keys',
  SCAN = 'scan',
  MGET = 'mget',
  MSET = 'mset',
  HGET = 'hget',
  HSET = 'hset',
  HDEL = 'hdel',
  SADD = 'sadd',
  SREM = 'srem',
  ZADD = 'zadd',
  ZREM = 'zrem',
  PUBLISH = 'publish',
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  OTHER = 'other'
}

export interface CacheMetrics {
  totalOperations: number;
  hitCount: number;
  missCount: number;
  errorCount: number;
  evictionCount: number;
  
  // Performance metrics
  averageResponseTime: number;
  slowOperations: number;
  operationsPerSecond: number;
  
  // Hit rate metrics
  hitRate: number;
  missRate: number;
  errorRate: number;
  
  // Operation breakdown
  operationsByType: Record<string, number>;
  operationsByResult: Record<string, number>;
  
  // Key patterns
  topKeyPatterns: Array<{
    pattern: string;
    count: number;
    hitRate: number;
    avgResponseTime: number;
  }>;
  
  // Slow operations
  slowOperationsByType: Record<string, number>;
  
  // Memory and size
  totalMemoryUsage: number;
  averageValueSize: number;
  keyCount: number;
  
  // Connection metrics
  activeConnections: number;
  connectionPool: {
    total: number;
    active: number;
    idle: number;
    waiting: number;
  };
  
  // Redis-specific metrics
  redisInfo?: {
    version: string;
    uptime: number;
    memory: {
      used: number;
      peak: number;
      fragmentation: number;
    };
    stats: {
      commands: number;
      connections: number;
      keyspaceHits: number;
      keyspaceMisses: number;
    };
    clients: {
      connected: number;
      blocked: number;
      tracking: number;
    };
  };
  
  // Health metrics
  healthScore: number;
  healthStatus: 'healthy' | 'warning' | 'critical';
  
  // Trends
  trends: {
    lastHour: CacheTrendData;
    lastDay: CacheTrendData;
    lastWeek: CacheTrendData;
  };
}

export interface CacheTrendData {
  totalOperations: number;
  hitCount: number;
  missCount: number;
  errorCount: number;
  averageResponseTime: number;
  hitRate: number;
  change: number;
  changePercent: number;
  peak: number;
}

export interface CacheAlert {
  id: string;
  type: 'hit_rate' | 'miss_rate' | 'slow_operations' | 'error_rate' | 'memory_usage' | 'connection_limit';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  data: any;
  acknowledged: boolean;
  resolvedAt?: Date;
  cacheInstance?: string;
}

export interface CacheHealth {
  instance: string;
  status: 'healthy' | 'warning' | 'critical';
  score: number;
  issues: string[];
  recommendations: string[];
  metrics: {
    hitRate: number;
    errorRate: number;
    avgResponseTime: number;
    memoryUsage: number;
    connectionCount: number;
  };
}

@Injectable()
export class CacheWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheWatcherService.name);
  private readonly config: CacheWatcherConfig;
  private readonly destroy$ = new Subject<void>();
  private readonly metricsSubject = new BehaviorSubject<CacheMetrics>(this.initializeMetrics());
  private readonly alertsSubject = new Subject<CacheAlert>();
  private readonly cacheContextSubject = new Subject<CacheContext>();
  
  private cacheHistory: CacheContext[] = [];
  private currentMetrics: CacheMetrics = this.initializeMetrics();
  private alertHistory: CacheAlert[] = [];
  private keyPatterns = new Map<string, { count: number; hits: number; responseTimes: number[] }>();
  private responseTimes: number[] = [];
  private activeOperations = new Map<string, CacheContext>();
  
  // Redis integration
  private redisClients = new Map<string, Redis>();
  private redisInfo = new Map<string, any>();
  private connectionPools = new Map<string, any>();
  
  constructor(
    private readonly telescopeService: TelescopeService,
    @Inject('CACHE_WATCHER_CONFIG') cacheWatcherConfig: CacheWatcherConfig,
    @Optional() @Inject('REDIS_CLIENTS') private redisClientInstances?: Map<string, Redis>
  ) {
    this.config = { ...defaultCacheWatcherConfig, ...cacheWatcherConfig };
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    await this.setupRedisIntegration();
    this.startPeriodicProcessing();
    this.startRedisMonitoring();
    this.logger.log('Cache watcher initialized');
  }

  onModuleDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.cleanupRedisConnections();
  }

  private initializeMetrics(): CacheMetrics {
    return {
      totalOperations: 0,
      hitCount: 0,
      missCount: 0,
      errorCount: 0,
      evictionCount: 0,
      averageResponseTime: 0,
      slowOperations: 0,
      operationsPerSecond: 0,
      hitRate: 0,
      missRate: 0,
      errorRate: 0,
      operationsByType: {},
      operationsByResult: {},
      topKeyPatterns: [],
      slowOperationsByType: {},
      totalMemoryUsage: 0,
      averageValueSize: 0,
      keyCount: 0,
      activeConnections: 0,
      connectionPool: {
        total: 0,
        active: 0,
        idle: 0,
        waiting: 0,
      },
      healthScore: 100,
      healthStatus: 'healthy',
      trends: {
        lastHour: this.initializeTrendData(),
        lastDay: this.initializeTrendData(),
        lastWeek: this.initializeTrendData(),
      },
    };
  }

  private initializeTrendData(): CacheTrendData {
    return {
      totalOperations: 0,
      hitCount: 0,
      missCount: 0,
      errorCount: 0,
      averageResponseTime: 0,
      hitRate: 0,
      change: 0,
      changePercent: 0,
      peak: 0,
    };
  }

  trackCacheOperation(context: CacheContext): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Apply sampling
      if (Math.random() * 100 > this.config.sampleRate) {
        return;
      }

      // Check exclusions
      if (this.shouldExcludeOperation(context)) {
        return;
      }

      // Sanitize context
      this.sanitizeContext(context);

      // Add to history
      this.addToHistory(context);

      // Update metrics
      this.updateMetrics(context);

      // Track key patterns
      this.trackKeyPattern(context);

      // Create telescope entry
      const entry = this.createTelescopeEntry(context);
      this.telescopeService.record(entry);

      // Check for alerts
      this.checkAlerts(context);

      // Correlate with other systems
      this.correlateCache(context);

      // Emit cache context
      this.cacheContextSubject.next(context);

      this.logger.debug(`Cache operation tracked: ${context.operation} ${context.key}`);

    } catch (error) {
      this.logger.error('Failed to track cache operation:', error);
    }
  }

  private shouldExcludeOperation(context: CacheContext): boolean {
    if (this.config.excludeOperations.includes(context.operation)) {
      return true;
    }

    // Check key pattern exclusions
    for (const pattern of this.config.excludeKeyPatterns) {
      if (this.matchesPattern(context.key, pattern)) {
        return true;
      }
    }

    // Check key pattern inclusions
    if (this.config.includeKeyPatterns.length > 0) {
      const included = this.config.includeKeyPatterns.some(pattern => 
        this.matchesPattern(context.key, pattern)
      );
      if (!included) {
        return true;
      }
    }

    return false;
  }

  private matchesPattern(key: string, pattern: string): boolean {
    // Simple pattern matching with wildcards
    const regexPattern = pattern.replace(/\*/g, '.*');
    return new RegExp(regexPattern).test(key);
  }

  private sanitizeContext(context: CacheContext): void {
    // Sanitize sensitive keys
    if (this.config.sensitiveKeyPatterns.some(pattern => this.matchesPattern(context.key, pattern))) {
      context.key = this.sanitizeKey(context.key);
    }

    // Sanitize values
    if (this.config.sanitizeValues && context.value) {
      context.value = this.sanitizeValue(context.value);
    }

    // Limit key length
    if (context.key.length > this.config.maxKeyLength) {
      context.key = context.key.substring(0, this.config.maxKeyLength) + '...';
    }
  }

  private sanitizeKey(key: string): string {
    // Replace sensitive parts with hash
    return key.replace(/([a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})/gi, '[HASH]');
  }

  private sanitizeValue(value: any): any {
    if (!value) return value;

    if (typeof value === 'string') {
      const jsonString = JSON.stringify(value);
      if (jsonString.length > this.config.maxValueSize) {
        return { _truncated: true, _size: jsonString.length };
      }
      return value;
    }

    if (typeof value === 'object') {
      const sanitized = { ...value };
      const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth'];
      
      for (const field of sensitiveFields) {
        if (sanitized[field]) {
          sanitized[field] = '[REDACTED]';
        }
      }

      const jsonString = JSON.stringify(sanitized);
      if (jsonString.length > this.config.maxValueSize) {
        return { _truncated: true, _size: jsonString.length };
      }

      return sanitized;
    }

    return value;
  }

  private addToHistory(context: CacheContext): void {
    this.cacheHistory.push(context);
    
    // Maintain history size limit
    if (this.cacheHistory.length > this.config.maxHistorySize) {
      this.cacheHistory.shift();
    }

    // Clean up old entries
    const retentionDate = new Date(Date.now() - this.config.retentionPeriod);
    this.cacheHistory = this.cacheHistory.filter(cache => cache.timestamp > retentionDate);
  }

  private updateMetrics(context: CacheContext): void {
    this.currentMetrics.totalOperations++;

    // Update hit/miss/error counts
    if (context.error) {
      this.currentMetrics.errorCount++;
    } else if (context.hit) {
      this.currentMetrics.hitCount++;
    } else {
      this.currentMetrics.missCount++;
    }

    // Update operation counts
    this.currentMetrics.operationsByType[context.operation] = 
      (this.currentMetrics.operationsByType[context.operation] || 0) + 1;

    const resultType = context.error ? 'error' : context.hit ? 'hit' : 'miss';
    this.currentMetrics.operationsByResult[resultType] = 
      (this.currentMetrics.operationsByResult[resultType] || 0) + 1;

    // Update performance metrics
    if (context.duration) {
      this.responseTimes.push(context.duration);
      this.currentMetrics.averageResponseTime = this.calculateAverage(this.responseTimes);
      
      if (context.duration > this.config.slowOperationThreshold) {
        this.currentMetrics.slowOperations++;
        this.currentMetrics.slowOperationsByType[context.operation] = 
          (this.currentMetrics.slowOperationsByType[context.operation] || 0) + 1;
      }
    }

    // Update rates
    this.updateRates();

    // Update health score
    this.updateHealthScore();
  }

  private trackKeyPattern(context: CacheContext): void {
    if (!this.config.captureKeyPatterns) return;

    const pattern = this.extractKeyPattern(context.key);
    const existing = this.keyPatterns.get(pattern) || { count: 0, hits: 0, responseTimes: [] };
    
    existing.count++;
    if (context.hit) {
      existing.hits++;
    }
    if (context.duration) {
      existing.responseTimes.push(context.duration);
    }

    this.keyPatterns.set(pattern, existing);
  }

  private extractKeyPattern(key: string): string {
    // Extract pattern by replacing dynamic parts
    return key
      .replace(/\d+/g, 'N')
      .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, 'UUID')
      .replace(/[a-f0-9]{32}/gi, 'HASH32')
      .replace(/[a-f0-9]{40}/gi, 'HASH40')
      .replace(/[a-f0-9]{64}/gi, 'HASH64')
      .replace(/\d{4}-\d{2}-\d{2}/g, 'DATE')
      .replace(/\d{2}:\d{2}:\d{2}/g, 'TIME');
  }

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private updateRates(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;

    const recentOperations = this.cacheHistory.filter(
      cache => cache.timestamp.getTime() > oneMinuteAgo
    );

    this.currentMetrics.operationsPerSecond = recentOperations.length / 60;

    // Calculate rates
    const total = this.currentMetrics.totalOperations || 1;
    this.currentMetrics.hitRate = (this.currentMetrics.hitCount / total) * 100;
    this.currentMetrics.missRate = (this.currentMetrics.missCount / total) * 100;
    this.currentMetrics.errorRate = (this.currentMetrics.errorCount / total) * 100;

    // Update top key patterns
    this.updateTopKeyPatterns();
  }

  private updateTopKeyPatterns(): void {
    this.currentMetrics.topKeyPatterns = Array.from(this.keyPatterns.entries())
      .map(([pattern, data]) => ({
        pattern,
        count: data.count,
        hitRate: data.count > 0 ? (data.hits / data.count) * 100 : 0,
        avgResponseTime: this.calculateAverage(data.responseTimes),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private updateHealthScore(): void {
    let score = 100;
    const issues: string[] = [];

    // Penalize low hit rate
    if (this.currentMetrics.hitRate < 50) {
      score -= 30;
      issues.push('Low cache hit rate');
    } else if (this.currentMetrics.hitRate < 70) {
      score -= 15;
      issues.push('Moderate cache hit rate');
    }

    // Penalize high error rate
    if (this.currentMetrics.errorRate > 10) {
      score -= 25;
      issues.push('High error rate');
    } else if (this.currentMetrics.errorRate > 5) {
      score -= 10;
      issues.push('Moderate error rate');
    }

    // Penalize slow operations
    if (this.currentMetrics.slowOperations > this.currentMetrics.totalOperations * 0.1) {
      score -= 20;
      issues.push('Many slow operations');
    }

    // Penalize high average response time
    if (this.currentMetrics.averageResponseTime > 100) {
      score -= 15;
      issues.push('High average response time');
    }

    this.currentMetrics.healthScore = Math.max(0, score);
    
    if (score >= 80) {
      this.currentMetrics.healthStatus = 'healthy';
    } else if (score >= 60) {
      this.currentMetrics.healthStatus = 'warning';
    } else {
      this.currentMetrics.healthStatus = 'critical';
    }
  }

  private createTelescopeEntry(context: CacheContext): TelescopeEntry {
    const entryId = `cache_${context.id}`;
    const familyHash = `${context.operation}:${context.keyPattern || context.key}`;

    return {
      id: entryId,
      type: 'cache',
      familyHash,
      content: {
        cache: {
          operation: context.operation,
          key: context.key,
          keyPattern: context.keyPattern,
          hit: context.hit,
          ttl: context.ttl,
          size: context.size,
          cacheInstance: context.cacheInstance,
          cacheType: context.cacheType,
        },
        execution: {
          startTime: context.startTime,
          endTime: context.endTime,
          duration: context.duration,
          result: context.result,
          error: context.error,
        },
        value: this.config.captureValues ? context.value : undefined,
        performance: context.performance,
        connection: {
          id: context.connectionId,
          host: context.host,
          port: context.port,
          database: context.database,
        },
        redis: {
          command: context.redisCommand,
          args: context.redisArgs,
        },
        correlation: {
          traceId: context.traceId,
          requestId: context.requestId,
          userId: context.userId,
          sessionId: context.sessionId,
        },
      },
      tags: this.generateTags(context),
      timestamp: context.timestamp,
      sequence: context.timestamp.getTime(),
    };
  }

  private generateTags(context: CacheContext): string[] {
    const tags: string[] = [
      'cache',
      `operation:${context.operation}`,
      `result:${context.error ? 'error' : context.hit ? 'hit' : 'miss'}`,
    ];

    if (context.cacheInstance) {
      tags.push(`instance:${context.cacheInstance}`);
    }

    if (context.cacheType) {
      tags.push(`type:${context.cacheType}`);
    }

    if (context.duration && context.duration > this.config.slowOperationThreshold) {
      tags.push('slow');
    }

    if (context.keyPattern) {
      tags.push(`pattern:${context.keyPattern}`);
    }

    return tags;
  }

  private checkAlerts(context: CacheContext): void {
    if (!this.config.enableRealTimeAlerts) {
      return;
    }

    // Check hit rate
    if (this.currentMetrics.hitRate < this.config.alertThresholds.hitRate) {
      this.createAlert({
        type: 'hit_rate',
        severity: 'medium',
        message: `Cache hit rate below threshold: ${this.currentMetrics.hitRate.toFixed(1)}%`,
        data: { hitRate: this.currentMetrics.hitRate, threshold: this.config.alertThresholds.hitRate },
        cacheInstance: context.cacheInstance,
      });
    }

    // Check miss rate
    if (this.currentMetrics.missRate > this.config.alertThresholds.missRate) {
      this.createAlert({
        type: 'miss_rate',
        severity: 'medium',
        message: `Cache miss rate above threshold: ${this.currentMetrics.missRate.toFixed(1)}%`,
        data: { missRate: this.currentMetrics.missRate, threshold: this.config.alertThresholds.missRate },
        cacheInstance: context.cacheInstance,
      });
    }

    // Check error rate
    if (this.currentMetrics.errorRate > this.config.alertThresholds.errorRate) {
      this.createAlert({
        type: 'error_rate',
        severity: 'high',
        message: `Cache error rate above threshold: ${this.currentMetrics.errorRate.toFixed(1)}%`,
        data: { errorRate: this.currentMetrics.errorRate, threshold: this.config.alertThresholds.errorRate },
        cacheInstance: context.cacheInstance,
      });
    }

    // Check slow operations
    if (context.duration && context.duration > this.config.alertThresholds.avgResponseTime) {
      this.createAlert({
        type: 'slow_operations',
        severity: 'medium',
        message: `Slow cache operation: ${context.operation} ${context.key} took ${context.duration}ms`,
        data: { duration: context.duration, threshold: this.config.alertThresholds.avgResponseTime },
        cacheInstance: context.cacheInstance,
      });
    }
  }

  private createAlert(alert: Omit<CacheAlert, 'id' | 'timestamp' | 'acknowledged'>): void {
    const fullAlert: CacheAlert = {
      id: `cache_alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      acknowledged: false,
      ...alert,
    };

    this.alertHistory.push(fullAlert);
    this.alertsSubject.next(fullAlert);

    this.logger.warn(`Cache alert: ${fullAlert.message}`, fullAlert.data);
  }

  private correlateCache(context: CacheContext): void {
    // Correlation implementation would link cache operations with requests, queries, and jobs
    if (context.traceId) {
      this.logger.debug(`Correlated cache operation ${context.operation} with trace ${context.traceId}`);
    }
  }

  private startPeriodicProcessing(): void {
    // Update metrics and trends every 30 seconds
    interval(30000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.updateTrends();
        this.cleanupOldData();
        this.metricsSubject.next({ ...this.currentMetrics });
      });
  }

  private updateTrends(): void {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    this.currentMetrics.trends.lastHour = this.calculateTrend(oneHourAgo);
    this.currentMetrics.trends.lastDay = this.calculateTrend(oneDayAgo);
    this.currentMetrics.trends.lastWeek = this.calculateTrend(oneWeekAgo);
  }

  private calculateTrend(since: number): CacheTrendData {
    const operations = this.cacheHistory.filter(cache => cache.timestamp.getTime() > since);
    const hits = operations.filter(op => op.hit && !op.error);
    const misses = operations.filter(op => !op.hit && !op.error);
    const errors = operations.filter(op => op.error);
    const responseTimes = operations.filter(op => op.duration).map(op => op.duration!);

    const totalOps = operations.length;
    const hitRate = totalOps > 0 ? (hits.length / totalOps) * 100 : 0;

    return {
      totalOperations: totalOps,
      hitCount: hits.length,
      missCount: misses.length,
      errorCount: errors.length,
      averageResponseTime: this.calculateAverage(responseTimes),
      hitRate,
      change: 0, // Would need historical data
      changePercent: 0,
      peak: responseTimes.length > 0 ? Math.max(...responseTimes) : 0,
    };
  }

  private cleanupOldData(): void {
    const now = Date.now();
    const retentionDate = new Date(now - this.config.retentionPeriod);

    // Clean up cache history
    this.cacheHistory = this.cacheHistory.filter(cache => cache.timestamp > retentionDate);

    // Clean up alert history
    this.alertHistory = this.alertHistory.filter(alert => alert.timestamp > retentionDate);

    // Clean up response times (keep last 1000)
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-1000);
    }

    // Clean up key patterns (keep top 100)
    if (this.keyPatterns.size > 100) {
      const sorted = Array.from(this.keyPatterns.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 100);
      
      this.keyPatterns.clear();
      sorted.forEach(([pattern, data]) => {
        this.keyPatterns.set(pattern, data);
      });
    }
  }

  // Public API
  getMetrics(): CacheMetrics {
    return { ...this.currentMetrics };
  }

  getMetricsStream(): Observable<CacheMetrics> {
    return this.metricsSubject.asObservable().pipe(shareReplay(1));
  }

  getAlertsStream(): Observable<CacheAlert> {
    return this.alertsSubject.asObservable();
  }

  getCacheStream(): Observable<CacheContext> {
    return this.cacheContextSubject.asObservable();
  }

  getRecentOperations(limit: number = 100): CacheContext[] {
    return this.cacheHistory.slice(-limit).reverse();
  }

  getOperationsByType(operation: CacheOperation, limit: number = 100): CacheContext[] {
    return this.cacheHistory
      .filter(cache => cache.operation === operation)
      .slice(-limit)
      .reverse();
  }

  getOperationsByKeyPattern(pattern: string, limit: number = 100): CacheContext[] {
    return this.cacheHistory
      .filter(cache => cache.keyPattern === pattern)
      .slice(-limit)
      .reverse();
  }

  getCacheHealth(instance?: string): CacheHealth | CacheHealth[] {
    if (instance) {
      return this.calculateCacheHealth(instance);
    }

    const instances = new Set(
      this.cacheHistory
        .map(cache => cache.cacheInstance)
        .filter(Boolean)
    );

    return Array.from(instances).map(inst => this.calculateCacheHealth(inst!));
  }

  private calculateCacheHealth(instance: string): CacheHealth {
    const instanceOperations = this.cacheHistory.filter(cache => cache.cacheInstance === instance);
    const totalOps = instanceOperations.length;
    const hits = instanceOperations.filter(op => op.hit && !op.error).length;
    const errors = instanceOperations.filter(op => op.error).length;
    const responseTimes = instanceOperations.filter(op => op.duration).map(op => op.duration!);

    const hitRate = totalOps > 0 ? (hits / totalOps) * 100 : 0;
    const errorRate = totalOps > 0 ? (errors / totalOps) * 100 : 0;
    const avgResponseTime = this.calculateAverage(responseTimes);

    let score = 100;
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (hitRate < 70) {
      score -= 25;
      issues.push('Low hit rate');
      recommendations.push('Review cache keys and TTL settings');
    }

    if (errorRate > 5) {
      score -= 20;
      issues.push('High error rate');
      recommendations.push('Check cache server health and connectivity');
    }

    if (avgResponseTime > 50) {
      score -= 15;
      issues.push('High response time');
      recommendations.push('Optimize cache server performance or add replicas');
    }

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (score < 60) {
      status = 'critical';
    } else if (score < 80) {
      status = 'warning';
    }

    return {
      instance,
      status,
      score,
      issues,
      recommendations,
      metrics: {
        hitRate,
        errorRate,
        avgResponseTime,
        memoryUsage: 0, // Would need Redis INFO command
        connectionCount: 0, // Would need Redis INFO command
      },
    };
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alertHistory.find(a => a.id === alertId);
    if (!alert) return false;

    alert.acknowledged = true;
    return true;
  }

  getConfig(): CacheWatcherConfig {
    return { ...this.config };
  }

  // Redis Integration Methods
  private async setupRedisIntegration(): Promise<void> {
    if (!this.config.redisIntegration?.enabled) {
      return;
    }

    try {
      // Use provided Redis clients or discover them
      if (this.redisClientInstances) {
        for (const [name, client] of this.redisClientInstances) {
          this.redisClients.set(name, client);
          await this.setupRedisMonitoring(name, client);
        }
      } else if (this.config.redisIntegration.autoDiscoverInstances) {
        await this.discoverRedisInstances();
      }

      this.logger.log(`Redis integration setup complete: ${this.redisClients.size} instances`);
    } catch (error) {
      this.logger.error('Failed to setup Redis integration:', error);
    }
  }

  private async discoverRedisInstances(): Promise<void> {
    // Auto-discovery logic for Redis instances
    const defaultHosts = [
      { host: 'localhost', port: 6379, name: 'default' },
      { host: '127.0.0.1', port: 6379, name: 'local' },
    ];

    for (const config of defaultHosts) {
      try {
        const client = new Redis(config.port, config.host, {
          enableReadyCheck: false,
          maxRetriesPerRequest: 1,
        });

        await client.ping();
        this.redisClients.set(config.name, client);
        await this.setupRedisMonitoring(config.name, client);
        this.logger.log(`Discovered Redis instance: ${config.name} at ${config.host}:${config.port}`);
      } catch (error) {
        this.logger.debug(`Failed to connect to Redis at ${config.host}:${config.port}`);
      }
    }
  }

  private async setupRedisMonitoring(name: string, client: Redis): Promise<void> {
    try {
      // Get Redis info
      const info = await client.info();
      this.redisInfo.set(name, this.parseRedisInfo(info));

      // Monitor Redis events
      client.on('connect', () => {
        this.logger.log(`Redis ${name} connected`);
      });

      client.on('error', (error) => {
        this.logger.error(`Redis ${name} error:`, error);
        this.createAlert({
          type: 'connection_limit',
          severity: 'high',
          message: `Redis ${name} connection error: ${error.message}`,
          data: { instance: name, error: error.message },
          cacheInstance: name,
        });
      });

      client.on('reconnecting', () => {
        this.logger.warn(`Redis ${name} reconnecting`);
      });

      // Monitor commands if supported
      if (this.config.redisIntegration?.monitorCommands) {
        await this.setupRedisCommandMonitoring(name, client);
      }

    } catch (error) {
      this.logger.error(`Failed to setup monitoring for Redis ${name}:`, error);
    }
  }

  private async setupRedisCommandMonitoring(name: string, client: Redis): Promise<void> {
    // Note: Command monitoring would require Redis MONITOR command
    // This is a simplified implementation
    try {
      const originalSendCommand = client.sendCommand.bind(client);
      
      client.sendCommand = (command: any, stream?: any) => {
        const startTime = Date.now();
        const context: Partial<CacheContext> = {
          id: `redis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
          operation: this.mapRedisCommandToOperation(command.name),
          key: command.args?.[0] || 'unknown',
          startTime: new Date(),
          cacheInstance: name,
          cacheType: 'redis',
          redisCommand: command.name,
          redisArgs: command.args,
        };

        const result = originalSendCommand(command, stream);
        
        if (result && typeof result.then === 'function') {
          result
            .then((res: any) => {
              context.endTime = new Date();
              context.duration = Date.now() - startTime;
              context.hit = res !== null && res !== undefined;
              context.result = res;
              this.trackCacheOperation(context as CacheContext);
            })
            .catch((error: any) => {
              context.endTime = new Date();
              context.duration = Date.now() - startTime;
              context.hit = false;
              context.error = error;
              this.trackCacheOperation(context as CacheContext);
            });
        }

        return result;
      };

    } catch (error) {
      this.logger.error(`Failed to setup command monitoring for Redis ${name}:`, error);
    }
  }

  private mapRedisCommandToOperation(command: string): CacheOperation {
    const cmd = command.toLowerCase();
    switch (cmd) {
      case 'get': return CacheOperation.GET;
      case 'set': return CacheOperation.SET;
      case 'del': return CacheOperation.DEL;
      case 'exists': return CacheOperation.EXISTS;
      case 'expire': return CacheOperation.EXPIRE;
      case 'ttl': return CacheOperation.TTL;
      case 'incr': return CacheOperation.INCR;
      case 'decr': return CacheOperation.DECR;
      case 'lpush': case 'rpush': return CacheOperation.PUSH;
      case 'lpop': case 'rpop': return CacheOperation.POP;
      case 'flushdb': return CacheOperation.FLUSH;
      case 'flushall': return CacheOperation.FLUSHALL;
      case 'keys': return CacheOperation.KEYS;
      case 'scan': return CacheOperation.SCAN;
      case 'mget': return CacheOperation.MGET;
      case 'mset': return CacheOperation.MSET;
      case 'hget': return CacheOperation.HGET;
      case 'hset': return CacheOperation.HSET;
      case 'hdel': return CacheOperation.HDEL;
      case 'sadd': return CacheOperation.SADD;
      case 'srem': return CacheOperation.SREM;
      case 'zadd': return CacheOperation.ZADD;
      case 'zrem': return CacheOperation.ZREM;
      case 'publish': return CacheOperation.PUBLISH;
      case 'subscribe': return CacheOperation.SUBSCRIBE;
      case 'unsubscribe': return CacheOperation.UNSUBSCRIBE;
      default: return CacheOperation.OTHER;
    }
  }

  private parseRedisInfo(info: string): any {
    const parsed: any = {};
    const sections = info.split('\r\n\r\n');
    
    for (const section of sections) {
      const lines = section.split('\r\n');
      const sectionName = lines[0]?.replace('# ', '');
      
      if (sectionName) {
        parsed[sectionName] = {};
        
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (line && line.includes(':')) {
            const [key, value] = line.split(':');
            parsed[sectionName][key] = isNaN(Number(value)) ? value : Number(value);
          }
        }
      }
    }
    
    return parsed;
  }

  private startRedisMonitoring(): void {
    if (!this.config.redisIntegration?.enabled) {
      return;
    }

    // Update Redis info every 60 seconds
    interval(60000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(async () => {
        await this.updateRedisInfo();
      });
  }

  private async updateRedisInfo(): Promise<void> {
    for (const [name, client] of this.redisClients) {
      try {
        const info = await client.info();
        const parsed = this.parseRedisInfo(info);
        this.redisInfo.set(name, parsed);
        
        // Update metrics with Redis-specific data
        this.updateRedisMetrics(name, parsed);
        
      } catch (error) {
        this.logger.error(`Failed to get Redis info for ${name}:`, error);
      }
    }
  }

  private updateRedisMetrics(instanceName: string, redisInfo: any): void {
    if (!this.currentMetrics.redisInfo) {
      this.currentMetrics.redisInfo = {
        version: '',
        uptime: 0,
        memory: { used: 0, peak: 0, fragmentation: 0 },
        stats: { commands: 0, connections: 0, keyspaceHits: 0, keyspaceMisses: 0 },
        clients: { connected: 0, blocked: 0, tracking: 0 },
      };
    }

    if (redisInfo.Server) {
      this.currentMetrics.redisInfo.version = redisInfo.Server.redis_version || '';
      this.currentMetrics.redisInfo.uptime = redisInfo.Server.uptime_in_seconds || 0;
    }

    if (redisInfo.Memory) {
      this.currentMetrics.redisInfo.memory.used = redisInfo.Memory.used_memory || 0;
      this.currentMetrics.redisInfo.memory.peak = redisInfo.Memory.used_memory_peak || 0;
      this.currentMetrics.redisInfo.memory.fragmentation = redisInfo.Memory.mem_fragmentation_ratio || 0;
    }

    if (redisInfo.Stats) {
      this.currentMetrics.redisInfo.stats.commands = redisInfo.Stats.total_commands_processed || 0;
      this.currentMetrics.redisInfo.stats.connections = redisInfo.Stats.total_connections_received || 0;
      this.currentMetrics.redisInfo.stats.keyspaceHits = redisInfo.Stats.keyspace_hits || 0;
      this.currentMetrics.redisInfo.stats.keyspaceMisses = redisInfo.Stats.keyspace_misses || 0;
    }

    if (redisInfo.Clients) {
      this.currentMetrics.redisInfo.clients.connected = redisInfo.Clients.connected_clients || 0;
      this.currentMetrics.redisInfo.clients.blocked = redisInfo.Clients.blocked_clients || 0;
      this.currentMetrics.redisInfo.clients.tracking = redisInfo.Clients.tracking_clients || 0;
    }

    // Update connection pool metrics
    this.currentMetrics.connectionPool.active = this.currentMetrics.redisInfo.clients.connected;
    this.currentMetrics.activeConnections = this.currentMetrics.redisInfo.clients.connected;

    // Check for alerts based on Redis metrics
    this.checkRedisAlerts(instanceName, redisInfo);
  }

  private checkRedisAlerts(instanceName: string, redisInfo: any): void {
    // Check memory usage
    if (redisInfo.Memory?.used_memory) {
      const memoryUsageMB = redisInfo.Memory.used_memory / (1024 * 1024);
      const memoryThreshold = this.config.alertThresholds.memoryUsage || 100; // Default 100MB
      
      if (memoryUsageMB > memoryThreshold) {
        this.createAlert({
          type: 'memory_usage',
          severity: memoryUsageMB > memoryThreshold * 2 ? 'critical' : 'high',
          message: `Redis ${instanceName} memory usage: ${memoryUsageMB.toFixed(1)}MB`,
          data: { memoryUsage: memoryUsageMB, threshold: memoryThreshold },
          cacheInstance: instanceName,
        });
      }
    }

    // Check connection count
    if (redisInfo.Clients?.connected_clients) {
      const connectionThreshold = this.config.alertThresholds.connectionCount || 100;
      
      if (redisInfo.Clients.connected_clients > connectionThreshold) {
        this.createAlert({
          type: 'connection_limit',
          severity: 'medium',
          message: `Redis ${instanceName} high connection count: ${redisInfo.Clients.connected_clients}`,
          data: { connections: redisInfo.Clients.connected_clients, threshold: connectionThreshold },
          cacheInstance: instanceName,
        });
      }
    }

    // Check fragmentation ratio
    if (redisInfo.Memory?.mem_fragmentation_ratio) {
      const fragmentation = redisInfo.Memory.mem_fragmentation_ratio;
      
      if (fragmentation > 1.5) {
        this.createAlert({
          type: 'memory_usage',
          severity: fragmentation > 2.0 ? 'high' : 'medium',
          message: `Redis ${instanceName} high memory fragmentation: ${fragmentation.toFixed(2)}`,
          data: { fragmentation, threshold: 1.5 },
          cacheInstance: instanceName,
        });
      }
    }
  }

  private cleanupRedisConnections(): void {
    for (const [name, client] of this.redisClients) {
      try {
        client.disconnect();
        this.logger.log(`Disconnected from Redis ${name}`);
      } catch (error) {
        this.logger.error(`Failed to disconnect from Redis ${name}:`, error);
      }
    }
    this.redisClients.clear();
  }

  // Enhanced Public API
  getRedisInfo(instanceName?: string): any {
    if (instanceName) {
      return this.redisInfo.get(instanceName);
    }
    return Object.fromEntries(this.redisInfo);
  }

  getRedisHealth(): Array<{ instance: string; status: string; info: any }> {
    return Array.from(this.redisInfo.entries()).map(([instance, info]) => ({
      instance,
      status: this.calculateRedisHealth(info),
      info,
    }));
  }

  private calculateRedisHealth(info: any): string {
    let score = 100;
    
    // Check memory fragmentation
    if (info.Memory?.mem_fragmentation_ratio > 2.0) {
      score -= 30;
    } else if (info.Memory?.mem_fragmentation_ratio > 1.5) {
      score -= 15;
    }
    
    // Check connection utilization
    const connections = info.Clients?.connected_clients || 0;
    if (connections > 80) {
      score -= 20;
    }
    
    // Check keyspace hit rate
    const hits = info.Stats?.keyspace_hits || 0;
    const misses = info.Stats?.keyspace_misses || 0;
    const hitRate = hits + misses > 0 ? (hits / (hits + misses)) * 100 : 100;
    
    if (hitRate < 70) {
      score -= 25;
    }
    
    if (score >= 80) return 'healthy';
    if (score >= 60) return 'warning';
    return 'critical';
  }

  async getKeyspaceInfo(instanceName?: string): Promise<any> {
    if (instanceName && this.redisClients.has(instanceName)) {
      const client = this.redisClients.get(instanceName)!;
      try {
        const info = await client.info('keyspace');
        return this.parseRedisInfo(info);
      } catch (error) {
        this.logger.error(`Failed to get keyspace info for ${instanceName}:`, error);
        return null;
      }
    }
    
    const results: any = {};
    for (const [name, client] of this.redisClients) {
      try {
        const info = await client.info('keyspace');
        results[name] = this.parseRedisInfo(info);
      } catch (error) {
        this.logger.error(`Failed to get keyspace info for ${name}:`, error);
      }
    }
    
    return results;
  }
}
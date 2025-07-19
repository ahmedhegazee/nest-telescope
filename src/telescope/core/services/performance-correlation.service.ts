import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Observable, Subject, combineLatest, interval } from 'rxjs';
import { map, filter, shareReplay, takeUntil } from 'rxjs/operators';
import { TelescopeService } from './telescope.service';

export interface CorrelationContext {
  traceId: string;
  requestId?: string;
  userId?: string;
  sessionId?: string;
  timestamp: Date;
  
  // Watcher data
  request?: any;
  query?: any;
  exception?: any;
  job?: any;
  cache?: any;
  
  // Performance metrics
  performance: {
    totalDuration: number;
    requestDuration?: number;
    queryDuration?: number;
    cacheDuration?: number;
    jobDuration?: number;
    
    // Resource usage
    memoryUsage?: number;
    cpuUsage?: number;
    
    // Counts
    queryCount: number;
    cacheOperations: number;
    jobsTriggered: number;
    exceptionsThrown: number;
  };
  
  // Analysis
  bottlenecks: BottleneckAnalysis[];
  recommendations: string[];
  healthScore: number;
}

export interface BottleneckAnalysis {
  type: 'query' | 'cache' | 'job' | 'exception' | 'network' | 'cpu' | 'memory';
  severity: 'low' | 'medium' | 'high' | 'critical';
  component: string;
  duration: number;
  percentage: number;
  description: string;
  recommendation: string;
}

export interface PerformanceMetrics {
  totalRequests: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  errorRate: number;
  
  // Component breakdown
  components: {
    database: {
      averageTime: number;
      slowQueries: number;
      connectionIssues: number;
    };
    cache: {
      averageTime: number;
      hitRate: number;
      missRate: number;
      errorRate: number;
    };
    jobs: {
      averageTime: number;
      failureRate: number;
      queueBacklog: number;
    };
    exceptions: {
      rate: number;
      criticalCount: number;
      averageImpact: number;
    };
  };
  
  // Correlation insights
  correlations: {
    queryToResponse: number;
    cacheToResponse: number;
    jobToResponse: number;
    exceptionToResponse: number;
    memoryToResponse: number;
    cpuToResponse: number;
  };
  
  // Trends
  trends: {
    responseTime: { current: number; change: number; trend: 'up' | 'down' | 'stable' };
    errorRate: { current: number; change: number; trend: 'up' | 'down' | 'stable' };
    throughput: { current: number; change: number; trend: 'up' | 'down' | 'stable' };
  };
}

export interface PerformanceAlert {
  id: string;
  type: 'bottleneck' | 'degradation' | 'anomaly' | 'threshold';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  traceId?: string;
  component: string;
  metrics: any;
  recommendations: string[];
  acknowledged: boolean;
}

@Injectable()
export class PerformanceCorrelationService implements OnModuleInit {
  private readonly logger = new Logger(PerformanceCorrelationService.name);
  private readonly destroy$ = new Subject<void>();
  
  private correlationHistory: CorrelationContext[] = [];
  private performanceMetrics: PerformanceMetrics = this.initializeMetrics();
  private alertHistory: PerformanceAlert[] = [];
  
  private readonly correlationSubject = new Subject<CorrelationContext>();
  private readonly metricsSubject = new Subject<PerformanceMetrics>();
  private readonly alertsSubject = new Subject<PerformanceAlert>();
  
  // Correlation storage
  private activeTraces = new Map<string, {
    context: Partial<CorrelationContext>;
    watchers: Set<string>;
    startTime: Date;
  }>();
  
  private responseTimeHistory: number[] = [];
  private correlationCoefficients = new Map<string, number>();
  
  constructor(private readonly telescopeService: TelescopeService) {}

  async onModuleInit(): Promise<void> {
    this.startPeriodicProcessing();
    this.logger.log('Performance correlation service initialized');
  }

  private initializeMetrics(): PerformanceMetrics {
    return {
      totalRequests: 0,
      averageResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      errorRate: 0,
      components: {
        database: {
          averageTime: 0,
          slowQueries: 0,
          connectionIssues: 0,
        },
        cache: {
          averageTime: 0,
          hitRate: 0,
          missRate: 0,
          errorRate: 0,
        },
        jobs: {
          averageTime: 0,
          failureRate: 0,
          queueBacklog: 0,
        },
        exceptions: {
          rate: 0,
          criticalCount: 0,
          averageImpact: 0,
        },
      },
      correlations: {
        queryToResponse: 0,
        cacheToResponse: 0,
        jobToResponse: 0,
        exceptionToResponse: 0,
        memoryToResponse: 0,
        cpuToResponse: 0,
      },
      trends: {
        responseTime: { current: 0, change: 0, trend: 'stable' },
        errorRate: { current: 0, change: 0, trend: 'stable' },
        throughput: { current: 0, change: 0, trend: 'stable' },
      },
    };
  }

  correlateWatcherData(
    watcherType: 'request' | 'query' | 'exception' | 'job' | 'cache',
    data: any
  ): void {
    const traceId = this.extractTraceId(data);
    if (!traceId) return;

    let trace = this.activeTraces.get(traceId);
    if (!trace) {
      trace = {
        context: {
          traceId,
          requestId: data.requestId,
          userId: data.userId,
          sessionId: data.sessionId,
          timestamp: new Date(),
          performance: {
            totalDuration: 0,
            queryCount: 0,
            cacheOperations: 0,
            jobsTriggered: 0,
            exceptionsThrown: 0,
          },
          bottlenecks: [],
          recommendations: [],
          healthScore: 100,
        },
        watchers: new Set(),
        startTime: new Date(),
      };
      this.activeTraces.set(traceId, trace);
    }

    // Update trace with watcher data
    trace.watchers.add(watcherType);
    this.updateTraceWithWatcherData(trace.context, watcherType, data);

    // Check if trace is complete (has request data and is older than 5 seconds)
    const isComplete = trace.watchers.has('request') && 
                      (Date.now() - trace.startTime.getTime()) > 5000;

    if (isComplete) {
      this.finalizeCorrelation(trace.context as CorrelationContext);
      this.activeTraces.delete(traceId);
    }
  }

  private extractTraceId(data: any): string | null {
    return data.traceId || data.correlation?.traceId || null;
  }

  private updateTraceWithWatcherData(
    context: Partial<CorrelationContext>,
    watcherType: string,
    data: any
  ): void {
    switch (watcherType) {
      case 'request':
        context.request = data;
        if (data.duration) {
          context.performance!.requestDuration = data.duration;
          context.performance!.totalDuration = data.duration;
        }
        break;

      case 'query':
        if (!context.query) context.query = [];
        context.query.push(data);
        context.performance!.queryCount++;
        if (data.duration) {
          context.performance!.queryDuration = 
            (context.performance!.queryDuration || 0) + data.duration;
        }
        break;

      case 'cache':
        if (!context.cache) context.cache = [];
        context.cache.push(data);
        context.performance!.cacheOperations++;
        if (data.duration) {
          context.performance!.cacheDuration = 
            (context.performance!.cacheDuration || 0) + data.duration;
        }
        break;

      case 'job':
        if (!context.job) context.job = [];
        context.job.push(data);
        context.performance!.jobsTriggered++;
        if (data.duration) {
          context.performance!.jobDuration = 
            (context.performance!.jobDuration || 0) + data.duration;
        }
        break;

      case 'exception':
        if (!context.exception) context.exception = [];
        context.exception.push(data);
        context.performance!.exceptionsThrown++;
        break;
    }

    // Update resource usage
    if (data.performance?.memoryUsage) {
      context.performance!.memoryUsage = Math.max(
        context.performance!.memoryUsage || 0,
        data.performance.memoryUsage
      );
    }

    if (data.performance?.cpuUsage) {
      context.performance!.cpuUsage = Math.max(
        context.performance!.cpuUsage || 0,
        data.performance.cpuUsage
      );
    }
  }

  private finalizeCorrelation(context: CorrelationContext): void {
    // Analyze bottlenecks
    context.bottlenecks = this.analyzeBottlenecks(context);
    
    // Generate recommendations
    context.recommendations = this.generateRecommendations(context);
    
    // Calculate health score
    context.healthScore = this.calculateHealthScore(context);
    
    // Add to history
    this.correlationHistory.push(context);
    
    // Update metrics
    this.updatePerformanceMetrics(context);
    
    // Check for alerts
    this.checkPerformanceAlerts(context);
    
    // Emit correlation
    this.correlationSubject.next(context);
    
    this.logger.debug(`Correlated trace ${context.traceId} with ${context.bottlenecks.length} bottlenecks`);
  }

  private analyzeBottlenecks(context: CorrelationContext): BottleneckAnalysis[] {
    const bottlenecks: BottleneckAnalysis[] = [];
    const totalDuration = context.performance.totalDuration;

    if (totalDuration === 0) return bottlenecks;

    // Analyze query bottlenecks
    if (context.performance.queryDuration) {
      const percentage = (context.performance.queryDuration / totalDuration) * 100;
      if (percentage > 30) {
        bottlenecks.push({
          type: 'query',
          severity: percentage > 70 ? 'critical' : percentage > 50 ? 'high' : 'medium',
          component: 'database',
          duration: context.performance.queryDuration,
          percentage,
          description: `Database queries took ${context.performance.queryDuration}ms (${percentage.toFixed(1)}% of total)`,
          recommendation: 'Consider optimizing slow queries, adding indexes, or implementing query caching',
        });
      }
    }

    // Analyze cache bottlenecks
    if (context.performance.cacheDuration) {
      const percentage = (context.performance.cacheDuration / totalDuration) * 100;
      if (percentage > 20) {
        bottlenecks.push({
          type: 'cache',
          severity: percentage > 40 ? 'high' : 'medium',
          component: 'cache',
          duration: context.performance.cacheDuration,
          percentage,
          description: `Cache operations took ${context.performance.cacheDuration}ms (${percentage.toFixed(1)}% of total)`,
          recommendation: 'Check cache server performance and consider Redis optimization',
        });
      }
    }

    // Analyze job bottlenecks
    if (context.performance.jobDuration) {
      const percentage = (context.performance.jobDuration / totalDuration) * 100;
      if (percentage > 10) {
        bottlenecks.push({
          type: 'job',
          severity: percentage > 30 ? 'high' : 'medium',
          component: 'jobs',
          duration: context.performance.jobDuration,
          percentage,
          description: `Job processing took ${context.performance.jobDuration}ms (${percentage.toFixed(1)}% of total)`,
          recommendation: 'Consider async job processing or worker scaling',
        });
      }
    }

    // Analyze exception impact
    if (context.performance.exceptionsThrown > 0) {
      bottlenecks.push({
        type: 'exception',
        severity: context.performance.exceptionsThrown > 5 ? 'critical' : 'high',
        component: 'exceptions',
        duration: 0,
        percentage: 0,
        description: `${context.performance.exceptionsThrown} exceptions thrown during request`,
        recommendation: 'Fix exceptions to improve performance and reliability',
      });
    }

    // Analyze memory usage
    if (context.performance.memoryUsage && context.performance.memoryUsage > 100 * 1024 * 1024) { // 100MB
      bottlenecks.push({
        type: 'memory',
        severity: context.performance.memoryUsage > 500 * 1024 * 1024 ? 'high' : 'medium',
        component: 'memory',
        duration: 0,
        percentage: 0,
        description: `High memory usage: ${(context.performance.memoryUsage / 1024 / 1024).toFixed(1)}MB`,
        recommendation: 'Investigate memory leaks and optimize memory usage',
      });
    }

    return bottlenecks.sort((a, b) => b.percentage - a.percentage);
  }

  private generateRecommendations(context: CorrelationContext): string[] {
    const recommendations: string[] = [];

    // Extract recommendations from bottlenecks
    context.bottlenecks.forEach(bottleneck => {
      if (!recommendations.includes(bottleneck.recommendation)) {
        recommendations.push(bottleneck.recommendation);
      }
    });

    // Add general recommendations
    if (context.performance.queryCount > 10) {
      recommendations.push('Consider implementing query batching or reducing N+1 queries');
    }

    if (context.performance.cacheOperations > 20) {
      recommendations.push('Review cache strategy and consider cache warming');
    }

    if (context.performance.totalDuration > 5000) {
      recommendations.push('Request took longer than 5 seconds - consider async processing');
    }

    return recommendations;
  }

  private calculateHealthScore(context: CorrelationContext): number {
    let score = 100;

    // Penalize based on bottlenecks
    context.bottlenecks.forEach(bottleneck => {
      switch (bottleneck.severity) {
        case 'critical':
          score -= 30;
          break;
        case 'high':
          score -= 20;
          break;
        case 'medium':
          score -= 10;
          break;
        case 'low':
          score -= 5;
          break;
      }
    });

    // Penalize exceptions
    score -= context.performance.exceptionsThrown * 5;

    // Penalize long response times
    if (context.performance.totalDuration > 10000) {
      score -= 25;
    } else if (context.performance.totalDuration > 5000) {
      score -= 15;
    } else if (context.performance.totalDuration > 2000) {
      score -= 10;
    }

    return Math.max(0, score);
  }

  private updatePerformanceMetrics(context: CorrelationContext): void {
    this.performanceMetrics.totalRequests++;
    
    // Update response time metrics
    if (context.performance.totalDuration) {
      this.responseTimeHistory.push(context.performance.totalDuration);
      this.performanceMetrics.averageResponseTime = this.calculateAverage(this.responseTimeHistory);
      
      // Calculate percentiles
      const sorted = [...this.responseTimeHistory].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      const p99Index = Math.floor(sorted.length * 0.99);
      
      this.performanceMetrics.p95ResponseTime = sorted[p95Index] || 0;
      this.performanceMetrics.p99ResponseTime = sorted[p99Index] || 0;
    }

    // Update error rate
    const errorCount = this.correlationHistory.filter(c => c.performance.exceptionsThrown > 0).length;
    this.performanceMetrics.errorRate = (errorCount / this.performanceMetrics.totalRequests) * 100;

    // Update component metrics
    this.updateComponentMetrics(context);
    
    // Update correlations
    this.updateCorrelations();
    
    // Update trends
    this.updateTrends();
  }

  private updateComponentMetrics(context: CorrelationContext): void {
    // Database metrics
    if (context.performance.queryDuration) {
      const dbTimes = this.correlationHistory
        .filter(c => c.performance.queryDuration)
        .map(c => c.performance.queryDuration!);
      
      this.performanceMetrics.components.database.averageTime = this.calculateAverage(dbTimes);
      this.performanceMetrics.components.database.slowQueries = 
        dbTimes.filter(t => t > 1000).length;
    }

    // Cache metrics
    if (context.performance.cacheDuration) {
      const cacheTimes = this.correlationHistory
        .filter(c => c.performance.cacheDuration)
        .map(c => c.performance.cacheDuration!);
      
      this.performanceMetrics.components.cache.averageTime = this.calculateAverage(cacheTimes);
      
      // Calculate hit rate (would need actual cache hit/miss data)
      const cacheOperations = this.correlationHistory
        .map(c => c.performance.cacheOperations)
        .reduce((sum, ops) => sum + ops, 0);
      
      // Estimate based on performance (faster operations likely hits)
      const fastCacheOps = cacheTimes.filter(t => t < 10).length;
      this.performanceMetrics.components.cache.hitRate = 
        cacheOperations > 0 ? (fastCacheOps / cacheTimes.length) * 100 : 0;
    }

    // Job metrics
    if (context.performance.jobDuration) {
      const jobTimes = this.correlationHistory
        .filter(c => c.performance.jobDuration)
        .map(c => c.performance.jobDuration!);
      
      this.performanceMetrics.components.jobs.averageTime = this.calculateAverage(jobTimes);
    }

    // Exception metrics
    const totalExceptions = this.correlationHistory
      .map(c => c.performance.exceptionsThrown)
      .reduce((sum, count) => sum + count, 0);
    
    this.performanceMetrics.components.exceptions.rate = 
      (totalExceptions / this.performanceMetrics.totalRequests) * 100;
  }

  private updateCorrelations(): void {
    // Calculate correlation coefficients between components and response time
    const responseTimes = this.correlationHistory.map(c => c.performance.totalDuration);
    const queryTimes = this.correlationHistory.map(c => c.performance.queryDuration || 0);
    const cacheTimes = this.correlationHistory.map(c => c.performance.cacheDuration || 0);
    const jobTimes = this.correlationHistory.map(c => c.performance.jobDuration || 0);
    const exceptionCounts = this.correlationHistory.map(c => c.performance.exceptionsThrown);
    const memoryUsage = this.correlationHistory.map(c => c.performance.memoryUsage || 0);

    this.performanceMetrics.correlations.queryToResponse = 
      this.calculateCorrelation(queryTimes, responseTimes);
    this.performanceMetrics.correlations.cacheToResponse = 
      this.calculateCorrelation(cacheTimes, responseTimes);
    this.performanceMetrics.correlations.jobToResponse = 
      this.calculateCorrelation(jobTimes, responseTimes);
    this.performanceMetrics.correlations.exceptionToResponse = 
      this.calculateCorrelation(exceptionCounts, responseTimes);
    this.performanceMetrics.correlations.memoryToResponse = 
      this.calculateCorrelation(memoryUsage, responseTimes);
  }

  private calculateCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) return 0;

    const meanX = this.calculateAverage(x);
    const meanY = this.calculateAverage(y);
    
    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < x.length; i++) {
      const deltaX = x[i] - meanX;
      const deltaY = y[i] - meanY;
      
      numerator += deltaX * deltaY;
      denomX += deltaX * deltaX;
      denomY += deltaY * deltaY;
    }

    const denominator = Math.sqrt(denomX * denomY);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  private updateTrends(): void {
    // Calculate trends based on recent history
    const recent = this.correlationHistory.slice(-100); // Last 100 requests
    const older = this.correlationHistory.slice(-200, -100); // Previous 100 requests

    if (recent.length > 0 && older.length > 0) {
      const recentAvgResponse = this.calculateAverage(recent.map(c => c.performance.totalDuration));
      const olderAvgResponse = this.calculateAverage(older.map(c => c.performance.totalDuration));
      
      const responseChange = recentAvgResponse - olderAvgResponse;
      const responseChangePercent = (responseChange / olderAvgResponse) * 100;
      
      this.performanceMetrics.trends.responseTime = {
        current: recentAvgResponse,
        change: responseChangePercent,
        trend: Math.abs(responseChangePercent) < 5 ? 'stable' : 
               responseChangePercent > 0 ? 'up' : 'down',
      };

      // Similar calculations for error rate and throughput
      const recentErrorRate = (recent.filter(c => c.performance.exceptionsThrown > 0).length / recent.length) * 100;
      const olderErrorRate = (older.filter(c => c.performance.exceptionsThrown > 0).length / older.length) * 100;
      const errorRateChange = recentErrorRate - olderErrorRate;
      
      this.performanceMetrics.trends.errorRate = {
        current: recentErrorRate,
        change: errorRateChange,
        trend: Math.abs(errorRateChange) < 1 ? 'stable' : 
               errorRateChange > 0 ? 'up' : 'down',
      };
    }
  }

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private checkPerformanceAlerts(context: CorrelationContext): void {
    // Check for critical bottlenecks
    const criticalBottlenecks = context.bottlenecks.filter(b => b.severity === 'critical');
    if (criticalBottlenecks.length > 0) {
      this.createAlert({
        type: 'bottleneck',
        severity: 'critical',
        message: `Critical performance bottleneck detected: ${criticalBottlenecks[0].description}`,
        component: criticalBottlenecks[0].component,
        traceId: context.traceId,
        metrics: criticalBottlenecks[0],
        recommendations: [criticalBottlenecks[0].recommendation],
      });
    }

    // Check for performance degradation
    if (context.performance.totalDuration > 10000) {
      this.createAlert({
        type: 'degradation',
        severity: 'high',
        message: `Slow response detected: ${context.performance.totalDuration}ms`,
        component: 'request',
        traceId: context.traceId,
        metrics: { duration: context.performance.totalDuration },
        recommendations: ['Investigate slow components and optimize critical path'],
      });
    }

    // Check for anomalies
    if (context.performance.exceptionsThrown > 3) {
      this.createAlert({
        type: 'anomaly',
        severity: 'medium',
        message: `High exception count: ${context.performance.exceptionsThrown} exceptions`,
        component: 'exceptions',
        traceId: context.traceId,
        metrics: { exceptionCount: context.performance.exceptionsThrown },
        recommendations: ['Review and fix thrown exceptions'],
      });
    }
  }

  private createAlert(alert: Omit<PerformanceAlert, 'id' | 'timestamp' | 'acknowledged'>): void {
    const fullAlert: PerformanceAlert = {
      id: `perf_alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      acknowledged: false,
      ...alert,
    };

    this.alertHistory.push(fullAlert);
    this.alertsSubject.next(fullAlert);

    this.logger.warn(`Performance alert: ${fullAlert.message}`, fullAlert.metrics);
  }

  private startPeriodicProcessing(): void {
    // Clean up old active traces every minute
    interval(60000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.cleanupOldTraces();
        this.cleanupOldData();
        this.metricsSubject.next({ ...this.performanceMetrics });
      });
  }

  private cleanupOldTraces(): void {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    for (const [traceId, trace] of this.activeTraces) {
      if (now - trace.startTime.getTime() > timeout) {
        this.activeTraces.delete(traceId);
        this.logger.debug(`Cleaned up stale trace: ${traceId}`);
      }
    }
  }

  private cleanupOldData(): void {
    const maxHistory = 1000;
    
    // Clean up correlation history
    if (this.correlationHistory.length > maxHistory) {
      this.correlationHistory = this.correlationHistory.slice(-maxHistory);
    }

    // Clean up response time history
    if (this.responseTimeHistory.length > maxHistory) {
      this.responseTimeHistory = this.responseTimeHistory.slice(-maxHistory);
    }

    // Clean up alert history
    const oneDay = 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - oneDay);
    this.alertHistory = this.alertHistory.filter(alert => alert.timestamp > cutoff);
  }

  // Public API
  getMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  getMetricsStream(): Observable<PerformanceMetrics> {
    return this.metricsSubject.asObservable().pipe(shareReplay(1));
  }

  getCorrelationStream(): Observable<CorrelationContext> {
    return this.correlationSubject.asObservable();
  }

  getAlertsStream(): Observable<PerformanceAlert> {
    return this.alertsSubject.asObservable();
  }

  getRecentCorrelations(limit: number = 100): CorrelationContext[] {
    return this.correlationHistory.slice(-limit).reverse();
  }

  getCorrelationsByTraceId(traceId: string): CorrelationContext | undefined {
    return this.correlationHistory.find(c => c.traceId === traceId);
  }

  getBottlenecksByComponent(component: string, limit: number = 50): BottleneckAnalysis[] {
    const bottlenecks: BottleneckAnalysis[] = [];
    
    this.correlationHistory.forEach(correlation => {
      correlation.bottlenecks
        .filter(b => b.component === component)
        .forEach(b => bottlenecks.push(b));
    });

    return bottlenecks
      .sort((a, b) => b.severity === 'critical' ? 1 : -1)
      .slice(0, limit);
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alertHistory.find(a => a.id === alertId);
    if (!alert) return false;

    alert.acknowledged = true;
    return true;
  }

  getActiveTraces(): Array<{ traceId: string; watchers: string[]; startTime: Date }> {
    return Array.from(this.activeTraces.entries()).map(([traceId, trace]) => ({
      traceId,
      watchers: Array.from(trace.watchers),
      startTime: trace.startTime,
    }));
  }

  onDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
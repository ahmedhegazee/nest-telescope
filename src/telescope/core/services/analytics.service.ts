import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Observable, Subject, interval, combineLatest } from 'rxjs';
import { map, shareReplay, takeUntil } from 'rxjs/operators';
import { TelescopeService } from './telescope.service';
import { PerformanceCorrelationService } from './performance-correlation.service';

export interface AnalyticsData {
  timestamp: Date;
  timeRange: {
    start: Date;
    end: Date;
  };
  
  // Overview metrics
  overview: {
    totalRequests: number;
    totalErrors: number;
    totalQueries: number;
    totalCacheOps: number;
    totalJobs: number;
    
    averageResponseTime: number;
    errorRate: number;
    throughput: number;
    
    activeUsers: number;
    peakConcurrency: number;
  };
  
  // Performance analytics
  performance: {
    responseTimeDistribution: PerformanceDistribution;
    slowestEndpoints: EndpointMetrics[];
    resourceUsage: ResourceUsage;
    bottleneckAnalysis: BottleneckSummary[];
  };
  
  // Error analytics
  errors: {
    errorDistribution: ErrorDistribution;
    topErrors: ErrorSummary[];
    errorTrends: TimeSeries[];
    impactAnalysis: ErrorImpact[];
  };
  
  // Database analytics
  database: {
    queryDistribution: QueryDistribution;
    slowQueries: QueryMetrics[];
    connectionHealth: ConnectionHealth;
    indexUsage: IndexUsage[];
  };
  
  // Cache analytics
  cache: {
    hitRateDistribution: CacheDistribution;
    topKeys: CacheKeyMetrics[];
    performanceMetrics: CachePerformance;
    evictionAnalysis: EvictionAnalysis[];
  };
  
  // Job analytics
  jobs: {
    queueHealth: QueueHealth[];
    processingTimes: JobDistribution;
    failureAnalysis: JobFailureAnalysis[];
    throughputMetrics: JobThroughput[];
  };
  
  // User analytics
  users: {
    activeUsers: UserMetrics[];
    sessionAnalysis: SessionAnalysis;
    geographicDistribution: GeographicData[];
    deviceAnalysis: DeviceAnalysis[];
  };
  
  // Trends and predictions
  trends: {
    trafficTrends: TimeSeries[];
    performanceTrends: TimeSeries[];
    errorTrends: TimeSeries[];
    predictions: PredictionData[];
  };
  
  // Alerts and anomalies
  alerts: {
    activeAlerts: AlertSummary[];
    alertTrends: TimeSeries[];
    anomalies: AnomalyDetection[];
  };
}

export interface PerformanceDistribution {
  buckets: Array<{
    range: string;
    count: number;
    percentage: number;
  }>;
  percentiles: {
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
  };
}

export interface EndpointMetrics {
  endpoint: string;
  method: string;
  count: number;
  averageTime: number;
  p95Time: number;
  errorRate: number;
  throughput: number;
}

export interface ResourceUsage {
  cpu: TimeSeries[];
  memory: TimeSeries[];
  connections: TimeSeries[];
  diskIO: TimeSeries[];
}

export interface BottleneckSummary {
  component: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  frequency: number;
  averageImpact: number;
  description: string;
  recommendation: string;
}

export interface ErrorDistribution {
  byType: Array<{ type: string; count: number; percentage: number }>;
  bySeverity: Array<{ severity: string; count: number; percentage: number }>;
  byComponent: Array<{ component: string; count: number; percentage: number }>;
}

export interface ErrorSummary {
  errorType: string;
  message: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  impactScore: number;
  affectedUsers: number;
}

export interface ErrorImpact {
  errorType: string;
  performanceImpact: number;
  userImpact: number;
  businessImpact: number;
  recommendations: string[];
}

export interface QueryDistribution {
  byType: Array<{ type: string; count: number; avgTime: number }>;
  byTable: Array<{ table: string; count: number; avgTime: number }>;
  byComplexity: Array<{ complexity: string; count: number; avgTime: number }>;
}

export interface QueryMetrics {
  query: string;
  table: string;
  count: number;
  averageTime: number;
  maxTime: number;
  indexUsage: string[];
  optimizationSuggestions: string[];
}

export interface ConnectionHealth {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  maxConnections: number;
  healthScore: number;
  issues: string[];
}

export interface IndexUsage {
  table: string;
  index: string;
  usage: number;
  effectiveness: number;
  recommendations: string[];
}

export interface CacheDistribution {
  hitRate: number;
  missRate: number;
  byOperation: Array<{ operation: string; hitRate: number; count: number }>;
  byKeyPattern: Array<{ pattern: string; hitRate: number; count: number }>;
}

export interface CacheKeyMetrics {
  key: string;
  pattern: string;
  hitRate: number;
  accessCount: number;
  averageTime: number;
  size: number;
  ttl: number;
}

export interface CachePerformance {
  averageResponseTime: number;
  throughput: number;
  memoryUsage: number;
  evictionRate: number;
  trends: TimeSeries[];
}

export interface EvictionAnalysis {
  cause: string;
  frequency: number;
  impact: number;
  recommendations: string[];
}

export interface QueueHealth {
  queueName: string;
  status: 'healthy' | 'warning' | 'critical';
  backlog: number;
  processingRate: number;
  failureRate: number;
  averageWaitTime: number;
  recommendations: string[];
}

export interface JobDistribution {
  byType: Array<{ type: string; count: number; avgTime: number }>;
  byQueue: Array<{ queue: string; count: number; avgTime: number }>;
  byStatus: Array<{ status: string; count: number; percentage: number }>;
}

export interface JobFailureAnalysis {
  jobType: string;
  failureCount: number;
  failureRate: number;
  commonErrors: string[];
  recommendations: string[];
}

export interface JobThroughput {
  queueName: string;
  throughput: number;
  trend: 'up' | 'down' | 'stable';
  capacity: number;
  utilizationRate: number;
}

export interface UserMetrics {
  userId: string;
  sessionCount: number;
  requestCount: number;
  errorCount: number;
  averageResponseTime: number;
  lastActive: Date;
}

export interface SessionAnalysis {
  totalSessions: number;
  averageSessionDuration: number;
  averageRequestsPerSession: number;
  bounceRate: number;
  mostActiveHours: Array<{ hour: number; count: number }>;
}

export interface GeographicData {
  country: string;
  region: string;
  requestCount: number;
  averageResponseTime: number;
  errorRate: number;
}

export interface DeviceAnalysis {
  deviceType: string;
  userAgent: string;
  count: number;
  averageResponseTime: number;
  errorRate: number;
}

export interface TimeSeries {
  timestamp: Date;
  value: number;
  label?: string;
}

export interface PredictionData {
  metric: string;
  prediction: number;
  confidence: number;
  timeframe: string;
  factors: string[];
}

export interface AlertSummary {
  id: string;
  type: string;
  severity: string;
  message: string;
  timestamp: Date;
  component: string;
  acknowledged: boolean;
}

export interface AnomalyDetection {
  metric: string;
  currentValue: number;
  expectedValue: number;
  deviation: number;
  severity: 'low' | 'medium' | 'high';
  description: string;
  recommendations: string[];
}

@Injectable()
export class AnalyticsService implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly destroy$ = new Subject<void>();
  private readonly analyticsSubject = new Subject<AnalyticsData>();

  private currentAnalytics: AnalyticsData = this.initializeAnalytics();

  constructor(
    private readonly telescopeService: TelescopeService,
    private readonly performanceCorrelationService: PerformanceCorrelationService
  ) {}

  async onModuleInit(): Promise<void> {
    this.startAnalyticsProcessing();
    this.logger.log('Analytics service initialized');
  }

  private initializeAnalytics(): AnalyticsData {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    return {
      timestamp: now,
      timeRange: {
        start: oneHourAgo,
        end: now,
      },
      overview: {
        totalRequests: 0,
        totalErrors: 0,
        totalQueries: 0,
        totalCacheOps: 0,
        totalJobs: 0,
        averageResponseTime: 0,
        errorRate: 0,
        throughput: 0,
        activeUsers: 0,
        peakConcurrency: 0,
      },
      performance: {
        responseTimeDistribution: {
          buckets: [],
          percentiles: { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0 },
        },
        slowestEndpoints: [],
        resourceUsage: {
          cpu: [],
          memory: [],
          connections: [],
          diskIO: [],
        },
        bottleneckAnalysis: [],
      },
      errors: {
        errorDistribution: {
          byType: [],
          bySeverity: [],
          byComponent: [],
        },
        topErrors: [],
        errorTrends: [],
        impactAnalysis: [],
      },
      database: {
        queryDistribution: {
          byType: [],
          byTable: [],
          byComplexity: [],
        },
        slowQueries: [],
        connectionHealth: {
          totalConnections: 0,
          activeConnections: 0,
          idleConnections: 0,
          maxConnections: 0,
          healthScore: 100,
          issues: [],
        },
        indexUsage: [],
      },
      cache: {
        hitRateDistribution: {
          hitRate: 0,
          missRate: 0,
          byOperation: [],
          byKeyPattern: [],
        },
        topKeys: [],
        performanceMetrics: {
          averageResponseTime: 0,
          throughput: 0,
          memoryUsage: 0,
          evictionRate: 0,
          trends: [],
        },
        evictionAnalysis: [],
      },
      jobs: {
        queueHealth: [],
        processingTimes: {
          byType: [],
          byQueue: [],
          byStatus: [],
        },
        failureAnalysis: [],
        throughputMetrics: [],
      },
      users: {
        activeUsers: [],
        sessionAnalysis: {
          totalSessions: 0,
          averageSessionDuration: 0,
          averageRequestsPerSession: 0,
          bounceRate: 0,
          mostActiveHours: [],
        },
        geographicDistribution: [],
        deviceAnalysis: [],
      },
      trends: {
        trafficTrends: [],
        performanceTrends: [],
        errorTrends: [],
        predictions: [],
      },
      alerts: {
        activeAlerts: [],
        alertTrends: [],
        anomalies: [],
      },
    };
  }

  private startAnalyticsProcessing(): void {
    // Update analytics every 5 minutes
    interval(5 * 60 * 1000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.updateAnalytics();
      });

    // Initial update
    this.updateAnalytics();
  }

  private async updateAnalytics(): Promise<void> {
    try {
      const entries = await this.telescopeService.getEntries();
      const performanceMetrics = this.performanceCorrelationService.getMetrics();
      const correlations = this.performanceCorrelationService.getRecentCorrelations(1000);

      // Update overview
      this.updateOverview(entries, performanceMetrics);

      // Update performance analytics
      this.updatePerformanceAnalytics(entries, correlations);

      // Update error analytics
      this.updateErrorAnalytics(entries);

      // Update database analytics
      this.updateDatabaseAnalytics(entries);

      // Update cache analytics
      this.updateCacheAnalytics(entries);

      // Update job analytics
      this.updateJobAnalytics(entries);

      // Update user analytics
      this.updateUserAnalytics(entries);

      // Update trends and predictions
      this.updateTrends(entries);

      // Update alerts and anomalies
      this.updateAlertsAndAnomalies();

      // Update timestamp
      this.currentAnalytics.timestamp = new Date();

      // Emit updated analytics
      this.analyticsSubject.next({ ...this.currentAnalytics });

      this.logger.debug('Analytics updated successfully');
    } catch (error) {
      this.logger.error('Failed to update analytics:', error);
    }
  }

  private updateOverview(entries: any[], performanceMetrics: any): void {
    const requests = entries.filter(e => e.type === 'request');
    const errors = entries.filter(e => e.type === 'exception');
    const queries = entries.filter(e => e.type === 'query');
    const cacheOps = entries.filter(e => e.type === 'cache');
    const jobs = entries.filter(e => e.type === 'job');

    this.currentAnalytics.overview = {
      totalRequests: requests.length,
      totalErrors: errors.length,
      totalQueries: queries.length,
      totalCacheOps: cacheOps.length,
      totalJobs: jobs.length,
      averageResponseTime: performanceMetrics.averageResponseTime || 0,
      errorRate: performanceMetrics.errorRate || 0,
      throughput: performanceMetrics.throughput || 0,
      activeUsers: this.calculateActiveUsers(requests),
      peakConcurrency: this.calculatePeakConcurrency(requests),
    };
  }

  private updatePerformanceAnalytics(entries: any[], correlations: any[]): void {
    const requests = entries.filter(e => e.type === 'request');
    const responseTimes = requests
      .map(r => r.content?.duration || 0)
      .filter(d => d > 0);

    // Update response time distribution
    this.currentAnalytics.performance.responseTimeDistribution = 
      this.calculateResponseTimeDistribution(responseTimes);

    // Update slowest endpoints
    this.currentAnalytics.performance.slowestEndpoints = 
      this.calculateSlowestEndpoints(requests);

    // Update resource usage (would need system metrics)
    this.currentAnalytics.performance.resourceUsage = 
      this.calculateResourceUsage(entries);

    // Update bottleneck analysis
    this.currentAnalytics.performance.bottleneckAnalysis = 
      this.calculateBottleneckAnalysis(correlations);
  }

  private updateErrorAnalytics(entries: any[]): void {
    const errors = entries.filter(e => e.type === 'exception');

    // Update error distribution
    this.currentAnalytics.errors.errorDistribution = 
      this.calculateErrorDistribution(errors);

    // Update top errors
    this.currentAnalytics.errors.topErrors = 
      this.calculateTopErrors(errors);

    // Update error trends - converting to time series format
    this.currentAnalytics.errors.errorTrends = 
      this.convertErrorsToTimeSeries(errors);

    // Update impact analysis
    this.currentAnalytics.errors.impactAnalysis = 
      this.calculateErrorImpact(errors);
  }

  private updateDatabaseAnalytics(entries: any[]): void {
    const queries = entries.filter(e => e.type === 'query');

    // Update query distribution
    this.currentAnalytics.database.queryDistribution = 
      this.calculateQueryDistribution(queries);

    // Update slow queries
    this.currentAnalytics.database.slowQueries = 
      this.calculateSlowQueries(queries);

    // Update connection health (would need connection pool data)
    this.currentAnalytics.database.connectionHealth = 
      this.calculateConnectionHealth(queries);

    // Update index usage
    this.currentAnalytics.database.indexUsage = 
      this.calculateIndexUsage(queries);
  }

  private updateCacheAnalytics(entries: any[]): void {
    const cacheOps = entries.filter(e => e.type === 'cache');

    // Update hit rate distribution
    this.currentAnalytics.cache.hitRateDistribution = 
      this.calculateCacheDistribution(cacheOps);

    // Update top keys
    this.currentAnalytics.cache.topKeys = 
      this.calculateTopCacheKeys(cacheOps);

    // Update performance metrics
    this.currentAnalytics.cache.performanceMetrics = 
      this.calculateCachePerformance(cacheOps);

    // Update eviction analysis
    this.currentAnalytics.cache.evictionAnalysis = 
      this.calculateEvictionAnalysis(cacheOps);
  }

  private updateJobAnalytics(entries: any[]): void {
    const jobs = entries.filter(e => e.type === 'job');

    // Update queue health
    this.currentAnalytics.jobs.queueHealth = 
      this.calculateQueueHealth(jobs);

    // Update processing times
    this.currentAnalytics.jobs.processingTimes = 
      this.calculateJobDistribution(jobs);

    // Update failure analysis
    this.currentAnalytics.jobs.failureAnalysis = 
      this.calculateJobFailureAnalysis(jobs);

    // Update throughput metrics
    this.currentAnalytics.jobs.throughputMetrics = 
      this.calculateJobThroughput(jobs);
  }

  private updateUserAnalytics(entries: any[]): void {
    const requests = entries.filter(e => e.type === 'request');

    // Update active users
    this.currentAnalytics.users.activeUsers = 
      this.calculateActiveUserMetrics(requests);

    // Update session analysis
    this.currentAnalytics.users.sessionAnalysis = 
      this.calculateSessionAnalysis(requests);

    // Update geographic distribution
    this.currentAnalytics.users.geographicDistribution = 
      this.calculateGeographicDistribution(requests);

    // Update device analysis
    this.currentAnalytics.users.deviceAnalysis = 
      this.calculateDeviceAnalysis(requests);
  }

  private updateTrends(entries: any[]): void {
    // Update traffic trends
    this.currentAnalytics.trends.trafficTrends = 
      this.calculateTrafficTrends(entries);

    // Update performance trends
    this.currentAnalytics.trends.performanceTrends = 
      this.calculatePerformanceTrends(entries);

    // Update error trends - converting to time series format
    this.currentAnalytics.trends.errorTrends = 
      this.convertErrorsToTimeSeries(entries.filter(e => e.type === 'exception'));

    // Update predictions
    this.currentAnalytics.trends.predictions = 
      this.calculatePredictions(entries);
  }

  private updateAlertsAndAnomalies(): void {
    // This would integrate with alert services
    this.currentAnalytics.alerts = {
      activeAlerts: [],
      alertTrends: [],
      anomalies: [],
    };
  }

  // Helper methods for calculations would go here
  private calculateActiveUsers(requests: any[]): number {
    const uniqueUsers = new Set(
      requests
        .map(r => r.content?.userId || r.content?.ip)
        .filter(Boolean)
    );
    return uniqueUsers.size;
  }

  private calculatePeakConcurrency(requests: any[]): number {
    // Simplified calculation - would need proper time bucketing
    return Math.max(1, Math.floor(requests.length / 60)); // Rough estimate
  }

  private calculateResponseTimeDistribution(responseTimes: number[]): PerformanceDistribution {
    if (responseTimes.length === 0) {
      return {
        buckets: [],
        percentiles: { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0 },
      };
    }

    const sorted = [...responseTimes].sort((a, b) => a - b);
    const buckets = [
      { range: '<100ms', count: 0, percentage: 0 },
      { range: '100-500ms', count: 0, percentage: 0 },
      { range: '500ms-1s', count: 0, percentage: 0 },
      { range: '1-5s', count: 0, percentage: 0 },
      { range: '>5s', count: 0, percentage: 0 },
    ];

    sorted.forEach(time => {
      if (time !== undefined) {
        if (time < 100) buckets[0]!.count++;
        else if (time < 500) buckets[1]!.count++;
        else if (time < 1000) buckets[2]!.count++;
        else if (time < 5000) buckets[3]!.count++;
        else buckets[4]!.count++;
      }
    });

    buckets.forEach(bucket => {
      bucket.percentage = (bucket.count / sorted.length) * 100;
    });

    return {
      buckets,
      percentiles: {
        p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
        p75: sorted[Math.floor(sorted.length * 0.75)] || 0,
        p90: sorted[Math.floor(sorted.length * 0.9)] || 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
        p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
      },
    };
  }

  private calculateSlowestEndpoints(requests: any[]): EndpointMetrics[] {
    const endpointMap = new Map<string, {
      count: number;
      totalTime: number;
      times: number[];
      errors: number;
    }>();

    requests.forEach(request => {
      const endpoint = `${request.content?.method || 'GET'} ${request.content?.path || '/'}`;
      const duration = request.content?.duration || 0;
      const hasError = request.content?.statusCode >= 400;

      if (!endpointMap.has(endpoint)) {
        endpointMap.set(endpoint, {
          count: 0,
          totalTime: 0,
          times: [],
          errors: 0,
        });
      }

      const data = endpointMap.get(endpoint)!;
      data.count++;
      data.totalTime += duration;
      data.times.push(duration);
      if (hasError) data.errors++;
    });

    return Array.from(endpointMap.entries())
      .map(([endpoint, data]) => {
        const parts = endpoint.split(' ', 2);
        const method = parts[0] || 'GET';
        const path = parts[1] || '/';
        const sortedTimes = data.times.sort((a, b) => a - b);
        const p95Index = Math.floor(sortedTimes.length * 0.95);

        return {
          endpoint: path,
          method,
          count: data.count,
          averageTime: data.totalTime / data.count,
          p95Time: sortedTimes[p95Index] || 0,
          errorRate: (data.errors / data.count) * 100,
          throughput: data.count / 3600, // Rough estimate
        };
      })
      .sort((a, b) => b.averageTime - a.averageTime)
      .slice(0, 10);
  }

  // Additional calculation methods would be implemented here...
  private calculateResourceUsage(entries: any[]): ResourceUsage {
    return {
      cpu: [],
      memory: [],
      connections: [],
      diskIO: [],
    };
  }

  private calculateBottleneckAnalysis(correlations: any[]): BottleneckSummary[] {
    const bottleneckMap = new Map<string, {
      count: number;
      totalImpact: number;
      severities: string[];
    }>();

    correlations.forEach(correlation => {
      correlation.bottlenecks?.forEach((bottleneck: any) => {
        const key = bottleneck.component;
        if (!bottleneckMap.has(key)) {
          bottleneckMap.set(key, {
            count: 0,
            totalImpact: 0,
            severities: [],
          });
        }

        const data = bottleneckMap.get(key)!;
        data.count++;
        data.totalImpact += bottleneck.percentage || 0;
        data.severities.push(bottleneck.severity);
      });
    });

    return Array.from(bottleneckMap.entries())
      .map(([component, data]) => {
        const mostCommonSeverity = this.getMostCommon(data.severities);
        return {
          component,
          severity: mostCommonSeverity as any,
          frequency: data.count,
          averageImpact: data.totalImpact / data.count,
          description: `${component} bottleneck occurred ${data.count} times`,
          recommendation: `Optimize ${component} performance`,
        };
      })
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);
  }

  private getMostCommon(items: string[]): string {
    const counts = new Map<string, number>();
    items.forEach(item => {
      counts.set(item, (counts.get(item) || 0) + 1);
    });

    let maxCount = 0;
    let mostCommon = '';
    counts.forEach((count, item) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = item;
      }
    });

    return mostCommon;
  }

  // Complete implementations for calculation methods
  private calculateErrorDistribution(errors: any[]): ErrorDistribution {
    const typeMap = new Map<string, number>();
    const severityMap = new Map<string, number>();
    const componentMap = new Map<string, number>();

    errors.forEach(error => {
      const errorType = error.content?.error?.name || 'Unknown';
      const severity = error.content?.severity || 'medium';
      const component = error.content?.component || 'application';

      typeMap.set(errorType, (typeMap.get(errorType) || 0) + 1);
      severityMap.set(severity, (severityMap.get(severity) || 0) + 1);
      componentMap.set(component, (componentMap.get(component) || 0) + 1);
    });

    const total = errors.length || 1;

    return {
      byType: Array.from(typeMap.entries()).map(([type, count]) => ({
        type,
        count,
        percentage: (count / total) * 100,
      })),
      bySeverity: Array.from(severityMap.entries()).map(([severity, count]) => ({
        severity,
        count,
        percentage: (count / total) * 100,
      })),
      byComponent: Array.from(componentMap.entries()).map(([component, count]) => ({
        component,
        count,
        percentage: (count / total) * 100,
      })),
    };
  }

  private calculateTopErrors(errors: any[]): ErrorSummary[] {
    const errorMap = new Map<string, {
      count: number;
      firstSeen: Date;
      lastSeen: Date;
      affectedUsers: Set<string>;
      message: string;
    }>();

    errors.forEach(error => {
      const errorType = error.content?.error?.name || 'Unknown';
      const message = error.content?.error?.message || 'No message';
      const userId = error.content?.userId || error.content?.ip;
      
      if (!errorMap.has(errorType)) {
        errorMap.set(errorType, {
          count: 0,
          firstSeen: error.timestamp,
          lastSeen: error.timestamp,
          affectedUsers: new Set(),
          message,
        });
      }

      const data = errorMap.get(errorType)!;
      data.count++;
      data.lastSeen = new Date(Math.max(data.lastSeen.getTime(), error.timestamp.getTime()));
      data.firstSeen = new Date(Math.min(data.firstSeen.getTime(), error.timestamp.getTime()));
      if (userId) data.affectedUsers.add(userId);
    });

    return Array.from(errorMap.entries())
      .map(([errorType, data]) => ({
        errorType,
        message: data.message,
        count: data.count,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
        impactScore: this.calculateErrorImpactScore(data.count, data.affectedUsers.size),
        affectedUsers: data.affectedUsers.size,
      }))
      .sort((a, b) => b.impactScore - a.impactScore)
      .slice(0, 10);
  }

  private calculateErrorImpact(errors: any[]): ErrorImpact[] {
    const impactMap = new Map<string, {
      count: number;
      performanceImpact: number[];
      userCount: number;
    }>();

    errors.forEach(error => {
      const errorType = error.content?.error?.name || 'Unknown';
      const responseTime = error.content?.responseTime || 0;
      
      if (!impactMap.has(errorType)) {
        impactMap.set(errorType, {
          count: 0,
          performanceImpact: [],
          userCount: 0,
        });
      }

      const data = impactMap.get(errorType)!;
      data.count++;
      if (responseTime > 0) data.performanceImpact.push(responseTime);
    });

    return Array.from(impactMap.entries())
      .map(([errorType, data]) => {
        const avgPerformanceImpact = data.performanceImpact.length > 0 
          ? data.performanceImpact.reduce((sum, val) => sum + val, 0) / data.performanceImpact.length
          : 0;
        
        const userImpact = (data.userCount / this.currentAnalytics.overview.activeUsers) * 100;
        const businessImpact = this.calculateBusinessImpact(data.count, avgPerformanceImpact);

        return {
          errorType,
          performanceImpact: avgPerformanceImpact,
          userImpact,
          businessImpact,
          recommendations: this.generateErrorRecommendations(errorType, avgPerformanceImpact, data.count),
        };
      })
      .sort((a, b) => b.businessImpact - a.businessImpact);
  }

  private calculateQueryDistribution(queries: any[]): QueryDistribution {
    return {
      byType: [],
      byTable: [],
      byComplexity: [],
    };
  }

  private calculateSlowQueries(queries: any[]): QueryMetrics[] {
    return [];
  }

  private calculateConnectionHealth(queries: any[]): ConnectionHealth {
    return {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      maxConnections: 0,
      healthScore: 100,
      issues: [],
    };
  }

  private calculateIndexUsage(queries: any[]): IndexUsage[] {
    return [];
  }

  private calculateCacheDistribution(cacheOps: any[]): CacheDistribution {
    if (cacheOps.length === 0) {
      return {
        hitRate: 0,
        missRate: 0,
        byOperation: [],
        byKeyPattern: [],
      };
    }

    const hits = cacheOps.filter(op => op.content?.cache?.hit === true).length;
    const total = cacheOps.length;
    const hitRate = (hits / total) * 100;
    const missRate = 100 - hitRate;

    // By operation
    const operationMap = new Map<string, { total: number; hits: number }>();
    cacheOps.forEach(op => {
      const operation = op.content?.cache?.operation || 'unknown';
      const isHit = op.content?.cache?.hit === true;
      
      if (!operationMap.has(operation)) {
        operationMap.set(operation, { total: 0, hits: 0 });
      }
      
      const data = operationMap.get(operation)!;
      data.total++;
      if (isHit) data.hits++;
    });

    const byOperation = Array.from(operationMap.entries()).map(([operation, data]) => ({
      operation,
      hitRate: (data.hits / data.total) * 100,
      count: data.total,
    }));

    // By key pattern
    const patternMap = new Map<string, { total: number; hits: number }>();
    cacheOps.forEach(op => {
      const pattern = op.content?.cache?.keyPattern || this.extractKeyPattern(op.content?.cache?.key || '');
      const isHit = op.content?.cache?.hit === true;
      
      if (!patternMap.has(pattern)) {
        patternMap.set(pattern, { total: 0, hits: 0 });
      }
      
      const data = patternMap.get(pattern)!;
      data.total++;
      if (isHit) data.hits++;
    });

    const byKeyPattern = Array.from(patternMap.entries()).map(([pattern, data]) => ({
      pattern,
      hitRate: (data.hits / data.total) * 100,
      count: data.total,
    }));

    return {
      hitRate,
      missRate,
      byOperation,
      byKeyPattern,
    };
  }

  private calculateTopCacheKeys(cacheOps: any[]): CacheKeyMetrics[] {
    return [];
  }

  private calculateCachePerformance(cacheOps: any[]): CachePerformance {
    return {
      averageResponseTime: 0,
      throughput: 0,
      memoryUsage: 0,
      evictionRate: 0,
      trends: [],
    };
  }

  private calculateEvictionAnalysis(cacheOps: any[]): EvictionAnalysis[] {
    return [];
  }

  private calculateQueueHealth(jobs: any[]): QueueHealth[] {
    return [];
  }

  private calculateJobDistribution(jobs: any[]): JobDistribution {
    return {
      byType: [],
      byQueue: [],
      byStatus: [],
    };
  }

  private calculateJobFailureAnalysis(jobs: any[]): JobFailureAnalysis[] {
    return [];
  }

  private calculateJobThroughput(jobs: any[]): JobThroughput[] {
    return [];
  }

  private calculateActiveUserMetrics(requests: any[]): UserMetrics[] {
    const userMap = new Map<string, {
      sessionCount: number;
      requestCount: number;
      errorCount: number;
      responseTimes: number[];
      lastActive: Date;
    }>();

    requests.forEach(request => {
      const userId = request.content?.userId || request.content?.ip || 'anonymous';
      const responseTime = request.content?.duration || 0;
      const hasError = request.content?.responseStatus >= 400;
      
      if (!userMap.has(userId)) {
        userMap.set(userId, {
          sessionCount: 0,
          requestCount: 0,
          errorCount: 0,
          responseTimes: [],
          lastActive: request.timestamp,
        });
      }

      const data = userMap.get(userId)!;
      data.requestCount++;
      if (hasError) data.errorCount++;
      if (responseTime > 0) data.responseTimes.push(responseTime);
      data.lastActive = new Date(Math.max(data.lastActive.getTime(), request.timestamp.getTime()));
    });

    return Array.from(userMap.entries())
      .map(([userId, data]) => ({
        userId,
        sessionCount: data.sessionCount,
        requestCount: data.requestCount,
        errorCount: data.errorCount,
        averageResponseTime: data.responseTimes.length > 0 
          ? data.responseTimes.reduce((sum, val) => sum + val, 0) / data.responseTimes.length 
          : 0,
        lastActive: data.lastActive,
      }))
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, 100);
  }

  private calculateSessionAnalysis(requests: any[]): SessionAnalysis {
    return {
      totalSessions: 0,
      averageSessionDuration: 0,
      averageRequestsPerSession: 0,
      bounceRate: 0,
      mostActiveHours: [],
    };
  }

  private calculateGeographicDistribution(requests: any[]): GeographicData[] {
    return [];
  }

  private calculateDeviceAnalysis(requests: any[]): DeviceAnalysis[] {
    return [];
  }

  private calculateTrafficTrends(entries: any[]): TimeSeries[] {
    const requests = entries.filter(e => e.type === 'request');
    const hourlyBuckets = new Map<string, number>();

    requests.forEach(request => {
      const hour = new Date(request.timestamp);
      hour.setMinutes(0, 0, 0);
      const hourKey = hour.toISOString();
      
      hourlyBuckets.set(hourKey, (hourlyBuckets.get(hourKey) || 0) + 1);
    });

    return Array.from(hourlyBuckets.entries())
      .map(([timestamp, value]) => ({
        timestamp: new Date(timestamp),
        value,
        label: 'Requests per hour',
      }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private calculatePerformanceTrends(entries: any[]): TimeSeries[] {
    const requests = entries.filter(e => e.type === 'request' && e.content?.duration);
    const hourlyBuckets = new Map<string, number[]>();

    requests.forEach(request => {
      const hour = new Date(request.timestamp);
      hour.setMinutes(0, 0, 0);
      const hourKey = hour.toISOString();
      
      if (!hourlyBuckets.has(hourKey)) {
        hourlyBuckets.set(hourKey, []);
      }
      
      hourlyBuckets.get(hourKey)!.push(request.content.duration);
    });

    return Array.from(hourlyBuckets.entries())
      .map(([timestamp, durations]) => ({
        timestamp: new Date(timestamp),
        value: durations.reduce((sum, val) => sum + val, 0) / durations.length,
        label: 'Average response time (ms)',
      }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private calculatePredictions(entries: any[]): PredictionData[] {
    const predictions: PredictionData[] = [];
    
    // Traffic prediction
    const trafficTrend = this.calculateTrafficTrends(entries);
    if (trafficTrend.length >= 3) {
      const recent = trafficTrend.slice(-3);
      const avgChange = (recent[2]!.value - recent[0]!.value) / 2;
      const predicted = recent[2]!.value + avgChange;
      
      predictions.push({
        metric: 'traffic',
        prediction: Math.max(0, predicted),
        confidence: 0.7,
        timeframe: 'next_hour',
        factors: ['historical_trend', 'time_of_day'],
      });
    }
    
    // Performance prediction
    const perfTrend = this.calculatePerformanceTrends(entries);
    if (perfTrend.length >= 3) {
      const recent = perfTrend.slice(-3);
      const avgChange = (recent[2]!.value - recent[0]!.value) / 2;
      const predicted = recent[2]!.value + avgChange;
      
      predictions.push({
        metric: 'response_time',
        prediction: Math.max(0, predicted),
        confidence: 0.6,
        timeframe: 'next_hour',
        factors: ['performance_trend', 'system_load'],
      });
    }
    
    return predictions;
  }

  // Public API
  getAnalytics(): AnalyticsData {
    return { ...this.currentAnalytics };
  }

  getAnalyticsStream(): Observable<AnalyticsData> {
    return this.analyticsSubject.asObservable().pipe(shareReplay(1));
  }

  getAnalyticsForTimeRange(start: Date, end: Date): Promise<AnalyticsData> {
    // This would generate analytics for a specific time range
    return Promise.resolve({ ...this.currentAnalytics });
  }

  onDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
  
  // Helper methods
  private calculateErrorImpactScore(count: number, affectedUsers: number): number {
    // Impact score based on frequency and user impact
    const frequencyScore = Math.min(count / 100, 1) * 50; // Max 50 points for frequency
    const userScore = Math.min(affectedUsers / 10, 1) * 50; // Max 50 points for user impact
    return frequencyScore + userScore;
  }
  
  private calculateBusinessImpact(errorCount: number, avgResponseTime: number): number {
    // Business impact score based on error frequency and performance impact
    const errorImpact = Math.min(errorCount / 100, 1) * 60;
    const performanceImpact = Math.min(avgResponseTime / 5000, 1) * 40;
    return errorImpact + performanceImpact;
  }
  
  private generateErrorRecommendations(errorType: string, performanceImpact: number, count: number): string[] {
    const recommendations: string[] = [];
    
    if (count > 10) {
      recommendations.push('Investigate error frequency and implement preventive measures');
    }
    
    if (performanceImpact > 1000) {
      recommendations.push('Optimize error handling to reduce performance impact');
    }
    
    if (errorType.toLowerCase().includes('database')) {
      recommendations.push('Review database queries and connection handling');
    }
    
    if (errorType.toLowerCase().includes('timeout')) {
      recommendations.push('Increase timeout values or optimize slow operations');
    }
    
    return recommendations.length > 0 ? recommendations : ['Monitor error patterns and implement appropriate fixes'];
  }
  
  private extractKeyPattern(key: string): string {
    if (!key) return 'unknown';
    
    return key
      .replace(/\d+/g, 'N')
      .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, 'UUID')
      .replace(/[a-f0-9]{32}/gi, 'HASH32')
      .replace(/[a-f0-9]{40}/gi, 'HASH40')
      .replace(/[a-f0-9]{64}/gi, 'HASH64')
      .replace(/\d{4}-\d{2}-\d{2}/g, 'DATE')
      .replace(/\d{2}:\d{2}:\d{2}/g, 'TIME');
  }

  private convertErrorsToTimeSeries(errors: any[]): TimeSeries[] {
    // Group errors by hour and count occurrences
    const now = new Date();
    const hourlyBuckets = new Map<string, number>();
    
    // Initialize buckets for the last 24 hours
    for (let i = 23; i >= 0; i--) {
      const hourAgo = new Date(now.getTime() - i * 60 * 60 * 1000);
      const hourKey = hourAgo.toISOString().slice(0, 13); // YYYY-MM-DDTHH
      hourlyBuckets.set(hourKey, 0);
    }
    
    // Count errors by hour
    errors.forEach(error => {
      const timestamp = new Date(error.timestamp);
      const hourKey = timestamp.toISOString().slice(0, 13);
      const currentCount = hourlyBuckets.get(hourKey) || 0;
      hourlyBuckets.set(hourKey, currentCount + 1);
    });
    
    // Convert to TimeSeries format
    return Array.from(hourlyBuckets.entries()).map(([hourKey, count]) => ({
      timestamp: new Date(hourKey + ':00:00.000Z'),
      value: count
    }));
  }
}
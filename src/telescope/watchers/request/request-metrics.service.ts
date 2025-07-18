import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, interval } from 'rxjs';
import { map, scan, shareReplay } from 'rxjs/operators';
import { RequestContext, ResponseContext } from './request-watcher.interceptor';

export interface RequestPerformanceMetrics {
  totalRequests: number;
  requestsPerSecond: number;
  averageResponseTime: number;
  medianResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  slowRequestCount: number;
  errorCount: number;
  errorRate: number;
  byMethod: Record<string, MethodMetrics>;
  byStatusCode: Record<number, number>;
  byEndpoint: Record<string, EndpointMetrics>;
  timeWindow: TimeWindowMetrics;
}

export interface MethodMetrics {
  count: number;
  averageResponseTime: number;
  errorCount: number;
  errorRate: number;
}

export interface EndpointMetrics {
  count: number;
  averageResponseTime: number;
  errorCount: number;
  errorRate: number;
  lastAccessed: Date;
}

export interface TimeWindowMetrics {
  last5Minutes: number;
  last15Minutes: number;
  last30Minutes: number;
  last60Minutes: number;
}

export interface RequestDataPoint {
  requestContext: RequestContext;
  responseContext: ResponseContext;
  error: Error | null;
  timestamp: Date;
}

@Injectable()
export class RequestMetricsService {
  private readonly logger = new Logger(RequestMetricsService.name);
  private readonly dataSubject = new Subject<RequestDataPoint>();
  private readonly requestHistory: RequestDataPoint[] = [];
  private readonly maxHistorySize = 10000;
  private readonly responseTimes: number[] = [];
  private readonly maxResponseTimesSamples = 1000;

  private currentMetrics: RequestPerformanceMetrics = {
    totalRequests: 0,
    requestsPerSecond: 0,
    averageResponseTime: 0,
    medianResponseTime: 0,
    p95ResponseTime: 0,
    p99ResponseTime: 0,
    slowRequestCount: 0,
    errorCount: 0,
    errorRate: 0,
    byMethod: {},
    byStatusCode: {},
    byEndpoint: {},
    timeWindow: {
      last5Minutes: 0,
      last15Minutes: 0,
      last30Minutes: 0,
      last60Minutes: 0
    }
  };

  constructor() {
    this.setupMetricsProcessing();
    this.startPeriodicCalculations();
  }

  private setupMetricsProcessing(): void {
    this.dataSubject
      .pipe(
        scan((metrics, dataPoint) => this.updateMetrics(metrics, dataPoint), this.currentMetrics),
        shareReplay(1)
      )
      .subscribe(metrics => {
        this.currentMetrics = metrics;
      });
  }

  private startPeriodicCalculations(): void {
    // Update time-based metrics every 30 seconds
    interval(30000).subscribe(() => {
      this.updateTimeWindowMetrics();
      this.updateRequestsPerSecond();
    });
  }

  recordRequest(
    requestContext: RequestContext,
    responseContext: ResponseContext,
    error: Error | null
  ): void {
    const dataPoint: RequestDataPoint = {
      requestContext,
      responseContext,
      error,
      timestamp: new Date()
    };

    // Add to history
    this.requestHistory.push(dataPoint);
    if (this.requestHistory.length > this.maxHistorySize) {
      this.requestHistory.shift();
    }

    // Track response times for percentile calculations
    this.responseTimes.push(responseContext.duration);
    if (this.responseTimes.length > this.maxResponseTimesSamples) {
      this.responseTimes.shift();
    }

    // Emit to metrics processor
    this.dataSubject.next(dataPoint);
  }

  private updateMetrics(
    current: RequestPerformanceMetrics,
    dataPoint: RequestDataPoint
  ): RequestPerformanceMetrics {
    const { requestContext, responseContext, error } = dataPoint;
    
    const updated = { ...current };
    
    // Update basic counters
    updated.totalRequests++;
    
    if (error || responseContext.statusCode >= 400) {
      updated.errorCount++;
    }
    
    if (responseContext.duration > 1000) { // 1 second threshold
      updated.slowRequestCount++;
    }
    
    // Update error rate
    updated.errorRate = (updated.errorCount / updated.totalRequests) * 100;
    
    // Update average response time
    updated.averageResponseTime = this.calculateNewAverage(
      current.averageResponseTime,
      responseContext.duration,
      updated.totalRequests
    );
    
    // Update percentiles
    updated.medianResponseTime = this.calculatePercentile(50);
    updated.p95ResponseTime = this.calculatePercentile(95);
    updated.p99ResponseTime = this.calculatePercentile(99);
    
    // Update method metrics
    updated.byMethod = this.updateMethodMetrics(
      updated.byMethod,
      requestContext.method,
      responseContext,
      error
    );
    
    // Update status code distribution
    updated.byStatusCode = this.updateStatusCodeMetrics(
      updated.byStatusCode,
      responseContext.statusCode
    );
    
    // Update endpoint metrics
    updated.byEndpoint = this.updateEndpointMetrics(
      updated.byEndpoint,
      requestContext,
      responseContext,
      error
    );
    
    return updated;
  }

  private calculateNewAverage(currentAverage: number, newValue: number, totalCount: number): number {
    return ((currentAverage * (totalCount - 1)) + newValue) / totalCount;
  }

  private calculatePercentile(percentile: number): number {
    if (this.responseTimes.length === 0) return 0;
    
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private updateMethodMetrics(
    current: Record<string, MethodMetrics>,
    method: string,
    responseContext: ResponseContext,
    error: Error | null
  ): Record<string, MethodMetrics> {
    const updated = { ...current };
    
    if (!updated[method]) {
      updated[method] = {
        count: 0,
        averageResponseTime: 0,
        errorCount: 0,
        errorRate: 0
      };
    }
    
    const methodMetrics = updated[method];
    methodMetrics.count++;
    
    if (error || responseContext.statusCode >= 400) {
      methodMetrics.errorCount++;
    }
    
    methodMetrics.averageResponseTime = this.calculateNewAverage(
      methodMetrics.averageResponseTime,
      responseContext.duration,
      methodMetrics.count
    );
    
    methodMetrics.errorRate = (methodMetrics.errorCount / methodMetrics.count) * 100;
    
    return updated;
  }

  private updateStatusCodeMetrics(
    current: Record<number, number>,
    statusCode: number
  ): Record<number, number> {
    const updated = { ...current };
    updated[statusCode] = (updated[statusCode] || 0) + 1;
    return updated;
  }

  private updateEndpointMetrics(
    current: Record<string, EndpointMetrics>,
    requestContext: RequestContext,
    responseContext: ResponseContext,
    error: Error | null
  ): Record<string, EndpointMetrics> {
    const updated = { ...current };
    
    // Normalize endpoint path
    const endpoint = this.normalizeEndpoint(requestContext.method, requestContext.url);
    
    if (!updated[endpoint]) {
      updated[endpoint] = {
        count: 0,
        averageResponseTime: 0,
        errorCount: 0,
        errorRate: 0,
        lastAccessed: new Date()
      };
    }
    
    const endpointMetrics = updated[endpoint];
    endpointMetrics.count++;
    endpointMetrics.lastAccessed = new Date();
    
    if (error || responseContext.statusCode >= 400) {
      endpointMetrics.errorCount++;
    }
    
    endpointMetrics.averageResponseTime = this.calculateNewAverage(
      endpointMetrics.averageResponseTime,
      responseContext.duration,
      endpointMetrics.count
    );
    
    endpointMetrics.errorRate = (endpointMetrics.errorCount / endpointMetrics.count) * 100;
    
    return updated;
  }

  private normalizeEndpoint(method: string, url: string): string {
    // Remove query parameters
    const path = url.split('?')[0];
    
    // Replace numeric IDs with placeholders
    const normalizedPath = path.replace(/\/\d+/g, '/{id}');
    
    // Replace UUIDs with placeholders
    const uuidPattern = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const finalPath = normalizedPath.replace(uuidPattern, '/{uuid}');
    
    return `${method} ${finalPath}`;
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
      const count = this.requestHistory.filter(
        dataPoint => dataPoint.timestamp.getTime() > cutoff
      ).length;
      
      (this.currentMetrics.timeWindow as any)[window.key] = count;
    }
  }

  private updateRequestsPerSecond(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentRequests = this.requestHistory.filter(
      dataPoint => dataPoint.timestamp.getTime() > oneMinuteAgo
    );
    
    this.currentMetrics.requestsPerSecond = recentRequests.length / 60;
  }

  getMetrics(): RequestPerformanceMetrics {
    return { ...this.currentMetrics };
  }

  getMetricsStream(): Observable<RequestPerformanceMetrics> {
    return this.dataSubject.pipe(
      scan((metrics, dataPoint) => this.updateMetrics(metrics, dataPoint), this.currentMetrics),
      shareReplay(1)
    );
  }

  getTopEndpoints(limit: number = 10): Array<{ endpoint: string; metrics: EndpointMetrics }> {
    return Object.entries(this.currentMetrics.byEndpoint)
      .map(([endpoint, metrics]) => ({ endpoint, metrics }))
      .sort((a, b) => b.metrics.count - a.metrics.count)
      .slice(0, limit);
  }

  getSlowestEndpoints(limit: number = 10): Array<{ endpoint: string; metrics: EndpointMetrics }> {
    return Object.entries(this.currentMetrics.byEndpoint)
      .map(([endpoint, metrics]) => ({ endpoint, metrics }))
      .sort((a, b) => b.metrics.averageResponseTime - a.metrics.averageResponseTime)
      .slice(0, limit);
  }

  getErrorProneEndpoints(limit: number = 10): Array<{ endpoint: string; metrics: EndpointMetrics }> {
    return Object.entries(this.currentMetrics.byEndpoint)
      .map(([endpoint, metrics]) => ({ endpoint, metrics }))
      .filter(({ metrics }) => metrics.errorRate > 0)
      .sort((a, b) => b.metrics.errorRate - a.metrics.errorRate)
      .slice(0, limit);
  }

  getRecentRequests(limit: number = 100): RequestDataPoint[] {
    return this.requestHistory
      .slice(-limit)
      .reverse(); // Most recent first
  }

  getRequestsInTimeWindow(windowMs: number): RequestDataPoint[] {
    const cutoff = Date.now() - windowMs;
    return this.requestHistory.filter(
      dataPoint => dataPoint.timestamp.getTime() > cutoff
    );
  }

  reset(): void {
    this.currentMetrics = {
      totalRequests: 0,
      requestsPerSecond: 0,
      averageResponseTime: 0,
      medianResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      slowRequestCount: 0,
      errorCount: 0,
      errorRate: 0,
      byMethod: {},
      byStatusCode: {},
      byEndpoint: {},
      timeWindow: {
        last5Minutes: 0,
        last15Minutes: 0,
        last30Minutes: 0,
        last60Minutes: 0
      }
    };
    
    this.requestHistory.length = 0;
    this.responseTimes.length = 0;
  }
}
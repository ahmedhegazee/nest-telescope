import { Injectable, Logger, Inject } from '@nestjs/common';
import { Request } from 'express';
import { TelescopeService } from '../../core/services/telescope.service';
import { TelescopeEntry } from '../../core/interfaces/telescope-entry.interface';
import { TelescopeConfig } from '../../core/interfaces/telescope-config.interface';
import { RequestContext, ResponseContext } from './request-watcher.interceptor';

export interface RequestWatcherConfig {
  enabled: boolean;
  excludePaths: string[];
  sampling: {
    enabled: boolean;
    rate: number; // 0-100 percentage
    rules: SamplingRule[];
  };
  security: {
    maskSensitiveData: boolean;
    logResponseBodies: boolean;
    logSuccessfulResponseBodies: boolean;
    sensitiveKeys: string[];
  };
  performance: {
    slowRequestThreshold: number; // milliseconds
    collectMetrics: boolean;
  };
  filters: {
    methods: string[];
    statusCodes: number[];
    contentTypes: string[];
  };
}

export interface SamplingRule {
  path: string;
  method?: string;
  statusCode?: number;
  rate: number;
  priority: number;
}

export interface RequestMetrics {
  totalRequests: number;
  slowRequests: number;
  errorRequests: number;
  averageResponseTime: number;
  requestsPerSecond: number;
  statusCodeDistribution: Record<number, number>;
  methodDistribution: Record<string, number>;
}

@Injectable()
export class RequestWatcherService {
  private readonly logger = new Logger(RequestWatcherService.name);
  private readonly config: RequestWatcherConfig;
  private readonly requestMetrics: RequestMetrics;
  private readonly requestTimeline: number[] = [];
  private readonly maxTimelineSize = 1000;

  constructor(
    private readonly telescopeService: TelescopeService,
    @Inject('TELESCOPE_CONFIG') private readonly telescopeConfig: TelescopeConfig
  ) {
    this.config = this.buildConfig(telescopeConfig);
    this.requestMetrics = this.initializeMetrics();
  }

  private buildConfig(config: TelescopeConfig): RequestWatcherConfig {
    const defaultConfig: RequestWatcherConfig = {
      enabled: true,
      excludePaths: [
        '/health',
        '/metrics',
        '/telescope',
        '/favicon.ico',
        '/robots.txt',
        '/_next',
        '/static',
        '/assets'
      ],
      sampling: {
        enabled: true,
        rate: 100,
        rules: [
          { path: '/api/health', rate: 10, priority: 1 },
          { path: '/api/metrics', rate: 10, priority: 1 },
          { path: '/api', method: 'GET', rate: 50, priority: 2 },
          { path: '/api', method: 'POST', rate: 100, priority: 3 },
          { path: '/api', statusCode: 500, rate: 100, priority: 4 }
        ]
      },
      security: {
        maskSensitiveData: true,
        logResponseBodies: false,
        logSuccessfulResponseBodies: false,
        sensitiveKeys: [
          'password',
          'token',
          'secret',
          'key',
          'auth',
          'credit',
          'ssn',
          'email',
          'phone'
        ]
      },
      performance: {
        slowRequestThreshold: 1000,
        collectMetrics: true
      },
      filters: {
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        statusCodes: [],
        contentTypes: []
      }
    };

    const requestWatcherConfig = config.watchers?.request;
    if (typeof requestWatcherConfig === 'object') {
      return {
        ...defaultConfig,
        ...requestWatcherConfig,
        sampling: {
          ...defaultConfig.sampling,
          ...(requestWatcherConfig.sampling || {})
        },
        security: {
          ...defaultConfig.security,
          ...(requestWatcherConfig.security || {})
        },
        performance: {
          ...defaultConfig.performance,
          ...(requestWatcherConfig.performance || {})
        },
        filters: {
          ...defaultConfig.filters,
          ...(requestWatcherConfig.filters || {})
        }
      };
    }

    return defaultConfig;
  }

  private initializeMetrics(): RequestMetrics {
    return {
      totalRequests: 0,
      slowRequests: 0,
      errorRequests: 0,
      averageResponseTime: 0,
      requestsPerSecond: 0,
      statusCodeDistribution: {},
      methodDistribution: {}
    };
  }

  trackRequest(
    requestContext: RequestContext,
    responseContext: ResponseContext,
    error: Error | null
  ): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Create telescope entry
      const entry = this.createTelescopeEntry(requestContext, responseContext, error);
      
      // Record the request
      this.telescopeService.record(entry);
      
      // Update metrics
      if (this.config.performance.collectMetrics) {
        this.updateMetrics(requestContext, responseContext, error);
      }
      
      // Log slow requests
      if (responseContext.duration > this.config.performance.slowRequestThreshold) {
        this.logger.warn(`Slow request detected: ${requestContext.method} ${requestContext.url} (${responseContext.duration}ms)`);
      }
      
      // Log errors
      if (error || responseContext.statusCode >= 400) {
        this.logger.warn(`Request error: ${requestContext.method} ${requestContext.url} - ${responseContext.statusCode}`, error?.message);
      }
    } catch (trackingError) {
      this.logger.error('Failed to track request:', trackingError);
    }
  }

  private createTelescopeEntry(
    requestContext: RequestContext,
    responseContext: ResponseContext,
    error: Error | null
  ): TelescopeEntry {
    const entryId = `req_${requestContext.id}`;
    const familyHash = this.generateFamilyHash(requestContext);
    
    return {
      id: entryId,
      type: 'request',
      familyHash,
      content: {
        request: {
          id: requestContext.id,
          method: requestContext.method,
          url: requestContext.url,
          headers: requestContext.headers,
          query: requestContext.query,
          body: requestContext.body,
          userAgent: requestContext.userAgent,
          ip: requestContext.ip,
          sessionId: requestContext.sessionId,
          userId: requestContext.userId,
          traceId: requestContext.traceId,
          timestamp: new Date(requestContext.startTime).toISOString()
        },
        response: {
          statusCode: responseContext.statusCode,
          headers: responseContext.headers,
          body: responseContext.body,
          size: responseContext.size,
          duration: responseContext.duration,
          timestamp: new Date(responseContext.endTime).toISOString()
        },
        error: error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : null,
        performance: {
          duration: responseContext.duration,
          slow: responseContext.duration > this.config.performance.slowRequestThreshold
        },
        security: {
          masked: this.config.security.maskSensitiveData,
          sensitiveDetected: this.detectSensitiveData(requestContext, responseContext)
        }
      },
      tags: this.generateTags(requestContext, responseContext, error),
      timestamp: new Date(requestContext.startTime),
      sequence: Date.now()
    };
  }

  private generateFamilyHash(requestContext: RequestContext): string {
    // Group similar requests together
    const path = requestContext.url.split('?')[0];
    const normalizedPath = path.replace(/\/\d+/g, '/{id}'); // Replace numeric IDs
    return `${requestContext.method}:${normalizedPath}`;
  }

  private generateTags(
    requestContext: RequestContext,
    responseContext: ResponseContext,
    error: Error | null
  ): string[] {
    const tags: string[] = ['request'];
    
    // Method tag
    tags.push(`method:${requestContext.method.toLowerCase()}`);
    
    // Status code tag
    tags.push(`status:${responseContext.statusCode}`);
    
    // Status category tags
    if (responseContext.statusCode >= 200 && responseContext.statusCode < 300) {
      tags.push('success');
    } else if (responseContext.statusCode >= 400 && responseContext.statusCode < 500) {
      tags.push('client-error');
    } else if (responseContext.statusCode >= 500) {
      tags.push('server-error');
    }
    
    // Performance tags
    if (responseContext.duration > this.config.performance.slowRequestThreshold) {
      tags.push('slow');
    }
    
    if (responseContext.duration < 100) {
      tags.push('fast');
    }
    
    // Authentication tags
    if (requestContext.userId) {
      tags.push('authenticated');
    } else {
      tags.push('anonymous');
    }
    
    // Session tags
    if (requestContext.sessionId) {
      tags.push('session');
    }
    
    // Error tags
    if (error) {
      tags.push('error');
      tags.push(`error:${error.name}`);
    }
    
    // Route tags
    const pathParts = requestContext.url.split('/').filter(part => part.length > 0);
    if (pathParts.length > 0) {
      tags.push(`route:${pathParts[0]}`);
    }
    
    return tags;
  }

  private detectSensitiveData(requestContext: RequestContext, responseContext: ResponseContext): boolean {
    const allData = JSON.stringify({
      query: requestContext.query,
      body: requestContext.body,
      responseBody: responseContext.body
    }).toLowerCase();
    
    return this.config.security.sensitiveKeys.some(key => 
      allData.includes(key.toLowerCase())
    );
  }

  private updateMetrics(
    requestContext: RequestContext,
    responseContext: ResponseContext,
    error: Error | null
  ): void {
    // Update basic counters
    this.requestMetrics.totalRequests++;
    
    if (responseContext.duration > this.config.performance.slowRequestThreshold) {
      this.requestMetrics.slowRequests++;
    }
    
    if (error || responseContext.statusCode >= 400) {
      this.requestMetrics.errorRequests++;
    }
    
    // Update status code distribution
    const statusCode = responseContext.statusCode;
    this.requestMetrics.statusCodeDistribution[statusCode] = 
      (this.requestMetrics.statusCodeDistribution[statusCode] || 0) + 1;
    
    // Update method distribution
    const method = requestContext.method;
    this.requestMetrics.methodDistribution[method] = 
      (this.requestMetrics.methodDistribution[method] || 0) + 1;
    
    // Update timeline for RPS calculation
    this.requestTimeline.push(requestContext.startTime);
    if (this.requestTimeline.length > this.maxTimelineSize) {
      this.requestTimeline.shift();
    }
    
    // Recalculate average response time
    this.recalculateAverageResponseTime(responseContext.duration);
    
    // Recalculate requests per second
    this.recalculateRequestsPerSecond();
  }

  private recalculateAverageResponseTime(newDuration: number): void {
    const totalRequests = this.requestMetrics.totalRequests;
    const oldAverage = this.requestMetrics.averageResponseTime;
    
    this.requestMetrics.averageResponseTime = 
      ((oldAverage * (totalRequests - 1)) + newDuration) / totalRequests;
  }

  private recalculateRequestsPerSecond(): void {
    if (this.requestTimeline.length < 2) {
      this.requestMetrics.requestsPerSecond = 0;
      return;
    }
    
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentRequests = this.requestTimeline.filter(timestamp => timestamp > oneMinuteAgo);
    
    this.requestMetrics.requestsPerSecond = recentRequests.length / 60;
  }

  shouldTrackRequest(request: Request): boolean {
    if (!this.config.enabled) {
      return false;
    }

    // Check method filter
    if (this.config.filters.methods.length > 0) {
      if (!this.config.filters.methods.includes(request.method)) {
        return false;
      }
    }

    return true;
  }

  shouldSampleRequest(request: Request): boolean {
    if (!this.config.sampling.enabled) {
      return true;
    }

    // Find applicable sampling rules
    const applicableRules = this.config.sampling.rules
      .filter(rule => this.matchesRule(request, rule))
      .sort((a, b) => b.priority - a.priority);

    // Use the highest priority rule
    const rule = applicableRules[0];
    const sampleRate = rule ? rule.rate : this.config.sampling.rate;

    return Math.random() * 100 < sampleRate;
  }

  private matchesRule(request: Request, rule: SamplingRule): boolean {
    // Check path
    if (!request.path.startsWith(rule.path)) {
      return false;
    }

    // Check method
    if (rule.method && request.method !== rule.method) {
      return false;
    }

    // Note: statusCode check would happen after response
    return true;
  }

  shouldMaskBody(body: any): boolean {
    if (!this.config.security.maskSensitiveData) {
      return false;
    }

    if (!body || typeof body !== 'object') {
      return false;
    }

    // Check if body contains sensitive data
    const bodyString = JSON.stringify(body).toLowerCase();
    return this.config.security.sensitiveKeys.some(key => 
      bodyString.includes(key.toLowerCase())
    );
  }

  shouldLogSuccessfulResponseBodies(): boolean {
    return this.config.security.logSuccessfulResponseBodies;
  }

  getExcludedPaths(): string[] {
    return this.config.excludePaths;
  }

  getMetrics(): RequestMetrics {
    return { ...this.requestMetrics };
  }

  getConfig(): RequestWatcherConfig {
    return { ...this.config };
  }

  resetMetrics(): void {
    Object.assign(this.requestMetrics, this.initializeMetrics());
    this.requestTimeline.length = 0;
  }
}
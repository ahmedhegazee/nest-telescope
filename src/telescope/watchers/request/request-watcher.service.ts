import { Injectable, Logger, Inject } from '@nestjs/common';
import { Request } from 'express';
import { TelescopeService } from '../../core/services/telescope.service';
import { TelescopeEntry } from '../../core/interfaces/telescope-entry.interface';
import { TelescopeConfig } from '../../core/interfaces/telescope-config.interface';
import { RequestContext, ResponseContext } from './request-watcher.interceptor';
import { DataMaskingService } from '../../core/services/data-masking.service';
import { EnhancedCircuitBreakerService } from '../../core/services/enhanced-circuit-breaker.service';
import { EnhancedMemoryManagerService } from '../../core/services/enhanced-memory-manager.service';
import { AdaptiveSamplingService } from '../../core/services/adaptive-sampling.service';

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

  constructor(
    private readonly telescopeService: TelescopeService,
    @Inject('TELESCOPE_CONFIG') private readonly telescopeConfig: TelescopeConfig,
    private readonly dataMaskingService: DataMaskingService,
    private readonly circuitBreakerService: EnhancedCircuitBreakerService,
    private readonly memoryManagerService: EnhancedMemoryManagerService,
    private readonly adaptiveSamplingService: AdaptiveSamplingService,
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
        '/assets',
      ],
      sampling: {
        enabled: true,
        rate: 100,
        rules: [
          { path: '/api/health', rate: 10, priority: 1 },
          { path: '/api/metrics', rate: 10, priority: 1 },
          { path: '/api', method: 'GET', rate: 50, priority: 2 },
          { path: '/api', method: 'POST', rate: 100, priority: 3 },
          { path: '/api', statusCode: 500, rate: 100, priority: 4 },
        ],
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
          'authorization',
          'credential',
          'pin',
          'ssn',
          'social',
          'card',
          'account',
        ],
      },
      performance: {
        slowRequestThreshold: 1000,
        collectMetrics: true,
      },
      filters: {
        methods: [],
        statusCodes: [],
        contentTypes: [],
      },
    };

    const mergedConfig = {
      ...defaultConfig,
      ...config.watchers?.request,
    } as RequestWatcherConfig;

    // Ensure sampling rules are preserved
    if (config.watchers?.request?.sampling && !(config.watchers.request.sampling as any).rules) {
      (mergedConfig.sampling as any).rules = defaultConfig.sampling.rules;
    }

    return mergedConfig;
  }

  private initializeMetrics(): RequestMetrics {
    return {
      totalRequests: 0,
      slowRequests: 0,
      errorRequests: 0,
      averageResponseTime: 0,
      requestsPerSecond: 0,
      statusCodeDistribution: {},
      methodDistribution: {},
    };
  }

  async trackRequest(
    requestContext: RequestContext,
    responseContext: ResponseContext,
    error: Error | null,
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Use circuit breaker for tracking operations
    await this.circuitBreakerService.executeWithFallback(
      'trackRequest',
      async () => {
        // Check sampling decision
        if (!this.adaptiveSamplingService.shouldSample(requestContext, error || undefined)) {
          return;
        }

        // Create telescope entry with enhanced security
        const entry = await this.createTelescopeEntry(requestContext, responseContext, error);

        // Record the request with buffering
        await this.telescopeService.record(entry);

        // Update metrics with memory management
        if (this.config.performance.collectMetrics) {
          await this.updateMetrics(requestContext, responseContext, error);
        }

        // Log slow requests
        if (responseContext.duration > this.config.performance.slowRequestThreshold) {
          this.logger.warn(
            `Slow request detected: ${requestContext.method} ${requestContext.url} (${responseContext.duration}ms)`,
          );
        }

        // Log errors with safe data masking
        if (error || responseContext.statusCode >= 400) {
          const safeSummary = this.dataMaskingService.createSafeSummary({
            method: requestContext.method,
            url: requestContext.url,
            statusCode: responseContext.statusCode,
            error: error?.message,
          });
          this.logger.warn(`Request error: ${safeSummary}`);
        }
      },
      async () => {
        // Fallback: log error but don't fail the request
        this.logger.warn(
          `Request tracking failed, using fallback for: ${requestContext.method} ${requestContext.url}`,
        );

        // Still update basic metrics in memory
        this.memoryManagerService.addTimelineEntry('request-tracking-failures', {
          method: requestContext.method,
          url: requestContext.url,
          timestamp: Date.now(),
          reason: 'circuit-breaker-fallback',
        });
      },
    );
  }

  private async createTelescopeEntry(
    requestContext: RequestContext,
    responseContext: ResponseContext,
    error: Error | null,
  ): Promise<TelescopeEntry> {
    const entryId = `req_${requestContext.id}`;
    const familyHash = this.generateFamilyHash(requestContext);

    // Enhanced data masking
    const maskedRequestData = this.config.security.maskSensitiveData
      ? this.dataMaskingService.maskSensitiveData({
          headers: requestContext.headers,
          query: requestContext.query,
          body: requestContext.body,
        })
      : {
          headers: requestContext.headers,
          query: requestContext.query,
          body: requestContext.body,
        };

    const maskedResponseData = this.config.security.maskSensitiveData
      ? this.dataMaskingService.maskSensitiveData({
          headers: responseContext.headers,
          body: responseContext.body,
        })
      : {
          headers: responseContext.headers,
          body: responseContext.body,
        };

    return {
      id: entryId,
      type: 'request',
      familyHash,
      content: {
        request: {
          id: requestContext.id,
          method: requestContext.method,
          url: requestContext.url,
          headers: maskedRequestData.headers,
          query: maskedRequestData.query,
          body: maskedRequestData.body,
          userAgent: requestContext.userAgent,
          ip: requestContext.ip,
          sessionId: requestContext.sessionId,
          userId: requestContext.userId,
          traceId: requestContext.traceId,
          timestamp: new Date(requestContext.startTime).toISOString(),
        },
        response: {
          statusCode: responseContext.statusCode,
          headers: maskedResponseData.headers,
          body: maskedResponseData.body,
          size: responseContext.size,
          duration: responseContext.duration,
          timestamp: new Date(responseContext.endTime).toISOString(),
        },
        error: error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : null,
        performance: {
          duration: responseContext.duration,
          slow: responseContext.duration > this.config.performance.slowRequestThreshold,
        },
        security: {
          masked: this.config.security.maskSensitiveData,
          sensitiveDetected: this.dataMaskingService.detectSensitiveData({
            request: requestContext,
            response: responseContext,
          }),
        },
      },
      tags: this.generateTags(requestContext, responseContext, error),
      timestamp: new Date(requestContext.startTime),
      sequence: Date.now(),
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
    error: Error | null,
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
      tags.push(`error-type:${error.name}`);
    }

    // Sensitive data tag
    if (
      this.dataMaskingService.detectSensitiveData({
        request: requestContext,
        response: responseContext,
      })
    ) {
      tags.push('sensitive-data');
    }

    return tags;
  }

  private async updateMetrics(
    requestContext: RequestContext,
    responseContext: ResponseContext,
    error: Error | null,
  ): Promise<void> {
    try {
      // Update basic metrics
      this.requestMetrics.totalRequests++;

      if (responseContext.duration > this.config.performance.slowRequestThreshold) {
        this.requestMetrics.slowRequests++;
      }

      if (error || responseContext.statusCode >= 400) {
        this.requestMetrics.errorRequests++;
      }

      // Update status code distribution
      this.requestMetrics.statusCodeDistribution[responseContext.statusCode] =
        (this.requestMetrics.statusCodeDistribution[responseContext.statusCode] || 0) + 1;

      // Update method distribution
      this.requestMetrics.methodDistribution[requestContext.method] =
        (this.requestMetrics.methodDistribution[requestContext.method] || 0) + 1;

      // Calculate average response time
      const totalTime =
        this.requestMetrics.averageResponseTime * (this.requestMetrics.totalRequests - 1);
      this.requestMetrics.averageResponseTime =
        (totalTime + responseContext.duration) / this.requestMetrics.totalRequests;

      // Store metrics in memory manager with TTL
      this.memoryManagerService.addMetricsEntry(
        'request-metrics',
        {
          url: requestContext.url,
          method: requestContext.method,
          statusCode: responseContext.statusCode,
          duration: responseContext.duration,
          error: error ? error.message : null,
        },
        this.config.performance.collectMetrics ? 300000 : undefined, // 5 minutes TTL
      );

      // Add to timeline for analysis
      this.memoryManagerService.addTimelineEntry('requests', {
        method: requestContext.method,
        url: requestContext.url,
        duration: responseContext.duration,
        statusCode: responseContext.statusCode,
        timestamp: Date.now(),
      });
    } catch (metricsError) {
      this.logger.error('Failed to update request metrics:', metricsError);
    }
  }

  getMetrics(): RequestMetrics & {
    samplingStats: any;
    memoryStats: any;
    circuitBreakerStats: any;
  } {
    return {
      ...this.requestMetrics,
      samplingStats: this.adaptiveSamplingService.getStats(),
      memoryStats: this.memoryManagerService.getMemoryStats(),
      circuitBreakerStats: this.circuitBreakerService.getAllStats(),
    };
  }

  async clearMetrics(): Promise<void> {
    // Reset internal metrics
    Object.assign(this.requestMetrics, this.initializeMetrics());

    // Clear memory manager data
    this.memoryManagerService.clearAll();

    // Reset sampling stats
    this.adaptiveSamplingService.resetStats();

    this.logger.debug('Request metrics cleared');
  }

  // Methods required by the interceptor
  getExcludedPaths(): string[] {
    return this.config.excludePaths;
  }

  shouldSampleRequest(request: any): boolean {
    if (!this.config.sampling.enabled) {
      return true;
    }

    // Check if request matches any sampling rules
    const matchingRule = this.config.sampling.rules.find((rule) => {
      if (rule.path && !request.url.includes(rule.path)) return false;
      if (rule.method && rule.method !== request.method) return false;
      return true;
    });

    if (matchingRule) {
      return Math.random() * 100 < matchingRule.rate;
    }

    return Math.random() * 100 < this.config.sampling.rate;
  }

  shouldMaskBody(body: any): boolean {
    return this.config.security.maskSensitiveData;
  }

  shouldLogSuccessfulResponseBodies(): boolean {
    return this.config.security.logSuccessfulResponseBodies;
  }
}

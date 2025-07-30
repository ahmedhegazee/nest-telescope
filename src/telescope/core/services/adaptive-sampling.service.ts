import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../../watchers/request/request-watcher.interceptor';

export interface SamplingConfig {
  enabled: boolean;
  baseSampleRate: number;
  adaptiveEnabled: boolean;
  loadBasedSampling: boolean;
  errorSamplingMultiplier: number;
  healthCheckSampleRate: number;
  maxSampleRate: number;
  minSampleRate: number;
}

export interface SamplingRule {
  path: string;
  method?: string;
  statusCode?: number;
  rate: number;
  priority: number;
  conditions?: SamplingCondition[];
}

export interface SamplingCondition {
  type: 'header' | 'query' | 'body' | 'user' | 'time' | 'load';
  key?: string;
  value?: any;
  operator: 'equals' | 'contains' | 'greater' | 'less' | 'regex';
}

export interface SamplingStats {
  totalRequests: number;
  sampledRequests: number;
  currentSampleRate: number;
  effectiveSampleRate: number;
  loadFactor: number;
  errorRate: number;
  lastAdaptation: number;
}

interface LoadMetrics {
  requestCount: number;
  errorCount: number;
  averageResponseTime: number;
  timestamp: number;
}

@Injectable()
export class AdaptiveSamplingService {
  private readonly logger = new Logger(AdaptiveSamplingService.name);
  
  private readonly config: SamplingConfig;
  private readonly samplingRules: SamplingRule[] = [];
  private readonly loadHistory: LoadMetrics[] = [];
  private readonly stats: SamplingStats;
  
  private readonly maxHistorySize = 100;
  private readonly loadCalculationWindow = 60000; // 1 minute

  constructor(config: Partial<SamplingConfig> = {}) {
    this.config = {
      enabled: true,
      baseSampleRate: 100,
      adaptiveEnabled: true,
      loadBasedSampling: true,
      errorSamplingMultiplier: 2.0,
      healthCheckSampleRate: 1,
      maxSampleRate: 100,
      minSampleRate: 1,
      ...config
    };

    this.stats = {
      totalRequests: 0,
      sampledRequests: 0,
      currentSampleRate: this.config.baseSampleRate,
      effectiveSampleRate: this.config.baseSampleRate,
      loadFactor: 0,
      errorRate: 0,
      lastAdaptation: Date.now()
    };

    this.initializeDefaultRules();
    this.logger.debug('Adaptive Sampling Service initialized', this.config);
  }

  /**
   * Determine if request should be sampled
   */
  shouldSample(context: RequestContext, error?: Error): boolean {
    if (!this.config.enabled) {
      return true;
    }

    this.stats.totalRequests++;

    try {
      // Calculate sample rate for this request
      const sampleRate = this.calculateSampleRate(context, error);
      
      // Make sampling decision
      const shouldSample = Math.random() * 100 < sampleRate;
      
      if (shouldSample) {
        this.stats.sampledRequests++;
      }

      // Update metrics for adaptive sampling
      this.updateLoadMetrics(context, error);
      
      // Adapt sampling rate if needed
      if (this.config.adaptiveEnabled) {
        this.adaptSamplingRate();
      }

      return shouldSample;
    } catch (error) {
      this.logger.error('Error in sampling decision:', error);
      return true; // Default to sampling on error
    }
  }

  /**
   * Calculate sample rate for specific request
   */
  calculateSampleRate(context: RequestContext, error?: Error): number {
    let sampleRate = this.config.baseSampleRate;

    try {
      // Apply rule-based sampling
      const ruleRate = this.applyRules(context);
      if (ruleRate !== null) {
        sampleRate = ruleRate;
      }

      // Apply error-based sampling
      if (error) {
        sampleRate *= this.config.errorSamplingMultiplier;
      }

      // Apply load-based sampling
      if (this.config.loadBasedSampling) {
        const loadFactor = this.getCurrentLoadFactor();
        sampleRate = this.adjustForLoad(sampleRate, loadFactor);
      }

      // Apply adaptive adjustments
      if (this.config.adaptiveEnabled) {
        sampleRate = this.applyAdaptiveAdjustments(sampleRate, context);
      }

      // Ensure within bounds
      sampleRate = Math.max(this.config.minSampleRate, Math.min(this.config.maxSampleRate, sampleRate));

      return sampleRate;
    } catch (error) {
      this.logger.error('Error calculating sample rate:', error);
      return this.config.baseSampleRate;
    }
  }

  /**
   * Add sampling rule
   */
  addRule(rule: SamplingRule): void {
    this.samplingRules.push(rule);
    this.samplingRules.sort((a, b) => b.priority - a.priority);
    this.logger.debug('Sampling rule added:', rule);
  }

  /**
   * Remove sampling rule
   */
  removeRule(path: string, method?: string): void {
    const index = this.samplingRules.findIndex(rule => 
      rule.path === path && rule.method === method
    );
    
    if (index >= 0) {
      this.samplingRules.splice(index, 1);
      this.logger.debug('Sampling rule removed:', { path, method });
    }
  }

  /**
   * Get sampling statistics
   */
  getStats(): SamplingStats {
    this.updateEffectiveSampleRate();
    return { ...this.stats };
  }

  /**
   * Get current sampling rules
   */
  getRules(): SamplingRule[] {
    return [...this.samplingRules];
  }

  /**
   * Reset sampling statistics
   */
  resetStats(): void {
    this.stats.totalRequests = 0;
    this.stats.sampledRequests = 0;
    this.stats.effectiveSampleRate = this.config.baseSampleRate;
    this.stats.lastAdaptation = Date.now();
    this.loadHistory.splice(0);
    
    this.logger.debug('Sampling statistics reset');
  }

  private initializeDefaultRules(): void {
    const defaultRules: SamplingRule[] = [
      {
        path: '/health',
        rate: this.config.healthCheckSampleRate,
        priority: 10
      },
      {
        path: '/metrics',
        rate: this.config.healthCheckSampleRate,
        priority: 10
      },
      {
        path: '/api/health',
        rate: this.config.healthCheckSampleRate,
        priority: 10
      },
      {
        path: '/favicon.ico',
        rate: 0,
        priority: 9
      },
      {
        path: '/robots.txt',
        rate: 0,
        priority: 9
      },
      {
        path: '/api',
        method: 'GET',
        rate: 50,
        priority: 5
      },
      {
        path: '/api',
        method: 'POST',
        rate: 100,
        priority: 6
      },
      {
        path: '/api',
        method: 'PUT',
        rate: 100,
        priority: 6
      },
      {
        path: '/api',
        method: 'DELETE',
        rate: 100,
        priority: 7
      }
    ];

    this.samplingRules.push(...defaultRules);
  }

  private applyRules(context: RequestContext): number | null {
    for (const rule of this.samplingRules) {
      if (this.matchesRule(context, rule)) {
        return rule.rate;
      }
    }
    return null;
  }

  private matchesRule(context: RequestContext, rule: SamplingRule): boolean {
    // Check path
    if (!this.matchesPath(context.url, rule.path)) {
      return false;
    }

    // Check method
    if (rule.method && context.method !== rule.method) {
      return false;
    }

    // Check additional conditions
    if (rule.conditions) {
      return rule.conditions.every(condition => this.matchesCondition(context, condition));
    }

    return true;
  }

  private matchesPath(url: string, pattern: string): boolean {
    // Simple pattern matching - could be enhanced with regex support
    const path = url.split('?')[0];
    
    if (pattern.includes('*')) {
      const regexPattern = pattern.replace(/\*/g, '.*');
      return new RegExp(`^${regexPattern}`).test(path);
    }
    
    return path.startsWith(pattern);
  }

  private matchesCondition(context: RequestContext, condition: SamplingCondition): boolean {
    try {
      let value: any;

      switch (condition.type) {
        case 'header':
          value = context.headers[condition.key || ''];
          break;
        case 'query':
          value = context.query[condition.key || ''];
          break;
        case 'user':
          value = context.userId;
          break;
        case 'time':
          value = Date.now();
          break;
        case 'load':
          value = this.getCurrentLoadFactor();
          break;
        default:
          return false;
      }

      return this.evaluateCondition(value, condition.value, condition.operator);
    } catch (error) {
      return false;
    }
  }

  private evaluateCondition(actual: any, expected: any, operator: string): boolean {
    switch (operator) {
      case 'equals':
        return actual === expected;
      case 'contains':
        return String(actual).includes(String(expected));
      case 'greater':
        return Number(actual) > Number(expected);
      case 'less':
        return Number(actual) < Number(expected);
      case 'regex':
        return new RegExp(expected).test(String(actual));
      default:
        return false;
    }
  }

  private adjustForLoad(sampleRate: number, loadFactor: number): number {
    // Reduce sampling when load is high
    if (loadFactor > 0.8) {
      return sampleRate * 0.5;
    } else if (loadFactor > 0.6) {
      return sampleRate * 0.7;
    } else if (loadFactor > 0.4) {
      return sampleRate * 0.9;
    }
    
    return sampleRate;
  }

  private applyAdaptiveAdjustments(sampleRate: number, context: RequestContext): number {
    // Increase sampling for errors
    const errorRate = this.getErrorRate();
    if (errorRate > 0.05) { // > 5% error rate
      sampleRate *= 1.5;
    }

    // Adjust based on response time patterns
    const avgResponseTime = this.getAverageResponseTime();
    if (avgResponseTime > 1000) { // > 1 second
      sampleRate *= 1.2;
    }

    return sampleRate;
  }

  private updateLoadMetrics(context: RequestContext, error?: Error): void {
    const now = Date.now();
    
    // Add current request to metrics
    const metrics: LoadMetrics = {
      requestCount: 1,
      errorCount: error ? 1 : 0,
      averageResponseTime: 0, // Will be updated when response completes
      timestamp: now
    };

    this.loadHistory.push(metrics);

    // Cleanup old metrics
    const cutoff = now - this.loadCalculationWindow;
    while (this.loadHistory.length > 0 && this.loadHistory[0].timestamp < cutoff) {
      this.loadHistory.shift();
    }

    // Enforce max history size
    if (this.loadHistory.length > this.maxHistorySize) {
      this.loadHistory.splice(0, this.loadHistory.length - this.maxHistorySize);
    }
  }

  private getCurrentLoadFactor(): number {
    if (this.loadHistory.length === 0) {
      return 0;
    }

    const now = Date.now();
    const recentMetrics = this.loadHistory.filter(m => now - m.timestamp < this.loadCalculationWindow);
    
    if (recentMetrics.length === 0) {
      return 0;
    }

    const totalRequests = recentMetrics.reduce((sum, m) => sum + m.requestCount, 0);
    const timeWindow = this.loadCalculationWindow / 1000; // Convert to seconds
    const requestsPerSecond = totalRequests / timeWindow;

    // Normalize to 0-1 scale (assuming 100 req/sec is high load)
    return Math.min(1, requestsPerSecond / 100);
  }

  private getErrorRate(): number {
    if (this.loadHistory.length === 0) {
      return 0;
    }

    const now = Date.now();
    const recentMetrics = this.loadHistory.filter(m => now - m.timestamp < this.loadCalculationWindow);
    
    if (recentMetrics.length === 0) {
      return 0;
    }

    const totalRequests = recentMetrics.reduce((sum, m) => sum + m.requestCount, 0);
    const totalErrors = recentMetrics.reduce((sum, m) => sum + m.errorCount, 0);

    return totalRequests > 0 ? totalErrors / totalRequests : 0;
  }

  private getAverageResponseTime(): number {
    if (this.loadHistory.length === 0) {
      return 0;
    }

    const now = Date.now();
    const recentMetrics = this.loadHistory.filter(m => now - m.timestamp < this.loadCalculationWindow);
    
    if (recentMetrics.length === 0) {
      return 0;
    }

    const totalResponseTime = recentMetrics.reduce((sum, m) => sum + m.averageResponseTime, 0);
    return totalResponseTime / recentMetrics.length;
  }

  private adaptSamplingRate(): void {
    const now = Date.now();
    const timeSinceLastAdaptation = now - this.stats.lastAdaptation;
    
    // Only adapt every 30 seconds
    if (timeSinceLastAdaptation < 30000) {
      return;
    }

    const loadFactor = this.getCurrentLoadFactor();
    const errorRate = this.getErrorRate();
    
    let newRate = this.config.baseSampleRate;

    // Adjust based on load
    if (loadFactor > 0.8) {
      newRate *= 0.5;
    } else if (loadFactor > 0.6) {
      newRate *= 0.7;
    }

    // Adjust based on error rate
    if (errorRate > 0.1) {
      newRate *= 1.5;
    } else if (errorRate > 0.05) {
      newRate *= 1.2;
    }

    // Ensure within bounds
    newRate = Math.max(this.config.minSampleRate, Math.min(this.config.maxSampleRate, newRate));

    if (Math.abs(newRate - this.stats.currentSampleRate) > 5) {
      this.stats.currentSampleRate = newRate;
      this.stats.lastAdaptation = now;
      this.stats.loadFactor = loadFactor;
      this.stats.errorRate = errorRate;
      
      this.logger.debug(`Adaptive sampling rate adjusted to ${newRate}% (load: ${loadFactor.toFixed(2)}, error: ${errorRate.toFixed(2)})`);
    }
  }

  private updateEffectiveSampleRate(): void {
    if (this.stats.totalRequests > 0) {
      this.stats.effectiveSampleRate = (this.stats.sampledRequests / this.stats.totalRequests) * 100;
    }
  }
}
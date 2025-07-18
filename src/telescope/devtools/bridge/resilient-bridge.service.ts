import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { StreamProcessingBridgeService } from './stream-processing-bridge.service';
import { CircuitBreaker, CircuitBreakerFactory, CircuitBreakerRegistry, CircuitBreakerOpenError } from './circuit-breaker';
import { TelescopeConfig } from '../../core/interfaces/telescope-config.interface';
import { TelescopeEntry } from '../../core/interfaces/telescope-entry.interface';
import { BatchResult } from '../../core/services/metrics.service';

export interface ResilientBridgeConfig {
  circuitBreakerEnabled: boolean;
  fallbackEnabled: boolean;
  maxRetries: number;
  retryDelayMs: number;
  healthCheckIntervalMs: number;
}

export interface BridgeHealthStatus {
  isHealthy: boolean;
  issues: string[];
  circuitBreakers: Record<string, any>;
  streamMetrics: any;
  lastHealthCheckAt: Date;
}

@Injectable()
export class ResilientBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResilientBridgeService.name);
  private readonly circuitBreakerRegistry = new CircuitBreakerRegistry();
  private healthCheckInterval?: NodeJS.Timeout;
  private lastHealthStatus?: BridgeHealthStatus;
  
  private readonly config: ResilientBridgeConfig = {
    circuitBreakerEnabled: true,
    fallbackEnabled: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    healthCheckIntervalMs: 30000
  };

  constructor(
    private readonly streamBridge: StreamProcessingBridgeService,
    @Inject('TELESCOPE_CONFIG') private readonly telescopeConfig: TelescopeConfig
  ) {
    this.updateConfig(telescopeConfig);
  }

  async onModuleInit(): Promise<void> {
    if (this.config.circuitBreakerEnabled) {
      this.setupCircuitBreakers();
    }
    
    this.startHealthChecks();
    this.logger.log('Resilient bridge service initialized');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.circuitBreakerRegistry.clear();
    this.logger.log('Resilient bridge service destroyed');
  }

  private updateConfig(config: TelescopeConfig): void {
    if (config.devtools?.bridge?.resilience) {
      const resilienceConfig = config.devtools.bridge.resilience;
      this.config.circuitBreakerEnabled = resilienceConfig.circuitBreakerEnabled ?? true;
      this.config.fallbackEnabled = resilienceConfig.fallbackEnabled ?? true;
      this.config.maxRetries = resilienceConfig.maxRetries ?? 3;
      this.config.retryDelayMs = resilienceConfig.retryDelayMs ?? 1000;
      this.config.healthCheckIntervalMs = resilienceConfig.healthCheckIntervalMs ?? 30000;
    }
  }

  private setupCircuitBreakers(): void {
    // Storage circuit breaker
    const storageBreaker = CircuitBreakerFactory.createForStorage('storage-primary');
    this.circuitBreakerRegistry.register('storage', storageBreaker);

    // DevTools circuit breaker
    const devToolsBreaker = CircuitBreakerFactory.createForDevTools('devtools-processing');
    this.circuitBreakerRegistry.register('devtools', devToolsBreaker);

    // Network circuit breaker for external dependencies
    const networkBreaker = CircuitBreakerFactory.createForNetwork('network-external');
    this.circuitBreakerRegistry.register('network', networkBreaker);

    // Stream processing circuit breaker
    const streamBreaker = CircuitBreakerFactory.createCustom({
      name: 'stream-processing',
      failureThreshold: 5,
      timeout: 10000,
      resetTimeout: 30000,
      onOpen: (breaker) => {
        this.logger.warn('Stream processing circuit breaker opened');
        this.handleStreamProcessingFailure();
      },
      onHalfOpen: (breaker) => this.logger.info('Stream processing circuit breaker half-open'),
      onClose: (breaker) => this.logger.info('Stream processing circuit breaker closed')
    });
    this.circuitBreakerRegistry.register('stream', streamBreaker);

    this.logger.log('Circuit breakers initialized');
  }

  private handleStreamProcessingFailure(): void {
    if (this.config.fallbackEnabled) {
      this.logger.warn('Stream processing failed, activating fallback mode');
      // Implement fallback logic here - could be switching to sync processing
    }
  }

  private startHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckIntervalMs);

    // Perform initial health check
    this.performHealthCheck();
  }

  private performHealthCheck(): void {
    try {
      const streamMetrics = this.streamBridge.getStreamMetrics();
      const circuitBreakerStatus = this.circuitBreakerRegistry.getHealthStatus();
      const streamHealth = this.streamBridge.getHealthStatus();
      
      const issues: string[] = [];
      
      // Check circuit breaker health
      if (circuitBreakerStatus.unhealthy > 0) {
        issues.push(`${circuitBreakerStatus.unhealthy} circuit breakers are unhealthy`);
      }
      
      // Check stream health
      if (!streamHealth.isHealthy) {
        issues.push(...streamHealth.issues);
      }
      
      // Check metrics health
      if (streamMetrics.errorCount > 50) {
        issues.push(`High error count: ${streamMetrics.errorCount}`);
      }
      
      if (streamMetrics.averageProcessingTime > 10000) {
        issues.push(`High average processing time: ${streamMetrics.averageProcessingTime}ms`);
      }

      this.lastHealthStatus = {
        isHealthy: issues.length === 0,
        issues,
        circuitBreakers: circuitBreakerStatus.details,
        streamMetrics,
        lastHealthCheckAt: new Date()
      };

      if (!this.lastHealthStatus.isHealthy) {
        this.logger.warn('Health check failed:', issues);
      } else {
        this.logger.debug('Health check passed');
      }
    } catch (error) {
      this.logger.error('Health check failed:', error);
    }
  }

  // Main entry point for processing DevTools entries with full resilience
  async processDevToolsEntryWithResilience(entry: any, type: string): Promise<void> {
    const streamBreaker = this.circuitBreakerRegistry.get('stream');
    
    if (!streamBreaker) {
      // Circuit breaker disabled, use direct processing
      return this.processWithRetry(entry, type);
    }

    try {
      return await streamBreaker.execute(async () => {
        return this.processWithRetry(entry, type);
      });
    } catch (error) {
      if (error instanceof CircuitBreakerOpenError) {
        this.logger.warn('Circuit breaker open, attempting fallback processing');
        return this.fallbackProcessing(entry, type);
      }
      throw error;
    }
  }

  private async processWithRetry(entry: any, type: string): Promise<void> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.streamBridge.processDevToolsEntry(entry, type);
        return; // Success
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Processing attempt ${attempt} failed: ${error.message}`);
        
        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          await this.delay(delay);
        }
      }
    }
    
    throw lastError;
  }

  private async fallbackProcessing(entry: any, type: string): Promise<void> {
    if (!this.config.fallbackEnabled) {
      throw new Error('Fallback processing disabled');
    }

    try {
      // Simplified fallback processing - just log and store basic info
      this.logger.info(`Fallback processing for ${type} entry: ${entry.id || 'unknown'}`);
      
      // Could implement basic storage here or queue for later processing
      // For now, just log the entry
      this.logger.debug('Fallback entry:', { type, id: entry.id, timestamp: new Date() });
      
    } catch (error) {
      this.logger.error('Fallback processing failed:', error);
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public API for monitoring and management
  getHealthStatus(): BridgeHealthStatus {
    return this.lastHealthStatus || {
      isHealthy: false,
      issues: ['Health check not yet performed'],
      circuitBreakers: {},
      streamMetrics: {},
      lastHealthCheckAt: new Date()
    };
  }

  getCircuitBreakerStatus(): Record<string, any> {
    return this.circuitBreakerRegistry.getAllStates();
  }

  getStreamMetrics(): any {
    return this.streamBridge.getStreamMetrics();
  }

  getStreamConfiguration(): any {
    return this.streamBridge.getStreamConfiguration();
  }

  // Manual circuit breaker control
  openCircuitBreaker(name: string): void {
    const breaker = this.circuitBreakerRegistry.get(name);
    if (breaker) {
      breaker.forceOpen();
      this.logger.warn(`Circuit breaker ${name} manually opened`);
    }
  }

  closeCircuitBreaker(name: string): void {
    const breaker = this.circuitBreakerRegistry.get(name);
    if (breaker) {
      breaker.forceClose();
      this.logger.log(`Circuit breaker ${name} manually closed`);
    }
  }

  resetCircuitBreaker(name: string): void {
    const breaker = this.circuitBreakerRegistry.get(name);
    if (breaker) {
      breaker.reset();
      this.logger.log(`Circuit breaker ${name} reset`);
    }
  }

  resetAllCircuitBreakers(): void {
    this.circuitBreakerRegistry.resetAll();
    this.logger.log('All circuit breakers reset');
  }

  // Force flush stream buffer
  async flushStreamBuffer(): Promise<void> {
    await this.streamBridge.flushBuffer();
  }

  // Update stream configuration at runtime
  updateStreamConfiguration(config: any): void {
    this.streamBridge.updateStreamConfiguration(config);
  }

  // Get comprehensive status for monitoring
  getComprehensiveStatus(): {
    bridge: BridgeHealthStatus;
    circuitBreakers: Record<string, any>;
    streamMetrics: any;
    configuration: {
      resilience: ResilientBridgeConfig;
      stream: any;
    };
  } {
    return {
      bridge: this.getHealthStatus(),
      circuitBreakers: this.getCircuitBreakerStatus(),
      streamMetrics: this.getStreamMetrics(),
      configuration: {
        resilience: this.config,
        stream: this.getStreamConfiguration()
      }
    };
  }
}
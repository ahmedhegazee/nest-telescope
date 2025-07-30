import { Injectable, Logger } from '@nestjs/common';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringWindow: number;
  minimumRequests: number;
  successThreshold: number;
}

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN', 
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  totalRequests: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  nextAttemptTime: number | null;
}

@Injectable()
export class EnhancedCircuitBreakerService {
  private readonly logger = new Logger(EnhancedCircuitBreakerService.name);
  private readonly circuitBreakers = new Map<string, CircuitBreakerStats>();
  private readonly requestHistory = new Map<string, Array<{ timestamp: number; success: boolean }>>();

  private readonly defaultConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    recoveryTimeout: 30000, // 30 seconds
    monitoringWindow: 60000, // 1 minute
    minimumRequests: 3,
    successThreshold: 3
  };

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(
    operationName: string,
    operation: () => Promise<T>,
    config: Partial<CircuitBreakerConfig> = {}
  ): Promise<T> {
    const finalConfig = { ...this.defaultConfig, ...config };
    const stats = this.getOrCreateStats(operationName);

    // Check if circuit breaker allows execution
    if (!this.canExecute(operationName, finalConfig)) {
      throw new Error(`Circuit breaker is OPEN for operation: ${operationName}`);
    }

    const startTime = Date.now();

    try {
      const result = await operation();
      
      // Record success
      this.recordSuccess(operationName, finalConfig);
      
      this.logger.debug(`Circuit breaker operation succeeded: ${operationName} (${Date.now() - startTime}ms)`);
      
      return result;
    } catch (error) {
      // Record failure
      this.recordFailure(operationName, finalConfig);
      
      this.logger.warn(`Circuit breaker operation failed: ${operationName} (${Date.now() - startTime}ms)`, error.message);
      
      throw error;
    }
  }

  /**
   * Execute operation with fallback
   */
  async executeWithFallback<T>(
    operationName: string,
    operation: () => Promise<T>,
    fallback: () => Promise<T>,
    config: Partial<CircuitBreakerConfig> = {}
  ): Promise<T> {
    try {
      return await this.execute(operationName, operation, config);
    } catch (error) {
      this.logger.warn(`Primary operation failed, executing fallback: ${operationName}`, error.message);
      
      try {
        return await fallback();
      } catch (fallbackError) {
        this.logger.error(`Both primary and fallback operations failed: ${operationName}`, fallbackError.message);
        throw fallbackError;
      }
    }
  }

  /**
   * Check if operation can be executed
   */
  canExecute(operationName: string, config: CircuitBreakerConfig): boolean {
    const stats = this.getOrCreateStats(operationName);
    const now = Date.now();

    switch (stats.state) {
      case CircuitBreakerState.CLOSED:
        return true;

      case CircuitBreakerState.OPEN:
        if (stats.nextAttemptTime && now >= stats.nextAttemptTime) {
          // Move to half-open state
          stats.state = CircuitBreakerState.HALF_OPEN;
          stats.successCount = 0;
          stats.failureCount = 0;
          this.logger.debug(`Circuit breaker moved to HALF_OPEN: ${operationName}`);
          return true;
        }
        return false;

      case CircuitBreakerState.HALF_OPEN:
        return true;

      default:
        return false;
    }
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(operationName: string): CircuitBreakerStats | null {
    return this.circuitBreakers.get(operationName) || null;
  }

  /**
   * Get all circuit breaker statistics
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, stat] of this.circuitBreakers.entries()) {
      stats[name] = { ...stat };
    }
    return stats;
  }

  /**
   * Reset circuit breaker for an operation
   */
  reset(operationName: string): void {
    const stats = this.circuitBreakers.get(operationName);
    if (stats) {
      stats.state = CircuitBreakerState.CLOSED;
      stats.failureCount = 0;
      stats.successCount = 0;
      stats.totalRequests = 0;
      stats.lastFailureTime = null;
      stats.lastSuccessTime = null;
      stats.nextAttemptTime = null;
      
      // Clear history
      this.requestHistory.delete(operationName);
      
      this.logger.debug(`Circuit breaker reset: ${operationName}`);
    }
  }

  /**
   * Force open circuit breaker
   */
  forceOpen(operationName: string, recoveryTimeout?: number): void {
    const stats = this.getOrCreateStats(operationName);
    stats.state = CircuitBreakerState.OPEN;
    stats.nextAttemptTime = Date.now() + (recoveryTimeout || this.defaultConfig.recoveryTimeout);
    
    this.logger.warn(`Circuit breaker forced OPEN: ${operationName}`);
  }

  /**
   * Force close circuit breaker
   */
  forceClose(operationName: string): void {
    const stats = this.getOrCreateStats(operationName);
    stats.state = CircuitBreakerState.CLOSED;
    stats.failureCount = 0;
    stats.nextAttemptTime = null;
    
    this.logger.debug(`Circuit breaker forced CLOSED: ${operationName}`);
  }

  private getOrCreateStats(operationName: string): CircuitBreakerStats {
    let stats = this.circuitBreakers.get(operationName);
    
    if (!stats) {
      stats = {
        state: CircuitBreakerState.CLOSED,
        failureCount: 0,
        successCount: 0,
        totalRequests: 0,
        lastFailureTime: null,
        lastSuccessTime: null,
        nextAttemptTime: null
      };
      
      this.circuitBreakers.set(operationName, stats);
      this.requestHistory.set(operationName, []);
    }
    
    return stats;
  }

  private recordSuccess(operationName: string, config: CircuitBreakerConfig): void {
    const stats = this.getOrCreateStats(operationName);
    const history = this.requestHistory.get(operationName)!;
    const now = Date.now();

    stats.successCount++;
    stats.totalRequests++;
    stats.lastSuccessTime = now;

    // Add to history
    history.push({ timestamp: now, success: true });
    this.cleanupHistory(operationName, config.monitoringWindow);

    // State transition logic
    switch (stats.state) {
      case CircuitBreakerState.HALF_OPEN:
        if (stats.successCount >= config.successThreshold) {
          stats.state = CircuitBreakerState.CLOSED;
          stats.failureCount = 0;
          stats.successCount = 0;
          this.logger.debug(`Circuit breaker moved to CLOSED: ${operationName}`);
        }
        break;

      case CircuitBreakerState.OPEN:
        // Should not happen, but handle gracefully
        stats.state = CircuitBreakerState.CLOSED;
        stats.failureCount = 0;
        this.logger.debug(`Circuit breaker unexpectedly recovered to CLOSED: ${operationName}`);
        break;
    }
  }

  private recordFailure(operationName: string, config: CircuitBreakerConfig): void {
    const stats = this.getOrCreateStats(operationName);
    const history = this.requestHistory.get(operationName)!;
    const now = Date.now();

    stats.failureCount++;
    stats.totalRequests++;
    stats.lastFailureTime = now;

    // Add to history
    history.push({ timestamp: now, success: false });
    this.cleanupHistory(operationName, config.monitoringWindow);

    // Check if we should open the circuit
    const recentRequests = this.getRecentRequests(operationName, config.monitoringWindow);
    const recentFailures = recentRequests.filter(r => !r.success).length;

    if (recentRequests.length >= config.minimumRequests && 
        recentFailures >= config.failureThreshold) {
      
      stats.state = CircuitBreakerState.OPEN;
      stats.nextAttemptTime = now + config.recoveryTimeout;
      
      this.logger.warn(`Circuit breaker opened for ${operationName}: ${recentFailures} failures in ${recentRequests.length} requests`);
    }

    // In half-open state, any failure immediately opens the circuit
    if (stats.state === CircuitBreakerState.HALF_OPEN) {
      stats.state = CircuitBreakerState.OPEN;
      stats.nextAttemptTime = now + config.recoveryTimeout;
      
      this.logger.warn(`Circuit breaker re-opened from HALF_OPEN: ${operationName}`);
    }
  }

  private getRecentRequests(operationName: string, windowMs: number): Array<{ timestamp: number; success: boolean }> {
    const history = this.requestHistory.get(operationName) || [];
    const cutoff = Date.now() - windowMs;
    return history.filter(request => request.timestamp >= cutoff);
  }

  private cleanupHistory(operationName: string, windowMs: number): void {
    const history = this.requestHistory.get(operationName);
    if (!history) return;

    const cutoff = Date.now() - windowMs;
    const recentHistory = history.filter(request => request.timestamp >= cutoff);
    
    // Keep maximum of 1000 recent entries to prevent memory leaks
    if (recentHistory.length > 1000) {
      recentHistory.splice(0, recentHistory.length - 1000);
    }
    
    this.requestHistory.set(operationName, recentHistory);
  }

  /**
   * Get failure rate for an operation in the monitoring window
   */
  getFailureRate(operationName: string, windowMs: number = this.defaultConfig.monitoringWindow): number {
    const recentRequests = this.getRecentRequests(operationName, windowMs);
    if (recentRequests.length === 0) return 0;

    const failures = recentRequests.filter(r => !r.success).length;
    return failures / recentRequests.length;
  }

  /**
   * Get success rate for an operation in the monitoring window
   */
  getSuccessRate(operationName: string, windowMs: number = this.defaultConfig.monitoringWindow): number {
    return 1 - this.getFailureRate(operationName, windowMs);
  }
}
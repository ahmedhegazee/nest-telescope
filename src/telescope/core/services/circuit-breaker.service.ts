import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open'
}

export interface CircuitBreakerConfig {
  failureThreshold: number;        // Number of failures before opening
  timeoutThreshold: number;        // Timeout in ms before considering failure
  resetTimeout: number;            // Time to wait before half-open attempt
  halfOpenMaxCalls: number;        // Max calls allowed in half-open state
  successThreshold: number;        // Successes needed to close from half-open
  monitoringInterval: number;      // Health check interval in ms
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  totalRequests: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  uptime: number;
  failureRate: number;
  averageResponseTime: number;
  timeoutCount: number;
}

export interface CircuitBreakerResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  fromCache?: boolean;
  executionTime: number;
  circuitState: CircuitState;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly circuits = new Map<string, Circuit>();
  private readonly destroy$ = new Subject<void>();

  constructor() {
    this.startMonitoring();
  }

  createCircuit(name: string, config: Partial<CircuitBreakerConfig> = {}): string {
    const defaultConfig: CircuitBreakerConfig = {
      failureThreshold: 5,
      timeoutThreshold: 5000,
      resetTimeout: 60000,
      halfOpenMaxCalls: 3,
      successThreshold: 2,
      monitoringInterval: 30000
    };

    const circuit = new Circuit(name, { ...defaultConfig, ...config });
    this.circuits.set(name, circuit);
    this.logger.log(`Created circuit breaker: ${name}`);
    return name;
  }

  async execute<T>(
    circuitName: string,
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<CircuitBreakerResult<T>> {
    const circuit = this.circuits.get(circuitName);
    if (!circuit) {
      throw new Error(`Circuit breaker not found: ${circuitName}`);
    }

    return circuit.execute(operation, fallback);
  }

  getStats(circuitName: string): CircuitBreakerStats | null {
    const circuit = this.circuits.get(circuitName);
    return circuit ? circuit.getStats() : null;
  }

  getAllStats(): Map<string, CircuitBreakerStats> {
    const stats = new Map<string, CircuitBreakerStats>();
    this.circuits.forEach((circuit, name) => {
      stats.set(name, circuit.getStats());
    });
    return stats;
  }

  forceOpen(circuitName: string): boolean {
    const circuit = this.circuits.get(circuitName);
    if (circuit) {
      circuit.forceOpen();
      this.logger.warn(`Circuit breaker manually opened: ${circuitName}`);
      return true;
    }
    return false;
  }

  forceClose(circuitName: string): boolean {
    const circuit = this.circuits.get(circuitName);
    if (circuit) {
      circuit.forceClose();
      this.logger.log(`Circuit breaker manually closed: ${circuitName}`);
      return true;
    }
    return false;
  }

  reset(circuitName: string): boolean {
    const circuit = this.circuits.get(circuitName);
    if (circuit) {
      circuit.reset();
      this.logger.log(`Circuit breaker reset: ${circuitName}`);
      return true;
    }
    return false;
  }

  getCircuitNames(): string[] {
    return Array.from(this.circuits.keys());
  }

  removeCircuit(circuitName: string): boolean {
    const removed = this.circuits.delete(circuitName);
    if (removed) {
      this.logger.log(`Removed circuit breaker: ${circuitName}`);
    }
    return removed;
  }

  private startMonitoring(): void {
    interval(10000) // Monitor every 10 seconds
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.circuits.forEach((circuit, name) => {
          const stats = circuit.getStats();
          if (stats.state === CircuitState.OPEN) {
            this.logger.warn(`Circuit breaker ${name} is OPEN - Failure rate: ${stats.failureRate.toFixed(2)}%`);
          }
        });
      });
  }

  onDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

class Circuit {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private totalRequests = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private halfOpenCallCount = 0;
  private responseTimes: number[] = [];
  private timeoutCount = 0;
  private readonly startTime = Date.now();

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig
  ) {}

  async execute<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<CircuitBreakerResult<T>> {
    const startTime = Date.now();
    this.totalRequests++;

    // Check if circuit should reject immediately
    if (this.shouldReject()) {
      const executionTime = Date.now() - startTime;
      
      if (fallback) {
        try {
          const data = await fallback();
          return {
            success: true,
            data,
            fromCache: true,
            executionTime,
            circuitState: this.state
          };
        } catch (fallbackError) {
          return {
            success: false,
            error: fallbackError instanceof Error ? fallbackError : new Error('Fallback failed'),
            executionTime,
            circuitState: this.state
          };
        }
      }

      return {
        success: false,
        error: new Error(`Circuit breaker ${this.name} is ${this.state}`),
        executionTime,
        circuitState: this.state
      };
    }

    // Execute operation with timeout
    try {
      const result = await this.executeWithTimeout(operation);
      const executionTime = Date.now() - startTime;
      
      this.onSuccess(executionTime);
      
      return {
        success: true,
        data: result,
        executionTime,
        circuitState: this.state
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const isTimeout = error instanceof Error && error.message.includes('timeout');
      
      this.onFailure(isTimeout);
      
      if (fallback) {
        try {
          const data = await fallback();
          return {
            success: true,
            data,
            error: error instanceof Error ? error : new Error('Unknown error'),
            fromCache: true,
            executionTime,
            circuitState: this.state
          };
        } catch (fallbackError) {
          return {
            success: false,
            error: fallbackError instanceof Error ? fallbackError : new Error('Fallback failed'),
            executionTime,
            circuitState: this.state
          };
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
        executionTime,
        circuitState: this.state
      };
    }
  }

  private async executeWithTimeout<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Operation timeout after ${this.config.timeoutThreshold}ms`));
      }, this.config.timeoutThreshold);

      operation()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private shouldReject(): boolean {
    switch (this.state) {
      case CircuitState.CLOSED:
        return false;
      
      case CircuitState.OPEN:
        // Check if we should transition to half-open
        if (this.lastFailureTime && 
            Date.now() - this.lastFailureTime.getTime() >= this.config.resetTimeout) {
          this.state = CircuitState.HALF_OPEN;
          this.halfOpenCallCount = 0;
          return false;
        }
        return true;
      
      case CircuitState.HALF_OPEN:
        if (this.halfOpenCallCount >= this.config.halfOpenMaxCalls) {
          return true;
        }
        this.halfOpenCallCount++;
        return false;
      
      default:
        return false;
    }
  }

  private onSuccess(responseTime: number): void {
    this.successCount++;
    this.lastSuccessTime = new Date();
    this.responseTimes.push(responseTime);
    
    // Keep only last 100 response times for average calculation
    if (this.responseTimes.length > 100) {
      this.responseTimes.shift();
    }

    switch (this.state) {
      case CircuitState.HALF_OPEN:
        if (this.successCount >= this.config.successThreshold) {
          this.state = CircuitState.CLOSED;
          this.failureCount = 0;
          this.halfOpenCallCount = 0;
        }
        break;
      
      case CircuitState.CLOSED:
        // Reset failure count on success
        this.failureCount = 0;
        break;
    }
  }

  private onFailure(isTimeout: boolean): void {
    this.failureCount++;
    this.lastFailureTime = new Date();
    
    if (isTimeout) {
      this.timeoutCount++;
    }

    switch (this.state) {
      case CircuitState.CLOSED:
        if (this.failureCount >= this.config.failureThreshold) {
          this.state = CircuitState.OPEN;
        }
        break;
      
      case CircuitState.HALF_OPEN:
        this.state = CircuitState.OPEN;
        this.halfOpenCallCount = 0;
        break;
    }
  }

  forceOpen(): void {
    this.state = CircuitState.OPEN;
    this.lastFailureTime = new Date();
  }

  forceClose(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.halfOpenCallCount = 0;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenCallCount = 0;
    this.responseTimes = [];
    this.timeoutCount = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
  }

  getStats(): CircuitBreakerStats {
    const uptime = Date.now() - this.startTime;
    const failureRate = this.totalRequests > 0 ? (this.failureCount / this.totalRequests) * 100 : 0;
    const averageResponseTime = this.responseTimes.length > 0 
      ? this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length 
      : 0;

    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalRequests: this.totalRequests,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      uptime,
      failureRate,
      averageResponseTime,
      timeoutCount: this.timeoutCount
    };
  }
}
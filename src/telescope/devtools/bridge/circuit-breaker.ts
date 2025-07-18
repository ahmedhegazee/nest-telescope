import { Logger } from '@nestjs/common';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  timeout: number;
  resetTimeout: number;
  onOpen?: (breaker: CircuitBreaker) => void;
  onHalfOpen?: (breaker: CircuitBreaker) => void;
  onClose?: (breaker: CircuitBreaker) => void;
  name?: string;
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  successes: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  nextAttempt: number;
}

export class CircuitBreaker {
  private readonly logger = new Logger(`CircuitBreaker:${this.options.name || 'default'}`);
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private lastSuccessTime = 0;
  private nextAttempt = 0;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.logger.log(`Circuit breaker initialized: ${JSON.stringify(options)}`);
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const currentTime = Date.now();

    // Check if circuit is open and should remain open
    if (this.state === 'open') {
      if (currentTime < this.nextAttempt) {
        throw new CircuitBreakerOpenError(
          `Circuit breaker is open. Next attempt in ${this.nextAttempt - currentTime}ms`
        );
      } else {
        this.state = 'half-open';
        this.options.onHalfOpen?.(this);
        this.logger.warn(`Circuit breaker transitioning to half-open state`);
      }
    }

    try {
      const result = await Promise.race([
        operation(),
        new Promise<T>((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), this.options.timeout)
        )
      ]);

      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  private onSuccess(): void {
    this.successes++;
    this.lastSuccessTime = Date.now();
    
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.failures = 0;
      this.options.onClose?.(this);
      this.logger.log(`Circuit breaker closed after successful operation`);
    } else if (this.state === 'closed') {
      // Reset failure count on successful operation
      this.failures = Math.max(0, this.failures - 1);
    }
  }

  private onFailure(error: Error): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // Immediately go back to open state
      this.state = 'open';
      this.nextAttempt = Date.now() + this.options.resetTimeout;
      this.options.onOpen?.(this);
      this.logger.warn(`Circuit breaker opened from half-open state due to failure: ${error.message}`);
    } else if (this.failures >= this.options.failureThreshold) {
      this.state = 'open';
      this.nextAttempt = Date.now() + this.options.resetTimeout;
      this.options.onOpen?.(this);
      this.logger.warn(`Circuit breaker opened due to ${this.failures} failures. Error: ${error.message}`);
    }
  }

  getState(): CircuitBreakerState {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttempt: this.nextAttempt
    };
  }

  getFailureCount(): number {
    return this.failures;
  }

  getSuccessCount(): number {
    return this.successes;
  }

  getLastFailureTime(): number {
    return this.lastFailureTime;
  }

  getLastSuccessTime(): number {
    return this.lastSuccessTime;
  }

  getCurrentState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }

  isOpen(): boolean {
    return this.state === 'open';
  }

  isClosed(): boolean {
    return this.state === 'closed';
  }

  isHalfOpen(): boolean {
    return this.state === 'half-open';
  }

  // Manual control methods
  forceOpen(): void {
    this.state = 'open';
    this.nextAttempt = Date.now() + this.options.resetTimeout;
    this.options.onOpen?.(this);
    this.logger.warn('Circuit breaker force opened');
  }

  forceClose(): void {
    this.state = 'closed';
    this.failures = 0;
    this.options.onClose?.(this);
    this.logger.log('Circuit breaker force closed');
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
    this.lastSuccessTime = 0;
    this.nextAttempt = 0;
    this.logger.log('Circuit breaker reset');
  }

  // Get health information
  getHealthInfo(): {
    isHealthy: boolean;
    state: string;
    failureRate: number;
    successRate: number;
    uptime: number;
  } {
    const total = this.failures + this.successes;
    const failureRate = total > 0 ? (this.failures / total) * 100 : 0;
    const successRate = total > 0 ? (this.successes / total) * 100 : 0;
    const uptime = this.lastSuccessTime > 0 ? Date.now() - this.lastSuccessTime : 0;

    return {
      isHealthy: this.state === 'closed',
      state: this.state,
      failureRate,
      successRate,
      uptime
    };
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

// Factory for creating circuit breakers with common configurations
export class CircuitBreakerFactory {
  static createForStorage(name: string = 'storage'): CircuitBreaker {
    return new CircuitBreaker({
      name,
      failureThreshold: 5,
      timeout: 30000,
      resetTimeout: 60000,
      onOpen: (breaker) => console.warn(`Storage circuit breaker opened: ${name}`),
      onHalfOpen: (breaker) => console.info(`Storage circuit breaker half-open: ${name}`),
      onClose: (breaker) => console.info(`Storage circuit breaker closed: ${name}`)
    });
  }

  static createForDevTools(name: string = 'devtools'): CircuitBreaker {
    return new CircuitBreaker({
      name,
      failureThreshold: 3,
      timeout: 15000,
      resetTimeout: 30000,
      onOpen: (breaker) => console.warn(`DevTools circuit breaker opened: ${name}`),
      onHalfOpen: (breaker) => console.info(`DevTools circuit breaker half-open: ${name}`),
      onClose: (breaker) => console.info(`DevTools circuit breaker closed: ${name}`)
    });
  }

  static createForNetwork(name: string = 'network'): CircuitBreaker {
    return new CircuitBreaker({
      name,
      failureThreshold: 10,
      timeout: 5000,
      resetTimeout: 15000,
      onOpen: (breaker) => console.warn(`Network circuit breaker opened: ${name}`),
      onHalfOpen: (breaker) => console.info(`Network circuit breaker half-open: ${name}`),
      onClose: (breaker) => console.info(`Network circuit breaker closed: ${name}`)
    });
  }

  static createCustom(options: CircuitBreakerOptions): CircuitBreaker {
    return new CircuitBreaker(options);
  }
}

// Circuit breaker registry for managing multiple breakers
export class CircuitBreakerRegistry {
  private readonly logger = new Logger('CircuitBreakerRegistry');
  private breakers = new Map<string, CircuitBreaker>();

  register(name: string, breaker: CircuitBreaker): void {
    this.breakers.set(name, breaker);
    this.logger.log(`Circuit breaker registered: ${name}`);
  }

  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  getAllStates(): Record<string, CircuitBreakerState> {
    const states: Record<string, CircuitBreakerState> = {};
    
    for (const [name, breaker] of this.breakers) {
      states[name] = breaker.getState();
    }
    
    return states;
  }

  getHealthStatus(): {
    healthy: number;
    unhealthy: number;
    total: number;
    details: Record<string, any>;
  } {
    let healthy = 0;
    let unhealthy = 0;
    const details: Record<string, any> = {};

    for (const [name, breaker] of this.breakers) {
      const health = breaker.getHealthInfo();
      details[name] = health;
      
      if (health.isHealthy) {
        healthy++;
      } else {
        unhealthy++;
      }
    }

    return {
      healthy,
      unhealthy,
      total: this.breakers.size,
      details
    };
  }

  // Reset all circuit breakers
  resetAll(): void {
    for (const [name, breaker] of this.breakers) {
      breaker.reset();
      this.logger.log(`Reset circuit breaker: ${name}`);
    }
  }

  // Remove a circuit breaker
  remove(name: string): boolean {
    const removed = this.breakers.delete(name);
    if (removed) {
      this.logger.log(`Circuit breaker removed: ${name}`);
    }
    return removed;
  }

  clear(): void {
    this.breakers.clear();
    this.logger.log('All circuit breakers cleared');
  }
}
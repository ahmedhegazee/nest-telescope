import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable, throwError, timer } from 'rxjs';
import { catchError, retry, timeout } from 'rxjs/operators';
import { CircuitBreakerOpenError } from '../../devtools/bridge/circuit-breaker';

export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  timeoutMs: number;
  retryCondition?: (error: any) => boolean;
}

@Injectable()
export class ErrorRecoveryInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ErrorRecoveryInterceptor.name);
  
  private readonly defaultConfig: RetryConfig = {
    maxRetries: 3,
    retryDelay: 1000,
    timeoutMs: 30000,
    retryCondition: (error) => this.shouldRetry(error)
  };

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const config = request.errorRecoveryConfig || this.defaultConfig;
    
    return next.handle().pipe(
      timeout(config.timeoutMs),
      retry({
        count: config.maxRetries,
        delay: (error, retryCount) => {
          if (config.retryCondition && !config.retryCondition(error)) {
            throw error;
          }
          
          this.logger.warn(`Retrying operation, attempt ${retryCount + 1}/${config.maxRetries}: ${error.message}`);
          
          // Exponential backoff
          const delay = config.retryDelay * Math.pow(2, retryCount);
          return timer(delay);
        }
      }),
      catchError(error => {
        this.logger.error('Error recovery failed after retries:', error);
        return throwError(() => error);
      })
    );
  }

  private shouldRetry(error: any): boolean {
    // Don't retry circuit breaker errors
    if (error instanceof CircuitBreakerOpenError) {
      return false;
    }
    
    // Don't retry client errors (4xx)
    if (error.status >= 400 && error.status < 500) {
      return false;
    }
    
    // Don't retry validation errors
    if (error.name === 'ValidationError') {
      return false;
    }
    
    // Retry server errors and network issues
    return true;
  }
}
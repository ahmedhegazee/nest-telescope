import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { CircuitBreakerOpenError } from '../../devtools/bridge/circuit-breaker';

export interface TelescopeError {
  id: string;
  type: string;
  message: string;
  stack: string | undefined;
  context?: any;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

@Catch()
export class TelescopeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(TelescopeExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const telescopeError = this.createTelescopeError(exception, request);
    
    // Log the error
    this.logError(telescopeError);

    // Handle specific error types
    if (exception instanceof CircuitBreakerOpenError) {
      this.handleCircuitBreakerError(exception, response, telescopeError);
    } else if (exception instanceof HttpException) {
      this.handleHttpException(exception, response, telescopeError);
    } else {
      this.handleGenericError(exception, response, telescopeError);
    }
  }

  private createTelescopeError(exception: unknown, request: Request): TelescopeError {
    const id = this.generateErrorId();
    const timestamp = new Date();
    
    let message = 'Unknown error';
    let stack: string | undefined;
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
    let type = 'UnknownError';

    if (exception instanceof Error) {
      message = exception.message;
      stack = exception.stack;
      type = exception.constructor.name;
    }

    if (exception instanceof CircuitBreakerOpenError) {
      severity = 'high';
      type = 'CircuitBreakerError';
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      severity = status >= 500 ? 'high' : status >= 400 ? 'medium' : 'low';
      type = 'HttpError';
    }

    return {
      id,
      type,
      message,
      stack,
      context: {
        url: request.url,
        method: request.method,
        headers: this.sanitizeHeaders(request.headers),
        userAgent: request.get('user-agent'),
        ip: request.ip,
        timestamp: timestamp.toISOString()
      },
      timestamp,
      severity
    };
  }

  private handleCircuitBreakerError(
    exception: CircuitBreakerOpenError,
    response: Response,
    telescopeError: TelescopeError
  ) {
    response.status(503).json({
      error: {
        id: telescopeError.id,
        message: 'Service temporarily unavailable',
        type: 'CircuitBreakerOpen',
        timestamp: telescopeError.timestamp.toISOString(),
        retryAfter: 60 // seconds
      }
    });
  }

  private handleHttpException(
    exception: HttpException,
    response: Response,
    telescopeError: TelescopeError
  ) {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();
    
    response.status(status).json({
      error: {
        id: telescopeError.id,
        message: typeof exceptionResponse === 'string' ? exceptionResponse : (exceptionResponse as any).message,
        type: 'HttpException',
        timestamp: telescopeError.timestamp.toISOString(),
        details: typeof exceptionResponse === 'object' ? exceptionResponse : undefined
      }
    });
  }

  private handleGenericError(
    exception: unknown,
    response: Response,
    telescopeError: TelescopeError
  ) {
    response.status(500).json({
      error: {
        id: telescopeError.id,
        message: 'Internal server error',
        type: 'InternalError',
        timestamp: telescopeError.timestamp.toISOString()
      }
    });
  }

  private logError(error: TelescopeError) {
    const logData = {
      id: error.id,
      type: error.type,
      message: error.message,
      severity: error.severity,
      context: error.context,
      timestamp: error.timestamp.toISOString()
    };

    switch (error.severity) {
      case 'critical':
        this.logger.error('Critical error occurred', logData);
        break;
      case 'high':
        this.logger.error('High severity error', logData);
        break;
      case 'medium':
        this.logger.warn('Medium severity error', logData);
        break;
      case 'low':
        this.logger.debug('Low severity error', logData);
        break;
      default:
        this.logger.warn('Unknown severity error', logData);
    }

    // Include stack trace for non-production environments
    if (process.env.NODE_ENV !== 'production' && error.stack) {
      this.logger.error('Stack trace:', error.stack);
    }
  }

  private sanitizeHeaders(headers: any): any {
    const sanitized = { ...headers };
    
    // Remove sensitive headers
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
    
    for (const header of sensitiveHeaders) {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }

  private generateErrorId(): string {
    return `tel_err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
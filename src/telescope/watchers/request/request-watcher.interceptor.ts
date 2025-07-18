import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { RequestWatcherService } from './request-watcher.service';
import { TelescopeEntry } from '../../core/interfaces/telescope-entry.interface';

export interface RequestContext {
  id: string;
  startTime: number;
  method: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, any>;
  body: any;
  userAgent: string;
  ip: string;
  sessionId?: string;
  userId?: string;
  traceId?: string;
}

export interface ResponseContext {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  size: number;
  endTime: number;
  duration: number;
}

@Injectable()
export class RequestWatcherInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestWatcherInterceptor.name);

  constructor(private readonly requestWatcher: RequestWatcherService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    
    // Check if this request should be tracked
    if (!this.shouldTrackRequest(request)) {
      return next.handle();
    }

    const requestContext = this.createRequestContext(request);
    
    return next.handle().pipe(
      tap(data => {
        const responseContext = this.createResponseContext(response, data, requestContext);
        this.trackRequest(requestContext, responseContext, null);
      }),
      catchError(error => {
        const responseContext = this.createResponseContext(response, null, requestContext);
        this.trackRequest(requestContext, responseContext, error);
        throw error;
      })
    );
  }

  private shouldTrackRequest(request: Request): boolean {
    // Check exclusions
    const excludedPaths = this.requestWatcher.getExcludedPaths();
    const path = request.path;
    
    if (excludedPaths.some(excluded => path.startsWith(excluded))) {
      return false;
    }

    // Check if request matches sampling rules
    return this.requestWatcher.shouldSampleRequest(request);
  }

  private createRequestContext(request: Request): RequestContext {
    const startTime = Date.now();
    const id = this.generateRequestId();
    
    return {
      id,
      startTime,
      method: request.method,
      url: request.originalUrl || request.url,
      headers: this.sanitizeHeaders(request.headers),
      query: this.sanitizeQuery(request.query),
      body: this.sanitizeBody(request.body),
      userAgent: request.get('user-agent') || '',
      ip: this.getClientIp(request),
      sessionId: this.extractSessionId(request),
      userId: this.extractUserId(request),
      traceId: this.extractTraceId(request)
    };
  }

  private createResponseContext(
    response: Response,
    data: any,
    requestContext: RequestContext
  ): ResponseContext {
    const endTime = Date.now();
    const duration = endTime - requestContext.startTime;
    
    return {
      statusCode: response.statusCode,
      headers: this.sanitizeHeaders(response.getHeaders()),
      body: this.sanitizeResponseBody(data, response.statusCode),
      size: this.calculateResponseSize(data, response),
      endTime,
      duration
    };
  }

  private trackRequest(
    requestContext: RequestContext,
    responseContext: ResponseContext,
    error: Error | null
  ): void {
    try {
      this.requestWatcher.trackRequest(requestContext, responseContext, error);
    } catch (trackingError) {
      this.logger.error('Failed to track request:', trackingError);
    }
  }

  private sanitizeHeaders(headers: any): Record<string, string> {
    const sanitized: Record<string, string> = {};
    const sensitiveHeaders = [
      'authorization',
      'cookie',
      'x-api-key',
      'x-auth-token',
      'x-access-token',
      'x-csrf-token'
    ];

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveHeaders.includes(lowerKey)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = Array.isArray(value) ? value.join(', ') : String(value);
      }
    }

    return sanitized;
  }

  private sanitizeQuery(query: any): Record<string, any> {
    if (!query || typeof query !== 'object') {
      return {};
    }

    const sanitized: Record<string, any> = {};
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];

    for (const [key, value] of Object.entries(query)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private sanitizeBody(body: any): any {
    if (!body) {
      return null;
    }

    // Check if body should be masked completely
    if (this.requestWatcher.shouldMaskBody(body)) {
      return '[MASKED]';
    }

    // For objects, sanitize individual fields
    if (typeof body === 'object' && body !== null) {
      const sanitized: any = Array.isArray(body) ? [] : {};
      const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'credit', 'ssn'];

      for (const [key, value] of Object.entries(body)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = typeof value === 'object' ? this.sanitizeBody(value) : value;
        }
      }

      return sanitized;
    }

    return body;
  }

  private sanitizeResponseBody(data: any, statusCode: number): any {
    // Don't log response bodies for successful requests by default
    if (statusCode >= 200 && statusCode < 300) {
      return this.requestWatcher.shouldLogSuccessfulResponseBodies() ? data : null;
    }

    // Log error responses but sanitize them
    if (statusCode >= 400) {
      return this.sanitizeBody(data);
    }

    return data;
  }

  private calculateResponseSize(data: any, response: Response): number {
    if (data && typeof data === 'object') {
      try {
        return JSON.stringify(data).length;
      } catch {
        return 0;
      }
    }

    if (typeof data === 'string') {
      return data.length;
    }

    // Try to get content-length header
    const contentLength = response.get('content-length');
    return contentLength ? parseInt(contentLength, 10) : 0;
  }

  private getClientIp(request: Request): string {
    return (
      request.ip ||
      request.headers['x-forwarded-for'] as string ||
      request.headers['x-real-ip'] as string ||
      request.connection?.remoteAddress ||
      'unknown'
    );
  }

  private extractSessionId(request: Request): string | undefined {
    // Try to extract session ID from various sources
    const sessionCookie = request.cookies?.sessionId;
    if (sessionCookie) {
      return sessionCookie;
    }

    const sessionHeader = request.headers['x-session-id'];
    if (sessionHeader) {
      return Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
    }

    // Try to extract from authorization header (JWT)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        return payload.sessionId || payload.jti;
      } catch {
        // Invalid JWT, ignore
      }
    }

    return undefined;
  }

  private extractUserId(request: Request): string | undefined {
    // Try to extract user ID from request context
    const user = (request as any).user;
    if (user) {
      return user.id || user.userId || user.sub;
    }

    // Try to extract from authorization header (JWT)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        return payload.userId || payload.sub || payload.id;
      } catch {
        // Invalid JWT, ignore
      }
    }

    return undefined;
  }

  private extractTraceId(request: Request): string | undefined {
    // Extract distributed tracing ID
    const traceHeader = request.headers['x-trace-id'] || request.headers['x-request-id'];
    if (traceHeader) {
      return Array.isArray(traceHeader) ? traceHeader[0] : traceHeader;
    }

    // Generate trace ID if not provided
    return this.generateTraceId();
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
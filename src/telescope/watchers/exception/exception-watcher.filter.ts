import { 
  ExceptionFilter, 
  Catch, 
  ArgumentsHost, 
  HttpException, 
  HttpStatus,
  Logger,
  Inject
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ExceptionWatcherService } from './exception-watcher.service';
import { ExceptionWatcherConfig } from './exception-watcher.config';

export interface ExceptionContext {
  id: string;
  timestamp: Date;
  error: Error;
  errorType: string;
  errorMessage: string;
  errorCode?: string | number;
  statusCode?: number;
  
  // Stack trace information
  stackTrace?: string;
  stackFrames?: StackFrame[];
  
  // Request context
  request?: {
    id?: string;
    method?: string;
    url?: string;
    path?: string;
    headers?: Record<string, any>;
    body?: any;
    params?: Record<string, any>;
    query?: Record<string, any>;
    userAgent?: string;
    ip?: string;
    userId?: string;
    sessionId?: string;
  };
  
  // Response context
  response?: {
    statusCode?: number;
    headers?: Record<string, any>;
    body?: any;
    duration?: number;
  };
  
  // Environment context
  environment?: {
    nodeVersion?: string;
    platform?: string;
    hostname?: string;
    memory?: NodeJS.MemoryUsage;
    uptime?: number;
  };
  
  // Correlation
  traceId?: string;
  requestId?: string;
  userId?: string;
  sessionId?: string;
  
  // Classification
  classification?: {
    type: ErrorClassificationType;
    category: ErrorCategory;
    severity: ErrorSeverity;
    fingerprint: string;
    groupId: string;
  };
  
  // Performance tracking
  performance?: {
    responseTime?: number;
    memoryUsage?: number;
    cpuUsage?: number;
    activeConnections?: number;
  };
}

export interface StackFrame {
  function?: string;
  file?: string;
  line?: number;
  column?: number;
  source?: string;
  context?: string[];
}

export enum ErrorClassificationType {
  HTTP = 'http',
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  DATABASE = 'database',
  NETWORK = 'network',
  BUSINESS_LOGIC = 'business_logic',
  SYSTEM = 'system',
  UNKNOWN = 'unknown'
}

export enum ErrorCategory {
  CLIENT_ERROR = 'client_error',
  SERVER_ERROR = 'server_error',
  NETWORK_ERROR = 'network_error',
  DATABASE_ERROR = 'database_error',
  VALIDATION_ERROR = 'validation_error',
  AUTHENTICATION_ERROR = 'authentication_error',
  AUTHORIZATION_ERROR = 'authorization_error',
  BUSINESS_ERROR = 'business_error',
  SYSTEM_ERROR = 'system_error'
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

@Catch()
export class ExceptionWatcherFilter implements ExceptionFilter {
  private readonly logger = new Logger(ExceptionWatcherFilter.name);

  constructor(
    private readonly exceptionWatcherService: ExceptionWatcherService,
    @Inject('EXCEPTION_WATCHER_CONFIG') private readonly config: ExceptionWatcherConfig
  ) {}

  catch(exception: any, host: ArgumentsHost): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      const context = this.extractContext(exception, host);
      
      // Check if this error should be excluded
      if (this.shouldExcludeError(exception, context)) {
        return;
      }

      // Check sampling rate
      if (Math.random() * 100 > this.config.sampleRate) {
        return;
      }

      // Track the exception
      this.exceptionWatcherService.trackException(context);

      // Send response if HTTP context
      if (host.getType() === 'http') {
        this.sendHttpResponse(exception, host, context);
      }

    } catch (error) {
      this.logger.error('Failed to track exception:', error);
    }
  }

  private extractContext(exception: any, host: ArgumentsHost): ExceptionContext {
    const context: ExceptionContext = {
      id: this.generateExceptionId(),
      timestamp: new Date(),
      error: exception,
      errorType: exception.constructor.name,
      errorMessage: exception.message || 'Unknown error',
      errorCode: exception.code || exception.status
    };

    // Extract HTTP context
    if (host.getType() === 'http') {
      this.extractHttpContext(context, exception, host);
    }

    // Extract stack trace
    if (this.config.captureStackTrace && exception.stack) {
      context.stackTrace = exception.stack;
      context.stackFrames = this.parseStackTrace(exception.stack);
    }

    // Extract environment context
    if (this.config.captureEnvironment) {
      context.environment = this.extractEnvironmentContext();
    }

    // Classify the error
    if (this.config.enableErrorClassification) {
      context.classification = this.classifyError(exception, context);
    }

    // Extract performance context
    if (this.config.enablePerformanceTracking) {
      context.performance = this.extractPerformanceContext();
    }

    return context;
  }

  private extractHttpContext(context: ExceptionContext, exception: any, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // Request context
    if (this.config.enableRequestContext) {
      context.request = {
        id: (request as any).id,
        method: request.method,
        url: request.url,
        path: request.path,
        userAgent: request.get('user-agent'),
        ip: request.ip || request.connection.remoteAddress,
        userId: (request as any).user?.id,
        sessionId: (request as any).session?.id
      };

      // Capture headers
      if (this.config.captureHeaders) {
        context.request.headers = this.sanitizeHeaders(request.headers);
      }

      // Capture body
      if (this.config.captureBody && request.body) {
        context.request.body = this.sanitizeBody(request.body);
      }

      // Capture params
      if (this.config.captureParams && request.params) {
        context.request.params = request.params;
      }

      // Capture query
      if (this.config.captureQuery && request.query) {
        context.request.query = request.query;
      }
    }

    // Response context
    const statusCode = exception instanceof HttpException 
      ? exception.getStatus() 
      : HttpStatus.INTERNAL_SERVER_ERROR;

    context.response = {
      statusCode,
      headers: this.sanitizeHeaders(response.getHeaders()),
      duration: Date.now() - (request as any).startTime
    };

    context.statusCode = statusCode;

    // Correlation IDs
    context.traceId = (request as any).traceId;
    context.requestId = (request as any).id;
    context.userId = (request as any).user?.id;
    context.sessionId = (request as any).session?.id;
  }

  private extractEnvironmentContext(): ExceptionContext['environment'] {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      hostname: process.env.HOSTNAME || 'unknown',
      memory: process.memoryUsage(),
      uptime: process.uptime()
    };
  }

  private extractPerformanceContext(): ExceptionContext['performance'] {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      memoryUsage: memoryUsage.heapUsed,
      cpuUsage: cpuUsage.user + cpuUsage.system,
      activeConnections: (process as any)._getActiveHandles?.()?.length || 0
    };
  }

  private parseStackTrace(stackTrace: string): StackFrame[] {
    const frames: StackFrame[] = [];
    const lines = stackTrace.split('\n').slice(1); // Skip error message line
    
    for (const line of lines.slice(0, this.config.maxStackTraceDepth)) {
      const frame = this.parseStackFrame(line);
      if (frame) {
        frames.push(frame);
      }
    }
    
    return frames;
  }

  private parseStackFrame(line: string): StackFrame | null {
    // Parse various stack trace formats
    const patterns = [
      /at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/, // at function (file:line:col)
      /at\s+(.+?):(\d+):(\d+)/, // at file:line:col
      /at\s+(.+?)\s+\((.+?)\)/, // at function (file)
      /at\s+(.+?)$/ // at function
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return {
          function: match[1] || 'anonymous',
          file: match[2] || undefined,
          line: match[3] ? parseInt(match[3]) : undefined,
          column: match[4] ? parseInt(match[4]) : undefined
        };
      }
    }

    return null;
  }

  private classifyError(exception: any, context: ExceptionContext): ExceptionContext['classification'] {
    const type = this.classifyErrorType(exception);
    const category = this.classifyErrorCategory(exception, context);
    const severity = this.classifyErrorSeverity(exception, context);
    const fingerprint = this.generateErrorFingerprint(exception, context);
    const groupId = this.generateGroupId(exception, context);

    return {
      type,
      category,
      severity,
      fingerprint,
      groupId
    };
  }

  private classifyErrorType(exception: any): ErrorClassificationType {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 400 && status < 500) {
        if (status === 401) return ErrorClassificationType.AUTHENTICATION;
        if (status === 403) return ErrorClassificationType.AUTHORIZATION;
        if (status === 422) return ErrorClassificationType.VALIDATION;
        return ErrorClassificationType.HTTP;
      }
    }

    const errorName = exception.constructor.name;
    if (errorName.includes('Database') || errorName.includes('Query')) {
      return ErrorClassificationType.DATABASE;
    }
    if (errorName.includes('Network') || errorName.includes('Connection')) {
      return ErrorClassificationType.NETWORK;
    }
    if (errorName.includes('Validation')) {
      return ErrorClassificationType.VALIDATION;
    }
    if (errorName.includes('Auth')) {
      return ErrorClassificationType.AUTHENTICATION;
    }

    return ErrorClassificationType.UNKNOWN;
  }

  private classifyErrorCategory(exception: any, context: ExceptionContext): ErrorCategory {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 400 && status < 500) {
        return ErrorCategory.CLIENT_ERROR;
      }
      if (status >= 500) {
        return ErrorCategory.SERVER_ERROR;
      }
    }

    const type = context.classification?.type;
    switch (type) {
      case ErrorClassificationType.DATABASE:
        return ErrorCategory.DATABASE_ERROR;
      case ErrorClassificationType.NETWORK:
        return ErrorCategory.NETWORK_ERROR;
      case ErrorClassificationType.VALIDATION:
        return ErrorCategory.VALIDATION_ERROR;
      case ErrorClassificationType.AUTHENTICATION:
        return ErrorCategory.AUTHENTICATION_ERROR;
      case ErrorClassificationType.AUTHORIZATION:
        return ErrorCategory.AUTHORIZATION_ERROR;
      default:
        return ErrorCategory.SYSTEM_ERROR;
    }
  }

  private classifyErrorSeverity(exception: any, context: ExceptionContext): ErrorSeverity {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) return ErrorSeverity.HIGH;
      if (status >= 400) return ErrorSeverity.MEDIUM;
      return ErrorSeverity.LOW;
    }

    const errorName = exception.constructor.name;
    if (errorName.includes('Critical') || errorName.includes('Fatal')) {
      return ErrorSeverity.CRITICAL;
    }
    if (errorName.includes('Error') && !errorName.includes('Validation')) {
      return ErrorSeverity.HIGH;
    }

    return ErrorSeverity.MEDIUM;
  }

  private generateErrorFingerprint(exception: any, context: ExceptionContext): string {
    const components = [
      exception.constructor.name,
      exception.message?.substring(0, 100),
      context.stackFrames?.[0]?.file,
      context.stackFrames?.[0]?.line?.toString()
    ].filter(Boolean);

    return this.hash(components.join(':'));
  }

  private generateGroupId(exception: any, context: ExceptionContext): string {
    if (!this.config.groupSimilarErrors) {
      return context.id;
    }

    const components = [
      exception.constructor.name,
      this.normalizeErrorMessage(exception.message),
      context.stackFrames?.[0]?.file,
      context.stackFrames?.[0]?.function
    ].filter(Boolean);

    return this.hash(components.join(':'));
  }

  private normalizeErrorMessage(message: string): string {
    if (!message) return '';
    
    // Remove dynamic parts like IDs, timestamps, etc.
    return message
      .replace(/\d+/g, 'N')
      .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, 'UUID')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, 'DATE')
      .replace(/\b\d{2}:\d{2}:\d{2}\b/g, 'TIME')
      .substring(0, 100);
  }

  private shouldExcludeError(exception: any, context: ExceptionContext): boolean {
    const errorType = exception.constructor.name;
    const errorMessage = exception.message || '';

    // Check excluded error types
    if (this.config.excludeErrorTypes.includes(errorType)) {
      return true;
    }

    // Check excluded error messages
    if (this.config.excludeErrorMessages.some(msg => errorMessage.includes(msg))) {
      return true;
    }

    return false;
  }

  private sanitizeHeaders(headers: any): Record<string, any> {
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

  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const sanitized = { ...body };
    
    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth'];
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }
    
    // Limit size
    const jsonString = JSON.stringify(sanitized);
    if (jsonString.length > this.config.maxContextSize) {
      return { _truncated: true, _size: jsonString.length };
    }
    
    return sanitized;
  }

  private sendHttpResponse(exception: any, host: ArgumentsHost, context: ExceptionContext): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const statusCode = exception instanceof HttpException 
      ? exception.getStatus() 
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorResponse = {
      statusCode,
      timestamp: new Date().toISOString(),
      path: ctx.getRequest<Request>().url,
      message: exception.message || 'Internal server error',
      error: exception instanceof HttpException ? exception.getResponse() : 'Internal Server Error',
      traceId: context.traceId,
      requestId: context.requestId
    };

    response.status(statusCode).json(errorResponse);
  }

  private generateExceptionId(): string {
    return `exception_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private hash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
}
# Exception Watcher

The Exception Watcher provides comprehensive error tracking and monitoring for NestJS applications. It captures, classifies, and groups exceptions with rich context to help developers identify and resolve issues quickly.

## Features

- **Global Exception Capture**: Automatically captures all exceptions in your application
- **Error Classification**: Categorizes errors by type, severity, and category
- **Error Grouping**: Groups similar errors together for better analysis
- **Stack Trace Analysis**: Parses and analyzes stack traces with source map support
- **Real-time Alerts**: Configurable alerting for error rate thresholds
- **Performance Impact Tracking**: Measures the impact of exceptions on application performance
- **Correlation**: Links exceptions with requests, queries, and user sessions
- **Security**: Sanitizes sensitive data from error contexts

## Installation

```bash
npm install @nestjs/telescope
```

## Basic Usage

### 1. Import the Module

```typescript
import { Module } from '@nestjs/common';
import { ExceptionWatcherModule } from '@nestjs/telescope';

@Module({
  imports: [
    ExceptionWatcherModule.forRoot({
      enabled: true,
      captureStackTrace: true,
      enableErrorClassification: true,
      groupSimilarErrors: true,
    }),
  ],
})
export class AppModule {}
```

### 2. Async Configuration

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ExceptionWatcherModule } from '@nestjs/telescope';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ExceptionWatcherModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        enabled: configService.get('EXCEPTION_WATCHER_ENABLED', true),
        captureStackTrace: configService.get('CAPTURE_STACK_TRACE', true),
        enableErrorClassification: configService.get('ENABLE_ERROR_CLASSIFICATION', true),
        sampleRate: configService.get('EXCEPTION_SAMPLE_RATE', 100),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

## Configuration Options

### Core Configuration

```typescript
interface ExceptionWatcherConfig {
  enabled: boolean;                     // Enable/disable exception tracking
  priority?: number;                    // Watcher priority (default: 1)
  tags?: string[];                      // Custom tags for tracking
  dependencies?: string[];              // Dependencies for ordering
}
```

### Exception Tracking

```typescript
interface ExceptionTrackingConfig {
  captureStackTrace: boolean;           // Capture stack traces
  enableSourceMaps: boolean;            // Enable source map support
  maxStackTraceDepth: number;           // Maximum stack trace depth (default: 50)
  enableUserContext: boolean;           // Capture user context
  enableRequestContext: boolean;        // Capture request context
  enableQueryContext: boolean;          // Capture query context
  groupSimilarErrors: boolean;          // Group similar errors
}
```

### Error Classification

```typescript
interface ErrorClassificationConfig {
  enableErrorClassification: boolean;   // Enable error classification
  classifyByType: boolean;              // Classify by error type
  classifyByMessage: boolean;           // Classify by error message
  classifyByLocation: boolean;          // Classify by stack location
}
```

### Filtering and Sampling

```typescript
interface FilteringConfig {
  excludeErrorTypes: string[];          // Error types to exclude
  excludeErrorMessages: string[];       // Error messages to exclude
  sampleRate: number;                   // Sampling rate (0-100)
  captureUnhandledRejections: boolean;  // Capture unhandled promise rejections
  captureUncaughtExceptions: boolean;   // Capture uncaught exceptions
}
```

### Context Collection

```typescript
interface ContextConfig {
  maxContextSize: number;               // Maximum context size in bytes
  captureHeaders: boolean;              // Capture HTTP headers
  captureBody: boolean;                 // Capture request body
  captureParams: boolean;               // Capture route parameters
  captureQuery: boolean;                // Capture query parameters
  captureEnvironment: boolean;          // Capture environment info
}
```

### Performance and Correlation

```typescript
interface PerformanceConfig {
  enablePerformanceTracking: boolean;   // Track performance impact
  correlateWithRequests: boolean;       // Correlate with requests
  correlateWithQueries: boolean;        // Correlate with database queries
}
```

### Real-time Alerts

```typescript
interface AlertConfig {
  enableRealTimeAlerts: boolean;        // Enable real-time alerts
  alertThresholds: {
    errorRate: number;                  // Error rate threshold (errors/second)
    criticalErrors: number;             // Critical error count threshold
    timeWindow: number;                 // Time window in milliseconds
  };
}
```

## Error Classification

The Exception Watcher automatically classifies errors into types, categories, and severity levels:

### Error Types

- `HTTP` - HTTP-related errors
- `VALIDATION` - Input validation errors
- `AUTHENTICATION` - Authentication errors
- `AUTHORIZATION` - Authorization errors
- `DATABASE` - Database-related errors
- `NETWORK` - Network connectivity errors
- `BUSINESS_LOGIC` - Business logic errors
- `SYSTEM` - System-level errors
- `UNKNOWN` - Unclassified errors

### Error Categories

- `CLIENT_ERROR` - 4xx HTTP errors
- `SERVER_ERROR` - 5xx HTTP errors
- `NETWORK_ERROR` - Network connectivity issues
- `DATABASE_ERROR` - Database operation errors
- `VALIDATION_ERROR` - Input validation failures
- `AUTHENTICATION_ERROR` - Authentication failures
- `AUTHORIZATION_ERROR` - Authorization failures
- `BUSINESS_ERROR` - Business logic violations
- `SYSTEM_ERROR` - System-level failures

### Error Severity

- `LOW` - Minor issues that don't significantly impact functionality
- `MEDIUM` - Moderate issues that may affect user experience
- `HIGH` - Serious issues that impact application functionality
- `CRITICAL` - Severe issues that may cause application failure

## API Reference

### ExceptionWatcherService

#### Methods

```typescript
class ExceptionWatcherService {
  // Track an exception manually
  trackException(context: ExceptionContext): void;

  // Get current metrics
  getMetrics(): ExceptionMetrics;

  // Get metrics stream for real-time updates
  getMetricsStream(): Observable<ExceptionMetrics>;

  // Get alerts stream
  getAlertsStream(): Observable<ExceptionAlert>;

  // Get exception groups
  getExceptionGroups(): ExceptionGroup[];

  // Get specific exception group
  getExceptionGroup(groupId: string): ExceptionGroup | undefined;

  // Get recent exceptions
  getRecentExceptions(limit?: number): ExceptionContext[];

  // Resolve an exception group
  resolveExceptionGroup(groupId: string, resolvedBy: string, notes?: string): boolean;

  // Acknowledge an alert
  acknowledgeAlert(alertId: string): boolean;

  // Get configuration
  getConfig(): ExceptionWatcherConfig;
}
```

### ExceptionContext

```typescript
interface ExceptionContext {
  id: string;                          // Unique exception ID
  timestamp: Date;                     // When the exception occurred
  error: Error;                        // The original error object
  errorType: string;                   // Error constructor name
  errorMessage: string;                // Error message
  errorCode?: string | number;         // Error code if available
  statusCode?: number;                 // HTTP status code
  
  // Stack trace information
  stackTrace?: string;                 // Raw stack trace
  stackFrames?: StackFrame[];          // Parsed stack frames
  
  // Request context
  request?: {
    id?: string;                       // Request ID
    method?: string;                   // HTTP method
    url?: string;                      // Request URL
    path?: string;                     // Request path
    headers?: Record<string, any>;     // Request headers
    body?: any;                        // Request body
    params?: Record<string, any>;      // Route parameters
    query?: Record<string, any>;       // Query parameters
    userAgent?: string;                // User agent
    ip?: string;                       // Client IP
    userId?: string;                   // User ID
    sessionId?: string;                // Session ID
  };
  
  // Response context
  response?: {
    statusCode?: number;               // Response status code
    headers?: Record<string, any>;     // Response headers
    body?: any;                        // Response body
    duration?: number;                 // Response time
  };
  
  // Environment context
  environment?: {
    nodeVersion?: string;              // Node.js version
    platform?: string;                // Platform
    hostname?: string;                 // Hostname
    memory?: NodeJS.MemoryUsage;       // Memory usage
    uptime?: number;                   // Process uptime
  };
  
  // Correlation IDs
  traceId?: string;                    // Trace ID
  requestId?: string;                  // Request ID
  userId?: string;                     // User ID
  sessionId?: string;                  // Session ID
  
  // Error classification
  classification?: {
    type: ErrorClassificationType;     // Error type
    category: ErrorCategory;           // Error category
    severity: ErrorSeverity;           // Error severity
    fingerprint: string;               // Error fingerprint
    groupId: string;                   // Group ID
  };
  
  // Performance tracking
  performance?: {
    responseTime?: number;             // Response time
    memoryUsage?: number;              // Memory usage
    cpuUsage?: number;                 // CPU usage
    activeConnections?: number;        // Active connections
  };
}
```

### ExceptionMetrics

```typescript
interface ExceptionMetrics {
  totalExceptions: number;             // Total exception count
  uniqueExceptions: number;            // Unique exception count
  errorRate: number;                   // Error rate percentage
  criticalErrors: number;              // Critical error count
  highSeverityErrors: number;          // High severity error count
  mediumSeverityErrors: number;        // Medium severity error count
  lowSeverityErrors: number;           // Low severity error count
  
  // Time-based metrics
  exceptionsPerMinute: number;         // Exceptions per minute
  exceptionsPerHour: number;           // Exceptions per hour
  
  // Classification metrics
  errorsByType: Record<string, number>;      // Errors by type
  errorsByCategory: Record<string, number>;  // Errors by category
  errorsBySeverity: Record<string, number>;  // Errors by severity
  
  // Top errors
  topErrors: Array<{
    groupId: string;                   // Group ID
    errorType: string;                 // Error type
    errorMessage: string;              // Error message
    count: number;                     // Occurrence count
    lastOccurrence: Date;              // Last occurrence
    severity: ErrorSeverity;           // Severity level
    category: ErrorCategory;           // Error category
  }>;
  
  // Performance impact
  averageResponseTime: number;         // Average response time
  affectedRequests: number;            // Number of affected requests
  
  // Trend analysis
  trends: {
    lastHour: ExceptionTrendData;      // Last hour trend
    lastDay: ExceptionTrendData;       // Last day trend
    lastWeek: ExceptionTrendData;      // Last week trend
  };
}
```

## Examples

### Custom Error Handling

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ExceptionWatcherService } from '@nestjs/telescope';

@Injectable()
export class CustomErrorHandler {
  private readonly logger = new Logger(CustomErrorHandler.name);

  constructor(private readonly exceptionWatcher: ExceptionWatcherService) {}

  handleBusinessLogicError(error: Error, context: any) {
    // Track custom business logic errors
    this.exceptionWatcher.trackException({
      id: `business_${Date.now()}`,
      timestamp: new Date(),
      error,
      errorType: 'BusinessLogicError',
      errorMessage: error.message,
      classification: {
        type: 'business_logic' as any,
        category: 'business_error' as any,
        severity: 'medium' as any,
        fingerprint: this.generateFingerprint(error),
        groupId: this.generateGroupId(error),
      },
      // Add custom context
      performance: {
        responseTime: context.responseTime,
        memoryUsage: process.memoryUsage().heapUsed,
      },
    });
  }

  private generateFingerprint(error: Error): string {
    // Custom fingerprint generation logic
    return `${error.constructor.name}:${error.message}`;
  }

  private generateGroupId(error: Error): string {
    // Custom group ID generation logic
    return `business_${error.constructor.name}`;
  }
}
```

### Real-time Monitoring

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ExceptionWatcherService } from '@nestjs/telescope';

@Injectable()
export class ExceptionMonitor implements OnModuleInit {
  constructor(private readonly exceptionWatcher: ExceptionWatcherService) {}

  onModuleInit() {
    // Monitor metrics in real-time
    this.exceptionWatcher.getMetricsStream().subscribe(metrics => {
      console.log('Exception Metrics:', {
        total: metrics.totalExceptions,
        rate: metrics.errorRate,
        critical: metrics.criticalErrors,
      });
    });

    // Monitor alerts
    this.exceptionWatcher.getAlertsStream().subscribe(alert => {
      console.log('Exception Alert:', {
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
      });

      // Send notification, page on-call, etc.
      this.handleAlert(alert);
    });
  }

  private handleAlert(alert: any) {
    // Custom alert handling logic
    if (alert.severity === 'critical') {
      // Page on-call engineer
      this.pageOnCall(alert);
    }
    
    // Send to monitoring system
    this.sendToMonitoring(alert);
  }
}
```

### Dashboard Integration

```typescript
import { Controller, Get, Param } from '@nestjs/common';
import { ExceptionWatcherService } from '@nestjs/telescope';

@Controller('api/exceptions')
export class ExceptionDashboardController {
  constructor(private readonly exceptionWatcher: ExceptionWatcherService) {}

  @Get('metrics')
  getMetrics() {
    return this.exceptionWatcher.getMetrics();
  }

  @Get('groups')
  getGroups() {
    return this.exceptionWatcher.getExceptionGroups();
  }

  @Get('groups/:groupId')
  getGroup(@Param('groupId') groupId: string) {
    return this.exceptionWatcher.getExceptionGroup(groupId);
  }

  @Get('recent')
  getRecentExceptions() {
    return this.exceptionWatcher.getRecentExceptions(50);
  }

  @Post('groups/:groupId/resolve')
  resolveGroup(
    @Param('groupId') groupId: string,
    @Body() body: { resolvedBy: string; notes?: string }
  ) {
    const resolved = this.exceptionWatcher.resolveExceptionGroup(
      groupId,
      body.resolvedBy,
      body.notes
    );
    return { resolved };
  }
}
```

## Best Practices

### 1. Configuration

- Enable stack trace capture in development and staging environments
- Use sampling in high-traffic production environments
- Configure appropriate alert thresholds based on your application's normal error rate
- Exclude known harmless errors to reduce noise

### 2. Security

- Never capture sensitive data in request bodies
- Use the built-in sanitization features
- Be careful with header capture in environments with sensitive tokens
- Consider data retention policies for exception data

### 3. Performance

- Monitor the performance impact of exception tracking
- Use sampling for high-volume applications
- Limit context size to prevent memory issues
- Set appropriate history limits

### 4. Monitoring

- Set up real-time alerts for critical errors
- Monitor error rate trends
- Use error grouping to identify patterns
- Correlate exceptions with other metrics

### 5. Error Resolution

- Use exception groups to track resolution status
- Add notes and assignees to groups
- Monitor resolution time metrics
- Use fingerprints to detect regressions

## Troubleshooting

### Common Issues

1. **High Memory Usage**
   - Reduce `maxContextSize`
   - Lower `maxStackTraceDepth`
   - Enable sampling with `sampleRate`

2. **Performance Impact**
   - Disable body capture in production
   - Use sampling for high-traffic endpoints
   - Limit context collection

3. **Too Many Alerts**
   - Adjust alert thresholds
   - Add error exclusions
   - Use grouping to reduce noise

4. **Missing Context**
   - Ensure proper configuration
   - Check sampling rate
   - Verify enabled features

### Debug Mode

Enable debug logging to troubleshoot issues:

```typescript
ExceptionWatcherModule.forRoot({
  // ... other config
  debug: true,
})
```

## License

This package is licensed under the MIT License.
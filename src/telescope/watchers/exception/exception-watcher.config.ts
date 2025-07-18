export interface ExceptionWatcherConfig {
  enabled: boolean;
  priority?: number;
  tags?: string[];
  dependencies?: string[];
  
  // Exception-specific configuration
  captureStackTrace: boolean;
  enableSourceMaps: boolean;
  maxStackTraceDepth: number;
  enableUserContext: boolean;
  enableRequestContext: boolean;
  enableQueryContext: boolean;
  groupSimilarErrors: boolean;
  
  // Error classification
  enableErrorClassification: boolean;
  classifyByType: boolean;
  classifyByMessage: boolean;
  classifyByLocation: boolean;
  
  // Filtering and sampling
  excludeErrorTypes: string[];
  excludeErrorMessages: string[];
  sampleRate: number;
  captureUnhandledRejections: boolean;
  captureUncaughtExceptions: boolean;
  
  // Context collection
  maxContextSize: number;
  captureHeaders: boolean;
  captureBody: boolean;
  captureParams: boolean;
  captureQuery: boolean;
  captureEnvironment: boolean;
  
  // Performance
  enablePerformanceTracking: boolean;
  correlateWithRequests: boolean;
  correlateWithQueries: boolean;
  
  // Real-time features
  enableRealTimeAlerts: boolean;
  alertThresholds: {
    errorRate: number;
    criticalErrors: number;
    timeWindow: number;
  };
}

export const defaultExceptionWatcherConfig: ExceptionWatcherConfig = {
  enabled: true,
  priority: 1,
  tags: ['exception', 'error', 'monitoring'],
  dependencies: [],
  
  captureStackTrace: true,
  enableSourceMaps: true,
  maxStackTraceDepth: 50,
  enableUserContext: true,
  enableRequestContext: true,
  enableQueryContext: true,
  groupSimilarErrors: true,
  
  enableErrorClassification: true,
  classifyByType: true,
  classifyByMessage: true,
  classifyByLocation: true,
  
  excludeErrorTypes: [
    'ValidationError',
    'UnauthorizedException',
    'ForbiddenException',
    'NotFoundException'
  ],
  excludeErrorMessages: [
    'Request timeout',
    'Connection refused',
    'Network error'
  ],
  sampleRate: 100,
  captureUnhandledRejections: true,
  captureUncaughtExceptions: true,
  
  maxContextSize: 50000, // 50KB
  captureHeaders: true,
  captureBody: false, // Disabled by default for security
  captureParams: true,
  captureQuery: true,
  captureEnvironment: true,
  
  enablePerformanceTracking: true,
  correlateWithRequests: true,
  correlateWithQueries: true,
  
  enableRealTimeAlerts: true,
  alertThresholds: {
    errorRate: 0.05, // 5% error rate
    criticalErrors: 10, // 10 critical errors in time window
    timeWindow: 300000 // 5 minutes
  }
};
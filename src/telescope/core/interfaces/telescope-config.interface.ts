export interface TelescopeConfig {
  enabled: boolean;
  environment: string;
  
  // DevTools Integration
  devtools: {
    enabled: boolean;
    port: number;
    features: {
      dependencyGraph: boolean;
      interactivePlayground: boolean;
      performanceMetrics: boolean;
    };
    bridge?: {
      resilience?: {
        circuitBreakerEnabled?: boolean;
        fallbackEnabled?: boolean;
        maxRetries?: number;
        timeout?: number;
        retryDelayMs?: number;
        healthCheckIntervalMs?: number;
      };
    };
  };
  
  // Storage Configuration
  storage: {
    driver: 'memory' | 'file' | 'database' | 'redis';
    fallback?: 'memory' | 'file' | 'database' | 'redis';
    connection?: string;
    retention: {
      hours: number;
      maxEntries: number;
    };
    batch: {
      enabled: boolean;
      size: number;
      flushInterval: number;
    };
    // Database storage options
    database?: {
      type: 'postgres' | 'mysql' | 'sqlite' | 'mariadb' | 'mssql';
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      database?: string;
      synchronize?: boolean;
      logging?: boolean;
    };
    // Redis storage options
    redis?: {
      host?: string;
      port?: number;
      password?: string;
      db?: number;
      ttl?: number;
      options?: any;
    };
    // File storage options
    file?: {
      directory?: string;
      maxFileSize?: number;
      compression?: boolean;
    };
  };
  
  // Dashboard Configuration
  dashboard: {
    enabled: boolean;
    path: string;
    strategy: 'devtools' | 'custom' | 'hybrid';
    authorization?: (req: any) => boolean;
  };
  
  // Feature Flags
  features: {
    realTimeUpdates: boolean;
    analytics: boolean;
    customWatchers: boolean;
  };
  
  // Watcher Configuration
  watchers?: {
    [key: string]: {
      enabled: boolean;
      priority?: number;
      tags?: string[];
      dependencies?: string[];
      // Request watcher specific config
      excludePaths?: string[];
      sampling?: {
        enabled: boolean;
        rate: number;
      };
      security?: {
        sanitizeParams: boolean;
        sanitizeHeaders: boolean;
        excludeHeaders: string[];
      };
      performance?: {
        slowRequestThreshold: number;
        enableDetailedTimings: boolean;
      };
      filters?: {
        excludeMethods: string[];
        excludeStatusCodes: number[];
        includeOnlyPaths: string[];
      };
      // Job watcher specific config
      trackJobExecution?: boolean;
      enablePerformanceTracking?: boolean;
      slowJobThreshold?: number;
      alertThresholds?: {
        failureRate?: number;
        avgExecutionTime?: number;
        queueSize?: number;
        stalledJobs?: number;
        timeWindow?: number;
      };
      bullIntegration?: {
        enabled: boolean;
        autoDiscoverQueues: boolean;
        trackJobProgress: boolean;
        trackJobResults: boolean;
      };
      maxHistorySize?: number;
      retentionPeriod?: number;
      excludeJobTypes?: string[];
      includeJobTypes?: string[];
      sampleRate?: number;
      // Cache watcher specific config
      trackCacheOperations?: boolean;
      slowOperationThreshold?: number;
      captureValues?: boolean;
      sanitizeKeys?: boolean;
      sanitizeValues?: boolean;
      maxKeyLength?: number;
      maxValueSize?: number;
      sensitiveKeyPatterns?: string[];
      excludeOperations?: string[];
      excludeKeyPatterns?: string[];
      includeKeyPatterns?: string[];
      redisIntegration?: {
        enabled: boolean;
        autoDiscoverInstances: boolean;
        monitorCommands: boolean;
        trackSlowQueries: boolean;
        slowQueryThreshold: number;
        trackMemoryUsage: boolean;
        trackConnectionPool: boolean;
      };
    };
  };
  
  // Week 7 Advanced Features
  enablePerformanceCorrelation?: boolean;
  enableAdvancedAnalytics?: boolean;
  enableExportReporting?: boolean;
}

// Default configuration
export const defaultTelescopeConfig: TelescopeConfig = {
  enabled: process.env.NODE_ENV !== 'production',
  environment: process.env.NODE_ENV || 'development',
  
  devtools: {
    enabled: true,
    port: 8001,
    features: {
      dependencyGraph: true,
      interactivePlayground: true,
      performanceMetrics: true
    }
  },
  
  storage: {
    driver: 'memory',
    retention: {
      hours: 24,
      maxEntries: 10000
    },
    batch: {
      enabled: true,
      size: 50,
      flushInterval: 5000
    }
  },
  
  dashboard: {
    enabled: true,
    path: '/telescope',
    strategy: 'hybrid',
    authorization: (req) => req.ip === '127.0.0.1' || process.env.NODE_ENV !== 'production'
  },
  
  features: {
    realTimeUpdates: true,
    analytics: false,
    customWatchers: true
  }
};
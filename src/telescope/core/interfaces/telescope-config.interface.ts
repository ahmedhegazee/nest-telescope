export interface TelescopeConfig {
  enabled: boolean;
  environment: string;
  
  // DevTools Integration
  devtools: {
    enabled: boolean;
    port: number;
    snapshot?: boolean;
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
        // Cache watcher alert thresholds
        hitRate?: number;
        missRate?: number;
        avgResponseTime?: number;
        errorRate?: number;
        memoryUsage?: number;
        connectionCount?: number;
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
  
  // Week 8-12 Advanced Features
  caching?: {
    enabled: boolean;
    tiers: {
      l1: { enabled: boolean; maxSize: number; ttl: number };
      l2: { enabled: boolean; maxSize: number; ttl: number };
      l3: { enabled: boolean; maxSize: number; ttl: number };
    };
    policies: {
      write: 'write-through' | 'write-back' | 'write-around';
      read: 'read-through' | 'cache-aside' | 'refresh-ahead';
      eviction: 'lru' | 'lfu' | 'fifo' | 'random';
    };
  };
  
  database?: {
    enabled: boolean;
    type: 'postgresql' | 'mysql' | 'mongodb' | 'sqlite';
    connection: {
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
      ssl: boolean;
      poolSize: number;
      timeout: number;
    };
    optimization: {
      connectionPooling: boolean;
      queryCaching: boolean;
      slowQueryThreshold: number;
      maxQueryTime: number;
    };
    monitoring: {
      enabled: boolean;
      metricsInterval: number;
      slowQueryLogging: boolean;
      performanceAlerts: boolean;
    };
  };
  
  memory?: {
    enabled: boolean;
    monitoring: {
      enabled: boolean;
      interval: number;
      gcMonitoring: boolean;
      leakDetection: boolean;
    };
    optimization: {
      enabled: boolean;
      gcTriggering: boolean;
      memoryPooling: boolean;
      compression: boolean;
    };
    thresholds: {
      warning: number;
      critical: number;
      gcThreshold: number;
    };
  };
  
  scaling?: {
    enabled: boolean;
    discovery: {
      enabled: boolean;
      interval: number;
      timeout: number;
    };
    communication: {
      protocol: 'http' | 'https' | 'tcp';
      port: number;
      timeout: number;
      retries: number;
    };
    loadBalancing: {
      strategy: 'round-robin' | 'least-loaded' | 'consistent-hash' | 'random';
      healthCheck: boolean;
      healthCheckInterval: number;
    };
    heartbeat: {
      enabled: boolean;
      interval: number;
      timeout: number;
    };
  };
  
  enterpriseSecurity?: {
    enabled: boolean;
    authentication: {
      enabled: boolean;
      methods: ('jwt' | 'oauth2' | 'saml' | 'ldap' | 'active-directory')[];
      jwt: {
        secret: string;
        expiresIn: string;
        refreshExpiresIn: string;
      };
      oauth2: {
        clientId: string;
        clientSecret: string;
        authorizationUrl: string;
        tokenUrl: string;
      };
      saml: {
        entryPoint: string;
        issuer: string;
        cert: string;
      };
      ldap: {
        url: string;
        bindDN: string;
        bindCredentials: string;
        searchBase: string;
        searchFilter: string;
      };
    };
    authorization: {
      enabled: boolean;
      rbac: boolean;
      abac: boolean;
      policies: any[];
    };
    encryption: {
      enabled: boolean;
      algorithm: 'aes-256-gcm' | 'aes-256-cbc' | 'chacha20-poly1305';
      keyRotation: boolean;
      keyRotationInterval: number;
    };
    audit: {
      enabled: boolean;
      logLevel: 'info' | 'warn' | 'error';
      retention: number;
    };
    compliance: {
      gdpr: boolean;
      sox: boolean;
      hipaa: boolean;
      pci: boolean;
    };
  };
  
  multiTenant?: {
    enabled: boolean;
    isolation: {
      strategy: 'database' | 'schema' | 'row' | 'application';
      database: string;
      schemaPrefix: string;
      rowPrefix: string;
    };
    management: {
      autoProvisioning: boolean;
      resourceLimits: boolean;
      quotas: boolean;
    };
    branding: {
      enabled: boolean;
      customThemes: boolean;
      customLogos: boolean;
    };
    monitoring: {
      enabled: boolean;
      interval: number;
      resourceTracking: boolean;
    };
  };
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
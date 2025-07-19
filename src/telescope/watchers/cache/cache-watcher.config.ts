export interface CacheWatcherConfig {
  enabled: boolean;
  priority?: number;
  tags?: string[];
  dependencies?: string[];
  
  // Cache operation tracking
  trackCacheOperations: boolean;
  trackCacheHits: boolean;
  trackCacheMisses: boolean;
  trackCacheEvictions: boolean;
  trackCacheExpiration: boolean;
  trackCacheSize: boolean;
  
  // Performance monitoring
  enablePerformanceTracking: boolean;
  trackExecutionTime: boolean;
  trackMemoryUsage: boolean;
  slowOperationThreshold: number; // milliseconds
  
  // Data collection
  captureKeys: boolean;
  captureValues: boolean;
  captureKeyPatterns: boolean;
  maxValueSize: number; // bytes
  maxKeyLength: number; // characters
  
  // Redis monitoring
  trackRedisCommands: boolean;
  trackRedisConnections: boolean;
  trackRedisMemory: boolean;
  trackRedisStats: boolean;
  
  // Connection monitoring
  trackConnectionHealth: boolean;
  trackConnectionMetrics: boolean;
  monitorConnectionEvents: boolean;
  
  // Filtering and sampling
  excludeOperations: string[];
  excludeKeyPatterns: string[];
  includeKeyPatterns: string[];
  sampleRate: number; // 0-100
  
  // Security
  sensitiveKeyPatterns: string[];
  sanitizeValues: boolean;
  
  // Alerting
  enableRealTimeAlerts: boolean;
  alertThresholds: {
    hitRate: number; // percentage
    missRate: number; // percentage
    avgResponseTime: number; // milliseconds
    errorRate: number; // percentage
    memoryUsage: number; // percentage
    connectionCount: number; // number
    timeWindow: number; // milliseconds
  };
  
  // Redis integration
  redisIntegration?: {
    enabled: boolean;
    autoDiscoverInstances: boolean;
    monitorCommands: boolean;
    trackSlowQueries: boolean;
    slowQueryThreshold: number; // milliseconds
    trackMemoryUsage: boolean;
    trackConnectionPool: boolean;
    instances?: Array<{
      name: string;
      host: string;
      port: number;
      password?: string;
      database?: number;
    }>;
  };
  
  // Correlation
  correlateWithRequests: boolean;
  correlateWithQueries: boolean;
  correlateWithJobs: boolean;
  
  // Retention
  retentionPeriod: number; // milliseconds
  maxHistorySize: number; // number of entries
}

export const defaultCacheWatcherConfig: CacheWatcherConfig = {
  enabled: true,
  priority: 4,
  tags: ['cache', 'redis', 'performance', 'monitoring'],
  dependencies: [],
  
  trackCacheOperations: true,
  trackCacheHits: true,
  trackCacheMisses: true,
  trackCacheEvictions: true,
  trackCacheExpiration: true,
  trackCacheSize: true,
  
  enablePerformanceTracking: true,
  trackExecutionTime: true,
  trackMemoryUsage: true,
  slowOperationThreshold: 100, // 100ms
  
  captureKeys: true,
  captureValues: false, // Disabled by default for security
  captureKeyPatterns: true,
  maxValueSize: 1000, // 1KB
  maxKeyLength: 200, // 200 characters
  
  trackRedisCommands: true,
  trackRedisConnections: true,
  trackRedisMemory: true,
  trackRedisStats: true,
  
  trackConnectionHealth: true,
  trackConnectionMetrics: true,
  monitorConnectionEvents: true,
  
  excludeOperations: [],
  excludeKeyPatterns: [],
  includeKeyPatterns: [],
  sampleRate: 100,
  
  sensitiveKeyPatterns: [
    '*token*',
    '*password*',
    '*secret*',
    '*auth*',
    '*session*',
    '*key*',
  ],
  sanitizeValues: true,
  
  enableRealTimeAlerts: true,
  alertThresholds: {
    hitRate: 80, // 80% hit rate
    missRate: 20, // 20% miss rate
    avgResponseTime: 50, // 50ms
    errorRate: 5, // 5% error rate
    memoryUsage: 80, // 80% memory usage
    connectionCount: 100, // 100 connections
    timeWindow: 300000, // 5 minutes
  },
  
  redisIntegration: {
    enabled: true,
    autoDiscoverInstances: true,
    monitorCommands: true,
    trackSlowQueries: true,
    slowQueryThreshold: 100, // 100ms
    trackMemoryUsage: true,
    trackConnectionPool: true,
    instances: [
      {
        name: 'default',
        host: 'localhost',
        port: 6379,
      },
    ],
  },
  
  correlateWithRequests: true,
  correlateWithQueries: true,
  correlateWithJobs: true,
  
  retentionPeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxHistorySize: 10000,
};
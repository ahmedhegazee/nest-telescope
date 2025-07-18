export interface QueryWatcherConfig {
  enabled: boolean;
  priority?: number;
  tags?: string[];
  dependencies?: string[];
  
  // Query-specific configuration
  slowQueryThreshold: number;
  verySlowQueryThreshold: number;
  enableStackTrace: boolean;
  enableQueryAnalysis: boolean;
  enableOptimizationHints: boolean;
  maxQueryLength: number;
  excludeQueries: string[];
  sampleRate: number;
  connectionPoolMonitoring: boolean;
}

export const defaultQueryWatcherConfig: QueryWatcherConfig = {
  enabled: true,
  priority: 1,
  tags: ['query', 'database'],
  dependencies: ['typeorm'],
  slowQueryThreshold: 1000,
  verySlowQueryThreshold: 5000,
  enableStackTrace: true,
  enableQueryAnalysis: true,
  enableOptimizationHints: true,
  maxQueryLength: 10000,
  excludeQueries: ['SELECT 1', 'SHOW TABLES', 'DESCRIBE'],
  sampleRate: 100,
  connectionPoolMonitoring: true
};
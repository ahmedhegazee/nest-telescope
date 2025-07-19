export interface JobWatcherConfig {
  enabled: boolean;
  priority?: number;
  tags?: string[];
  dependencies?: string[];
  
  // Job tracking configuration
  trackJobExecution: boolean;
  trackJobProgress: boolean;
  trackJobResults: boolean;
  trackJobErrors: boolean;
  trackJobRetries: boolean;
  trackJobDelays: boolean;
  
  // Performance monitoring
  enablePerformanceTracking: boolean;
  trackCpuUsage: boolean;
  trackMemoryUsage: boolean;
  trackExecutionTime: boolean;
  slowJobThreshold: number; // milliseconds
  
  // Data collection
  captureJobData: boolean;
  captureJobResults: boolean;
  captureJobErrors: boolean;
  maxDataSize: number; // bytes
  
  // Queue monitoring
  trackQueueHealth: boolean;
  trackQueueMetrics: boolean;
  monitorQueueEvents: boolean;
  
  // Worker monitoring
  trackWorkerHealth: boolean;
  trackWorkerMetrics: boolean;
  monitorWorkerEvents: boolean;
  
  // Filtering and sampling
  excludeJobTypes: string[];
  excludeQueues: string[];
  sampleRate: number; // 0-100
  
  // Alerting
  enableRealTimeAlerts: boolean;
  alertThresholds: {
    failureRate: number; // percentage
    avgExecutionTime: number; // milliseconds
    queueSize: number; // number of jobs
    stalledJobs: number; // number of stalled jobs
    timeWindow: number; // milliseconds
  };
  
  // Correlation
  correlateWithRequests: boolean;
  correlateWithExceptions: boolean;
  correlateWithQueries: boolean;
  
  // Retention
  retentionPeriod: number; // milliseconds
  maxHistorySize: number; // number of entries
}

export const defaultJobWatcherConfig: JobWatcherConfig = {
  enabled: true,
  priority: 3,
  tags: ['job', 'queue', 'worker', 'monitoring'],
  dependencies: [],
  
  trackJobExecution: true,
  trackJobProgress: true,
  trackJobResults: true,
  trackJobErrors: true,
  trackJobRetries: true,
  trackJobDelays: true,
  
  enablePerformanceTracking: true,
  trackCpuUsage: true,
  trackMemoryUsage: true,
  trackExecutionTime: true,
  slowJobThreshold: 5000, // 5 seconds
  
  captureJobData: true,
  captureJobResults: true,
  captureJobErrors: true,
  maxDataSize: 10000, // 10KB
  
  trackQueueHealth: true,
  trackQueueMetrics: true,
  monitorQueueEvents: true,
  
  trackWorkerHealth: true,
  trackWorkerMetrics: true,
  monitorWorkerEvents: true,
  
  excludeJobTypes: [],
  excludeQueues: [],
  sampleRate: 100,
  
  enableRealTimeAlerts: true,
  alertThresholds: {
    failureRate: 10, // 10%
    avgExecutionTime: 30000, // 30 seconds
    queueSize: 1000, // 1000 jobs
    stalledJobs: 5, // 5 stalled jobs
    timeWindow: 300000, // 5 minutes
  },
  
  correlateWithRequests: true,
  correlateWithExceptions: true,
  correlateWithQueries: true,
  
  retentionPeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxHistorySize: 10000,
};
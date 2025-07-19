import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { TelescopeService } from '../../core/services/telescope.service';
import { TelescopeEntry } from '../../core/interfaces/telescope-entry.interface';
import { JobWatcherConfig, defaultJobWatcherConfig } from './job-watcher.config';
import { Observable, Subject, interval, BehaviorSubject } from 'rxjs';
import { map, takeUntil, shareReplay } from 'rxjs/operators';

export interface JobContext {
  id: string;
  jobId: string;
  queueName: string;
  jobName: string;
  timestamp: Date;
  status: JobStatus;
  priority: number;
  
  // Job data
  data?: any;
  options?: any;
  result?: any;
  error?: any;
  
  // Execution info
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  attempts: number;
  maxAttempts: number;
  delay?: number;
  
  // Progress tracking
  progress?: number;
  progressData?: any;
  
  // Performance metrics
  performance?: {
    cpuUsage?: number;
    memoryUsage?: number;
    executionTime?: number;
    queueWaitTime?: number;
  };
  
  // Correlation
  traceId?: string;
  requestId?: string;
  userId?: string;
  sessionId?: string;
  
  // Worker info
  workerId?: string;
  workerName?: string;
  
  // Queue state
  queueStats?: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  };
}

export enum JobStatus {
  WAITING = 'waiting',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DELAYED = 'delayed',
  PAUSED = 'paused',
  STALLED = 'stalled',
  CANCELLED = 'cancelled'
}

export interface JobMetrics {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  activeJobs: number;
  waitingJobs: number;
  delayedJobs: number;
  stalledJobs: number;
  
  // Performance metrics
  averageExecutionTime: number;
  averageWaitTime: number;
  slowJobs: number;
  
  // Rates
  jobsPerMinute: number;
  jobsPerHour: number;
  failureRate: number;
  throughput: number;
  
  // Queue metrics
  queuesByStatus: Record<string, number>;
  queuesByType: Record<string, number>;
  
  // Worker metrics
  activeWorkers: number;
  busyWorkers: number;
  idleWorkers: number;
  
  // Top jobs
  topFailedJobs: Array<{
    jobName: string;
    queueName: string;
    failureCount: number;
    lastFailure: Date;
    avgExecutionTime: number;
  }>;
  
  topSlowJobs: Array<{
    jobName: string;
    queueName: string;
    avgExecutionTime: number;
    executionCount: number;
    lastExecution: Date;
  }>;
  
  // Health metrics
  healthScore: number;
  healthStatus: 'healthy' | 'warning' | 'critical';
  
  // Trends
  trends: {
    lastHour: JobTrendData;
    lastDay: JobTrendData;
    lastWeek: JobTrendData;
  };
}

export interface JobTrendData {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  averageExecutionTime: number;
  change: number;
  changePercent: number;
  peak: number;
}

export interface JobAlert {
  id: string;
  type: 'failure_rate' | 'slow_jobs' | 'queue_size' | 'stalled_jobs' | 'worker_health';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  data: any;
  acknowledged: boolean;
  resolvedAt?: Date;
  queueName?: string;
  jobName?: string;
}

export interface QueueHealth {
  queueName: string;
  status: 'healthy' | 'warning' | 'critical';
  score: number;
  issues: string[];
  recommendations: string[];
  metrics: {
    totalJobs: number;
    processingRate: number;
    failureRate: number;
    averageWaitTime: number;
    stalledJobs: number;
  };
}

@Injectable()
export class JobWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobWatcherService.name);
  private readonly config: JobWatcherConfig;
  private readonly destroy$ = new Subject<void>();
  private readonly metricsSubject = new BehaviorSubject<JobMetrics>(this.initializeMetrics());
  private readonly alertsSubject = new Subject<JobAlert>();
  private readonly jobContextSubject = new Subject<JobContext>();
  
  private jobHistory: JobContext[] = [];
  private queueMetrics = new Map<string, any>();
  private workerMetrics = new Map<string, any>();
  private activeJobs = new Map<string, JobContext>();
  private currentMetrics: JobMetrics = this.initializeMetrics();
  private alertHistory: JobAlert[] = [];
  
  // Performance tracking
  private executionTimes: number[] = [];
  private waitTimes: number[] = [];
  private failureHistory: Array<{ timestamp: Date; jobName: string; queueName: string }> = [];
  
  constructor(
    private readonly telescopeService: TelescopeService,
    @Inject('JOB_WATCHER_CONFIG') jobWatcherConfig: JobWatcherConfig
  ) {
    this.config = { ...defaultJobWatcherConfig, ...jobWatcherConfig };
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    this.startPeriodicProcessing();
    this.logger.log('Job watcher initialized');
  }

  onModuleDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeMetrics(): JobMetrics {
    return {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      activeJobs: 0,
      waitingJobs: 0,
      delayedJobs: 0,
      stalledJobs: 0,
      averageExecutionTime: 0,
      averageWaitTime: 0,
      slowJobs: 0,
      jobsPerMinute: 0,
      jobsPerHour: 0,
      failureRate: 0,
      throughput: 0,
      queuesByStatus: {},
      queuesByType: {},
      activeWorkers: 0,
      busyWorkers: 0,
      idleWorkers: 0,
      topFailedJobs: [],
      topSlowJobs: [],
      healthScore: 100,
      healthStatus: 'healthy',
      trends: {
        lastHour: this.initializeTrendData(),
        lastDay: this.initializeTrendData(),
        lastWeek: this.initializeTrendData(),
      },
    };
  }

  private initializeTrendData(): JobTrendData {
    return {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      averageExecutionTime: 0,
      change: 0,
      changePercent: 0,
      peak: 0,
    };
  }

  trackJob(context: JobContext): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Apply sampling
      if (Math.random() * 100 > this.config.sampleRate) {
        return;
      }

      // Check exclusions
      if (this.shouldExcludeJob(context)) {
        return;
      }

      // Add to history
      this.addToHistory(context);

      // Update active jobs tracking
      this.updateActiveJobs(context);

      // Update metrics
      this.updateMetrics(context);

      // Create telescope entry
      const entry = this.createTelescopeEntry(context);
      this.telescopeService.record(entry);

      // Check for alerts
      this.checkAlerts(context);

      // Correlate with other systems
      this.correlateJob(context);

      // Emit job context
      this.jobContextSubject.next(context);

      this.logger.debug(`Job tracked: ${context.jobName} (${context.id})`);

    } catch (error) {
      this.logger.error('Failed to track job:', error);
    }
  }

  private shouldExcludeJob(context: JobContext): boolean {
    if (this.config.excludeJobTypes.includes(context.jobName)) {
      return true;
    }

    if (this.config.excludeQueues.includes(context.queueName)) {
      return true;
    }

    return false;
  }

  private addToHistory(context: JobContext): void {
    this.jobHistory.push(context);
    
    // Maintain history size limit
    if (this.jobHistory.length > this.config.maxHistorySize) {
      this.jobHistory.shift();
    }

    // Clean up old entries
    const retentionDate = new Date(Date.now() - this.config.retentionPeriod);
    this.jobHistory = this.jobHistory.filter(job => job.timestamp > retentionDate);
  }

  private updateActiveJobs(context: JobContext): void {
    const key = `${context.queueName}:${context.jobId}`;

    if (context.status === JobStatus.ACTIVE) {
      this.activeJobs.set(key, context);
    } else if (context.status === JobStatus.COMPLETED || context.status === JobStatus.FAILED) {
      this.activeJobs.delete(key);
    }
  }

  private updateMetrics(context: JobContext): void {
    this.currentMetrics.totalJobs++;

    // Update status counters
    switch (context.status) {
      case JobStatus.COMPLETED:
        this.currentMetrics.completedJobs++;
        break;
      case JobStatus.FAILED:
        this.currentMetrics.failedJobs++;
        this.trackFailure(context);
        break;
      case JobStatus.ACTIVE:
        this.currentMetrics.activeJobs++;
        break;
      case JobStatus.WAITING:
        this.currentMetrics.waitingJobs++;
        break;
      case JobStatus.DELAYED:
        this.currentMetrics.delayedJobs++;
        break;
      case JobStatus.STALLED:
        this.currentMetrics.stalledJobs++;
        break;
    }

    // Update performance metrics
    if (context.duration) {
      this.executionTimes.push(context.duration);
      this.currentMetrics.averageExecutionTime = this.calculateAverage(this.executionTimes);
      
      if (context.duration > this.config.slowJobThreshold) {
        this.currentMetrics.slowJobs++;
      }
    }

    if (context.performance?.queueWaitTime) {
      this.waitTimes.push(context.performance.queueWaitTime);
      this.currentMetrics.averageWaitTime = this.calculateAverage(this.waitTimes);
    }

    // Update queue metrics
    this.currentMetrics.queuesByStatus[context.status] = 
      (this.currentMetrics.queuesByStatus[context.status] || 0) + 1;
    
    this.currentMetrics.queuesByType[context.jobName] = 
      (this.currentMetrics.queuesByType[context.jobName] || 0) + 1;

    // Update rates
    this.updateRates();

    // Update top jobs
    this.updateTopJobs();

    // Update health score
    this.updateHealthScore();
  }

  private trackFailure(context: JobContext): void {
    this.failureHistory.push({
      timestamp: context.timestamp,
      jobName: context.jobName,
      queueName: context.queueName,
    });

    // Keep only recent failures
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    this.failureHistory = this.failureHistory.filter(f => f.timestamp > oneHourAgo);
  }

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private updateRates(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    const jobsLastMinute = this.jobHistory.filter(
      job => job.timestamp.getTime() > oneMinuteAgo
    ).length;

    const jobsLastHour = this.jobHistory.filter(
      job => job.timestamp.getTime() > oneHourAgo
    ).length;

    this.currentMetrics.jobsPerMinute = jobsLastMinute;
    this.currentMetrics.jobsPerHour = jobsLastHour;

    // Calculate failure rate
    const totalJobs = this.currentMetrics.totalJobs || 1;
    this.currentMetrics.failureRate = (this.currentMetrics.failedJobs / totalJobs) * 100;

    // Calculate throughput (jobs per second)
    this.currentMetrics.throughput = jobsLastMinute / 60;
  }

  private updateTopJobs(): void {
    // Update top failed jobs
    const failureGroups = new Map<string, { count: number; lastFailure: Date; execTimes: number[] }>();

    this.failureHistory.forEach(failure => {
      const key = `${failure.queueName}:${failure.jobName}`;
      const existing = failureGroups.get(key) || { count: 0, lastFailure: failure.timestamp, execTimes: [] };
      existing.count++;
      existing.lastFailure = failure.timestamp;
      failureGroups.set(key, existing);
    });

    this.currentMetrics.topFailedJobs = Array.from(failureGroups.entries())
      .map(([key, data]) => {
        const [queueName, jobName] = key.split(':');
        return {
          queueName,
          jobName,
          failureCount: data.count,
          lastFailure: data.lastFailure,
          avgExecutionTime: this.calculateAverage(data.execTimes),
        };
      })
      .sort((a, b) => b.failureCount - a.failureCount)
      .slice(0, 10);

    // Update top slow jobs
    const slowJobGroups = new Map<string, { execTimes: number[]; lastExecution: Date }>();

    this.jobHistory
      .filter(job => job.duration && job.duration > this.config.slowJobThreshold)
      .forEach(job => {
        const key = `${job.queueName}:${job.jobName}`;
        const existing = slowJobGroups.get(key) || { execTimes: [], lastExecution: job.timestamp };
        existing.execTimes.push(job.duration!);
        existing.lastExecution = job.timestamp;
        slowJobGroups.set(key, existing);
      });

    this.currentMetrics.topSlowJobs = Array.from(slowJobGroups.entries())
      .map(([key, data]) => {
        const [queueName, jobName] = key.split(':');
        return {
          queueName,
          jobName,
          avgExecutionTime: this.calculateAverage(data.execTimes),
          executionCount: data.execTimes.length,
          lastExecution: data.lastExecution,
        };
      })
      .sort((a, b) => b.avgExecutionTime - a.avgExecutionTime)
      .slice(0, 10);
  }

  private updateHealthScore(): void {
    let score = 100;
    const issues: string[] = [];

    // Penalize high failure rate
    if (this.currentMetrics.failureRate > 20) {
      score -= 30;
      issues.push('High failure rate');
    } else if (this.currentMetrics.failureRate > 10) {
      score -= 15;
      issues.push('Moderate failure rate');
    }

    // Penalize slow jobs
    if (this.currentMetrics.slowJobs > this.currentMetrics.totalJobs * 0.2) {
      score -= 20;
      issues.push('Many slow jobs');
    }

    // Penalize stalled jobs
    if (this.currentMetrics.stalledJobs > 0) {
      score -= 25;
      issues.push('Stalled jobs detected');
    }

    // Penalize high queue wait times
    if (this.currentMetrics.averageWaitTime > 30000) { // 30 seconds
      score -= 15;
      issues.push('High queue wait times');
    }

    this.currentMetrics.healthScore = Math.max(0, score);
    
    if (score >= 80) {
      this.currentMetrics.healthStatus = 'healthy';
    } else if (score >= 60) {
      this.currentMetrics.healthStatus = 'warning';
    } else {
      this.currentMetrics.healthStatus = 'critical';
    }
  }

  private createTelescopeEntry(context: JobContext): TelescopeEntry {
    const entryId = `job_${context.id}`;
    const familyHash = `${context.queueName}:${context.jobName}`;

    return {
      id: entryId,
      type: 'job',
      familyHash,
      content: {
        job: {
          id: context.jobId,
          name: context.jobName,
          queue: context.queueName,
          status: context.status,
          priority: context.priority,
          attempts: context.attempts,
          maxAttempts: context.maxAttempts,
          delay: context.delay,
          progress: context.progress,
        },
        execution: {
          startTime: context.startTime,
          endTime: context.endTime,
          duration: context.duration,
          result: this.config.captureJobResults ? context.result : undefined,
          error: this.config.captureJobErrors ? context.error : undefined,
        },
        data: this.config.captureJobData ? this.sanitizeJobData(context.data) : undefined,
        performance: context.performance,
        correlation: {
          traceId: context.traceId,
          requestId: context.requestId,
          userId: context.userId,
          sessionId: context.sessionId,
        },
        worker: {
          id: context.workerId,
          name: context.workerName,
        },
        queueStats: context.queueStats,
      },
      tags: this.generateTags(context),
      timestamp: context.timestamp,
      sequence: context.timestamp.getTime(),
    };
  }

  private sanitizeJobData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sanitized = { ...data };
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth', 'apiKey'];
    
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    // Limit size
    const jsonString = JSON.stringify(sanitized);
    if (jsonString.length > this.config.maxDataSize) {
      return { _truncated: true, _size: jsonString.length };
    }

    return sanitized;
  }

  private generateTags(context: JobContext): string[] {
    const tags: string[] = [
      'job',
      `queue:${context.queueName}`,
      `job:${context.jobName}`,
      `status:${context.status}`,
    ];

    if (context.priority) {
      tags.push(`priority:${context.priority}`);
    }

    if (context.attempts > 1) {
      tags.push('retry');
    }

    if (context.delay) {
      tags.push('delayed');
    }

    if (context.workerId) {
      tags.push(`worker:${context.workerId}`);
    }

    return tags;
  }

  private checkAlerts(context: JobContext): void {
    if (!this.config.enableRealTimeAlerts) {
      return;
    }

    const now = Date.now();
    const timeWindow = this.config.alertThresholds.timeWindow;

    // Check failure rate
    if (this.currentMetrics.failureRate > this.config.alertThresholds.failureRate) {
      this.createAlert({
        type: 'failure_rate',
        severity: 'high',
        message: `Job failure rate exceeded threshold: ${this.currentMetrics.failureRate.toFixed(1)}%`,
        data: { failureRate: this.currentMetrics.failureRate, threshold: this.config.alertThresholds.failureRate },
        queueName: context.queueName,
      });
    }

    // Check slow jobs
    if (context.duration && context.duration > this.config.alertThresholds.avgExecutionTime) {
      this.createAlert({
        type: 'slow_jobs',
        severity: 'medium',
        message: `Slow job detected: ${context.jobName} took ${context.duration}ms`,
        data: { duration: context.duration, threshold: this.config.alertThresholds.avgExecutionTime },
        queueName: context.queueName,
        jobName: context.jobName,
      });
    }

    // Check stalled jobs
    if (this.currentMetrics.stalledJobs >= this.config.alertThresholds.stalledJobs) {
      this.createAlert({
        type: 'stalled_jobs',
        severity: 'critical',
        message: `Stalled jobs detected: ${this.currentMetrics.stalledJobs} jobs`,
        data: { stalledJobs: this.currentMetrics.stalledJobs, threshold: this.config.alertThresholds.stalledJobs },
      });
    }
  }

  private createAlert(alert: Omit<JobAlert, 'id' | 'timestamp' | 'acknowledged'>): void {
    const fullAlert: JobAlert = {
      id: `job_alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      acknowledged: false,
      ...alert,
    };

    this.alertHistory.push(fullAlert);
    this.alertsSubject.next(fullAlert);

    this.logger.warn(`Job alert: ${fullAlert.message}`, fullAlert.data);
  }

  private correlateJob(context: JobContext): void {
    // Correlation implementation would link jobs with requests, exceptions, and queries
    // For now, we'll just log the correlation
    if (context.traceId) {
      this.logger.debug(`Correlated job ${context.jobName} with trace ${context.traceId}`);
    }
  }

  private startPeriodicProcessing(): void {
    // Update metrics and trends every 30 seconds
    interval(30000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.updateTrends();
        this.cleanupOldData();
        this.metricsSubject.next({ ...this.currentMetrics });
      });
  }

  private updateTrends(): void {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    this.currentMetrics.trends.lastHour = this.calculateTrend(oneHourAgo);
    this.currentMetrics.trends.lastDay = this.calculateTrend(oneDayAgo);
    this.currentMetrics.trends.lastWeek = this.calculateTrend(oneWeekAgo);
  }

  private calculateTrend(since: number): JobTrendData {
    const jobs = this.jobHistory.filter(job => job.timestamp.getTime() > since);
    const completed = jobs.filter(job => job.status === JobStatus.COMPLETED);
    const failed = jobs.filter(job => job.status === JobStatus.FAILED);
    const execTimes = jobs.filter(job => job.duration).map(job => job.duration!);

    return {
      totalJobs: jobs.length,
      completedJobs: completed.length,
      failedJobs: failed.length,
      averageExecutionTime: this.calculateAverage(execTimes),
      change: 0, // Would need historical data
      changePercent: 0,
      peak: execTimes.length > 0 ? Math.max(...execTimes) : 0,
    };
  }

  private cleanupOldData(): void {
    const now = Date.now();
    const retentionDate = new Date(now - this.config.retentionPeriod);

    // Clean up job history
    this.jobHistory = this.jobHistory.filter(job => job.timestamp > retentionDate);

    // Clean up alert history
    this.alertHistory = this.alertHistory.filter(alert => alert.timestamp > retentionDate);

    // Clean up execution times (keep last 1000)
    if (this.executionTimes.length > 1000) {
      this.executionTimes = this.executionTimes.slice(-1000);
    }

    // Clean up wait times (keep last 1000)
    if (this.waitTimes.length > 1000) {
      this.waitTimes = this.waitTimes.slice(-1000);
    }
  }

  // Public API
  getMetrics(): JobMetrics {
    return { ...this.currentMetrics };
  }

  getMetricsStream(): Observable<JobMetrics> {
    return this.metricsSubject.asObservable().pipe(shareReplay(1));
  }

  getAlertsStream(): Observable<JobAlert> {
    return this.alertsSubject.asObservable();
  }

  getJobStream(): Observable<JobContext> {
    return this.jobContextSubject.asObservable();
  }

  getRecentJobs(limit: number = 100): JobContext[] {
    return this.jobHistory.slice(-limit).reverse();
  }

  getJobsByQueue(queueName: string, limit: number = 100): JobContext[] {
    return this.jobHistory
      .filter(job => job.queueName === queueName)
      .slice(-limit)
      .reverse();
  }

  getJobsByStatus(status: JobStatus, limit: number = 100): JobContext[] {
    return this.jobHistory
      .filter(job => job.status === status)
      .slice(-limit)
      .reverse();
  }

  getQueueHealth(queueName?: string): QueueHealth | QueueHealth[] {
    if (queueName) {
      return this.calculateQueueHealth(queueName);
    }

    const queues = new Set(this.jobHistory.map(job => job.queueName));
    return Array.from(queues).map(queue => this.calculateQueueHealth(queue));
  }

  private calculateQueueHealth(queueName: string): QueueHealth {
    const queueJobs = this.jobHistory.filter(job => job.queueName === queueName);
    const totalJobs = queueJobs.length;
    const failedJobs = queueJobs.filter(job => job.status === JobStatus.FAILED).length;
    const stalledJobs = queueJobs.filter(job => job.status === JobStatus.STALLED).length;
    const execTimes = queueJobs.filter(job => job.duration).map(job => job.duration!);
    const waitTimes = queueJobs.filter(job => job.performance?.queueWaitTime).map(job => job.performance!.queueWaitTime!);

    const failureRate = totalJobs > 0 ? (failedJobs / totalJobs) * 100 : 0;
    const avgWaitTime = this.calculateAverage(waitTimes);
    const processingRate = totalJobs > 0 ? (totalJobs - failedJobs) / totalJobs : 0;

    let score = 100;
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (failureRate > 20) {
      score -= 30;
      issues.push('High failure rate');
      recommendations.push('Investigate failing jobs and fix underlying issues');
    }

    if (stalledJobs > 0) {
      score -= 25;
      issues.push('Stalled jobs detected');
      recommendations.push('Check worker health and restart if necessary');
    }

    if (avgWaitTime > 30000) {
      score -= 15;
      issues.push('High queue wait times');
      recommendations.push('Consider adding more workers or optimizing job processing');
    }

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (score < 60) {
      status = 'critical';
    } else if (score < 80) {
      status = 'warning';
    }

    return {
      queueName,
      status,
      score,
      issues,
      recommendations,
      metrics: {
        totalJobs,
        processingRate,
        failureRate,
        averageWaitTime: avgWaitTime,
        stalledJobs,
      },
    };
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alertHistory.find(a => a.id === alertId);
    if (!alert) return false;

    alert.acknowledged = true;
    return true;
  }

  getConfig(): JobWatcherConfig {
    return { ...this.config };
  }
}
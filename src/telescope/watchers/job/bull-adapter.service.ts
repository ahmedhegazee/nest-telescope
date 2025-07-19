import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobWatcherService, JobContext, JobStatus } from './job-watcher.service';
import { ModuleRef } from '@nestjs/core';

export interface BullJob {
  id: string | number;
  name: string;
  data: any;
  opts: any;
  progress: number;
  returnvalue: any;
  failedReason: string;
  stacktrace: string[];
  attemptsMade: number;
  delay: number;
  timestamp: number;
  processedOn: number;
  finishedOn: number;
  queue: BullQueue;
}

export interface BullQueue {
  name: string;
  waiting: () => Promise<BullJob[]>;
  active: () => Promise<BullJob[]>;
  completed: () => Promise<BullJob[]>;
  failed: () => Promise<BullJob[]>;
  delayed: () => Promise<BullJob[]>;
  paused: () => Promise<BullJob[]>;
  getWaiting: () => Promise<BullJob[]>;
  getActive: () => Promise<BullJob[]>;
  getCompleted: () => Promise<BullJob[]>;
  getFailed: () => Promise<BullJob[]>;
  getDelayed: () => Promise<BullJob[]>;
  getPaused: () => Promise<BullJob[]>;
  on: (event: string, callback: Function) => void;
  off: (event: string, callback: Function) => void;
  getJobCounts: () => Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  }>;
}

@Injectable()
export class BullAdapterService implements OnModuleInit {
  private readonly logger = new Logger(BullAdapterService.name);
  private registeredQueues = new Map<string, BullQueue>();
  private eventListeners = new Map<string, Map<string, Function>>();

  constructor(
    private readonly jobWatcherService: JobWatcherService,
    private readonly moduleRef: ModuleRef
  ) {}

  async onModuleInit(): Promise<void> {
    // Auto-discover Bull queues in the application
    await this.discoverQueues();
  }

  private async discoverQueues(): Promise<void> {
    try {
      // Try to find Bull queues using NestJS module system
      const bullQueues = await this.findBullQueues();
      
      for (const queue of bullQueues) {
        this.registerQueue(queue);
      }

      this.logger.log(`Discovered and registered ${bullQueues.length} Bull queues`);
    } catch (error) {
      this.logger.warn('Failed to auto-discover Bull queues:', error.message);
    }
  }

  private async findBullQueues(): Promise<BullQueue[]> {
    const queues: BullQueue[] = [];

    try {
      // Try to find queues using different Bull packages
      const bullQueues = await this.findQueuesFromBull();
      queues.push(...bullQueues);

      const bullmqQueues = await this.findQueuesFromBullMQ();
      queues.push(...bullmqQueues);

    } catch (error) {
      this.logger.debug('No Bull queues found via auto-discovery');
    }

    return queues;
  }

  private async findQueuesFromBull(): Promise<BullQueue[]> {
    const queues: BullQueue[] = [];

    try {
      // Try to get Bull queues from the module
      const bullModule = await this.moduleRef.get('BullModule', { strict: false });
      if (bullModule && bullModule.queues) {
        for (const [name, queue] of Object.entries(bullModule.queues)) {
          queues.push(queue as BullQueue);
        }
      }
    } catch (error) {
      // Bull module not found
    }

    return queues;
  }

  private async findQueuesFromBullMQ(): Promise<BullQueue[]> {
    const queues: BullQueue[] = [];

    try {
      // Try to get BullMQ queues from the module
      const bullMQModule = await this.moduleRef.get('BullMQModule', { strict: false });
      if (bullMQModule && bullMQModule.queues) {
        for (const [name, queue] of Object.entries(bullMQModule.queues)) {
          queues.push(queue as BullQueue);
        }
      }
    } catch (error) {
      // BullMQ module not found
    }

    return queues;
  }

  registerQueue(queue: BullQueue): void {
    if (!queue || !queue.name) {
      this.logger.warn('Invalid queue provided for registration');
      return;
    }

    if (this.registeredQueues.has(queue.name)) {
      this.logger.warn(`Queue ${queue.name} is already registered`);
      return;
    }

    this.registeredQueues.set(queue.name, queue);
    this.setupQueueEventListeners(queue);
    
    this.logger.log(`Registered Bull queue: ${queue.name}`);
  }

  private setupQueueEventListeners(queue: BullQueue): void {
    const listeners = new Map<string, Function>();

    // Job events
    const onJobActive = (job: BullJob) => this.handleJobActive(job, queue);
    const onJobCompleted = (job: BullJob, result: any) => this.handleJobCompleted(job, result, queue);
    const onJobFailed = (job: BullJob, error: Error) => this.handleJobFailed(job, error, queue);
    const onJobProgress = (job: BullJob, progress: number) => this.handleJobProgress(job, progress, queue);
    const onJobStalled = (job: BullJob) => this.handleJobStalled(job, queue);
    const onJobWaiting = (job: BullJob) => this.handleJobWaiting(job, queue);
    const onJobDelayed = (job: BullJob) => this.handleJobDelayed(job, queue);
    const onJobPaused = (job: BullJob) => this.handleJobPaused(job, queue);

    // Register event listeners
    queue.on('active', onJobActive);
    queue.on('completed', onJobCompleted);
    queue.on('failed', onJobFailed);
    queue.on('progress', onJobProgress);
    queue.on('stalled', onJobStalled);
    queue.on('waiting', onJobWaiting);
    queue.on('delayed', onJobDelayed);
    queue.on('paused', onJobPaused);

    // Store listeners for cleanup
    listeners.set('active', onJobActive);
    listeners.set('completed', onJobCompleted);
    listeners.set('failed', onJobFailed);
    listeners.set('progress', onJobProgress);
    listeners.set('stalled', onJobStalled);
    listeners.set('waiting', onJobWaiting);
    listeners.set('delayed', onJobDelayed);
    listeners.set('paused', onJobPaused);

    this.eventListeners.set(queue.name, listeners);
  }

  private handleJobActive(job: BullJob, queue: BullQueue): void {
    const context = this.createJobContext(job, queue, JobStatus.ACTIVE);
    context.startTime = new Date();
    this.jobWatcherService.trackJob(context);
  }

  private handleJobCompleted(job: BullJob, result: any, queue: BullQueue): void {
    const context = this.createJobContext(job, queue, JobStatus.COMPLETED);
    context.result = result;
    context.endTime = new Date();
    
    if (job.processedOn && job.timestamp) {
      context.duration = job.finishedOn - job.processedOn;
      context.performance = {
        ...context.performance,
        queueWaitTime: job.processedOn - job.timestamp,
        executionTime: context.duration,
      };
    }

    this.jobWatcherService.trackJob(context);
  }

  private handleJobFailed(job: BullJob, error: Error, queue: BullQueue): void {
    const context = this.createJobContext(job, queue, JobStatus.FAILED);
    context.error = {
      message: error.message,
      stack: error.stack,
      name: error.name,
      failedReason: job.failedReason,
    };
    context.endTime = new Date();
    
    if (job.processedOn && job.timestamp) {
      context.duration = job.finishedOn - job.processedOn;
      context.performance = {
        ...context.performance,
        queueWaitTime: job.processedOn - job.timestamp,
        executionTime: context.duration,
      };
    }

    this.jobWatcherService.trackJob(context);
  }

  private handleJobProgress(job: BullJob, progress: number, queue: BullQueue): void {
    const context = this.createJobContext(job, queue, JobStatus.ACTIVE);
    context.progress = progress;
    this.jobWatcherService.trackJob(context);
  }

  private handleJobStalled(job: BullJob, queue: BullQueue): void {
    const context = this.createJobContext(job, queue, JobStatus.STALLED);
    this.jobWatcherService.trackJob(context);
  }

  private handleJobWaiting(job: BullJob, queue: BullQueue): void {
    const context = this.createJobContext(job, queue, JobStatus.WAITING);
    this.jobWatcherService.trackJob(context);
  }

  private handleJobDelayed(job: BullJob, queue: BullQueue): void {
    const context = this.createJobContext(job, queue, JobStatus.DELAYED);
    context.delay = job.delay;
    this.jobWatcherService.trackJob(context);
  }

  private handleJobPaused(job: BullJob, queue: BullQueue): void {
    const context = this.createJobContext(job, queue, JobStatus.PAUSED);
    this.jobWatcherService.trackJob(context);
  }

  private createJobContext(job: BullJob, queue: BullQueue, status: JobStatus): JobContext {
    return {
      id: `${queue.name}_${job.id}_${Date.now()}`,
      jobId: String(job.id),
      queueName: queue.name,
      jobName: job.name,
      timestamp: new Date(),
      status,
      priority: job.opts?.priority || 0,
      data: job.data,
      options: job.opts,
      attempts: job.attemptsMade,
      maxAttempts: job.opts?.attempts || 3,
      delay: job.delay,
      progress: job.progress,
      performance: {
        memoryUsage: process.memoryUsage().heapUsed,
        cpuUsage: process.cpuUsage().user + process.cpuUsage().system,
      },
      // Extract correlation IDs from job data if available
      traceId: job.data?.traceId || job.opts?.traceId,
      requestId: job.data?.requestId || job.opts?.requestId,
      userId: job.data?.userId || job.opts?.userId,
      sessionId: job.data?.sessionId || job.opts?.sessionId,
    };
  }

  async updateQueueStats(): Promise<void> {
    for (const [name, queue] of this.registeredQueues) {
      try {
        const stats = await queue.getJobCounts();
        
        // Create a context for queue stats
        const context: JobContext = {
          id: `queue_stats_${name}_${Date.now()}`,
          jobId: 'queue_stats',
          queueName: name,
          jobName: 'queue_stats',
          timestamp: new Date(),
          status: JobStatus.ACTIVE,
          priority: 0,
          attempts: 0,
          maxAttempts: 0,
          queueStats: stats,
        };

        this.jobWatcherService.trackJob(context);
      } catch (error) {
        this.logger.warn(`Failed to get stats for queue ${name}:`, error.message);
      }
    }
  }

  unregisterQueue(queueName: string): void {
    const queue = this.registeredQueues.get(queueName);
    if (!queue) {
      this.logger.warn(`Queue ${queueName} is not registered`);
      return;
    }

    // Remove event listeners
    const listeners = this.eventListeners.get(queueName);
    if (listeners) {
      for (const [event, listener] of listeners) {
        queue.off(event, listener);
      }
      this.eventListeners.delete(queueName);
    }

    this.registeredQueues.delete(queueName);
    this.logger.log(`Unregistered Bull queue: ${queueName}`);
  }

  getRegisteredQueues(): string[] {
    return Array.from(this.registeredQueues.keys());
  }

  isQueueRegistered(queueName: string): boolean {
    return this.registeredQueues.has(queueName);
  }

  async getQueueMetrics(queueName: string): Promise<any> {
    const queue = this.registeredQueues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} is not registered`);
    }

    try {
      const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
        queue.waiting ? queue.waiting() : queue.getWaiting(),
        queue.active ? queue.active() : queue.getActive(),
        queue.completed ? queue.completed() : queue.getCompleted(),
        queue.failed ? queue.failed() : queue.getFailed(),
        queue.delayed ? queue.delayed() : queue.getDelayed(),
        queue.paused ? queue.paused() : queue.getPaused(),
      ]);

      return {
        queueName,
        counts: {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
          paused: paused.length,
        },
        jobs: {
          waiting: waiting.map(job => this.serializeJob(job)),
          active: active.map(job => this.serializeJob(job)),
          completed: completed.slice(-10).map(job => this.serializeJob(job)), // Last 10
          failed: failed.slice(-10).map(job => this.serializeJob(job)), // Last 10
          delayed: delayed.map(job => this.serializeJob(job)),
          paused: paused.map(job => this.serializeJob(job)),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get metrics for queue ${queueName}:`, error);
      throw error;
    }
  }

  private serializeJob(job: BullJob): any {
    return {
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      delay: job.delay,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  }

  onDestroy(): void {
    // Clean up all event listeners
    for (const [queueName, listeners] of this.eventListeners) {
      const queue = this.registeredQueues.get(queueName);
      if (queue) {
        for (const [event, listener] of listeners) {
          queue.off(event, listener);
        }
      }
    }

    this.eventListeners.clear();
    this.registeredQueues.clear();
  }
}
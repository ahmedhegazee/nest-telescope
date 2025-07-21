import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, interval } from 'rxjs';
import { map, scan, share, startWith } from 'rxjs/operators';

export interface BatchResult {
  processed: number;
  failed: number;
  duration: number;
  success: boolean;
  error?: string;
  timestamp: Date;
}

export interface StreamMetrics {
  entriesInQueue: number;
  errorCount: number;
  averageProcessingTime: number;
  throughput: number;
  isProcessing: boolean;
  subscriptions: number;
  lastProcessedAt?: Date;
}

export interface BatchPerformanceMetrics {
  totalEntries: number;
  totalBatches: number;
  successfulBatches: number;
  failedBatches: number;
  averageProcessingTime: number;
  throughput: number;
  errorRate: number;
  uptime: number;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly batchResults = new Subject<BatchResult>();
  private readonly startTime = Date.now();
  
  private metrics: BatchPerformanceMetrics = {
    totalEntries: 0,
    totalBatches: 0,
    successfulBatches: 0,
    failedBatches: 0,
    averageProcessingTime: 0,
    throughput: 0,
    errorRate: 0,
    uptime: 0
  };

  private processingTimes: number[] = [];
  private readonly maxProcessingTimesSamples = 1000;
  private errorCount = 0;

  constructor() {
    this.setupMetricsStream();
  }

  private setupMetricsStream(): void {
    // Process batch results and update metrics
    this.batchResults
      .pipe(
        scan((acc, result) => this.updateMetrics(acc, result), this.metrics),
        share()
      )
      .subscribe(metrics => {
        this.metrics = metrics;
        this.logger.debug('Metrics updated:', metrics);
      });

    // Update uptime every second
    interval(1000).pipe(
      map(() => Date.now() - this.startTime)
    ).subscribe(uptime => {
      this.metrics.uptime = uptime;
    });
  }

  recordBatchProcessing(result: BatchResult): void {
    this.batchResults.next(result);
    
    // Track processing times for average calculation
    this.processingTimes.push(result.duration);
    if (this.processingTimes.length > this.maxProcessingTimesSamples) {
      this.processingTimes.shift();
    }

    // Track errors separately
    if (!result.success) {
      this.errorCount++;
    }
  }

  private updateMetrics(current: BatchPerformanceMetrics, result: BatchResult): BatchPerformanceMetrics {
    const totalBatches = current.totalBatches + 1;
    const successfulBatches = current.successfulBatches + (result.success ? 1 : 0);
    const failedBatches = current.failedBatches + (result.success ? 0 : 1);
    const totalEntries = current.totalEntries + result.processed;
    
    // Calculate average processing time
    const averageProcessingTime = this.processingTimes.length > 0
      ? this.processingTimes.reduce((sum, time) => sum + time, 0) / this.processingTimes.length
      : 0;

    // Calculate throughput (entries per second)
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    const throughput = elapsedSeconds > 0 ? totalEntries / elapsedSeconds : 0;

    // Calculate error rate
    const errorRate = totalBatches > 0 ? (failedBatches / totalBatches) * 100 : 0;

    return {
      totalEntries,
      totalBatches,
      successfulBatches,
      failedBatches,
      averageProcessingTime,
      throughput,
      errorRate,
      uptime: current.uptime
    };
  }

  getMetrics(): BatchPerformanceMetrics {
    return { ...this.metrics };
  }

  getStreamMetrics(): StreamMetrics {
    return {
      entriesInQueue: 0, // Will be updated by stream processor
      errorCount: this.errorCount,
      averageProcessingTime: this.metrics.averageProcessingTime,
      throughput: this.metrics.throughput,
      isProcessing: true,
      subscriptions: 0,
      lastProcessedAt: this.processingTimes.length > 0 ? new Date() : undefined
    };
  }

  getErrorCount(): number {
    return this.errorCount;
  }

  getAverageProcessingTime(): number {
    return this.metrics.averageProcessingTime;
  }

  getThroughput(): number {
    return this.metrics.throughput;
  }

  getUptime(): number {
    return this.metrics.uptime;
  }

  // Observable for real-time metrics updates
  getMetricsStream(): Observable<BatchPerformanceMetrics> {
    return this.batchResults.pipe(
      scan((acc, result) => this.updateMetrics(acc, result), this.metrics),
      startWith(this.metrics)
    );
  }

  // Reset metrics (useful for testing)
  reset(): void {
    this.metrics = {
      totalEntries: 0,
      totalBatches: 0,
      successfulBatches: 0,
      failedBatches: 0,
      averageProcessingTime: 0,
      throughput: 0,
      errorRate: 0,
      uptime: 0
    };
    this.processingTimes = [];
    this.errorCount = 0;
  }

  // Get detailed performance report
  getPerformanceReport(): {
    metrics: BatchPerformanceMetrics;
    samples: {
      processingTimes: number[];
      recentBatches: number;
    };
    status: {
      isHealthy: boolean;
      alerts: string[];
    };
  } {
    const alerts: string[] = [];
    
    // Check for performance issues
    if (this.metrics.errorRate > 5) {
      alerts.push(`High error rate: ${this.metrics.errorRate.toFixed(2)}%`);
    }
    
    if (this.metrics.averageProcessingTime > 5000) {
      alerts.push(`High average processing time: ${this.metrics.averageProcessingTime.toFixed(2)}ms`);
    }
    
    if (this.metrics.throughput < 10) {
      alerts.push(`Low throughput: ${this.metrics.throughput.toFixed(2)} entries/second`);
    }

    return {
      metrics: this.getMetrics(),
      samples: {
        processingTimes: [...this.processingTimes],
        recentBatches: this.processingTimes.length
      },
      status: {
        isHealthy: alerts.length === 0,
        alerts
      }
    };
  }
}
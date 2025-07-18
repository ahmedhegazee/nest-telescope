import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { TelescopeService } from '../../core/services/telescope.service';
import { TelescopeEntry } from '../../core/interfaces/telescope-entry.interface';
import { ExceptionContext, ErrorSeverity, ErrorCategory } from './exception-watcher.filter';
import { ExceptionWatcherConfig, defaultExceptionWatcherConfig } from './exception-watcher.config';
import { Observable, Subject, interval } from 'rxjs';
import { map, scan, shareReplay, takeUntil } from 'rxjs/operators';

export interface ExceptionMetrics {
  totalExceptions: number;
  uniqueExceptions: number;
  errorRate: number;
  criticalErrors: number;
  highSeverityErrors: number;
  mediumSeverityErrors: number;
  lowSeverityErrors: number;
  
  // Time-based metrics
  exceptionsPerMinute: number;
  exceptionsPerHour: number;
  
  // Classification metrics
  errorsByType: Record<string, number>;
  errorsByCategory: Record<string, number>;
  errorsBySeverity: Record<string, number>;
  
  // Top errors
  topErrors: Array<{
    groupId: string;
    errorType: string;
    errorMessage: string;
    count: number;
    lastOccurrence: Date;
    severity: ErrorSeverity;
    category: ErrorCategory;
  }>;
  
  // Performance impact
  averageResponseTime: number;
  affectedRequests: number;
  
  // Trend analysis
  trends: {
    lastHour: ExceptionTrendData;
    lastDay: ExceptionTrendData;
    lastWeek: ExceptionTrendData;
  };
}

export interface ExceptionTrendData {
  total: number;
  change: number;
  changePercent: number;
  peak: number;
  average: number;
}

export interface ExceptionGroup {
  groupId: string;
  fingerprint: string;
  errorType: string;
  errorMessage: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  count: number;
  firstOccurrence: Date;
  lastOccurrence: Date;
  affectedUsers: Set<string>;
  affectedRequests: string[];
  stackFrames: Array<{
    function: string;
    file: string;
    line: number;
    count: number;
  }>;
  contexts: ExceptionContext[];
  resolved: boolean;
  assignedTo?: string;
  notes?: string;
}

export interface ExceptionAlert {
  id: string;
  type: 'error_rate' | 'critical_errors' | 'new_error' | 'error_spike';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  data: any;
  acknowledged: boolean;
  resolvedAt?: Date;
}

@Injectable()
export class ExceptionWatcherService implements OnModuleInit {
  private readonly logger = new Logger(ExceptionWatcherService.name);
  private readonly config: ExceptionWatcherConfig;
  private readonly destroy$ = new Subject<void>();
  private readonly alertsSubject = new Subject<ExceptionAlert>();
  private readonly metricsSubject = new Subject<ExceptionMetrics>();
  
  private exceptionHistory: ExceptionContext[] = [];
  private exceptionGroups = new Map<string, ExceptionGroup>();
  private currentMetrics: ExceptionMetrics;
  private readonly maxHistorySize = 10000;
  private readonly maxGroupSize = 1000;
  
  // Real-time tracking
  private recentExceptions: ExceptionContext[] = [];
  private alertHistory: ExceptionAlert[] = [];
  
  constructor(
    private readonly telescopeService: TelescopeService,
    @Inject('EXCEPTION_WATCHER_CONFIG') exceptionWatcherConfig: ExceptionWatcherConfig
  ) {
    this.config = { ...defaultExceptionWatcherConfig, ...exceptionWatcherConfig };
    this.currentMetrics = this.initializeMetrics();
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Setup global exception handlers
    if (this.config.captureUnhandledRejections) {
      process.on('unhandledRejection', (reason, promise) => {
        this.handleUnhandledRejection(reason, promise);
      });
    }

    if (this.config.captureUncaughtExceptions) {
      process.on('uncaughtException', (error) => {
        this.handleUncaughtException(error);
      });
    }

    // Start periodic processing
    this.startPeriodicProcessing();
    
    this.logger.log('Exception watcher initialized');
  }

  private initializeMetrics(): ExceptionMetrics {
    return {
      totalExceptions: 0,
      uniqueExceptions: 0,
      errorRate: 0,
      criticalErrors: 0,
      highSeverityErrors: 0,
      mediumSeverityErrors: 0,
      lowSeverityErrors: 0,
      exceptionsPerMinute: 0,
      exceptionsPerHour: 0,
      errorsByType: {},
      errorsByCategory: {},
      errorsBySeverity: {},
      topErrors: [],
      averageResponseTime: 0,
      affectedRequests: 0,
      trends: {
        lastHour: { total: 0, change: 0, changePercent: 0, peak: 0, average: 0 },
        lastDay: { total: 0, change: 0, changePercent: 0, peak: 0, average: 0 },
        lastWeek: { total: 0, change: 0, changePercent: 0, peak: 0, average: 0 }
      }
    };
  }

  trackException(context: ExceptionContext): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Add to history
      this.addToHistory(context);
      
      // Group similar exceptions
      this.groupException(context);
      
      // Update metrics
      this.updateMetrics(context);
      
      // Create telescope entry
      const entry = this.createTelescopeEntry(context);
      this.telescopeService.record(entry);
      
      // Check for alerts
      this.checkAlerts(context);
      
      // Correlate with other systems
      this.correlateException(context);
      
      this.logger.debug(`Exception tracked: ${context.id}`);
      
    } catch (error) {
      this.logger.error('Failed to track exception:', error);
    }
  }

  private addToHistory(context: ExceptionContext): void {
    this.exceptionHistory.push(context);
    if (this.exceptionHistory.length > this.maxHistorySize) {
      this.exceptionHistory.shift();
    }

    // Add to recent exceptions for real-time processing
    this.recentExceptions.push(context);
    
    // Keep only last 10 minutes of recent exceptions
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    this.recentExceptions = this.recentExceptions.filter(
      exc => exc.timestamp.getTime() > tenMinutesAgo
    );
  }

  private groupException(context: ExceptionContext): void {
    if (!this.config.groupSimilarErrors || !context.classification) {
      return;
    }

    const groupId = context.classification.groupId;
    let group = this.exceptionGroups.get(groupId);

    if (!group) {
      group = {
        groupId,
        fingerprint: context.classification.fingerprint,
        errorType: context.errorType,
        errorMessage: context.errorMessage,
        severity: context.classification.severity,
        category: context.classification.category,
        count: 0,
        firstOccurrence: context.timestamp,
        lastOccurrence: context.timestamp,
        affectedUsers: new Set(),
        affectedRequests: [],
        stackFrames: [],
        contexts: [],
        resolved: false
      };
      this.exceptionGroups.set(groupId, group);
    }

    // Update group
    group.count++;
    group.lastOccurrence = context.timestamp;
    
    if (context.userId) {
      group.affectedUsers.add(context.userId);
    }
    
    if (context.requestId) {
      group.affectedRequests.push(context.requestId);
    }

    // Add stack frame information
    if (context.stackFrames) {
      for (const frame of context.stackFrames) {
        if (frame.function && frame.file && frame.line) {
          const existingFrame = group.stackFrames.find(
            f => f.function === frame.function && f.file === frame.file && f.line === frame.line
          );
          
          if (existingFrame) {
            existingFrame.count++;
          } else {
            group.stackFrames.push({
              function: frame.function,
              file: frame.file,
              line: frame.line,
              count: 1
            });
          }
        }
      }
    }

    // Limit context history per group
    group.contexts.push(context);
    if (group.contexts.length > this.maxGroupSize) {
      group.contexts.shift();
    }
  }

  private updateMetrics(context: ExceptionContext): void {
    this.currentMetrics.totalExceptions++;
    this.currentMetrics.uniqueExceptions = this.exceptionGroups.size;

    // Update severity counters
    if (context.classification) {
      switch (context.classification.severity) {
        case ErrorSeverity.CRITICAL:
          this.currentMetrics.criticalErrors++;
          break;
        case ErrorSeverity.HIGH:
          this.currentMetrics.highSeverityErrors++;
          break;
        case ErrorSeverity.MEDIUM:
          this.currentMetrics.mediumSeverityErrors++;
          break;
        case ErrorSeverity.LOW:
          this.currentMetrics.lowSeverityErrors++;
          break;
      }

      // Update type and category counters
      this.currentMetrics.errorsByType[context.errorType] = 
        (this.currentMetrics.errorsByType[context.errorType] || 0) + 1;
      
      this.currentMetrics.errorsByCategory[context.classification.category] = 
        (this.currentMetrics.errorsByCategory[context.classification.category] || 0) + 1;
      
      this.currentMetrics.errorsBySeverity[context.classification.severity] = 
        (this.currentMetrics.errorsBySeverity[context.classification.severity] || 0) + 1;
    }

    // Update performance metrics
    if (context.response?.duration) {
      const totalTime = this.currentMetrics.averageResponseTime * this.currentMetrics.affectedRequests;
      this.currentMetrics.affectedRequests++;
      this.currentMetrics.averageResponseTime = 
        (totalTime + context.response.duration) / this.currentMetrics.affectedRequests;
    }

    // Update top errors
    this.updateTopErrors();
    
    // Update rates
    this.updateRates();
  }

  private updateTopErrors(): void {
    const topGroups = Array.from(this.exceptionGroups.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    this.currentMetrics.topErrors = topGroups.map(group => ({
      groupId: group.groupId,
      errorType: group.errorType,
      errorMessage: group.errorMessage,
      count: group.count,
      lastOccurrence: group.lastOccurrence,
      severity: group.severity,
      category: group.category
    }));
  }

  private updateRates(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    const exceptionsLastMinute = this.exceptionHistory.filter(
      exc => exc.timestamp.getTime() > oneMinuteAgo
    ).length;

    const exceptionsLastHour = this.exceptionHistory.filter(
      exc => exc.timestamp.getTime() > oneHourAgo
    ).length;

    this.currentMetrics.exceptionsPerMinute = exceptionsLastMinute;
    this.currentMetrics.exceptionsPerHour = exceptionsLastHour;

    // Calculate error rate (exceptions per total requests)
    // This would need integration with request watcher
    this.currentMetrics.errorRate = this.calculateErrorRate();
  }

  private calculateErrorRate(): number {
    // Placeholder - would integrate with request watcher
    const totalRequests = this.currentMetrics.affectedRequests || 1;
    return (this.currentMetrics.totalExceptions / totalRequests) * 100;
  }

  private createTelescopeEntry(context: ExceptionContext): TelescopeEntry {
    const entryId = `exception_${context.id}`;
    const familyHash = context.classification?.groupId || context.id;
    
    return {
      id: entryId,
      type: 'exception',
      familyHash,
      content: {
        exception: {
          id: context.id,
          type: context.errorType,
          message: context.errorMessage,
          code: context.errorCode,
          statusCode: context.statusCode,
          severity: context.classification?.severity,
          category: context.classification?.category,
          fingerprint: context.classification?.fingerprint,
          groupId: context.classification?.groupId
        },
        stackTrace: {
          raw: context.stackTrace,
          frames: context.stackFrames
        },
        request: context.request,
        response: context.response,
        environment: context.environment,
        performance: context.performance,
        correlation: {
          traceId: context.traceId,
          requestId: context.requestId,
          userId: context.userId,
          sessionId: context.sessionId
        }
      },
      tags: this.generateTags(context),
      timestamp: context.timestamp,
      sequence: context.timestamp.getTime()
    };
  }

  private generateTags(context: ExceptionContext): string[] {
    const tags: string[] = ['exception', `type:${context.errorType}`];
    
    if (context.classification) {
      tags.push(`severity:${context.classification.severity}`);
      tags.push(`category:${context.classification.category}`);
    }
    
    if (context.statusCode) {
      tags.push(`status:${context.statusCode}`);
    }
    
    if (context.userId) {
      tags.push('user-error');
    }
    
    if (context.request?.method) {
      tags.push(`method:${context.request.method}`);
    }
    
    return tags;
  }

  private checkAlerts(context: ExceptionContext): void {
    if (!this.config.enableRealTimeAlerts) {
      return;
    }

    const now = Date.now();
    const timeWindow = this.config.alertThresholds.timeWindow;
    const windowStart = now - timeWindow;

    // Check error rate threshold
    const recentExceptions = this.recentExceptions.filter(
      exc => exc.timestamp.getTime() > windowStart
    );
    
    const errorRate = recentExceptions.length / (timeWindow / 1000);
    if (errorRate > this.config.alertThresholds.errorRate) {
      this.createAlert({
        type: 'error_rate',
        severity: 'high',
        message: `Error rate exceeded threshold: ${errorRate.toFixed(2)} errors/second`,
        data: { errorRate, threshold: this.config.alertThresholds.errorRate }
      });
    }

    // Check critical errors threshold
    const criticalErrors = recentExceptions.filter(
      exc => exc.classification?.severity === ErrorSeverity.CRITICAL
    );
    
    if (criticalErrors.length >= this.config.alertThresholds.criticalErrors) {
      this.createAlert({
        type: 'critical_errors',
        severity: 'critical',
        message: `Critical errors exceeded threshold: ${criticalErrors.length} critical errors`,
        data: { criticalErrors: criticalErrors.length, threshold: this.config.alertThresholds.criticalErrors }
      });
    }

    // Check for new error types
    if (context.classification && !this.hasSeenErrorBefore(context)) {
      this.createAlert({
        type: 'new_error',
        severity: 'medium',
        message: `New error type detected: ${context.errorType}`,
        data: { errorType: context.errorType, message: context.errorMessage }
      });
    }
  }

  private hasSeenErrorBefore(context: ExceptionContext): boolean {
    const groupId = context.classification?.groupId;
    if (!groupId) return false;
    
    const group = this.exceptionGroups.get(groupId);
    return group ? group.count > 1 : false;
  }

  private createAlert(alert: Omit<ExceptionAlert, 'id' | 'timestamp' | 'acknowledged'>): void {
    const fullAlert: ExceptionAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      acknowledged: false,
      ...alert
    };

    this.alertHistory.push(fullAlert);
    this.alertsSubject.next(fullAlert);
    
    this.logger.warn(`Exception alert: ${fullAlert.message}`, fullAlert.data);
  }

  private correlateException(context: ExceptionContext): void {
    if (!this.config.correlateWithRequests && !this.config.correlateWithQueries) {
      return;
    }

    // Correlate with requests using traceId or requestId
    if (this.config.correlateWithRequests && (context.traceId || context.requestId)) {
      const correlationId = context.traceId || context.requestId;
      if (correlationId) {
        // Store correlation mapping for dashboard display
        this.storeCorrelation('request', correlationId, context);
      }
    }

    // Correlate with queries if they share the same traceId
    if (this.config.correlateWithQueries && context.traceId) {
      this.storeCorrelation('query', context.traceId, context);
    }

    // Correlate with user sessions
    if (context.sessionId) {
      this.storeCorrelation('session', context.sessionId, context);
    }
  }

  private storeCorrelation(type: string, correlationId: string, context: ExceptionContext): void {
    // This would integrate with other watcher services
    // For now, we'll store basic correlation data
    const correlationKey = `${type}:${correlationId}`;
    
    // Add correlation metadata to the context
    if (!context.performance) {
      context.performance = {};
    }
    
    context.performance[`${type}CorrelationId`] = correlationId;
    
    this.logger.debug(`Correlated exception ${context.id} with ${type} ${correlationId}`);
  }

  private handleUnhandledRejection(reason: any, promise: Promise<any>): void {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    const context: ExceptionContext = {
      id: `unhandled_rejection_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      error,
      errorType: 'UnhandledPromiseRejection',
      errorMessage: error.message,
      stackTrace: error.stack,
      classification: {
        type: 'system' as any,
        category: 'system_error' as any,
        severity: ErrorSeverity.HIGH,
        fingerprint: this.generateFingerprint(error),
        groupId: this.generateGroupId(error)
      }
    };

    this.trackException(context);
  }

  private handleUncaughtException(error: Error): void {
    const context: ExceptionContext = {
      id: `uncaught_exception_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      error,
      errorType: 'UncaughtException',
      errorMessage: error.message,
      stackTrace: error.stack,
      classification: {
        type: 'system' as any,
        category: 'system_error' as any,
        severity: ErrorSeverity.CRITICAL,
        fingerprint: this.generateFingerprint(error),
        groupId: this.generateGroupId(error)
      }
    };

    this.trackException(context);
  }

  private generateFingerprint(error: Error): string {
    const components = [
      error.constructor.name,
      error.message?.substring(0, 100),
      error.stack?.split('\n')[1] // First stack frame
    ].filter(Boolean);

    return this.hash(components.join(':'));
  }

  private generateGroupId(error: Error): string {
    const components = [
      error.constructor.name,
      error.message?.replace(/\d+/g, 'N').substring(0, 50)
    ].filter(Boolean);

    return this.hash(components.join(':'));
  }

  private hash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private startPeriodicProcessing(): void {
    // Update metrics every 30 seconds
    interval(30000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.updateTrends();
        this.cleanupOldData();
        this.metricsSubject.next(this.currentMetrics);
      });
  }

  private updateTrends(): void {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Calculate trends
    this.currentMetrics.trends.lastHour = this.calculateTrend(oneHourAgo);
    this.currentMetrics.trends.lastDay = this.calculateTrend(oneDayAgo);
    this.currentMetrics.trends.lastWeek = this.calculateTrend(oneWeekAgo);
  }

  private calculateTrend(since: number): ExceptionTrendData {
    const exceptions = this.exceptionHistory.filter(
      exc => exc.timestamp.getTime() > since
    );

    return {
      total: exceptions.length,
      change: 0, // Would need historical data
      changePercent: 0,
      peak: 0, // Would need time series data
      average: exceptions.length / ((Date.now() - since) / (60 * 60 * 1000))
    };
  }

  private cleanupOldData(): void {
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Remove old exceptions
    this.exceptionHistory = this.exceptionHistory.filter(
      exc => exc.timestamp.getTime() > oneWeekAgo
    );

    // Remove old alerts
    this.alertHistory = this.alertHistory.filter(
      alert => alert.timestamp.getTime() > oneWeekAgo
    );
  }

  // Public API
  getMetrics(): ExceptionMetrics {
    return { ...this.currentMetrics };
  }

  getMetricsStream(): Observable<ExceptionMetrics> {
    return this.metricsSubject.asObservable().pipe(shareReplay(1));
  }

  getAlertsStream(): Observable<ExceptionAlert> {
    return this.alertsSubject.asObservable();
  }

  getExceptionGroups(): ExceptionGroup[] {
    return Array.from(this.exceptionGroups.values());
  }

  getExceptionGroup(groupId: string): ExceptionGroup | undefined {
    return this.exceptionGroups.get(groupId);
  }

  getRecentExceptions(limit: number = 100): ExceptionContext[] {
    return this.exceptionHistory.slice(-limit).reverse();
  }

  resolveExceptionGroup(groupId: string, resolvedBy: string, notes?: string): boolean {
    const group = this.exceptionGroups.get(groupId);
    if (!group) return false;

    group.resolved = true;
    group.assignedTo = resolvedBy;
    group.notes = notes;
    
    return true;
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alertHistory.find(a => a.id === alertId);
    if (!alert) return false;

    alert.acknowledged = true;
    return true;
  }

  getConfig(): ExceptionWatcherConfig {
    return { ...this.config };
  }

  onDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
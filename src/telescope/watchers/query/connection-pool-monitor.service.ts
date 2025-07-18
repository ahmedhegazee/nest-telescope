import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Observable, Subject, interval, BehaviorSubject } from 'rxjs';
import { map, shareReplay, takeUntil } from 'rxjs/operators';

export interface ConnectionPoolMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingConnections: number;
  acquiredConnections: number;
  releasedConnections: number;
  createdConnections: number;
  destroyedConnections: number;
  poolSize: number;
  maxConnections: number;
  minConnections: number;
  connectionTimeouts: number;
  connectionErrors: number;
  averageAcquireTime: number;
  averageConnectionLifetime: number;
  healthScore: number;
  lastUpdate: Date;
}

export interface ConnectionEvent {
  type: 'acquire' | 'release' | 'create' | 'destroy' | 'timeout' | 'error';
  timestamp: Date;
  connectionId?: string;
  duration?: number;
  error?: string;
  poolState: {
    active: number;
    idle: number;
    waiting: number;
  };
}

export interface ConnectionPoolAlert {
  type: 'high_usage' | 'connection_timeout' | 'connection_error' | 'pool_exhausted' | 'connection_leak';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  metrics: Partial<ConnectionPoolMetrics>;
  recommendation: string;
}

@Injectable()
export class ConnectionPoolMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectionPoolMonitorService.name);
  private readonly destroy$ = new Subject<void>();
  private readonly metricsSubject = new BehaviorSubject<ConnectionPoolMetrics>(this.initializeMetrics());
  private readonly eventsSubject = new Subject<ConnectionEvent>();
  private readonly alertsSubject = new Subject<ConnectionPoolAlert>();
  
  private connectionEvents: ConnectionEvent[] = [];
  private readonly maxEventHistory = 1000;
  private readonly monitoringInterval = 5000; // 5 seconds
  private acquireTimestamps = new Map<string, number>();
  private connectionCreationTimes = new Map<string, number>();
  
  private currentMetrics: ConnectionPoolMetrics;
  private alertThresholds = {
    highUsageThreshold: 80,      // 80% of pool size
    connectionTimeoutThreshold: 30000,  // 30 seconds
    connectionLeakThreshold: 300000,    // 5 minutes
    errorRateThreshold: 0.1     // 10% error rate
  };

  constructor(private readonly dataSource: DataSource) {
    this.currentMetrics = this.initializeMetrics();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.setupMonitoring();
      this.startPeriodicMonitoring();
      this.logger.log('Connection pool monitoring started');
    } catch (error) {
      this.logger.error('Failed to initialize connection pool monitoring:', error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.destroy$.next();
    this.destroy$.complete();
    this.logger.log('Connection pool monitoring stopped');
  }

  private initializeMetrics(): ConnectionPoolMetrics {
    return {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingConnections: 0,
      acquiredConnections: 0,
      releasedConnections: 0,
      createdConnections: 0,
      destroyedConnections: 0,
      poolSize: 0,
      maxConnections: 0,
      minConnections: 0,
      connectionTimeouts: 0,
      connectionErrors: 0,
      averageAcquireTime: 0,
      averageConnectionLifetime: 0,
      healthScore: 100,
      lastUpdate: new Date()
    };
  }

  private async setupMonitoring(): Promise<void> {
    const driver = this.dataSource.driver;
    const pool = (driver as any).pool;

    if (!pool) {
      this.logger.warn('Database pool not found, connection monitoring will be limited');
      return;
    }

    // Hook into pool events if available
    this.setupPoolEventListeners(pool);
    
    // Get initial pool configuration
    this.updatePoolConfiguration(pool);
  }

  private setupPoolEventListeners(pool: any): void {
    try {
      // Different database drivers have different event systems
      const driverType = this.dataSource.options.type;
      
      if (driverType === 'postgres') {
        this.setupPostgresPoolListeners(pool);
      } else if (driverType === 'mysql') {
        this.setupMySQLPoolListeners(pool);
      } else {
        this.logger.debug(`Connection pool monitoring not fully supported for ${driverType}`);
      }
    } catch (error) {
      this.logger.debug('Could not setup pool event listeners:', error.message);
    }
  }

  private setupPostgresPoolListeners(pool: any): void {
    if (pool.on) {
      pool.on('connect', (client: any) => {
        const connectionId = this.generateConnectionId();
        this.connectionCreationTimes.set(connectionId, Date.now());
        
        this.recordEvent({
          type: 'create',
          timestamp: new Date(),
          connectionId,
          poolState: this.getCurrentPoolState(pool)
        });
      });

      pool.on('acquire', (client: any) => {
        const connectionId = this.generateConnectionId();
        this.acquireTimestamps.set(connectionId, Date.now());
        
        this.recordEvent({
          type: 'acquire',
          timestamp: new Date(),
          connectionId,
          poolState: this.getCurrentPoolState(pool)
        });
      });

      pool.on('release', (client: any) => {
        const connectionId = this.generateConnectionId();
        const acquireTime = this.acquireTimestamps.get(connectionId);
        const duration = acquireTime ? Date.now() - acquireTime : undefined;
        
        this.recordEvent({
          type: 'release',
          timestamp: new Date(),
          connectionId,
          duration,
          poolState: this.getCurrentPoolState(pool)
        });
        
        this.acquireTimestamps.delete(connectionId);
      });

      pool.on('error', (error: Error, client: any) => {
        this.recordEvent({
          type: 'error',
          timestamp: new Date(),
          error: error.message,
          poolState: this.getCurrentPoolState(pool)
        });
      });
    }
  }

  private setupMySQLPoolListeners(pool: any): void {
    if (pool.on) {
      pool.on('connection', (connection: any) => {
        const connectionId = this.generateConnectionId();
        this.connectionCreationTimes.set(connectionId, Date.now());
        
        this.recordEvent({
          type: 'create',
          timestamp: new Date(),
          connectionId,
          poolState: this.getCurrentPoolState(pool)
        });
      });

      pool.on('acquire', (connection: any) => {
        const connectionId = this.generateConnectionId();
        this.acquireTimestamps.set(connectionId, Date.now());
        
        this.recordEvent({
          type: 'acquire',
          timestamp: new Date(),
          connectionId,
          poolState: this.getCurrentPoolState(pool)
        });
      });

      pool.on('release', (connection: any) => {
        const connectionId = this.generateConnectionId();
        const acquireTime = this.acquireTimestamps.get(connectionId);
        const duration = acquireTime ? Date.now() - acquireTime : undefined;
        
        this.recordEvent({
          type: 'release',
          timestamp: new Date(),
          connectionId,
          duration,
          poolState: this.getCurrentPoolState(pool)
        });
        
        this.acquireTimestamps.delete(connectionId);
      });

      pool.on('error', (error: Error) => {
        this.recordEvent({
          type: 'error',
          timestamp: new Date(),
          error: error.message,
          poolState: this.getCurrentPoolState(pool)
        });
      });
    }
  }

  private getCurrentPoolState(pool: any): { active: number; idle: number; waiting: number } {
    return {
      active: pool.acquiredCount || pool._acquiredCount || 0,
      idle: pool.idleCount || pool._idleCount || 0,
      waiting: pool.waitingCount || pool._waitingCount || 0
    };
  }

  private updatePoolConfiguration(pool: any): void {
    const config = pool.config || pool.options || {};
    
    this.currentMetrics.maxConnections = config.max || config.connectionLimit || 10;
    this.currentMetrics.minConnections = config.min || 0;
    this.currentMetrics.poolSize = this.currentMetrics.maxConnections;
  }

  private startPeriodicMonitoring(): void {
    interval(this.monitoringInterval)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.collectMetrics();
        this.checkForAlerts();
      });
  }

  private collectMetrics(): void {
    const driver = this.dataSource.driver;
    const pool = (driver as any).pool;
    
    if (!pool) {
      return;
    }

    const poolState = this.getCurrentPoolState(pool);
    
    // Update basic metrics
    this.currentMetrics.activeConnections = poolState.active;
    this.currentMetrics.idleConnections = poolState.idle;
    this.currentMetrics.waitingConnections = poolState.waiting;
    this.currentMetrics.totalConnections = poolState.active + poolState.idle;
    
    // Calculate derived metrics
    this.currentMetrics.averageAcquireTime = this.calculateAverageAcquireTime();
    this.currentMetrics.averageConnectionLifetime = this.calculateAverageConnectionLifetime();
    this.currentMetrics.healthScore = this.calculateHealthScore();
    this.currentMetrics.lastUpdate = new Date();
    
    // Update counters from events
    this.updateCountersFromEvents();
    
    // Emit updated metrics
    this.metricsSubject.next({ ...this.currentMetrics });
  }

  private calculateAverageAcquireTime(): number {
    const recentEvents = this.connectionEvents
      .filter(event => event.type === 'release' && event.duration)
      .slice(-100); // Last 100 events
    
    if (recentEvents.length === 0) return 0;
    
    const totalTime = recentEvents.reduce((sum, event) => sum + (event.duration || 0), 0);
    return totalTime / recentEvents.length;
  }

  private calculateAverageConnectionLifetime(): number {
    const now = Date.now();
    const lifetimes: number[] = [];
    
    for (const [connectionId, creationTime] of this.connectionCreationTimes) {
      lifetimes.push(now - creationTime);
    }
    
    if (lifetimes.length === 0) return 0;
    
    return lifetimes.reduce((sum, lifetime) => sum + lifetime, 0) / lifetimes.length;
  }

  private calculateHealthScore(): number {
    let score = 100;
    
    const utilizationRate = this.currentMetrics.activeConnections / this.currentMetrics.maxConnections;
    
    // Penalize high utilization
    if (utilizationRate > 0.9) {
      score -= 30;
    } else if (utilizationRate > 0.8) {
      score -= 15;
    } else if (utilizationRate > 0.7) {
      score -= 5;
    }
    
    // Penalize waiting connections
    if (this.currentMetrics.waitingConnections > 0) {
      score -= Math.min(20, this.currentMetrics.waitingConnections * 5);
    }
    
    // Penalize connection errors
    const recentErrors = this.connectionEvents
      .filter(event => event.type === 'error')
      .filter(event => Date.now() - event.timestamp.getTime() < 300000); // Last 5 minutes
    
    if (recentErrors.length > 0) {
      score -= Math.min(25, recentErrors.length * 5);
    }
    
    // Penalize long average acquire time
    if (this.currentMetrics.averageAcquireTime > 1000) {
      score -= 10;
    }
    
    return Math.max(0, score);
  }

  private updateCountersFromEvents(): void {
    const now = Date.now();
    const recentEvents = this.connectionEvents.filter(
      event => now - event.timestamp.getTime() < 300000 // Last 5 minutes
    );
    
    this.currentMetrics.acquiredConnections = recentEvents.filter(e => e.type === 'acquire').length;
    this.currentMetrics.releasedConnections = recentEvents.filter(e => e.type === 'release').length;
    this.currentMetrics.createdConnections = recentEvents.filter(e => e.type === 'create').length;
    this.currentMetrics.destroyedConnections = recentEvents.filter(e => e.type === 'destroy').length;
    this.currentMetrics.connectionTimeouts = recentEvents.filter(e => e.type === 'timeout').length;
    this.currentMetrics.connectionErrors = recentEvents.filter(e => e.type === 'error').length;
  }

  private checkForAlerts(): void {
    const alerts: ConnectionPoolAlert[] = [];
    
    // Check for high usage
    const utilizationRate = this.currentMetrics.activeConnections / this.currentMetrics.maxConnections;
    if (utilizationRate > this.alertThresholds.highUsageThreshold / 100) {
      alerts.push({
        type: 'high_usage',
        severity: utilizationRate > 0.95 ? 'critical' : 'high',
        message: `Connection pool usage is ${(utilizationRate * 100).toFixed(1)}%`,
        timestamp: new Date(),
        metrics: { activeConnections: this.currentMetrics.activeConnections, maxConnections: this.currentMetrics.maxConnections },
        recommendation: 'Consider increasing pool size or optimizing connection usage'
      });
    }
    
    // Check for waiting connections
    if (this.currentMetrics.waitingConnections > 0) {
      alerts.push({
        type: 'pool_exhausted',
        severity: this.currentMetrics.waitingConnections > 5 ? 'critical' : 'high',
        message: `${this.currentMetrics.waitingConnections} connections waiting for availability`,
        timestamp: new Date(),
        metrics: { waitingConnections: this.currentMetrics.waitingConnections },
        recommendation: 'Pool is exhausted. Consider increasing pool size or investigating connection leaks'
      });
    }
    
    // Check for connection errors
    const recentErrors = this.connectionEvents
      .filter(event => event.type === 'error')
      .filter(event => Date.now() - event.timestamp.getTime() < 60000); // Last minute
    
    if (recentErrors.length > 0) {
      alerts.push({
        type: 'connection_error',
        severity: recentErrors.length > 5 ? 'critical' : 'medium',
        message: `${recentErrors.length} connection errors in the last minute`,
        timestamp: new Date(),
        metrics: { connectionErrors: recentErrors.length },
        recommendation: 'Investigate database connectivity issues or connection configuration'
      });
    }
    
    // Check for potential connection leaks
    const longRunningConnections = Array.from(this.connectionCreationTimes.values())
      .filter(creationTime => Date.now() - creationTime > this.alertThresholds.connectionLeakThreshold)
      .length;
    
    if (longRunningConnections > 0) {
      alerts.push({
        type: 'connection_leak',
        severity: longRunningConnections > 3 ? 'high' : 'medium',
        message: `${longRunningConnections} connections have been active for more than 5 minutes`,
        timestamp: new Date(),
        metrics: { activeConnections: this.currentMetrics.activeConnections },
        recommendation: 'Investigate potential connection leaks in application code'
      });
    }
    
    // Emit alerts
    alerts.forEach(alert => {
      this.alertsSubject.next(alert);
      this.logger.warn(`Connection pool alert: ${alert.message}`, alert);
    });
  }

  private recordEvent(event: ConnectionEvent): void {
    this.connectionEvents.push(event);
    
    // Limit event history
    if (this.connectionEvents.length > this.maxEventHistory) {
      this.connectionEvents = this.connectionEvents.slice(-this.maxEventHistory);
    }
    
    this.eventsSubject.next(event);
  }

  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Public API
  getMetrics(): ConnectionPoolMetrics {
    return { ...this.currentMetrics };
  }

  getMetricsStream(): Observable<ConnectionPoolMetrics> {
    return this.metricsSubject.asObservable().pipe(shareReplay(1));
  }

  getEventStream(): Observable<ConnectionEvent> {
    return this.eventsSubject.asObservable();
  }

  getAlertStream(): Observable<ConnectionPoolAlert> {
    return this.alertsSubject.asObservable();
  }

  getRecentEvents(limit: number = 100): ConnectionEvent[] {
    return this.connectionEvents.slice(-limit);
  }

  getConnectionPoolHealth(): {
    score: number;
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
    recommendations: string[];
  } {
    const score = this.currentMetrics.healthScore;
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    if (score < 70) {
      status = 'critical';
      issues.push('Connection pool health is critical');
      recommendations.push('Immediate investigation required');
    } else if (score < 85) {
      status = 'warning';
      issues.push('Connection pool performance is degraded');
      recommendations.push('Monitor closely and consider optimization');
    }
    
    const utilizationRate = this.currentMetrics.activeConnections / this.currentMetrics.maxConnections;
    if (utilizationRate > 0.8) {
      issues.push(`High connection pool utilization: ${(utilizationRate * 100).toFixed(1)}%`);
      recommendations.push('Consider increasing pool size');
    }
    
    if (this.currentMetrics.waitingConnections > 0) {
      issues.push(`${this.currentMetrics.waitingConnections} connections waiting`);
      recommendations.push('Pool may be undersized for current load');
    }
    
    return {
      score,
      status,
      issues,
      recommendations
    };
  }

  resetMetrics(): void {
    this.currentMetrics = this.initializeMetrics();
    this.connectionEvents = [];
    this.acquireTimestamps.clear();
    this.connectionCreationTimes.clear();
    this.metricsSubject.next(this.currentMetrics);
  }
}
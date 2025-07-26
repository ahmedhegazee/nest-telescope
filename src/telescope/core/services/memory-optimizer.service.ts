import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Observable, Subject, interval } from "rxjs";
import { map, filter, debounceTime } from "rxjs/operators";
import { TelescopeConfig } from "../interfaces/telescope-config.interface";
import { Inject } from "@nestjs/common";

export interface MemoryConfig {
  enabled: boolean;
  monitoring: {
    enabled: boolean;
    interval: number; // ms
    threshold: {
      heapUsed: number; // percentage
      heapTotal: number; // percentage
      external: number; // percentage
      rss: number; // percentage
    };
  };
  optimization: {
    autoGc: boolean;
    gcThreshold: number; // percentage
    leakDetection: boolean;
    memoryPooling: boolean;
    compression: boolean;
  };
  alerts: {
    enabled: boolean;
    criticalThreshold: number; // percentage
    warningThreshold: number; // percentage
  };
}

export interface MemoryMetrics {
  timestamp: Date;
  heapUsed: number; // bytes
  heapTotal: number; // bytes
  heapFree: number; // bytes
  external: number; // bytes
  rss: number; // bytes
  arrayBuffers: number; // bytes
  heapUsedPercentage: number;
  heapTotalPercentage: number;
  externalPercentage: number;
  rssPercentage: number;
  gc: {
    count: number;
    duration: number;
    type: string;
  };
}

export interface MemoryLeak {
  id: string;
  type: "object" | "array" | "function" | "closure" | "event";
  location: string;
  size: number; // bytes
  growth: number; // bytes per minute
  firstDetected: Date;
  lastSeen: Date;
  severity: "low" | "medium" | "high" | "critical";
  status: "active" | "resolved" | "investigating";
  stackTrace?: string;
}

export interface MemoryOptimization {
  type: "gc" | "compression" | "cleanup" | "pooling";
  timestamp: Date;
  duration: number;
  freedMemory: number; // bytes
  improvement: number; // percentage
  success: boolean;
  error?: string;
}

export interface MemoryHealth {
  status: "healthy" | "warning" | "critical";
  score: number; // 0-100
  issues: string[];
  recommendations: string[];
  metrics: MemoryMetrics;
}

@Injectable()
export class MemoryOptimizerService implements OnModuleInit {
  private readonly logger = new Logger(MemoryOptimizerService.name);
  private readonly memoryHistory: MemoryMetrics[] = [];
  private readonly memoryLeaks = new Map<string, MemoryLeak>();
  private readonly optimizations: MemoryOptimization[] = [];
  private readonly metricsSubject = new Subject<MemoryMetrics>();
  private readonly healthSubject = new Subject<MemoryHealth>();
  private readonly leakSubject = new Subject<MemoryLeak>();
  private readonly optimizationSubject = new Subject<MemoryOptimization>();
  private readonly config: MemoryConfig;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private optimizationInterval: NodeJS.Timeout | null = null;
  private gcCount = 0;
  private lastGcTime = 0;

  constructor(
    @Inject("TELESCOPE_CONFIG")
    private readonly telescopeConfig: TelescopeConfig
  ) {
    this.config = this.telescopeConfig.memory || this.getDefaultMemoryConfig();
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.log("Memory optimization disabled");
      return;
    }

    await this.initializeOptimizer();
    this.startMonitoring();
    this.startOptimization();
    this.setupGcMonitoring();
    this.logger.log("Memory optimizer service initialized");
  }

  private getDefaultMemoryConfig(): MemoryConfig {
    return {
      enabled: true,
      monitoring: {
        enabled: true,
        interval: 30000, // 30 seconds
        threshold: {
          heapUsed: 80, // 80%
          heapTotal: 90, // 90%
          external: 70, // 70%
          rss: 85, // 85%
        },
      },
      optimization: {
        autoGc: true,
        gcThreshold: 75, // 75%
        leakDetection: true,
        memoryPooling: true,
        compression: true,
      },
      alerts: {
        enabled: true,
        criticalThreshold: 90, // 90%
        warningThreshold: 75, // 75%
      },
    };
  }

  private async initializeOptimizer(): Promise<void> {
    // Initialize memory pools if pooling is enabled
    if (this.config.optimization.memoryPooling) {
      await this.initializeMemoryPools();
    }

    // Initialize leak detection
    if (this.config.optimization.leakDetection) {
      await this.initializeLeakDetection();
    }

    // Take initial memory snapshot
    const initialMetrics = this.getCurrentMemoryMetrics();
    this.memoryHistory.push(initialMetrics);
  }

  private async initializeMemoryPools(): Promise<void> {
    this.logger.log("Initializing memory pools");
    // Implementation would create memory pools for frequently allocated objects
  }

  private async initializeLeakDetection(): Promise<void> {
    this.logger.log("Initializing memory leak detection");
    // Implementation would set up heap snapshots and monitoring
  }

  private startMonitoring(): void {
    if (!this.config.monitoring.enabled) return;

    this.monitoringInterval = interval(
      this.config.monitoring.interval
    ).subscribe(async () => {
      const metrics = this.getCurrentMemoryMetrics();
      this.memoryHistory.push(metrics);
      this.metricsSubject.next(metrics);

      // Keep only recent history (last 1000 entries)
      if (this.memoryHistory.length > 1000) {
        this.memoryHistory.splice(0, this.memoryHistory.length - 1000);
      }

      // Check for memory issues
      await this.checkMemoryHealth(metrics);

      // Detect memory leaks
      if (this.config.optimization.leakDetection) {
        await this.detectMemoryLeaks(metrics);
      }
    });
  }

  private startOptimization(): void {
    this.optimizationInterval = interval(120000).subscribe(async () => {
      // Every 2 minutes
      await this.runOptimizationCycle();
    });
  }

  private setupGcMonitoring(): void {
    // Monitor garbage collection events
    if (typeof global.gc === "function") {
      const originalGc = global.gc;
      global.gc = (...args: any[]) => {
        const startTime = Date.now();
        const result = originalGc.apply(global, args);
        const duration = Date.now() - startTime;

        this.gcCount++;
        this.lastGcTime = Date.now();

        this.logger.debug(`Garbage collection completed in ${duration}ms`);

        return result;
      };
    }
  }

  // Memory monitoring

  private getCurrentMemoryMetrics(): MemoryMetrics {
    const memUsage = process.memoryUsage();
    const gcStats = this.getGcStats();

    return {
      timestamp: new Date(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      heapFree: memUsage.heapTotal - memUsage.heapUsed,
      external: memUsage.external,
      rss: memUsage.rss,
      arrayBuffers: memUsage.arrayBuffers,
      heapUsedPercentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      heapTotalPercentage: (memUsage.heapTotal / memUsage.rss) * 100,
      externalPercentage: (memUsage.external / memUsage.rss) * 100,
      rssPercentage: (memUsage.rss / (1024 * 1024 * 1024)) * 100, // Assuming 1GB as baseline
      gc: gcStats,
    };
  }

  private getGcStats(): MemoryMetrics["gc"] {
    return {
      count: this.gcCount,
      duration: Date.now() - this.lastGcTime,
      type: "mark-and-sweep", // Simplified
    };
  }

  private async checkMemoryHealth(metrics: MemoryMetrics): Promise<void> {
    const health = this.calculateMemoryHealth(metrics);
    this.healthSubject.next(health);

    // Check thresholds and trigger alerts
    if (this.config.alerts.enabled) {
      await this.checkMemoryAlerts(metrics);
    }

    // Auto-trigger optimizations
    if (
      this.config.optimization.autoGc &&
      metrics.heapUsedPercentage > this.config.optimization.gcThreshold
    ) {
      await this.triggerGarbageCollection();
    }
  }

  private calculateMemoryHealth(metrics: MemoryMetrics): MemoryHealth {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // Check heap usage
    if (
      metrics.heapUsedPercentage > this.config.monitoring.threshold.heapUsed
    ) {
      issues.push(`High heap usage: ${metrics.heapUsedPercentage.toFixed(1)}%`);
      score -= 20;
      recommendations.push("Consider garbage collection or memory cleanup");
    }

    // Check external memory
    if (
      metrics.externalPercentage > this.config.monitoring.threshold.external
    ) {
      issues.push(
        `High external memory usage: ${metrics.externalPercentage.toFixed(1)}%`
      );
      score -= 15;
      recommendations.push("Check for memory leaks in external dependencies");
    }

    // Check RSS
    if (metrics.rssPercentage > this.config.monitoring.threshold.rss) {
      issues.push(`High RSS usage: ${metrics.rssPercentage.toFixed(1)}%`);
      score -= 10;
      recommendations.push("Consider process restart or memory optimization");
    }

    // Check for memory growth trend
    const growthTrend = this.calculateMemoryGrowthTrend();
    if (growthTrend > 10) {
      // More than 10% growth per minute
      issues.push(
        `Memory growing rapidly: ${growthTrend.toFixed(1)}% per minute`
      );
      score -= 25;
      recommendations.push("Investigate for memory leaks");
    }

    // Determine status
    let status: MemoryHealth["status"] = "healthy";
    if (score < 50) status = "critical";
    else if (score < 75) status = "warning";

    return {
      status,
      score: Math.max(0, score),
      issues,
      recommendations,
      metrics,
    };
  }

  private calculateMemoryGrowthTrend(): number {
    if (this.memoryHistory.length < 10) return 0;

    const recent = this.memoryHistory.slice(-5);
    const older = this.memoryHistory.slice(-10, -5);

    const recentAvg =
      recent.reduce((sum, m) => sum + m.heapUsed, 0) / recent.length;
    const olderAvg =
      older.reduce((sum, m) => sum + m.heapUsed, 0) / older.length;

    if (olderAvg === 0) return 0;

    return ((recentAvg - olderAvg) / olderAvg) * 100;
  }

  private async checkMemoryAlerts(metrics: MemoryMetrics): Promise<void> {
    if (metrics.heapUsedPercentage > this.config.alerts.criticalThreshold) {
      this.logger.error(
        `CRITICAL: Memory usage at ${metrics.heapUsedPercentage.toFixed(1)}%`
      );
    } else if (
      metrics.heapUsedPercentage > this.config.alerts.warningThreshold
    ) {
      this.logger.warn(
        `WARNING: Memory usage at ${metrics.heapUsedPercentage.toFixed(1)}%`
      );
    }
  }

  // Memory leak detection

  private async detectMemoryLeaks(metrics: MemoryMetrics): Promise<void> {
    // Analyze memory growth patterns
    const growthPattern = this.analyzeMemoryGrowthPattern();

    for (const pattern of growthPattern) {
      if (pattern.growthRate > 5) {
        // More than 5% growth per interval
        await this.investigatePotentialLeak(pattern);
      }
    }
  }

  private analyzeMemoryGrowthPattern(): Array<{
    type: string;
    growthRate: number;
    size: number;
  }> {
    const patterns: Array<{
      type: string;
      growthRate: number;
      size: number;
    }> = [];

    // Analyze heap growth
    if (this.memoryHistory.length >= 2) {
      const current = this.memoryHistory[this.memoryHistory.length - 1];
      const previous = this.memoryHistory[this.memoryHistory.length - 2];

      const heapGrowth =
        ((current.heapUsed - previous.heapUsed) / previous.heapUsed) * 100;
      if (heapGrowth > 0) {
        patterns.push({
          type: "heap",
          growthRate: heapGrowth,
          size: current.heapUsed,
        });
      }

      const externalGrowth =
        ((current.external - previous.external) / previous.external) * 100;
      if (externalGrowth > 0) {
        patterns.push({
          type: "external",
          growthRate: externalGrowth,
          size: current.external,
        });
      }
    }

    return patterns;
  }

  private async investigatePotentialLeak(pattern: {
    type: string;
    growthRate: number;
    size: number;
  }): Promise<void> {
    const leakId = `leak_${pattern.type}_${Date.now()}`;

    // Check if this leak is already being tracked
    const existingLeak = Array.from(this.memoryLeaks.values()).find(
      (leak) => leak.type === pattern.type && leak.status === "active"
    );

    if (existingLeak) {
      // Update existing leak
      existingLeak.growth = pattern.growthRate;
      existingLeak.size = pattern.size;
      existingLeak.lastSeen = new Date();

      if (pattern.growthRate > 20) {
        existingLeak.severity = "critical";
      } else if (pattern.growthRate > 10) {
        existingLeak.severity = "high";
      }

      this.leakSubject.next(existingLeak);
    } else {
      // Create new leak record
      const leak: MemoryLeak = {
        id: leakId,
        type: pattern.type as any,
        location: "unknown",
        size: pattern.size,
        growth: pattern.growthRate,
        firstDetected: new Date(),
        lastSeen: new Date(),
        severity:
          pattern.growthRate > 20
            ? "critical"
            : pattern.growthRate > 10
            ? "high"
            : "medium",
        status: "active",
      };

      this.memoryLeaks.set(leakId, leak);
      this.leakSubject.next(leak);

      this.logger.warn(
        `Potential memory leak detected: ${
          pattern.type
        } growing at ${pattern.growthRate.toFixed(1)}% per interval`
      );
    }
  }

  // Memory optimization

  private async runOptimizationCycle(): Promise<void> {
    this.logger.log("Starting memory optimization cycle");

    try {
      // Run garbage collection if needed
      if (this.shouldRunGc()) {
        await this.triggerGarbageCollection();
      }

      // Compress memory if enabled
      if (this.config.optimization.compression) {
        await this.compressMemory();
      }

      // Clean up memory pools
      if (this.config.optimization.memoryPooling) {
        await this.cleanupMemoryPools();
      }

      // Resolve memory leaks
      await this.resolveMemoryLeaks();

      this.logger.log("Memory optimization cycle completed");
    } catch (error) {
      this.logger.error(`Memory optimization cycle failed: ${error.message}`);
    }
  }

  private shouldRunGc(): boolean {
    if (!this.config.optimization.autoGc) return false;

    const currentMetrics = this.getCurrentMemoryMetrics();
    return (
      currentMetrics.heapUsedPercentage > this.config.optimization.gcThreshold
    );
  }

  private async triggerGarbageCollection(): Promise<void> {
    try {
      this.logger.log("Triggering garbage collection");

      const beforeMetrics = this.getCurrentMemoryMetrics();
      const startTime = Date.now();

      if (typeof global.gc === "function") {
        global.gc();
      } else {
        // Fallback: try to trigger GC by creating pressure
        this.createMemoryPressure();
      }

      const duration = Date.now() - startTime;
      const afterMetrics = this.getCurrentMemoryMetrics();
      const freedMemory = beforeMetrics.heapUsed - afterMetrics.heapUsed;
      const improvement =
        beforeMetrics.heapUsed > 0
          ? (freedMemory / beforeMetrics.heapUsed) * 100
          : 0;

      const optimization: MemoryOptimization = {
        type: "gc",
        timestamp: new Date(),
        duration,
        freedMemory,
        improvement,
        success: true,
      };

      this.optimizations.push(optimization);
      this.optimizationSubject.next(optimization);

      this.logger.log(
        `Garbage collection completed: freed ${this.formatBytes(
          freedMemory
        )} (${improvement.toFixed(1)}% improvement)`
      );
    } catch (error) {
      this.logger.error(`Garbage collection failed: ${error.message}`);

      const optimization: MemoryOptimization = {
        type: "gc",
        timestamp: new Date(),
        duration: 0,
        freedMemory: 0,
        improvement: 0,
        success: false,
        error: error.message,
      };

      this.optimizations.push(optimization);
      this.optimizationSubject.next(optimization);
    }
  }

  private createMemoryPressure(): void {
    // Create memory pressure to potentially trigger GC
    const pressure = [];
    for (let i = 0; i < 1000; i++) {
      pressure.push(new Array(1000).fill("pressure"));
    }
    // Clear the pressure array
    pressure.length = 0;
  }

  private async compressMemory(): Promise<void> {
    try {
      this.logger.log("Compressing memory");

      const beforeMetrics = this.getCurrentMemoryMetrics();
      const startTime = Date.now();

      // Implementation would compress memory using various strategies
      await this.performMemoryCompression();

      const duration = Date.now() - startTime;
      const afterMetrics = this.getCurrentMemoryMetrics();
      const freedMemory = beforeMetrics.heapUsed - afterMetrics.heapUsed;
      const improvement =
        beforeMetrics.heapUsed > 0
          ? (freedMemory / beforeMetrics.heapUsed) * 100
          : 0;

      const optimization: MemoryOptimization = {
        type: "compression",
        timestamp: new Date(),
        duration,
        freedMemory,
        improvement,
        success: true,
      };

      this.optimizations.push(optimization);
      this.optimizationSubject.next(optimization);
    } catch (error) {
      this.logger.error(`Memory compression failed: ${error.message}`);

      const optimization: MemoryOptimization = {
        type: "compression",
        timestamp: new Date(),
        duration: 0,
        freedMemory: 0,
        improvement: 0,
        success: false,
        error: error.message,
      };

      this.optimizations.push(optimization);
      this.optimizationSubject.next(optimization);
    }
  }

  private async performMemoryCompression(): Promise<void> {
    // Implementation would perform actual memory compression
    // This could involve:
    // - Compressing large objects
    // - Consolidating fragmented memory
    // - Moving objects to more efficient storage
    await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate compression
  }

  private async cleanupMemoryPools(): Promise<void> {
    try {
      this.logger.log("Cleaning up memory pools");

      const beforeMetrics = this.getCurrentMemoryMetrics();
      const startTime = Date.now();

      // Implementation would clean up memory pools
      await this.performPoolCleanup();

      const duration = Date.now() - startTime;
      const afterMetrics = this.getCurrentMemoryMetrics();
      const freedMemory = beforeMetrics.heapUsed - afterMetrics.heapUsed;
      const improvement =
        beforeMetrics.heapUsed > 0
          ? (freedMemory / beforeMetrics.heapUsed) * 100
          : 0;

      const optimization: MemoryOptimization = {
        type: "cleanup",
        timestamp: new Date(),
        duration,
        freedMemory,
        improvement,
        success: true,
      };

      this.optimizations.push(optimization);
      this.optimizationSubject.next(optimization);
    } catch (error) {
      this.logger.error(`Memory pool cleanup failed: ${error.message}`);

      const optimization: MemoryOptimization = {
        type: "cleanup",
        timestamp: new Date(),
        duration: 0,
        freedMemory: 0,
        improvement: 0,
        success: false,
        error: error.message,
      };

      this.optimizations.push(optimization);
      this.optimizationSubject.next(optimization);
    }
  }

  private async performPoolCleanup(): Promise<void> {
    // Implementation would clean up memory pools
    await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate cleanup
  }

  private async resolveMemoryLeaks(): Promise<void> {
    const activeLeaks = Array.from(this.memoryLeaks.values()).filter(
      (leak) => leak.status === "active"
    );

    for (const leak of activeLeaks) {
      // Check if leak has been resolved
      const recentMetrics = this.memoryHistory.slice(-5);
      const growthTrend = this.calculateLeakGrowthTrend(leak);

      if (growthTrend < 1) {
        // Less than 1% growth
        leak.status = "resolved";
        this.logger.log(`Memory leak resolved: ${leak.type} (${leak.id})`);
      }
    }
  }

  private calculateLeakGrowthTrend(leak: MemoryLeak): number {
    // Calculate growth trend for specific leak type
    if (this.memoryHistory.length < 10) return 0;

    const recent = this.memoryHistory.slice(-5);
    const older = this.memoryHistory.slice(-10, -5);

    let recentAvg: number, olderAvg: number;

    if (leak.type === "heap") {
      recentAvg =
        recent.reduce((sum, m) => sum + m.heapUsed, 0) / recent.length;
      olderAvg = older.reduce((sum, m) => sum + m.heapUsed, 0) / older.length;
    } else if (leak.type === "external") {
      recentAvg =
        recent.reduce((sum, m) => sum + m.external, 0) / recent.length;
      olderAvg = older.reduce((sum, m) => sum + m.external, 0) / older.length;
    } else {
      return 0;
    }

    if (olderAvg === 0) return 0;
    return ((recentAvg - olderAvg) / olderAvg) * 100;
  }

  // Utility methods

  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  // Public API methods

  getMemoryMetrics(): MemoryMetrics[] {
    return [...this.memoryHistory];
  }

  getCurrentMetrics(): MemoryMetrics {
    return this.getCurrentMemoryMetrics();
  }

  getMemoryLeaks(): MemoryLeak[] {
    return Array.from(this.memoryLeaks.values());
  }

  getOptimizations(): MemoryOptimization[] {
    return [...this.optimizations];
  }

  getMetricsUpdates(): Observable<MemoryMetrics> {
    return this.metricsSubject.asObservable();
  }

  getHealthUpdates(): Observable<MemoryHealth> {
    return this.healthSubject.asObservable();
  }

  getLeakUpdates(): Observable<MemoryLeak> {
    return this.leakSubject.asObservable();
  }

  getOptimizationUpdates(): Observable<MemoryOptimization> {
    return this.optimizationSubject.asObservable();
  }

  async forceGarbageCollection(): Promise<MemoryOptimization> {
    return new Promise((resolve) => {
      const beforeMetrics = this.getCurrentMemoryMetrics();
      const startTime = Date.now();

      if (typeof global.gc === "function") {
        global.gc();

        const duration = Date.now() - startTime;
        const afterMetrics = this.getCurrentMemoryMetrics();
        const freedMemory = beforeMetrics.heapUsed - afterMetrics.heapUsed;
        const improvement =
          beforeMetrics.heapUsed > 0
            ? (freedMemory / beforeMetrics.heapUsed) * 100
            : 0;

        const optimization: MemoryOptimization = {
          type: "gc",
          timestamp: new Date(),
          duration,
          freedMemory,
          improvement,
          success: true,
        };

        resolve(optimization);
      } else {
        resolve({
          type: "gc",
          timestamp: new Date(),
          duration: 0,
          freedMemory: 0,
          improvement: 0,
          success: false,
          error: "Garbage collection not available",
        });
      }
    });
  }

  async resolveLeak(leakId: string): Promise<boolean> {
    const leak = this.memoryLeaks.get(leakId);
    if (!leak) return false;

    leak.status = "resolved";
    this.leakSubject.next(leak);

    this.logger.log(`Memory leak manually resolved: ${leakId}`);
    return true;
  }

  async shutdown(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval as any);
    }
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval as any);
    }

    // Final cleanup
    await this.triggerGarbageCollection();

    this.logger.log("Memory optimizer service shutdown");
  }
}

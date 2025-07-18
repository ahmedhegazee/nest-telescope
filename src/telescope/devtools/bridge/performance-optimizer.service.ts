import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import { map, scan, shareReplay } from 'rxjs/operators';

export interface PerformanceMetrics {
  averageProcessingTime: number;
  throughput: number;
  memoryUsage: number;
  cpuUsage: number;
  errorRate: number;
  queueSize: number;
}

export interface OptimizationRecommendation {
  type: 'batch_size' | 'flush_interval' | 'concurrency' | 'memory' | 'circuit_breaker';
  current: number;
  recommended: number;
  reason: string;
  impact: 'low' | 'medium' | 'high';
  confidence: number;
}

export interface PerformanceSettings {
  batchSize: number;
  flushInterval: number;
  maxConcurrency: number;
  memoryThreshold: number;
  adaptiveOptimization: boolean;
}

@Injectable()
export class PerformanceOptimizerService {
  private readonly logger = new Logger(PerformanceOptimizerService.name);
  
  private readonly metricsSubject = new Subject<PerformanceMetrics>();
  private readonly settingsSubject = new BehaviorSubject<PerformanceSettings>({
    batchSize: 100,
    flushInterval: 1000,
    maxConcurrency: 3,
    memoryThreshold: 100 * 1024 * 1024, // 100MB
    adaptiveOptimization: true
  });

  private readonly performanceHistory: PerformanceMetrics[] = [];
  private readonly maxHistorySize = 100;
  private lastOptimizationTime = 0;
  private readonly optimizationInterval = 30000; // 30 seconds

  constructor() {
    this.startPerformanceMonitoring();
  }

  private startPerformanceMonitoring(): void {
    // Monitor system metrics
    setInterval(() => {
      this.collectSystemMetrics();
    }, 5000);

    // Perform optimization analysis
    setInterval(() => {
      this.analyzeAndOptimize();
    }, this.optimizationInterval);
  }

  private collectSystemMetrics(): void {
    const metrics: PerformanceMetrics = {
      averageProcessingTime: this.calculateAverageProcessingTime(),
      throughput: this.calculateThroughput(),
      memoryUsage: this.getMemoryUsage(),
      cpuUsage: this.getCpuUsage(),
      errorRate: this.calculateErrorRate(),
      queueSize: this.getCurrentQueueSize()
    };

    this.metricsSubject.next(metrics);
    this.addToHistory(metrics);
  }

  private calculateAverageProcessingTime(): number {
    // Get from metrics service or calculate from recent operations
    return this.performanceHistory.length > 0 
      ? this.performanceHistory.slice(-10).reduce((sum, m) => sum + m.averageProcessingTime, 0) / Math.min(10, this.performanceHistory.length)
      : 0;
  }

  private calculateThroughput(): number {
    // Calculate entries per second
    const recentMetrics = this.performanceHistory.slice(-12); // Last minute
    if (recentMetrics.length < 2) return 0;

    const timeSpan = 60; // 1 minute
    const totalProcessed = recentMetrics.reduce((sum, m) => sum + (m.throughput || 0), 0);
    return totalProcessed / timeSpan;
  }

  private getMemoryUsage(): number {
    const memUsage = process.memoryUsage();
    return memUsage.heapUsed;
  }

  private getCpuUsage(): number {
    // Simplified CPU usage calculation
    const usage = process.cpuUsage();
    return (usage.user + usage.system) / 1000000; // Convert to milliseconds
  }

  private calculateErrorRate(): number {
    const recentMetrics = this.performanceHistory.slice(-12);
    if (recentMetrics.length === 0) return 0;

    const totalErrors = recentMetrics.reduce((sum, m) => sum + (m.errorRate || 0), 0);
    return totalErrors / recentMetrics.length;
  }

  private getCurrentQueueSize(): number {
    // This would be provided by the actual queue implementation
    return 0;
  }

  private addToHistory(metrics: PerformanceMetrics): void {
    this.performanceHistory.push(metrics);
    if (this.performanceHistory.length > this.maxHistorySize) {
      this.performanceHistory.shift();
    }
  }

  private analyzeAndOptimize(): void {
    const now = Date.now();
    if (now - this.lastOptimizationTime < this.optimizationInterval) {
      return;
    }

    const currentSettings = this.settingsSubject.value;
    if (!currentSettings.adaptiveOptimization) {
      return;
    }

    const recommendations = this.generateOptimizationRecommendations();
    
    if (recommendations.length > 0) {
      this.logger.log(`Generated ${recommendations.length} optimization recommendations`);
      this.applyOptimizations(recommendations);
    }

    this.lastOptimizationTime = now;
  }

  private generateOptimizationRecommendations(): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    const currentSettings = this.settingsSubject.value;
    const recentMetrics = this.performanceHistory.slice(-12);

    if (recentMetrics.length < 5) {
      return recommendations;
    }

    const avgMetrics = this.calculateAverageMetrics(recentMetrics);

    // Batch size optimization
    if (avgMetrics.averageProcessingTime > 5000) {
      recommendations.push({
        type: 'batch_size',
        current: currentSettings.batchSize,
        recommended: Math.max(10, currentSettings.batchSize * 0.8),
        reason: 'High processing time detected',
        impact: 'medium',
        confidence: 0.7
      });
    } else if (avgMetrics.averageProcessingTime < 1000 && avgMetrics.throughput > 50) {
      recommendations.push({
        type: 'batch_size',
        current: currentSettings.batchSize,
        recommended: Math.min(500, currentSettings.batchSize * 1.2),
        reason: 'Low processing time with high throughput',
        impact: 'low',
        confidence: 0.6
      });
    }

    // Flush interval optimization
    if (avgMetrics.queueSize > currentSettings.batchSize * 0.8) {
      recommendations.push({
        type: 'flush_interval',
        current: currentSettings.flushInterval,
        recommended: Math.max(500, currentSettings.flushInterval * 0.8),
        reason: 'High queue size detected',
        impact: 'medium',
        confidence: 0.8
      });
    }

    // Concurrency optimization
    if (avgMetrics.cpuUsage > 80) {
      recommendations.push({
        type: 'concurrency',
        current: currentSettings.maxConcurrency,
        recommended: Math.max(1, currentSettings.maxConcurrency - 1),
        reason: 'High CPU usage detected',
        impact: 'high',
        confidence: 0.9
      });
    } else if (avgMetrics.cpuUsage < 30 && avgMetrics.averageProcessingTime > 3000) {
      recommendations.push({
        type: 'concurrency',
        current: currentSettings.maxConcurrency,
        recommended: Math.min(10, currentSettings.maxConcurrency + 1),
        reason: 'Low CPU usage with high processing time',
        impact: 'medium',
        confidence: 0.7
      });
    }

    // Memory optimization
    if (avgMetrics.memoryUsage > currentSettings.memoryThreshold) {
      recommendations.push({
        type: 'memory',
        current: currentSettings.batchSize,
        recommended: Math.max(10, currentSettings.batchSize * 0.7),
        reason: 'Memory usage above threshold',
        impact: 'high',
        confidence: 0.8
      });
    }

    return recommendations;
  }

  private calculateAverageMetrics(metrics: PerformanceMetrics[]): PerformanceMetrics {
    const count = metrics.length;
    return {
      averageProcessingTime: metrics.reduce((sum, m) => sum + m.averageProcessingTime, 0) / count,
      throughput: metrics.reduce((sum, m) => sum + m.throughput, 0) / count,
      memoryUsage: metrics.reduce((sum, m) => sum + m.memoryUsage, 0) / count,
      cpuUsage: metrics.reduce((sum, m) => sum + m.cpuUsage, 0) / count,
      errorRate: metrics.reduce((sum, m) => sum + m.errorRate, 0) / count,
      queueSize: metrics.reduce((sum, m) => sum + m.queueSize, 0) / count
    };
  }

  private applyOptimizations(recommendations: OptimizationRecommendation[]): void {
    const currentSettings = this.settingsSubject.value;
    const newSettings = { ...currentSettings };

    // Apply high-impact recommendations first
    const sortedRecommendations = recommendations.sort((a, b) => {
      const impactOrder = { high: 3, medium: 2, low: 1 };
      return (impactOrder[b.impact] * b.confidence) - (impactOrder[a.impact] * a.confidence);
    });

    for (const recommendation of sortedRecommendations) {
      if (recommendation.confidence < 0.6) {
        continue; // Skip low-confidence recommendations
      }

      switch (recommendation.type) {
        case 'batch_size':
          newSettings.batchSize = Math.round(recommendation.recommended);
          this.logger.log(`Optimized batch size: ${recommendation.current} → ${newSettings.batchSize}`);
          break;
        case 'flush_interval':
          newSettings.flushInterval = Math.round(recommendation.recommended);
          this.logger.log(`Optimized flush interval: ${recommendation.current} → ${newSettings.flushInterval}`);
          break;
        case 'concurrency':
          newSettings.maxConcurrency = Math.round(recommendation.recommended);
          this.logger.log(`Optimized concurrency: ${recommendation.current} → ${newSettings.maxConcurrency}`);
          break;
        case 'memory':
          // Memory optimization affects batch size
          newSettings.batchSize = Math.round(recommendation.recommended);
          this.logger.log(`Optimized for memory: batch size ${recommendation.current} → ${newSettings.batchSize}`);
          break;
      }
    }

    this.settingsSubject.next(newSettings);
  }

  // Public API
  getMetricsStream(): Observable<PerformanceMetrics> {
    return this.metricsSubject.asObservable().pipe(
      shareReplay(1)
    );
  }

  getSettingsStream(): Observable<PerformanceSettings> {
    return this.settingsSubject.asObservable().pipe(
      shareReplay(1)
    );
  }

  getCurrentMetrics(): PerformanceMetrics | null {
    return this.performanceHistory.length > 0 
      ? this.performanceHistory[this.performanceHistory.length - 1]
      : null;
  }

  getCurrentSettings(): PerformanceSettings {
    return this.settingsSubject.value;
  }

  updateSettings(settings: Partial<PerformanceSettings>): void {
    const currentSettings = this.settingsSubject.value;
    const newSettings = { ...currentSettings, ...settings };
    this.settingsSubject.next(newSettings);
    this.logger.log('Performance settings updated:', settings);
  }

  generatePerformanceReport(): {
    currentMetrics: PerformanceMetrics | null;
    settings: PerformanceSettings;
    recommendations: OptimizationRecommendation[];
    trends: {
      processingTime: number[];
      throughput: number[];
      memoryUsage: number[];
      errorRate: number[];
    };
  } {
    const recommendations = this.generateOptimizationRecommendations();
    const recentHistory = this.performanceHistory.slice(-20);

    return {
      currentMetrics: this.getCurrentMetrics(),
      settings: this.getCurrentSettings(),
      recommendations,
      trends: {
        processingTime: recentHistory.map(m => m.averageProcessingTime),
        throughput: recentHistory.map(m => m.throughput),
        memoryUsage: recentHistory.map(m => m.memoryUsage),
        errorRate: recentHistory.map(m => m.errorRate)
      }
    };
  }

  resetOptimizations(): void {
    const defaultSettings: PerformanceSettings = {
      batchSize: 100,
      flushInterval: 1000,
      maxConcurrency: 3,
      memoryThreshold: 100 * 1024 * 1024,
      adaptiveOptimization: true
    };

    this.settingsSubject.next(defaultSettings);
    this.logger.log('Performance settings reset to defaults');
  }
}
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Observable, Subject, interval, BehaviorSubject } from 'rxjs';
import { map, filter, scan, tap } from 'rxjs/operators';
import { AnalyticsService, AnalyticsData } from './analytics.service';
import { PerformanceCorrelationService } from './performance-correlation.service';

// ML Analytics interfaces
export interface AnomalyDetection {
  id: string;
  timestamp: Date;
  type: 'performance' | 'error' | 'traffic' | 'resource' | 'query';
  severity: 'low' | 'medium' | 'high' | 'critical';
  component: string;
  metric: string;
  value: number;
  baseline: number;
  deviation: number;
  confidence: number; // 0-1
  description: string;
  suggestedActions: string[];
}

export interface RegressionAnalysis {
  id: string;
  timestamp: Date;
  metric: string;
  component: string;
  timeWindow: string;
  trend: 'improving' | 'degrading' | 'stable';
  regressionRate: number; // percentage change
  confidence: number;
  predictedValue: number;
  actualValue: number;
  impactAssessment: {
    severity: 'low' | 'medium' | 'high' | 'critical';
    affectedUsers: number;
    estimatedLoss: string;
    timeToRevert: string;
  };
}

export interface QueryOptimizationSuggestion {
  id: string;
  timestamp: Date;
  queryHash: string;
  query: string;
  table: string;
  currentPerformance: {
    executionTime: number;
    ioOperations: number;
    cpuUsage: number;
  };
  optimizationStrategy: {
    type: 'index' | 'rewrite' | 'cache' | 'partition' | 'normalize';
    suggestion: string;
    estimatedImprovement: number;
    confidence: number;
    effort: 'low' | 'medium' | 'high';
  };
  sqlRecommendation?: string;
  indexSuggestion?: {
    table: string;
    columns: string[];
    type: 'btree' | 'hash' | 'gin' | 'gist';
  };
}

export interface PredictiveInsight {
  id: string;
  timestamp: Date;
  predictionType: 'load' | 'failure' | 'performance' | 'resource';
  timeHorizon: '1h' | '6h' | '24h' | '7d' | '30d';
  metric: string;
  component: string;
  currentValue: number;
  predictedValue: number;
  confidence: number;
  trend: 'increasing' | 'decreasing' | 'stable' | 'volatile';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendedActions: string[];
  thresholds: {
    warning: number;
    critical: number;
  };
}

export interface MLAlert {
  id: string;
  timestamp: Date;
  type: 'anomaly' | 'regression' | 'prediction' | 'optimization';
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  description: string;
  component: string;
  metric?: string;
  triggeredBy: {
    value: number;
    threshold: number;
    confidence: number;
  };
  actions: Array<{
    type: 'investigate' | 'optimize' | 'scale' | 'alert' | 'rollback';
    description: string;
    priority: number;
    automated: boolean;
  }>;
  relatedInsights: string[]; // IDs of related anomalies/predictions
}

// Statistical utilities for ML algorithms
class StatisticalAnalyzer {
  static calculateMovingAverage(data: number[], window: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < data.length; i++) {
      const start = Math.max(0, i - window + 1);
      const subset = data.slice(start, i + 1);
      const avg = subset.reduce((a, b) => a + b, 0) / subset.length;
      result.push(avg);
    }
    return result;
  }

  static calculateStandardDeviation(data: number[]): number {
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
    return Math.sqrt(variance);
  }

  static calculateZScore(value: number, mean: number, stdDev: number): number {
    return (value - mean) / stdDev;
  }

  static detectOutliers(data: number[], threshold: number = 2.5): number[] {
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const stdDev = this.calculateStandardDeviation(data);
    return data.filter(val => Math.abs(this.calculateZScore(val, mean, stdDev)) > threshold);
  }

  static exponentialSmoothing(data: number[], alpha: number = 0.3): number[] {
    const result = [data[0]];
    for (let i = 1; i < data.length; i++) {
      result.push(alpha * data[i] + (1 - alpha) * result[i - 1]);
    }
    return result;
  }

  static linearRegression(x: number[], y: number[]): { slope: number; intercept: number; rSquared: number } {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumYY = y.reduce((sum, yi) => sum + yi * yi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared
    const yMean = sumY / n;
    const ssRes = y.reduce((sum, yi, i) => sum + Math.pow(yi - (slope * x[i] + intercept), 2), 0);
    const ssTot = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
    const rSquared = 1 - (ssRes / ssTot);

    return { slope, intercept, rSquared };
  }
}

@Injectable()
export class MLAnalyticsService implements OnModuleInit {
  private readonly logger = new Logger(MLAnalyticsService.name);
  private readonly dataHistory = new Map<string, number[]>();
  private readonly anomalySubject = new BehaviorSubject<AnomalyDetection[]>([]);
  private readonly regressionSubject = new BehaviorSubject<RegressionAnalysis[]>([]);
  private readonly optimizationSubject = new BehaviorSubject<QueryOptimizationSuggestion[]>([]);
  private readonly predictionSubject = new BehaviorSubject<PredictiveInsight[]>([]);
  private readonly alertSubject = new BehaviorSubject<MLAlert[]>([]);

  // ML configuration
  private readonly config = {
    anomalyDetection: {
      zScoreThreshold: 2.5,
      windowSize: 50,
      minDataPoints: 10,
      confidenceThreshold: 0.7
    },
    regressionAnalysis: {
      windowSize: 100,
      rSquaredThreshold: 0.5,
      significantChangeThreshold: 0.1 // 10%
    },
    prediction: {
      smoothingFactor: 0.3,
      predictionHorizon: {
        short: 6, // 6 hours
        medium: 24, // 24 hours
        long: 168 // 7 days
      }
    }
  };

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly performanceCorrelationService: PerformanceCorrelationService
  ) {}

  async onModuleInit() {
    this.logger.log('ML Analytics Service initialized');
    this.startMLAnalysis();
  }

  private startMLAnalysis() {
    // Subscribe to analytics data and perform ML analysis
    this.analyticsService.getAnalyticsStream().subscribe(data => {
      this.updateDataHistory(data);
      this.performAnomalyDetection(data);
      this.performRegressionAnalysis(data);
      this.generatePredictiveInsights(data);
      this.analyzeQueryOptimizationOpportunities(data);
    });

    // Periodic analysis for deeper insights
    interval(300000).subscribe(() => { // Every 5 minutes
      this.performAdvancedAnalysis();
    });
  }

  private updateDataHistory(data: AnalyticsData) {
    const metrics = {
      'response_time': data.overview.averageResponseTime,
      'error_rate': data.overview.errorRate,
      'throughput': data.overview.throughput,
      'active_users': data.overview.activeUsers,
      'cpu_usage': data.performance.resourceUsage.cpu,
      'memory_usage': data.performance.resourceUsage.memory,
      'db_connections': data.database.connectionHealth.activeConnections
    };

    Object.entries(metrics).forEach(([metric, value]) => {
      if (!this.dataHistory.has(metric)) {
        this.dataHistory.set(metric, []);
      }
      const history = this.dataHistory.get(metric)!;
      history.push(value);
      
      // Keep only recent data
      if (history.length > 1000) {
        history.shift();
      }
    });
  }

  private performAnomalyDetection(data: AnalyticsData) {
    const anomalies: AnomalyDetection[] = [];

    this.dataHistory.forEach((history, metric) => {
      if (history.length < this.config.anomalyDetection.minDataPoints) {
        return;
      }

      const currentValue = history[history.length - 1];
      const recentHistory = history.slice(-this.config.anomalyDetection.windowSize);
      const mean = recentHistory.reduce((a, b) => a + b, 0) / recentHistory.length;
      const stdDev = StatisticalAnalyzer.calculateStandardDeviation(recentHistory);
      const zScore = StatisticalAnalyzer.calculateZScore(currentValue, mean, stdDev);

      if (Math.abs(zScore) > this.config.anomalyDetection.zScoreThreshold) {
        const anomaly: AnomalyDetection = {
          id: `anomaly_${Date.now()}_${metric}`,
          timestamp: new Date(),
          type: this.classifyAnomalyType(metric),
          severity: this.calculateAnomalySeverity(Math.abs(zScore)),
          component: this.getComponentFromMetric(metric),
          metric,
          value: currentValue,
          baseline: mean,
          deviation: Math.abs(currentValue - mean),
          confidence: Math.min(Math.abs(zScore) / 5, 1), // Normalize to 0-1
          description: this.generateAnomalyDescription(metric, currentValue, mean, zScore),
          suggestedActions: this.generateAnomalySuggestions(metric, zScore > 0)
        };

        anomalies.push(anomaly);
        this.logger.warn(`Anomaly detected: ${anomaly.description}`);
      }
    });

    if (anomalies.length > 0) {
      const currentAnomalies = this.anomalySubject.value;
      this.anomalySubject.next([...currentAnomalies, ...anomalies]);
      this.generateAlertsFromAnomalies(anomalies);
    }
  }

  private performRegressionAnalysis(data: AnalyticsData) {
    const regressions: RegressionAnalysis[] = [];

    this.dataHistory.forEach((history, metric) => {
      if (history.length < this.config.regressionAnalysis.windowSize) {
        return;
      }

      const recentHistory = history.slice(-this.config.regressionAnalysis.windowSize);
      const xValues = recentHistory.map((_, i) => i);
      const regression = StatisticalAnalyzer.linearRegression(xValues, recentHistory);

      if (regression.rSquared > this.config.regressionAnalysis.rSquaredThreshold) {
        const regressionRate = (regression.slope / recentHistory[0]) * 100; // Percentage change per time unit
        
        if (Math.abs(regressionRate) > this.config.regressionAnalysis.significantChangeThreshold * 100) {
          const analysis: RegressionAnalysis = {
            id: `regression_${Date.now()}_${metric}`,
            timestamp: new Date(),
            metric,
            component: this.getComponentFromMetric(metric),
            timeWindow: `${this.config.regressionAnalysis.windowSize} data points`,
            trend: regressionRate > 0 ? 'degrading' : 'improving',
            regressionRate,
            confidence: regression.rSquared,
            predictedValue: regression.slope * (recentHistory.length - 1) + regression.intercept,
            actualValue: recentHistory[recentHistory.length - 1],
            impactAssessment: this.assessRegressionImpact(metric, regressionRate)
          };

          regressions.push(analysis);
        }
      }
    });

    if (regressions.length > 0) {
      const currentRegressions = this.regressionSubject.value;
      this.regressionSubject.next([...currentRegressions, ...regressions]);
    }
  }

  private generatePredictiveInsights(data: AnalyticsData) {
    const insights: PredictiveInsight[] = [];

    this.dataHistory.forEach((history, metric) => {
      if (history.length < 50) return;

      // Use exponential smoothing for prediction
      const smoothed = StatisticalAnalyzer.exponentialSmoothing(history, this.config.prediction.smoothingFactor);
      const trend = this.calculateTrend(smoothed.slice(-20));

      // Generate short-term prediction (6 hours)
      const currentValue = history[history.length - 1];
      const recentTrend = smoothed[smoothed.length - 1] - smoothed[smoothed.length - 2];
      const predictedValue = currentValue + recentTrend * this.config.prediction.predictionHorizon.short;

      const insight: PredictiveInsight = {
        id: `prediction_${Date.now()}_${metric}`,
        timestamp: new Date(),
        predictionType: this.getPredictionType(metric),
        timeHorizon: '6h',
        metric,
        component: this.getComponentFromMetric(metric),
        currentValue,
        predictedValue,
        confidence: this.calculatePredictionConfidence(history),
        trend,
        riskLevel: this.assessPredictionRisk(metric, predictedValue, currentValue),
        recommendedActions: this.generatePredictionRecommendations(metric, trend, predictedValue),
        thresholds: this.getMetricThresholds(metric)
      };

      insights.push(insight);
    });

    if (insights.length > 0) {
      const currentInsights = this.predictionSubject.value;
      this.predictionSubject.next([...currentInsights, ...insights]);
    }
  }

  private analyzeQueryOptimizationOpportunities(data: AnalyticsData) {
    // This would analyze slow queries and suggest optimizations
    const suggestions: QueryOptimizationSuggestion[] = [];

    data.database.slowQueries.forEach(query => {
      if (query.executionTime > 1000) { // Queries taking more than 1 second
        const suggestion: QueryOptimizationSuggestion = {
          id: `optimization_${Date.now()}_${query.queryHash}`,
          timestamp: new Date(),
          queryHash: query.queryHash,
          query: query.sql,
          table: query.table,
          currentPerformance: {
            executionTime: query.executionTime,
            ioOperations: query.rowsExamined || 0,
            cpuUsage: 0 // Would be calculated from actual metrics
          },
          optimizationStrategy: this.suggestOptimizationStrategy(query)
        };

        suggestions.push(suggestion);
      }
    });

    if (suggestions.length > 0) {
      const currentSuggestions = this.optimizationSubject.value;
      this.optimizationSubject.next([...currentSuggestions, ...suggestions]);
    }
  }

  private performAdvancedAnalysis() {
    // Perform cross-metric correlation analysis
    // This would identify patterns across different metrics
    this.logger.debug('Performing advanced ML analysis...');
  }

  // Helper methods
  private classifyAnomalyType(metric: string): AnomalyDetection['type'] {
    if (metric.includes('response_time') || metric.includes('cpu') || metric.includes('memory')) {
      return 'performance';
    }
    if (metric.includes('error')) return 'error';
    if (metric.includes('throughput') || metric.includes('users')) return 'traffic';
    if (metric.includes('cpu') || metric.includes('memory') || metric.includes('connections')) {
      return 'resource';
    }
    return 'performance';
  }

  private calculateAnomalySeverity(zScore: number): AnomalyDetection['severity'] {
    if (zScore > 4) return 'critical';
    if (zScore > 3) return 'high';
    if (zScore > 2.5) return 'medium';
    return 'low';
  }

  private getComponentFromMetric(metric: string): string {
    if (metric.includes('db') || metric.includes('query')) return 'database';
    if (metric.includes('cache')) return 'cache';
    if (metric.includes('response') || metric.includes('throughput')) return 'application';
    if (metric.includes('memory') || metric.includes('cpu')) return 'system';
    return 'unknown';
  }

  private generateAnomalyDescription(metric: string, value: number, baseline: number, zScore: number): string {
    const direction = zScore > 0 ? 'increased' : 'decreased';
    const percentage = Math.abs(((value - baseline) / baseline) * 100).toFixed(1);
    return `${metric} has ${direction} by ${percentage}% (current: ${value.toFixed(2)}, baseline: ${baseline.toFixed(2)})`;
  }

  private generateAnomalySuggestions(metric: string, isIncrease: boolean): string[] {
    const suggestions = [];
    
    if (metric.includes('response_time') && isIncrease) {
      suggestions.push('Check for slow database queries', 'Review recent deployments', 'Monitor CPU and memory usage');
    } else if (metric.includes('error_rate') && isIncrease) {
      suggestions.push('Check application logs', 'Review recent code changes', 'Verify external service availability');
    } else if (metric.includes('memory') && isIncrease) {
      suggestions.push('Check for memory leaks', 'Review garbage collection settings', 'Monitor application memory usage');
    }

    return suggestions.length > 0 ? suggestions : ['Investigate the root cause', 'Monitor closely'];
  }

  private assessRegressionImpact(metric: string, regressionRate: number): RegressionAnalysis['impactAssessment'] {
    const severity = Math.abs(regressionRate) > 50 ? 'critical' : 
                    Math.abs(regressionRate) > 25 ? 'high' : 
                    Math.abs(regressionRate) > 10 ? 'medium' : 'low';

    return {
      severity,
      affectedUsers: this.estimateAffectedUsers(metric, regressionRate),
      estimatedLoss: this.estimateLoss(metric, regressionRate),
      timeToRevert: this.estimateRevertTime(severity)
    };
  }

  private calculateTrend(data: number[]): PredictiveInsight['trend'] {
    const regression = StatisticalAnalyzer.linearRegression(
      data.map((_, i) => i),
      data
    );

    if (Math.abs(regression.slope) < 0.01) return 'stable';
    if (regression.slope > 0.1) return 'increasing';
    if (regression.slope < -0.1) return 'decreasing';
    return 'volatile';
  }

  private calculatePredictionConfidence(history: number[]): number {
    // Calculate confidence based on data consistency and trend stability
    const recentData = history.slice(-20);
    const stdDev = StatisticalAnalyzer.calculateStandardDeviation(recentData);
    const mean = recentData.reduce((a, b) => a + b, 0) / recentData.length;
    const coefficientOfVariation = stdDev / Math.abs(mean);
    
    // Lower coefficient of variation = higher confidence
    return Math.max(0, 1 - coefficientOfVariation);
  }

  private getPredictionType(metric: string): PredictiveInsight['predictionType'] {
    if (metric.includes('throughput') || metric.includes('users')) return 'load';
    if (metric.includes('error')) return 'failure';
    if (metric.includes('response_time') || metric.includes('cpu')) return 'performance';
    return 'resource';
  }

  private assessPredictionRisk(metric: string, predicted: number, current: number): PredictiveInsight['riskLevel'] {
    const change = Math.abs((predicted - current) / current);
    if (change > 0.5) return 'critical';
    if (change > 0.3) return 'high';
    if (change > 0.1) return 'medium';
    return 'low';
  }

  private generatePredictionRecommendations(metric: string, trend: string, predictedValue: number): string[] {
    const recommendations = [];
    
    if (trend === 'increasing' && metric.includes('response_time')) {
      recommendations.push('Consider scaling infrastructure', 'Optimize database queries', 'Review caching strategy');
    } else if (trend === 'increasing' && metric.includes('error_rate')) {
      recommendations.push('Investigate error patterns', 'Enhance error handling', 'Monitor dependencies');
    }
    
    return recommendations.length > 0 ? recommendations : ['Monitor closely', 'Review system health'];
  }

  private getMetricThresholds(metric: string): { warning: number; critical: number } {
    // Define thresholds based on metric type
    if (metric.includes('response_time')) return { warning: 500, critical: 1000 };
    if (metric.includes('error_rate')) return { warning: 0.01, critical: 0.05 };
    if (metric.includes('cpu')) return { warning: 0.7, critical: 0.9 };
    if (metric.includes('memory')) return { warning: 0.8, critical: 0.95 };
    
    return { warning: 100, critical: 200 };
  }

  private suggestOptimizationStrategy(query: any): QueryOptimizationSuggestion['optimizationStrategy'] {
    // Analyze query patterns and suggest optimizations
    let type: 'index' | 'rewrite' | 'cache' | 'partition' | 'normalize' = 'index';
    let suggestion = 'Consider adding an index';
    let estimatedImprovement = 30;
    let confidence = 0.7;
    let effort: 'low' | 'medium' | 'high' = 'low';

    if (query.sql?.includes('SELECT *')) {
      type = 'rewrite';
      suggestion = 'Select only required columns instead of using SELECT *';
      estimatedImprovement = 20;
      effort = 'low';
    } else if (query.sql?.includes('ORDER BY') && !query.sql?.includes('INDEX')) {
      type = 'index';
      suggestion = 'Add an index on the ORDER BY column';
      estimatedImprovement = 50;
    } else if (query.executionTime > 5000) {
      type = 'cache';
      suggestion = 'Consider caching this query result';
      estimatedImprovement = 80;
      effort = 'medium';
    }

    return { type, suggestion, estimatedImprovement, confidence, effort };
  }

  private generateAlertsFromAnomalies(anomalies: AnomalyDetection[]) {
    const alerts: MLAlert[] = anomalies
      .filter(anomaly => anomaly.severity === 'high' || anomaly.severity === 'critical')
      .map(anomaly => ({
        id: `alert_${Date.now()}_${anomaly.id}`,
        timestamp: new Date(),
        type: 'anomaly' as const,
        severity: anomaly.severity === 'critical' ? 'critical' as const : 'error' as const,
        title: `Anomaly Detected: ${anomaly.metric}`,
        description: anomaly.description,
        component: anomaly.component,
        metric: anomaly.metric,
        triggeredBy: {
          value: anomaly.value,
          threshold: anomaly.baseline,
          confidence: anomaly.confidence
        },
        actions: [
          {
            type: 'investigate' as const,
            description: 'Investigate root cause of anomaly',
            priority: 1,
            automated: false
          },
          ...(anomaly.severity === 'critical' ? [{
            type: 'alert' as const,
            description: 'Notify on-call engineer',
            priority: 0,
            automated: true
          }] : [])
        ],
        relatedInsights: []
      }));

    if (alerts.length > 0) {
      const currentAlerts = this.alertSubject.value;
      this.alertSubject.next([...currentAlerts, ...alerts]);
    }
  }

  // Estimation helper methods
  private estimateAffectedUsers(metric: string, regressionRate: number): number {
    // Simplified estimation - would use actual user metrics in practice
    if (metric.includes('response_time')) {
      return Math.floor(Math.abs(regressionRate) * 100);
    }
    return Math.floor(Math.abs(regressionRate) * 50);
  }

  private estimateLoss(metric: string, regressionRate: number): string {
    // Simplified loss estimation
    const impact = Math.abs(regressionRate);
    if (impact > 50) return 'High - Significant user impact';
    if (impact > 25) return 'Medium - Noticeable degradation';
    return 'Low - Minor impact';
  }

  private estimateRevertTime(severity: RegressionAnalysis['impactAssessment']['severity']): string {
    switch (severity) {
      case 'critical': return '< 1 hour';
      case 'high': return '< 4 hours';
      case 'medium': return '< 24 hours';
      default: return '< 7 days';
    }
  }

  // Public API methods
  getAnomalies(): Observable<AnomalyDetection[]> {
    return this.anomalySubject.asObservable();
  }

  getRegressionAnalysis(): Observable<RegressionAnalysis[]> {
    return this.regressionSubject.asObservable();
  }

  getOptimizationSuggestions(): Observable<QueryOptimizationSuggestion[]> {
    return this.optimizationSubject.asObservable();
  }

  getPredictiveInsights(): Observable<PredictiveInsight[]> {
    return this.predictionSubject.asObservable();
  }

  getMLAlerts(): Observable<MLAlert[]> {
    return this.alertSubject.asObservable();
  }

  // Get current state (non-observable)
  getCurrentAnomalies(): AnomalyDetection[] {
    return this.anomalySubject.value;
  }

  getCurrentRegressions(): RegressionAnalysis[] {
    return this.regressionSubject.value;
  }

  getCurrentOptimizations(): QueryOptimizationSuggestion[] {
    return this.optimizationSubject.value;
  }

  getCurrentPredictions(): PredictiveInsight[] {
    return this.predictionSubject.value;
  }

  getCurrentAlerts(): MLAlert[] {
    return this.alertSubject.value;
  }

  // Administrative methods
  acknowledgeAlert(alertId: string): boolean {
    const currentAlerts = this.alertSubject.value;
    const updatedAlerts = currentAlerts.filter(alert => alert.id !== alertId);
    this.alertSubject.next(updatedAlerts);
    return currentAlerts.length !== updatedAlerts.length;
  }

  dismissAnomaly(anomalyId: string): boolean {
    const currentAnomalies = this.anomalySubject.value;
    const updatedAnomalies = currentAnomalies.filter(anomaly => anomaly.id !== anomalyId);
    this.anomalySubject.next(updatedAnomalies);
    return currentAnomalies.length !== updatedAnomalies.length;
  }

  getMLMetrics() {
    return {
      anomaliesDetected: this.anomalySubject.value.length,
      regressionsAnalyzed: this.regressionSubject.value.length,
      optimizationSuggestions: this.optimizationSubject.value.length,
      predictiveInsights: this.predictionSubject.value.length,
      activeAlerts: this.alertSubject.value.length,
      dataHistorySize: Array.from(this.dataHistory.values()).reduce((sum, arr) => sum + arr.length, 0)
    };
  }
}
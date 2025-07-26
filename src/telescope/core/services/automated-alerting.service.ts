import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, interval, Subscription, combineLatest } from 'rxjs';
import { filter, debounceTime, distinctUntilChanged, map } from 'rxjs/operators';
import { MLAnalyticsService, MLAlert, AnomalyDetection, RegressionAnalysis, PredictiveInsight } from './ml-analytics.service';
import { AnalyticsService } from './analytics.service';

export interface AlertChannel {
  id: string;
  name: string;
  type: 'email' | 'slack' | 'teams' | 'webhook' | 'sms' | 'pagerduty';
  enabled: boolean;
  config: {
    url?: string;
    token?: string;
    email?: string;
    phone?: string;
    [key: string]: any;
  };
  severityFilter: ('info' | 'warning' | 'error' | 'critical')[];
  componentFilter?: string[];
  rateLimit?: {
    maxAlerts: number;
    timeWindow: number; // minutes
  };
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  conditions: {
    metric: string;
    operator: '>' | '<' | '==' | '!=' | '>=' | '<=';
    threshold: number;
    duration?: number; // minutes
    component?: string;
  }[];
  actions: {
    channelIds: string[];
    escalation?: {
      delayMinutes: number;
      channels: string[];
    };
    autoRemediation?: {
      enabled: boolean;
      actions: Array<{
        type: 'restart' | 'scale' | 'rollback' | 'cache_clear';
        config: any;
      }>;
    };
  };
  schedule?: {
    timezone: string;
    activeHours: {
      start: string; // HH:mm
      end: string;   // HH:mm
    };
    activeDays: number[]; // 0-6, Sunday = 0
  };
}

export interface AlertHistory {
  id: string;
  alertId: string;
  ruleId?: string;
  timestamp: Date;
  status: 'sent' | 'failed' | 'acknowledged' | 'resolved';
  channel: string;
  recipient?: string;
  retryCount: number;
  error?: string;
  responseTime?: number;
}

export interface AlertAggregation {
  id: string;
  timestamp: Date;
  timeWindow: number; // minutes
  component: string;
  alertCount: number;
  severity: 'info' | 'warning' | 'error' | 'critical';
  types: string[];
  summary: string;
  consolidatedAlert: MLAlert;
}

export interface AlertMetrics {
  totalAlerts: number;
  alertsByseverity: Record<string, number>;
  alertsByComponent: Record<string, number>;
  alertsByChannel: Record<string, number>;
  averageResponseTime: number;
  successRate: number;
  escalationRate: number;
  acknowledgedRate: number;
  falsePositiveRate: number;
}

@Injectable()
export class AutomatedAlertingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomatedAlertingService.name);
  private subscriptions: Subscription[] = [];
  
  // Alert state management
  private alertChannels = new Map<string, AlertChannel>();
  private alertRules = new Map<string, AlertRule>();
  private alertHistory: AlertHistory[] = [];
  private rateLimitTracker = new Map<string, { count: number; resetTime: number }>();
  
  // Subjects for observables
  private readonly alertHistorySubject = new Subject<AlertHistory>();
  private readonly aggregationSubject = new Subject<AlertAggregation>();
  
  // Configuration
  private readonly config = {
    aggregationWindow: 5, // minutes
    maxHistorySize: 10000,
    defaultRateLimit: { maxAlerts: 10, timeWindow: 60 }, // 10 alerts per hour
    escalationDelay: 30, // minutes
    autoAcknowledgeTimeout: 24 * 60, // 24 hours
    retryAttempts: 3,
    retryDelay: 300 // 5 minutes
  };

  constructor(
    private readonly mlAnalyticsService: MLAnalyticsService,
    private readonly analyticsService: AnalyticsService
  ) {
    this.initializeDefaultChannels();
    this.initializeDefaultRules();
  }

  async onModuleInit() {
    this.logger.log('Automated Alerting Service initialized');
    this.startAlertProcessing();
  }

  onModuleDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private initializeDefaultChannels() {
    // Default webhook channel for development
    this.alertChannels.set('default-webhook', {
      id: 'default-webhook',
      name: 'Default Webhook',
      type: 'webhook',
      enabled: true,
      config: {
        url: 'http://localhost:3000/telescope/webhook/alerts'
      },
      severityFilter: ['warning', 'error', 'critical']
    });

    // Console logging channel for development
    this.alertChannels.set('console-log', {
      id: 'console-log',
      name: 'Console Logger',
      type: 'webhook', // We'll treat it as a special webhook
      enabled: true,
      config: {
        url: 'console'
      },
      severityFilter: ['info', 'warning', 'error', 'critical']
    });
  }

  private initializeDefaultRules() {
    // Critical performance degradation
    this.alertRules.set('critical-performance', {
      id: 'critical-performance',
      name: 'Critical Performance Degradation',
      description: 'Alert when response time increases significantly',
      enabled: true,
      priority: 1,
      conditions: [
        {
          metric: 'response_time',
          operator: '>',
          threshold: 2000, // 2 seconds
          duration: 5,
          component: 'application'
        }
      ],
      actions: {
        channelIds: ['default-webhook', 'console-log'],
        escalation: {
          delayMinutes: 15,
          channels: ['default-webhook']
        }
      }
    });

    // High error rate
    this.alertRules.set('high-error-rate', {
      id: 'high-error-rate',
      name: 'High Error Rate',
      description: 'Alert when error rate exceeds threshold',
      enabled: true,
      priority: 2,
      conditions: [
        {
          metric: 'error_rate',
          operator: '>',
          threshold: 0.05, // 5%
          duration: 3
        }
      ],
      actions: {
        channelIds: ['default-webhook', 'console-log']
      }
    });

    // Resource exhaustion
    this.alertRules.set('resource-exhaustion', {
      id: 'resource-exhaustion',
      name: 'Resource Exhaustion Warning',
      description: 'Alert when system resources are running low',
      enabled: true,
      priority: 3,
      conditions: [
        {
          metric: 'memory_usage',
          operator: '>',
          threshold: 0.9, // 90%
          duration: 2,
          component: 'system'
        }
      ],
      actions: {
        channelIds: ['console-log']
      }
    });
  }

  private startAlertProcessing() {
    // Process ML alerts
    const mlAlertSub = this.mlAnalyticsService.getMLAlerts()
      .pipe(debounceTime(1000)) // Debounce to avoid spam
      .subscribe(alerts => {
        alerts.forEach(alert => this.processAlert(alert));
      });

    // Process anomalies
    const anomalySub = this.mlAnalyticsService.getAnomalies()
      .pipe(
        distinctUntilChanged((prev, curr) => prev.length === curr.length),
        debounceTime(2000)
      )
      .subscribe(anomalies => {
        const newAnomalies = anomalies.slice(-10); // Process last 10
        newAnomalies.forEach(anomaly => this.processAnomalyAlert(anomaly));
      });

    // Process regression analysis
    const regressionSub = this.mlAnalyticsService.getRegressionAnalysis()
      .pipe(
        distinctUntilChanged((prev, curr) => prev.length === curr.length),
        debounceTime(2000)
      )
      .subscribe(regressions => {
        const newRegressions = regressions.slice(-5); // Process last 5
        newRegressions.forEach(regression => this.processRegressionAlert(regression));
      });

    // Process predictive insights
    const predictionSub = this.mlAnalyticsService.getPredictiveInsights()
      .pipe(
        filter(insights => insights.some(i => i.riskLevel === 'high' || i.riskLevel === 'critical')),
        debounceTime(5000)
      )
      .subscribe(insights => {
        const highRiskInsights = insights.filter(i => i.riskLevel === 'high' || i.riskLevel === 'critical');
        highRiskInsights.forEach(insight => this.processPredictiveAlert(insight));
      });

    // Periodic cleanup and aggregation
    const cleanupSub = interval(300000).subscribe(() => { // Every 5 minutes
      this.cleanupOldHistory();
      this.processAlertAggregation();
      this.autoAcknowledgeOldAlerts();
    });

    this.subscriptions.push(mlAlertSub, anomalySub, regressionSub, predictionSub, cleanupSub);
  }

  private async processAlert(alert: MLAlert) {
    this.logger.debug(`Processing alert: ${alert.title}`);

    // Check if alert should be rate limited
    if (this.isRateLimited(alert)) {
      this.logger.warn(`Alert rate limited: ${alert.id}`);
      return;
    }

    // Find matching rules
    const matchingRules = this.findMatchingRules(alert);
    
    for (const rule of matchingRules) {
      await this.executeAlertRule(alert, rule);
    }

    // If no specific rules matched, use default behavior
    if (matchingRules.length === 0) {
      await this.executeDefaultAlert(alert);
    }
  }

  private async processAnomalyAlert(anomaly: AnomalyDetection) {
    if (anomaly.severity === 'low') return; // Skip low severity anomalies

    const alert: MLAlert = {
      id: `anomaly_alert_${anomaly.id}`,
      timestamp: new Date(),
      type: 'anomaly',
      severity: anomaly.severity === 'critical' ? 'critical' : 
               anomaly.severity === 'high' ? 'error' : 'warning',
      title: `Anomaly Detected: ${anomaly.metric}`,
      description: anomaly.description,
      component: anomaly.component,
      metric: anomaly.metric,
      triggeredBy: {
        value: anomaly.value,
        threshold: anomaly.baseline,
        confidence: anomaly.confidence
      },
      actions: anomaly.suggestedActions.map((action, index) => ({
        type: 'investigate' as const,
        description: action,
        priority: index,
        automated: false
      })),
      relatedInsights: []
    };

    await this.processAlert(alert);
  }

  private async processRegressionAlert(regression: RegressionAnalysis) {
    if (regression.trend !== 'degrading' || regression.impactAssessment.severity === 'low') {
      return;
    }

    const alert: MLAlert = {
      id: `regression_alert_${regression.id}`,
      timestamp: new Date(),
      type: 'regression',
      severity: regression.impactAssessment.severity === 'critical' ? 'critical' : 'warning',
      title: `Performance Regression: ${regression.metric}`,
      description: `${regression.metric} has been degrading at ${regression.regressionRate.toFixed(2)}% rate`,
      component: regression.component,
      metric: regression.metric,
      triggeredBy: {
        value: regression.actualValue,
        threshold: regression.predictedValue,
        confidence: regression.confidence
      },
      actions: [{
        type: 'investigate',
        description: 'Investigate performance regression',
        priority: 1,
        automated: false
      }],
      relatedInsights: []
    };

    await this.processAlert(alert);
  }

  private async processPredictiveAlert(insight: PredictiveInsight) {
    const alert: MLAlert = {
      id: `prediction_alert_${insight.id}`,
      timestamp: new Date(),
      type: 'prediction',
      severity: insight.riskLevel === 'critical' ? 'critical' : 'warning',
      title: `Predictive Alert: ${insight.metric}`,
      description: `Predicted ${insight.trend} trend for ${insight.metric} (${insight.timeHorizon})`,
      component: insight.component,
      metric: insight.metric,
      triggeredBy: {
        value: insight.predictedValue,
        threshold: insight.thresholds.warning,
        confidence: insight.confidence
      },
      actions: insight.recommendedActions.map((action, index) => ({
        type: 'investigate' as const,
        description: action,
        priority: index,
        automated: false
      })),
      relatedInsights: []
    };

    await this.processAlert(alert);
  }

  private findMatchingRules(alert: MLAlert): AlertRule[] {
    return Array.from(this.alertRules.values()).filter(rule => {
      if (!rule.enabled) return false;
      
      // Check conditions
      return rule.conditions.some(condition => {
        if (condition.component && condition.component !== alert.component) {
          return false;
        }
        
        if (condition.metric && condition.metric !== alert.metric) {
          return false;
        }

        // Check threshold conditions
        switch (condition.operator) {
          case '>':
            return alert.triggeredBy.value > condition.threshold;
          case '<':
            return alert.triggeredBy.value < condition.threshold;
          case '>=':
            return alert.triggeredBy.value >= condition.threshold;
          case '<=':
            return alert.triggeredBy.value <= condition.threshold;
          case '==':
            return alert.triggeredBy.value === condition.threshold;
          case '!=':
            return alert.triggeredBy.value !== condition.threshold;
          default:
            return false;
        }
      });
    });
  }

  private async executeAlertRule(alert: MLAlert, rule: AlertRule) {
    this.logger.debug(`Executing alert rule: ${rule.name} for alert: ${alert.title}`);

    // Check schedule constraints
    if (!this.isWithinSchedule(rule)) {
      this.logger.debug(`Alert rule ${rule.name} is outside active schedule`);
      return;
    }

    // Send to configured channels
    for (const channelId of rule.actions.channelIds) {
      const channel = this.alertChannels.get(channelId);
      if (channel && channel.enabled) {
        await this.sendAlert(alert, channel, rule);
      }
    }

    // Schedule escalation if configured
    if (rule.actions.escalation) {
      setTimeout(() => {
        this.escalateAlert(alert, rule);
      }, rule.actions.escalation.delayMinutes * 60 * 1000);
    }

    // Execute auto-remediation if enabled
    if (rule.actions.autoRemediation?.enabled) {
      this.executeAutoRemediation(alert, rule.actions.autoRemediation.actions);
    }
  }

  private async executeDefaultAlert(alert: MLAlert) {
    // Default behavior: send to console log channel
    const defaultChannel = this.alertChannels.get('console-log');
    if (defaultChannel) {
      await this.sendAlert(alert, defaultChannel);
    }
  }

  private async sendAlert(alert: MLAlert, channel: AlertChannel, rule?: AlertRule) {
    const historyEntry: AlertHistory = {
      id: `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      alertId: alert.id,
      ruleId: rule?.id,
      timestamp: new Date(),
      status: 'sent',
      channel: channel.name,
      retryCount: 0
    };

    try {
      const startTime = Date.now();
      
      switch (channel.type) {
        case 'webhook':
          await this.sendWebhookAlert(alert, channel);
          break;
        case 'email':
          await this.sendEmailAlert(alert, channel);
          break;
        case 'slack':
          await this.sendSlackAlert(alert, channel);
          break;
        default:
          throw new Error(`Unsupported channel type: ${channel.type}`);
      }

      historyEntry.status = 'sent';
      historyEntry.responseTime = Date.now() - startTime;
      this.logger.log(`Alert sent successfully: ${alert.title} via ${channel.name}`);

    } catch (error) {
      historyEntry.status = 'failed';
      historyEntry.error = error.message;
      this.logger.error(`Failed to send alert: ${error.message}`, error.stack);

      // Schedule retry if within retry limits
      if (historyEntry.retryCount < this.config.retryAttempts) {
        setTimeout(() => {
          this.retryAlert(alert, channel, historyEntry);
        }, this.config.retryDelay * 1000);
      }
    }

    this.alertHistory.push(historyEntry);
    this.alertHistorySubject.next(historyEntry);
  }

  private async sendWebhookAlert(alert: MLAlert, channel: AlertChannel) {
    if (channel.config.url === 'console') {
      // Special console logging
      console.log(`🚨 TELESCOPE ALERT [${alert.severity.toUpperCase()}] ${alert.title}`);
      console.log(`   Component: ${alert.component}`);
      console.log(`   Description: ${alert.description}`);
      console.log(`   Timestamp: ${alert.timestamp.toISOString()}`);
      if (alert.metric) {
        console.log(`   Metric: ${alert.metric} = ${alert.triggeredBy.value}`);
      }
      console.log('   Suggested Actions:');
      alert.actions.forEach(action => {
        console.log(`   - ${action.description}`);
      });
      console.log('---');
      return;
    }

    // Actual webhook implementation would go here
    const payload = {
      alert_id: alert.id,
      timestamp: alert.timestamp,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      description: alert.description,
      component: alert.component,
      metric: alert.metric,
      triggered_by: alert.triggeredBy,
      actions: alert.actions
    };

    // In a real implementation, you would use fetch or axios
    this.logger.debug(`Would send webhook to: ${channel.config.url}`, payload);
  }

  private async sendEmailAlert(alert: MLAlert, channel: AlertChannel) {
    // Email implementation would go here
    this.logger.debug(`Would send email alert to: ${channel.config.email}`);
  }

  private async sendSlackAlert(alert: MLAlert, channel: AlertChannel) {
    // Slack implementation would go here
    this.logger.debug(`Would send Slack alert to: ${channel.config.url}`);
  }

  private async retryAlert(alert: MLAlert, channel: AlertChannel, historyEntry: AlertHistory) {
    historyEntry.retryCount++;
    historyEntry.timestamp = new Date();
    
    try {
      await this.sendAlert(alert, channel);
    } catch (error) {
      this.logger.error(`Retry ${historyEntry.retryCount} failed for alert ${alert.id}: ${error.message}`);
    }
  }

  private escalateAlert(alert: MLAlert, rule: AlertRule) {
    if (!rule.actions.escalation) return;

    this.logger.warn(`Escalating alert: ${alert.title}`);

    // Send to escalation channels
    rule.actions.escalation.channels.forEach(channelId => {
      const channel = this.alertChannels.get(channelId);
      if (channel && channel.enabled) {
        this.sendAlert(alert, channel, rule);
      }
    });
  }

  private executeAutoRemediation(alert: MLAlert, actions: any[]) {
    this.logger.warn(`Auto-remediation triggered for alert: ${alert.title}`);
    
    actions.forEach(action => {
      switch (action.type) {
        case 'restart':
          this.logger.log(`Would restart ${action.config.service}`);
          break;
        case 'scale':
          this.logger.log(`Would scale ${action.config.service} to ${action.config.replicas} replicas`);
          break;
        case 'cache_clear':
          this.logger.log(`Would clear cache for ${action.config.keys || 'all keys'}`);
          break;
        default:
          this.logger.warn(`Unknown auto-remediation action: ${action.type}`);
      }
    });
  }

  private isRateLimited(alert: MLAlert): boolean {
    const key = `${alert.component}_${alert.type}`;
    const now = Date.now();
    const tracker = this.rateLimitTracker.get(key);

    if (!tracker || now > tracker.resetTime) {
      this.rateLimitTracker.set(key, {
        count: 1,
        resetTime: now + (this.config.defaultRateLimit.timeWindow * 60 * 1000)
      });
      return false;
    }

    if (tracker.count >= this.config.defaultRateLimit.maxAlerts) {
      return true;
    }

    tracker.count++;
    return false;
  }

  private isWithinSchedule(rule: AlertRule): boolean {
    if (!rule.schedule) return true;

    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;

    // Check active days
    if (!rule.schedule.activeDays.includes(currentDay)) {
      return false;
    }

    // Check active hours
    const startTime = this.parseTime(rule.schedule.activeHours.start);
    const endTime = this.parseTime(rule.schedule.activeHours.end);

    return currentTime >= startTime && currentTime <= endTime;
  }

  private parseTime(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private cleanupOldHistory() {
    if (this.alertHistory.length > this.config.maxHistorySize) {
      const excess = this.alertHistory.length - this.config.maxHistorySize;
      this.alertHistory.splice(0, excess);
      this.logger.debug(`Cleaned up ${excess} old alert history entries`);
    }
  }

  private processAlertAggregation() {
    // Group recent alerts for aggregation
    const recentAlerts = this.alertHistory.filter(
      h => Date.now() - h.timestamp.getTime() < this.config.aggregationWindow * 60 * 1000
    );

    // Implementation would aggregate similar alerts
    this.logger.debug(`Processing aggregation for ${recentAlerts.length} recent alerts`);
  }

  private autoAcknowledgeOldAlerts() {
    const cutoffTime = Date.now() - (this.config.autoAcknowledgeTimeout * 60 * 1000);
    const oldAlerts = this.alertHistory.filter(
      h => h.timestamp.getTime() < cutoffTime && h.status === 'sent'
    );

    oldAlerts.forEach(alert => {
      alert.status = 'acknowledged';
    });

    if (oldAlerts.length > 0) {
      this.logger.debug(`Auto-acknowledged ${oldAlerts.length} old alerts`);
    }
  }

  // Public API methods
  addAlertChannel(channel: AlertChannel): void {
    this.alertChannels.set(channel.id, channel);
    this.logger.log(`Added alert channel: ${channel.name}`);
  }

  removeAlertChannel(channelId: string): boolean {
    const removed = this.alertChannels.delete(channelId);
    if (removed) {
      this.logger.log(`Removed alert channel: ${channelId}`);
    }
    return removed;
  }

  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    this.logger.log(`Added alert rule: ${rule.name}`);
  }

  removeAlertRule(ruleId: string): boolean {
    const removed = this.alertRules.delete(ruleId);
    if (removed) {
      this.logger.log(`Removed alert rule: ${ruleId}`);
    }
    return removed;
  }

  getAlertChannels(): AlertChannel[] {
    return Array.from(this.alertChannels.values());
  }

  getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  getAlertHistory(limit: number = 100): AlertHistory[] {
    return this.alertHistory.slice(-limit);
  }

  getAlertHistoryStream(): Observable<AlertHistory> {
    return this.alertHistorySubject.asObservable();
  }

  acknowledgeAlert(alertId: string): boolean {
    const historyEntry = this.alertHistory.find(h => h.alertId === alertId);
    if (historyEntry && historyEntry.status === 'sent') {
      historyEntry.status = 'acknowledged';
      this.logger.log(`Alert acknowledged: ${alertId}`);
      return true;
    }
    return false;
  }

  getAlertMetrics(): AlertMetrics {
    const recentHistory = this.alertHistory.filter(
      h => Date.now() - h.timestamp.getTime() < 24 * 60 * 60 * 1000 // Last 24 hours
    );

    const totalAlerts = recentHistory.length;
    const successfulAlerts = recentHistory.filter(h => h.status === 'sent').length;
    const escalatedAlerts = recentHistory.filter(h => h.channel.includes('escalation')).length;
    const acknowledgedAlerts = recentHistory.filter(h => h.status === 'acknowledged').length;

    const alertsByChannel: Record<string, number> = {};
    recentHistory.forEach(h => {
      alertsByChannel[h.channel] = (alertsByChannel[h.channel] || 0) + 1;
    });

    const responseTimes = recentHistory
      .filter(h => h.responseTime)
      .map(h => h.responseTime!);

    return {
      totalAlerts,
      alertsByChannel,
      alertsByComponent: {}, // Would be implemented based on alert data
      alertsBySeverity: {}, // Would be implemented based on alert data
      averageResponseTime: responseTimes.length > 0 ? 
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0,
      successRate: totalAlerts > 0 ? successfulAlerts / totalAlerts : 1,
      escalationRate: totalAlerts > 0 ? escalatedAlerts / totalAlerts : 0,
      acknowledgedRate: totalAlerts > 0 ? acknowledgedAlerts / totalAlerts : 0,
      falsePositiveRate: 0 // Would require manual flagging or feedback mechanism
    };
  }

  testAlertChannel(channelId: string): Promise<boolean> {
    const channel = this.alertChannels.get(channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    const testAlert: MLAlert = {
      id: `test_${Date.now()}`,
      timestamp: new Date(),
      type: 'anomaly',
      severity: 'info',
      title: 'Test Alert',
      description: 'This is a test alert to verify channel configuration',
      component: 'test',
      triggeredBy: { value: 100, threshold: 90, confidence: 1 },
      actions: [{ type: 'investigate', description: 'Test action', priority: 1, automated: false }],
      relatedInsights: []
    };

    return this.sendAlert(testAlert, channel).then(() => true).catch(() => false);
  }
}
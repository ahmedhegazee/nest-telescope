import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBody } from '@nestjs/swagger';

// Import Week 8 ML services
import {
  MLAnalyticsService,
  AnomalyDetection,
  RegressionAnalysis,
  QueryOptimizationSuggestion,
  PredictiveInsight,
  MLAlert,
} from '../../core/services/ml-analytics.service';
import {
  AutomatedAlertingService,
  AlertChannel,
  AlertRule,
  AlertHistory,
  AlertMetrics,
} from '../../core/services/automated-alerting.service';

// DTOs for request/response
export class AnomalyQueryDto {
  component?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  type?: 'performance' | 'error' | 'traffic' | 'resource' | 'query';
  limit?: number = 50;
  from?: Date;
  to?: Date;
}

export class AlertChannelDto {
  name: string;
  type: 'email' | 'slack' | 'teams' | 'webhook' | 'sms' | 'pagerduty';
  enabled?: boolean = true;
  config: {
    url?: string;
    token?: string;
    email?: string;
    phone?: string;
    [key: string]: any;
  };
  severityFilter?: ('info' | 'warning' | 'error' | 'critical')[] = ['warning', 'error', 'critical'];
  componentFilter?: string[];
  rateLimit?: {
    maxAlerts: number;
    timeWindow: number;
  };
}

export class AlertRuleDto {
  name: string;
  description: string;
  enabled?: boolean = true;
  priority?: number = 5;
  conditions: Array<{
    metric: string;
    operator: '>' | '<' | '==' | '!=' | '>=' | '<=';
    threshold: number;
    duration?: number;
    component?: string;
  }>;
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
      start: string;
      end: string;
    };
    activeDays: number[];
  };
}

export class MLInsightSummary {
  timestamp: Date;
  anomaliesCount: number;
  regressionsCount: number;
  optimizationsCount: number;
  predictionsCount: number;
  alertsCount: number;
  healthScore: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  topConcerns: Array<{
    type: string;
    component: string;
    severity: string;
    description: string;
  }>;
}

@ApiTags('Week 8 ML Analytics')
@Controller('telescope/ml-analytics')
export class Week8MLAnalyticsController {
  constructor(
    private readonly mlAnalyticsService: MLAnalyticsService,
    private readonly alertingService: AutomatedAlertingService,
  ) {}

  // ML Analytics Endpoints

  @Get('overview')
  @ApiOperation({ summary: 'Get comprehensive ML analytics overview' })
  @ApiResponse({ status: 200, description: 'ML analytics overview retrieved successfully' })
  async getMLOverview(): Promise<MLInsightSummary> {
    const [anomalies, regressions, optimizations, predictions, alerts] = await Promise.all([
      this.mlAnalyticsService.getCurrentAnomalies(),
      this.mlAnalyticsService.getCurrentRegressions(),
      this.mlAnalyticsService.getCurrentOptimizations(),
      this.mlAnalyticsService.getCurrentPredictions(),
      this.mlAnalyticsService.getCurrentAlerts(),
    ]);

    const criticalAnomalies = anomalies.filter((a) => a.severity === 'critical').length;
    const criticalPredictions = predictions.filter((p) => p.riskLevel === 'critical').length;
    const criticalAlerts = alerts.filter((a) => a.severity === 'critical').length;

    // Calculate health score (simplified algorithm)
    let healthScore = 100;
    healthScore -= criticalAnomalies * 15;
    healthScore -= criticalPredictions * 10;
    healthScore -= criticalAlerts * 20;
    healthScore = Math.max(0, Math.min(100, healthScore));

    const riskLevel: MLInsightSummary['riskLevel'] =
      healthScore < 30
        ? 'critical'
        : healthScore < 50
          ? 'high'
          : healthScore < 70
            ? 'medium'
            : 'low';

    const topConcerns = [
      ...anomalies
        .filter((a) => a.severity === 'critical' || a.severity === 'high')
        .slice(0, 3)
        .map((a) => ({
          type: 'anomaly',
          component: a.component,
          severity: a.severity,
          description: a.description,
        })),
      ...predictions
        .filter((p) => p.riskLevel === 'critical' || p.riskLevel === 'high')
        .slice(0, 2)
        .map((p) => ({
          type: 'prediction',
          component: p.component,
          severity: p.riskLevel,
          description: `Predicted ${p.trend} for ${p.metric}`,
        })),
    ];

    return {
      timestamp: new Date(),
      anomaliesCount: anomalies.length,
      regressionsCount: regressions.length,
      optimizationsCount: optimizations.length,
      predictionsCount: predictions.length,
      alertsCount: alerts.length,
      healthScore,
      riskLevel,
      topConcerns,
    };
  }

  @Get('anomalies')
  @ApiOperation({ summary: 'Get detected anomalies with filtering' })
  @ApiQuery({ name: 'component', required: false, type: String })
  @ApiQuery({ name: 'severity', required: false, enum: ['low', 'medium', 'high', 'critical'] })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['performance', 'error', 'traffic', 'resource', 'query'],
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Anomalies retrieved successfully' })
  getAnomalies(@Query() query: AnomalyQueryDto): AnomalyDetection[] {
    let anomalies = this.mlAnalyticsService.getCurrentAnomalies();

    // Apply filters
    if (query.component) {
      anomalies = anomalies.filter((a) => a.component === query.component);
    }
    if (query.severity) {
      anomalies = anomalies.filter((a) => a.severity === query.severity);
    }
    if (query.type) {
      anomalies = anomalies.filter((a) => a.type === query.type);
    }
    if (query.from) {
      anomalies = anomalies.filter((a) => a.timestamp >= new Date(query.from!));
    }
    if (query.to) {
      anomalies = anomalies.filter((a) => a.timestamp <= new Date(query.to!));
    }

    // Apply limit
    const limit = query.limit || 50;
    return anomalies.slice(-limit);
  }

  @Get('anomalies/stream')
  @ApiOperation({ summary: 'Get real-time anomaly detection stream' })
  @ApiResponse({ status: 200, description: 'Anomaly stream established' })
  getAnomaliesStream(): Observable<AnomalyDetection[]> {
    return this.mlAnalyticsService.getAnomalies();
  }

  @Delete('anomalies/:anomalyId')
  @ApiOperation({ summary: 'Dismiss a specific anomaly' })
  @ApiParam({ name: 'anomalyId', description: 'Anomaly ID to dismiss' })
  @HttpCode(HttpStatus.NO_CONTENT)
  dismissAnomaly(@Param('anomalyId') anomalyId: string): boolean {
    return this.mlAnalyticsService.dismissAnomaly(anomalyId);
  }

  @Get('regressions')
  @ApiOperation({ summary: 'Get performance regression analysis' })
  @ApiQuery({ name: 'component', required: false, type: String })
  @ApiQuery({ name: 'trend', required: false, enum: ['improving', 'degrading', 'stable'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Regression analysis retrieved successfully' })
  getRegressions(
    @Query('component') component?: string,
    @Query('trend') trend?: 'improving' | 'degrading' | 'stable',
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 50,
  ): RegressionAnalysis[] {
    let regressions = this.mlAnalyticsService.getCurrentRegressions();

    if (component) {
      regressions = regressions.filter((r) => r.component === component);
    }
    if (trend) {
      regressions = regressions.filter((r) => r.trend === trend);
    }

    return regressions.slice(-limit);
  }

  @Get('regressions/stream')
  @ApiOperation({ summary: 'Get real-time regression analysis stream' })
  @ApiResponse({ status: 200, description: 'Regression analysis stream established' })
  getRegressionsStream(): Observable<RegressionAnalysis[]> {
    return this.mlAnalyticsService.getRegressionAnalysis();
  }

  @Get('optimizations')
  @ApiOperation({ summary: 'Get query optimization suggestions' })
  @ApiQuery({ name: 'table', required: false, type: String })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['index', 'rewrite', 'cache', 'partition', 'normalize'],
  })
  @ApiQuery({ name: 'effort', required: false, enum: ['low', 'medium', 'high'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Optimization suggestions retrieved successfully' })
  getOptimizations(
    @Query('table') table?: string,
    @Query('type') type?: 'index' | 'rewrite' | 'cache' | 'partition' | 'normalize',
    @Query('effort') effort?: 'low' | 'medium' | 'high',
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 50,
  ): QueryOptimizationSuggestion[] {
    let optimizations = this.mlAnalyticsService.getCurrentOptimizations();

    if (table) {
      optimizations = optimizations.filter((o) => o.table === table);
    }
    if (type) {
      optimizations = optimizations.filter((o) => o.optimizationStrategy.type === type);
    }
    if (effort) {
      optimizations = optimizations.filter((o) => o.optimizationStrategy.effort === effort);
    }

    return optimizations.slice(-limit);
  }

  @Get('optimizations/stream')
  @ApiOperation({ summary: 'Get real-time optimization suggestions stream' })
  @ApiResponse({ status: 200, description: 'Optimization suggestions stream established' })
  getOptimizationsStream(): Observable<QueryOptimizationSuggestion[]> {
    return this.mlAnalyticsService.getOptimizationSuggestions();
  }

  @Get('predictions')
  @ApiOperation({ summary: 'Get predictive insights' })
  @ApiQuery({ name: 'component', required: false, type: String })
  @ApiQuery({
    name: 'predictionType',
    required: false,
    enum: ['load', 'failure', 'performance', 'resource'],
  })
  @ApiQuery({ name: 'timeHorizon', required: false, enum: ['1h', '6h', '24h', '7d', '30d'] })
  @ApiQuery({ name: 'riskLevel', required: false, enum: ['low', 'medium', 'high', 'critical'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Predictive insights retrieved successfully' })
  getPredictions(
    @Query('component') component?: string,
    @Query('predictionType') predictionType?: 'load' | 'failure' | 'performance' | 'resource',
    @Query('timeHorizon') timeHorizon?: '1h' | '6h' | '24h' | '7d' | '30d',
    @Query('riskLevel') riskLevel?: 'low' | 'medium' | 'high' | 'critical',
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 50,
  ): PredictiveInsight[] {
    let predictions = this.mlAnalyticsService.getCurrentPredictions();

    if (component) {
      predictions = predictions.filter((p) => p.component === component);
    }
    if (predictionType) {
      predictions = predictions.filter((p) => p.predictionType === predictionType);
    }
    if (timeHorizon) {
      predictions = predictions.filter((p) => p.timeHorizon === timeHorizon);
    }
    if (riskLevel) {
      predictions = predictions.filter((p) => p.riskLevel === riskLevel);
    }

    return predictions.slice(-limit);
  }

  @Get('predictions/stream')
  @ApiOperation({ summary: 'Get real-time predictive insights stream' })
  @ApiResponse({ status: 200, description: 'Predictive insights stream established' })
  getPredictionsStream(): Observable<PredictiveInsight[]> {
    return this.mlAnalyticsService.getPredictiveInsights();
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get ML analytics metrics and statistics' })
  @ApiResponse({ status: 200, description: 'ML metrics retrieved successfully' })
  getMLMetrics() {
    return this.mlAnalyticsService.getMLMetrics();
  }

  // Automated Alerting Endpoints

  @Get('alerts')
  @ApiOperation({ summary: 'Get ML-generated alerts' })
  @ApiQuery({ name: 'severity', required: false, enum: ['info', 'warning', 'error', 'critical'] })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['anomaly', 'regression', 'prediction', 'optimization'],
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'ML alerts retrieved successfully' })
  getMLAlerts(
    @Query('severity') severity?: 'info' | 'warning' | 'error' | 'critical',
    @Query('type') type?: 'anomaly' | 'regression' | 'prediction' | 'optimization',
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 50,
  ): MLAlert[] {
    let alerts = this.mlAnalyticsService.getCurrentAlerts();

    if (severity) {
      alerts = alerts.filter((a) => a.severity === severity);
    }
    if (type) {
      alerts = alerts.filter((a) => a.type === type);
    }

    return alerts.slice(-limit);
  }

  @Get('alerts/stream')
  @ApiOperation({ summary: 'Get real-time ML alerts stream' })
  @ApiResponse({ status: 200, description: 'ML alerts stream established' })
  getMLAlertsStream(): Observable<MLAlert[]> {
    return this.mlAnalyticsService.getMLAlerts();
  }

  @Post('alerts/:alertId/acknowledge')
  @ApiOperation({ summary: 'Acknowledge an ML alert' })
  @ApiParam({ name: 'alertId', description: 'Alert ID to acknowledge' })
  @HttpCode(HttpStatus.OK)
  acknowledgeMLAlert(@Param('alertId') alertId: string) {
    const acknowledged = this.mlAnalyticsService.acknowledgeAlert(alertId);
    return {
      success: acknowledged,
      alertId,
      acknowledgedAt: new Date(),
    };
  }

  // Alert Channel Management

  @Get('alert-channels')
  @ApiOperation({ summary: 'Get all configured alert channels' })
  @ApiResponse({ status: 200, description: 'Alert channels retrieved successfully' })
  getAlertChannels(): AlertChannel[] {
    return this.alertingService.getAlertChannels();
  }

  @Post('alert-channels')
  @ApiOperation({ summary: 'Create a new alert channel' })
  @ApiBody({ type: AlertChannelDto })
  @ApiResponse({ status: 201, description: 'Alert channel created successfully' })
  createAlertChannel(@Body(ValidationPipe) channelDto: AlertChannelDto) {
    const channel: AlertChannel = {
      id: `channel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      enabled: channelDto.enabled ?? true,
      severityFilter: channelDto.severityFilter ?? ['warning', 'error', 'critical'],
      ...channelDto,
    };

    this.alertingService.addAlertChannel(channel);
    return { success: true, channel };
  }

  @Delete('alert-channels/:channelId')
  @ApiOperation({ summary: 'Delete an alert channel' })
  @ApiParam({ name: 'channelId', description: 'Channel ID to delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAlertChannel(@Param('channelId') channelId: string) {
    const deleted = this.alertingService.removeAlertChannel(channelId);
    if (!deleted) {
      throw new BadRequestException('Channel not found');
    }
  }

  @Post('alert-channels/:channelId/test')
  @ApiOperation({ summary: 'Test an alert channel configuration' })
  @ApiParam({ name: 'channelId', description: 'Channel ID to test' })
  @ApiResponse({ status: 200, description: 'Channel test completed' })
  async testAlertChannel(@Param('channelId') channelId: string) {
    try {
      const success = await this.alertingService.testAlertChannel(channelId);
      return { success, message: success ? 'Channel test successful' : 'Channel test failed' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // Alert Rule Management

  @Get('alert-rules')
  @ApiOperation({ summary: 'Get all configured alert rules' })
  @ApiResponse({ status: 200, description: 'Alert rules retrieved successfully' })
  getAlertRules(): AlertRule[] {
    return this.alertingService.getAlertRules();
  }

  @Post('alert-rules')
  @ApiOperation({ summary: 'Create a new alert rule' })
  @ApiBody({ type: AlertRuleDto })
  @ApiResponse({ status: 201, description: 'Alert rule created successfully' })
  createAlertRule(@Body(ValidationPipe) ruleDto: AlertRuleDto) {
    const rule: AlertRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      enabled: ruleDto.enabled ?? true,
      priority: ruleDto.priority ?? 5,
      ...ruleDto,
    };

    this.alertingService.addAlertRule(rule);
    return { success: true, rule };
  }

  @Delete('alert-rules/:ruleId')
  @ApiOperation({ summary: 'Delete an alert rule' })
  @ApiParam({ name: 'ruleId', description: 'Rule ID to delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAlertRule(@Param('ruleId') ruleId: string) {
    const deleted = this.alertingService.removeAlertRule(ruleId);
    if (!deleted) {
      throw new BadRequestException('Rule not found');
    }
  }

  // Alert History and Metrics

  @Get('alert-history')
  @ApiOperation({ summary: 'Get alert delivery history' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Alert history retrieved successfully' })
  getAlertHistory(
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 100,
  ): AlertHistory[] {
    return this.alertingService.getAlertHistory(limit);
  }

  @Get('alert-history/stream')
  @ApiOperation({ summary: 'Get real-time alert history stream' })
  @ApiResponse({ status: 200, description: 'Alert history stream established' })
  getAlertHistoryStream(): Observable<AlertHistory> {
    return this.alertingService.getAlertHistoryStream();
  }

  @Get('alert-metrics')
  @ApiOperation({ summary: 'Get alerting system metrics and performance' })
  @ApiResponse({ status: 200, description: 'Alert metrics retrieved successfully' })
  getAlertMetrics(): AlertMetrics {
    return this.alertingService.getAlertMetrics();
  }

  @Post('alerts/history/:alertId/acknowledge')
  @ApiOperation({ summary: 'Acknowledge an alert from history' })
  @ApiParam({ name: 'alertId', description: 'Alert ID to acknowledge' })
  @HttpCode(HttpStatus.OK)
  acknowledgeHistoryAlert(@Param('alertId') alertId: string) {
    const acknowledged = this.alertingService.acknowledgeAlert(alertId);
    return {
      success: acknowledged,
      alertId,
      acknowledgedAt: new Date(),
    };
  }

  // Dashboard Aggregation Endpoints

  @Get('dashboard/summary')
  @ApiOperation({ summary: 'Get ML analytics dashboard summary' })
  @ApiResponse({ status: 200, description: 'Dashboard summary retrieved successfully' })
  async getDashboardSummary() {
    const [overview, alertMetrics, mlMetrics] = await Promise.all([
      this.getMLOverview(),
      this.alertingService.getAlertMetrics(),
      this.mlAnalyticsService.getMLMetrics(),
    ]);

    return {
      timestamp: new Date(),
      overview,
      alerting: alertMetrics,
      mlEngine: mlMetrics,
      system: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        version: '8.0.0',
      },
    };
  }

  @Get('dashboard/live-feed')
  @ApiOperation({ summary: 'Get live feed of ML insights and alerts' })
  @ApiResponse({ status: 200, description: 'Live feed stream established' })
  getLiveFeed(): Observable<any> {
    return this.mlAnalyticsService.getMLAlerts().pipe(
      map((alerts) => ({
        timestamp: new Date(),
        type: 'alert_update',
        data: alerts.slice(-10), // Last 10 alerts
      })),
    );
  }
}

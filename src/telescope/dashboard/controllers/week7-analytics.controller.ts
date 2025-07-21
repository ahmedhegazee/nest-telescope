import { 
  Controller, 
  Get, 
  Post, 
  Query, 
  Body, 
  Param, 
  Res,
  UseGuards,
  ParseIntPipe,
  ParseEnumPipe,
  ValidationPipe
} from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';

// Import Week 7 services
import { JobWatcherService } from '../../watchers/job/job-watcher.service';
import { CacheWatcherService } from '../../watchers/cache/cache-watcher.service';
import { AnalyticsService, AnalyticsData } from '../../core/services/analytics.service';
import { PerformanceCorrelationService } from '../../core/services/performance-correlation.service';
import { ExportReportingService, ExportOptions, ReportOptions } from '../../core/services/export-reporting.service';

// DTOs and interfaces
export class ExportDataDto {
  format: 'json' | 'csv' | 'xlsx' | 'pdf';
  type: 'raw' | 'analytics' | 'performance' | 'custom';
  timeRange?: {
    start: string;
    end: string;
  };
  filters?: {
    watchers?: string[];
    components?: string[];
    severities?: string[];
    tags?: string[];
  };
  fields?: string[];
  limit?: number;
  includeMetadata?: boolean;
}

export class GenerateReportDto {
  type: 'performance' | 'error' | 'system' | 'custom';
  template?: string;
  title?: string;
  description?: string;
  timeRange: {
    start: string;
    end: string;
  };
  format: 'html' | 'pdf' | 'md';
  includeCharts?: boolean;
  includeRawData?: boolean;
}

@ApiTags('Week 7 Analytics')
@Controller('telescope/analytics')
export class Week7AnalyticsController {
  constructor(
    private readonly jobWatcherService: JobWatcherService,
    private readonly cacheWatcherService: CacheWatcherService,
    private readonly analyticsService: AnalyticsService,
    private readonly performanceCorrelationService: PerformanceCorrelationService,
    private readonly exportReportingService: ExportReportingService
  ) {}

  // Job Monitoring Endpoints
  @Get('jobs/metrics')
  @ApiOperation({ summary: 'Get job monitoring metrics' })
  @ApiResponse({ status: 200, description: 'Job metrics retrieved successfully' })
  getJobMetrics() {
    return this.jobWatcherService.getMetrics();
  }

  @Get('jobs/recent')
  @ApiOperation({ summary: 'Get recent job executions' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getRecentJobs(@Query('limit', new ParseIntPipe({ optional: true })) limit: number = 50) {
    return this.jobWatcherService.getRecentJobs(limit);
  }

  @Get('jobs/queue/:queueName')
  @ApiOperation({ summary: 'Get jobs by queue name' })
  @ApiParam({ name: 'queueName', description: 'Name of the job queue' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getJobsByQueue(
    @Param('queueName') queueName: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 100
  ) {
    return this.jobWatcherService.getJobsByQueue(queueName, limit);
  }

  @Get('jobs/health/:queueName')
  @ApiOperation({ summary: 'Get queue health status for specific queue' })
  @ApiParam({ name: 'queueName', description: 'Specific queue name' })
  getQueueHealthByName(@Param('queueName') queueName: string) {
    return this.jobWatcherService.getQueueHealth(queueName);
  }

  @Get('jobs/health')
  @ApiOperation({ summary: 'Get health status for all queues' })
  getQueueHealth() {
    return this.jobWatcherService.getQueueHealth();
  }

  @Get('jobs/stream')
  @ApiOperation({ summary: 'Get real-time job metrics stream' })
  getJobMetricsStream(): Observable<any> {
    return this.jobWatcherService.getMetricsStream();
  }

  // Cache Monitoring Endpoints
  @Get('cache/metrics')
  @ApiOperation({ summary: 'Get cache monitoring metrics' })
  @ApiResponse({ status: 200, description: 'Cache metrics retrieved successfully' })
  getCacheMetrics() {
    return this.cacheWatcherService.getMetrics();
  }

  @Get('cache/recent')
  @ApiOperation({ summary: 'Get recent cache operations' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getRecentCacheOperations(@Query('limit', new ParseIntPipe({ optional: true })) limit: number = 50) {
    return this.cacheWatcherService.getRecentOperations(limit);
  }

  @Get('cache/health/:instance')
  @ApiOperation({ summary: 'Get specific cache instance health' })
  @ApiParam({ name: 'instance', description: 'Cache instance name' })
  getCacheHealthByInstance(@Param('instance') instance: string) {
    return this.cacheWatcherService.getCacheHealth(instance);
  }

  @Get('cache/health')
  @ApiOperation({ summary: 'Get health status for all cache instances' })
  getCacheHealth() {
    return this.cacheWatcherService.getCacheHealth();
  }

  @Get('cache/redis/info/:instance')
  @ApiOperation({ summary: 'Get specific Redis instance information' })
  @ApiParam({ name: 'instance', description: 'Redis instance name' })
  getRedisInfoByInstance(@Param('instance') instance: string) {
    return this.cacheWatcherService.getRedisInfo(instance);
  }

  @Get('cache/redis/info')
  @ApiOperation({ summary: 'Get Redis information for all instances' })
  getRedisInfo() {
    return this.cacheWatcherService.getRedisInfo();
  }

  @Get('cache/redis/health')
  @ApiOperation({ summary: 'Get Redis health status' })
  getRedisHealth() {
    return this.cacheWatcherService.getRedisHealth();
  }

  @Get('cache/keyspace/:instance')
  @ApiOperation({ summary: 'Get Redis keyspace information for specific instance' })
  @ApiParam({ name: 'instance', description: 'Redis instance name' })
  async getKeyspaceInfoByInstance(@Param('instance') instance: string) {
    return this.cacheWatcherService.getKeyspaceInfo(instance);
  }

  @Get('cache/keyspace')
  @ApiOperation({ summary: 'Get Redis keyspace information for all instances' })
  async getKeyspaceInfo() {
    return this.cacheWatcherService.getKeyspaceInfo();
  }

  @Get('cache/stream')
  @ApiOperation({ summary: 'Get real-time cache metrics stream' })
  getCacheMetricsStream(): Observable<any> {
    return this.cacheWatcherService.getMetricsStream();
  }

  // Advanced Analytics Endpoints
  @Get('advanced')
  @ApiOperation({ summary: 'Get comprehensive analytics data' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  getAdvancedAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    if (startDate && endDate) {
      return this.analyticsService.getAnalyticsForTimeRange(
        new Date(startDate),
        new Date(endDate)
      );
    }
    return this.analyticsService.getAnalytics();
  }

  @Get('advanced/stream')
  @ApiOperation({ summary: 'Get real-time analytics stream' })
  getAdvancedAnalyticsStream(): Observable<AnalyticsData> {
    return this.analyticsService.getAnalyticsStream();
  }

  @Get('advanced/performance')
  @ApiOperation({ summary: 'Get performance analytics' })
  getPerformanceAnalytics() {
    const analytics = this.analyticsService.getAnalytics();
    return analytics.performance;
  }

  @Get('advanced/errors')
  @ApiOperation({ summary: 'Get error analytics' })
  getErrorAnalytics() {
    const analytics = this.analyticsService.getAnalytics();
    return analytics.errors;
  }

  @Get('advanced/users')
  @ApiOperation({ summary: 'Get user analytics' })
  getUserAnalytics() {
    const analytics = this.analyticsService.getAnalytics();
    return analytics.users;
  }

  @Get('advanced/trends')
  @ApiOperation({ summary: 'Get trend analytics' })
  getTrendAnalytics() {
    const analytics = this.analyticsService.getAnalytics();
    return analytics.trends;
  }

  @Get('advanced/alerts')
  @ApiOperation({ summary: 'Get active alerts and anomalies' })
  getAlertsAndAnomalies() {
    const analytics = this.analyticsService.getAnalytics();
    return analytics.alerts;
  }

  // Performance Correlation Endpoints
  @Get('correlation/metrics')
  @ApiOperation({ summary: 'Get performance correlation metrics' })
  getCorrelationMetrics() {
    return this.performanceCorrelationService.getMetrics();
  }

  @Get('correlation/recent')
  @ApiOperation({ summary: 'Get recent performance correlations' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getRecentCorrelations(@Query('limit', new ParseIntPipe({ optional: true })) limit: number = 100) {
    return this.performanceCorrelationService.getRecentCorrelations(limit);
  }

  @Get('correlation/trace/:traceId')
  @ApiOperation({ summary: 'Get correlation data by trace ID' })
  @ApiParam({ name: 'traceId', description: 'Trace ID to lookup' })
  getCorrelationsByTraceId(@Param('traceId') traceId: string) {
    return this.performanceCorrelationService.getCorrelationsByTraceId(traceId);
  }

  @Get('correlation/bottlenecks/:component')
  @ApiOperation({ summary: 'Get bottlenecks by component' })
  @ApiParam({ name: 'component', description: 'Component name' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getBottlenecksByComponent(
    @Param('component') component: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 50
  ) {
    return this.performanceCorrelationService.getBottlenecksByComponent(component, limit);
  }

  @Get('correlation/active-traces')
  @ApiOperation({ summary: 'Get active traces' })
  getActiveTraces() {
    return this.performanceCorrelationService.getActiveTraces();
  }

  @Get('correlation/stream')
  @ApiOperation({ summary: 'Get real-time correlation stream' })
  getCorrelationStream(): Observable<any> {
    return this.performanceCorrelationService.getCorrelationStream();
  }

  // Export & Reporting Endpoints
  @Post('export/data')
  @ApiOperation({ summary: 'Export monitoring data' })
  @ApiResponse({ status: 200, description: 'Data exported successfully' })
  async exportData(
    @Body(ValidationPipe) exportDto: ExportDataDto,
    @Res() res?: Response
  ) {
    const options: ExportOptions = {
      ...exportDto,
      timeRange: exportDto.timeRange ? {
        start: new Date(exportDto.timeRange.start),
        end: new Date(exportDto.timeRange.end),
      } : undefined,
    };

    const result = await this.exportReportingService.exportData(options);

    if (res && result.success && result.filePath) {
      const fileName = result.filePath.split('/').pop();
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.sendFile(result.filePath);
      return;
    }

    return result;
  }

  @Post('export/report')
  @ApiOperation({ summary: 'Generate comprehensive report' })
  @ApiResponse({ status: 200, description: 'Report generated successfully' })
  async generateReport(
    @Body(ValidationPipe) reportDto: GenerateReportDto,
    @Res() res?: Response
  ) {
    const options: ReportOptions = {
      ...reportDto,
      timeRange: {
        start: new Date(reportDto.timeRange.start),
        end: new Date(reportDto.timeRange.end),
      },
    };

    const result = await this.exportReportingService.generateReport(options);

    if (res && result.success && result.filePath) {
      const fileName = result.filePath.split('/').pop();
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.sendFile(result.filePath);
      return;
    }

    return result;
  }

  @Get('export/history')
  @ApiOperation({ summary: 'Get export history' })
  getExportHistory() {
    return this.exportReportingService.getExportHistory();
  }

  @Get('export/templates')
  @ApiOperation({ summary: 'Get available report templates' })
  getReportTemplates() {
    return this.exportReportingService.getReportTemplates();
  }

  // System Health & Overview
  @Get('health/overview')
  @ApiOperation({ summary: 'Get comprehensive system health overview' })
  async getSystemHealthOverview() {
    const [
      jobMetrics,
      cacheMetrics,
      performanceMetrics,
      analytics
    ] = await Promise.all([
      this.jobWatcherService.getMetrics(),
      this.cacheWatcherService.getMetrics(),
      this.performanceCorrelationService.getMetrics(),
      this.analyticsService.getAnalytics()
    ]);

    return {
      timestamp: new Date(),
      jobs: {
        healthScore: jobMetrics.healthScore,
        healthStatus: jobMetrics.healthStatus,
        totalJobs: jobMetrics.totalJobs,
        failureRate: jobMetrics.failureRate,
        averageExecutionTime: jobMetrics.averageExecutionTime,
      },
      cache: {
        healthScore: cacheMetrics.healthScore,
        healthStatus: cacheMetrics.healthStatus,
        hitRate: cacheMetrics.hitRate,
        averageResponseTime: cacheMetrics.averageResponseTime,
        totalOperations: cacheMetrics.totalOperations,
      },
      performance: {
        averageResponseTime: performanceMetrics.averageResponseTime,
        p95ResponseTime: performanceMetrics.p95ResponseTime,
        errorRate: performanceMetrics.errorRate,
        totalRequests: performanceMetrics.totalRequests,
      },
      system: {
        totalRequests: analytics.overview.totalRequests,
        totalErrors: analytics.overview.totalErrors,
        activeUsers: analytics.overview.activeUsers,
        throughput: analytics.overview.throughput,
      },
    };
  }

  @Get('health/alerts')
  @ApiOperation({ summary: 'Get all active alerts across all watchers' })
  async getAllActiveAlerts() {
    // This would collect alerts from all watcher services
    const alerts = {
      jobs: [], // Would get from job watcher
      cache: [], // Would get from cache watcher
      performance: [], // Would get from performance correlation service
      system: [], // Would get from analytics service
    };

    return {
      timestamp: new Date(),
      totalAlerts: 0,
      alerts,
    };
  }

  // Utility endpoints
  @Post('alerts/:alertId/acknowledge')
  @ApiOperation({ summary: 'Acknowledge an alert' })
  @ApiParam({ name: 'alertId', description: 'Alert ID to acknowledge' })
  acknowledgeAlert(@Param('alertId') alertId: string) {
    // Try to acknowledge in all services
    const results = {
      job: this.jobWatcherService.acknowledgeAlert(alertId),
      cache: this.cacheWatcherService.acknowledgeAlert(alertId),
      performance: this.performanceCorrelationService.acknowledgeAlert(alertId),
    };

    const acknowledged = Object.values(results).some(result => result === true);
    
    return {
      success: acknowledged,
      alertId,
      acknowledgedAt: new Date(),
    };
  }

  @Get('dashboard/data')
  @ApiOperation({ summary: 'Get comprehensive dashboard data for Week 7 features' })
  async getDashboardData() {
    const [
      jobMetrics,
      cacheMetrics,
      analytics,
      performanceMetrics,
      correlations
    ] = await Promise.all([
      this.jobWatcherService.getMetrics(),
      this.cacheWatcherService.getMetrics(),
      this.analyticsService.getAnalytics(),
      this.performanceCorrelationService.getMetrics(),
      this.performanceCorrelationService.getRecentCorrelations(20)
    ]);

    return {
      timestamp: new Date(),
      jobs: {
        metrics: jobMetrics,
        recentJobs: this.jobWatcherService.getRecentJobs(10),
        queueHealth: this.jobWatcherService.getQueueHealth(),
      },
      cache: {
        metrics: cacheMetrics,
        recentOperations: this.cacheWatcherService.getRecentOperations(10),
        health: this.cacheWatcherService.getCacheHealth(),
        redisHealth: this.cacheWatcherService.getRedisHealth(),
      },
      analytics: {
        overview: analytics.overview,
        performance: analytics.performance,
        trends: analytics.trends,
        alerts: analytics.alerts,
      },
      correlation: {
        metrics: performanceMetrics,
        recentCorrelations: correlations,
        activeTraces: this.performanceCorrelationService.getActiveTraces(),
      },
    };
  }
}
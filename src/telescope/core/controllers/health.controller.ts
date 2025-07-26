import { Controller, Get, Inject, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TelescopeService } from '../services/telescope.service';
import { MetricsService } from '../services/metrics.service';
import { ResilientBridgeService } from '../../devtools/bridge/resilient-bridge.service';
import { TelescopeConfig } from '../interfaces/telescope-config.interface';

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: Date;
  uptime: number;
  version: string;
  services: {
    telescope: ServiceHealth;
    metrics: ServiceHealth;
    bridge: ServiceHealth;
    storage: ServiceHealth;
  };
  metrics: {
    totalEntries: number;
    errorRate: number;
    averageProcessingTime: number;
    throughput: number;
  };
  circuitBreakers?: Record<string, any>;
}

export interface ServiceHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  details?: any;
  lastChecked: Date;
}

@ApiTags('Health')
@Controller('telescope/health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly startTime = Date.now();

  constructor(
    private readonly telescopeService: TelescopeService,
    private readonly metricsService: MetricsService,
    private readonly resilientBridge: ResilientBridgeService,
    @Inject('TELESCOPE_CONFIG') private readonly config: TelescopeConfig
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get overall health status' })
  @ApiResponse({ status: 200, description: 'Health check successful' })
  async getHealth(): Promise<HealthCheckResponse> {
    const timestamp = new Date();
    const uptime = Date.now() - this.startTime;

    try {
      // Check individual services
      const telescopeHealth = await this.checkTelescopeHealth();
      const metricsHealth = await this.checkMetricsHealth();
      const bridgeHealth = await this.checkBridgeHealth();
      const storageHealth = await this.checkStorageHealth();

      // Get metrics
      const metrics = this.metricsService.getMetrics();
      const bridgeMetrics = this.resilientBridge.getStreamMetrics();

      // Get circuit breaker status
      const circuitBreakers = this.resilientBridge.getCircuitBreakerStatus();

      // Determine overall status
      const services = {
        telescope: telescopeHealth,
        metrics: metricsHealth,
        bridge: bridgeHealth,
        storage: storageHealth
      };

      const overallStatus = this.determineOverallStatus(services);

      return {
        status: overallStatus,
        timestamp,
        uptime,
        version: process.env.npm_package_version || '1.0.0',
        services,
        metrics: {
          totalEntries: metrics.totalEntries,
          errorRate: metrics.errorRate,
          averageProcessingTime: metrics.averageProcessingTime,
          throughput: metrics.throughput
        },
        circuitBreakers
      };
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return {
        status: 'unhealthy',
        timestamp,
        uptime,
        version: process.env.npm_package_version || '1.0.0',
        services: {
          telescope: { status: 'unhealthy', message: 'Health check failed', lastChecked: timestamp },
          metrics: { status: 'unhealthy', message: 'Health check failed', lastChecked: timestamp },
          bridge: { status: 'unhealthy', message: 'Health check failed', lastChecked: timestamp },
          storage: { status: 'unhealthy', message: 'Health check failed', lastChecked: timestamp }
        },
        metrics: {
          totalEntries: 0,
          errorRate: 100,
          averageProcessingTime: 0,
          throughput: 0
        }
      };
    }
  }

  @Get('detailed')
  @ApiOperation({ summary: 'Get detailed health status with full diagnostics' })
  @ApiResponse({ status: 200, description: 'Detailed health check successful' })
  async getDetailedHealth(): Promise<any> {
    const basicHealth = await this.getHealth();
    const comprehensiveStatus = this.resilientBridge.getComprehensiveStatus();
    const performanceReport = this.metricsService.getPerformanceReport();

    return {
      ...basicHealth,
      diagnostics: {
        bridge: comprehensiveStatus.bridge,
        circuitBreakers: comprehensiveStatus.circuitBreakers,
        streamMetrics: comprehensiveStatus.streamMetrics,
        configuration: comprehensiveStatus.configuration,
        performanceReport
      }
    };
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get performance metrics' })
  @ApiResponse({ status: 200, description: 'Metrics retrieved successfully' })
  async getMetrics(): Promise<any> {
    const metrics = this.metricsService.getMetrics();
    const streamMetrics = this.resilientBridge.getStreamMetrics();
    const performanceReport = this.metricsService.getPerformanceReport();

    return {
      timestamp: new Date(),
      uptime: Date.now() - this.startTime,
      metrics,
      streamMetrics,
      performanceReport
    };
  }

  @Get('circuit-breakers')
  @ApiOperation({ summary: 'Get circuit breaker status' })
  @ApiResponse({ status: 200, description: 'Circuit breaker status retrieved successfully' })
  async getCircuitBreakers(): Promise<any> {
    const circuitBreakers = this.resilientBridge.getCircuitBreakerStatus();
    const bridgeHealth = this.resilientBridge.getHealthStatus();

    return {
      timestamp: new Date(),
      circuitBreakers,
      bridgeHealth
    };
  }

  private async checkTelescopeHealth(): Promise<ServiceHealth> {
    try {
      // Check if telescope service is responsive
      const isEnabled = this.config.enabled;
      const watchers = this.config.watchers || {};
      const activeWatchers = Object.keys(watchers).filter(key => {
        const watcher = watchers[key];
        return typeof watcher === 'boolean' ? watcher : watcher?.enabled === true;
      });

      if (!isEnabled) {
        return {
          status: 'degraded',
          message: 'Telescope is disabled',
          lastChecked: new Date()
        };
      }

      return {
        status: 'healthy',
        message: `${activeWatchers.length} watchers active`,
        details: { activeWatchers },
        lastChecked: new Date()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'unhealthy',
        message: `Telescope check failed: ${errorMessage}`,
        lastChecked: new Date()
      };
    }
  }

  private async checkMetricsHealth(): Promise<ServiceHealth> {
    try {
      const metrics = this.metricsService.getMetrics();
      const performanceReport = this.metricsService.getPerformanceReport();

      if (!performanceReport.status.isHealthy) {
        return {
          status: 'degraded',
          message: 'Performance issues detected',
          details: { alerts: performanceReport.status.alerts },
          lastChecked: new Date()
        };
      }

      return {
        status: 'healthy',
        message: `${metrics.totalEntries} entries processed`,
        details: { 
          errorRate: metrics.errorRate.toFixed(2),
          throughput: metrics.throughput.toFixed(2)
        },
        lastChecked: new Date()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'unhealthy',
        message: `Metrics check failed: ${errorMessage}`,
        lastChecked: new Date()
      };
    }
  }

  private async checkBridgeHealth(): Promise<ServiceHealth> {
    try {
      const bridgeHealth = this.resilientBridge.getHealthStatus();
      
      if (!bridgeHealth.isHealthy) {
        return {
          status: 'degraded',
          message: 'Bridge issues detected',
          details: { issues: bridgeHealth.issues },
          lastChecked: new Date()
        };
      }

      return {
        status: 'healthy',
        message: 'Bridge operating normally',
        details: { 
          circuitBreakers: Object.keys(bridgeHealth.circuitBreakers).length,
          lastHealthCheck: bridgeHealth.lastHealthCheckAt
        },
        lastChecked: new Date()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'unhealthy',
        message: `Bridge check failed: ${errorMessage}`,
        lastChecked: new Date()
      };
    }
  }

  private async checkStorageHealth(): Promise<ServiceHealth> {
    try {
      // Check storage configuration
      const storageConfig = this.config.storage;
      
      if (!storageConfig) {
        return {
          status: 'unhealthy',
          message: 'Storage not configured',
          lastChecked: new Date()
        };
      }

      // Check circuit breaker status for storage
      const circuitBreakers = this.resilientBridge.getCircuitBreakerStatus();
      const storageBreaker = circuitBreakers.storage;
      
      if (storageBreaker && storageBreaker.state === 'open') {
        return {
          status: 'unhealthy',
          message: 'Storage circuit breaker open',
          details: { circuitBreaker: storageBreaker },
          lastChecked: new Date()
        };
      }

      return {
        status: 'healthy',
        message: `Storage driver: ${storageConfig.driver}`,
        details: { 
          driver: storageConfig.driver,
          batchEnabled: storageConfig.batch?.enabled || false
        },
        lastChecked: new Date()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'unhealthy',
        message: `Storage check failed: ${errorMessage}`,
        lastChecked: new Date()
      };
    }
  }

  private determineOverallStatus(services: Record<string, ServiceHealth>): 'healthy' | 'unhealthy' | 'degraded' {
    const statuses = Object.values(services).map(service => service.status);
    
    if (statuses.includes('unhealthy')) {
      return 'unhealthy';
    }
    
    if (statuses.includes('degraded')) {
      return 'degraded';
    }
    
    return 'healthy';
  }
}
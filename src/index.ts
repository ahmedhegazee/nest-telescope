/**
 * @nestjs/telescope - Advanced observability and monitoring solution for NestJS applications
 * 
 * This package provides comprehensive monitoring, analytics, and debugging capabilities
 * for NestJS applications with ML-powered insights and enterprise features.
 */

// Main module and service exports
export { TelescopeModule } from './telescope/telescope.module';
export { TelescopeService } from './telescope/core/services/telescope.service';

// Core interfaces
export * from './telescope/core/interfaces/telescope-config.interface';
export * from './telescope/core/interfaces/telescope-entry.interface';

// Core services
export { EntryManagerService } from './telescope/core/services/entry-manager.service';
export { EnhancedEntryManagerService } from './telescope/core/services/enhanced-entry-manager.service';
export { MetricsService } from './telescope/core/services/metrics.service';
export { AnalyticsService } from './telescope/core/services/analytics.service';
export { PerformanceCorrelationService } from './telescope/core/services/performance-correlation.service';
export { ExportReportingService } from './telescope/core/services/export-reporting.service';
export { MLAnalyticsService } from './telescope/core/services/ml-analytics.service';
export { AutomatedAlertingService } from './telescope/core/services/automated-alerting.service';
export { HorizontalScalingService } from './telescope/core/services/horizontal-scaling.service';
export { AdvancedCachingService } from './telescope/core/services/advanced-caching.service';
export { DatabaseOptimizerService } from './telescope/core/services/database-optimizer.service';
export { MemoryOptimizerService } from './telescope/core/services/memory-optimizer.service';
export { EnterpriseSecurityService } from './telescope/core/services/enterprise-security.service';
export { MultiTenantService } from './telescope/core/services/multi-tenant.service';

// Watcher services
export { WatcherRegistryService } from './telescope/watchers/watcher-registry.service';
export { RequestWatcherService } from './telescope/watchers/request/request-watcher.service';
export { QueryWatcherService } from './telescope/watchers/query/query-watcher.service';
export { ExceptionWatcherService } from './telescope/watchers/exception/exception-watcher.service';
export { JobWatcherService } from './telescope/watchers/job/job-watcher.service';
export { CacheWatcherService } from './telescope/watchers/cache/cache-watcher.service';

// Storage services
export { StorageService } from './telescope/storage/storage.service';
export { StorageManagerService } from './telescope/storage/storage-manager.service';

// Watcher interfaces
export * from './telescope/watchers/interfaces/watcher.interface';

// Storage interfaces
export * from './telescope/storage/interfaces/storage.interface';

// Default configuration
export { defaultTelescopeConfig } from './telescope/core/interfaces/telescope-config.interface'; 
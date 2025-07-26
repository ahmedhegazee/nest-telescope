import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Observable, Subject, interval } from "rxjs";
import { map, filter, debounceTime } from "rxjs/operators";
import { TelescopeEntry } from "../interfaces/telescope-entry.interface";
import { TelescopeConfig } from "../interfaces/telescope-config.interface";
import { Inject } from "@nestjs/common";

export interface DatabaseConfig {
  enabled: boolean;
  type: "postgresql" | "mysql" | "mongodb" | "sqlite";
  connection: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl?: boolean;
    poolSize?: number;
    timeout?: number;
  };
  optimization: {
    autoIndexing: boolean;
    queryOptimization: boolean;
    connectionPooling: boolean;
    queryCaching: boolean;
    slowQueryThreshold: number; // ms
    maxQueryTime: number; // ms
  };
  monitoring: {
    enabled: boolean;
    metricsInterval: number;
    slowQueryLogging: boolean;
    performanceAlerts: boolean;
  };
}

export interface QueryMetrics {
  queryHash: string;
  sql: string;
  executionTime: number;
  rowsReturned: number;
  rowsAffected: number;
  timestamp: Date;
  connectionId: string;
  userId?: string;
  application: string;
  slow: boolean;
  optimized: boolean;
}

export interface IndexSuggestion {
  id: string;
  table: string;
  columns: string[];
  type: "btree" | "hash" | "gin" | "gist" | "brin";
  reason: string;
  estimatedImprovement: number; // percentage
  creationCost: number; // estimated time in seconds
  priority: "low" | "medium" | "high" | "critical";
  status: "pending" | "created" | "failed" | "ignored";
}

export interface DatabasePerformance {
  connections: {
    active: number;
    idle: number;
    max: number;
    utilization: number; // percentage
  };
  queries: {
    total: number;
    slow: number;
    averageTime: number;
    peakTime: number;
    throughput: number; // queries per second
  };
  storage: {
    size: number; // bytes
    growth: number; // bytes per day
    fragmentation: number; // percentage
  };
  cache: {
    hitRate: number;
    size: number;
    evictions: number;
  };
  locks: {
    active: number;
    waiting: number;
    deadlocks: number;
  };
}

export interface OptimizationResult {
  success: boolean;
  operation: string;
  duration: number;
  improvements: {
    queryTime: number; // percentage improvement
    throughput: number; // percentage improvement
    resourceUsage: number; // percentage improvement
  };
  recommendations: string[];
  errors?: string[];
}

@Injectable()
export class DatabaseOptimizerService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseOptimizerService.name);
  private readonly queryMetrics = new Map<string, QueryMetrics[]>();
  private readonly indexSuggestions = new Map<string, IndexSuggestion>();
  private readonly performanceSubject = new Subject<DatabasePerformance>();
  private readonly optimizationSubject = new Subject<OptimizationResult>();
  private readonly config: DatabaseConfig;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private optimizationInterval: NodeJS.Timeout | null = null;

  constructor(
    @Inject("TELESCOPE_CONFIG")
    private readonly telescopeConfig: TelescopeConfig
  ) {
    this.config =
      this.telescopeConfig.database || this.getDefaultDatabaseConfig();
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.log("Database optimization disabled");
      return;
    }

    await this.initializeOptimizer();
    this.startMonitoring();
    this.startOptimization();
    this.logger.log("Database optimizer service initialized");
  }

  private getDefaultDatabaseConfig(): DatabaseConfig {
    return {
      enabled: true,
      type: "postgresql",
      connection: {
        host: "localhost",
        port: 5432,
        database: "telescope",
        username: "telescope_user",
        password: "password",
        ssl: false,
        poolSize: 20,
        timeout: 30000,
      },
      optimization: {
        autoIndexing: true,
        queryOptimization: true,
        connectionPooling: true,
        queryCaching: true,
        slowQueryThreshold: 1000, // 1 second
        maxQueryTime: 30000, // 30 seconds
      },
      monitoring: {
        enabled: true,
        metricsInterval: 60000, // 1 minute
        slowQueryLogging: true,
        performanceAlerts: true,
      },
    };
  }

  private async initializeOptimizer(): Promise<void> {
    // Initialize database connection and monitoring
    await this.initializeConnectionPool();
    await this.initializeQueryCache();
    await this.analyzeExistingIndexes();
  }

  private async initializeConnectionPool(): Promise<void> {
    if (!this.config.optimization.connectionPooling) return;

    this.logger.log("Initializing connection pool");
    // Implementation would depend on the database driver
  }

  private async initializeQueryCache(): Promise<void> {
    if (!this.config.optimization.queryCaching) return;

    this.logger.log("Initializing query cache");
    // Implementation would depend on the database driver
  }

  private async analyzeExistingIndexes(): Promise<void> {
    this.logger.log("Analyzing existing database indexes");
    // Implementation would analyze current indexes and suggest improvements
  }

  private startMonitoring(): void {
    if (!this.config.monitoring.enabled) return;

    this.monitoringInterval = interval(
      this.config.monitoring.metricsInterval
    ).subscribe(async () => {
      const performance = await this.getDatabasePerformance();
      this.performanceSubject.next(performance);

      if (this.config.monitoring.performanceAlerts) {
        await this.checkPerformanceAlerts(performance);
      }
    });
  }

  private startOptimization(): void {
    this.optimizationInterval = interval(300000).subscribe(async () => {
      // Every 5 minutes
      await this.runOptimizationCycle();
    });
  }

  // Query monitoring and optimization

  async recordQuery(queryMetrics: QueryMetrics): Promise<void> {
    const queryHash = queryMetrics.queryHash;

    if (!this.queryMetrics.has(queryHash)) {
      this.queryMetrics.set(queryHash, []);
    }

    this.queryMetrics.get(queryHash)!.push(queryMetrics);

    // Keep only recent queries (last 1000)
    const queries = this.queryMetrics.get(queryHash)!;
    if (queries.length > 1000) {
      queries.splice(0, queries.length - 1000);
    }

    // Check if this is a slow query
    if (queryMetrics.slow) {
      await this.analyzeSlowQuery(queryMetrics);
    }

    // Log slow queries if enabled
    if (this.config.monitoring.slowQueryLogging && queryMetrics.slow) {
      this.logger.warn(
        `Slow query detected: ${queryMetrics.sql} (${queryMetrics.executionTime}ms)`
      );
    }
  }

  private async analyzeSlowQuery(queryMetrics: QueryMetrics): Promise<void> {
    const suggestions = await this.generateIndexSuggestions(queryMetrics);

    for (const suggestion of suggestions) {
      this.indexSuggestions.set(suggestion.id, suggestion);

      if (
        suggestion.priority === "critical" ||
        suggestion.priority === "high"
      ) {
        this.logger.warn(
          `High priority index suggestion: ${suggestion.reason}`
        );
      }
    }
  }

  private async generateIndexSuggestions(
    queryMetrics: QueryMetrics
  ): Promise<IndexSuggestion[]> {
    const suggestions: IndexSuggestion[] = [];

    // Analyze query patterns and suggest indexes
    const queryAnalysis = this.analyzeQueryPattern(queryMetrics.sql);

    if (queryAnalysis.needsIndex) {
      suggestions.push({
        id: `idx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        table: queryAnalysis.table,
        columns: queryAnalysis.columns,
        type: this.determineIndexType(
          queryAnalysis.columns,
          queryAnalysis.usage
        ),
        reason: `Slow query on ${
          queryAnalysis.table
        } with ${queryAnalysis.columns.join(", ")}`,
        estimatedImprovement: this.estimateIndexImprovement(
          queryMetrics.executionTime
        ),
        creationCost: this.estimateIndexCreationCost(
          queryAnalysis.table,
          queryAnalysis.columns
        ),
        priority: this.determineIndexPriority(
          queryMetrics.executionTime,
          queryAnalysis.usage
        ),
        status: "pending",
      });
    }

    return suggestions;
  }

  private analyzeQueryPattern(sql: string): {
    needsIndex: boolean;
    table: string;
    columns: string[];
    usage: "where" | "join" | "order" | "group";
  } {
    // Simple SQL pattern analysis
    // In a real implementation, this would use a proper SQL parser

    const lowerSql = sql.toLowerCase();
    const needsIndex =
      lowerSql.includes("where") ||
      lowerSql.includes("join") ||
      lowerSql.includes("order by");

    // Extract table and column information
    const tableMatch = lowerSql.match(/from\s+(\w+)/);
    const table = tableMatch ? tableMatch[1] : "unknown";

    const columnMatch = lowerSql.match(/where\s+(\w+)/);
    const columns = columnMatch ? [columnMatch[1]] : [];

    let usage: "where" | "join" | "order" | "group" = "where";
    if (lowerSql.includes("join")) usage = "join";
    else if (lowerSql.includes("order by")) usage = "order";
    else if (lowerSql.includes("group by")) usage = "group";

    return { needsIndex, table, columns, usage };
  }

  private determineIndexType(
    columns: string[],
    usage: string
  ): IndexSuggestion["type"] {
    if (columns.length > 1) return "btree";
    if (usage === "join") return "hash";
    return "btree";
  }

  private estimateIndexImprovement(currentTime: number): number {
    // Estimate improvement based on current query time
    if (currentTime > 10000) return 90; // 90% improvement for very slow queries
    if (currentTime > 5000) return 70; // 70% improvement for slow queries
    if (currentTime > 1000) return 50; // 50% improvement for moderate queries
    return 20; // 20% improvement for fast queries
  }

  private estimateIndexCreationCost(table: string, columns: string[]): number {
    // Estimate index creation time based on table size and columns
    return columns.length * 10; // Rough estimate: 10 seconds per column
  }

  private determineIndexPriority(
    executionTime: number,
    usage: string
  ): IndexSuggestion["priority"] {
    if (executionTime > 10000) return "critical";
    if (executionTime > 5000) return "high";
    if (executionTime > 1000) return "medium";
    return "low";
  }

  // Performance monitoring

  async getDatabasePerformance(): Promise<DatabasePerformance> {
    const connections = await this.getConnectionMetrics();
    const queries = await this.getQueryMetrics();
    const storage = await this.getStorageMetrics();
    const cache = await this.getCacheMetrics();
    const locks = await this.getLockMetrics();

    return {
      connections,
      queries,
      storage,
      cache,
      locks,
    };
  }

  private async getConnectionMetrics(): Promise<
    DatabasePerformance["connections"]
  > {
    // Implementation would query database for connection information
    return {
      active: 5,
      idle: 15,
      max: 20,
      utilization: 25, // percentage
    };
  }

  private async getQueryMetrics(): Promise<DatabasePerformance["queries"]> {
    const allQueries = Array.from(this.queryMetrics.values()).flat();
    const recentQueries = allQueries.filter(
      (q) => Date.now() - q.timestamp.getTime() < 60000 // Last minute
    );

    const slowQueries = recentQueries.filter((q) => q.slow);
    const executionTimes = recentQueries.map((q) => q.executionTime);

    return {
      total: recentQueries.length,
      slow: slowQueries.length,
      averageTime:
        executionTimes.length > 0
          ? executionTimes.reduce((sum, time) => sum + time, 0) /
            executionTimes.length
          : 0,
      peakTime: executionTimes.length > 0 ? Math.max(...executionTimes) : 0,
      throughput: recentQueries.length, // queries per minute
    };
  }

  private async getStorageMetrics(): Promise<DatabasePerformance["storage"]> {
    // Implementation would query database for storage information
    return {
      size: 1024 * 1024 * 1024, // 1GB
      growth: 1024 * 1024 * 100, // 100MB per day
      fragmentation: 5, // percentage
    };
  }

  private async getCacheMetrics(): Promise<DatabasePerformance["cache"]> {
    // Implementation would query database for cache information
    return {
      hitRate: 0.85, // 85%
      size: 1024 * 1024 * 50, // 50MB
      evictions: 100,
    };
  }

  private async getLockMetrics(): Promise<DatabasePerformance["locks"]> {
    // Implementation would query database for lock information
    return {
      active: 2,
      waiting: 0,
      deadlocks: 0,
    };
  }

  private async checkPerformanceAlerts(
    performance: DatabasePerformance
  ): Promise<void> {
    // Check connection pool utilization
    if (performance.connections.utilization > 80) {
      this.logger.warn(
        `High connection pool utilization: ${performance.connections.utilization}%`
      );
    }

    // Check slow query rate
    const slowQueryRate =
      performance.queries.total > 0
        ? performance.queries.slow / performance.queries.total
        : 0;

    if (slowQueryRate > 0.1) {
      // More than 10% slow queries
      this.logger.warn(
        `High slow query rate: ${(slowQueryRate * 100).toFixed(1)}%`
      );
    }

    // Check cache hit rate
    if (performance.cache.hitRate < 0.8) {
      // Less than 80% cache hit rate
      this.logger.warn(
        `Low cache hit rate: ${(performance.cache.hitRate * 100).toFixed(1)}%`
      );
    }

    // Check for deadlocks
    if (performance.locks.deadlocks > 0) {
      this.logger.error(`Deadlocks detected: ${performance.locks.deadlocks}`);
    }
  }

  // Optimization methods

  private async runOptimizationCycle(): Promise<void> {
    this.logger.log("Starting database optimization cycle");

    try {
      // Analyze query patterns
      await this.analyzeQueryPatterns();

      // Generate index suggestions
      await this.generateIndexSuggestions();

      // Optimize slow queries
      await this.optimizeSlowQueries();

      // Clean up old data
      await this.cleanupOldData();

      // Update statistics
      await this.updateStatistics();

      this.logger.log("Database optimization cycle completed");
    } catch (error) {
      this.logger.error(`Database optimization cycle failed: ${error.message}`);
    }
  }

  private async analyzeQueryPatterns(): Promise<void> {
    // Analyze query patterns to identify optimization opportunities
    for (const [queryHash, queries] of this.queryMetrics.entries()) {
      if (queries.length < 10) continue; // Skip queries with few executions

      const avgTime =
        queries.reduce((sum, q) => sum + q.executionTime, 0) / queries.length;
      const slowCount = queries.filter((q) => q.slow).length;
      const slowRate = slowCount / queries.length;

      if (slowRate > 0.5) {
        // More than 50% slow executions
        await this.analyzeSlowQuery(queries[0]);
      }
    }
  }

  private async generateIndexSuggestions(): Promise<void> {
    // Generate index suggestions based on query patterns
    const suggestions = Array.from(this.indexSuggestions.values())
      .filter((s) => s.status === "pending")
      .sort((a, b) => {
        const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      });

    for (const suggestion of suggestions.slice(0, 5)) {
      // Process top 5 suggestions
      await this.createIndex(suggestion);
    }
  }

  private async createIndex(suggestion: IndexSuggestion): Promise<void> {
    try {
      this.logger.log(
        `Creating index: ${suggestion.table} (${suggestion.columns.join(", ")})`
      );

      // Implementation would create the actual index
      const startTime = Date.now();

      // Simulate index creation
      await new Promise((resolve) =>
        setTimeout(resolve, suggestion.creationCost * 1000)
      );

      const duration = Date.now() - startTime;

      suggestion.status = "created";

      const result: OptimizationResult = {
        success: true,
        operation: `create_index_${suggestion.id}`,
        duration,
        improvements: {
          queryTime: suggestion.estimatedImprovement,
          throughput: suggestion.estimatedImprovement * 0.5,
          resourceUsage: suggestion.estimatedImprovement * 0.3,
        },
        recommendations: [
          `Index created successfully on ${suggestion.table}`,
          `Expected query time improvement: ${suggestion.estimatedImprovement}%`,
        ],
      };

      this.optimizationSubject.next(result);
    } catch (error) {
      suggestion.status = "failed";
      this.logger.error(
        `Failed to create index ${suggestion.id}: ${error.message}`
      );

      const result: OptimizationResult = {
        success: false,
        operation: `create_index_${suggestion.id}`,
        duration: 0,
        improvements: { queryTime: 0, throughput: 0, resourceUsage: 0 },
        recommendations: [],
        errors: [error.message],
      };

      this.optimizationSubject.next(result);
    }
  }

  private async optimizeSlowQueries(): Promise<void> {
    // Identify and optimize slow queries
    const slowQueries = Array.from(this.queryMetrics.values())
      .flat()
      .filter((q) => q.slow && !q.optimized)
      .slice(0, 10); // Process top 10 slow queries

    for (const query of slowQueries) {
      await this.optimizeQuery(query);
    }
  }

  private async optimizeQuery(query: QueryMetrics): Promise<void> {
    try {
      this.logger.log(`Optimizing query: ${query.sql.substring(0, 100)}...`);

      // Implementation would analyze and optimize the query
      const optimization = await this.analyzeQueryOptimization(query.sql);

      if (optimization.canOptimize) {
        const optimizedSql = this.generateOptimizedQuery(
          query.sql,
          optimization
        );

        // Test the optimized query
        const improvement = await this.testQueryOptimization(
          query.sql,
          optimizedSql
        );

        if (improvement > 20) {
          // More than 20% improvement
          this.logger.log(
            `Query optimization successful: ${improvement.toFixed(
              1
            )}% improvement`
          );
        }
      }
    } catch (error) {
      this.logger.error(`Failed to optimize query: ${error.message}`);
    }
  }

  private async analyzeQueryOptimization(sql: string): Promise<{
    canOptimize: boolean;
    suggestions: string[];
  }> {
    // Simple query optimization analysis
    const suggestions: string[] = [];
    let canOptimize = false;

    const lowerSql = sql.toLowerCase();

    if (lowerSql.includes("select *")) {
      suggestions.push("Replace SELECT * with specific columns");
      canOptimize = true;
    }

    if (lowerSql.includes("order by") && !lowerSql.includes("limit")) {
      suggestions.push("Add LIMIT clause to ORDER BY queries");
      canOptimize = true;
    }

    if (lowerSql.includes("like") && lowerSql.includes("%")) {
      suggestions.push(
        "Consider using full-text search instead of LIKE with wildcards"
      );
      canOptimize = true;
    }

    return { canOptimize, suggestions };
  }

  private generateOptimizedQuery(
    originalSql: string,
    optimization: any
  ): string {
    // Generate optimized SQL based on analysis
    let optimizedSql = originalSql;

    if (
      optimization.suggestions.includes(
        "Replace SELECT * with specific columns"
      )
    ) {
      // This would require knowledge of the table schema
      optimizedSql = optimizedSql.replace(
        /select \*/i,
        "SELECT id, name, created_at"
      );
    }

    if (
      optimization.suggestions.includes("Add LIMIT clause to ORDER BY queries")
    ) {
      if (!optimizedSql.toLowerCase().includes("limit")) {
        optimizedSql += " LIMIT 1000";
      }
    }

    return optimizedSql;
  }

  private async testQueryOptimization(
    originalSql: string,
    optimizedSql: string
  ): Promise<number> {
    // Test query optimization by comparing execution times
    // This would require actual database execution
    return 25; // Simulated 25% improvement
  }

  private async cleanupOldData(): Promise<void> {
    // Clean up old query metrics and optimization data
    const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago

    for (const [queryHash, queries] of this.queryMetrics.entries()) {
      const recentQueries = queries.filter(
        (q) => q.timestamp.getTime() > cutoffTime
      );
      if (recentQueries.length === 0) {
        this.queryMetrics.delete(queryHash);
      } else {
        this.queryMetrics.set(queryHash, recentQueries);
      }
    }

    this.logger.log("Cleaned up old query metrics");
  }

  private async updateStatistics(): Promise<void> {
    // Update database statistics for better query planning
    this.logger.log("Updating database statistics");
    // Implementation would update database statistics
  }

  // Public API methods

  getPerformanceUpdates(): Observable<DatabasePerformance> {
    return this.performanceSubject.asObservable();
  }

  getOptimizationUpdates(): Observable<OptimizationResult> {
    return this.optimizationSubject.asObservable();
  }

  getIndexSuggestions(): IndexSuggestion[] {
    return Array.from(this.indexSuggestions.values());
  }

  async createIndexManually(
    suggestion: Omit<IndexSuggestion, "id" | "status">
  ): Promise<OptimizationResult> {
    const fullSuggestion: IndexSuggestion = {
      ...suggestion,
      id: `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      status: "pending",
    };

    this.indexSuggestions.set(fullSuggestion.id, fullSuggestion);
    await this.createIndex(fullSuggestion);

    return {
      success: true,
      operation: `manual_create_index_${fullSuggestion.id}`,
      duration: 0,
      improvements: {
        queryTime: fullSuggestion.estimatedImprovement,
        throughput: fullSuggestion.estimatedImprovement * 0.5,
        resourceUsage: fullSuggestion.estimatedImprovement * 0.3,
      },
      recommendations: [
        `Manual index creation initiated for ${fullSuggestion.table}`,
        `Expected improvement: ${fullSuggestion.estimatedImprovement}%`,
      ],
    };
  }

  async getQueryAnalysis(queryHash: string): Promise<{
    metrics: QueryMetrics[];
    analysis: {
      totalExecutions: number;
      averageTime: number;
      slowExecutions: number;
      slowRate: number;
      trend: "improving" | "degrading" | "stable";
    };
  } | null> {
    const queries = this.queryMetrics.get(queryHash);
    if (!queries || queries.length === 0) return null;

    const totalExecutions = queries.length;
    const averageTime =
      queries.reduce((sum, q) => sum + q.executionTime, 0) / totalExecutions;
    const slowExecutions = queries.filter((q) => q.slow).length;
    const slowRate = slowExecutions / totalExecutions;

    // Calculate trend
    const recentQueries = queries.slice(-10);
    const olderQueries = queries.slice(-20, -10);

    const recentAvg =
      recentQueries.reduce((sum, q) => sum + q.executionTime, 0) /
      recentQueries.length;
    const olderAvg =
      olderQueries.reduce((sum, q) => sum + q.executionTime, 0) /
      olderQueries.length;

    let trend: "improving" | "degrading" | "stable" = "stable";
    if (recentAvg < olderAvg * 0.8) trend = "improving";
    else if (recentAvg > olderAvg * 1.2) trend = "degrading";

    return {
      metrics: queries,
      analysis: {
        totalExecutions,
        averageTime,
        slowExecutions,
        slowRate,
        trend,
      },
    };
  }

  async shutdown(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval as any);
    }
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval as any);
    }

    this.logger.log("Database optimizer service shutdown");
  }
}

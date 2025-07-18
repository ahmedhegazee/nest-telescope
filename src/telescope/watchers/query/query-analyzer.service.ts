import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { QueryContext } from './query-watcher.interceptor';
import { SlowQueryAnalysis, QueryIssue, OptimizationHint, ExecutionPlan } from './query-watcher.service';

export interface QueryOptimizationSuggestion {
  type: 'index' | 'rewrite' | 'schema' | 'caching' | 'partitioning';
  priority: 'low' | 'medium' | 'high' | 'critical';
  table: string;
  column?: string;
  currentQuery: string;
  optimizedQuery?: string;
  indexDefinition?: string;
  description: string;
  estimatedImpact: string;
  implementationEffort: 'low' | 'medium' | 'high';
}

export interface QueryPattern {
  pattern: string;
  count: number;
  averageDuration: number;
  lastSeen: Date;
  optimization?: QueryOptimizationSuggestion;
}

@Injectable()
export class QueryAnalyzerService {
  private readonly logger = new Logger(QueryAnalyzerService.name);
  private readonly queryPatterns = new Map<string, QueryPattern>();
  private readonly indexSuggestions = new Map<string, QueryOptimizationSuggestion>();

  constructor(private readonly dataSource: DataSource) {}

  async analyzeQuery(context: QueryContext): Promise<SlowQueryAnalysis> {
    const issues: QueryIssue[] = [];
    const optimizationHints: OptimizationHint[] = [];
    let executionPlan: ExecutionPlan | undefined;

    try {
      // Get execution plan if available
      executionPlan = await this.getExecutionPlan(context.sql, context.parameters);
      
      // Analyze SQL structure
      const structuralIssues = this.analyzeQueryStructure(context.sql);
      issues.push(...structuralIssues);

      // Analyze execution plan
      if (executionPlan) {
        const planIssues = this.analyzeExecutionPlan(executionPlan, context.tableName);
        issues.push(...planIssues);
      }

      // Generate optimization hints
      const hints = this.generateOptimizationHints(context, issues);
      optimizationHints.push(...hints);

      // Update query patterns
      this.updateQueryPatterns(context);

      return {
        queryId: context.id,
        sql: context.sql,
        duration: context.duration || 0,
        severity: this.determineSeverity(context.duration || 0),
        issues,
        optimizationHints,
        affectedRows: context.affectedRows || 0,
        executionPlan
      };
    } catch (error) {
      this.logger.error('Failed to analyze query:', error);
      
      return {
        queryId: context.id,
        sql: context.sql,
        duration: context.duration || 0,
        severity: this.determineSeverity(context.duration || 0),
        issues,
        optimizationHints,
        affectedRows: context.affectedRows || 0
      };
    }
  }

  private async getExecutionPlan(sql: string, parameters: any[]): Promise<ExecutionPlan | undefined> {
    try {
      const driverType = this.dataSource.options.type;
      
      if (driverType === 'postgres') {
        return this.getPostgresExecutionPlan(sql, parameters);
      } else if (driverType === 'mysql') {
        return this.getMySQLExecutionPlan(sql, parameters);
      }
      
      return undefined;
    } catch (error) {
      this.logger.debug('Could not get execution plan:', error.message);
      return undefined;
    }
  }

  private async getPostgresExecutionPlan(sql: string, parameters: any[]): Promise<ExecutionPlan | undefined> {
    try {
      const explainSql = `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS) ${sql}`;
      const result = await this.dataSource.query(explainSql, parameters);
      
      const plan = result[0]['QUERY PLAN'][0];
      
      return {
        totalCost: plan.Plan['Total Cost'],
        rows: plan.Plan['Actual Rows'],
        operations: this.extractPostgresOperations(plan.Plan)
      };
    } catch (error) {
      this.logger.debug('Failed to get PostgreSQL execution plan:', error.message);
      return undefined;
    }
  }

  private async getMySQLExecutionPlan(sql: string, parameters: any[]): Promise<ExecutionPlan | undefined> {
    try {
      const explainSql = `EXPLAIN FORMAT=JSON ${sql}`;
      const result = await this.dataSource.query(explainSql, parameters);
      
      const plan = JSON.parse(result[0]['EXPLAIN']);
      
      return {
        totalCost: plan.query_block.cost_info.query_cost,
        rows: plan.query_block.cost_info.estimated_rows,
        operations: this.extractMySQLOperations(plan.query_block)
      };
    } catch (error) {
      this.logger.debug('Failed to get MySQL execution plan:', error.message);
      return undefined;
    }
  }

  private extractPostgresOperations(plan: any): any[] {
    const operations = [];
    
    const extractOperation = (node: any) => {
      operations.push({
        operation: node['Node Type'],
        table: node['Relation Name'] || 'N/A',
        cost: node['Total Cost'],
        rows: node['Actual Rows'],
        filter: node['Filter']
      });
      
      if (node.Plans) {
        node.Plans.forEach(extractOperation);
      }
    };
    
    extractOperation(plan);
    return operations;
  }

  private extractMySQLOperations(queryBlock: any): any[] {
    const operations = [];
    
    if (queryBlock.table) {
      operations.push({
        operation: queryBlock.table.access_type || 'table_scan',
        table: queryBlock.table.table_name,
        cost: queryBlock.cost_info.read_cost,
        rows: queryBlock.cost_info.estimated_rows,
        filter: queryBlock.table.attached_condition
      });
    }
    
    return operations;
  }

  private analyzeQueryStructure(sql: string): QueryIssue[] {
    const issues: QueryIssue[] = [];
    const normalizedSql = sql.toLowerCase().trim();

    // Check for SELECT * usage
    if (normalizedSql.includes('select *')) {
      issues.push({
        type: 'full_table_scan',
        severity: 'medium',
        description: 'Query uses SELECT * which may fetch unnecessary columns',
        suggestion: 'Specify only the columns you need to reduce data transfer and improve performance',
        affectedTable: this.extractTableName(sql)
      });
    }

    // Check for missing WHERE clause on large tables
    if (normalizedSql.includes('select') && !normalizedSql.includes('where') && !normalizedSql.includes('limit')) {
      issues.push({
        type: 'full_table_scan',
        severity: 'high',
        description: 'Query lacks WHERE clause and may scan entire table',
        suggestion: 'Add appropriate WHERE conditions to filter results',
        affectedTable: this.extractTableName(sql)
      });
    }

    // Check for functions in WHERE clause
    if (normalizedSql.match(/where.*\b(upper|lower|substring|concat|date|year|month)\s*\(/)) {
      issues.push({
        type: 'missing_index',
        severity: 'medium',
        description: 'Query uses functions in WHERE clause which prevents index usage',
        suggestion: 'Consider using function-based indexes or restructuring the query',
        affectedTable: this.extractTableName(sql)
      });
    }

    // Check for OR conditions in WHERE clause
    if (normalizedSql.includes('where') && normalizedSql.includes(' or ')) {
      issues.push({
        type: 'missing_index',
        severity: 'medium',
        description: 'Query uses OR conditions which may not use indexes efficiently',
        suggestion: 'Consider using UNION or separate queries with appropriate indexes',
        affectedTable: this.extractTableName(sql)
      });
    }

    // Check for LIKE with leading wildcard
    if (normalizedSql.match(/like\s+['"]%/)) {
      issues.push({
        type: 'missing_index',
        severity: 'medium',
        description: 'Query uses LIKE with leading wildcard which prevents index usage',
        suggestion: 'Consider using full-text search or restructuring the search pattern',
        affectedTable: this.extractTableName(sql)
      });
    }

    // Check for excessive JOINs
    const joinCount = (normalizedSql.match(/\bjoin\b/g) || []).length;
    if (joinCount > 5) {
      issues.push({
        type: 'excessive_joins',
        severity: 'high',
        description: `Query has ${joinCount} joins which may impact performance`,
        suggestion: 'Consider denormalizing data, using materialized views, or breaking into multiple queries',
        affectedTable: this.extractTableName(sql)
      });
    }

    // Check for subqueries that could be JOINs
    if (normalizedSql.includes('where') && normalizedSql.includes('in (select')) {
      issues.push({
        type: 'subquery_performance',
        severity: 'medium',
        description: 'Query uses IN with subquery which may be inefficient',
        suggestion: 'Consider rewriting as JOIN or using EXISTS instead of IN',
        affectedTable: this.extractTableName(sql)
      });
    }

    return issues;
  }

  private analyzeExecutionPlan(plan: ExecutionPlan, tableName?: string): QueryIssue[] {
    const issues: QueryIssue[] = [];

    // Check for high-cost operations
    if (plan.totalCost > 10000) {
      issues.push({
        type: 'full_table_scan',
        severity: 'high',
        description: `Query has high execution cost: ${plan.totalCost}`,
        suggestion: 'Consider adding indexes or optimizing the query structure',
        affectedTable: tableName
      });
    }

    // Check for table scans
    const hasTableScan = plan.operations.some(op => 
      op.operation.toLowerCase().includes('seq scan') || 
      op.operation.toLowerCase().includes('table scan')
    );

    if (hasTableScan) {
      issues.push({
        type: 'full_table_scan',
        severity: 'high',
        description: 'Query performs full table scan',
        suggestion: 'Add appropriate indexes on filtered columns',
        affectedTable: tableName
      });
    }

    // Check for high row estimates vs actual
    plan.operations.forEach(op => {
      if (op.rows > 10000) {
        issues.push({
          type: 'full_table_scan',
          severity: 'medium',
          description: `Operation scans ${op.rows} rows`,
          suggestion: 'Consider adding more selective filters or indexes',
          affectedTable: op.table
        });
      }
    });

    return issues;
  }

  private generateOptimizationHints(context: QueryContext, issues: QueryIssue[]): OptimizationHint[] {
    const hints: OptimizationHint[] = [];

    // Generate index suggestions
    if (issues.some(issue => issue.type === 'missing_index' || issue.type === 'full_table_scan')) {
      hints.push({
        type: 'index_suggestion',
        priority: 'high',
        description: 'Add database indexes to improve query performance',
        implementation: this.generateIndexSuggestion(context.sql, context.tableName),
        estimatedImpact: 'Could reduce query time by 50-95%'
      });
    }

    // Generate query rewrite suggestions
    if (issues.some(issue => issue.type === 'subquery_performance')) {
      hints.push({
        type: 'query_rewrite',
        priority: 'medium',
        description: 'Rewrite subqueries as JOINs for better performance',
        implementation: 'Convert IN (SELECT ...) to JOIN or EXISTS clauses',
        estimatedImpact: 'Could improve performance by 20-50%'
      });
    }

    // Generate caching suggestions for frequently executed queries
    if (this.isFrequentQuery(context.sql)) {
      hints.push({
        type: 'caching_opportunity',
        priority: 'medium',
        description: 'Consider caching this frequently executed query',
        implementation: 'Implement Redis caching or query result caching',
        estimatedImpact: 'Could reduce database load by 70-90%'
      });
    }

    return hints;
  }

  private generateIndexSuggestion(sql: string, tableName?: string): string {
    const normalizedSql = sql.toLowerCase();
    
    // Extract WHERE conditions
    const whereMatch = normalizedSql.match(/where\s+(.+?)(?:\s+order\s+by|\s+group\s+by|\s+having|\s+limit|$)/);
    if (whereMatch && tableName) {
      const whereClause = whereMatch[1];
      
      // Extract column names from WHERE clause
      const columns = this.extractColumnsFromWhere(whereClause);
      
      if (columns.length > 0) {
        return `CREATE INDEX idx_${tableName}_${columns.join('_')} ON ${tableName} (${columns.join(', ')});`;
      }
    }
    
    return 'Analyze query execution plan and add indexes on frequently filtered columns';
  }

  private extractColumnsFromWhere(whereClause: string): string[] {
    const columns: string[] = [];
    
    // Simple extraction of column names (this could be made more sophisticated)
    const columnMatches = whereClause.match(/\b\w+\b\s*[=<>!]/g);
    if (columnMatches) {
      columnMatches.forEach(match => {
        const column = match.replace(/\s*[=<>!].*$/, '').trim();
        if (column && !columns.includes(column)) {
          columns.push(column);
        }
      });
    }
    
    return columns.slice(0, 3); // Limit to 3 columns for composite index
  }

  private extractTableName(sql: string): string | undefined {
    const normalizedSql = sql.toLowerCase().trim();
    
    // Extract table name from different SQL operations
    let match = normalizedSql.match(/from\s+`?(\w+)`?/);
    if (match) return match[1];
    
    match = normalizedSql.match(/insert\s+into\s+`?(\w+)`?/);
    if (match) return match[1];
    
    match = normalizedSql.match(/update\s+`?(\w+)`?/);
    if (match) return match[1];
    
    match = normalizedSql.match(/delete\s+from\s+`?(\w+)`?/);
    if (match) return match[1];
    
    return undefined;
  }

  private determineSeverity(duration: number): 'slow' | 'very_slow' | 'critical' {
    if (duration > 10000) return 'critical';
    if (duration > 5000) return 'very_slow';
    return 'slow';
  }

  private updateQueryPatterns(context: QueryContext): void {
    const normalizedSql = this.normalizeQueryForPattern(context.sql);
    const pattern = this.queryPatterns.get(normalizedSql);
    
    if (pattern) {
      pattern.count++;
      pattern.averageDuration = (pattern.averageDuration * (pattern.count - 1) + (context.duration || 0)) / pattern.count;
      pattern.lastSeen = new Date();
    } else {
      this.queryPatterns.set(normalizedSql, {
        pattern: normalizedSql,
        count: 1,
        averageDuration: context.duration || 0,
        lastSeen: new Date()
      });
    }
  }

  private normalizeQueryForPattern(sql: string): string {
    return sql
      .replace(/\$\d+/g, '?')
      .replace(/\?/g, '?')
      .replace(/\s+/g, ' ')
      .replace(/\d+/g, 'N')
      .replace(/'[^']*'/g, "'?'")
      .trim()
      .substring(0, 200);
  }

  private isFrequentQuery(sql: string): boolean {
    const normalizedSql = this.normalizeQueryForPattern(sql);
    const pattern = this.queryPatterns.get(normalizedSql);
    
    return pattern ? pattern.count > 10 : false;
  }

  // Public API
  getQueryPatterns(): QueryPattern[] {
    return Array.from(this.queryPatterns.values())
      .sort((a, b) => b.count - a.count);
  }

  getSlowQueryPatterns(): QueryPattern[] {
    return Array.from(this.queryPatterns.values())
      .filter(pattern => pattern.averageDuration > 1000)
      .sort((a, b) => b.averageDuration - a.averageDuration);
  }

  getOptimizationSuggestions(): QueryOptimizationSuggestion[] {
    return Array.from(this.indexSuggestions.values())
      .sort((a, b) => {
        const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      });
  }

  clearPatterns(): void {
    this.queryPatterns.clear();
    this.indexSuggestions.clear();
  }
}
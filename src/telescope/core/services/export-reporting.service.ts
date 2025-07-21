import { Injectable, Logger } from '@nestjs/common';
import { TelescopeService } from './telescope.service';
import { AnalyticsService } from './analytics.service';
import { PerformanceCorrelationService } from './performance-correlation.service';
import * as fs from 'fs';
import * as path from 'path';

export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
  XLSX = 'xlsx',
  PDF = 'pdf'
}

export enum ReportFormat {
  HTML = 'html',
  PDF = 'pdf',
  MARKDOWN = 'md'
}

export interface ExportOptions {
  format: 'json' | 'csv' | 'xlsx' | 'pdf';
  type: 'raw' | 'analytics' | 'performance' | 'custom';
  timeRange?: {
    start: Date;
    end: Date;
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

export interface ReportOptions {
  type: 'performance' | 'error' | 'system' | 'custom';
  template?: string;
  title?: string;
  description?: string;
  timeRange: {
    start: Date;
    end: Date;
  };
  sections?: ReportSection[];
  format: 'html' | 'pdf' | 'md';
  includeCharts?: boolean;
  includeRawData?: boolean;
}

export interface ReportSection {
  title: string;
  type: 'overview' | 'metrics' | 'charts' | 'table' | 'analysis' | 'recommendations';
  data?: any;
  config?: any;
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  data?: any;
  error?: string;
  metadata: {
    recordCount: number;
    timeRange: {
      start: Date;
      end: Date;
    };
    exportedAt: Date;
    format: string;
  };
}

export interface ReportResult {
  success: boolean;
  filePath?: string;
  content?: string;
  error?: string;
  metadata: {
    title: string;
    generatedAt: Date;
    timeRange: {
      start: Date;
      end: Date;
    };
    format: string;
    sections: number;
  };
}

@Injectable()
export class ExportReportingService {
  private readonly logger = new Logger(ExportReportingService.name);
  private readonly exportDir = path.join(process.cwd(), 'exports');

  constructor(
    private readonly telescopeService: TelescopeService,
    private readonly analyticsService: AnalyticsService,
    private readonly performanceCorrelationService: PerformanceCorrelationService
  ) {
    this.ensureExportDirectory();
  }

  private ensureExportDirectory(): void {
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
    }
  }

  async exportData(options: ExportOptions): Promise<ExportResult> {
    try {
      this.logger.log(`Exporting data with format: ${options.format}, type: ${options.type}`);

      let data: any;
      let recordCount = 0;
      const timeRange = options.timeRange || {
        start: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        end: new Date(),
      };

      // Collect data based on type
      switch (options.type) {
        case 'raw':
          data = await this.collectRawData(options);
          recordCount = Array.isArray(data) ? data.length : 1;
          break;

        case 'analytics':
          data = await this.collectAnalyticsData(options);
          recordCount = 1;
          break;

        case 'performance':
          data = await this.collectPerformanceData(options);
          recordCount = Array.isArray(data) ? data.length : 1;
          break;

        case 'custom':
          data = await this.collectCustomData(options);
          recordCount = Array.isArray(data) ? data.length : 1;
          break;

        default:
          throw new Error(`Unsupported export type: ${options.type}`);
      }

      // Apply filters
      if (options.filters) {
        data = this.applyFilters(data, options.filters);
        recordCount = Array.isArray(data) ? data.length : 1;
      }

      // Apply field selection
      if (options.fields) {
        data = this.selectFields(data, options.fields);
      }

      // Apply limit
      if (options.limit && Array.isArray(data)) {
        data = data.slice(0, options.limit);
        recordCount = data.length;
      }

      // Generate file
      const fileName = this.generateFileName(options);
      const filePath = path.join(this.exportDir, fileName);

      switch (options.format) {
        case 'json':
          await this.exportToJson(data, filePath, options);
          break;

        case 'csv':
          await this.exportToCsv(data, filePath, options);
          break;

        case 'xlsx':
          await this.exportToXlsx(data, filePath, options);
          break;

        case 'pdf':
          await this.exportToPdf(data, filePath, options);
          break;

        default:
          throw new Error(`Unsupported export format: ${options.format}`);
      }

      return {
        success: true,
        filePath,
        metadata: {
          recordCount,
          timeRange,
          exportedAt: new Date(),
          format: options.format,
        },
      };

    } catch (error) {
      this.logger.error('Export failed:', error);
      return {
        success: false,
        error: error.message,
        metadata: {
          recordCount: 0,
          timeRange: options.timeRange || { start: new Date(), end: new Date() },
          exportedAt: new Date(),
          format: options.format,
        },
      };
    }
  }

  async generateReport(options: ReportOptions): Promise<ReportResult> {
    try {
      this.logger.log(`Generating report: ${options.type} in ${options.format} format`);

      const reportData = await this.collectReportData(options);
      const content = await this.generateReportContent(reportData, options);

      const fileName = this.generateReportFileName(options);
      const filePath = path.join(this.exportDir, fileName);

      switch (options.format) {
        case 'html':
          await this.saveHtmlReport(content, filePath);
          break;

        case 'pdf':
          await this.savePdfReport(content, filePath);
          break;

        case 'md':
          await this.saveMarkdownReport(content, filePath);
          break;

        default:
          throw new Error(`Unsupported report format: ${options.format}`);
      }

      return {
        success: true,
        filePath,
        content,
        metadata: {
          title: options.title || `${options.type} Report`,
          generatedAt: new Date(),
          timeRange: options.timeRange,
          format: options.format,
          sections: options.sections?.length || 0,
        },
      };

    } catch (error) {
      this.logger.error('Report generation failed:', error);
      return {
        success: false,
        error: error.message,
        metadata: {
          title: options.title || `${options.type} Report`,
          generatedAt: new Date(),
          timeRange: options.timeRange,
          format: options.format,
          sections: 0,
        },
      };
    }
  }

  private async collectRawData(options: ExportOptions): Promise<any> {
    const entries = await this.telescopeService.getEntries();
    
    let filteredEntries = entries;

    if (options.timeRange) {
      filteredEntries = entries.filter(entry => {
        const entryTime = new Date(entry.timestamp);
        return entryTime >= options.timeRange!.start && entryTime <= options.timeRange!.end;
      });
    }

    return filteredEntries;
  }

  private async collectAnalyticsData(options: ExportOptions): Promise<any> {
    if (options.timeRange) {
      return await this.analyticsService.getAnalyticsForTimeRange(
        options.timeRange.start,
        options.timeRange.end
      );
    }

    return this.analyticsService.getAnalytics();
  }

  private async collectPerformanceData(options: ExportOptions): Promise<any> {
    const correlations = this.performanceCorrelationService.getRecentCorrelations(1000);
    
    if (options.timeRange) {
      return correlations.filter(correlation => {
        const corrTime = new Date(correlation.timestamp);
        return corrTime >= options.timeRange!.start && corrTime <= options.timeRange!.end;
      });
    }

    return correlations;
  }

  private async collectCustomData(options: ExportOptions): Promise<any> {
    // This would allow for custom data collection based on specific requirements
    const data = {
      entries: await this.collectRawData(options),
      analytics: await this.collectAnalyticsData(options),
      performance: await this.collectPerformanceData(options),
    };

    return data;
  }

  private applyFilters(data: any, filters: any): any {
    if (!Array.isArray(data)) {
      return data;
    }

    return data.filter(item => {
      if (filters.watchers && filters.watchers.length > 0) {
        if (!filters.watchers.includes(item.type)) {
          return false;
        }
      }

      if (filters.components && filters.components.length > 0) {
        const itemComponent = item.content?.component || item.component;
        if (!filters.components.includes(itemComponent)) {
          return false;
        }
      }

      if (filters.severities && filters.severities.length > 0) {
        const itemSeverity = item.content?.severity || item.severity;
        if (!filters.severities.includes(itemSeverity)) {
          return false;
        }
      }

      if (filters.tags && filters.tags.length > 0) {
        const itemTags = item.tags || [];
        if (!filters.tags.some(tag => itemTags.includes(tag))) {
          return false;
        }
      }

      return true;
    });
  }

  private selectFields(data: any, fields: string[]): any {
    if (!Array.isArray(data)) {
      return this.selectObjectFields(data, fields);
    }

    return data.map(item => this.selectObjectFields(item, fields));
  }

  private selectObjectFields(obj: any, fields: string[]): any {
    const result: any = {};
    
    fields.forEach(field => {
      const fieldParts = field.split('.');
      let value = obj;
      
      for (const part of fieldParts) {
        if (value && typeof value === 'object' && part in value) {
          value = value[part];
        } else {
          value = undefined;
          break;
        }
      }
      
      if (value !== undefined) {
        this.setNestedValue(result, field, value);
      }
    });

    return result;
  }

  private setNestedValue(obj: any, path: string, value: any): void {
    const parts = path.split('.');
    let current = obj;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }
    
    current[parts[parts.length - 1]] = value;
  }

  private generateFileName(options: ExportOptions): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const type = options.type;
    const format = options.format;
    
    return `telescope-${type}-${timestamp}.${format}`;
  }

  private generateReportFileName(options: ReportOptions): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const type = options.type;
    const format = options.format;
    
    return `telescope-report-${type}-${timestamp}.${format}`;
  }

  private async exportToJson(data: any, filePath: string, options: ExportOptions): Promise<void> {
    const exportData = {
      metadata: {
        exportedAt: new Date(),
        type: options.type,
        format: options.format,
        recordCount: Array.isArray(data) ? data.length : 1,
        timeRange: options.timeRange,
        filters: options.filters,
      },
      data,
    };

    await fs.promises.writeFile(filePath, JSON.stringify(exportData, null, 2));
  }

  private async exportToCsv(data: any, filePath: string, options: ExportOptions): Promise<void> {
    if (!Array.isArray(data)) {
      throw new Error('CSV export requires array data');
    }

    if (data.length === 0) {
      await fs.promises.writeFile(filePath, '');
      return;
    }

    // Extract headers from first item
    const headers = this.extractCsvHeaders(data[0]);
    const csvRows = [headers.join(',')];

    // Add data rows
    data.forEach(item => {
      const values = headers.map(header => {
        const value = this.getNestedValue(item, header);
        return this.escapeCsvValue(value);
      });
      csvRows.push(values.join(','));
    });

    await fs.promises.writeFile(filePath, csvRows.join('\n'));
  }

  private extractCsvHeaders(obj: any, prefix = ''): string[] {
    const headers: string[] = [];
    
    Object.keys(obj).forEach(key => {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];
      
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        headers.push(...this.extractCsvHeaders(value, fullKey));
      } else {
        headers.push(fullKey);
      }
    });
    
    return headers;
  }

  private getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let value = obj;
    
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return '';
      }
    }
    
    return value;
  }

  private escapeCsvValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }
    
    const stringValue = String(value);
    
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    return stringValue;
  }

  private async exportToXlsx(data: any, filePath: string, options: ExportOptions): Promise<void> {
    // This would require a library like xlsx
    // For now, we'll export as CSV with xlsx extension
    await this.exportToCsv(data, filePath, options);
  }

  private async exportToPdf(data: any, filePath: string, options: ExportOptions): Promise<void> {
    // This would require a library like puppeteer or jsPDF
    // For now, we'll create a simple text-based PDF
    const jsonData = JSON.stringify(data, null, 2);
    await fs.promises.writeFile(filePath, jsonData);
  }

  private async collectReportData(options: ReportOptions): Promise<any> {
    const analytics = await this.analyticsService.getAnalyticsForTimeRange(
      options.timeRange.start,
      options.timeRange.end
    );

    const performance = this.performanceCorrelationService.getRecentCorrelations(1000)
      .filter(correlation => {
        const corrTime = new Date(correlation.timestamp);
        return corrTime >= options.timeRange.start && corrTime <= options.timeRange.end;
      });

    return {
      analytics,
      performance,
      timeRange: options.timeRange,
    };
  }

  private async generateReportContent(data: any, options: ReportOptions): Promise<string> {
    const sections = options.sections || this.getDefaultSections(options.type);
    
    switch (options.format) {
      case 'html':
        return this.generateHtmlReport(data, options, sections);
      case 'md':
        return this.generateMarkdownReport(data, options, sections);
      case 'pdf':
        return this.generatePdfReport(data, options, sections);
      default:
        throw new Error(`Unsupported report format: ${options.format}`);
    }
  }

  private getDefaultSections(type: string): ReportSection[] {
    switch (type) {
      case 'performance':
        return [
          { title: 'Executive Summary', type: 'overview' },
          { title: 'Performance Metrics', type: 'metrics' },
          { title: 'Response Time Analysis', type: 'charts' },
          { title: 'Bottleneck Analysis', type: 'analysis' },
          { title: 'Recommendations', type: 'recommendations' },
        ];
      
      case 'error':
        return [
          { title: 'Error Overview', type: 'overview' },
          { title: 'Error Metrics', type: 'metrics' },
          { title: 'Error Distribution', type: 'charts' },
          { title: 'Top Errors', type: 'table' },
          { title: 'Error Impact Analysis', type: 'analysis' },
          { title: 'Recommendations', type: 'recommendations' },
        ];
      
      case 'system':
        return [
          { title: 'System Overview', type: 'overview' },
          { title: 'System Metrics', type: 'metrics' },
          { title: 'Component Health', type: 'charts' },
          { title: 'Resource Usage', type: 'analysis' },
          { title: 'Recommendations', type: 'recommendations' },
        ];
      
      default:
        return [
          { title: 'Overview', type: 'overview' },
          { title: 'Metrics', type: 'metrics' },
          { title: 'Analysis', type: 'analysis' },
          { title: 'Recommendations', type: 'recommendations' },
        ];
    }
  }

  private generateHtmlReport(data: any, options: ReportOptions, sections: ReportSection[]): string {
    const title = options.title || `${options.type} Report`;
    const description = options.description || `Generated report for ${options.type} analysis`;
    
    let html = `
<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
        .section { margin-bottom: 30px; }
        .section h2 { color: #333; border-bottom: 1px solid #ccc; padding-bottom: 5px; }
        .metric { display: inline-block; margin: 10px; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
        .metric-value { font-size: 24px; font-weight: bold; color: #007bff; }
        .metric-label { font-size: 14px; color: #666; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f5f5f5; }
        .recommendation { background-color: #e7f3ff; padding: 15px; border-left: 4px solid #007bff; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>${title}</h1>
        <p>${description}</p>
        <p><strong>Time Range:</strong> ${options.timeRange.start.toISOString()} - ${options.timeRange.end.toISOString()}</p>
        <p><strong>Generated:</strong> ${new Date().toISOString()}</p>
    </div>
`;

    sections.forEach(section => {
      html += this.generateHtmlSection(section, data);
    });

    html += `
</body>
</html>
`;

    return html;
  }

  private generateHtmlSection(section: ReportSection, data: any): string {
    let sectionHtml = `<div class="section"><h2>${section.title}</h2>`;

    switch (section.type) {
      case 'overview':
        sectionHtml += this.generateHtmlOverview(data);
        break;
      case 'metrics':
        sectionHtml += this.generateHtmlMetrics(data);
        break;
      case 'charts':
        sectionHtml += this.generateHtmlCharts(data);
        break;
      case 'table':
        sectionHtml += this.generateHtmlTable(data);
        break;
      case 'analysis':
        sectionHtml += this.generateHtmlAnalysis(data);
        break;
      case 'recommendations':
        sectionHtml += this.generateHtmlRecommendations(data);
        break;
    }

    sectionHtml += '</div>';
    return sectionHtml;
  }

  private generateHtmlOverview(data: any): string {
    const analytics = data.analytics;
    if (!analytics) return '<p>No overview data available</p>';

    return `
<div class="overview">
    <div class="metric">
        <div class="metric-value">${analytics.overview.totalRequests}</div>
        <div class="metric-label">Total Requests</div>
    </div>
    <div class="metric">
        <div class="metric-value">${analytics.overview.totalErrors}</div>
        <div class="metric-label">Total Errors</div>
    </div>
    <div class="metric">
        <div class="metric-value">${analytics.overview.averageResponseTime.toFixed(2)}ms</div>
        <div class="metric-label">Avg Response Time</div>
    </div>
    <div class="metric">
        <div class="metric-value">${analytics.overview.errorRate.toFixed(2)}%</div>
        <div class="metric-label">Error Rate</div>
    </div>
</div>
`;
  }

  private generateHtmlMetrics(data: any): string {
    // Generate metrics HTML
    return '<p>Detailed metrics would be displayed here</p>';
  }

  private generateHtmlCharts(data: any): string {
    // Generate charts HTML (would use a charting library)
    return '<p>Charts would be displayed here</p>';
  }

  private generateHtmlTable(data: any): string {
    // Generate table HTML
    return '<p>Data table would be displayed here</p>';
  }

  private generateHtmlAnalysis(data: any): string {
    // Generate analysis HTML
    return '<p>Analysis results would be displayed here</p>';
  }

  private generateHtmlRecommendations(data: any): string {
    const recommendations = [
      'Review and optimize slow queries',
      'Implement caching for frequently accessed data',
      'Consider scaling resources during peak hours',
      'Monitor and fix recurring errors',
    ];

    let html = '<div class="recommendations">';
    recommendations.forEach(rec => {
      html += `<div class="recommendation">${rec}</div>`;
    });
    html += '</div>';

    return html;
  }

  private generateMarkdownReport(data: any, options: ReportOptions, sections: ReportSection[]): string {
    const title = options.title || `${options.type} Report`;
    const description = options.description || `Generated report for ${options.type} analysis`;
    
    let markdown = `# ${title}

${description}

**Time Range:** ${options.timeRange.start.toISOString()} - ${options.timeRange.end.toISOString()}  
**Generated:** ${new Date().toISOString()}

---

`;

    sections.forEach(section => {
      markdown += this.generateMarkdownSection(section, data);
    });

    return markdown;
  }

  private generateMarkdownSection(section: ReportSection, data: any): string {
    let sectionMd = `## ${section.title}\n\n`;

    switch (section.type) {
      case 'overview':
        sectionMd += this.generateMarkdownOverview(data);
        break;
      case 'metrics':
        sectionMd += this.generateMarkdownMetrics(data);
        break;
      case 'recommendations':
        sectionMd += this.generateMarkdownRecommendations(data);
        break;
      default:
        sectionMd += 'Section content would be generated here.\n\n';
    }

    return sectionMd;
  }

  private generateMarkdownOverview(data: any): string {
    const analytics = data.analytics;
    if (!analytics) return 'No overview data available\n\n';

    return `
| Metric | Value |
|--------|-------|
| Total Requests | ${analytics.overview.totalRequests} |
| Total Errors | ${analytics.overview.totalErrors} |
| Average Response Time | ${analytics.overview.averageResponseTime.toFixed(2)}ms |
| Error Rate | ${analytics.overview.errorRate.toFixed(2)}% |

`;
  }

  private generateMarkdownMetrics(data: any): string {
    return 'Detailed metrics would be displayed here.\n\n';
  }

  private generateMarkdownRecommendations(data: any): string {
    const recommendations = [
      'Review and optimize slow queries',
      'Implement caching for frequently accessed data',
      'Consider scaling resources during peak hours',
      'Monitor and fix recurring errors',
    ];

    let md = '';
    recommendations.forEach(rec => {
      md += `- ${rec}\n`;
    });
    md += '\n';

    return md;
  }

  private generatePdfReport(data: any, options: ReportOptions, sections: ReportSection[]): string {
    // For now, return markdown content (would use a PDF library in production)
    return this.generateMarkdownReport(data, options, sections);
  }

  private async saveHtmlReport(content: string, filePath: string): Promise<void> {
    await fs.promises.writeFile(filePath, content);
  }

  private async savePdfReport(content: string, filePath: string): Promise<void> {
    await fs.promises.writeFile(filePath, content);
  }

  private async saveMarkdownReport(content: string, filePath: string): Promise<void> {
    await fs.promises.writeFile(filePath, content);
  }

  // Public API for scheduled reports
  async scheduleReport(options: ReportOptions, cronExpression: string): Promise<string> {
    // This would integrate with a job scheduler
    this.logger.log(`Scheduling report with cron: ${cronExpression}`);
    return 'report-schedule-id';
  }

  async getExportHistory(): Promise<Array<{ id: string; type: string; createdAt: Date; filePath: string }>> {
    // This would query a database or file system for export history
    return [];
  }

  async getReportTemplates(): Promise<Array<{ id: string; name: string; type: string; sections: ReportSection[] }>> {
    // This would return available report templates
    return [];
  }

  async deleteExport(filePath: string): Promise<boolean> {
    try {
      await fs.promises.unlink(filePath);
      return true;
    } catch (error) {
      this.logger.error('Failed to delete export file:', error);
      return false;
    }
  }
}
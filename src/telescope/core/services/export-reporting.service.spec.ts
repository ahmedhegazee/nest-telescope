import { Test, TestingModule } from '@nestjs/testing';
import { ExportReportingService, ExportFormat, ReportFormat } from './export-reporting.service';
import { TelescopeService } from './telescope.service';

describe('ExportReportingService', () => {
  let service: ExportReportingService;
  let telescopeService: jest.Mocked<TelescopeService>;

  beforeEach(async () => {
    const mockTelescopeService = {
      getEntries: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportReportingService,
        {
          provide: TelescopeService,
          useValue: mockTelescopeService,
        },
      ],
    }).compile();

    service = module.get<ExportReportingService>(ExportReportingService);
    telescopeService = module.get(TelescopeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });
  });

  describe('data export', () => {
    const mockEntries = [
      {
        id: '1',
        type: 'request',
        timestamp: new Date('2023-01-01T10:00:00Z'),
        content: {
          userId: 'user-1',
          request: { path: '/api/users', method: 'GET', duration: 100 },
        },
      },
      {
        id: '2',
        type: 'query',
        timestamp: new Date('2023-01-01T10:01:00Z'),
        content: {
          userId: 'user-1',
          query: { sql: 'SELECT * FROM users', duration: 50 },
        },
      },
      {
        id: '3',
        type: 'exception',
        timestamp: new Date('2023-01-01T10:02:00Z'),
        content: {
          userId: 'user-2',
          exception: { type: 'ValidationError', message: 'Invalid input' },
        },
      },
    ];

    beforeEach(() => {
      telescopeService.getEntries.mockReturnValue(mockEntries);
    });

    it('should export data in JSON format', async () => {
      const result = await service.exportData({
        format: 'json',
        type: 'raw',
      });

      expect(result.success).toBe(true);
      expect(result.metadata.format).toBe('json');
      expect(result.metadata.recordCount).toBe(3);
      expect(result.data).toContain('"id":"1"');
      expect(result.data).toContain('"type":"request"');
    });

    it('should export data in CSV format', async () => {
      const result = await service.exportData({
        format: 'csv',
        type: 'raw',
      });

      expect(result.success).toBe(true);
      expect(result.metadata.format).toBe('csv');
      expect(result.metadata.recordCount).toBe(3);
      expect(result.data).toContain('id,type,timestamp');
    });

    it('should export data in PDF format', async () => {
      const result = await service.exportData({
        format: ExportFormat.PDF,
        types: ['request', 'query'],
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe(ExportFormat.PDF);
      expect(result.recordCount).toBe(2);
      expect(result.data).toContain('Telescope Data Export');
      expect(result.mimeType).toBe('application/pdf');
    });

    it('should filter data by type', async () => {
      const result = await service.exportData({
        format: ExportFormat.JSON,
        types: ['request'],
      });

      expect(result.recordCount).toBe(1);
      expect(result.data).toContain('"type":"request"');
      expect(result.data).not.toContain('"type":"query"');
    });

    it('should filter data by date range', async () => {
      const result = await service.exportData({
        format: ExportFormat.JSON,
        types: ['request', 'query', 'exception'],
        startDate: new Date('2023-01-01T10:00:30Z'),
        endDate: new Date('2023-01-01T10:01:30Z'),
      });

      expect(result.recordCount).toBe(1);
      expect(result.data).toContain('"id":"2"');
      expect(result.data).toContain('"type":"query"');
    });

    it('should filter data by user', async () => {
      const result = await service.exportData({
        format: ExportFormat.JSON,
        types: ['request', 'query', 'exception'],
        userId: 'user-1',
      });

      expect(result.recordCount).toBe(2);
      expect(result.data).toContain('"userId":"user-1"');
      expect(result.data).not.toContain('"userId":"user-2"');
    });

    it('should select specific fields', async () => {
      const result = await service.exportData({
        format: ExportFormat.JSON,
        types: ['request'],
        fields: ['id', 'type', 'timestamp'],
      });

      const parsedData = JSON.parse(result.data);
      expect(parsedData[0]).toHaveProperty('id');
      expect(parsedData[0]).toHaveProperty('type');
      expect(parsedData[0]).toHaveProperty('timestamp');
      expect(parsedData[0]).not.toHaveProperty('content');
    });

    it('should limit number of records', async () => {
      const result = await service.exportData({
        format: ExportFormat.JSON,
        types: ['request', 'query', 'exception'],
        limit: 2,
      });

      expect(result.recordCount).toBe(2);
      const parsedData = JSON.parse(result.data);
      expect(parsedData).toHaveLength(2);
    });

    it('should handle empty data', async () => {
      telescopeService.getEntries.mockReturnValue([]);

      const result = await service.exportData({
        format: ExportFormat.JSON,
        types: ['request'],
      });

      expect(result.success).toBe(true);
      expect(result.recordCount).toBe(0);
      expect(result.data).toBe('[]');
    });

    it('should handle export errors gracefully', async () => {
      telescopeService.getEntries.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await service.exportData({
        format: ExportFormat.JSON,
        types: ['request'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database error');
    });
  });

  describe('report generation', () => {
    const mockEntries = [
      {
        id: '1',
        type: 'request',
        timestamp: new Date('2023-01-01T10:00:00Z'),
        content: {
          userId: 'user-1',
          request: { path: '/api/users', method: 'GET', duration: 100 },
        },
      },
      {
        id: '2',
        type: 'query',
        timestamp: new Date('2023-01-01T10:01:00Z'),
        content: {
          userId: 'user-1',
          query: { sql: 'SELECT * FROM users', duration: 50 },
        },
      },
      {
        id: '3',
        type: 'exception',
        timestamp: new Date('2023-01-01T10:02:00Z'),
        content: {
          userId: 'user-2',
          exception: { type: 'ValidationError', message: 'Invalid input' },
        },
      },
    ];

    beforeEach(() => {
      telescopeService.getEntries.mockReturnValue(mockEntries);
    });

    it('should generate performance report in HTML format', async () => {
      const result = await service.generateReport({
        type: 'performance',
        format: ReportFormat.HTML,
        title: 'Performance Report',
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe(ReportFormat.HTML);
      expect(result.content).toContain('<html>');
      expect(result.content).toContain('Performance Report');
      expect(result.content).toContain('Average Response Time');
      expect(result.mimeType).toBe('text/html');
    });

    it('should generate user activity report in PDF format', async () => {
      const result = await service.generateReport({
        type: 'user-activity',
        format: ReportFormat.PDF,
        title: 'User Activity Report',
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe(ReportFormat.PDF);
      expect(result.content).toContain('User Activity Report');
      expect(result.content).toContain('Total Users');
      expect(result.mimeType).toBe('application/pdf');
    });

    it('should generate error analysis report', async () => {
      const result = await service.generateReport({
        type: 'error-analysis',
        format: ReportFormat.HTML,
        title: 'Error Analysis Report',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Error Analysis Report');
      expect(result.content).toContain('Total Errors');
      expect(result.content).toContain('ValidationError');
    });

    it('should generate system health report', async () => {
      const result = await service.generateReport({
        type: 'system-health',
        format: ReportFormat.HTML,
        title: 'System Health Report',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('System Health Report');
      expect(result.content).toContain('Health Score');
      expect(result.content).toContain('System Status');
    });

    it('should filter report by date range', async () => {
      const result = await service.generateReport({
        type: 'performance',
        format: ReportFormat.HTML,
        title: 'Performance Report',
        startDate: new Date('2023-01-01T10:00:30Z'),
        endDate: new Date('2023-01-01T10:01:30Z'),
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Performance Report');
      // Should only include the query entry within the date range
      expect(result.content).toContain('Total Requests: 0');
      expect(result.content).toContain('Total Queries: 1');
    });

    it('should include custom sections in report', async () => {
      const result = await service.generateReport({
        type: 'performance',
        format: ReportFormat.HTML,
        title: 'Custom Performance Report',
        includeCharts: true,
        includeTables: true,
        includeRecommendations: true,
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Custom Performance Report');
      expect(result.content).toContain('Charts');
      expect(result.content).toContain('Tables');
      expect(result.content).toContain('Recommendations');
    });

    it('should handle report generation errors gracefully', async () => {
      telescopeService.getEntries.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await service.generateReport({
        type: 'performance',
        format: ReportFormat.HTML,
        title: 'Performance Report',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database error');
    });
  });

  describe('data transformation', () => {
    it('should transform data to CSV format correctly', () => {
      const data = [
        { id: '1', type: 'request', timestamp: new Date(), content: 'test' },
        { id: '2', type: 'query', timestamp: new Date(), content: 'test2' },
      ];

      const csv = (service as any).transformToCSV(data);

      expect(csv).toContain('id,type,timestamp,content');
      expect(csv).toContain('1,request');
      expect(csv).toContain('2,query');
    });

    it('should handle nested objects in CSV transformation', () => {
      const data = [
        {
          id: '1',
          type: 'request',
          content: {
            request: { path: '/api/test', method: 'GET' },
            user: { id: 'user-1', name: 'John' },
          },
        },
      ];

      const csv = (service as any).transformToCSV(data);

      expect(csv).toContain('id,type,content');
      expect(csv).toContain('1,request');
      expect(csv).toContain('{"request":{"path":"/api/test","method":"GET"}');
    });

    it('should generate PDF content correctly', () => {
      const data = [
        { id: '1', type: 'request', timestamp: new Date() },
        { id: '2', type: 'query', timestamp: new Date() },
      ];

      const pdf = (service as any).generatePDFContent(data, 'Test Export');

      expect(pdf).toContain('Telescope Data Export');
      expect(pdf).toContain('Test Export');
      expect(pdf).toContain('Total Records: 2');
      expect(pdf).toContain('request');
      expect(pdf).toContain('query');
    });
  });

  describe('report templates', () => {
    it('should use performance report template', () => {
      const analytics = {
        performanceAnalytics: {
          totalRequests: 100,
          averageResponseTime: 150,
          slowestEndpoints: [{ path: '/api/slow', avgTime: 500 }],
        },
      };

      const html = (service as any).generatePerformanceReportHTML(analytics, 'Performance Report');

      expect(html).toContain('Performance Report');
      expect(html).toContain('Total Requests: 100');
      expect(html).toContain('Average Response Time: 150ms');
      expect(html).toContain('/api/slow');
    });

    it('should use user activity report template', () => {
      const analytics = {
        userAnalytics: {
          totalUsers: 50,
          activeUsers: 30,
          topUsers: [{ userId: 'user-1', requestCount: 25 }],
        },
      };

      const html = (service as any).generateUserActivityReportHTML(
        analytics,
        'User Activity Report',
      );

      expect(html).toContain('User Activity Report');
      expect(html).toContain('Total Users: 50');
      expect(html).toContain('Active Users: 30');
      expect(html).toContain('user-1');
    });

    it('should use error analysis report template', () => {
      const analytics = {
        errorAnalytics: {
          totalErrors: 10,
          errorsByType: [{ type: 'ValidationError', count: 5 }],
          topErrors: [{ message: 'Invalid input', count: 3 }],
        },
      };

      const html = (service as any).generateErrorAnalysisReportHTML(
        analytics,
        'Error Analysis Report',
      );

      expect(html).toContain('Error Analysis Report');
      expect(html).toContain('Total Errors: 10');
      expect(html).toContain('ValidationError');
      expect(html).toContain('Invalid input');
    });
  });

  describe('utility methods', () => {
    it('should escape HTML characters', () => {
      const escaped = (service as any).escapeHtml('<script>alert("xss")</script>');
      expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('should format dates consistently', () => {
      const date = new Date('2023-01-01T10:00:00Z');
      const formatted = (service as any).formatDate(date);
      expect(formatted).toBe('2023-01-01 10:00:00');
    });

    it('should calculate file size', () => {
      const size = (service as any).calculateFileSize('Hello World');
      expect(size).toBe(11);
    });

    it('should generate unique filename', () => {
      const filename = (service as any).generateFilename('test', 'json');
      expect(filename).toMatch(/^test-\d{4}-\d{2}-\d{2}-\d{6}\.json$/);
    });
  });
});

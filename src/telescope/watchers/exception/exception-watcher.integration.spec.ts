import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ExceptionWatcherModule } from './exception-watcher.module';
import { ExceptionWatcherService } from './exception-watcher.service';
import { ExceptionWatcherFilter } from './exception-watcher.filter';
import { TelescopeService } from '../../core/services/telescope.service';
import { Controller, Get, HttpException, HttpStatus, Module } from '@nestjs/common';
import * as request from 'supertest';

@Controller('test')
class TestController {
  @Get('success')
  getSuccess() {
    return { message: 'success' };
  }

  @Get('http-error')
  getHttpError() {
    throw new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
  }

  @Get('server-error')
  getServerError() {
    throw new Error('Internal Server Error');
  }

  @Get('validation-error')
  getValidationError() {
    const error = new Error('Validation failed');
    error.name = 'ValidationError';
    throw error;
  }

  @Get('database-error')
  getDatabaseError() {
    const error = new Error('Database connection failed');
    error.name = 'DatabaseError';
    throw error;
  }
}

@Module({
  controllers: [TestController],
})
class TestModule {}

describe('ExceptionWatcher Integration', () => {
  let app: INestApplication;
  let exceptionWatcherService: ExceptionWatcherService;
  let telescopeService: jest.Mocked<TelescopeService>;

  beforeEach(async () => {
    const mockTelescopeService = {
      record: jest.fn(),
      getEntries: jest.fn(),
      clearEntries: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ExceptionWatcherModule.forRoot({
          enabled: true,
          captureStackTrace: true,
          enableErrorClassification: true,
          groupSimilarErrors: true,
          enableRealTimeAlerts: true,
          captureHeaders: true,
          captureBody: false,
          captureParams: true,
          captureQuery: true,
          sampleRate: 100, // Capture all exceptions for testing
        }),
        TestModule,
      ],
      providers: [
        {
          provide: TelescopeService,
          useValue: mockTelescopeService,
        },
      ],
    }).compile();

    app = module.createNestApplication();
    exceptionWatcherService = module.get<ExceptionWatcherService>(ExceptionWatcherService);
    telescopeService = module.get(TelescopeService);

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('HTTP Exception Handling', () => {
    it('should track HTTP exceptions with full context', async () => {
      const response = await request(app.getHttpServer())
        .get('/test/http-error')
        .expect(400);

      expect(response.body).toEqual({
        statusCode: 400,
        timestamp: expect.any(String),
        path: '/test/http-error',
        message: 'Bad Request',
        error: 'Bad Request',
        traceId: undefined,
        requestId: undefined,
      });

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'exception',
          content: expect.objectContaining({
            exception: expect.objectContaining({
              type: 'HttpException',
              message: 'Bad Request',
              statusCode: 400,
            }),
            request: expect.objectContaining({
              method: 'GET',
              url: '/test/http-error',
              path: '/test/http-error',
            }),
            response: expect.objectContaining({
              statusCode: 400,
            }),
          }),
        })
      );
    });

    it('should track server errors as 500', async () => {
      await request(app.getHttpServer())
        .get('/test/server-error')
        .expect(500);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'exception',
          content: expect.objectContaining({
            exception: expect.objectContaining({
              type: 'Error',
              message: 'Internal Server Error',
              statusCode: 500,
            }),
          }),
        })
      );
    });

    it('should capture request headers and parameters', async () => {
      await request(app.getHttpServer())
        .get('/test/http-error?filter=test&sort=desc')
        .set('User-Agent', 'test-agent')
        .set('X-Custom-Header', 'custom-value')
        .expect(400);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            request: expect.objectContaining({
              userAgent: 'test-agent',
              query: expect.objectContaining({
                filter: 'test',
                sort: 'desc',
              }),
              headers: expect.objectContaining({
                'x-custom-header': 'custom-value',
              }),
            }),
          }),
        })
      );
    });
  });

  describe('Error Classification', () => {
    it('should classify validation errors correctly', async () => {
      await request(app.getHttpServer())
        .get('/test/validation-error')
        .expect(500);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            exception: expect.objectContaining({
              category: 'validation_error',
              severity: 'high',
            }),
          }),
        })
      );
    });

    it('should classify database errors correctly', async () => {
      await request(app.getHttpServer())
        .get('/test/database-error')
        .expect(500);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            exception: expect.objectContaining({
              category: 'database_error',
              severity: 'high',
            }),
          }),
        })
      );
    });
  });

  describe('Error Grouping', () => {
    it('should group similar errors', async () => {
      // Make multiple requests to the same error endpoint
      await request(app.getHttpServer()).get('/test/database-error').expect(500);
      await request(app.getHttpServer()).get('/test/database-error').expect(500);
      await request(app.getHttpServer()).get('/test/database-error').expect(500);

      // Wait for grouping to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const groups = exceptionWatcherService.getExceptionGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].count).toBe(3);
      expect(groups[0].errorType).toBe('Error');
      expect(groups[0].errorMessage).toBe('Database connection failed');
    });
  });

  describe('Metrics Collection', () => {
    it('should collect and update metrics', async () => {
      const initialMetrics = exceptionWatcherService.getMetrics();
      expect(initialMetrics.totalExceptions).toBe(0);

      // Generate different types of exceptions
      await request(app.getHttpServer()).get('/test/http-error').expect(400);
      await request(app.getHttpServer()).get('/test/server-error').expect(500);
      await request(app.getHttpServer()).get('/test/validation-error').expect(500);

      const updatedMetrics = exceptionWatcherService.getMetrics();
      expect(updatedMetrics.totalExceptions).toBe(3);
      expect(updatedMetrics.uniqueExceptions).toBe(3);
      expect(updatedMetrics.highSeverityErrors).toBeGreaterThan(0);
    });

    it('should track top errors', async () => {
      // Generate multiple occurrences of the same error
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer()).get('/test/database-error').expect(500);
      }

      // Generate fewer occurrences of different errors
      await request(app.getHttpServer()).get('/test/validation-error').expect(500);
      await request(app.getHttpServer()).get('/test/validation-error').expect(500);

      const metrics = exceptionWatcherService.getMetrics();
      expect(metrics.topErrors).toHaveLength(2);
      expect(metrics.topErrors[0].count).toBe(5); // Database errors should be first
      expect(metrics.topErrors[1].count).toBe(2); // Validation errors should be second
    });
  });

  describe('Real-time Alerts', () => {
    it('should generate alerts for high error rates', (done) => {
      const alertConfig = {
        enabled: true,
        alertThresholds: {
          errorRate: 0.1, // Very low threshold for testing
          criticalErrors: 10,
          timeWindow: 60000,
        },
      };

      const alertModule = ExceptionWatcherModule.forRoot(alertConfig);
      
      exceptionWatcherService.getAlertsStream().subscribe(alert => {
        expect(alert.type).toBe('error_rate');
        expect(alert.severity).toBe('high');
        done();
      });

      // Generate multiple errors quickly
      Promise.all([
        request(app.getHttpServer()).get('/test/server-error'),
        request(app.getHttpServer()).get('/test/server-error'),
        request(app.getHttpServer()).get('/test/server-error'),
      ]);
    });

    it('should generate alerts for new error types', (done) => {
      exceptionWatcherService.getAlertsStream().subscribe(alert => {
        if (alert.type === 'new_error') {
          expect(alert.severity).toBe('medium');
          expect(alert.message).toContain('New error type detected');
          done();
        }
      });

      // Generate a new type of error
      request(app.getHttpServer()).get('/test/validation-error').expect(500);
    });
  });

  describe('Performance Impact', () => {
    it('should have minimal performance impact', async () => {
      const startTime = Date.now();
      
      // Make multiple requests
      const requests = Array.from({ length: 100 }, () =>
        request(app.getHttpServer()).get('/test/success').expect(200)
      );

      await Promise.all(requests);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete 100 requests in reasonable time
      expect(duration).toBeLessThan(5000); // 5 seconds
    });
  });

  describe('Error Recovery', () => {
    it('should handle telescope service errors gracefully', async () => {
      telescopeService.record.mockImplementation(() => {
        throw new Error('Telescope service error');
      });

      // Should not crash the application
      await request(app.getHttpServer())
        .get('/test/server-error')
        .expect(500);

      // Should still return proper error response
      const response = await request(app.getHttpServer())
        .get('/test/http-error')
        .expect(400);

      expect(response.body.statusCode).toBe(400);
    });
  });

  describe('Configuration', () => {
    it('should respect disabled configuration', async () => {
      const disabledApp = await Test.createTestingModule({
        imports: [
          ExceptionWatcherModule.forRoot({
            enabled: false,
          }),
          TestModule,
        ],
        providers: [
          {
            provide: TelescopeService,
            useValue: telescopeService,
          },
        ],
      }).compile();

      const testApp = disabledApp.createNestApplication();
      await testApp.init();

      telescopeService.record.mockClear();

      await request(testApp.getHttpServer())
        .get('/test/server-error')
        .expect(500);

      expect(telescopeService.record).not.toHaveBeenCalled();

      await testApp.close();
    });

    it('should respect sampling rate', async () => {
      const samplingApp = await Test.createTestingModule({
        imports: [
          ExceptionWatcherModule.forRoot({
            enabled: true,
            sampleRate: 0, // 0% sampling
          }),
          TestModule,
        ],
        providers: [
          {
            provide: TelescopeService,
            useValue: telescopeService,
          },
        ],
      }).compile();

      const testApp = samplingApp.createNestApplication();
      await testApp.init();

      telescopeService.record.mockClear();

      await request(testApp.getHttpServer())
        .get('/test/server-error')
        .expect(500);

      expect(telescopeService.record).not.toHaveBeenCalled();

      await testApp.close();
    });
  });

  describe('Async Configuration', () => {
    it('should support async configuration', async () => {
      const asyncApp = await Test.createTestingModule({
        imports: [
          ExceptionWatcherModule.forRootAsync({
            useFactory: () => ({
              enabled: true,
              captureStackTrace: true,
              enableErrorClassification: true,
            }),
          }),
          TestModule,
        ],
        providers: [
          {
            provide: TelescopeService,
            useValue: telescopeService,
          },
        ],
      }).compile();

      const testApp = asyncApp.createNestApplication();
      await testApp.init();

      await request(testApp.getHttpServer())
        .get('/test/server-error')
        .expect(500);

      expect(telescopeService.record).toHaveBeenCalled();

      await testApp.close();
    });
  });
});
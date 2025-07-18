import { Test, TestingModule } from '@nestjs/testing';
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ExceptionWatcherFilter, ErrorSeverity, ErrorCategory } from './exception-watcher.filter';
import { ExceptionWatcherService } from './exception-watcher.service';
import { ExceptionWatcherConfig, defaultExceptionWatcherConfig } from './exception-watcher.config';

describe('ExceptionWatcherFilter', () => {
  let filter: ExceptionWatcherFilter;
  let exceptionWatcherService: jest.Mocked<ExceptionWatcherService>;
  let mockArgumentsHost: jest.Mocked<ArgumentsHost>;
  let mockRequest: any;
  let mockResponse: any;

  beforeEach(async () => {
    mockRequest = {
      id: 'req-123',
      method: 'GET',
      url: '/test',
      path: '/test',
      headers: {
        'user-agent': 'test-agent',
        'authorization': 'Bearer token123',
        'x-custom-header': 'custom-value',
      },
      body: {
        username: 'testuser',
        password: 'secret123',
        email: 'test@example.com',
      },
      params: { id: '123' },
      query: { filter: 'active' },
      ip: '127.0.0.1',
      user: { id: 'user-456' },
      session: { id: 'session-789' },
      startTime: Date.now() - 100,
      traceId: 'trace-abc',
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      getHeaders: jest.fn().mockReturnValue({
        'content-type': 'application/json',
        'x-response-time': '100ms',
      }),
    };

    const mockHttpContext = {
      getRequest: jest.fn().mockReturnValue(mockRequest),
      getResponse: jest.fn().mockReturnValue(mockResponse),
    };

    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue(mockHttpContext),
      getType: jest.fn().mockReturnValue('http'),
      getArgs: jest.fn(),
      getArgByIndex: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
    };

    const mockExceptionWatcherService = {
      trackException: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExceptionWatcherFilter,
        {
          provide: ExceptionWatcherService,
          useValue: mockExceptionWatcherService,
        },
        {
          provide: 'EXCEPTION_WATCHER_CONFIG',
          useValue: defaultExceptionWatcherConfig,
        },
      ],
    }).compile();

    filter = module.get<ExceptionWatcherFilter>(ExceptionWatcherFilter);
    exceptionWatcherService = module.get(ExceptionWatcherService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('exception catching', () => {
    it('should catch and process HttpException', () => {
      const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockArgumentsHost);

      expect(exceptionWatcherService.trackException).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: 'HttpException',
          errorMessage: 'Bad Request',
          statusCode: HttpStatus.BAD_REQUEST,
        })
      );

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Bad Request',
        })
      );
    });

    it('should catch and process generic Error', () => {
      const exception = new Error('Internal server error');

      filter.catch(exception, mockArgumentsHost);

      expect(exceptionWatcherService.trackException).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: 'Error',
          errorMessage: 'Internal server error',
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        })
      );

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('should not process exception if disabled', () => {
      const disabledConfig = {
        ...defaultExceptionWatcherConfig,
        enabled: false,
      };

      const disabledFilter = new ExceptionWatcherFilter(
        exceptionWatcherService,
        disabledConfig
      );

      const exception = new Error('Test error');

      disabledFilter.catch(exception, mockArgumentsHost);

      expect(exceptionWatcherService.trackException).not.toHaveBeenCalled();
    });

    it('should respect sampling rate', () => {
      const samplingConfig = {
        ...defaultExceptionWatcherConfig,
        sampleRate: 0, // 0% sampling
      };

      const samplingFilter = new ExceptionWatcherFilter(
        exceptionWatcherService,
        samplingConfig
      );

      const exception = new Error('Test error');

      samplingFilter.catch(exception, mockArgumentsHost);

      expect(exceptionWatcherService.trackException).not.toHaveBeenCalled();
    });
  });

  describe('context extraction', () => {
    it('should extract complete HTTP context', () => {
      const exception = new Error('Test error');

      filter.catch(exception, mockArgumentsHost);

      const capturedContext = exceptionWatcherService.trackException.mock.calls[0][0];

      expect(capturedContext.request).toEqual(
        expect.objectContaining({
          id: 'req-123',
          method: 'GET',
          url: '/test',
          path: '/test',
          userAgent: 'test-agent',
          ip: '127.0.0.1',
          userId: 'user-456',
          sessionId: 'session-789',
        })
      );

      expect(capturedContext.response).toEqual(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          duration: expect.any(Number),
        })
      );

      expect(capturedContext.traceId).toBe('trace-abc');
      expect(capturedContext.requestId).toBe('req-123');
      expect(capturedContext.userId).toBe('user-456');
      expect(capturedContext.sessionId).toBe('session-789');
    });

    it('should sanitize sensitive headers', () => {
      const exception = new Error('Test error');

      filter.catch(exception, mockArgumentsHost);

      const capturedContext = exceptionWatcherService.trackException.mock.calls[0][0];

      expect(capturedContext.request?.headers?.authorization).toBe('[REDACTED]');
      expect(capturedContext.request?.headers?.['x-custom-header']).toBe('custom-value');
    });

    it('should sanitize sensitive body fields', () => {
      const sanitizingConfig = {
        ...defaultExceptionWatcherConfig,
        captureBody: true,
      };

      const sanitizingFilter = new ExceptionWatcherFilter(
        exceptionWatcherService,
        sanitizingConfig
      );

      const exception = new Error('Test error');

      sanitizingFilter.catch(exception, mockArgumentsHost);

      const capturedContext = exceptionWatcherService.trackException.mock.calls[0][0];

      expect(capturedContext.request?.body?.password).toBe('[REDACTED]');
      expect(capturedContext.request?.body?.email).toBe('test@example.com');
      expect(capturedContext.request?.body?.username).toBe('testuser');
    });

    it('should extract environment context when enabled', () => {
      const exception = new Error('Test error');

      filter.catch(exception, mockArgumentsHost);

      const capturedContext = exceptionWatcherService.trackException.mock.calls[0][0];

      expect(capturedContext.environment).toEqual(
        expect.objectContaining({
          nodeVersion: expect.any(String),
          platform: expect.any(String),
          hostname: expect.any(String),
          memory: expect.any(Object),
          uptime: expect.any(Number),
        })
      );
    });

    it('should extract performance context when enabled', () => {
      const exception = new Error('Test error');

      filter.catch(exception, mockArgumentsHost);

      const capturedContext = exceptionWatcherService.trackException.mock.calls[0][0];

      expect(capturedContext.performance).toEqual(
        expect.objectContaining({
          memoryUsage: expect.any(Number),
          cpuUsage: expect.any(Number),
        })
      );
    });
  });

  describe('stack trace parsing', () => {
    it('should parse stack trace frames', () => {
      const exception = new Error('Test error');
      exception.stack = `Error: Test error
    at Object.testFunction (/path/to/file.js:10:5)
    at /path/to/another/file.js:20:10
    at Function.anonymous (/path/to/third/file.js:30:15)`;

      filter.catch(exception, mockArgumentsHost);

      const capturedContext = exceptionWatcherService.trackException.mock.calls[0][0];

      expect(capturedContext.stackTrace).toBe(exception.stack);
      expect(capturedContext.stackFrames).toHaveLength(3);
      expect(capturedContext.stackFrames?.[0]).toEqual({
        function: 'Object.testFunction',
        file: '/path/to/file.js',
        line: 10,
        column: 5,
      });
    });

    it('should handle malformed stack traces', () => {
      const exception = new Error('Test error');
      exception.stack = 'Invalid stack trace format';

      filter.catch(exception, mockArgumentsHost);

      const capturedContext = exceptionWatcherService.trackException.mock.calls[0][0];

      expect(capturedContext.stackTrace).toBe(exception.stack);
      expect(capturedContext.stackFrames).toEqual([]);
    });

    it('should limit stack trace depth', () => {
      const limitedConfig = {
        ...defaultExceptionWatcherConfig,
        maxStackTraceDepth: 2,
      };

      const limitedFilter = new ExceptionWatcherFilter(
        exceptionWatcherService,
        limitedConfig
      );

      const exception = new Error('Test error');
      exception.stack = `Error: Test error
    at Function1 (/file1.js:1:1)
    at Function2 (/file2.js:2:2)
    at Function3 (/file3.js:3:3)
    at Function4 (/file4.js:4:4)`;

      limitedFilter.catch(exception, mockArgumentsHost);

      const capturedContext = exceptionWatcherService.trackException.mock.calls[0][0];

      expect(capturedContext.stackFrames).toHaveLength(2);
    });
  });

  describe('error classification', () => {
    it('should classify HTTP errors correctly', () => {
      const authException = new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
      const validationException = new HttpException('Validation failed', HttpStatus.UNPROCESSABLE_ENTITY);
      const serverException = new HttpException('Internal error', HttpStatus.INTERNAL_SERVER_ERROR);

      filter.catch(authException, mockArgumentsHost);
      filter.catch(validationException, mockArgumentsHost);
      filter.catch(serverException, mockArgumentsHost);

      const calls = exceptionWatcherService.trackException.mock.calls;

      // Check authentication error
      expect(calls[0][0].classification?.category).toBe(ErrorCategory.AUTHENTICATION_ERROR);
      expect(calls[0][0].classification?.severity).toBe(ErrorSeverity.MEDIUM);

      // Check validation error
      expect(calls[1][0].classification?.category).toBe(ErrorCategory.VALIDATION_ERROR);
      expect(calls[1][0].classification?.severity).toBe(ErrorSeverity.MEDIUM);

      // Check server error
      expect(calls[2][0].classification?.category).toBe(ErrorCategory.SERVER_ERROR);
      expect(calls[2][0].classification?.severity).toBe(ErrorSeverity.HIGH);
    });

    it('should classify database errors', () => {
      const databaseException = new Error('Database connection failed');
      databaseException.name = 'DatabaseError';

      filter.catch(databaseException, mockArgumentsHost);

      const capturedContext = exceptionWatcherService.trackException.mock.calls[0][0];

      expect(capturedContext.classification?.category).toBe(ErrorCategory.DATABASE_ERROR);
      expect(capturedContext.classification?.severity).toBe(ErrorSeverity.HIGH);
    });

    it('should generate fingerprints for similar errors', () => {
      const error1 = new Error('Database connection failed');
      const error2 = new Error('Database connection failed');

      filter.catch(error1, mockArgumentsHost);
      filter.catch(error2, mockArgumentsHost);

      const calls = exceptionWatcherService.trackException.mock.calls;
      const fingerprint1 = calls[0][0].classification?.fingerprint;
      const fingerprint2 = calls[1][0].classification?.fingerprint;

      expect(fingerprint1).toBe(fingerprint2);
    });

    it('should generate group IDs for similar errors', () => {
      const error1 = new Error('Validation failed for field X');
      const error2 = new Error('Validation failed for field Y');

      filter.catch(error1, mockArgumentsHost);
      filter.catch(error2, mockArgumentsHost);

      const calls = exceptionWatcherService.trackException.mock.calls;
      const groupId1 = calls[0][0].classification?.groupId;
      const groupId2 = calls[1][0].classification?.groupId;

      expect(groupId1).toBe(groupId2);
    });
  });

  describe('error exclusion', () => {
    it('should exclude errors by type', () => {
      const exclusionConfig = {
        ...defaultExceptionWatcherConfig,
        excludeErrorTypes: ['ValidationError'],
      };

      const exclusionFilter = new ExceptionWatcherFilter(
        exceptionWatcherService,
        exclusionConfig
      );

      const validationError = new Error('Validation failed');
      validationError.name = 'ValidationError';

      exclusionFilter.catch(validationError, mockArgumentsHost);

      expect(exceptionWatcherService.trackException).not.toHaveBeenCalled();
    });

    it('should exclude errors by message', () => {
      const exclusionConfig = {
        ...defaultExceptionWatcherConfig,
        excludeErrorMessages: ['timeout'],
      };

      const exclusionFilter = new ExceptionWatcherFilter(
        exceptionWatcherService,
        exclusionConfig
      );

      const timeoutError = new Error('Connection timeout occurred');

      exclusionFilter.catch(timeoutError, mockArgumentsHost);

      expect(exceptionWatcherService.trackException).not.toHaveBeenCalled();
    });
  });

  describe('non-HTTP contexts', () => {
    it('should handle non-HTTP exceptions', () => {
      const nonHttpHost = {
        ...mockArgumentsHost,
        getType: jest.fn().mockReturnValue('rpc'),
      };

      const exception = new Error('RPC error');

      filter.catch(exception, nonHttpHost);

      expect(exceptionWatcherService.trackException).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: 'Error',
          errorMessage: 'RPC error',
          request: undefined,
          response: undefined,
        })
      );
    });
  });

  describe('body size limitation', () => {
    it('should truncate large request bodies', () => {
      const largeBodyConfig = {
        ...defaultExceptionWatcherConfig,
        captureBody: true,
        maxContextSize: 100, // Small size for testing
      };

      const largeBodyFilter = new ExceptionWatcherFilter(
        exceptionWatcherService,
        largeBodyConfig
      );

      const largeBody = { data: 'x'.repeat(1000) };
      mockRequest.body = largeBody;

      const exception = new Error('Test error');

      largeBodyFilter.catch(exception, mockArgumentsHost);

      const capturedContext = exceptionWatcherService.trackException.mock.calls[0][0];

      expect(capturedContext.request?.body).toEqual({
        _truncated: true,
        _size: expect.any(Number),
      });
    });
  });

  describe('error handling', () => {
    it('should handle filter errors gracefully', () => {
      exceptionWatcherService.trackException.mockImplementation(() => {
        throw new Error('Service error');
      });

      const exception = new Error('Test error');

      expect(() => filter.catch(exception, mockArgumentsHost)).not.toThrow();
    });

    it('should handle missing request properties', () => {
      const incompleteRequest = {
        method: 'GET',
        // Missing other properties
      };

      mockArgumentsHost.switchToHttp().getRequest.mockReturnValue(incompleteRequest);

      const exception = new Error('Test error');

      expect(() => filter.catch(exception, mockArgumentsHost)).not.toThrow();

      const capturedContext = exceptionWatcherService.trackException.mock.calls[0][0];

      expect(capturedContext.request?.method).toBe('GET');
      expect(capturedContext.request?.url).toBeUndefined();
      expect(capturedContext.request?.headers).toBeUndefined();
    });
  });
});
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { RequestWatcherInterceptor } from './request-watcher.interceptor';
import { RequestWatcherService } from './request-watcher.service';

describe('RequestWatcherInterceptor', () => {
  let interceptor: RequestWatcherInterceptor;
  let requestWatcherService: jest.Mocked<RequestWatcherService>;

  beforeEach(async () => {
    const mockRequestWatcherService = {
      shouldSampleRequest: jest.fn().mockReturnValue(true),
      getExcludedPaths: jest.fn().mockReturnValue(['/health', '/metrics']),
      shouldMaskBody: jest.fn().mockReturnValue(false),
      shouldLogSuccessfulResponseBodies: jest.fn().mockReturnValue(false),
      trackRequest: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestWatcherInterceptor,
        {
          provide: RequestWatcherService,
          useValue: mockRequestWatcherService,
        },
      ],
    }).compile();

    interceptor = module.get<RequestWatcherInterceptor>(RequestWatcherInterceptor);
    requestWatcherService = module.get(RequestWatcherService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('intercept', () => {
    it('should track successful request', (done) => {
      const mockRequest = {
        method: 'GET',
        originalUrl: '/api/users',
        path: '/api/users',
        headers: {
          'user-agent': 'test-agent',
          'x-forwarded-for': '192.168.1.1'
        },
        query: { page: 1 },
        body: null,
        cookies: {},
        connection: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1'
      };

      const mockResponse = {
        statusCode: 200,
        getHeaders: jest.fn().mockReturnValue({
          'content-type': 'application/json',
          'content-length': '100'
        }),
        get: jest.fn().mockReturnValue('100')
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse)
        })
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(of({ users: [] }))
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: (result) => {
          expect(result).toEqual({ users: [] });
          expect(requestWatcherService.trackRequest).toHaveBeenCalledWith(
            expect.objectContaining({
              method: 'GET',
              url: '/api/users',
              ip: '127.0.0.1',
              userAgent: 'test-agent',
              query: { page: 1 }
            }),
            expect.objectContaining({
              statusCode: 200,
              duration: expect.any(Number)
            }),
            null
          );
          done();
        },
        error: done
      });
    });

    it('should track error request', (done) => {
      const mockRequest = {
        method: 'POST',
        originalUrl: '/api/users',
        path: '/api/users',
        headers: { 'user-agent': 'test-agent' },
        query: {},
        body: { name: 'test' },
        cookies: {},
        connection: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1'
      };

      const mockResponse = {
        statusCode: 500,
        getHeaders: jest.fn().mockReturnValue({
          'content-type': 'application/json'
        }),
        get: jest.fn().mockReturnValue(null)
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse)
        })
      } as unknown as ExecutionContext;

      const error = new Error('Database connection failed');
      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(throwError(() => error))
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: () => done.fail('Should have thrown error'),
        error: (err) => {
          expect(err).toBe(error);
          expect(requestWatcherService.trackRequest).toHaveBeenCalledWith(
            expect.objectContaining({
              method: 'POST',
              url: '/api/users',
              body: { name: 'test' }
            }),
            expect.objectContaining({
              statusCode: 500
            }),
            error
          );
          done();
        }
      });
    });

    it('should skip tracking for excluded paths', (done) => {
      const mockRequest = {
        method: 'GET',
        originalUrl: '/health',
        path: '/health',
        headers: {},
        query: {},
        body: null,
        cookies: {},
        connection: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1'
      };

      const mockResponse = {
        statusCode: 200,
        getHeaders: jest.fn().mockReturnValue({}),
        get: jest.fn().mockReturnValue(null)
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse)
        })
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(of('OK'))
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: (result) => {
          expect(result).toBe('OK');
          expect(requestWatcherService.trackRequest).not.toHaveBeenCalled();
          done();
        },
        error: done
      });
    });

    it('should skip tracking when sampling returns false', (done) => {
      requestWatcherService.shouldSampleRequest.mockReturnValue(false);

      const mockRequest = {
        method: 'GET',
        originalUrl: '/api/test',
        path: '/api/test',
        headers: {},
        query: {},
        body: null,
        cookies: {},
        connection: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1'
      };

      const mockResponse = {
        statusCode: 200,
        getHeaders: jest.fn().mockReturnValue({}),
        get: jest.fn().mockReturnValue(null)
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse)
        })
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(of('OK'))
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: (result) => {
          expect(result).toBe('OK');
          expect(requestWatcherService.trackRequest).not.toHaveBeenCalled();
          done();
        },
        error: done
      });
    });
  });

  describe('sanitization', () => {
    it('should sanitize sensitive headers', (done) => {
      const mockRequest = {
        method: 'GET',
        originalUrl: '/api/users',
        path: '/api/users',
        headers: {
          'authorization': 'Bearer token123',
          'cookie': 'session=abc123',
          'x-api-key': 'secret-key',
          'user-agent': 'test-agent'
        },
        query: {},
        body: null,
        cookies: {},
        connection: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1'
      };

      const mockResponse = {
        statusCode: 200,
        getHeaders: jest.fn().mockReturnValue({}),
        get: jest.fn().mockReturnValue(null)
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse)
        })
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(of({}))
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: () => {
          expect(requestWatcherService.trackRequest).toHaveBeenCalledWith(
            expect.objectContaining({
              headers: expect.objectContaining({
                'authorization': '[REDACTED]',
                'cookie': '[REDACTED]',
                'x-api-key': '[REDACTED]',
                'user-agent': 'test-agent'
              })
            }),
            expect.any(Object),
            null
          );
          done();
        },
        error: done
      });
    });

    it('should sanitize sensitive query parameters', (done) => {
      const mockRequest = {
        method: 'GET',
        originalUrl: '/api/users?token=secret123&page=1',
        path: '/api/users',
        headers: {},
        query: {
          token: 'secret123',
          page: '1',
          password: 'hidden'
        },
        body: null,
        cookies: {},
        connection: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1'
      };

      const mockResponse = {
        statusCode: 200,
        getHeaders: jest.fn().mockReturnValue({}),
        get: jest.fn().mockReturnValue(null)
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse)
        })
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(of({}))
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: () => {
          expect(requestWatcherService.trackRequest).toHaveBeenCalledWith(
            expect.objectContaining({
              query: expect.objectContaining({
                token: '[REDACTED]',
                page: '1',
                password: '[REDACTED]'
              })
            }),
            expect.any(Object),
            null
          );
          done();
        },
        error: done
      });
    });

    it('should sanitize sensitive request body', (done) => {
      const mockRequest = {
        method: 'POST',
        originalUrl: '/api/login',
        path: '/api/login',
        headers: {},
        query: {},
        body: {
          username: 'test@example.com',
          password: 'secret123',
          rememberMe: true
        },
        cookies: {},
        connection: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1'
      };

      const mockResponse = {
        statusCode: 200,
        getHeaders: jest.fn().mockReturnValue({}),
        get: jest.fn().mockReturnValue(null)
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse)
        })
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(of({ token: 'jwt-token' }))
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: () => {
          expect(requestWatcherService.trackRequest).toHaveBeenCalledWith(
            expect.objectContaining({
              body: expect.objectContaining({
                username: 'test@example.com',
                password: '[REDACTED]',
                rememberMe: true
              })
            }),
            expect.any(Object),
            null
          );
          done();
        },
        error: done
      });
    });
  });

  describe('session and user tracking', () => {
    it('should extract session ID from cookie', (done) => {
      const mockRequest = {
        method: 'GET',
        originalUrl: '/api/users',
        path: '/api/users',
        headers: {},
        query: {},
        body: null,
        cookies: { sessionId: 'session-123' },
        connection: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1'
      };

      const mockResponse = {
        statusCode: 200,
        getHeaders: jest.fn().mockReturnValue({}),
        get: jest.fn().mockReturnValue(null)
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse)
        })
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(of({}))
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: () => {
          expect(requestWatcherService.trackRequest).toHaveBeenCalledWith(
            expect.objectContaining({
              sessionId: 'session-123'
            }),
            expect.any(Object),
            null
          );
          done();
        },
        error: done
      });
    });

    it('should extract user ID from request context', (done) => {
      const mockRequest = {
        method: 'GET',
        originalUrl: '/api/users',
        path: '/api/users',
        headers: {},
        query: {},
        body: null,
        cookies: {},
        connection: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1',
        user: { id: 'user-123', name: 'Test User' }
      };

      const mockResponse = {
        statusCode: 200,
        getHeaders: jest.fn().mockReturnValue({}),
        get: jest.fn().mockReturnValue(null)
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse)
        })
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(of({}))
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: () => {
          expect(requestWatcherService.trackRequest).toHaveBeenCalledWith(
            expect.objectContaining({
              userId: 'user-123'
            }),
            expect.any(Object),
            null
          );
          done();
        },
        error: done
      });
    });

    it('should generate trace ID when not provided', (done) => {
      const mockRequest = {
        method: 'GET',
        originalUrl: '/api/users',
        path: '/api/users',
        headers: {},
        query: {},
        body: null,
        cookies: {},
        connection: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1'
      };

      const mockResponse = {
        statusCode: 200,
        getHeaders: jest.fn().mockReturnValue({}),
        get: jest.fn().mockReturnValue(null)
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse)
        })
      } as unknown as ExecutionContext;

      const mockCallHandler = {
        handle: jest.fn().mockReturnValue(of({}))
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: () => {
          expect(requestWatcherService.trackRequest).toHaveBeenCalledWith(
            expect.objectContaining({
              traceId: expect.stringMatching(/^trace_/)
            }),
            expect.any(Object),
            null
          );
          done();
        },
        error: done
      });
    });
  });
});
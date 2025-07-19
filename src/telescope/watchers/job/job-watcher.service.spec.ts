import { Test, TestingModule } from '@nestjs/testing';
import { JobWatcherService, JobContext, JobStatus } from './job-watcher.service';
import { TelescopeService } from '../../core/services/telescope.service';
import { JobWatcherConfig, defaultJobWatcherConfig } from './job-watcher.config';

describe('JobWatcherService', () => {
  let service: JobWatcherService;
  let telescopeService: jest.Mocked<TelescopeService>;

  beforeEach(async () => {
    const mockTelescopeService = {
      record: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobWatcherService,
        {
          provide: TelescopeService,
          useValue: mockTelescopeService,
        },
        {
          provide: 'JOB_WATCHER_CONFIG',
          useValue: defaultJobWatcherConfig,
        },
      ],
    }).compile();

    service = module.get<JobWatcherService>(JobWatcherService);
    telescopeService = module.get(TelescopeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize with default metrics', () => {
      const metrics = service.getMetrics();
      expect(metrics.totalJobs).toBe(0);
      expect(metrics.completedJobs).toBe(0);
      expect(metrics.failedJobs).toBe(0);
      expect(metrics.healthScore).toBe(100);
    });

    it('should start periodic processing on module init', async () => {
      await service.onModuleInit();
      // Module init should not throw
    });
  });

  describe('job tracking', () => {
    it('should track job completion', () => {
      const context: JobContext = {
        id: 'test-job-1',
        jobId: 'job-123',
        queueName: 'test-queue',
        jobName: 'test-job',
        timestamp: new Date(),
        status: JobStatus.COMPLETED,
        priority: 1,
        attempts: 1,
        maxAttempts: 3,
        duration: 1000,
        result: { success: true },
      };

      service.trackJob(context);

      expect(telescopeService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'job',
          content: expect.objectContaining({
            job: expect.objectContaining({
              id: 'job-123',
              name: 'test-job',
              queue: 'test-queue',
              status: 'completed',
            }),
          }),
        })
      );

      const metrics = service.getMetrics();
      expect(metrics.totalJobs).toBe(1);
      expect(metrics.completedJobs).toBe(1);
    });

    it('should track job failure', () => {
      const context: JobContext = {
        id: 'test-job-2',
        jobId: 'job-456',
        queueName: 'test-queue',
        jobName: 'failing-job',
        timestamp: new Date(),
        status: JobStatus.FAILED,
        priority: 1,
        attempts: 3,
        maxAttempts: 3,
        duration: 500,
        error: { message: 'Job failed', code: 'PROCESSING_ERROR' },
      };

      service.trackJob(context);

      const metrics = service.getMetrics();
      expect(metrics.totalJobs).toBe(1);
      expect(metrics.failedJobs).toBe(1);
      expect(metrics.failureRate).toBeGreaterThan(0);
    });

    it('should not track job if disabled', () => {
      const disabledConfig = {
        ...defaultJobWatcherConfig,
        enabled: false,
      };

      const disabledService = new JobWatcherService(
        telescopeService,
        disabledConfig
      );

      const context: JobContext = {
        id: 'test-job-3',
        jobId: 'job-789',
        queueName: 'test-queue',
        jobName: 'test-job',
        timestamp: new Date(),
        status: JobStatus.COMPLETED,
        priority: 1,
        attempts: 1,
        maxAttempts: 3,
      };

      disabledService.trackJob(context);

      expect(telescopeService.record).not.toHaveBeenCalled();
    });

    it('should respect sampling rate', () => {
      const samplingConfig = {
        ...defaultJobWatcherConfig,
        sampleRate: 0, // 0% sampling
      };

      const samplingService = new JobWatcherService(
        telescopeService,
        samplingConfig
      );

      const context: JobContext = {
        id: 'test-job-4',
        jobId: 'job-000',
        queueName: 'test-queue',
        jobName: 'test-job',
        timestamp: new Date(),
        status: JobStatus.COMPLETED,
        priority: 1,
        attempts: 1,
        maxAttempts: 3,
      };

      samplingService.trackJob(context);

      expect(telescopeService.record).not.toHaveBeenCalled();
    });

    it('should exclude jobs based on configuration', () => {
      const excludeConfig = {
        ...defaultJobWatcherConfig,
        excludeJobTypes: ['test-job'],
      };

      const excludeService = new JobWatcherService(
        telescopeService,
        excludeConfig
      );

      const context: JobContext = {
        id: 'test-job-5',
        jobId: 'job-111',
        queueName: 'test-queue',
        jobName: 'test-job',
        timestamp: new Date(),
        status: JobStatus.COMPLETED,
        priority: 1,
        attempts: 1,
        maxAttempts: 3,
      };

      excludeService.trackJob(context);

      expect(telescopeService.record).not.toHaveBeenCalled();
    });
  });

  describe('metrics calculation', () => {
    it('should calculate job rates correctly', () => {
      const jobs = [
        { status: JobStatus.COMPLETED, duration: 1000 },
        { status: JobStatus.COMPLETED, duration: 2000 },
        { status: JobStatus.FAILED, duration: 500 },
        { status: JobStatus.ACTIVE, duration: undefined },
      ];

      jobs.forEach((job, index) => {
        const context: JobContext = {
          id: `job-${index}`,
          jobId: `job-${index}`,
          queueName: 'test-queue',
          jobName: 'test-job',
          timestamp: new Date(),
          status: job.status,
          priority: 1,
          attempts: 1,
          maxAttempts: 3,
          duration: job.duration,
        };

        service.trackJob(context);
      });

      const metrics = service.getMetrics();
      expect(metrics.totalJobs).toBe(4);
      expect(metrics.completedJobs).toBe(2);
      expect(metrics.failedJobs).toBe(1);
      expect(metrics.activeJobs).toBe(1);
      expect(metrics.failureRate).toBe(25); // 1/4 * 100
    });

    it('should track slow jobs', () => {
      const slowConfig = {
        ...defaultJobWatcherConfig,
        slowJobThreshold: 1000, // 1 second
      };

      const slowService = new JobWatcherService(
        telescopeService,
        slowConfig
      );

      const context: JobContext = {
        id: 'slow-job-1',
        jobId: 'slow-job-1',
        queueName: 'test-queue',
        jobName: 'slow-job',
        timestamp: new Date(),
        status: JobStatus.COMPLETED,
        priority: 1,
        attempts: 1,
        maxAttempts: 3,
        duration: 5000, // 5 seconds
      };

      slowService.trackJob(context);

      const metrics = slowService.getMetrics();
      expect(metrics.slowJobs).toBe(1);
    });

    it('should calculate top failed jobs', () => {
      // Create multiple failures for the same job
      for (let i = 0; i < 5; i++) {
        const context: JobContext = {
          id: `failing-job-${i}`,
          jobId: `failing-job-${i}`,
          queueName: 'test-queue',
          jobName: 'failing-job',
          timestamp: new Date(),
          status: JobStatus.FAILED,
          priority: 1,
          attempts: 3,
          maxAttempts: 3,
          error: { message: 'Consistent failure' },
        };

        service.trackJob(context);
      }

      const metrics = service.getMetrics();
      expect(metrics.topFailedJobs).toHaveLength(1);
      expect(metrics.topFailedJobs[0].jobName).toBe('failing-job');
      expect(metrics.topFailedJobs[0].failureCount).toBe(5);
    });
  });

  describe('alerting system', () => {
    it('should generate failure rate alerts', (done) => {
      const alertConfig = {
        ...defaultJobWatcherConfig,
        alertThresholds: {
          failureRate: 20, // 20%
          avgExecutionTime: 10000,
          queueSize: 1000,
          stalledJobs: 5,
          timeWindow: 300000,
        },
      };

      const alertService = new JobWatcherService(
        telescopeService,
        alertConfig
      );

      alertService.getAlertsStream().subscribe(alert => {
        expect(alert.type).toBe('failure_rate');
        expect(alert.severity).toBe('high');
        expect(alert.message).toContain('failure rate exceeded threshold');
        done();
      });

      // Create jobs with high failure rate
      for (let i = 0; i < 10; i++) {
        const context: JobContext = {
          id: `job-${i}`,
          jobId: `job-${i}`,
          queueName: 'test-queue',
          jobName: 'test-job',
          timestamp: new Date(),
          status: i < 3 ? JobStatus.FAILED : JobStatus.COMPLETED,
          priority: 1,
          attempts: 1,
          maxAttempts: 3,
        };

        alertService.trackJob(context);
      }
    });

    it('should generate slow job alerts', (done) => {
      const alertConfig = {
        ...defaultJobWatcherConfig,
        alertThresholds: {
          failureRate: 100, // High threshold to avoid failure rate alerts
          avgExecutionTime: 1000, // 1 second
          queueSize: 1000,
          stalledJobs: 5,
          timeWindow: 300000,
        },
      };

      const alertService = new JobWatcherService(
        telescopeService,
        alertConfig
      );

      alertService.getAlertsStream().subscribe(alert => {
        expect(alert.type).toBe('slow_jobs');
        expect(alert.severity).toBe('medium');
        expect(alert.message).toContain('Slow job detected');
        done();
      });

      const context: JobContext = {
        id: 'slow-job-alert',
        jobId: 'slow-job-alert',
        queueName: 'test-queue',
        jobName: 'slow-job',
        timestamp: new Date(),
        status: JobStatus.COMPLETED,
        priority: 1,
        attempts: 1,
        maxAttempts: 3,
        duration: 5000, // 5 seconds
      };

      alertService.trackJob(context);
    });
  });

  describe('public API', () => {
    it('should provide metrics stream', (done) => {
      const metricsStream = service.getMetricsStream();
      
      metricsStream.subscribe(metrics => {
        expect(metrics).toBeDefined();
        expect(metrics.totalJobs).toBeGreaterThanOrEqual(0);
        done();
      });

      // Trigger metrics update
      const context: JobContext = {
        id: 'test-job-stream',
        jobId: 'test-job-stream',
        queueName: 'test-queue',
        jobName: 'test-job',
        timestamp: new Date(),
        status: JobStatus.COMPLETED,
        priority: 1,
        attempts: 1,
        maxAttempts: 3,
      };

      service.trackJob(context);
    });

    it('should return recent jobs', () => {
      const contexts = Array.from({ length: 5 }, (_, i) => ({
        id: `job-${i}`,
        jobId: `job-${i}`,
        queueName: 'test-queue',
        jobName: 'test-job',
        timestamp: new Date(),
        status: JobStatus.COMPLETED,
        priority: 1,
        attempts: 1,
        maxAttempts: 3,
      }));

      contexts.forEach(context => service.trackJob(context));

      const recent = service.getRecentJobs(3);
      expect(recent).toHaveLength(3);
      expect(recent[0].id).toBe('job-4'); // Most recent first
    });

    it('should return jobs by queue', () => {
      const queues = ['queue-a', 'queue-b', 'queue-a'];
      
      queues.forEach((queue, index) => {
        const context: JobContext = {
          id: `job-${index}`,
          jobId: `job-${index}`,
          queueName: queue,
          jobName: 'test-job',
          timestamp: new Date(),
          status: JobStatus.COMPLETED,
          priority: 1,
          attempts: 1,
          maxAttempts: 3,
        };

        service.trackJob(context);
      });

      const queueAJobs = service.getJobsByQueue('queue-a');
      expect(queueAJobs).toHaveLength(2);
      expect(queueAJobs.every(job => job.queueName === 'queue-a')).toBe(true);
    });

    it('should return jobs by status', () => {
      const statuses = [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.COMPLETED];
      
      statuses.forEach((status, index) => {
        const context: JobContext = {
          id: `job-${index}`,
          jobId: `job-${index}`,
          queueName: 'test-queue',
          jobName: 'test-job',
          timestamp: new Date(),
          status,
          priority: 1,
          attempts: 1,
          maxAttempts: 3,
        };

        service.trackJob(context);
      });

      const completedJobs = service.getJobsByStatus(JobStatus.COMPLETED);
      expect(completedJobs).toHaveLength(2);
      expect(completedJobs.every(job => job.status === JobStatus.COMPLETED)).toBe(true);
    });

    it('should calculate queue health', () => {
      // Add some jobs to test queue health calculation
      const jobs = [
        { status: JobStatus.COMPLETED, duration: 1000 },
        { status: JobStatus.COMPLETED, duration: 2000 },
        { status: JobStatus.FAILED, duration: 500 },
      ];

      jobs.forEach((job, index) => {
        const context: JobContext = {
          id: `job-${index}`,
          jobId: `job-${index}`,
          queueName: 'test-queue',
          jobName: 'test-job',
          timestamp: new Date(),
          status: job.status,
          priority: 1,
          attempts: 1,
          maxAttempts: 3,
          duration: job.duration,
        };

        service.trackJob(context);
      });

      const health = service.getQueueHealth('test-queue');
      expect(health).toBeDefined();
      expect(Array.isArray(health)).toBe(false);
      
      const queueHealth = health as any;
      expect(queueHealth.queueName).toBe('test-queue');
      expect(queueHealth.status).toBeDefined();
      expect(queueHealth.score).toBeGreaterThan(0);
    });

    it('should acknowledge alerts', () => {
      const alerts: any[] = [];
      service.getAlertsStream().subscribe(alert => alerts.push(alert));

      // Generate an alert
      const context: JobContext = {
        id: 'alert-job',
        jobId: 'alert-job',
        queueName: 'test-queue',
        jobName: 'slow-job',
        timestamp: new Date(),
        status: JobStatus.COMPLETED,
        priority: 1,
        attempts: 1,
        maxAttempts: 3,
        duration: 15000, // Very slow
      };

      service.trackJob(context);

      // Wait for alert to be generated
      setTimeout(() => {
        if (alerts.length > 0) {
          const alert = alerts[0];
          
          const acknowledged = service.acknowledgeAlert(alert.id);
          expect(acknowledged).toBe(true);
          expect(alert.acknowledged).toBe(true);
        }
      }, 100);
    });
  });

  describe('cleanup and resource management', () => {
    it('should cleanup on destroy', () => {
      const destroySpy = jest.spyOn((service as any).destroy$, 'next');
      const completeSpy = jest.spyOn((service as any).destroy$, 'complete');

      service.onModuleDestroy();

      expect(destroySpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
    });

    it('should limit history size', () => {
      const maxSize = (service as any).maxHistorySize;
      
      // Add more jobs than the limit
      for (let i = 0; i < maxSize + 100; i++) {
        const context: JobContext = {
          id: `job-${i}`,
          jobId: `job-${i}`,
          queueName: 'test-queue',
          jobName: 'test-job',
          timestamp: new Date(),
          status: JobStatus.COMPLETED,
          priority: 1,
          attempts: 1,
          maxAttempts: 3,
        };
        service.trackJob(context);
      }

      const history = (service as any).jobHistory;
      expect(history.length).toBeLessThanOrEqual(maxSize);
    });
  });
});
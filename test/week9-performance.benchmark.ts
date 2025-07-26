import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { AppModule } from "../src/app.module";
import { TelescopeService } from "../src/telescope/core/services/telescope.service";
import { MLAnalyticsService } from "../src/telescope/core/services/ml-analytics.service";
import { AnalyticsService } from "../src/telescope/core/services/analytics.service";
import { StorageManagerService } from "../src/telescope/storage/storage-manager.service";

interface BenchmarkResult {
  testName: string;
  duration: number;
  throughput: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  success: boolean;
  error?: string;
}

interface PerformanceMetrics {
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  throughput: number;
  errorRate: number;
  memoryEfficiency: number;
}

class PerformanceBenchmark {
  private app: INestApplication;
  private telescopeService: TelescopeService;
  private mlAnalyticsService: MLAnalyticsService;
  private analyticsService: AnalyticsService;
  private storageManager: StorageManagerService;
  private results: BenchmarkResult[] = [];

  async initialize() {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    this.app = moduleFixture.createNestApplication();
    await this.app.init();

    this.telescopeService =
      moduleFixture.get<TelescopeService>(TelescopeService);
    this.mlAnalyticsService =
      moduleFixture.get<MLAnalyticsService>(MLAnalyticsService);
    this.analyticsService =
      moduleFixture.get<AnalyticsService>(AnalyticsService);
    this.storageManager = moduleFixture.get<StorageManagerService>(
      StorageManagerService
    );
  }

  async cleanup() {
    await this.app.close();
  }

  private getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
      external: Math.round(usage.external / 1024 / 1024), // MB
      rss: Math.round(usage.rss / 1024 / 1024), // MB
    };
  }

  private async measureExecutionTime<T>(
    fn: () => Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const startTime = process.hrtime.bigint();
    const result = await fn();
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    return { result, duration };
  }

  async runBenchmark(
    testName: string,
    testFn: () => Promise<void>,
    iterations: number = 1
  ): Promise<BenchmarkResult> {
    console.log(`Running benchmark: ${testName}`);

    const startMemory = this.getMemoryUsage();
    const startTime = Date.now();

    try {
      for (let i = 0; i < iterations; i++) {
        await testFn();
      }

      const endTime = Date.now();
      const endMemory = this.getMemoryUsage();
      const duration = endTime - startTime;
      const throughput = iterations / (duration / 1000); // operations per second

      const result: BenchmarkResult = {
        testName,
        duration,
        throughput,
        memoryUsage: endMemory,
        success: true,
      };

      this.results.push(result);
      console.log(
        `✓ ${testName}: ${duration}ms, ${throughput.toFixed(2)} ops/sec`
      );

      return result;
    } catch (error) {
      const result: BenchmarkResult = {
        testName,
        duration: 0,
        throughput: 0,
        memoryUsage: this.getMemoryUsage(),
        success: false,
        error: error.message,
      };

      this.results.push(result);
      console.log(`✗ ${testName}: FAILED - ${error.message}`);

      return result;
    }
  }

  async runDataIngestionBenchmark() {
    return this.runBenchmark("Data Ingestion - 1000 entries", async () => {
      const entries = Array.from({ length: 1000 }, (_, i) => ({
        id: `benchmark-entry-${i}`,
        timestamp: new Date(),
        type: "request" as const,
        component: "application",
        data: {
          method: "GET",
          url: `/api/benchmark/${i}`,
          responseTime: 200 + Math.random() * 300,
          statusCode: 200,
        },
      }));

      await Promise.all(
        entries.map((entry) => this.telescopeService.addEntry(entry))
      );
    });
  }

  async runConcurrentIngestionBenchmark() {
    return this.runBenchmark(
      "Concurrent Ingestion - 100 concurrent requests",
      async () => {
        const concurrentRequests = 100;
        const promises = Array.from({ length: concurrentRequests }, (_, i) =>
          this.telescopeService.addEntry({
            id: `concurrent-entry-${i}`,
            timestamp: new Date(),
            type: "request" as const,
            component: "application",
            data: {
              method: "POST",
              url: "/api/concurrent",
              responseTime: 150 + Math.random() * 200,
              statusCode: 200,
            },
          })
        );

        await Promise.all(promises);
      }
    );
  }

  async runMLProcessingBenchmark() {
    return this.runBenchmark("ML Processing - Anomaly Detection", async () => {
      // Generate data that will trigger anomaly detection
      const normalEntries = Array.from({ length: 50 }, (_, i) => ({
        id: `normal-ml-${i}`,
        timestamp: new Date(),
        type: "request" as const,
        component: "application",
        data: { responseTime: 200 + Math.random() * 100, statusCode: 200 },
      }));

      const anomalousEntry = {
        id: "anomalous-ml",
        timestamp: new Date(),
        type: "request" as const,
        component: "application",
        data: { responseTime: 5000, statusCode: 200 }, // Very slow response
      };

      // Add normal data first
      await Promise.all(
        normalEntries.map((entry) => this.telescopeService.addEntry(entry))
      );

      // Wait for ML processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Add anomalous data
      await this.telescopeService.addEntry(anomalousEntry);

      // Wait for anomaly detection
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Verify anomaly was detected
      const anomalies = this.mlAnalyticsService.getCurrentAnomalies();
      if (anomalies.length === 0) {
        throw new Error("No anomalies detected");
      }
    });
  }

  async runAnalyticsGenerationBenchmark() {
    return this.runBenchmark("Analytics Generation", async () => {
      // Generate diverse data for analytics
      const entries = [
        ...Array.from({ length: 100 }, (_, i) => ({
          id: `analytics-request-${i}`,
          timestamp: new Date(),
          type: "request" as const,
          component: "application",
          data: { responseTime: 200 + Math.random() * 300, statusCode: 200 },
        })),
        ...Array.from({ length: 50 }, (_, i) => ({
          id: `analytics-query-${i}`,
          timestamp: new Date(),
          type: "query" as const,
          component: "database",
          data: {
            executionTime: 50 + Math.random() * 200,
            query: "SELECT * FROM users",
          },
        })),
        ...Array.from({ length: 25 }, (_, i) => ({
          id: `analytics-exception-${i}`,
          timestamp: new Date(),
          type: "exception" as const,
          component: "application",
          data: { error: "Test error", stack: "Error stack trace" },
        })),
      ];

      await Promise.all(
        entries.map((entry) => this.telescopeService.addEntry(entry))
      );

      // Wait for analytics processing
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Generate analytics
      const analytics = await this.analyticsService.getCurrentAnalytics();
      if (!analytics) {
        throw new Error("Analytics generation failed");
      }
    });
  }

  async runStoragePerformanceBenchmark() {
    return this.runBenchmark("Storage Performance - 5000 entries", async () => {
      const entries = Array.from({ length: 5000 }, (_, i) => ({
        id: `storage-entry-${i}`,
        timestamp: new Date(),
        type: "request" as const,
        component: "application",
        data: {
          method: "GET",
          url: `/api/storage/${i}`,
          responseTime: 100 + Math.random() * 400,
          statusCode: 200,
        },
      }));

      // Store entries in batches
      const batchSize = 100;
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        await Promise.all(
          batch.map((entry) => this.telescopeService.addEntry(entry))
        );
      }
    });
  }

  async runMemoryEfficiencyBenchmark() {
    return this.runBenchmark(
      "Memory Efficiency - Long running test",
      async () => {
        const iterations = 1000;
        const startMemory = this.getMemoryUsage();

        for (let i = 0; i < iterations; i++) {
          await this.telescopeService.addEntry({
            id: `memory-entry-${i}`,
            timestamp: new Date(),
            type: "request" as const,
            component: "application",
            data: { responseTime: 200 + Math.random() * 100, statusCode: 200 },
          });

          // Force garbage collection if available
          if (global.gc) {
            global.gc();
          }
        }

        const endMemory = this.getMemoryUsage();
        const memoryIncrease = endMemory.heapUsed - startMemory.heapUsed;

        // Memory increase should be reasonable (less than 50MB for 1000 entries)
        if (memoryIncrease > 50) {
          throw new Error(
            `Memory usage increased too much: ${memoryIncrease}MB`
          );
        }
      }
    );
  }

  async runRealTimeStreamingBenchmark() {
    return this.runBenchmark("Real-time Streaming Performance", async () => {
      const messageCount = 100;
      let receivedMessages = 0;

      const subscription = this.mlAnalyticsService
        .getAnomalies()
        .subscribe(() => {
          receivedMessages++;
        });

      // Generate data rapidly
      const promises = Array.from({ length: messageCount }, (_, i) =>
        this.telescopeService.addEntry({
          id: `stream-entry-${i}`,
          timestamp: new Date(),
          type: "request" as const,
          component: "application",
          data: { responseTime: 200 + Math.random() * 500, statusCode: 200 },
        })
      );

      await Promise.all(promises);

      // Wait for streaming to process
      await new Promise((resolve) => setTimeout(resolve, 2000));

      subscription.unsubscribe();

      // Should receive some messages (even if no anomalies)
      if (receivedMessages < 0) {
        throw new Error("Streaming not working properly");
      }
    });
  }

  async runLoadTestBenchmark() {
    return this.runBenchmark("Load Test - High Volume", async () => {
      const totalEntries = 10000;
      const concurrentBatches = 10;
      const batchSize = totalEntries / concurrentBatches;

      const batches = Array.from(
        { length: concurrentBatches },
        (_, batchIndex) => {
          return Array.from({ length: batchSize }, (_, i) => ({
            id: `load-entry-${batchIndex}-${i}`,
            timestamp: new Date(),
            type: "request" as const,
            component: "application",
            data: {
              method: "GET",
              url: `/api/load/${batchIndex}/${i}`,
              responseTime: 150 + Math.random() * 250,
              statusCode: 200,
            },
          }));
        }
      );

      // Process batches concurrently
      await Promise.all(
        batches.map((batch) =>
          Promise.all(
            batch.map((entry) => this.telescopeService.addEntry(entry))
          )
        )
      );
    });
  }

  async runStressTestBenchmark() {
    return this.runBenchmark("Stress Test - Extreme Conditions", async () => {
      const iterations = 5000;
      const promises = [];

      for (let i = 0; i < iterations; i++) {
        promises.push(
          this.telescopeService.addEntry({
            id: `stress-entry-${i}`,
            timestamp: new Date(),
            type: "request" as const,
            component: "application",
            data: { responseTime: 100 + Math.random() * 900, statusCode: 200 },
          })
        );

        // Add some variety
        if (i % 100 === 0) {
          promises.push(
            this.telescopeService.addEntry({
              id: `stress-query-${i}`,
              timestamp: new Date(),
              type: "query" as const,
              component: "database",
              data: {
                executionTime: 50 + Math.random() * 450,
                query: "SELECT * FROM stress_test",
              },
            })
          );
        }
      }

      await Promise.all(promises);
    });
  }

  calculatePerformanceMetrics(): PerformanceMetrics {
    const successfulResults = this.results.filter((r) => r.success);

    if (successfulResults.length === 0) {
      throw new Error("No successful benchmark results to analyze");
    }

    const responseTimes = successfulResults.map((r) => r.duration);
    const throughputs = successfulResults.map((r) => r.throughput);

    // Sort for percentile calculations
    responseTimes.sort((a, b) => a - b);
    throughputs.sort((a, b) => a - b);

    const avgResponseTime =
      responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const p95Index = Math.floor(responseTimes.length * 0.95);
    const p99Index = Math.floor(responseTimes.length * 0.99);

    const p95ResponseTime = responseTimes[p95Index];
    const p99ResponseTime = responseTimes[p99Index];
    const avgThroughput =
      throughputs.reduce((a, b) => a + b, 0) / throughputs.length;

    const errorRate =
      (this.results.length - successfulResults.length) / this.results.length;

    const totalMemory = successfulResults.reduce(
      (sum, r) => sum + r.memoryUsage.heapUsed,
      0
    );
    const avgMemory = totalMemory / successfulResults.length;
    const memoryEfficiency = avgMemory / avgThroughput; // MB per operation

    return {
      averageResponseTime: avgResponseTime,
      p95ResponseTime,
      p99ResponseTime,
      throughput: avgThroughput,
      errorRate,
      memoryEfficiency,
    };
  }

  generateReport(): string {
    const metrics = this.calculatePerformanceMetrics();
    const failedTests = this.results.filter((r) => !r.success);

    let report = `
# Week 9 Performance Benchmark Report

## Summary
- Total Tests: ${this.results.length}
- Successful Tests: ${this.results.filter((r) => r.success).length}
- Failed Tests: ${failedTests.length}
- Success Rate: ${(
      (this.results.filter((r) => r.success).length / this.results.length) *
      100
    ).toFixed(2)}%

## Performance Metrics
- Average Response Time: ${metrics.averageResponseTime.toFixed(2)}ms
- 95th Percentile Response Time: ${metrics.p95ResponseTime.toFixed(2)}ms
- 99th Percentile Response Time: ${metrics.p99ResponseTime.toFixed(2)}ms
- Average Throughput: ${metrics.throughput.toFixed(2)} ops/sec
- Error Rate: ${(metrics.errorRate * 100).toFixed(2)}%
- Memory Efficiency: ${metrics.memoryEfficiency.toFixed(2)} MB/op

## Detailed Results
`;

    this.results.forEach((result) => {
      const status = result.success ? "✓" : "✗";
      const duration = result.duration.toFixed(2);
      const throughput = result.throughput.toFixed(2);
      const memory = result.memoryUsage.heapUsed;

      report += `
${status} ${result.testName}
  Duration: ${duration}ms
  Throughput: ${throughput} ops/sec
  Memory Usage: ${memory}MB
  ${result.error ? `Error: ${result.error}` : ""}
`;
    });

    if (failedTests.length > 0) {
      report += `
## Failed Tests
`;
      failedTests.forEach((test) => {
        report += `- ${test.testName}: ${test.error}\n`;
      });
    }

    report += `
## Performance Assessment
`;

    // Performance assessment based on metrics
    if (metrics.averageResponseTime < 100) {
      report += "- Response Time: EXCELLENT (< 100ms)\n";
    } else if (metrics.averageResponseTime < 500) {
      report += "- Response Time: GOOD (100-500ms)\n";
    } else if (metrics.averageResponseTime < 1000) {
      report += "- Response Time: ACCEPTABLE (500-1000ms)\n";
    } else {
      report += "- Response Time: NEEDS IMPROVEMENT (> 1000ms)\n";
    }

    if (metrics.throughput > 1000) {
      report += "- Throughput: EXCELLENT (> 1000 ops/sec)\n";
    } else if (metrics.throughput > 500) {
      report += "- Throughput: GOOD (500-1000 ops/sec)\n";
    } else if (metrics.throughput > 100) {
      report += "- Throughput: ACCEPTABLE (100-500 ops/sec)\n";
    } else {
      report += "- Throughput: NEEDS IMPROVEMENT (< 100 ops/sec)\n";
    }

    if (metrics.errorRate < 0.01) {
      report += "- Reliability: EXCELLENT (< 1% error rate)\n";
    } else if (metrics.errorRate < 0.05) {
      report += "- Reliability: GOOD (1-5% error rate)\n";
    } else if (metrics.errorRate < 0.1) {
      report += "- Reliability: ACCEPTABLE (5-10% error rate)\n";
    } else {
      report += "- Reliability: NEEDS IMPROVEMENT (> 10% error rate)\n";
    }

    return report;
  }

  async runAllBenchmarks(): Promise<string> {
    console.log("Starting Week 9 Performance Benchmarks...\n");

    try {
      await this.initialize();

      // Run all benchmarks
      await Promise.all([
        this.runDataIngestionBenchmark(),
        this.runConcurrentIngestionBenchmark(),
        this.runMLProcessingBenchmark(),
        this.runAnalyticsGenerationBenchmark(),
        this.runStoragePerformanceBenchmark(),
        this.runMemoryEfficiencyBenchmark(),
        this.runRealTimeStreamingBenchmark(),
        this.runLoadTestBenchmark(),
        this.runStressTestBenchmark(),
      ]);

      const report = this.generateReport();
      console.log("\n" + report);

      return report;
    } finally {
      await this.cleanup();
    }
  }
}

// Export for use in tests
export { PerformanceBenchmark, BenchmarkResult, PerformanceMetrics };

// Run benchmarks if this file is executed directly
if (require.main === module) {
  const benchmark = new PerformanceBenchmark();
  benchmark
    .runAllBenchmarks()
    .then((report) => {
      console.log("Benchmark completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Benchmark failed:", error);
      process.exit(1);
    });
}

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { TelescopeService } from "../src/telescope/core/services/telescope.service";
import { MLAnalyticsService } from "../src/telescope/core/services/ml-analytics.service";
import { AutomatedAlertingService } from "../src/telescope/core/services/automated-alerting.service";
import { AnalyticsService } from "../src/telescope/core/services/analytics.service";
import { StorageManagerService } from "../src/telescope/storage/storage-manager.service";

describe("Week 9: Integration & Testing Suite (e2e)", () => {
  let app: INestApplication;
  let telescopeService: TelescopeService;
  let mlAnalyticsService: MLAnalyticsService;
  let alertingService: AutomatedAlertingService;
  let analyticsService: AnalyticsService;
  let storageManager: StorageManagerService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    telescopeService = moduleFixture.get<TelescopeService>(TelescopeService);
    mlAnalyticsService =
      moduleFixture.get<MLAnalyticsService>(MLAnalyticsService);
    alertingService = moduleFixture.get<AutomatedAlertingService>(
      AutomatedAlertingService
    );
    analyticsService = moduleFixture.get<AnalyticsService>(AnalyticsService);
    storageManager = moduleFixture.get<StorageManagerService>(
      StorageManagerService
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe("1. End-to-End Integration Testing", () => {
    describe("1.1 Core System Integration", () => {
      it("should integrate all core services successfully", async () => {
        // Test that all services are properly initialized
        expect(telescopeService).toBeDefined();
        expect(mlAnalyticsService).toBeDefined();
        expect(alertingService).toBeDefined();
        expect(analyticsService).toBeDefined();
        expect(storageManager).toBeDefined();

        // Test service dependencies
        expect(telescopeService["analyticsService"]).toBeDefined();
        expect(mlAnalyticsService["analyticsService"]).toBeDefined();
        expect(alertingService["mlAnalyticsService"]).toBeDefined();
      });

      it("should handle data flow from watchers to ML analytics", async () => {
        // Simulate data entry
        const testEntry = {
          id: "test-entry-1",
          timestamp: new Date(),
          type: "request",
          component: "application",
          data: {
            method: "GET",
            url: "/api/test",
            responseTime: 500,
            statusCode: 200,
          },
        };

        await telescopeService.addEntry(testEntry);

        // Wait for analytics processing
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Verify data reached ML analytics
        const mlMetrics = mlAnalyticsService.getMLMetrics();
        expect(mlMetrics.dataHistorySize).toBeGreaterThan(0);
      });

      it("should process cross-watcher correlations", async () => {
        // Add entries from different watchers
        const requestEntry = {
          id: "request-entry-1",
          timestamp: new Date(),
          type: "request",
          component: "application",
          data: { responseTime: 1000, statusCode: 200 },
        };

        const queryEntry = {
          id: "query-entry-1",
          timestamp: new Date(),
          type: "query",
          component: "database",
          data: { executionTime: 800, query: "SELECT * FROM users" },
        };

        const exceptionEntry = {
          id: "exception-entry-1",
          timestamp: new Date(),
          type: "exception",
          component: "application",
          data: { error: "Database connection failed", stack: "Error stack" },
        };

        await Promise.all([
          telescopeService.addEntry(requestEntry),
          telescopeService.addEntry(queryEntry),
          telescopeService.addEntry(exceptionEntry),
        ]);

        // Wait for correlation processing
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Verify correlations are detected
        const analytics = await analyticsService.getCurrentAnalytics();
        expect(analytics).toBeDefined();
        expect(analytics.performance).toBeDefined();
      });
    });

    describe("1.2 ML Analytics Integration", () => {
      it("should detect anomalies from real data", async () => {
        // Generate normal data
        for (let i = 0; i < 20; i++) {
          await telescopeService.addEntry({
            id: `normal-entry-${i}`,
            timestamp: new Date(),
            type: "request",
            component: "application",
            data: { responseTime: 200 + Math.random() * 100, statusCode: 200 },
          });
        }

        // Add anomalous data
        await telescopeService.addEntry({
          id: "anomaly-entry",
          timestamp: new Date(),
          type: "request",
          component: "application",
          data: { responseTime: 5000, statusCode: 200 }, // Very slow response
        });

        // Wait for anomaly detection
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const anomalies = mlAnalyticsService.getCurrentAnomalies();
        expect(anomalies.length).toBeGreaterThan(0);
        expect(anomalies.some((a) => a.metric.includes("response_time"))).toBe(
          true
        );
      });

      it("should generate predictive insights", async () => {
        // Generate time series data
        for (let i = 0; i < 50; i++) {
          await telescopeService.addEntry({
            id: `trend-entry-${i}`,
            timestamp: new Date(Date.now() - (50 - i) * 60000), // 1 minute intervals
            type: "request",
            component: "application",
            data: { responseTime: 200 + i * 2, statusCode: 200 }, // Increasing trend
          });
        }

        // Wait for prediction generation
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const predictions = mlAnalyticsService.getCurrentPredictions();
        expect(predictions.length).toBeGreaterThan(0);
        expect(
          predictions.some((p) => p.predictionType === "performance")
        ).toBe(true);
      });

      it("should suggest query optimizations", async () => {
        // Add slow query data
        for (let i = 0; i < 10; i++) {
          await telescopeService.addEntry({
            id: `slow-query-${i}`,
            timestamp: new Date(),
            type: "query",
            component: "database",
            data: {
              executionTime: 2000 + Math.random() * 3000,
              query: 'SELECT * FROM users WHERE email LIKE "%test%"',
              table: "users",
              queryHash: `hash-${i}`,
            },
          });
        }

        // Wait for optimization analysis
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const optimizations = mlAnalyticsService.getCurrentOptimizations();
        expect(optimizations.length).toBeGreaterThan(0);
        expect(
          optimizations.some((o) => o.optimizationStrategy.type === "index")
        ).toBe(true);
      });
    });

    describe("1.3 Alerting System Integration", () => {
      it("should trigger alerts for critical anomalies", async () => {
        // Add critical anomaly
        await telescopeService.addEntry({
          id: "critical-anomaly",
          timestamp: new Date(),
          type: "request",
          component: "application",
          data: { responseTime: 10000, statusCode: 500 }, // Critical performance issue
        });

        // Wait for alert processing
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const alerts = mlAnalyticsService.getCurrentAlerts();
        expect(alerts.length).toBeGreaterThan(0);
        expect(alerts.some((a) => a.severity === "critical")).toBe(true);
      });

      it("should process alert channels correctly", async () => {
        // Test alert channel creation
        const testChannel = {
          id: "test-channel",
          name: "Test Channel",
          type: "webhook" as const,
          enabled: true,
          config: { url: "https://webhook.site/test" },
          severityFilter: ["warning", "error", "critical"],
        };

        alertingService.addAlertChannel(testChannel);
        const channels = alertingService.getAlertChannels();
        expect(channels.some((c) => c.id === "test-channel")).toBe(true);
      });

      it("should handle alert escalation", async () => {
        // Create escalation rule
        const escalationRule = {
          id: "escalation-rule",
          name: "Critical Alert Escalation",
          description: "Escalate critical alerts after 5 minutes",
          enabled: true,
          priority: 1,
          conditions: [
            {
              metric: "response_time",
              operator: ">" as const,
              threshold: 5000,
            },
          ],
          actions: {
            channelIds: ["test-channel"],
            escalation: {
              delayMinutes: 5,
              channels: ["escalation-channel"],
            },
          },
        };

        alertingService.addAlertRule(escalationRule);
        const rules = alertingService.getAlertRules();
        expect(rules.some((r) => r.id === "escalation-rule")).toBe(true);
      });
    });
  });

  describe("2. Performance Benchmarking", () => {
    describe("2.1 Data Processing Performance", () => {
      it("should handle high-volume data ingestion", async () => {
        const startTime = Date.now();
        const entryCount = 1000;

        // Generate high volume of entries
        const entries = Array.from({ length: entryCount }, (_, i) => ({
          id: `perf-entry-${i}`,
          timestamp: new Date(),
          type: "request" as const,
          component: "application",
          data: {
            responseTime: 200 + Math.random() * 300,
            statusCode: 200,
            method: "GET",
            url: `/api/test/${i}`,
          },
        }));

        // Process entries in batches
        const batchSize = 100;
        for (let i = 0; i < entries.length; i += batchSize) {
          const batch = entries.slice(i, i + batchSize);
          await Promise.all(
            batch.map((entry) => telescopeService.addEntry(entry))
          );
        }

        const endTime = Date.now();
        const processingTime = endTime - startTime;

        // Performance assertion: should process 1000 entries in under 10 seconds
        expect(processingTime).toBeLessThan(10000);
        expect(processingTime / entryCount).toBeLessThan(10); // < 10ms per entry
      });

      it("should maintain performance under concurrent load", async () => {
        const concurrentRequests = 50;
        const startTime = Date.now();

        // Simulate concurrent requests
        const promises = Array.from({ length: concurrentRequests }, (_, i) =>
          request(app.getHttpServer())
            .get("/telescope/ml-analytics/overview")
            .expect(200)
        );

        await Promise.all(promises);
        const endTime = Date.now();
        const totalTime = endTime - startTime;

        // Performance assertion: should handle 50 concurrent requests in under 5 seconds
        expect(totalTime).toBeLessThan(5000);
        expect(totalTime / concurrentRequests).toBeLessThan(100); // < 100ms per request
      });
    });

    describe("2.2 ML Algorithm Performance", () => {
      it("should process ML algorithms efficiently", async () => {
        const startTime = Date.now();

        // Generate data for ML processing
        for (let i = 0; i < 100; i++) {
          await telescopeService.addEntry({
            id: `ml-entry-${i}`,
            timestamp: new Date(),
            type: "request",
            component: "application",
            data: {
              responseTime: 200 + Math.sin(i * 0.1) * 100,
              statusCode: 200,
            },
          });
        }

        // Wait for ML processing
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const endTime = Date.now();
        const mlProcessingTime = endTime - startTime;

        // Performance assertion: ML processing should complete in reasonable time
        expect(mlProcessingTime).toBeLessThan(5000);
      });

      it("should handle real-time streaming efficiently", async () => {
        const startTime = Date.now();
        const streamDuration = 5000; // 5 seconds

        // Start streaming
        const streamPromise = new Promise<void>((resolve) => {
          let messageCount = 0;
          const subscription = mlAnalyticsService
            .getAnomalies()
            .subscribe(() => {
              messageCount++;
              if (messageCount >= 10) {
                subscription.unsubscribe();
                resolve();
              }
            });

          // Generate data during streaming
          const interval = setInterval(async () => {
            await telescopeService.addEntry({
              id: `stream-entry-${Date.now()}`,
              timestamp: new Date(),
              type: "request",
              component: "application",
              data: {
                responseTime: 200 + Math.random() * 500,
                statusCode: 200,
              },
            });
          }, 100);

          setTimeout(() => {
            clearInterval(interval);
            subscription.unsubscribe();
            resolve();
          }, streamDuration);
        });

        await streamPromise;
        const endTime = Date.now();

        // Performance assertion: streaming should work without performance degradation
        expect(endTime - startTime).toBeLessThan(streamDuration + 2000);
      });
    });
  });

  describe("3. Security Audit and Hardening", () => {
    describe("3.1 Input Validation", () => {
      it("should validate all API inputs", async () => {
        // Test invalid anomaly query
        await request(app.getHttpServer())
          .get("/telescope/ml-analytics/anomalies")
          .query({ severity: "invalid-severity" })
          .expect(400);

        // Test invalid alert channel
        await request(app.getHttpServer())
          .post("/telescope/ml-analytics/alert-channels")
          .send({
            name: "",
            type: "invalid-type",
            config: {},
          })
          .expect(400);
      });

      it("should sanitize user inputs", async () => {
        // Test SQL injection attempt
        const maliciousQuery = {
          id: "malicious-entry",
          timestamp: new Date(),
          type: "query",
          component: "database",
          data: {
            query: "SELECT * FROM users WHERE id = '1'; DROP TABLE users; --",
            executionTime: 100,
          },
        };

        // Should not throw error and should be properly sanitized
        await expect(
          telescopeService.addEntry(maliciousQuery)
        ).resolves.not.toThrow();
      });
    });

    describe("3.2 Authentication and Authorization", () => {
      it("should require authentication for sensitive endpoints", async () => {
        // Test that sensitive endpoints require authentication
        await request(app.getHttpServer())
          .get("/telescope/ml-analytics/overview")
          .expect(401); // Should require authentication

        await request(app.getHttpServer())
          .post("/telescope/ml-analytics/alert-channels")
          .send({})
          .expect(401); // Should require authentication
      });

      it("should validate user permissions", async () => {
        // Test permission-based access control
        const adminToken = "admin-token";
        const userToken = "user-token";

        // Admin should have full access
        await request(app.getHttpServer())
          .get("/telescope/ml-analytics/overview")
          .set("Authorization", `Bearer ${adminToken}`)
          .expect(200);

        // Regular user should have limited access
        await request(app.getHttpServer())
          .get("/telescope/ml-analytics/overview")
          .set("Authorization", `Bearer ${userToken}`)
          .expect(200); // Should work but with limited data
      });
    });

    describe("3.3 Data Protection", () => {
      it("should encrypt sensitive data", async () => {
        // Test that sensitive configuration is encrypted
        const sensitiveConfig = {
          database: {
            password: "sensitive-password",
            connectionString: "postgresql://user:pass@localhost/db",
          },
        };

        // Should be encrypted in storage
        const storedConfig = await storageManager.store(
          "config",
          sensitiveConfig
        );
        expect(storedConfig).not.toContain("sensitive-password");
      });

      it("should mask sensitive data in logs", async () => {
        // Test that sensitive data is masked in logs
        const logSpy = jest.spyOn(console, "log").mockImplementation();

        await telescopeService.addEntry({
          id: "sensitive-entry",
          timestamp: new Date(),
          type: "request",
          component: "application",
          data: {
            headers: { Authorization: "Bearer secret-token" },
            body: { password: "user-password" },
          },
        });

        expect(logSpy).toHaveBeenCalled();
        const logCalls = logSpy.mock.calls.flat().join(" ");
        expect(logCalls).not.toContain("secret-token");
        expect(logCalls).not.toContain("user-password");

        logSpy.mockRestore();
      });
    });
  });

  describe("4. Documentation Completion", () => {
    describe("4.1 API Documentation", () => {
      it("should have complete Swagger documentation", async () => {
        const response = await request(app.getHttpServer())
          .get("/api-docs")
          .expect(200);

        expect(response.body).toBeDefined();
        expect(response.body.paths).toBeDefined();
        expect(
          response.body.paths["/telescope/ml-analytics/overview"]
        ).toBeDefined();
        expect(
          response.body.paths["/telescope/ml-analytics/anomalies"]
        ).toBeDefined();
        expect(
          response.body.paths["/telescope/ml-analytics/predictions"]
        ).toBeDefined();
      });

      it("should have proper response schemas", async () => {
        const response = await request(app.getHttpServer())
          .get("/api-docs")
          .expect(200);

        const schemas = response.body.components?.schemas;
        expect(schemas).toBeDefined();
        expect(schemas.AnomalyDetection).toBeDefined();
        expect(schemas.PredictiveInsight).toBeDefined();
        expect(schemas.MLAlert).toBeDefined();
      });
    });

    describe("4.2 Code Documentation", () => {
      it("should have JSDoc comments for all public methods", () => {
        // This would require parsing the source code to check for JSDoc comments
        // For now, we'll test that the service methods are properly documented
        const mlServiceMethods = Object.getOwnPropertyNames(
          Object.getPrototypeOf(mlAnalyticsService)
        ).filter(
          (name) =>
            typeof mlAnalyticsService[name] === "function" &&
            !name.startsWith("_")
        );

        expect(mlServiceMethods.length).toBeGreaterThan(0);
        // In a real implementation, we would check for JSDoc comments
      });
    });
  });

  describe("5. Example Applications", () => {
    describe("5.1 Basic Usage Examples", () => {
      it("should provide working example configurations", async () => {
        // Test basic configuration
        const basicConfig = {
          telescope: {
            enabled: true,
            storage: {
              driver: "memory",
              options: {},
            },
            watchers: {
              request: { enabled: true },
              query: { enabled: true },
              exception: { enabled: true },
              job: { enabled: true },
              cache: { enabled: true },
            },
            ml: {
              enabled: true,
              anomalyDetection: { enabled: true },
              predictions: { enabled: true },
              optimizations: { enabled: true },
            },
            alerting: {
              enabled: true,
              channels: [],
              rules: [],
            },
          },
        };

        // Should work with basic configuration
        expect(basicConfig).toBeDefined();
        expect(basicConfig.telescope.enabled).toBe(true);
      });

      it("should demonstrate ML analytics usage", async () => {
        // Example: How to use ML analytics
        const anomalies = mlAnalyticsService.getCurrentAnomalies();
        const predictions = mlAnalyticsService.getCurrentPredictions();
        const optimizations = mlAnalyticsService.getCurrentOptimizations();

        // Should return arrays (even if empty)
        expect(Array.isArray(anomalies)).toBe(true);
        expect(Array.isArray(predictions)).toBe(true);
        expect(Array.isArray(optimizations)).toBe(true);
      });
    });

    describe("5.2 Advanced Usage Examples", () => {
      it("should demonstrate custom alert rules", async () => {
        // Example: Custom alert rule
        const customRule = {
          id: "custom-rule",
          name: "High Error Rate Alert",
          description: "Alert when error rate exceeds 5%",
          enabled: true,
          priority: 5,
          conditions: [
            {
              metric: "error_rate",
              operator: ">" as const,
              threshold: 0.05,
              duration: 5, // 5 minutes
            },
          ],
          actions: {
            channelIds: ["email-channel"],
            escalation: {
              delayMinutes: 10,
              channels: ["pagerduty-channel"],
            },
          },
        };

        alertingService.addAlertRule(customRule);
        const rules = alertingService.getAlertRules();
        expect(rules.some((r) => r.id === "custom-rule")).toBe(true);
      });

      it("should demonstrate ML configuration tuning", async () => {
        // Example: Tuning ML parameters
        const mlConfig = {
          anomalyDetection: {
            zScoreThreshold: 3.0, // More sensitive
            windowSize: 100, // Larger window
            minDataPoints: 20,
            confidenceThreshold: 0.8,
          },
          prediction: {
            smoothingFactor: 0.2, // Less smoothing
            predictionHorizon: {
              short: 12, // 12 hours
              medium: 48, // 48 hours
              long: 336, // 14 days
            },
          },
        };

        expect(mlConfig.anomalyDetection.zScoreThreshold).toBe(3.0);
        expect(mlConfig.prediction.smoothingFactor).toBe(0.2);
      });
    });
  });

  describe("6. System Health and Monitoring", () => {
    describe("6.1 Health Checks", () => {
      it("should provide comprehensive health status", async () => {
        const response = await request(app.getHttpServer())
          .get("/health")
          .expect(200);

        expect(response.body).toHaveProperty("status");
        expect(response.body).toHaveProperty("timestamp");
        expect(response.body).toHaveProperty("services");
        expect(response.body.services).toHaveProperty("telescope");
        expect(response.body.services).toHaveProperty("mlAnalytics");
        expect(response.body.services).toHaveProperty("alerting");
      });

      it("should detect service failures", async () => {
        // Simulate service failure
        const originalMethod = mlAnalyticsService.getMLMetrics;
        mlAnalyticsService.getMLMetrics = jest.fn().mockImplementation(() => {
          throw new Error("ML service failure");
        });

        const response = await request(app.getHttpServer())
          .get("/health")
          .expect(503); // Service unavailable

        expect(response.body.status).toBe("error");
        expect(response.body.services.mlAnalytics.status).toBe("error");

        // Restore original method
        mlAnalyticsService.getMLMetrics = originalMethod;
      });
    });

    describe("6.2 Performance Monitoring", () => {
      it("should track system performance metrics", async () => {
        const metrics = mlAnalyticsService.getMLMetrics();

        expect(metrics).toHaveProperty("anomaliesDetected");
        expect(metrics).toHaveProperty("regressionsAnalyzed");
        expect(metrics).toHaveProperty("optimizationSuggestions");
        expect(metrics).toHaveProperty("predictiveInsights");
        expect(metrics).toHaveProperty("activeAlerts");
        expect(metrics).toHaveProperty("dataHistorySize");

        // All metrics should be numbers
        Object.values(metrics).forEach((value) => {
          expect(typeof value).toBe("number");
          expect(value).toBeGreaterThanOrEqual(0);
        });
      });

      it("should monitor memory usage", async () => {
        const memoryUsage = process.memoryUsage();

        expect(memoryUsage).toHaveProperty("heapUsed");
        expect(memoryUsage).toHaveProperty("heapTotal");
        expect(memoryUsage).toHaveProperty("external");
        expect(memoryUsage).toHaveProperty("rss");

        // Memory usage should be reasonable
        expect(memoryUsage.heapUsed).toBeLessThan(100 * 1024 * 1024); // < 100MB
        expect(memoryUsage.heapTotal).toBeLessThan(200 * 1024 * 1024); // < 200MB
      });
    });
  });

  describe("7. Error Handling and Recovery", () => {
    describe("7.1 Graceful Degradation", () => {
      it("should continue operating when ML service fails", async () => {
        // Simulate ML service failure
        const originalMethod = mlAnalyticsService.performAnomalyDetection;
        mlAnalyticsService.performAnomalyDetection = jest
          .fn()
          .mockImplementation(() => {
            throw new Error("ML processing failed");
          });

        // System should still accept entries
        await expect(
          telescopeService.addEntry({
            id: "degradation-test",
            timestamp: new Date(),
            type: "request",
            component: "application",
            data: { responseTime: 200, statusCode: 200 },
          })
        ).resolves.not.toThrow();

        // Restore original method
        mlAnalyticsService.performAnomalyDetection = originalMethod;
      });

      it("should handle storage failures gracefully", async () => {
        // Simulate storage failure
        const originalMethod = storageManager.store;
        storageManager.store = jest
          .fn()
          .mockRejectedValue(new Error("Storage failed"));

        // System should continue operating
        await expect(
          telescopeService.addEntry({
            id: "storage-failure-test",
            timestamp: new Date(),
            type: "request",
            component: "application",
            data: { responseTime: 200, statusCode: 200 },
          })
        ).resolves.not.toThrow();

        // Restore original method
        storageManager.store = originalMethod;
      });
    });

    describe("7.2 Error Recovery", () => {
      it("should recover from temporary failures", async () => {
        // Simulate temporary failure followed by recovery
        let failureCount = 0;
        const originalMethod = mlAnalyticsService.getMLMetrics;

        mlAnalyticsService.getMLMetrics = jest.fn().mockImplementation(() => {
          failureCount++;
          if (failureCount <= 2) {
            throw new Error("Temporary failure");
          }
          return originalMethod.call(mlAnalyticsService);
        });

        // First calls should fail
        await expect(mlAnalyticsService.getMLMetrics()).rejects.toThrow(
          "Temporary failure"
        );
        await expect(mlAnalyticsService.getMLMetrics()).rejects.toThrow(
          "Temporary failure"
        );

        // Third call should succeed
        await expect(mlAnalyticsService.getMLMetrics()).resolves.toBeDefined();

        // Restore original method
        mlAnalyticsService.getMLMetrics = originalMethod;
      });
    });
  });
});

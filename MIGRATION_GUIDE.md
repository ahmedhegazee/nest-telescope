# 🚀 Migration Guide - NestJS Telescope v12.0.0

This guide helps you migrate from existing monitoring solutions to NestJS Telescope v12.0.0.

## 📋 Table of Contents

1. [From Laravel Telescope](#from-laravel-telescope)
2. [From Winston/Logging Libraries](#from-winstonlogging-libraries)
3. [From Prometheus/Grafana](#from-prometheusgrafana)
4. [From New Relic](#from-new-relic)
5. [From DataDog](#from-datadog)
6. [From Custom Monitoring](#from-custom-monitoring)
7. [Step-by-Step Migration](#step-by-step-migration)
8. [Troubleshooting](#troubleshooting)

## 🔄 From Laravel Telescope

### Overview
Laravel Telescope is a great monitoring tool for Laravel applications. NestJS Telescope provides similar functionality with additional features like ML analytics and enterprise capabilities.

### Key Differences

| Feature | Laravel Telescope | NestJS Telescope |
|---------|------------------|------------------|
| Framework | Laravel | NestJS |
| Language | PHP | TypeScript |
| ML Analytics | ❌ | ✅ |
| Enterprise Features | ❌ | ✅ |
| Horizontal Scaling | ❌ | ✅ |
| Multi-Tenant | ❌ | ✅ |

### Migration Steps

#### 1. Install NestJS Telescope
```bash
npm install @nestjs/telescope
```

#### 2. Configure Telescope Module
```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { TelescopeModule } from '@nestjs/telescope';

@Module({
  imports: [
    TelescopeModule.forRoot({
      enabled: true,
      storage: {
        driver: 'database',
        database: {
          type: 'postgresql',
          host: 'localhost',
          port: 5432,
          database: 'telescope',
          username: 'user',
          password: 'password'
        }
      },
      watchers: {
        request: true,
        query: true,
        exception: true,
        job: true,
        cache: true
      }
    })
  ]
})
export class AppModule {}
```

#### 3. Migrate Existing Data (Optional)
```typescript
// migration-script.ts
import { TelescopeService } from '@nestjs/telescope';

@Injectable()
export class LaravelTelescopeMigrationService {
  constructor(private telescopeService: TelescopeService) {}

  async migrateLaravelData() {
    // Read Laravel Telescope data from database
    const laravelEntries = await this.readLaravelTelescopeData();
    
    // Convert and import to NestJS Telescope
    for (const entry of laravelEntries) {
      const telescopeEntry = this.convertLaravelEntry(entry);
      await this.telescopeService.record(telescopeEntry);
    }
  }

  private convertLaravelEntry(laravelEntry: any) {
    return {
      id: laravelEntry.id,
      type: this.mapLaravelType(laravelEntry.type),
      timestamp: new Date(laravelEntry.created_at),
      content: {
        ...laravelEntry.content,
        migrated: true
      },
      tags: laravelEntry.tags || []
    };
  }

  private mapLaravelType(type: string): string {
    const typeMap = {
      'request': 'request',
      'query': 'query',
      'exception': 'exception',
      'job': 'job',
      'cache': 'cache',
      'log': 'log'
    };
    return typeMap[type] || 'custom';
  }
}
```

## 📝 From Winston/Logging Libraries

### Overview
If you're using Winston, Pino, or other logging libraries, Telescope can complement or replace them with structured monitoring.

### Migration Strategy

#### Option 1: Complement Existing Logging
```typescript
// Keep existing logging, add Telescope monitoring
import { Logger } from 'winston';
import { TelescopeService } from '@nestjs/telescope';

@Injectable()
export class UserService {
  constructor(
    private logger: Logger,
    private telescopeService: TelescopeService
  ) {}

  async createUser(userData: any) {
    try {
      // Existing logging
      this.logger.info('Creating user', { email: userData.email });
      
      // Telescope monitoring
      await this.telescopeService.record({
        type: 'request',
        timestamp: new Date(),
        content: {
          action: 'create_user',
          email: userData.email,
          duration: 150
        }
      });

      return await this.userRepository.create(userData);
    } catch (error) {
      // Log error with Telescope
      await this.telescopeService.record({
        type: 'exception',
        timestamp: new Date(),
        content: {
          message: error.message,
          stack: error.stack,
          context: 'create_user'
        }
      });
      throw error;
    }
  }
}
```

#### Option 2: Replace with Telescope
```typescript
// Custom logger using Telescope
import { Injectable } from '@nestjs/common';
import { TelescopeService } from '@nestjs/telescope';

@Injectable()
export class TelescopeLogger {
  constructor(private telescopeService: TelescopeService) {}

  async log(level: string, message: string, context?: any) {
    await this.telescopeService.record({
      type: 'log',
      timestamp: new Date(),
      content: {
        level,
        message,
        context,
        timestamp: new Date().toISOString()
      }
    });
  }

  async error(message: string, error?: Error, context?: any) {
    await this.telescopeService.record({
      type: 'exception',
      timestamp: new Date(),
      content: {
        message,
        error: error?.message,
        stack: error?.stack,
        context
      }
    });
  }
}
```

## 📊 From Prometheus/Grafana

### Overview
Prometheus and Grafana are excellent for metrics collection and visualization. Telescope complements them with application-level monitoring and ML analytics.

### Integration Strategy

#### 1. Export Telescope Metrics to Prometheus
```typescript
// prometheus-integration.ts
import { Injectable } from '@nestjs/common';
import { TelescopeService } from '@nestjs/telescope';
import { Registry, Counter, Histogram } from 'prom-client';

@Injectable()
export class PrometheusIntegrationService {
  private registry = new Registry();
  private requestCounter = new Counter({
    name: 'telescope_requests_total',
    help: 'Total number of requests',
    labelNames: ['type', 'status']
  });
  private requestDuration = new Histogram({
    name: 'telescope_request_duration_seconds',
    help: 'Request duration in seconds',
    labelNames: ['type']
  });

  constructor(private telescopeService: TelescopeService) {
    this.registry.registerMetric(this.requestCounter);
    this.registry.registerMetric(this.requestDuration);
  }

  async exportMetrics() {
    const entries = await this.telescopeService.find({ type: 'request' });
    
    for (const entry of entries) {
      this.requestCounter.inc({ 
        type: entry.content.method, 
        status: entry.content.status 
      });
      
      this.requestDuration.observe({ 
        type: entry.content.method 
      }, entry.content.duration / 1000);
    }

    return this.registry.metrics();
  }
}
```

#### 2. Grafana Dashboard Integration
```json
{
  "dashboard": {
    "title": "NestJS Telescope Metrics",
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(telescope_requests_total[5m])",
            "legendFormat": "{{type}}"
          }
        ]
      },
      {
        "title": "Request Duration",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(telescope_request_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          }
        ]
      }
    ]
  }
}
```

## 🔍 From New Relic

### Overview
New Relic provides comprehensive APM capabilities. Telescope offers similar features with better NestJS integration and ML analytics.

### Feature Mapping

| New Relic Feature | Telescope Equivalent |
|------------------|---------------------|
| Transaction Traces | Request Watcher |
| Error Tracking | Exception Watcher |
| Database Monitoring | Query Watcher |
| Custom Metrics | Custom Watchers |
| Alerting | Automated Alerting |
| Distributed Tracing | Request Correlation |

### Migration Steps

#### 1. Replace New Relic Agent
```typescript
// Remove New Relic
// npm uninstall newrelic

// Install Telescope
npm install @nestjs/telescope
```

#### 2. Configure Request Monitoring
```typescript
// Instead of New Relic transaction tracking
// newrelic.startSegment('custom-operation', true, () => {
//   // operation
// });

// Use Telescope request watcher
@Controller('api')
export class ApiController {
  @Get('users')
  async getUsers() {
    // Telescope automatically tracks this request
    return await this.userService.findAll();
  }
}
```

#### 3. Custom Metrics Migration
```typescript
// New Relic custom metrics
// newrelic.recordMetric('Custom/UserCreation', 1);

// Telescope custom watcher
@Injectable()
export class CustomMetricsWatcher implements Watcher {
  async process(entry: TelescopeEntry): Promise<void> {
    if (entry.type === 'custom' && entry.content.metric === 'UserCreation') {
      // Record custom metric
      await this.recordCustomMetric('UserCreation', 1);
    }
  }
}
```

## 📈 From DataDog

### Overview
DataDog is a powerful monitoring platform. Telescope provides similar capabilities with better NestJS integration and lower costs.

### Migration Strategy

#### 1. Replace DataDog Agent
```typescript
// Remove DataDog
// npm uninstall dd-trace

// Install Telescope
npm install @nestjs/telescope
```

#### 2. Configure APM Features
```typescript
// DataDog APM
// const tracer = require('dd-trace').init();

// Telescope APM
@Module({
  imports: [
    TelescopeModule.forRoot({
      watchers: {
        request: {
          enabled: true,
          correlation: true, // Distributed tracing
          performance: true
        },
        query: {
          enabled: true,
          slowQueryThreshold: 1000
        },
        exception: {
          enabled: true,
          grouping: true
        }
      }
    })
  ]
})
export class AppModule {}
```

#### 3. Custom Metrics Migration
```typescript
// DataDog custom metrics
// dogstatsd.increment('user.creation');

// Telescope custom metrics
@Injectable()
export class MetricsService {
  constructor(private telescopeService: TelescopeService) {}

  async incrementMetric(name: string, value: number = 1) {
    await this.telescopeService.record({
      type: 'metric',
      timestamp: new Date(),
      content: {
        name,
        value,
        type: 'counter'
      }
    });
  }
}
```

## 🔧 From Custom Monitoring

### Overview
If you have a custom monitoring solution, Telescope can enhance it with standardized monitoring and ML analytics.

### Migration Steps

#### 1. Identify Custom Monitoring Points
```typescript
// Before: Custom monitoring
class CustomMonitor {
  logRequest(method: string, path: string, duration: number) {
    console.log(`Request: ${method} ${path} - ${duration}ms`);
    // Custom logic...
  }
}

// After: Telescope monitoring
@Injectable()
export class RequestService {
  constructor(private telescopeService: TelescopeService) {}

  async logRequest(method: string, path: string, duration: number) {
    await this.telescopeService.record({
      type: 'request',
      timestamp: new Date(),
      content: {
        method,
        path,
        duration,
        status: 200
      }
    });
  }
}
```

#### 2. Migrate Custom Alerts
```typescript
// Before: Custom alerting
class CustomAlerting {
  checkErrorRate(errors: number, total: number) {
    const rate = errors / total;
    if (rate > 0.05) {
      this.sendAlert('High error rate detected');
    }
  }
}

// After: Telescope alerting
@Injectable()
export class AlertingService {
  constructor(private alerting: AutomatedAlertingService) {}

  async setupErrorRateAlert() {
    await this.alerting.createAlert({
      name: 'High Error Rate',
      condition: 'error_rate > 0.05',
      channels: ['email', 'slack'],
      severity: 'high',
      cooldown: 300 // 5 minutes
    });
  }
}
```

## 🚀 Step-by-Step Migration

### Phase 1: Preparation (Week 1)
1. **Audit Current Monitoring**
   ```bash
   # Analyze current monitoring setup
   npm run audit:monitoring
   ```

2. **Install Telescope**
   ```bash
   npm install @nestjs/telescope
   ```

3. **Configure Basic Setup**
   ```typescript
   // Start with basic configuration
   TelescopeModule.forRoot({
     enabled: true,
     storage: { driver: 'memory' },
     watchers: { request: true, exception: true }
   })
   ```

### Phase 2: Core Migration (Week 2-3)
1. **Migrate Request Monitoring**
2. **Migrate Error Tracking**
3. **Migrate Database Monitoring**
4. **Test Integration**

### Phase 3: Advanced Features (Week 4-6)
1. **Enable ML Analytics**
2. **Configure Alerting**
3. **Set up Dashboard**
4. **Performance Testing**

### Phase 4: Production (Week 7-8)
1. **Database Storage**
2. **Security Configuration**
3. **Load Testing**
4. **Go Live**

### Phase 5: Optimization (Week 9-12)
1. **Performance Tuning**
2. **Enterprise Features**
3. **Multi-Tenant Setup**
4. **Final Testing**

## 🔧 Migration Scripts

### Data Migration Script
```typescript
// migrate-data.ts
import { TelescopeService } from '@nestjs/telescope';

export class DataMigrationService {
  constructor(private telescopeService: TelescopeService) {}

  async migrateFromLegacySystem() {
    const legacyData = await this.loadLegacyData();
    
    for (const entry of legacyData) {
      const telescopeEntry = this.convertEntry(entry);
      await this.telescopeService.record(telescopeEntry);
    }
  }

  private convertEntry(legacyEntry: any) {
    return {
      type: this.mapType(legacyEntry.type),
      timestamp: new Date(legacyEntry.timestamp),
      content: {
        ...legacyEntry.data,
        migrated: true,
        source: 'legacy-system'
      }
    };
  }
}
```

### Configuration Migration Script
```typescript
// migrate-config.ts
export class ConfigMigrationService {
  async migrateConfig(legacyConfig: any) {
    return {
      enabled: true,
      storage: this.migrateStorageConfig(legacyConfig.storage),
      watchers: this.migrateWatchersConfig(legacyConfig.watchers),
      alerting: this.migrateAlertingConfig(legacyConfig.alerts)
    };
  }

  private migrateStorageConfig(legacyStorage: any) {
    return {
      driver: legacyStorage.type === 'database' ? 'database' : 'file',
      database: legacyStorage.database || undefined,
      path: legacyStorage.path || './telescope-storage'
    };
  }
}
```

## 🛠️ Troubleshooting

### Common Issues

#### 1. Performance Impact
```typescript
// Solution: Enable sampling
TelescopeModule.forRoot({
  watchers: {
    request: {
      enabled: true,
      sampling: 10 // 10% sampling
    }
  }
})
```

#### 2. Storage Issues
```typescript
// Solution: Use appropriate storage driver
TelescopeModule.forRoot({
  storage: {
    driver: 'database', // For production
    database: {
      type: 'postgresql',
      // ... database config
    }
  }
})
```

#### 3. Memory Usage
```typescript
// Solution: Configure retention
TelescopeModule.forRoot({
  storage: {
    retention: {
      hours: 24,
      maxEntries: 10000
    }
  }
})
```

### Migration Checklist

- [ ] Install NestJS Telescope
- [ ] Configure basic setup
- [ ] Migrate request monitoring
- [ ] Migrate error tracking
- [ ] Migrate database monitoring
- [ ] Configure alerting
- [ ] Set up dashboard
- [ ] Test performance
- [ ] Configure production storage
- [ ] Enable security features
- [ ] Load testing
- [ ] Go live
- [ ] Monitor and optimize

### Support

If you encounter issues during migration:

1. **Check Documentation**: [https://nestjs.com/telescope](https://nestjs.com/telescope)
2. **GitHub Issues**: [https://github.com/nestjs/telescope/issues](https://github.com/nestjs/telescope/issues)
3. **Discord Community**: [https://discord.gg/nestjs](https://discord.gg/nestjs)
4. **Email Support**: telescope@nestjs.com

## 📊 Migration Success Metrics

Track these metrics to ensure successful migration:

- **Coverage**: 100% of critical endpoints monitored
- **Performance**: <2% overhead on application performance
- **Reliability**: 99.9% uptime for monitoring system
- **Data Quality**: Accurate and complete monitoring data
- **User Adoption**: Team actively using Telescope dashboard

---

**Need help with migration? Contact us at telescope@nestjs.com** 
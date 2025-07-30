# 🚀 NestJS Telescope v1.0.0

**Advanced observability and monitoring solution for NestJS applications with ML-powered analytics, **enterprise** features, and production-ready scaling.**

[![NPM Version][npm-image]][npm-url]
[![NPM Downloads][downloads-image]][downloads-url]
[![Build Status][build-image]][build-url]
[![Coverage Status][coverage-image]][coverage-url]
[![License][license-image]][license-url]

## ✨ Features

### 🔍 **Core Monitoring**
- **Request Watcher**: HTTP request/response monitoring with performance metrics
- **Query Watcher**: Database query analysis with optimization suggestions
- **Exception Watcher**: Comprehensive error tracking with stack trace analysis
- **Job Watcher**: Background job monitoring with Bull/BullMQ integration
- **Cache Watcher**: Redis/Memory cache performance monitoring

### 🤖 **ML-Powered Analytics**
- **Anomaly Detection**: Statistical algorithms for detecting unusual patterns
- **Performance Regression**: Trend analysis and degradation detection
- **Query Optimization**: ML-based database optimization suggestions
- **Predictive Insights**: Forecasting performance and resource usage
- **Automated Alerting**: Intelligent alert generation and management

### 🏢 **Enterprise Features**
- **Multi-Tenant Support**: Complete tenant isolation and resource management
- **Advanced Security**: SSO, OAuth2, SAML, LDAP integration
- **Role-Based Access Control**: Granular permissions and policies
- **Compliance**: GDPR, SOX, HIPAA, PCI compliance monitoring
- **Custom Branding**: White-label capabilities and theme customization

### ⚡ **Production Ready**
- **Horizontal Scaling**: Distributed deployment with load balancing
- **Advanced Caching**: Multi-tier caching with intelligent eviction
- **Database Optimization**: Query optimization and indexing strategies
- **Memory Management**: Garbage collection and leak detection
- **Performance Benchmarking**: Comprehensive load testing suite

### 🔧 **Developer Experience**
- **TypeScript First**: Full type safety and IntelliSense support
- **Comprehensive Testing**: Unit, integration, and performance tests
- **Rich Documentation**: API docs, examples, and migration guides
- **Easy Integration**: Simple setup with minimal configuration
- **Extensible Architecture**: Plugin-based watcher system

## 📦 Installation

### Prerequisites

- Node.js >= 18.0.0
- npm >= 8.0.0
- NestJS >= 10.0.0

### Install the Package

```bash
npm install ahmedhegazee/nestjs-telescope
```

### Install Optional Dependencies

For full functionality, install these optional dependencies:

```bash
# Database support
npm install @nestjs/typeorm typeorm pg mysql2 sqlite3

# Job queue support
npm install @nestjs/bull bull

# Cache support
npm install redis

# Security features
npm install bcryptjs jsonwebtoken passport passport-jwt passport-oauth2

# Email notifications
npm install nodemailer

# Slack notifications
npm install @slack/web-api

# PDF generation
npm install pdf-lib puppeteer

# Excel export
npm install exceljs

# Compression
npm install compression

# Rate limiting
npm install express-rate-limit express-slow-down

# Security headers
npm install helmet cors
```

## 🚀 Quick Start

### 1. Basic Setup

```typescript
import { Module } from '@nestjs/common';
import { TelescopeModule } from 'ahmedhegazee/nestjs-telescope';

@Module({
  imports: [
    TelescopeModule.forRoot({
      enabled: true,
      storage: {
        driver: 'file',
        path: './telescope-storage'
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

### 2. Advanced Configuration

```typescript
import { Module } from '@nestjs/common';
import { TelescopeModule } from 'ahmedhegazee/nestjs-telescope';

@Module({
  imports: [
    TelescopeModule.forRoot({
      enabled: true,
      
      // Storage Configuration
      storage: {
        driver: 'database',
        database: {
          type: 'postgresql',
          host: 'localhost',
          port: 5432,
          database: 'telescope',
          username: 'user',
          password: 'password'
        },
        retention: {
          hours: 24,
          maxEntries: 10000
        }
      },

      // Watchers Configuration
      watchers: {
        request: {
          enabled: true,
          sampling: 100, // 100% sampling
          maskSensitiveData: true,
          excludePaths: ['/health', '/metrics'],
          logSuccessfulResponseBodies: false
        },
        query: {
          enabled: true,
          slowQueryThreshold: 1000, // 1 second
          connectionPoolMonitoring: true,
          enableQueryAnalysis: true
        },
        exception: {
          enabled: true,
          grouping: true,
          stackTraceAnalysis: true,
          enableSourceMaps: true,
          maxStackTraceDepth: 10
        },
        job: {
          enabled: true,
          queueMonitoring: true,
          performanceTracking: true,
          enableJobHistory: true
        },
        cache: {
          enabled: true,
          hitRatioTracking: true,
          memoryUsageMonitoring: true,
          enableCacheAnalysis: true
        }
      },

      // ML Analytics Configuration
      mlAnalytics: {
        enabled: true,
        anomalyDetection: true,
        performanceRegression: true,
        queryOptimization: true,
        predictiveInsights: true,
        dataRetention: 30 // days
      },

      // Alerting Configuration
      alerting: {
        enabled: true,
        channels: {
          email: {
            enabled: true,
            smtp: {
              host: 'smtp.gmail.com',
              port: 587,
              secure: false,
              auth: {
                user: 'your-email@gmail.com',
                pass: 'your-password'
              }
            }
          },
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'
          }
        }
      },

      // Enterprise Features
      enterpriseSecurity: {
        enabled: true,
        authentication: {
          enabled: true,
          methods: ['jwt', 'oauth2']
        },
        authorization: {
          enabled: true,
          rbac: true,
          abac: true
        }
      },

      multiTenant: {
        enabled: true,
        isolation: {
          strategy: 'database',
          databasePrefix: 'telescope_'
        }
      },

      // DevTools Integration
      devtools: {
        enabled: true,
        port: 3001,
        features: {
          dependencyGraph: true,
          interactivePlayground: true,
          performanceMetrics: true
        }
      }
    })
  ]
})
export class AppModule {}
```

### 3. Environment Variables

Create a `.env` file in your project root:

```env
# Telescope Configuration
TELESCOPE_ENABLED=true
TELESCOPE_STORAGE_DRIVER=database
TELESCOPE_STORAGE_DATABASE_URL=postgresql://user:pass@localhost:5432/telescope

# Security
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=1h

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Slack Configuration
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Redis Configuration
REDIS_URL=redis://localhost:6379

# Database Configuration
DATABASE_URL=postgresql://user:pass@localhost:5432/telescope
```

## 📊 Dashboard

Access the Telescope dashboard at `http://localhost:3000/telescope` to view:

- **Real-time Metrics**: Live performance and error monitoring
- **Analytics Dashboard**: ML-powered insights and trends
- **Query Analysis**: Database performance and optimization suggestions
- **Job Monitoring**: Background job status and performance
- **Cache Analytics**: Hit ratios and memory usage
- **Security Audit**: Compliance and security monitoring

## 🔧 API Reference

### Core Services

#### TelescopeService
```typescript
import { TelescopeService } from 'ahmedhegazee/nestjs-telescope';

@Injectable()
export class MyService {
  constructor(private telescopeService: TelescopeService) {}

  async recordEntry(entry: TelescopeEntry) {
    await this.telescopeService.record(entry);
  }

  async findEntries(filter: TelescopeFilter) {
    return await this.telescopeService.find(filter);
  }

  async getMetrics() {
    return await this.telescopeService.getMetrics();
  }
}
```

#### MLAnalyticsService
```typescript
import { MLAnalyticsService } from 'ahmedhegazee/nestjs-telescope';

@Injectable()
export class AnalyticsService {
  constructor(private mlAnalytics: MLAnalyticsService) {}

  async getAnomalies() {
    return await this.mlAnalytics.getAnomalies();
  }

  async getPredictiveInsights() {
    return await this.mlAnalytics.getPredictiveInsights();
  }

  async getQueryOptimizations() {
    return await this.mlAnalytics.getQueryOptimizations();
  }
}
```

#### AutomatedAlertingService
```typescript
import { AutomatedAlertingService } from 'ahmedhegazee/nestjs-telescope';

@Injectable()
export class AlertService {
  constructor(private alerting: AutomatedAlertingService) {}

  async createAlert(alert: AlertRule) {
    return await this.alerting.createAlert(alert);
  }

  async getAlertHistory() {
    return await this.alerting.getAlertHistory();
  }
}
```

### Controllers

#### Health Controller
```typescript
GET /telescope/health
GET /telescope/health/detailed
GET /telescope/health/metrics
```

#### Analytics Controller
```typescript
GET /telescope/analytics/anomalies
GET /telescope/analytics/predictions
GET /telescope/analytics/optimizations
POST /telescope/analytics/query
```

#### Alerting Controller
```typescript
GET /telescope/alerts
POST /telescope/alerts
PUT /telescope/alerts/:id
DELETE /telescope/alerts/:id
```

## 🏢 Enterprise Features

### Multi-Tenant Support

```typescript
import { MultiTenantService } from 'ahmedhegazee/nestjs-telescope';

@Injectable()
export class TenantService {
  constructor(private multiTenantService: MultiTenantService) {}

  async createTenant() {
    // Tenant provisioning
    const tenant = await this.multiTenantService.provisionTenant({
      name: 'Acme Corp',
      slug: 'acme-corp',
      plan: 'enterprise',
      metadata: {
        industry: 'technology',
        size: 'enterprise'
      }
    });

    // Tenant-specific configuration
    await this.multiTenantService.updateTenantConfiguration(tenant.id, {
      features: {
        mlAnalytics: true,
        alerting: true
      },
      settings: {
        dataRetention: 365,
        samplingRate: 100
      }
    });

    return tenant;
  }
}
```

### Advanced Security

```typescript
import { EnterpriseSecurityService } from 'ahmedhegazee/nestjs-telescope';

@Injectable()
export class SecurityService {
  constructor(private securityService: EnterpriseSecurityService) {}

  async authenticate() {
    // Authentication
    const authResult = await this.securityService.authenticate({
      method: 'oauth2',
      code: 'authorization_code'
    });

    return authResult;
  }

  async authorize(userId: string, action: string, resource: string) {
    // Authorization
    const authzResult = await this.securityService.authorize(
      userId,
      action,
      resource,
      { ipAddress: '192.168.1.1' }
    );

    return authzResult;
  }

  async getComplianceReport() {
    // Compliance monitoring
    const compliance = await this.securityService.generateComplianceReport();
    return compliance;
  }
}
```

### Custom Branding

```typescript
import { MultiTenantService } from 'ahmedhegazee/nestjs-telescope';

@Injectable()
export class BrandingService {
  constructor(private multiTenantService: MultiTenantService) {}

  async updateBranding(tenantId: string) {
    await this.multiTenantService.updateTenantBranding(tenantId, {
      logo: 'https://example.com/logo.png',
      primaryColor: '#007bff',
      secondaryColor: '#6c757d',
      companyName: 'Acme Corporation',
      theme: 'dark'
    });
  }
}
```

## ⚡ Performance & Scaling

### Horizontal Scaling

```typescript
import { HorizontalScalingService } from 'ahmedhegazee/nestjs-telescope';

@Injectable()
export class ScalingService {
  constructor(private scalingService: HorizontalScalingService) {}

  async configureScaling() {
    // Enable horizontal scaling
    const scalingConfig = {
      enabled: true,
      clusterMode: true,
      discovery: {
        method: 'redis',
        interval: 30000
      },
      loadBalancing: {
        strategy: 'least-loaded',
        healthCheckInterval: 10000
      }
    };

    return scalingConfig;
  }
}
```

### Advanced Caching

```typescript
import { AdvancedCachingService } from 'ahmedhegazee/nestjs-telescope';

@Injectable()
export class CacheService {
  constructor(private cacheService: AdvancedCachingService) {}

  async configureCaching() {
    // Multi-tier caching
    const cacheConfig = {
      tiers: {
        l1: { type: 'memory', maxSize: 100, ttl: 300000 },
        l2: { type: 'redis', ttl: 3600000 },
        l3: { type: 'database', ttl: 86400000 }
      },
      strategies: {
        writePolicy: 'write-through',
        readPolicy: 'read-through',
        evictionPolicy: 'lru'
      }
    };

    return cacheConfig;
  }
}
```

### Database Optimization

```typescript
import { DatabaseOptimizerService } from 'ahmedhegazee/nestjs-telescope';

@Injectable()
export class DatabaseService {
  constructor(private dbOptimizer: DatabaseOptimizerService) {}

  async optimizeQuery(query: string) {
    // Query optimization
    const optimization = await this.dbOptimizer.optimizeQuery(query);
    return optimization;
  }

  async getIndexSuggestions() {
    // Index suggestions
    const suggestions = await this.dbOptimizer.getIndexSuggestions();
    return suggestions;
  }
}
```

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
npm run test:e2e
```

### Performance Tests
```bash
npm run test:performance
```

### Load Testing
```bash
npm run benchmark
```

## 🚀 Deployment

### Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist
COPY node_modules ./node_modules

EXPOSE 3000

CMD ["node", "dist/main.js"]
```

```bash
# Build and run
docker build -t nestjs-telescope .
docker run -p 3000:3000 nestjs-telescope
```

### Docker Compose

```yaml
version: '3.8'

services:
  telescope:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://user:pass@postgres:5432/telescope
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: telescope
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: telescope
spec:
  replicas: 3
  selector:
    matchLabels:
      app: telescope
  template:
    metadata:
      labels:
        app: telescope
    spec:
      containers:
      - name: telescope
        image: nestjs/telescope:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: telescope-secrets
              key: database-url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

## 📈 Monitoring & Observability

### Metrics

Telescope exposes Prometheus metrics at `/telescope/metrics`:

```typescript
// Custom metrics
const metrics = {
  requests_total: 1000,
  requests_duration_seconds: 0.5,
  errors_total: 10,
  cache_hit_ratio: 0.85,
  database_connections: 5
};
```

### Health Checks

```typescript
// Health check endpoints
GET /telescope/health
GET /telescope/health/ready
GET /telescope/health/live
```

### Logging

```typescript
// Structured logging
this.logger.log('Request processed', {
  userId: '123',
  duration: 150,
  status: 'success',
  metadata: { endpoint: '/api/users' }
});
```

## 🔒 Security

### Authentication

```typescript
// JWT Authentication
const token = jwt.sign(
  { userId: '123', roles: ['admin'] },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

// OAuth2 Integration
const oauthConfig = {
  providers: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET
    }
  }
};
```

### Authorization

```typescript
// Role-based access control
@Roles('admin')
@Permissions('telescope:read', 'telescope:write')
export class TelescopeController {
  // Controller methods
}

// Policy-based authorization
const policy = {
  id: 'admin-access',
  type: 'allow',
  resources: ['telescope:*'],
  actions: ['*'],
  conditions: [
    { field: 'roles', operator: 'contains', value: 'admin' }
  ]
};
```

### Data Protection

```typescript
// Data encryption
const encrypted = await securityService.encrypt(sensitiveData);
const decrypted = await securityService.decrypt(encrypted);

// Data masking
const maskedData = {
  email: 'u***@e***.com',
  phone: '+1-***-***-1234',
  ssn: '***-**-1234'
};
```

## 📚 Examples

### Basic Monitoring

```typescript
import { Controller, Get } from '@nestjs/common';
import { TelescopeService } from 'ahmedhegazee/nestjs-telescope';

@Controller('users')
export class UsersController {
  constructor(private telescopeService: TelescopeService) {}

  @Get()
  async getUsers() {
    // Telescope automatically monitors this request
    return await this.userService.findAll();
  }
}
```

### Custom Watcher

```typescript
import { Injectable } from '@nestjs/common';
import { Watcher, TelescopeEntry } from 'ahmedhegazee/nestjs-telescope';

@Injectable()
export class CustomWatcher implements Watcher {
  async process(entry: TelescopeEntry): Promise<void> {
    // Custom processing logic
    console.log('Custom watcher processed:', entry);
  }
}
```

### ML Analytics Integration

```typescript
import { Injectable } from '@nestjs/common';
import { MLAnalyticsService } from 'ahmedhegazee/nestjs-telescope';

@Injectable()
export class AnalyticsService {
  constructor(private mlAnalytics: MLAnalyticsService) {}

  async analyzePerformance() {
    const anomalies = await this.mlAnalytics.getAnomalies();
    const predictions = await this.mlAnalytics.getPredictiveInsights();
    
    return { anomalies, predictions };
  }
}
```

### Alerting

```typescript
import { Injectable } from '@nestjs/common';
import { AutomatedAlertingService } from 'ahmedhegazee/nestjs-telescope';

@Injectable()
export class AlertService {
  constructor(private alerting: AutomatedAlertingService) {}

  async setupAlerts() {
    await this.alerting.createAlert({
      name: 'High Error Rate',
      condition: 'error_rate > 0.05',
      channels: ['email', 'slack'],
      severity: 'high'
    });
  }
}
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

```bash
# Clone the repository
git clone https://github.com/ahmedhegazee/nestjs-telescope.git
cd nestjs-telescope

# Install dependencies
npm install

# Run tests
npm test

# Start development server
npm run start:dev
```

### Code Style

We use ESLint and Prettier for code formatting:

```bash
npm run lint
npm run format
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [NestJS](https://nestjs.com/) - The amazing framework that makes this possible
- [TypeORM](https://typeorm.io/) - Database ORM
- [Bull](https://github.com/OptimalBits/bull) - Job queue
- [Redis](https://redis.io/) - In-memory data store
- [Prometheus](https://prometheus.io/) - Metrics collection
- [Grafana](https://grafana.com/) - Visualization

## 📞 Support

- 📧 Email: ahmedhegazy@example.com
- 💬 Discord: [NestJS Community](https://discord.gg/nestjs)
- 🐛 Issues: [GitHub Issues](https://github.com/ahmedhegazee/nestjs-telescope/issues)
- 📖 Documentation: [https://github.com/ahmedhegazee/nestjs-telescope](https://github.com/ahmedhegazee/nestjs-telescope)

---

**Made with ❤️ by Ahmed Hegazy**

[npm-image]: https://img.shields.io/npm/v/ahmedhegazee/nestjs-telescope.svg
[npm-url]: https://npmjs.org/package/ahmedhegazee/nestjs-telescope
[downloads-image]: https://img.shields.io/npm/dm/ahmedhegazee/nestjs-telescope.svg
[downloads-url]: https://npmjs.org/package/ahmedhegazee/nestjs-telescope
[build-image]: https://img.shields.io/github/actions/workflow/status/ahmedhegazee/nestjs-telescope/ci.yml
[build-url]: https://github.com/ahmedhegazee/nestjs-telescope/actions
[coverage-image]: https://img.shields.io/codecov/c/github/ahmedhegazee/nestjs-telescope
[coverage-url]: https://codecov.io/gh/ahmedhegazee/nestjs-telescope
[license-image]: https://img.shields.io/npm/l/ahmedhegazee/nestjs-telescope.svg
[license-url]: https://github.com/ahmedhegazee/nestjs-telescope/blob/main/LICENSE
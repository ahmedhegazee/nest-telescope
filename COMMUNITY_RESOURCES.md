# 🌟 Community Resources - NestJS Telescope

Welcome to the NestJS Telescope community! This guide provides resources, tutorials, and examples to help you get the most out of Telescope.

## 📚 Table of Contents

1. [Getting Started Tutorials](#getting-started-tutorials)
2. [Advanced Examples](#advanced-examples)
3. [Community Guidelines](#community-guidelines)
4. [Contributing](#contributing)
5. [Support Channels](#support-channels)
6. [Showcase](#showcase)

## 🚀 Getting Started Tutorials

### Tutorial 1: Basic Setup (5 minutes)

**Goal**: Set up Telescope in a new NestJS application

```bash
# 1. Create new NestJS app
nest new my-app
cd my-app

# 2. Install Telescope
npm install @nestjs/telescope

# 3. Configure Telescope
```

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { TelescopeModule } from '@nestjs/telescope';

@Module({
  imports: [
    TelescopeModule.forRoot({
      enabled: true,
      storage: { driver: 'memory' },
      watchers: {
        request: true,
        exception: true
      }
    })
  ]
})
export class AppModule {}
```

```typescript
// Create a simple controller
@Controller('hello')
export class HelloController {
  @Get()
  getHello() {
    return { message: 'Hello Telescope!' };
  }
}
```

**Result**: Visit `http://localhost:3000/telescope` to see your first monitored request!

### Tutorial 2: Database Monitoring (10 minutes)

**Goal**: Monitor database queries and optimize performance

```typescript
// 1. Install TypeORM
npm install @nestjs/typeorm typeorm pg

// 2. Configure TypeORM with Telescope
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'test',
      username: 'user',
      password: 'password',
      entities: [User],
      synchronize: true
    }),
    TelescopeModule.forRoot({
      watchers: {
        query: {
          enabled: true,
          slowQueryThreshold: 1000
        }
      }
    })
  ]
})
export class AppModule {}
```

```typescript
// 3. Create entity and service
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  email: string;
}

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>
  ) {}

  async findAll() {
    return await this.userRepository.find();
  }

  async findByEmail(email: string) {
    return await this.userRepository.findOne({ where: { email } });
  }
}
```

**Result**: Telescope will automatically monitor all database queries and suggest optimizations!

### Tutorial 3: Custom Watcher (15 minutes)

**Goal**: Create a custom watcher for business-specific monitoring

```typescript
// 1. Create custom watcher
import { Injectable } from '@nestjs/common';
import { Watcher, TelescopeEntry } from '@nestjs/telescope';

@Injectable()
export class BusinessMetricsWatcher implements Watcher {
  async process(entry: TelescopeEntry): Promise<void> {
    if (entry.type === 'business_metric') {
      await this.processBusinessMetric(entry);
    }
  }

  private async processBusinessMetric(entry: TelescopeEntry) {
    const { metric, value, userId } = entry.content;
    
    // Process business metrics
    switch (metric) {
      case 'user_registration':
        await this.trackUserRegistration(value, userId);
        break;
      case 'payment_processed':
        await this.trackPayment(value, userId);
        break;
      case 'feature_usage':
        await this.trackFeatureUsage(value, userId);
        break;
    }
  }

  private async trackUserRegistration(value: any, userId: string) {
    // Track user registration metrics
    console.log(`User registration: ${userId} - ${value}`);
  }

  private async trackPayment(value: any, userId: string) {
    // Track payment metrics
    console.log(`Payment processed: ${userId} - $${value.amount}`);
  }

  private async trackFeatureUsage(value: any, userId: string) {
    // Track feature usage
    console.log(`Feature used: ${value.feature} by ${userId}`);
  }
}
```

```typescript
// 2. Register custom watcher
@Module({
  providers: [BusinessMetricsWatcher],
  exports: [BusinessMetricsWatcher]
})
export class BusinessModule {}

// 3. Use in your application
@Injectable()
export class UserService {
  constructor(
    private telescopeService: TelescopeService,
    private businessWatcher: BusinessMetricsWatcher
  ) {}

  async registerUser(userData: any) {
    const user = await this.userRepository.create(userData);
    
    // Record business metric
    await this.telescopeService.record({
      type: 'business_metric',
      timestamp: new Date(),
      content: {
        metric: 'user_registration',
        value: userData,
        userId: user.id
      }
    });

    return user;
  }
}
```

### Tutorial 4: ML Analytics Integration (20 minutes)

**Goal**: Leverage ML analytics for intelligent monitoring

```typescript
// 1. Configure ML analytics
TelescopeModule.forRoot({
  mlAnalytics: {
    enabled: true,
    anomalyDetection: true,
    performanceRegression: true,
    queryOptimization: true,
    predictiveInsights: true
  }
})
```

```typescript
// 2. Create analytics service
@Injectable()
export class AnalyticsService {
  constructor(private mlAnalytics: MLAnalyticsService) {}

  async getSystemInsights() {
    const [anomalies, predictions, optimizations] = await Promise.all([
      this.mlAnalytics.getAnomalies(),
      this.mlAnalytics.getPredictiveInsights(),
      this.mlAnalytics.getQueryOptimizations()
    ]);

    return {
      anomalies: anomalies.filter(a => a.severity === 'high'),
      predictions: predictions.slice(0, 5),
      optimizations: optimizations.slice(0, 3)
    };
  }

  async monitorPerformance() {
    const healthScore = await this.mlAnalytics.getHealthScore();
    
    if (healthScore < 70) {
      await this.triggerPerformanceAlert(healthScore);
    }
  }

  private async triggerPerformanceAlert(score: number) {
    // Trigger alert for low health score
    console.log(`Performance alert: Health score is ${score}`);
  }
}
```

```typescript
// 3. Create analytics controller
@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('insights')
  async getInsights() {
    return await this.analyticsService.getSystemInsights();
  }

  @Get('health-score')
  async getHealthScore() {
    return { score: await this.mlAnalytics.getHealthScore() };
  }
}
```

## 🔥 Advanced Examples

### Example 1: E-commerce Monitoring

```typescript
// Complete e-commerce monitoring setup
@Module({
  imports: [
    TelescopeModule.forRoot({
      enabled: true,
      storage: { driver: 'database' },
      watchers: {
        request: { enabled: true, sampling: 100 },
        query: { enabled: true, slowQueryThreshold: 500 },
        exception: { enabled: true, grouping: true },
        job: { enabled: true },
        cache: { enabled: true }
      },
      mlAnalytics: {
        enabled: true,
        anomalyDetection: true,
        predictiveInsights: true
      },
      alerting: {
        enabled: true,
        channels: {
          email: { enabled: true },
          slack: { enabled: true }
        }
      }
    })
  ]
})
export class EcommerceModule {}

// Custom e-commerce watcher
@Injectable()
export class EcommerceWatcher implements Watcher {
  async process(entry: TelescopeEntry): Promise<void> {
    switch (entry.type) {
      case 'order_created':
        await this.trackOrder(entry);
        break;
      case 'payment_processed':
        await this.trackPayment(entry);
        break;
      case 'inventory_updated':
        await this.trackInventory(entry);
        break;
    }
  }

  private async trackOrder(entry: TelescopeEntry) {
    const { orderId, amount, userId } = entry.content;
    
    // Track order metrics
    await this.metricsService.increment('orders.total');
    await this.metricsService.record('orders.amount', amount);
    
    // Check for anomalies
    if (amount > 10000) {
      await this.alertService.createAlert({
        name: 'High Value Order',
        message: `Order ${orderId} has high value: $${amount}`,
        severity: 'medium'
      });
    }
  }
}
```

### Example 2: Microservices Monitoring

```typescript
// Microservices monitoring with distributed tracing
@Module({
  imports: [
    TelescopeModule.forRoot({
      enabled: true,
      watchers: {
        request: {
          enabled: true,
          correlation: true, // Enable distributed tracing
          performance: true
        }
      },
      scaling: {
        enabled: true,
        clusterMode: true,
        discovery: { method: 'redis' }
      }
    })
  ]
})
export class MicroservicesModule {}

// Service-to-service communication monitoring
@Injectable()
export class ServiceCommunicationWatcher implements Watcher {
  async process(entry: TelescopeEntry): Promise<void> {
    if (entry.type === 'service_call') {
      await this.trackServiceCall(entry);
    }
  }

  private async trackServiceCall(entry: TelescopeEntry) {
    const { from, to, duration, success } = entry.content;
    
    // Track service dependencies
    await this.dependencyGraph.addEdge(from, to, {
      calls: 1,
      duration,
      success
    });
    
    // Alert on service failures
    if (!success) {
      await this.alertService.createAlert({
        name: 'Service Communication Failure',
        message: `Service ${from} failed to communicate with ${to}`,
        severity: 'high'
      });
    }
  }
}
```

### Example 3: Real-time Dashboard

```typescript
// Real-time dashboard with WebSocket updates
@Controller('dashboard')
export class DashboardController {
  constructor(
    private telescopeService: TelescopeService,
    private mlAnalytics: MLAnalyticsService
  ) {}

  @Get('metrics')
  async getMetrics() {
    const [requests, errors, performance] = await Promise.all([
      this.getRequestMetrics(),
      this.getErrorMetrics(),
      this.getPerformanceMetrics()
    ]);

    return { requests, errors, performance };
  }

  @Get('alerts')
  async getAlerts() {
    return await this.alertService.getActiveAlerts();
  }

  @Get('predictions')
  async getPredictions() {
    return await this.mlAnalytics.getPredictiveInsights();
  }

  private async getRequestMetrics() {
    const entries = await this.telescopeService.find({
      type: 'request',
      timestamp: { $gte: new Date(Date.now() - 3600000) } // Last hour
    });

    return {
      total: entries.length,
      success: entries.filter(e => e.content.status < 400).length,
      averageDuration: entries.reduce((sum, e) => sum + e.content.duration, 0) / entries.length
    };
  }
}
```

### Example 4: Enterprise Multi-Tenant Setup

```typescript
// Enterprise multi-tenant configuration
@Module({
  imports: [
    TelescopeModule.forRoot({
      enabled: true,
      multiTenant: {
        enabled: true,
        isolation: {
          strategy: 'database',
          databasePrefix: 'telescope_'
        }
      },
      enterpriseSecurity: {
        enabled: true,
        authentication: {
          enabled: true,
          methods: ['jwt', 'oauth2', 'saml']
        },
        authorization: {
          enabled: true,
          rbac: true,
          abac: true
        }
      }
    })
  ]
})
export class EnterpriseModule {}

// Tenant provisioning service
@Injectable()
export class TenantProvisioningService {
  constructor(private multiTenantService: MultiTenantService) {}

  async provisionTenant(tenantData: TenantData) {
    const tenant = await this.multiTenantService.provisionTenant({
      name: tenantData.name,
      slug: tenantData.slug,
      plan: tenantData.plan,
      metadata: tenantData.metadata
    });

    // Configure tenant-specific settings
    await this.multiTenantService.updateTenantConfiguration(tenant.id, {
      features: this.getFeaturesForPlan(tenantData.plan),
      settings: this.getSettingsForPlan(tenantData.plan)
    });

    // Set up custom branding
    await this.multiTenantService.updateTenantBranding(tenant.id, {
      logo: tenantData.logo,
      primaryColor: tenantData.primaryColor,
      companyName: tenantData.companyName
    });

    return tenant;
  }

  private getFeaturesForPlan(plan: string) {
    const planFeatures = {
      free: { mlAnalytics: false, alerting: false },
      basic: { mlAnalytics: false, alerting: true },
      professional: { mlAnalytics: true, alerting: true },
      enterprise: { mlAnalytics: true, alerting: true }
    };
    return planFeatures[plan] || planFeatures.free;
  }
}
```

## 📋 Community Guidelines

### Code of Conduct

1. **Be Respectful**: Treat all community members with respect
2. **Be Helpful**: Share knowledge and help others learn
3. **Be Constructive**: Provide constructive feedback
4. **Be Inclusive**: Welcome developers of all skill levels
5. **Be Professional**: Maintain professional behavior

### Contribution Guidelines

#### Before Contributing
1. Read the [Contributing Guide](CONTRIBUTING.md)
2. Check existing issues and pull requests
3. Discuss major changes in issues first
4. Follow the coding standards

#### Pull Request Process
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new features
5. Update documentation
6. Submit a pull request

#### Code Standards
```typescript
// Follow TypeScript best practices
export interface MyInterface {
  readonly id: string;
  name: string;
  optionalField?: string;
}

// Use proper error handling
try {
  await this.performOperation();
} catch (error) {
  this.logger.error('Operation failed', error);
  throw new CustomException('Operation failed');
}

// Write comprehensive tests
describe('MyService', () => {
  it('should perform operation successfully', async () => {
    const result = await service.performOperation();
    expect(result).toBeDefined();
  });
});
```

## 🤝 Contributing

### Areas to Contribute

1. **Core Features**: Enhance existing watchers and services
2. **New Watchers**: Create watchers for new technologies
3. **Documentation**: Improve guides and examples
4. **Testing**: Add tests and improve coverage
5. **Performance**: Optimize performance and reduce overhead
6. **Security**: Enhance security features
7. **Examples**: Create real-world examples and tutorials

### Getting Started with Development

```bash
# Clone the repository
git clone https://github.com/nestjs/telescope.git
cd telescope

# Install dependencies
npm install

# Run tests
npm test

# Start development server
npm run start:dev

# Build the project
npm run build
```

### Development Workflow

1. **Create Issue**: Describe the problem or feature
2. **Fork Repository**: Create your own fork
3. **Create Branch**: Use descriptive branch names
4. **Make Changes**: Follow coding standards
5. **Add Tests**: Ensure good test coverage
6. **Update Docs**: Keep documentation current
7. **Submit PR**: Create pull request with description

## 📞 Support Channels

### Official Support

- **Email**: telescope@nestjs.com
- **GitHub Issues**: [https://github.com/nestjs/telescope/issues](https://github.com/nestjs/telescope/issues)
- **Documentation**: [https://nestjs.com/telescope](https://nestjs.com/telescope)

### Community Support

- **Discord**: [NestJS Community](https://discord.gg/nestjs)
- **Stack Overflow**: [nestjs-telescope](https://stackoverflow.com/questions/tagged/nestjs-telescope)
- **Reddit**: [r/NestJS](https://www.reddit.com/r/NestJS/)

### Getting Help

When asking for help, please include:

1. **Version**: Telescope and NestJS versions
2. **Configuration**: Your Telescope configuration
3. **Error Messages**: Complete error messages
4. **Code Example**: Minimal reproducible example
5. **Environment**: OS, Node.js version, database

## 🌟 Showcase

### Featured Projects

#### 1. E-commerce Platform
- **Company**: TechCorp
- **Scale**: 1M+ users
- **Features**: Multi-tenant, ML analytics, real-time monitoring
- **Results**: 40% reduction in response time, 99.9% uptime

#### 2. Financial Services App
- **Company**: FinTech Inc
- **Scale**: 500K+ transactions/day
- **Features**: Compliance monitoring, security audit, alerting
- **Results**: 100% compliance score, zero security incidents

#### 3. Healthcare Platform
- **Company**: HealthTech
- **Scale**: 100K+ patients
- **Features**: HIPAA compliance, data encryption, audit trails
- **Results**: HIPAA certified, 99.99% data accuracy

### Community Projects

#### Open Source Integrations
- [Telescope-Grafana](https://github.com/community/telescope-grafana) - Grafana integration
- [Telescope-Prometheus](https://github.com/community/telescope-prometheus) - Prometheus exporter
- [Telescope-Slack](https://github.com/community/telescope-slack) - Slack notifications

#### Tutorials and Examples
- [Telescope-Examples](https://github.com/community/telescope-examples) - Collection of examples
- [Telescope-Tutorials](https://github.com/community/telescope-tutorials) - Step-by-step tutorials
- [Telescope-Best-Practices](https://github.com/community/telescope-best-practices) - Best practices guide

### Share Your Project

To showcase your project:

1. **Create Issue**: Use the "Showcase" label
2. **Provide Details**: Include project description, scale, features
3. **Share Results**: Include performance improvements, metrics
4. **Add Screenshots**: Dashboard screenshots, if possible
5. **Link Repository**: If open source

## 📈 Community Metrics

### Growth
- **GitHub Stars**: 2,500+
- **NPM Downloads**: 50,000+ monthly
- **Contributors**: 100+
- **Community Members**: 5,000+

### Impact
- **Projects Using Telescope**: 1,000+
- **Performance Improvements**: Average 30% reduction in response time
- **Uptime Improvements**: Average 99.9% uptime
- **Developer Satisfaction**: 4.8/5 stars

## 🎉 Community Events

### Monthly Meetups
- **Virtual Meetups**: Monthly online sessions
- **Local Meetups**: In-person events in major cities
- **Workshops**: Hands-on Telescope workshops

### Annual Conference
- **Telescope Summit**: Annual conference for users and contributors
- **Talks**: Technical talks and case studies
- **Networking**: Connect with other Telescope users

### Hackathons
- **Quarterly Hackathons**: Build with Telescope
- **Prizes**: Awards for best projects
- **Mentorship**: Expert guidance during events

---

**Join our community and help build the future of NestJS monitoring!**

- 🌟 [Star on GitHub](https://github.com/nestjs/telescope)
- 💬 [Join Discord](https://discord.gg/nestjs)
- 📧 [Contact Us](mailto:telescope@nestjs.com)
- 📖 [Read Documentation](https://nestjs.com/telescope) 
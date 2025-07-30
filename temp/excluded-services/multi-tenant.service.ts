import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Observable, Subject, interval } from "rxjs";
import { map, filter, debounceTime } from "rxjs/operators";
import { TelescopeConfig } from "../interfaces/telescope-config.interface";
import { Inject } from "@nestjs/common";
import * as crypto from "crypto";

export interface MultiTenantConfig {
  enabled: boolean;
  isolation: {
    strategy: "database" | "schema" | "row" | "application";
    databasePrefix: string;
    schemaPrefix: string;
  };
  management: {
    autoProvisioning: boolean;
    resourceLimits: boolean;
    billing: boolean;
    quotas: {
      storage: number; // MB
      requests: number; // per day
      users: number;
      watchers: number;
    };
  };
  features: {
    customBranding: boolean;
    customThemes: boolean;
    customConfigurations: boolean;
    whiteLabel: boolean;
  };
  security: {
    tenantIsolation: boolean;
    crossTenantAccess: boolean;
    dataEncryption: boolean;
  };
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  status: "active" | "suspended" | "pending" | "deleted";
  plan: "free" | "basic" | "professional" | "enterprise";
  createdAt: Date;
  updatedAt: Date;
  metadata: {
    industry?: string;
    size?: string;
    region?: string;
    timezone?: string;
    language?: string;
  };
  configuration: TenantConfiguration;
  limits: TenantLimits;
  usage: TenantUsage;
  branding: TenantBranding;
}

export interface TenantConfiguration {
  features: {
    requestWatcher: boolean;
    queryWatcher: boolean;
    exceptionWatcher: boolean;
    jobWatcher: boolean;
    cacheWatcher: boolean;
    mlAnalytics: boolean;
    alerting: boolean;
    dashboard: boolean;
  };
  settings: {
    dataRetention: number; // days
    samplingRate: number; // percentage
    alertChannels: string[];
    notificationPreferences: Record<string, any>;
  };
  integrations: {
    slack?: SlackIntegration;
    email?: EmailIntegration;
    webhook?: WebhookIntegration;
    custom?: CustomIntegration[];
  };
}

export interface TenantLimits {
  storage: number; // MB
  requests: number; // per day
  users: number;
  watchers: number;
  apiCalls: number; // per day
  customFields: number;
  retentionDays: number;
}

export interface TenantUsage {
  storage: number; // MB
  requests: number; // today
  users: number;
  watchers: number;
  apiCalls: number; // today
  customFields: number;
  lastUpdated: Date;
}

export interface TenantBranding {
  logo?: string;
  favicon?: string;
  primaryColor?: string;
  secondaryColor?: string;
  companyName?: string;
  customCss?: string;
  customJs?: string;
  theme: "light" | "dark" | "auto";
}

export interface SlackIntegration {
  webhookUrl: string;
  channel: string;
  enabled: boolean;
}

export interface EmailIntegration {
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
  };
  fromEmail: string;
  fromName: string;
  enabled: boolean;
}

export interface WebhookIntegration {
  url: string;
  method: "GET" | "POST" | "PUT";
  headers: Record<string, string>;
  enabled: boolean;
}

export interface CustomIntegration {
  name: string;
  type: string;
  config: Record<string, any>;
  enabled: boolean;
}

export interface TenantProvisioningResult {
  success: boolean;
  tenant?: Tenant;
  error?: string;
  resources?: {
    database: string;
    schema?: string;
    storage: string;
  };
}

export interface TenantMetrics {
  tenantId: string;
  timestamp: Date;
  requests: number;
  storage: number;
  users: number;
  errors: number;
  performance: {
    averageResponseTime: number;
    throughput: number;
    errorRate: number;
  };
}

export interface TenantQuotaExceeded {
  tenantId: string;
  resource: string;
  current: number;
  limit: number;
  timestamp: Date;
}

@Injectable()
export class MultiTenantService implements OnModuleInit {
  private readonly logger = new Logger(MultiTenantService.name);
  private readonly tenants = new Map<string, Tenant>();
  private readonly tenantMetrics = new Map<string, TenantMetrics[]>();
  private readonly quotaExceeded = new Map<string, TenantQuotaExceeded[]>();
  private readonly config: MultiTenantConfig;
  private readonly tenantSubject = new Subject<Tenant>();
  private readonly metricsSubject = new Subject<TenantMetrics>();
  private readonly quotaSubject = new Subject<TenantQuotaExceeded>();
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor(
    @Inject("TELESCOPE_CONFIG")
    private readonly telescopeConfig: TelescopeConfig
  ) {
    this.config =
      this.telescopeConfig.multiTenant || this.getDefaultMultiTenantConfig();
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.log("Multi-tenant support disabled");
      return;
    }

    await this.initializeMultiTenancy();
    this.startMonitoring();
    this.logger.log("Multi-tenant service initialized");
  }

  private getDefaultMultiTenantConfig(): MultiTenantConfig {
    return {
      enabled: true,
      isolation: {
        strategy: "database",
        databasePrefix: "telescope_",
        schemaPrefix: "tenant_",
      },
      management: {
        autoProvisioning: true,
        resourceLimits: true,
        billing: false,
        quotas: {
          storage: 1024, // 1GB
          requests: 100000, // 100k per day
          users: 10,
          watchers: 5,
        },
      },
      features: {
        customBranding: true,
        customThemes: true,
        customConfigurations: true,
        whiteLabel: false,
      },
      security: {
        tenantIsolation: true,
        crossTenantAccess: false,
        dataEncryption: true,
      },
    };
  }

  private async initializeMultiTenancy(): Promise<void> {
    // Initialize default tenant
    await this.createDefaultTenant();

    // Initialize tenant isolation
    if (this.config.security.tenantIsolation) {
      await this.initializeTenantIsolation();
    }

    // Initialize resource monitoring
    if (this.config.management.resourceLimits) {
      await this.initializeResourceMonitoring();
    }
  }

  private async createDefaultTenant(): Promise<void> {
    const defaultTenant: Tenant = {
      id: "default",
      name: "Default Tenant",
      slug: "default",
      status: "active",
      plan: "enterprise",
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        industry: "technology",
        size: "enterprise",
        region: "global",
        timezone: "UTC",
        language: "en",
      },
      configuration: this.getDefaultConfiguration(),
      limits: this.getDefaultLimits(),
      usage: this.getDefaultUsage(),
      branding: this.getDefaultBranding(),
    };

    this.tenants.set(defaultTenant.id, defaultTenant);
    this.logger.log("Default tenant created");
  }

  private getDefaultConfiguration(): TenantConfiguration {
    return {
      features: {
        requestWatcher: true,
        queryWatcher: true,
        exceptionWatcher: true,
        jobWatcher: true,
        cacheWatcher: true,
        mlAnalytics: true,
        alerting: true,
        dashboard: true,
      },
      settings: {
        dataRetention: 90,
        samplingRate: 100,
        alertChannels: ["email"],
        notificationPreferences: {
          email: true,
          slack: false,
          webhook: false,
        },
      },
      integrations: {},
    };
  }

  private getDefaultLimits(): TenantLimits {
    return {
      storage: this.config.management.quotas.storage,
      requests: this.config.management.quotas.requests,
      users: this.config.management.quotas.users,
      watchers: this.config.management.quotas.watchers,
      apiCalls: 10000,
      customFields: 50,
      retentionDays: 90,
    };
  }

  private getDefaultUsage(): TenantUsage {
    return {
      storage: 0,
      requests: 0,
      users: 1,
      watchers: 0,
      apiCalls: 0,
      customFields: 0,
      lastUpdated: new Date(),
    };
  }

  private getDefaultBranding(): TenantBranding {
    return {
      theme: "light",
    };
  }

  private async initializeTenantIsolation(): Promise<void> {
    this.logger.log(
      `Initializing tenant isolation with strategy: ${this.config.isolation.strategy}`
    );

    switch (this.config.isolation.strategy) {
      case "database":
        await this.initializeDatabaseIsolation();
        break;
      case "schema":
        await this.initializeSchemaIsolation();
        break;
      case "row":
        await this.initializeRowIsolation();
        break;
      case "application":
        await this.initializeApplicationIsolation();
        break;
    }
  }

  private async initializeDatabaseIsolation(): Promise<void> {
    // Create separate databases for each tenant
    this.logger.log("Database isolation initialized");
  }

  private async initializeSchemaIsolation(): Promise<void> {
    // Create separate schemas for each tenant
    this.logger.log("Schema isolation initialized");
  }

  private async initializeRowIsolation(): Promise<void> {
    // Implement row-level tenant isolation
    this.logger.log("Row isolation initialized");
  }

  private async initializeApplicationIsolation(): Promise<void> {
    // Implement application-level tenant isolation
    this.logger.log("Application isolation initialized");
  }

  private async initializeResourceMonitoring(): Promise<void> {
    this.logger.log("Resource monitoring initialized");
  }

  private startMonitoring(): void {
    this.monitoringInterval = interval(300000).subscribe(async () => {
      // Every 5 minutes
      await this.monitorTenantResources();
    });
  }

  // Tenant management methods

  async provisionTenant(tenantData: {
    name: string;
    slug: string;
    domain?: string;
    plan: Tenant["plan"];
    metadata?: Tenant["metadata"];
  }): Promise<TenantProvisioningResult> {
    try {
      this.logger.log(`Provisioning tenant: ${tenantData.name}`);

      // Validate tenant data
      if (this.tenants.has(tenantData.slug)) {
        return {
          success: false,
          error: "Tenant slug already exists",
        };
      }

      // Create tenant
      const tenant: Tenant = {
        id: crypto.randomUUID(),
        name: tenantData.name,
        slug: tenantData.slug,
        domain: tenantData.domain,
        status: "pending",
        plan: tenantData.plan,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: tenantData.metadata || {},
        configuration: this.getConfigurationForPlan(tenantData.plan),
        limits: this.getLimitsForPlan(tenantData.plan),
        usage: this.getDefaultUsage(),
        branding: this.getDefaultBranding(),
      };

      // Provision resources
      const resources = await this.provisionTenantResources(tenant);

      // Activate tenant
      tenant.status = "active";
      this.tenants.set(tenant.id, tenant);
      this.tenantSubject.next(tenant);

      this.logger.log(`Tenant provisioned successfully: ${tenant.id}`);

      return {
        success: true,
        tenant,
        resources,
      };
    } catch (error) {
      this.logger.error(`Failed to provision tenant: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  private getConfigurationForPlan(plan: Tenant["plan"]): TenantConfiguration {
    const baseConfig = this.getDefaultConfiguration();

    switch (plan) {
      case "free":
        return {
          ...baseConfig,
          features: {
            ...baseConfig.features,
            mlAnalytics: false,
            alerting: false,
          },
          settings: {
            ...baseConfig.settings,
            dataRetention: 30,
            samplingRate: 10,
          },
        };
      case "basic":
        return {
          ...baseConfig,
          features: {
            ...baseConfig.features,
            mlAnalytics: false,
          },
          settings: {
            ...baseConfig.settings,
            dataRetention: 60,
            samplingRate: 50,
          },
        };
      case "professional":
        return baseConfig;
      case "enterprise":
        return {
          ...baseConfig,
          features: {
            ...baseConfig.features,
            // All features enabled
          },
          settings: {
            ...baseConfig.settings,
            dataRetention: 365,
            samplingRate: 100,
          },
        };
      default:
        return baseConfig;
    }
  }

  private getLimitsForPlan(plan: Tenant["plan"]): TenantLimits {
    const baseLimits = this.getDefaultLimits();

    switch (plan) {
      case "free":
        return {
          ...baseLimits,
          storage: 100, // 100MB
          requests: 1000, // 1k per day
          users: 1,
          watchers: 2,
          apiCalls: 100,
          customFields: 5,
          retentionDays: 30,
        };
      case "basic":
        return {
          ...baseLimits,
          storage: 512, // 512MB
          requests: 10000, // 10k per day
          users: 5,
          watchers: 3,
          apiCalls: 1000,
          customFields: 20,
          retentionDays: 60,
        };
      case "professional":
        return baseLimits;
      case "enterprise":
        return {
          ...baseLimits,
          storage: 10240, // 10GB
          requests: 1000000, // 1M per day
          users: 100,
          watchers: 20,
          apiCalls: 100000,
          customFields: 200,
          retentionDays: 365,
        };
      default:
        return baseLimits;
    }
  }

  private async provisionTenantResources(tenant: Tenant): Promise<{
    database: string;
    schema?: string;
    storage: string;
  }> {
    const resources = {
      database: `${this.config.isolation.databasePrefix}${tenant.slug}`,
      storage: `storage_${tenant.slug}`,
    };

    if (this.config.isolation.strategy === "schema") {
      resources.schema = `${this.config.isolation.schemaPrefix}${tenant.slug}`;
    }

    // In a real implementation, this would create actual database resources
    this.logger.log(
      `Provisioned resources for tenant ${tenant.slug}:`,
      resources
    );

    return resources;
  }

  async updateTenant(
    tenantId: string,
    updates: Partial<Tenant>
  ): Promise<Tenant | null> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return null;

    const updatedTenant = {
      ...tenant,
      ...updates,
      updatedAt: new Date(),
    };

    this.tenants.set(tenantId, updatedTenant);
    this.tenantSubject.next(updatedTenant);

    this.logger.log(`Tenant updated: ${tenantId}`);
    return updatedTenant;
  }

  async suspendTenant(tenantId: string, reason?: string): Promise<boolean> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    tenant.status = "suspended";
    tenant.updatedAt = new Date();

    if (reason) {
      tenant.metadata.suspensionReason = reason;
    }

    this.tenants.set(tenantId, tenant);
    this.tenantSubject.next(tenant);

    this.logger.log(
      `Tenant suspended: ${tenantId}${reason ? ` - ${reason}` : ""}`
    );
    return true;
  }

  async activateTenant(tenantId: string): Promise<boolean> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    tenant.status = "active";
    tenant.updatedAt = new Date();
    delete tenant.metadata.suspensionReason;

    this.tenants.set(tenantId, tenant);
    this.tenantSubject.next(tenant);

    this.logger.log(`Tenant activated: ${tenantId}`);
    return true;
  }

  async deleteTenant(tenantId: string): Promise<boolean> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    // Mark as deleted (soft delete)
    tenant.status = "deleted";
    tenant.updatedAt = new Date();

    this.tenants.set(tenantId, tenant);
    this.tenantSubject.next(tenant);

    // Schedule hard deletion after retention period
    setTimeout(async () => {
      await this.hardDeleteTenant(tenantId);
    }, 30 * 24 * 60 * 60 * 1000); // 30 days

    this.logger.log(`Tenant marked for deletion: ${tenantId}`);
    return true;
  }

  private async hardDeleteTenant(tenantId: string): Promise<void> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant || tenant.status !== "deleted") return;

    // Delete tenant resources
    await this.deleteTenantResources(tenant);

    // Remove from memory
    this.tenants.delete(tenantId);
    this.tenantMetrics.delete(tenantId);
    this.quotaExceeded.delete(tenantId);

    this.logger.log(`Tenant permanently deleted: ${tenantId}`);
  }

  private async deleteTenantResources(tenant: Tenant): Promise<void> {
    // Delete database/schema resources
    this.logger.log(`Deleting resources for tenant: ${tenant.slug}`);
  }

  // Resource monitoring

  private async monitorTenantResources(): Promise<void> {
    for (const tenant of this.tenants.values()) {
      if (tenant.status !== "active") continue;

      await this.checkTenantQuotas(tenant);
      await this.updateTenantUsage(tenant);
    }
  }

  private async checkTenantQuotas(tenant: Tenant): Promise<void> {
    const { usage, limits } = tenant;

    // Check storage quota
    if (usage.storage > limits.storage) {
      await this.handleQuotaExceeded(
        tenant.id,
        "storage",
        usage.storage,
        limits.storage
      );
    }

    // Check requests quota
    if (usage.requests > limits.requests) {
      await this.handleQuotaExceeded(
        tenant.id,
        "requests",
        usage.requests,
        limits.requests
      );
    }

    // Check users quota
    if (usage.users > limits.users) {
      await this.handleQuotaExceeded(
        tenant.id,
        "users",
        usage.users,
        limits.users
      );
    }

    // Check watchers quota
    if (usage.watchers > limits.watchers) {
      await this.handleQuotaExceeded(
        tenant.id,
        "watchers",
        usage.watchers,
        limits.watchers
      );
    }

    // Check API calls quota
    if (usage.apiCalls > limits.apiCalls) {
      await this.handleQuotaExceeded(
        tenant.id,
        "apiCalls",
        usage.apiCalls,
        limits.apiCalls
      );
    }
  }

  private async handleQuotaExceeded(
    tenantId: string,
    resource: string,
    current: number,
    limit: number
  ): Promise<void> {
    const quotaEvent: TenantQuotaExceeded = {
      tenantId,
      resource,
      current,
      limit,
      timestamp: new Date(),
    };

    if (!this.quotaExceeded.has(tenantId)) {
      this.quotaExceeded.set(tenantId, []);
    }

    this.quotaExceeded.get(tenantId)!.push(quotaEvent);
    this.quotaSubject.next(quotaEvent);

    this.logger.warn(
      `Quota exceeded for tenant ${tenantId}: ${resource} (${current}/${limit})`
    );

    // Auto-suspend if multiple quotas exceeded
    const exceededQuotas = this.quotaExceeded.get(tenantId) || [];
    const recentExceeded = exceededQuotas.filter(
      (q) => Date.now() - q.timestamp.getTime() < 24 * 60 * 60 * 1000 // Last 24 hours
    );

    if (recentExceeded.length >= 3) {
      await this.suspendTenant(tenantId, "Multiple quota violations");
    }
  }

  private async updateTenantUsage(tenant: Tenant): Promise<void> {
    // In a real implementation, this would query actual usage data
    const usage: TenantUsage = {
      storage: Math.random() * tenant.limits.storage * 0.8, // Simulate usage
      requests: Math.floor(Math.random() * tenant.limits.requests * 0.1), // Today's usage
      users: Math.min(tenant.usage.users, tenant.limits.users),
      watchers: Math.min(tenant.usage.watchers, tenant.limits.watchers),
      apiCalls: Math.floor(Math.random() * tenant.limits.apiCalls * 0.1),
      customFields: Math.min(
        tenant.usage.customFields,
        tenant.limits.customFields
      ),
      lastUpdated: new Date(),
    };

    tenant.usage = usage;
    this.tenants.set(tenant.id, tenant);

    // Record metrics
    const metrics: TenantMetrics = {
      tenantId: tenant.id,
      timestamp: new Date(),
      requests: usage.requests,
      storage: usage.storage,
      users: usage.users,
      errors: 0, // Would be calculated from actual data
      performance: {
        averageResponseTime: Math.random() * 100 + 50,
        throughput: usage.requests / 24, // requests per hour
        errorRate: Math.random() * 0.05, // 0-5%
      },
    };

    if (!this.tenantMetrics.has(tenant.id)) {
      this.tenantMetrics.set(tenant.id, []);
    }

    this.tenantMetrics.get(tenant.id)!.push(metrics);
    this.metricsSubject.next(metrics);

    // Keep only recent metrics
    const recentMetrics = this.tenantMetrics.get(tenant.id)!.slice(-1000);
    this.tenantMetrics.set(tenant.id, recentMetrics);
  }

  // Tenant isolation methods

  async getTenantContext(tenantId: string): Promise<{
    tenant: Tenant;
    isolation: {
      database: string;
      schema?: string;
      prefix: string;
    };
  } | null> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant || tenant.status !== "active") return null;

    const isolation = {
      database: `${this.config.isolation.databasePrefix}${tenant.slug}`,
      prefix: `${tenant.slug}_`,
    };

    if (this.config.isolation.strategy === "schema") {
      isolation.schema = `${this.config.isolation.schemaPrefix}${tenant.slug}`;
    }

    return { tenant, isolation };
  }

  async validateTenantAccess(
    tenantId: string,
    userId: string
  ): Promise<boolean> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant || tenant.status !== "active") return false;

    // In a real implementation, this would check if the user belongs to the tenant
    return true;
  }

  // Branding and customization

  async updateTenantBranding(
    tenantId: string,
    branding: Partial<TenantBranding>
  ): Promise<Tenant | null> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return null;

    tenant.branding = { ...tenant.branding, ...branding };
    tenant.updatedAt = new Date();

    this.tenants.set(tenantId, tenant);
    this.tenantSubject.next(tenant);

    this.logger.log(`Branding updated for tenant: ${tenantId}`);
    return tenant;
  }

  async updateTenantConfiguration(
    tenantId: string,
    configuration: Partial<TenantConfiguration>
  ): Promise<Tenant | null> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return null;

    tenant.configuration = { ...tenant.configuration, ...configuration };
    tenant.updatedAt = new Date();

    this.tenants.set(tenantId, tenant);
    this.tenantSubject.next(tenant);

    this.logger.log(`Configuration updated for tenant: ${tenantId}`);
    return tenant;
  }

  // Public API methods

  getTenants(): Tenant[] {
    return Array.from(this.tenants.values());
  }

  getTenantById(tenantId: string): Tenant | undefined {
    return this.tenants.get(tenantId);
  }

  getTenantBySlug(slug: string): Tenant | undefined {
    return Array.from(this.tenants.values()).find((t) => t.slug === slug);
  }

  getTenantMetrics(tenantId: string): TenantMetrics[] {
    return this.tenantMetrics.get(tenantId) || [];
  }

  getQuotaExceeded(tenantId: string): TenantQuotaExceeded[] {
    return this.quotaExceeded.get(tenantId) || [];
  }

  getTenantUpdates(): Observable<Tenant> {
    return this.tenantSubject.asObservable();
  }

  getMetricsUpdates(): Observable<TenantMetrics> {
    return this.metricsSubject.asObservable();
  }

  getQuotaUpdates(): Observable<TenantQuotaExceeded> {
    return this.quotaSubject.asObservable();
  }

  async getTenantReport(tenantId: string): Promise<{
    tenant: Tenant;
    metrics: TenantMetrics[];
    quotaExceeded: TenantQuotaExceeded[];
    usage: {
      storage: number;
      requests: number;
      users: number;
      watchers: number;
    };
  } | null> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return null;

    return {
      tenant,
      metrics: this.getTenantMetrics(tenantId),
      quotaExceeded: this.getQuotaExceeded(tenantId),
      usage: tenant.usage,
    };
  }

  async shutdown(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval as any);
    }

    this.logger.log("Multi-tenant service shutdown");
  }
}

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { TelescopeConfig } from '../interfaces/telescope-config.interface';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConfigDefaults {
  enabled: boolean;
  storage: {
    driver: string;
    batch: {
      enabled: boolean;
      size: number;
      flushInterval: number;
    };
  };
  devtools: {
    enabled: boolean;
    bridge: {
      resilience: {
        circuitBreakerEnabled: boolean;
        fallbackEnabled: boolean;
        maxRetries: number;
        retryDelayMs: number;
        healthCheckIntervalMs: number;
      };
    };
  };
  features: {
    realTimeUpdates: boolean;
    dashboard: boolean;
    metrics: boolean;
  };
}

@Injectable()
export class TelescopeConfigValidator {
  private readonly logger = new Logger(TelescopeConfigValidator.name);
  
  private readonly defaults: ConfigDefaults = {
    enabled: true,
    storage: {
      driver: 'memory',
      batch: {
        enabled: true,
        size: 100,
        flushInterval: 5000
      }
    },
    devtools: {
      enabled: true,
      bridge: {
        resilience: {
          circuitBreakerEnabled: true,
          fallbackEnabled: true,
          maxRetries: 3,
          retryDelayMs: 1000,
          healthCheckIntervalMs: 30000
        }
      }
    },
    features: {
      realTimeUpdates: true,
      dashboard: true,
      metrics: true
    }
  };

  private readonly supportedDrivers = ['memory', 'file', 'database', 'redis'];
  private readonly requiredFields = ['enabled', 'storage', 'devtools'];

  validate(config: Partial<TelescopeConfig>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Check required fields
      this.validateRequiredFields(config, errors);
      
      // Validate storage configuration
      this.validateStorageConfig(config.storage, errors, warnings);
      
      // Validate DevTools configuration
      this.validateDevToolsConfig(config.devtools, errors, warnings);
      
      // Validate features configuration
      this.validateFeaturesConfig(config.features, errors, warnings);
      
      // Validate watchers configuration
      this.validateWatchersConfig(config.watchers, errors, warnings);
      
      // Performance and resource checks
      this.validatePerformanceConfig(config, errors, warnings);
      
      // Security checks
      this.validateSecurityConfig(config, errors, warnings);

      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };
    } catch (error) {
      this.logger.error('Configuration validation failed:', error);
      return {
        isValid: false,
        errors: [`Validation failed: ${error.message}`],
        warnings
      };
    }
  }

  applyDefaults(config: Partial<TelescopeConfig>): TelescopeConfig {
    const mergedConfig = this.deepMerge(this.defaults, config);
    
    this.logger.debug('Configuration after applying defaults:', JSON.stringify(mergedConfig, null, 2));
    
    return mergedConfig as TelescopeConfig;
  }

  validateAndApplyDefaults(config: Partial<TelescopeConfig>): TelescopeConfig {
    const validation = this.validate(config);
    
    if (!validation.isValid) {
      throw new BadRequestException(`Configuration validation failed: ${validation.errors.join(', ')}`);
    }
    
    if (validation.warnings.length > 0) {
      this.logger.warn('Configuration warnings:', validation.warnings);
    }
    
    return this.applyDefaults(config);
  }

  private validateRequiredFields(config: Partial<TelescopeConfig>, errors: string[]): void {
    for (const field of this.requiredFields) {
      if (!(field in config)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  private validateStorageConfig(storage: any, errors: string[], warnings: string[]): void {
    if (!storage) {
      errors.push('Storage configuration is required');
      return;
    }

    // Validate driver
    if (storage.driver && !this.supportedDrivers.includes(storage.driver)) {
      errors.push(`Unsupported storage driver: ${storage.driver}. Supported: ${this.supportedDrivers.join(', ')}`);
    }

    // Validate batch configuration
    if (storage.batch) {
      if (storage.batch.size !== undefined) {
        if (typeof storage.batch.size !== 'number' || storage.batch.size <= 0) {
          errors.push('Batch size must be a positive number');
        } else if (storage.batch.size > 1000) {
          warnings.push('Large batch size may impact performance');
        }
      }

      if (storage.batch.flushInterval !== undefined) {
        if (typeof storage.batch.flushInterval !== 'number' || storage.batch.flushInterval <= 0) {
          errors.push('Batch flush interval must be a positive number');
        } else if (storage.batch.flushInterval < 1000) {
          warnings.push('Short flush interval may impact performance');
        }
      }
    }

    // Driver-specific validations
    if (storage.driver === 'file') {
      if (storage.file && !storage.file.directory) {
        errors.push('File storage requires directory configuration');
      }
    }

    if (storage.driver === 'database') {
      if (storage.database && !storage.database.connection) {
        errors.push('Database storage requires connection configuration');
      }
    }

    if (storage.driver === 'redis') {
      if (storage.redis && !storage.redis.host) {
        errors.push('Redis storage requires host configuration');
      }
    }
  }

  private validateDevToolsConfig(devtools: any, errors: string[], warnings: string[]): void {
    if (!devtools) {
      errors.push('DevTools configuration is required');
      return;
    }

    // Validate bridge configuration
    if (devtools.bridge) {
      if (devtools.bridge.resilience) {
        const resilience = devtools.bridge.resilience;
        
        if (resilience.maxRetries !== undefined) {
          if (typeof resilience.maxRetries !== 'number' || resilience.maxRetries < 0) {
            errors.push('Max retries must be a non-negative number');
          } else if (resilience.maxRetries > 10) {
            warnings.push('High retry count may cause delays');
          }
        }

        if (resilience.retryDelayMs !== undefined) {
          if (typeof resilience.retryDelayMs !== 'number' || resilience.retryDelayMs < 0) {
            errors.push('Retry delay must be a non-negative number');
          }
        }

        if (resilience.healthCheckIntervalMs !== undefined) {
          if (typeof resilience.healthCheckIntervalMs !== 'number' || resilience.healthCheckIntervalMs < 1000) {
            errors.push('Health check interval must be at least 1000ms');
          }
        }
      }
    }
  }

  private validateFeaturesConfig(features: any, errors: string[], warnings: string[]): void {
    if (!features) {
      return; // Features are optional
    }

    // Validate boolean fields
    const booleanFields = ['realTimeUpdates', 'dashboard', 'metrics'];
    for (const field of booleanFields) {
      if (features[field] !== undefined && typeof features[field] !== 'boolean') {
        errors.push(`Feature ${field} must be a boolean`);
      }
    }

    // Check for conflicting configurations
    if (features.dashboard === false && features.realTimeUpdates === true) {
      warnings.push('Real-time updates enabled but dashboard disabled');
    }
  }

  private validateWatchersConfig(watchers: any, errors: string[], warnings: string[]): void {
    if (!watchers) {
      return; // Watchers are optional
    }

    const validWatchers = ['request', 'query', 'exception', 'job', 'cache'];
    
    for (const [watcherName, watcherConfig] of Object.entries(watchers)) {
      if (!validWatchers.includes(watcherName)) {
        warnings.push(`Unknown watcher: ${watcherName}`);
      }

      if (typeof watcherConfig === 'object' && watcherConfig !== null) {
        // Validate watcher-specific configuration
        this.validateWatcherConfig(watcherName, watcherConfig, errors, warnings);
      }
    }
  }

  private validateWatcherConfig(name: string, config: any, errors: string[], warnings: string[]): void {
    if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
      errors.push(`Watcher ${name} enabled must be a boolean`);
    }

    if (config.sampling !== undefined) {
      if (typeof config.sampling !== 'number' || config.sampling < 0 || config.sampling > 100) {
        errors.push(`Watcher ${name} sampling must be a number between 0 and 100`);
      }
    }

    // Watcher-specific validations
    if (name === 'request') {
      if (config.excludePaths && !Array.isArray(config.excludePaths)) {
        errors.push('Request watcher excludePaths must be an array');
      }
    }

    if (name === 'query') {
      if (config.slowQueryThreshold !== undefined) {
        if (typeof config.slowQueryThreshold !== 'number' || config.slowQueryThreshold <= 0) {
          errors.push('Query watcher slowQueryThreshold must be a positive number');
        }
      }
    }
  }

  private validatePerformanceConfig(config: any, errors: string[], warnings: string[]): void {
    // Check for performance-impacting configurations
    if (config.storage?.batch?.size > 500) {
      warnings.push('Large batch size may cause memory issues');
    }

    if (config.storage?.batch?.flushInterval < 1000) {
      warnings.push('Short flush interval may cause high CPU usage');
    }

    if (config.devtools?.bridge?.resilience?.maxRetries > 5) {
      warnings.push('High retry count may cause long delays');
    }

    // Check for conflicting performance settings
    if (config.features?.realTimeUpdates === true && config.storage?.batch?.flushInterval > 10000) {
      warnings.push('Real-time updates with long flush interval may cause delays');
    }
  }

  private validateSecurityConfig(config: any, errors: string[], warnings: string[]): void {
    // Security-related validations
    if (config.storage?.driver === 'file' && config.storage?.file?.directory?.startsWith('/')) {
      warnings.push('Using absolute path for file storage may have security implications');
    }

    if (config.features?.dashboard === true && !config.auth) {
      warnings.push('Dashboard enabled without authentication configuration');
    }

    // Check for sensitive data in configuration
    if (this.containsSensitiveData(config)) {
      errors.push('Configuration contains sensitive data that should be in environment variables');
    }
  }

  private containsSensitiveData(obj: any): boolean {
    const sensitiveKeys = ['password', 'secret', 'key', 'token', 'apikey'];
    const json = JSON.stringify(obj).toLowerCase();
    
    return sensitiveKeys.some(key => json.includes(key));
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          result[key] = this.deepMerge(result[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }
    
    return result;
  }

  getDefaults(): ConfigDefaults {
    return { ...this.defaults };
  }

  getSupportedDrivers(): string[] {
    return [...this.supportedDrivers];
  }
}
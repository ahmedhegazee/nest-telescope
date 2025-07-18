export interface TelescopeConfig {
  enabled: boolean;
  environment: string;
  
  // DevTools Integration
  devtools: {
    enabled: boolean;
    port: number;
    snapshot: boolean;
    features: {
      dependencyGraph: boolean;
      interactivePlayground: boolean;
      performanceMetrics: boolean;
    };
  };
  
  // Storage Configuration
  storage: {
    driver: 'memory' | 'file' | 'database' | 'redis';
    connection?: string;
    retention: {
      hours: number;
      maxEntries: number;
    };
    batch: {
      enabled: boolean;
      size: number;
      flushInterval: number;
    };
  };
  
  // Dashboard Configuration
  dashboard: {
    enabled: boolean;
    path: string;
    strategy: 'devtools' | 'custom' | 'hybrid';
    authorization?: (req: any) => boolean;
  };
  
  // Feature Flags
  features: {
    realTimeUpdates: boolean;
    analytics: boolean;
    customWatchers: boolean;
  };
}

// Default configuration
export const defaultTelescopeConfig: TelescopeConfig = {
  enabled: process.env.NODE_ENV !== 'production',
  environment: process.env.NODE_ENV || 'development',
  
  devtools: {
    enabled: true,
    port: 8001,
    snapshot: true,
    features: {
      dependencyGraph: true,
      interactivePlayground: true,
      performanceMetrics: true
    }
  },
  
  storage: {
    driver: 'memory',
    retention: {
      hours: 24,
      maxEntries: 10000
    },
    batch: {
      enabled: true,
      size: 50,
      flushInterval: 5000
    }
  },
  
  dashboard: {
    enabled: true,
    path: '/telescope',
    strategy: 'hybrid',
    authorization: (req) => req.ip === '127.0.0.1' || process.env.NODE_ENV !== 'production'
  },
  
  features: {
    realTimeUpdates: true,
    analytics: false,
    customWatchers: true
  }
};
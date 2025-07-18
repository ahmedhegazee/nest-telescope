export interface WatcherInterface {
  readonly name: string;
  readonly isEnabled: boolean;
  enable(): void;
  disable(): void;
  cleanup(): Promise<void>;
  healthCheck?(): Promise<boolean>;
}

export interface WatcherMetadata {
  name: string;
  enabled: boolean;
  priority: number;
  tags: string[];
  dependencies: string[];
  lastActivity?: Date;
  entriesProcessed: number;
}

export interface WatcherConfig {
  enabled: boolean;
  priority?: number;
  tags?: string[];
  dependencies?: string[];
}

export interface WatcherRegistryStatistics {
  total: number;
  enabled: number;
  disabled: number;
  totalEntriesProcessed: number;
  watchers: WatcherMetadata[];
}

export interface WatcherHealthStatus {
  healthy: boolean;
  watchers: Record<string, boolean>;
  timestamp: Date;
}

export abstract class BaseWatcher implements WatcherInterface {
  abstract readonly name: string;
  protected enabled = false;

  get isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    this.enabled = true;
    this.onEnable();
  }

  disable(): void {
    this.enabled = false;
    this.onDisable();
  }

  abstract cleanup(): Promise<void>;

  protected abstract onEnable(): void;
  protected abstract onDisable(): void;

  async healthCheck(): Promise<boolean> {
    return this.enabled;
  }
}
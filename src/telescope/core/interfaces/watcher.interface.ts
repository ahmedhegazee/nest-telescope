import { INestApplication } from '@nestjs/common';
import { TelescopeEntry } from './telescope-entry.interface';

export interface Watcher {
  readonly name: string;
  readonly type: string;
  readonly priority?: 'low' | 'medium' | 'high' | 'critical';
  
  register(app: INestApplication): Promise<void> | void;
  shouldRecord(context: any): boolean;
  record(entry: TelescopeEntry): Promise<void>;
  cleanup?(): void;
}

export interface WatcherInfo {
  name: string;
  type: string;
  priority: string;
  instance: Watcher;
  dependencies?: string[];
  enabled: boolean;
}

export interface WatcherOptions {
  enabled: boolean;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  dependencies?: string[];
  config?: Record<string, any>;
}

export interface WatcherStatus {
  name: string;
  type: string;
  enabled: boolean;
  registered: boolean;
  lastActivity?: Date;
  errorCount: number;
  status: 'active' | 'inactive' | 'error' | 'initializing';
}
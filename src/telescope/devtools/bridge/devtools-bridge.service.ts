import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { TelescopeService } from '../../core/services/telescope.service';
import { TelescopeConfig } from '../../core/interfaces/telescope-config.interface';
import { TelescopeEntry } from '../../core/interfaces/telescope-entry.interface';
import { v4 as uuid } from 'uuid';

@Injectable()
export class DevToolsBridgeService implements OnModuleInit {
  private readonly logger = new Logger(DevToolsBridgeService.name);
  
  constructor(
    private readonly telescopeService: TelescopeService,
    @Inject('TELESCOPE_CONFIG') private readonly config: TelescopeConfig
  ) {}

  async onModuleInit() {
    if (!this.config.devtools.enabled) {
      this.logger.log('DevTools integration disabled');
      return;
    }

    this.logger.log('DevTools bridge service initialized');
    
    // Start periodic DevTools data collection
    this.startDataCollection();
  }

  async processDevToolsEntry(entry: any, type: string): Promise<void> {
    try {
      const telescopeEntry = this.transformToTelescopeFormat(entry, type);
      await this.telescopeService.record(telescopeEntry);
      
      this.logger.debug(`Processed DevTools entry: ${type}`);
    } catch (error) {
      this.logger.error(`Failed to process DevTools entry: ${error.message}`);
    }
  }

  private transformToTelescopeFormat(entry: any, type: string): TelescopeEntry {
    return {
      id: `devtools_${uuid()}`,
      type: `devtools-${type}`,
      familyHash: this.generateFamilyHash(entry),
      content: this.sanitizeContent(entry),
      tags: ['devtools', type],
      timestamp: new Date(),
      sequence: Date.now()
    };
  }

  private generateFamilyHash(entry: any): string {
    // Simple hash generation for family grouping
    const str = JSON.stringify(entry);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  private sanitizeContent(content: any): Record<string, any> {
    // Remove potentially sensitive or circular reference data
    try {
      return JSON.parse(JSON.stringify(content));
    } catch (error) {
      return { error: 'Failed to serialize content', original: String(content) };
    }
  }

  private startDataCollection(): void {
    // Collect DevTools data periodically
    setInterval(async () => {
      try {
        await this.collectDevToolsData();
      } catch (error) {
        this.logger.error(`DevTools data collection failed: ${error.message}`);
      }
    }, 30000); // Every 30 seconds
  }

  private async collectDevToolsData(): Promise<void> {
    // For now, create mock DevTools entries
    // In real implementation, this would access DevTools APIs
    
    const mockGraph = {
      modules: ['AppModule', 'TelescopeModule', 'DevtoolsModule'],
      dependencies: ['@nestjs/common', '@nestjs/core', '@nestjs/devtools-integration'],
      timestamp: new Date()
    };

    const mockPerformance = {
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      timestamp: new Date()
    };

    await this.processDevToolsEntry(mockGraph, 'dependency-graph');
    await this.processDevToolsEntry(mockPerformance, 'performance-metrics');
  }
}
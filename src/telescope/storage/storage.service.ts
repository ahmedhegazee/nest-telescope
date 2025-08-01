import { Injectable, Inject } from "@nestjs/common";
import { StorageDriver, StorageStats } from "./interfaces/storage.interface";
import { TelescopeConfig } from "../core/interfaces/telescope-config.interface";
import {
  TelescopeEntry,
  TelescopeEntryFilter,
  TelescopeEntryResult,
} from "../core/interfaces/telescope-entry.interface";
import { MemoryStorageDriver } from "./drivers/memory-storage.driver";
import { FileStorageDriver } from "./drivers/file-storage.driver";
import { DatabaseStorageDriver } from "./drivers/database-storage.driver";
import { RedisStorageDriver } from "./drivers/redis-storage.driver";

@Injectable()
export class StorageService implements StorageDriver {
  private driver: StorageDriver;

  constructor(
    @Inject("TELESCOPE_CONFIG") private readonly config: TelescopeConfig
  ) {
    this.driver = this.createDriver();
  }

  private createDriver(): StorageDriver {
    switch (this.config.storage.driver) {
      case "memory":
        return new MemoryStorageDriver();
      case "file":
        return new FileStorageDriver(this.config);
      case "database":
        throw new Error(
          "Database storage driver requires TypeORM setup. Use memory, file, or redis instead."
        );
      case "redis":
        return new RedisStorageDriver(this.config);
      default:
        throw new Error(
          `Unknown storage driver: ${this.config.storage.driver}`
        );
    }
  }

  // Delegate all methods to the driver
  async store(entry: TelescopeEntry): Promise<void> {
    return this.driver.store(entry);
  }

  async storeBatch(entries: TelescopeEntry[]): Promise<void> {
    return this.driver.storeBatch(entries);
  }

  async find(filter?: TelescopeEntryFilter): Promise<TelescopeEntryResult> {
    return this.driver.find(filter);
  }

  async findById(id: string): Promise<TelescopeEntry | null> {
    return this.driver.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    return this.driver.delete(id);
  }

  async clear(): Promise<void> {
    return this.driver.clear();
  }

  async prune(olderThan: Date): Promise<number> {
    return this.driver.prune(olderThan);
  }

  async getStats(): Promise<StorageStats> {
    return this.driver.getStats();
  }
}

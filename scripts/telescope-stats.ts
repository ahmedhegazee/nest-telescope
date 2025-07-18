import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TelescopeService } from '../src/telescope/core/services/telescope.service';

async function showStats() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const telescopeService = app.get(TelescopeService);

  console.log('📊 Telescope Statistics');
  console.log('=======================');

  try {
    const stats = await telescopeService.getStats();
    
    console.log(`Total Entries: ${stats.totalEntries}`);
    console.log(`Storage Driver: ${stats.config.storageDriver}`);
    console.log(`Enabled: ${stats.config.enabled}`);
    console.log(`Environment: ${stats.config.environment}`);
    console.log(`Retention Hours: ${stats.config.retentionHours}`);
    console.log(`Uptime: ${stats.uptime.toFixed(2)} seconds`);
    console.log(`Memory Usage: ${(stats.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    
    if (stats.entriesByType && Object.keys(stats.entriesByType).length > 0) {
      console.log('\nEntries by Type:');
      Object.entries(stats.entriesByType).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
    }
    
    if (stats.oldestEntry && stats.newestEntry) {
      console.log(`\nOldest Entry: ${stats.oldestEntry}`);
      console.log(`Newest Entry: ${stats.newestEntry}`);
    }
    
  } catch (error) {
    console.error('Error retrieving stats:', error.message);
  }

  await app.close();
}

showStats().catch(console.error);
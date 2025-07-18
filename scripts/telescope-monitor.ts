import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TelescopeService } from '../src/telescope/core/services/telescope.service';

async function monitor() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const telescopeService = app.get(TelescopeService);

  console.log('📊 Telescope Monitor - Press Ctrl+C to stop');
  console.log('===========================================');

  let lastEntryCount = 0;
  let startTime = Date.now();

  const interval = setInterval(async () => {
    try {
      const stats = await telescopeService.getStats();
      const currentTime = Date.now();
      const elapsedMinutes = (currentTime - startTime) / 60000;
      
      const entriesAdded = stats.totalEntries - lastEntryCount;
      const entriesPerMinute = elapsedMinutes > 0 ? (entriesAdded / elapsedMinutes).toFixed(2) : '0.00';
      
      console.clear();
      console.log('📊 Telescope Monitor - Press Ctrl+C to stop');
      console.log('===========================================');
      console.log(`Time: ${new Date().toLocaleTimeString()}`);
      console.log(`Total Entries: ${stats.totalEntries}`);
      console.log(`Entries Added: ${entriesAdded}`);
      console.log(`Entries/Min: ${entriesPerMinute}`);
      console.log(`Memory Usage: ${(stats.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Uptime: ${stats.uptime.toFixed(2)} seconds`);
      
      if (stats.entriesByType && Object.keys(stats.entriesByType).length > 0) {
        console.log('\nEntries by Type:');
        Object.entries(stats.entriesByType).forEach(([type, count]) => {
          console.log(`  ${type}: ${count}`);
        });
      }
      
      lastEntryCount = stats.totalEntries;
      
    } catch (error) {
      console.error('Monitor error:', error.message);
    }
  }, 2000); // Update every 2 seconds

  // Handle Ctrl+C
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Monitoring stopped');
    clearInterval(interval);
    await app.close();
    process.exit(0);
  });
}

monitor().catch(console.error);
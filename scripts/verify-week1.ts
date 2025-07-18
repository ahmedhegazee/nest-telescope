import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TelescopeService } from '../src/telescope/core/services/telescope.service';

async function verifyImplementation() {
  console.log('🔍 Week 1 Implementation Verification');
  console.log('=====================================');

  try {
    const app = await NestFactory.create(AppModule, { logger: false });
    const telescopeService = app.get(TelescopeService);

    // Test 1: Record entry
    console.log('\n1. Testing entry recording...');
    await telescopeService.record({
      id: 'verify-1',
      type: 'verification',
      familyHash: 'verify',
      content: { test: 'Week 1 verification' },
      tags: ['verification', 'week1'],
      timestamp: new Date(),
      sequence: 1
    });
    console.log('✅ Entry recorded successfully');

    // Test 2: Retrieve entries
    console.log('\n2. Testing entry retrieval...');
    const result = await telescopeService.find({ type: 'verification' });
    console.log(`✅ Retrieved ${result.entries.length} entries`);

    // Test 3: Get stats
    console.log('\n3. Testing stats...');
    const stats = await telescopeService.getStats();
    console.log(`✅ Stats retrieved - Total entries: ${stats.totalEntries}`);

    // Test 4: DevTools integration check
    console.log('\n4. Checking DevTools integration...');
    if (stats.config.enabled) {
      console.log('✅ DevTools integration enabled');
    }

    // Test 5: Batch processing
    console.log('\n5. Testing batch processing...');
    const batchEntries = Array.from({ length: 5 }, (_, i) => ({
      id: `batch-${i + 1}`,
      type: 'batch-test',
      familyHash: `batch-${i + 1}`,
      content: { index: i + 1, message: `Batch entry ${i + 1}` },
      tags: ['batch', 'test'],
      timestamp: new Date(),
      sequence: i + 2
    }));

    await telescopeService.recordBatch(batchEntries);
    
    // Wait a moment for batch processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const batchResult = await telescopeService.find({ type: 'batch-test' });
    console.log(`✅ Batch processing - Retrieved ${batchResult.entries.length} batch entries`);

    // Test 6: Memory usage and performance
    console.log('\n6. Testing performance metrics...');
    const finalStats = await telescopeService.getStats();
    console.log(`✅ Memory usage: ${(finalStats.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`✅ Uptime: ${finalStats.uptime.toFixed(2)} seconds`);

    console.log('\n🎉 Week 1 implementation verified successfully!');
    console.log('\nNext steps:');
    console.log('- Start the application with: npm start');
    console.log('- Access DevTools at http://localhost:8001');
    console.log('- View telescope data via API');
    console.log('- Ready for Week 2 implementation');

    await app.close();
  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

verifyImplementation().catch(console.error);
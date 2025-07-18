import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { TelescopeModule } from '../src/telescope/telescope.module';
import { TelescopeService } from '../src/telescope/core/services/telescope.service';

describe('Telescope Integration (e2e)', () => {
  let app: INestApplication;
  let telescopeService: TelescopeService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TelescopeModule.forRoot({ 
          enabled: true,
          devtools: { 
            enabled: false, // Disable DevTools for testing
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
            retention: { hours: 24, maxEntries: 10000 },
            batch: { enabled: false, size: 50, flushInterval: 5000 } // Disable batch for testing
          }
        })
      ]
    }).compile();

    app = moduleFixture.createNestApplication();
    telescopeService = moduleFixture.get<TelescopeService>(TelescopeService);
    
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should record and retrieve telescope entries', async () => {
    // Record test entry
    await telescopeService.record({
      id: 'test-1',
      type: 'test',
      familyHash: 'test-family',
      content: { message: 'Hello Telescope' },
      tags: ['test'],
      timestamp: new Date(),
      sequence: 1
    });

    // Retrieve entries
    const result = await telescopeService.find({ type: 'test' });
    
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].content.message).toBe('Hello Telescope');
  });

  it('should provide telescope stats', async () => {
    const stats = await telescopeService.getStats();
    
    expect(stats).toHaveProperty('totalEntries');
    expect(stats).toHaveProperty('config');
    expect(stats.config.enabled).toBe(true);
  });

  it('should handle batch operations', async () => {
    const batchEntries = [
      {
        id: 'batch-1',
        type: 'batch-test',
        familyHash: 'batch-1',
        content: { index: 1 },
        tags: ['batch'],
        timestamp: new Date(),
        sequence: 1
      },
      {
        id: 'batch-2',
        type: 'batch-test',
        familyHash: 'batch-2',
        content: { index: 2 },
        tags: ['batch'],
        timestamp: new Date(),
        sequence: 2
      }
    ];

    await telescopeService.recordBatch(batchEntries);

    const result = await telescopeService.find({ type: 'batch-test' });
    expect(result.entries).toHaveLength(2);
  });

  it('should filter entries by type', async () => {
    // Record different types
    await telescopeService.record({
      id: 'type-1',
      type: 'type-a',
      familyHash: 'type-a',
      content: { test: 'A' },
      tags: ['type-a'],
      timestamp: new Date(),
      sequence: 1
    });

    await telescopeService.record({
      id: 'type-2',
      type: 'type-b',
      familyHash: 'type-b',
      content: { test: 'B' },
      tags: ['type-b'],
      timestamp: new Date(),
      sequence: 2
    });

    const resultA = await telescopeService.find({ type: 'type-a' });
    const resultB = await telescopeService.find({ type: 'type-b' });

    expect(resultA.entries).toHaveLength(1);
    expect(resultB.entries).toHaveLength(1);
    expect(resultA.entries[0].content.test).toBe('A');
    expect(resultB.entries[0].content.test).toBe('B');
  });

  it('should handle pagination', async () => {
    // Record multiple entries
    const entries = Array.from({ length: 10 }, (_, i) => ({
      id: `pagination-${i + 1}`,
      type: 'pagination-test',
      familyHash: `pagination-${i + 1}`,
      content: { index: i + 1 },
      tags: ['pagination'],
      timestamp: new Date(),
      sequence: i + 1
    }));

    await telescopeService.recordBatch(entries);

    const result = await telescopeService.find({ 
      type: 'pagination-test',
      limit: 5,
      offset: 0
    });

    expect(result.entries).toHaveLength(5);
    expect(result.total).toBe(10);
    expect(result.hasMore).toBe(true);
  });
});
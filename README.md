# NestJS Telescope - Week 1 Implementation

A comprehensive application monitoring and debugging platform for NestJS applications, inspired by Laravel Telescope.

## Features

- **DevTools Integration**: Seamless integration with NestJS DevTools
- **Memory Storage**: In-memory storage for development and testing
- **Entry Management**: Efficient batch processing and entry lifecycle management
- **Real-time Monitoring**: Live performance and dependency tracking
- **Extensible Architecture**: Plugin-based system for custom watchers

## Installation

```bash
npm install
```

## Getting Started

### Development Mode

```bash
npm run start:dev
```

### Production Mode

```bash
npm run build
npm start
```

## Scripts

- `npm run start:dev` - Start in development mode
- `npm run build` - Build the application
- `npm run test` - Run unit tests
- `npm run test:e2e` - Run end-to-end tests
- `npm run verify-week1` - Verify Week 1 implementation
- `npm run telescope:stats` - Show telescope statistics
- `npm run telescope:monitor` - Real-time monitoring

## Configuration

Configure Telescope in your `AppModule`:

```typescript
import { TelescopeModule } from './telescope/telescope.module';

@Module({
  imports: [
    TelescopeModule.forRoot({
      enabled: true,
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
        retention: { hours: 24, maxEntries: 5000 },
        batch: { enabled: true, size: 20, flushInterval: 3000 }
      }
    })
  ]
})
export class AppModule {}
```

## DevTools Access

- **DevTools UI**: http://localhost:8001
- **Application**: http://localhost:3000

## Architecture

### Core Components

- **TelescopeService**: Main service for recording and retrieving entries
- **EntryManagerService**: Handles entry lifecycle and batch processing
- **StorageService**: Storage abstraction layer
- **DevToolsBridgeService**: Bridge between DevTools and Telescope storage

### Storage Drivers

- **MemoryStorageDriver**: In-memory storage (default)
- **FileStorageDriver**: File-based storage (Week 2)
- **DatabaseStorageDriver**: Database storage (Week 2)

## Testing

Run the verification script to ensure everything is working:

```bash
npm run verify-week1
```

Expected output:
```
🔍 Week 1 Implementation Verification
=====================================

1. Testing entry recording...
✅ Entry recorded successfully

2. Testing entry retrieval...
✅ Retrieved 1 entries

3. Testing stats...
✅ Stats retrieved - Total entries: 1

4. Checking DevTools integration...
✅ DevTools integration enabled

5. Testing batch processing...
✅ Batch processing - Retrieved 5 batch entries

6. Testing performance metrics...
✅ Memory usage: 25.32 MB
✅ Uptime: 0.05 seconds

🎉 Week 1 implementation verified successfully!
```

## Monitoring

Real-time monitoring:

```bash
npm run telescope:monitor
```

View statistics:

```bash
npm run telescope:stats
```

## Next Steps

Week 1 provides the foundation for NestJS Telescope. Upcoming weeks will add:

- **Week 2-3**: Multi-backend storage, stream processing, circuit breakers
- **Week 4-6**: Core watchers (Request, Query, Exception, Job, Cache)
- **Week 7-9**: Real-time dashboard, analytics engine, alerting system
- **Week 10-12**: Security, deployment, production monitoring

## License

ISC License
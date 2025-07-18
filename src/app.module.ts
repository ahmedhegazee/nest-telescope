import { Module } from '@nestjs/common';
import { TelescopeModule } from './telescope/telescope.module';

@Module({
  imports: [
    TelescopeModule.forRoot({
      enabled: true,
      devtools: {
        enabled: true,
        port: 8001,
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
      },
      dashboard: {
        enabled: true,
        path: '/telescope',
        strategy: 'hybrid'
      }
    })
  ]
})
export class AppModule {}
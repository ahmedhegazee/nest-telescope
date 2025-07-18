import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import 'reflect-metadata';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS for DevTools
  app.enableCors({
    origin: true,
    credentials: true
  });
  
  console.log('🔭 NestJS Telescope initialized');
  console.log('📊 DevTools available at: http://localhost:8001');
  console.log('🚀 Application starting on: http://localhost:3000');
  
  await app.listen(3000);
}

bootstrap().catch(console.error);
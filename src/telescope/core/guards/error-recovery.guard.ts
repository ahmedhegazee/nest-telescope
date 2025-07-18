import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Reflector } from '@nestjs/core';

export interface ErrorRecoveryConfig {
  maxRetries: number;
  retryDelay: number;
  fallbackEnabled: boolean;
  circuitBreakerEnabled: boolean;
  logErrors: boolean;
}

@Injectable()
export class ErrorRecoveryGuard implements CanActivate {
  private readonly logger = new Logger(ErrorRecoveryGuard.name);
  private readonly defaultConfig: ErrorRecoveryConfig = {
    maxRetries: 3,
    retryDelay: 1000,
    fallbackEnabled: true,
    circuitBreakerEnabled: true,
    logErrors: true
  };

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    // This guard is used to setup error recovery context
    // The actual error recovery is handled by the resilient bridge service
    const config = this.reflector.get<ErrorRecoveryConfig>('errorRecovery', context.getHandler()) || this.defaultConfig;
    
    // Add error recovery config to request context
    const request = context.switchToHttp().getRequest();
    request.errorRecoveryConfig = config;
    
    return true;
  }
}

// Decorator to configure error recovery
export const ErrorRecovery = (config: Partial<ErrorRecoveryConfig>) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('errorRecovery', config, descriptor.value);
    return descriptor;
  };
};
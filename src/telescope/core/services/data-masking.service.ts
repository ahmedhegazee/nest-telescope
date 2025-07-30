import { Injectable, Logger } from '@nestjs/common';

export interface DataMaskingConfig {
  enabled: boolean;
  preserveLength: boolean;
  maskingChar: string;
  customPatterns: RegExp[];
  sensitiveKeys: string[];
}

@Injectable()
export class DataMaskingService {
  private readonly logger = new Logger(DataMaskingService.name);
  
  private readonly defaultPatterns: RegExp[] = [
    // Credit card numbers (various formats)
    /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    // Social Security Numbers
    /\b\d{3}-\d{2}-\d{4}\b/g,
    /\b\d{9}\b/g,
    // Email addresses
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    // JWT tokens
    /Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*/g,
    // Phone numbers (US format)
    /\b\d{3}-?\d{3}-?\d{4}\b/g,
    // IP addresses
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    // URLs with sensitive parameters
    /https?:\/\/[^\s]*(?:token|key|secret|password)=[^\s&]*/g,
    // API keys (common patterns)
    /['\"]?(?:api[_-]?key|access[_-]?token|secret[_-]?key)['\"]?\s*[:=]\s*['\"]?[A-Za-z0-9\-_]{8,}['\"]?/gi,
    // Bank account numbers
    /\b\d{8,17}\b/g,
    // Passport numbers
    /\b[A-Z]{1,2}\d{6,9}\b/g
  ];

  private readonly sensitiveKeyPatterns: RegExp[] = [
    /password/i,
    /passwd/i,
    /secret/i,
    /token/i,
    /key/i,
    /auth/i,
    /credential/i,
    /pin/i,
    /ssn/i,
    /social/i,
    /card/i,
    /account/i,
    /bank/i
  ];

  constructor() {}

  /**
   * Masks sensitive data in any object, string, or primitive value
   */
  maskSensitiveData(data: any, config: Partial<DataMaskingConfig> = {}): any {
    const finalConfig: DataMaskingConfig = {
      enabled: true,
      preserveLength: true,
      maskingChar: '*',
      customPatterns: [],
      sensitiveKeys: [],
      ...config
    };

    if (!finalConfig.enabled) {
      return data;
    }

    try {
      return this.maskData(data, finalConfig);
    } catch (error) {
      this.logger.error('Error masking sensitive data:', error);
      return data; // Return original data on error to prevent service disruption
    }
  }

  /**
   * Detects if data contains sensitive information
   */
  detectSensitiveData(data: any, config: Partial<DataMaskingConfig> = {}): boolean {
    const finalConfig: DataMaskingConfig = {
      enabled: true,
      preserveLength: true,
      maskingChar: '*',
      customPatterns: [],
      sensitiveKeys: [],
      ...config
    };

    if (!finalConfig.enabled || !data) {
      return false;
    }

    try {
      const dataStr = this.convertToString(data);
      
      // Check for regex patterns
      const allPatterns = [...this.defaultPatterns, ...finalConfig.customPatterns];
      for (const pattern of allPatterns) {
        if (pattern.test(dataStr)) {
          return true;
        }
      }

      // Check for sensitive keys in objects
      if (typeof data === 'object' && data !== null) {
        return this.hasSensitiveKeys(data, finalConfig);
      }

      return false;
    } catch (error) {
      this.logger.error('Error detecting sensitive data:', error);
      return false;
    }
  }

  private maskData(data: any, config: DataMaskingConfig): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      return this.maskString(data, config);
    }

    if (typeof data === 'number' || typeof data === 'boolean') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.maskData(item, config));
    }

    if (typeof data === 'object') {
      return this.maskObject(data, config);
    }

    return data;
  }

  private maskString(str: string, config: DataMaskingConfig): string {
    let maskedStr = str;

    // Apply all regex patterns
    const allPatterns = [...this.defaultPatterns, ...config.customPatterns];
    for (const pattern of allPatterns) {
      maskedStr = maskedStr.replace(pattern, (match) => {
        return config.preserveLength 
          ? config.maskingChar.repeat(match.length)
          : '***MASKED***';
      });
    }

    return maskedStr;
  }

  private maskObject(obj: any, config: DataMaskingConfig): any {
    const maskedObj: any = {};

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      
      // Check if the key itself is sensitive
      const isSensitiveKey = this.sensitiveKeyPatterns.some(pattern => pattern.test(lowerKey)) ||
                           config.sensitiveKeys.some(sensitiveKey => lowerKey.includes(sensitiveKey.toLowerCase()));

      if (isSensitiveKey) {
        // Mask the entire value for sensitive keys
        maskedObj[key] = this.maskSensitiveValue(value, config);
      } else {
        // Recursively mask the value
        maskedObj[key] = this.maskData(value, config);
      }
    }

    return maskedObj;
  }

  private maskSensitiveValue(value: any, config: DataMaskingConfig): any {
    if (typeof value === 'string') {
      return config.preserveLength 
        ? config.maskingChar.repeat(value.length)
        : '***MASKED***';
    }
    
    if (typeof value === 'number') {
      return config.preserveLength 
        ? config.maskingChar.repeat(value.toString().length)
        : '***MASKED***';
    }

    return '***MASKED***';
  }

  private hasSensitiveKeys(obj: any, config: DataMaskingConfig): boolean {
    for (const key of Object.keys(obj)) {
      const lowerKey = key.toLowerCase();
      
      // Check against pattern-based sensitive keys
      if (this.sensitiveKeyPatterns.some(pattern => pattern.test(lowerKey))) {
        return true;
      }

      // Check against config sensitive keys
      if (config.sensitiveKeys.some(sensitiveKey => lowerKey.includes(sensitiveKey.toLowerCase()))) {
        return true;
      }

      // Recursively check nested objects
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        if (this.hasSensitiveKeys(obj[key], config)) {
          return true;
        }
      }
    }

    return false;
  }

  private convertToString(data: any): string {
    try {
      if (typeof data === 'string') {
        return data;
      }
      return JSON.stringify(data);
    } catch (error) {
      return String(data);
    }
  }

  /**
   * Creates a safe summary of masked data for logging
   */
  createSafeSummary(data: any, config: Partial<DataMaskingConfig> = {}): string {
    const finalConfig: DataMaskingConfig = {
      enabled: true,
      preserveLength: false,
      maskingChar: '*',
      customPatterns: [],
      sensitiveKeys: [],
      ...config
    };

    try {
      const maskedData = this.maskSensitiveData(data, finalConfig);
      const summary = JSON.stringify(maskedData);
      
      // Truncate if too long
      if (summary.length > 500) {
        return summary.substring(0, 497) + '...';
      }
      
      return summary;
    } catch (error) {
      return '[Data masking failed]';
    }
  }
}
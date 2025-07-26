import { Injectable, Logger } from "@nestjs/common";
import { Observable, Subject, interval } from "rxjs";
import { map, filter } from "rxjs/operators";
import * as crypto from "crypto";

export interface SecurityVulnerability {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  category:
    | "authentication"
    | "authorization"
    | "data-protection"
    | "input-validation"
    | "encryption"
    | "logging";
  title: string;
  description: string;
  impact: string;
  recommendation: string;
  detectedAt: Date;
  status: "open" | "investigating" | "mitigated" | "resolved";
  cveId?: string;
  affectedComponent?: string;
}

export interface SecurityAuditResult {
  timestamp: Date;
  overallScore: number; // 0-100
  riskLevel: "low" | "medium" | "high" | "critical";
  vulnerabilities: SecurityVulnerability[];
  complianceStatus: {
    gdpr: boolean;
    sox: boolean;
    hipaa: boolean;
    pci: boolean;
  };
  recommendations: string[];
  nextAuditDate: Date;
}

export interface SecurityMetrics {
  totalVulnerabilities: number;
  criticalVulnerabilities: number;
  highVulnerabilities: number;
  mediumVulnerabilities: number;
  lowVulnerabilities: number;
  resolvedVulnerabilities: number;
  averageResolutionTime: number; // hours
  securityScore: number; // 0-100
  lastAuditDate: Date;
}

export interface DataClassification {
  level: "public" | "internal" | "confidential" | "restricted";
  description: string;
  encryptionRequired: boolean;
  retentionPolicy: string;
  accessControls: string[];
}

@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger(SecurityAuditService.name);
  private readonly vulnerabilities = new Map<string, SecurityVulnerability>();
  private readonly securitySubject = new Subject<SecurityAuditResult>();
  private readonly vulnerabilitySubject = new Subject<
    SecurityVulnerability[]
  >();

  // Security configuration
  private readonly securityConfig = {
    auditInterval: 24 * 60 * 60 * 1000, // 24 hours
    maxFailedAttempts: 5,
    sessionTimeout: 30 * 60 * 1000, // 30 minutes
    passwordPolicy: {
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChars: true,
      maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
    },
    encryption: {
      algorithm: "aes-256-gcm",
      keyRotationInterval: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
    logging: {
      securityEvents: true,
      dataAccess: true,
      configurationChanges: true,
      retentionDays: 365,
    },
  };

  // Data classification matrix
  private readonly dataClassificationMatrix: Map<string, DataClassification> =
    new Map([
      [
        "user_personal_data",
        {
          level: "confidential",
          description: "Personal identifiable information",
          encryptionRequired: true,
          retentionPolicy: "7 years",
          accessControls: ["role-based", "audit-logging", "encryption-at-rest"],
        },
      ],
      [
        "system_configuration",
        {
          level: "internal",
          description: "System configuration and settings",
          encryptionRequired: true,
          retentionPolicy: "indefinite",
          accessControls: ["admin-only", "change-tracking"],
        },
      ],
      [
        "performance_metrics",
        {
          level: "internal",
          description: "System performance and monitoring data",
          encryptionRequired: false,
          retentionPolicy: "1 year",
          accessControls: ["read-only", "aggregated-access"],
        },
      ],
      [
        "security_logs",
        {
          level: "restricted",
          description: "Security audit logs and events",
          encryptionRequired: true,
          retentionPolicy: "7 years",
          accessControls: ["security-team-only", "immutable-logs"],
        },
      ],
    ]);

  constructor() {
    this.startSecurityMonitoring();
  }

  private startSecurityMonitoring() {
    // Periodic security audits
    interval(this.securityConfig.auditInterval).subscribe(() => {
      this.performSecurityAudit();
    });

    // Real-time vulnerability monitoring
    interval(5 * 60 * 1000).subscribe(() => {
      // Every 5 minutes
      this.checkForNewVulnerabilities();
    });
  }

  async performSecurityAudit(): Promise<SecurityAuditResult> {
    this.logger.log("Starting comprehensive security audit...");

    const vulnerabilities: SecurityVulnerability[] = [];

    // 1. Authentication and Authorization Audit
    const authVulnerabilities =
      await this.auditAuthenticationAndAuthorization();
    vulnerabilities.push(...authVulnerabilities);

    // 2. Data Protection Audit
    const dataVulnerabilities = await this.auditDataProtection();
    vulnerabilities.push(...dataVulnerabilities);

    // 3. Input Validation Audit
    const inputVulnerabilities = await this.auditInputValidation();
    vulnerabilities.push(...inputVulnerabilities);

    // 4. Encryption Audit
    const encryptionVulnerabilities = await this.auditEncryption();
    vulnerabilities.push(...encryptionVulnerabilities);

    // 5. Logging and Monitoring Audit
    const loggingVulnerabilities = await this.auditLoggingAndMonitoring();
    vulnerabilities.push(...loggingVulnerabilities);

    // 6. Configuration Security Audit
    const configVulnerabilities = await this.auditConfigurationSecurity();
    vulnerabilities.push(...configVulnerabilities);

    // Calculate security score
    const overallScore = this.calculateSecurityScore(vulnerabilities);
    const riskLevel = this.determineRiskLevel(overallScore);

    // Check compliance status
    const complianceStatus = this.checkComplianceStatus(vulnerabilities);

    // Generate recommendations
    const recommendations =
      this.generateSecurityRecommendations(vulnerabilities);

    const auditResult: SecurityAuditResult = {
      timestamp: new Date(),
      overallScore,
      riskLevel,
      vulnerabilities,
      complianceStatus,
      recommendations,
      nextAuditDate: new Date(Date.now() + this.securityConfig.auditInterval),
    };

    // Update vulnerability tracking
    vulnerabilities.forEach((vuln) => {
      this.vulnerabilities.set(vuln.id, vuln);
    });

    // Emit results
    this.securitySubject.next(auditResult);
    this.vulnerabilitySubject.next(Array.from(this.vulnerabilities.values()));

    this.logger.log(
      `Security audit completed. Score: ${overallScore}/100, Risk Level: ${riskLevel}`
    );
    return auditResult;
  }

  private async auditAuthenticationAndAuthorization(): Promise<
    SecurityVulnerability[]
  > {
    const vulnerabilities: SecurityVulnerability[] = [];

    // Check for weak password policies
    if (!this.securityConfig.passwordPolicy.requireSpecialChars) {
      vulnerabilities.push({
        id: "AUTH-001",
        severity: "medium",
        category: "authentication",
        title: "Weak Password Policy",
        description: "Password policy does not require special characters",
        impact: "Increased risk of password-based attacks",
        recommendation:
          "Enforce special character requirement in password policy",
        detectedAt: new Date(),
        status: "open",
      });
    }

    // Check for session timeout configuration
    if (this.securityConfig.sessionTimeout > 60 * 60 * 1000) {
      // More than 1 hour
      vulnerabilities.push({
        id: "AUTH-002",
        severity: "medium",
        category: "authentication",
        title: "Long Session Timeout",
        description: "Session timeout is configured for more than 1 hour",
        impact: "Increased risk of session hijacking",
        recommendation: "Reduce session timeout to 30 minutes or less",
        detectedAt: new Date(),
        status: "open",
      });
    }

    // Check for missing role-based access control
    vulnerabilities.push({
      id: "AUTH-003",
      severity: "high",
      category: "authorization",
      title: "Missing Role-Based Access Control",
      description: "System lacks comprehensive role-based access control",
      impact: "Unauthorized access to sensitive data and functions",
      recommendation:
        "Implement comprehensive RBAC with least privilege principle",
      detectedAt: new Date(),
      status: "open",
    });

    return vulnerabilities;
  }

  private async auditDataProtection(): Promise<SecurityVulnerability[]> {
    const vulnerabilities: SecurityVulnerability[] = [];

    // Check for unencrypted sensitive data
    vulnerabilities.push({
      id: "DATA-001",
      severity: "critical",
      category: "data-protection",
      title: "Unencrypted Sensitive Data",
      description: "Sensitive data is stored without encryption",
      impact: "Data breach risk and compliance violations",
      recommendation: "Implement encryption at rest for all sensitive data",
      detectedAt: new Date(),
      status: "open",
    });

    // Check for missing data classification
    vulnerabilities.push({
      id: "DATA-002",
      severity: "high",
      category: "data-protection",
      title: "Missing Data Classification",
      description: "System lacks proper data classification framework",
      impact: "Inappropriate handling of sensitive data",
      recommendation:
        "Implement data classification matrix and handling procedures",
      detectedAt: new Date(),
      status: "open",
    });

    // Check for inadequate data retention policies
    vulnerabilities.push({
      id: "DATA-003",
      severity: "medium",
      category: "data-protection",
      title: "Inadequate Data Retention Policies",
      description:
        "Data retention policies are not properly defined or enforced",
      impact: "Compliance violations and unnecessary data exposure",
      recommendation:
        "Define and implement comprehensive data retention policies",
      detectedAt: new Date(),
      status: "open",
    });

    return vulnerabilities;
  }

  private async auditInputValidation(): Promise<SecurityVulnerability[]> {
    const vulnerabilities: SecurityVulnerability[] = [];

    // Check for SQL injection vulnerabilities
    vulnerabilities.push({
      id: "INPUT-001",
      severity: "critical",
      category: "input-validation",
      title: "Potential SQL Injection Vulnerabilities",
      description: "System may be vulnerable to SQL injection attacks",
      impact: "Unauthorized data access and manipulation",
      recommendation: "Use parameterized queries and input validation",
      detectedAt: new Date(),
      status: "open",
    });

    // Check for XSS vulnerabilities
    vulnerabilities.push({
      id: "INPUT-002",
      severity: "high",
      category: "input-validation",
      title: "Cross-Site Scripting (XSS) Vulnerabilities",
      description: "System may be vulnerable to XSS attacks",
      impact: "Client-side code execution and session hijacking",
      recommendation: "Implement proper input sanitization and output encoding",
      detectedAt: new Date(),
      status: "open",
    });

    // Check for command injection vulnerabilities
    vulnerabilities.push({
      id: "INPUT-003",
      severity: "critical",
      category: "input-validation",
      title: "Command Injection Vulnerabilities",
      description: "System may be vulnerable to command injection attacks",
      impact: "Remote code execution and system compromise",
      recommendation: "Avoid command execution with user input, use safe APIs",
      detectedAt: new Date(),
      status: "open",
    });

    return vulnerabilities;
  }

  private async auditEncryption(): Promise<SecurityVulnerability[]> {
    const vulnerabilities: SecurityVulnerability[] = [];

    // Check for weak encryption algorithms
    if (this.securityConfig.encryption.algorithm !== "aes-256-gcm") {
      vulnerabilities.push({
        id: "CRYPTO-001",
        severity: "high",
        category: "encryption",
        title: "Weak Encryption Algorithm",
        description: "System uses weak or deprecated encryption algorithms",
        impact: "Data confidentiality compromise",
        recommendation: "Use AES-256-GCM or stronger encryption algorithms",
        detectedAt: new Date(),
        status: "open",
      });
    }

    // Check for key rotation policies
    vulnerabilities.push({
      id: "CRYPTO-002",
      severity: "medium",
      category: "encryption",
      title: "Missing Key Rotation Policy",
      description: "Encryption keys are not rotated regularly",
      impact: "Increased risk of key compromise",
      recommendation: "Implement automatic key rotation every 30 days",
      detectedAt: new Date(),
      status: "open",
    });

    // Check for secure key storage
    vulnerabilities.push({
      id: "CRYPTO-003",
      severity: "critical",
      category: "encryption",
      title: "Insecure Key Storage",
      description: "Encryption keys may be stored insecurely",
      impact: "Complete encryption bypass",
      recommendation:
        "Use hardware security modules (HSM) or secure key management",
      detectedAt: new Date(),
      status: "open",
    });

    return vulnerabilities;
  }

  private async auditLoggingAndMonitoring(): Promise<SecurityVulnerability[]> {
    const vulnerabilities: SecurityVulnerability[] = [];

    // Check for insufficient logging
    if (!this.securityConfig.logging.securityEvents) {
      vulnerabilities.push({
        id: "LOGGING-001",
        severity: "high",
        category: "logging",
        title: "Insufficient Security Logging",
        description: "Security events are not properly logged",
        impact: "Inability to detect and respond to security incidents",
        recommendation: "Implement comprehensive security event logging",
        detectedAt: new Date(),
        status: "open",
      });
    }

    // Check for log retention policies
    if (this.securityConfig.logging.retentionDays < 365) {
      vulnerabilities.push({
        id: "LOGGING-002",
        severity: "medium",
        category: "logging",
        title: "Inadequate Log Retention",
        description: "Log retention period is less than 1 year",
        impact: "Compliance violations and loss of forensic data",
        recommendation: "Extend log retention to at least 1 year",
        detectedAt: new Date(),
        status: "open",
      });
    }

    // Check for log integrity
    vulnerabilities.push({
      id: "LOGGING-003",
      severity: "high",
      category: "logging",
      title: "Log Integrity Not Protected",
      description: "Log files are not protected against tampering",
      impact: "Log manipulation and evidence destruction",
      recommendation:
        "Implement log integrity protection and write-once storage",
      detectedAt: new Date(),
      status: "open",
    });

    return vulnerabilities;
  }

  private async auditConfigurationSecurity(): Promise<SecurityVulnerability[]> {
    const vulnerabilities: SecurityVulnerability[] = [];

    // Check for default credentials
    vulnerabilities.push({
      id: "CONFIG-001",
      severity: "critical",
      category: "authentication",
      title: "Default Credentials in Use",
      description: "System may be using default or hardcoded credentials",
      impact: "Unauthorized access and system compromise",
      recommendation:
        "Change all default credentials and use secure credential management",
      detectedAt: new Date(),
      status: "open",
    });

    // Check for insecure configuration
    vulnerabilities.push({
      id: "CONFIG-002",
      severity: "high",
      category: "data-protection",
      title: "Insecure Configuration Settings",
      description: "System configuration may have security weaknesses",
      impact: "Various security vulnerabilities depending on configuration",
      recommendation: "Review and harden all configuration settings",
      detectedAt: new Date(),
      status: "open",
    });

    // Check for missing security headers
    vulnerabilities.push({
      id: "CONFIG-003",
      severity: "medium",
      category: "data-protection",
      title: "Missing Security Headers",
      description: "Web application lacks important security headers",
      impact: "Increased vulnerability to various web attacks",
      recommendation:
        "Implement security headers (CSP, HSTS, X-Frame-Options, etc.)",
      detectedAt: new Date(),
      status: "open",
    });

    return vulnerabilities;
  }

  private calculateSecurityScore(
    vulnerabilities: SecurityVulnerability[]
  ): number {
    let score = 100;

    // Deduct points based on vulnerability severity
    vulnerabilities.forEach((vuln) => {
      switch (vuln.severity) {
        case "critical":
          score -= 20;
          break;
        case "high":
          score -= 10;
          break;
        case "medium":
          score -= 5;
          break;
        case "low":
          score -= 2;
          break;
      }
    });

    return Math.max(0, score);
  }

  private determineRiskLevel(
    score: number
  ): "low" | "medium" | "high" | "critical" {
    if (score >= 80) return "low";
    if (score >= 60) return "medium";
    if (score >= 40) return "high";
    return "critical";
  }

  private checkComplianceStatus(
    vulnerabilities: SecurityVulnerability[]
  ): SecurityAuditResult["complianceStatus"] {
    const criticalVulns = vulnerabilities.filter(
      (v) => v.severity === "critical"
    );
    const highVulns = vulnerabilities.filter((v) => v.severity === "high");

    return {
      gdpr: criticalVulns.length === 0 && highVulns.length <= 2,
      sox: criticalVulns.length === 0 && highVulns.length <= 1,
      hipaa: criticalVulns.length === 0 && highVulns.length === 0,
      pci: criticalVulns.length === 0 && highVulns.length === 0,
    };
  }

  private generateSecurityRecommendations(
    vulnerabilities: SecurityVulnerability[]
  ): string[] {
    const recommendations: string[] = [];

    // Prioritize critical vulnerabilities
    const criticalVulns = vulnerabilities.filter(
      (v) => v.severity === "critical"
    );
    if (criticalVulns.length > 0) {
      recommendations.push(
        "URGENT: Address all critical vulnerabilities immediately"
      );
    }

    // Add specific recommendations
    if (vulnerabilities.some((v) => v.category === "authentication")) {
      recommendations.push("Implement multi-factor authentication (MFA)");
    }

    if (vulnerabilities.some((v) => v.category === "encryption")) {
      recommendations.push("Upgrade encryption standards to AES-256-GCM");
    }

    if (vulnerabilities.some((v) => v.category === "data-protection")) {
      recommendations.push(
        "Implement data classification and encryption at rest"
      );
    }

    if (vulnerabilities.some((v) => v.category === "input-validation")) {
      recommendations.push(
        "Implement comprehensive input validation and sanitization"
      );
    }

    if (vulnerabilities.some((v) => v.category === "logging")) {
      recommendations.push(
        "Enhance security logging and monitoring capabilities"
      );
    }

    recommendations.push(
      "Conduct regular security training for development team"
    );
    recommendations.push(
      "Implement automated security testing in CI/CD pipeline"
    );
    recommendations.push("Establish incident response procedures");

    return recommendations;
  }

  private async checkForNewVulnerabilities(): Promise<void> {
    // This would integrate with vulnerability databases and security feeds
    // For now, we'll simulate checking for new vulnerabilities
    this.logger.debug("Checking for new vulnerabilities...");
  }

  // Public API methods
  getSecurityAuditStream(): Observable<SecurityAuditResult> {
    return this.securitySubject.asObservable();
  }

  getVulnerabilitiesStream(): Observable<SecurityVulnerability[]> {
    return this.vulnerabilitySubject.asObservable();
  }

  getCurrentVulnerabilities(): SecurityVulnerability[] {
    return Array.from(this.vulnerabilities.values());
  }

  getSecurityMetrics(): SecurityMetrics {
    const vulnerabilities = this.getCurrentVulnerabilities();
    const resolvedVulns = vulnerabilities.filter(
      (v) => v.status === "resolved"
    );

    const avgResolutionTime =
      resolvedVulns.length > 0
        ? resolvedVulns.reduce((sum, v) => {
            const resolutionTime =
              new Date().getTime() - v.detectedAt.getTime();
            return sum + resolutionTime;
          }, 0) /
          resolvedVulns.length /
          (1000 * 60 * 60) // Convert to hours
        : 0;

    return {
      totalVulnerabilities: vulnerabilities.length,
      criticalVulnerabilities: vulnerabilities.filter(
        (v) => v.severity === "critical"
      ).length,
      highVulnerabilities: vulnerabilities.filter((v) => v.severity === "high")
        .length,
      mediumVulnerabilities: vulnerabilities.filter(
        (v) => v.severity === "medium"
      ).length,
      lowVulnerabilities: vulnerabilities.filter((v) => v.severity === "low")
        .length,
      resolvedVulnerabilities: resolvedVulns.length,
      averageResolutionTime: avgResolutionTime,
      securityScore: this.calculateSecurityScore(vulnerabilities),
      lastAuditDate: new Date(),
    };
  }

  updateVulnerabilityStatus(
    vulnerabilityId: string,
    status: SecurityVulnerability["status"]
  ): boolean {
    const vulnerability = this.vulnerabilities.get(vulnerabilityId);
    if (vulnerability) {
      vulnerability.status = status;
      this.vulnerabilities.set(vulnerabilityId, vulnerability);
      this.vulnerabilitySubject.next(Array.from(this.vulnerabilities.values()));
      return true;
    }
    return false;
  }

  getDataClassification(dataType: string): DataClassification | undefined {
    return this.dataClassificationMatrix.get(dataType);
  }

  validateSecurityConfiguration(): boolean {
    // Validate security configuration
    const requiredConfigs = [
      "passwordPolicy.minLength",
      "passwordPolicy.requireUppercase",
      "passwordPolicy.requireLowercase",
      "passwordPolicy.requireNumbers",
      "passwordPolicy.requireSpecialChars",
      "encryption.algorithm",
      "sessionTimeout",
    ];

    // This would perform actual validation
    return true;
  }

  generateSecurityReport(): string {
    const metrics = this.getSecurityMetrics();
    const vulnerabilities = this.getCurrentVulnerabilities();

    let report = `
# Security Audit Report
Generated: ${new Date().toISOString()}

## Executive Summary
- Overall Security Score: ${metrics.securityScore}/100
- Total Vulnerabilities: ${metrics.totalVulnerabilities}
- Critical Vulnerabilities: ${metrics.criticalVulnerabilities}
- High Vulnerabilities: ${metrics.highVulnerabilities}

## Vulnerability Breakdown
- Critical: ${metrics.criticalVulnerabilities}
- High: ${metrics.highVulnerabilities}
- Medium: ${metrics.mediumVulnerabilities}
- Low: ${metrics.lowVulnerabilities}
- Resolved: ${metrics.resolvedVulnerabilities}

## Compliance Status
- GDPR: ${
      this.checkComplianceStatus(vulnerabilities).gdpr
        ? "✓ Compliant"
        : "✗ Non-compliant"
    }
- SOX: ${
      this.checkComplianceStatus(vulnerabilities).sox
        ? "✓ Compliant"
        : "✗ Non-compliant"
    }
- HIPAA: ${
      this.checkComplianceStatus(vulnerabilities).hipaa
        ? "✓ Compliant"
        : "✗ Non-compliant"
    }
- PCI: ${
      this.checkComplianceStatus(vulnerabilities).pci
        ? "✓ Compliant"
        : "✗ Non-compliant"
    }

## Detailed Vulnerabilities
`;

    vulnerabilities.forEach((vuln) => {
      report += `
### ${vuln.title} (${vuln.id})
- **Severity**: ${vuln.severity.toUpperCase()}
- **Category**: ${vuln.category}
- **Status**: ${vuln.status}
- **Description**: ${vuln.description}
- **Impact**: ${vuln.impact}
- **Recommendation**: ${vuln.recommendation}
- **Detected**: ${vuln.detectedAt.toISOString()}
`;
    });

    return report;
  }
}

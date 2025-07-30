# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Which versions are **eligible** for receiving such patches depends on the CVSS v3.0 Rating:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of NestJS Telescope seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### Reporting Process

1. **Do not create a public GitHub issue** for the vulnerability.

2. **Email us** at [devahmedhegazee@gmail.com](mailto:devahmedhegazee@gmail.com) with the following information:
   - A description of the vulnerability
   - Steps to reproduce the issue
   - Potential impact assessment
   - Suggested fix (if available)

3. **We will acknowledge** your report within 48 hours.

4. **We will investigate** and provide updates on our progress.

5. **Once fixed**, we will:
   - Release a patch
   - Credit you in the security advisory
   - Update the changelog

### What to Include

When reporting a vulnerability, please include:

- **Description**: Clear description of the vulnerability
- **Steps to Reproduce**: Detailed steps to reproduce the issue
- **Impact**: Potential impact on users and systems
- **Environment**: Node.js version, NestJS version, OS, etc.
- **Proof of Concept**: Code or commands that demonstrate the issue
- **Suggested Fix**: If you have ideas for fixing the issue

### Responsible Disclosure

We follow responsible disclosure practices:

- **Timeline**: We aim to fix critical issues within 30 days
- **Communication**: We'll keep you updated on our progress
- **Credit**: We'll credit you in security advisories
- **Coordination**: We may coordinate disclosure with you

### Security Best Practices

When using NestJS Telescope:

1. **Keep Updated**: Always use the latest stable version
2. **Secure Configuration**: Use secure configuration options
3. **Network Security**: Protect your monitoring endpoints
4. **Access Control**: Implement proper authentication and authorization
5. **Data Protection**: Secure sensitive data in storage
6. **Regular Audits**: Regularly audit your monitoring setup

### Security Features

NestJS Telescope includes several security features:

- **Data Masking**: Automatic masking of sensitive data
- **Access Control**: Role-based access control
- **Audit Logging**: Comprehensive audit trails
- **Encryption**: Data encryption in transit and at rest
- **Rate Limiting**: Built-in rate limiting protection
- **Input Validation**: Strict input validation and sanitization

### Known Security Considerations

1. **Data Exposure**: Monitoring data may contain sensitive information
2. **Performance Impact**: Monitoring can impact application performance
3. **Storage Security**: Ensure secure storage of monitoring data
4. **Network Exposure**: Dashboard and API endpoints need protection
5. **Third-party Dependencies**: Review security of optional dependencies

### Security Updates

We regularly update dependencies and address security issues:

- **Dependency Updates**: Regular updates of all dependencies
- **Security Audits**: Regular security audits of the codebase
- **Vulnerability Scanning**: Automated vulnerability scanning
- **Code Reviews**: Security-focused code reviews

### Contact Information

For security-related issues:

- **Email**: [devahmedhegazee@gmail.com](mailto:devahmedhegazee@gmail.com)
- **PGP Key**: Available upon request
- **Response Time**: Within 48 hours

### Acknowledgments

We thank all security researchers who responsibly disclose vulnerabilities to us. Your contributions help make NestJS Telescope more secure for everyone.

---

For general support and questions, please use [GitHub Issues](https://github.com/ahmedhegazee/nestjs-telescope/issues). 
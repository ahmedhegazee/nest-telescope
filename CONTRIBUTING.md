# Contributing to NestJS Telescope

Thank you for your interest in contributing to NestJS Telescope! This document provides guidelines and information for contributors.

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm >= 8.0.0
- Git

### Development Setup

1. **Fork the repository**
   ```bash
   git clone https://github.com/your-username/nestjs-telescope.git
   cd nestjs-telescope
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up development environment**
   ```bash
   npm run build
   npm run test
   ```

## 📝 Development Guidelines

### Code Style

- **TypeScript**: Use strict TypeScript with explicit types
- **Naming**: Use descriptive names for variables, functions, and classes
- **Comments**: Add JSDoc comments for public APIs
- **Formatting**: Use Prettier for code formatting
- **Linting**: Follow ESLint rules

### Testing

- **Unit Tests**: Write tests for all new features
- **Integration Tests**: Test component interactions
- **E2E Tests**: Test complete workflows
- **Coverage**: Maintain >80% test coverage

### Commit Messages

Use conventional commit format:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test changes
- `chore`: Build/tooling changes

### Pull Request Process

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow coding guidelines
   - Add tests for new features
   - Update documentation

3. **Run tests and linting**
   ```bash
   npm run test
   npm run lint
   npm run build
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat(watcher): add new monitoring feature"
   ```

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **PR Review**
   - Ensure all tests pass
   - Address review comments
   - Update documentation if needed

## 🏗️ Architecture Guidelines

### Module Structure

```
src/telescope/
├── core/           # Core services and interfaces
├── watchers/       # Monitoring watchers
├── storage/        # Storage drivers
├── dashboard/      # Web dashboard
├── devtools/       # Development tools
└── utils/          # Utility functions
```

### Adding New Watchers

1. **Create watcher module**
   ```typescript
   // src/telescope/watchers/your-watcher/
   ├── your-watcher.module.ts
   ├── your-watcher.service.ts
   ├── your-watcher.config.ts
   └── index.ts
   ```

2. **Implement watcher interface**
   ```typescript
   export interface YourWatcherService {
     start(): void;
     stop(): void;
     getMetrics(): YourWatcherMetrics;
   }
   ```

3. **Add configuration**
   ```typescript
   export interface YourWatcherConfig {
     enabled: boolean;
     // your config options
   }
   ```

### Adding New Storage Drivers

1. **Create storage driver**
   ```typescript
   // src/telescope/storage/drivers/
   ├── your-storage.driver.ts
   └── your-storage.driver.spec.ts
   ```

2. **Implement storage interface**
   ```typescript
   export interface StorageDriver {
     store(entry: TelescopeEntry): Promise<void>;
     find(filter: TelescopeEntryFilter): Promise<TelescopeEntryResult>;
     // other methods
   }
   ```

## 🐛 Bug Reports

When reporting bugs, please include:

1. **Environment details**
   - Node.js version
   - NestJS version
   - Operating system
   - Package version

2. **Steps to reproduce**
   - Clear, step-by-step instructions
   - Minimal code example

3. **Expected vs actual behavior**
   - What you expected to happen
   - What actually happened

4. **Additional context**
   - Error messages
   - Stack traces
   - Screenshots (if applicable)

## 💡 Feature Requests

When requesting features, please include:

1. **Problem description**
   - What problem are you trying to solve?
   - Why is this feature needed?

2. **Proposed solution**
   - How should the feature work?
   - Any specific requirements?

3. **Use cases**
   - Real-world scenarios
   - Target users

4. **Implementation ideas**
   - Technical approach
   - API design suggestions

## 📚 Documentation

### Writing Documentation

- **Clear and concise**: Use simple language
- **Examples**: Include code examples
- **Structure**: Use proper headings and formatting
- **Links**: Link to related documentation

### Documentation Types

- **API Documentation**: JSDoc comments
- **User Guides**: Step-by-step instructions
- **Examples**: Working code examples
- **Migration Guides**: Version upgrade instructions

## 🔧 Development Tools

### Available Scripts

```bash
# Development
npm run start:dev          # Start development server
npm run build             # Build the project
npm run test              # Run tests
npm run test:watch        # Run tests in watch mode
npm run test:cov          # Run tests with coverage
npm run lint              # Run ESLint
npm run format            # Format code with Prettier

# Documentation
npm run docs:generate     # Generate API documentation
npm run docs:serve        # Serve documentation locally

# Examples
npm run examples:run      # Run example applications
```

### Debugging

```bash
# Debug tests
npm run test:debug

# Debug application
npm run start:debug
```

## 🤝 Community

### Getting Help

- **GitHub Issues**: For bugs and feature requests
- **GitHub Discussions**: For questions and discussions
- **Documentation**: Check the README and API docs

### Code of Conduct

- Be respectful and inclusive
- Help others learn and grow
- Provide constructive feedback
- Follow project guidelines

## 📄 License

By contributing to NestJS Telescope, you agree that your contributions will be licensed under the MIT License.

## 🙏 Acknowledgments

Thank you to all contributors who help make NestJS Telescope better!

---

For more information, see the [README.md](README.md) file. 
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: {
          types: ['jest', 'node'],
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: false,
          noImplicitAny: false,
          strictNullChecks: false,
          strictFunctionTypes: false,
          strictPropertyInitialization: false,
          noImplicitReturns: false,
          noFallthroughCasesInSwitch: true,
          noUncheckedIndexedAccess: false,
          exactOptionalPropertyTypes: false,
          skipLibCheck: true,
        },
      },
    ],
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/../test/jest-setup.ts'],
};

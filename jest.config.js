module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapping: {
    '^@telescope/(.*)$': '<rootDir>/telescope/$1',
    '^@telescope/core/(.*)$': '<rootDir>/telescope/core/$1',
    '^@telescope/devtools/(.*)$': '<rootDir>/telescope/devtools/$1',
    '^@telescope/storage/(.*)$': '<rootDir>/telescope/storage/$1',
  },
};
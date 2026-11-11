/** Unit, integration (real Postgres and Redis) and e2e tests all run through this one config. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  // Integration and e2e tests share one Postgres and one Redis, so test files run one at a time.
  maxWorkers: 1,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        // 151002 only asks for isolatedModules with Node16 modules; we keep full type-checking.
        diagnostics: { ignoreCodes: [6059, 18002, 18003, 151002] },
      },
    ],
  },
  testRegex: '(src|test)/.*\\.(spec|e2e-spec)\\.ts$',
  setupFiles: ['<rootDir>/test/support/setup-env.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov'],
  coverageThreshold: {
    global: { statements: 90, branches: 85, functions: 90, lines: 90 },
    './src/modules/scoring/': { statements: 100, branches: 95, functions: 100, lines: 100 },
  },
};

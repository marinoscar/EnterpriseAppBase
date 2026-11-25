/** @type {import('jest').Config} */
// Same shape as packages/platform-api/test/jest.config.js: ts-jest with
// isolatedModules (ts.transpileModule per file). Type checking is
// `npm run typecheck`, which covers test/ too.
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { isolatedModules: true } }],
  },
  testEnvironment: 'node',
  roots: ['<rootDir>/src/', '<rootDir>/test/'],
  testTimeout: 60000,
};

/** @type {import('jest').Config} */
// Same shape as apps/api/test/jest.config.js: ts-jest with isolatedModules
// (ts.transpileModule per file, no LanguageService per worker). Type checking
// is `npm run typecheck`, which covers test/ too. Jest, not vitest: this is
// Nest code, and vitest's esbuild/oxc transform does not emit
// `design:paramtypes` decorator metadata.
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

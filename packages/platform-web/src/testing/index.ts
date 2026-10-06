// `@marinoscar/platform-web/testing`: test doubles for the web host ports
// (issue #696). For package tests and app tests; never in production code.

export { createTestApiError, createTestPlatformHost } from './test-platform-host.js';
export type {
  TestApiRequest,
  TestApiResponse,
  TestPlatformHost,
  TestPlatformHostOptions,
} from './test-platform-host.js';

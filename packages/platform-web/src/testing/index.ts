// `@marinoscar/platform-web/testing`: test doubles for the web host ports
// (issue #696). For package tests and app tests; never in production code.

export { createTestApiError, createTestBlobResponse, createTestPlatformHost } from './test-platform-host.js';
export type {
  TestApiRequest,
  TestApiResponse,
  TestPlatformHost,
  TestPlatformHostOptions,
  TestSseFrame,
} from './test-platform-host.js';

// `@marinoscar/platform-web/testing`: test doubles for the web host ports
// (issue #696) and the web conformance harness (issue #742). For package tests
// and app tests; never in production code.

export { createTestApiError, createTestBlobResponse, createTestPlatformHost } from './test-platform-host.js';
export type {
  TestApiRequest,
  TestApiResponse,
  TestPlatformHost,
  TestPlatformHostOptions,
  TestSseFrame,
} from './test-platform-host.js';

export { formatWebConformanceSummary, runPlatformWebConformance, webConformanceSuites } from './conformance.js';
export type {
  AppRouteDef,
  PlatformWebConformanceOptions,
  WebConformanceCard,
  WebConformanceContext,
  WebConformanceSection,
  WebConformanceSuite,
  WebConformanceSummaryEntry,
  WebConformanceTestApi,
  WebDestinationsView,
} from './conformance.js';

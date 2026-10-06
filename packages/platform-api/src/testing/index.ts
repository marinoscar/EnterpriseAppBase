// `@marinoscar/platform-api/testing`: the conformance harness. Documented in ./README.md.
//
// Peer-free on purpose: nothing under src/testing imports Jest or Vitest, so
// one harness serves the Jest API and the Vitest web and CLI apps
// (test/testing/peer-free.spec.ts).

export { runPlatformConformance } from './run-platform-conformance';
export type { PlatformConformanceOptions } from './run-platform-conformance';
export { conformanceSuites } from './conformance-suites';
export type {
  ConformanceCase,
  ConformanceContext,
  ConformanceFinding,
  ConformanceReport,
  ConformanceSuite,
  ConformanceTestApi,
} from './conformance-suite';
export { cronEnqueueOnlySuite } from './suites/cron-enqueue-only';
export type { CronEnqueueOnlyOptions } from './suites/cron-enqueue-only';

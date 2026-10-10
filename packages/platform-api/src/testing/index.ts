// `@marinoscar/platform-api/testing`: the conformance harness. Documented in ./README.md.
//
// Peer-free on purpose: nothing under src/testing imports Jest or Vitest, so
// one harness serves the Jest API and the Vitest web and CLI apps
// (test/testing/peer-free.spec.ts).

import type { CronEnqueueOnlyOptions } from './suites/cron-enqueue-only';
import type { UserOwnedDataOptions } from './suites/user-owned-data';

export { formatConformanceSummary, runPlatformConformance } from './run-platform-conformance';
export type { ConformanceSummaryEntry, PlatformConformanceOptions } from './run-platform-conformance';
export { conformanceSuites } from './conformance-suites';
export type {
  ConformanceAppSuite,
  ConformanceCase,
  ConformanceContext,
  ConformanceFinding,
  ConformanceReport,
  ConformanceSkip,
  ConformanceSuite,
  ConformanceTestApi,
} from './conformance-suite';
export { cronEnqueueOnlySuite } from './suites/cron-enqueue-only';
export type { CronEnqueueOnlyOptions } from './suites/cron-enqueue-only';

// Test doubles for the host ports (issue #696): a header-driven platform host
// and in-memory audit and settings ports, for PACKAGE tests only.
export {
  createTestPlatformHost,
  InMemoryAuditSink,
  InMemorySystemSettingsStore,
  TEST_PERMISSIONS_HEADER,
  TEST_REQUIRED_PERMISSIONS_KEY,
} from './host/index';

// The `user-owned-data` suite (issue #699; origin #688) and the small Prisma
// schema reader behind it (models, fields, relations, onDelete).
export { userOwnedDataSuite } from './suites/user-owned-data';
export type { UserOwnedDataOptions } from './suites/user-owned-data';
export { effectiveOnDelete, parsePrismaSchema, readSchemaDatamodel, readSchemaText } from './prisma-schema';
export type { DatamodelField, DatamodelModel, DatamodelRelation } from './prisma-schema';

// ---- `PlatformConformanceSuiteOptions`: an augmentation target, declared here, never re-exported (#865) ----

/**
 * The suites {@link runPlatformConformance} can run, by option key: each
 * entry is the suite's options (the app passes them, or `{ skip: 'reason' }`
 * to opt out; see {@link PlatformConformanceOptions.suites}). An interface so a slice
 * that ships a suite adds its key by module augmentation (the telemetry slice's
 * `telemetry`, declared in `@marinoscar/platform-api/telemetry/testing`) and
 * the runner is not edited.
 *
 * @example
 * ```ts
 * declare module '@marinoscar/platform-api/testing' {
 *   interface PlatformConformanceSuiteOptions {
 *     myFeature?: MyFeatureOptions;
 *   }
 * }
 * ```
 *
 * @stability experimental
 */
export interface PlatformConformanceSuiteOptions {
  /** The `cron-enqueue-only` suite: its options, or `{ skip: 'reason' }` to opt out. */
  cronEnqueueOnly?: CronEnqueueOnlyOptions;
  /** The `user-owned-data` suite: its options, or `{ skip: 'reason' }` to opt out. */
  userOwnedData?: UserOwnedDataOptions;
}

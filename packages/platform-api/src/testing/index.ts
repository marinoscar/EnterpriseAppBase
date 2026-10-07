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

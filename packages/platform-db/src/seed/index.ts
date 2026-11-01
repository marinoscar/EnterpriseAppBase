// The platform seed slice: `@marinoscar/platform-db/seed`.
export { seedPlatform } from './seed-platform.js';
export {
  PLATFORM_SEED_STEP_IDS,
  SeedStepError,
  assertSeedIdempotent,
  assertSeedSteps,
  readSeedStepResult,
  type SeedIdempotenceResult,
  type SeedPlatformOptions,
  type SeedStep,
  type SeedStepContext,
  type SeedStepResult,
  type SeedStepSummary,
} from './steps.js';
export { platformSeedInputFrom, readSeedSnapshot, type PermissionCatalogSnapshot, type SeedRegistrySnapshot } from './input.js';
export type {
  PlatformSeedInput,
  SeedAllowedEmailDelegate,
  SeedDefaultOrganization,
  SeedJsonValue,
  SeedLogger,
  SeedNamedDelegate,
  SeedNamedEntry,
  SeedOrganizationDelegate,
  SeedPrisma,
  SeedRowId,
  SeedRolePermissionDelegate,
  SeedScope,
  SeedSummary,
  SeedSystemSettingsDelegate,
  SeedUpsertArgs,
} from './types.js';

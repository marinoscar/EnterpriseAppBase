// The platform seed slice: `@marinoscar/platform-db/seed`.
export { seedPlatform } from './seed-platform.js';
export { platformSeedInputFrom, readSeedSnapshot, type PermissionCatalogSnapshot, type SeedRegistrySnapshot } from './input.js';
export type {
  PlatformSeedInput,
  SeedAllowedEmailDelegate,
  SeedJsonValue,
  SeedLogger,
  SeedNamedDelegate,
  SeedNamedEntry,
  SeedPrisma,
  SeedRowId,
  SeedRolePermissionDelegate,
  SeedSummary,
  SeedSystemSettingsDelegate,
  SeedUpsertArgs,
} from './types.js';

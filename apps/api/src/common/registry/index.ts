// The registry primitive now lives in `@marinoscar/platform-api/core` (issue
// #694, PP-2.5). This barrel keeps every `'../common/registry'` import in the
// app working unchanged.
//
// Restricted to the framework-free registry symbols on purpose: it must stay
// importable where no Nest container exists (prisma/seed.ts,
// storage-purge.main.ts, module-evaluation-time DTOs), so `RegistryFreezeService`
// is NOT re-exported here. `CommonModule` imports it from the package.
// Recipe for declaring a registry: ./README.md.

export {
  DEFAULT_REGISTRY_ID_PATTERN,
  REGISTRY_ID_MAX_LENGTH,
  Registry,
  RegistryError,
  defineRegistry,
  freezeDefinedRegistries,
  listDefinedRegistries,
  withTemporaryEntries,
} from '@marinoscar/platform-api/core';
export type { RegistryErrorCode, RegistryOptions, RegistrySnapshot } from '@marinoscar/platform-api/core';

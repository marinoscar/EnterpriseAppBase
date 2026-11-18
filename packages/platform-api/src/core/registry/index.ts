// The framework-free registry primitive (issue #675). Recipe: ./README.md.
//
// `RegistryFreezeService` is deliberately NOT re-exported: this barrel must stay
// importable where no Nest container exists (prisma/seed.ts, storage-purge.main.ts,
// module-evaluation-time DTOs). Import the service from './registry-freeze.service'.

export {
  DEFAULT_REGISTRY_ID_PATTERN,
  REGISTRY_ID_MAX_LENGTH,
  Registry,
  RegistryError,
  defineRegistry,
  freezeDefinedRegistries,
  listDefinedRegistries,
} from './registry';
export type { RegistryErrorCode, RegistryOptions, RegistrySnapshot } from './registry';
export { withTemporaryEntries } from './testing';

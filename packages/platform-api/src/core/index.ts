// `@marinoscar/platform-api/core`: the primitives every other slice builds on
// (issue #698): the typed registry primitive (issue #675, moved here by issue
// #694) and the principal and scope contract (ADR 0001). Documented in
// ./README.md. Explicit named exports below the registry barrel.
//
// `registry/index.ts` stays free of Nest so it can load where no container
// exists (seeds, standalone scripts, import-time DTOs); `RegistryFreezeService`
// is the one Nest-aware export and lives in its own file.

export * from './registry/index';
export { RegistryFreezeService } from './registry/registry-freeze.service';

// The host ports (issue #696): the access port (`definePlatformHost`), the
// DI-time ports (`AUDIT_SINK`, `SYSTEM_SETTINGS_STORE`, `PLATFORM_PRISMA`) and
// `PlatformHostModule`, which binds them. Every packaged slice reuses them.
export * from './host/index';

// Principal and scope contract (ADR 0001, issue #687). Types only.
export type {
  CredentialKind,
  GroupMembership,
  NodePrincipal,
  OrgMembership,
  Principal,
  PrincipalKind,
  Scope,
  SystemActor,
  TenancyMode,
  UserPrincipal,
} from './principal/index';

// Errors: the application-wide exception filter, the error envelope's
// OpenAPI DTO and the two exceptions that go with it (issue #698).
export { HttpExceptionFilter } from './errors/http-exception.filter';
export { withVerbatimErrorBody, hasVerbatimErrorBody } from './errors/verbatim-error-body.exception';
export { DatabaseSeedException } from './errors/database-seed.exception';
export { ErrorDto } from './errors/error.dto';

// Crypto: the AES-256-GCM secret cipher under every runtime-configured
// credential, and its bootstrap check (issue #698), plus HMAC signing sub-keys
// from the same master key (issue #822). The cipher reads
// SECRETS_ENCRYPTION_KEY from the environment once and caches it.
export {
  USER_CREDENTIAL_DOMAIN_PREFIX,
  assertEncryptionKeyConfigured,
  decryptSecret,
  deriveSigningKey,
  encryptSecret,
  isCanonicalUuid,
  userCredentialPurpose,
} from './crypto/secret-cipher';
export { verifyEncryptionKeyAtStartup } from './crypto/encryption-key-startup-check';

// OpenAPI tag registry: apps and slices register the @ApiTags names their
// controllers use, with a description and a sidebar group (issue #698).
export {
  OPENAPI_TAG_NAME_PATTERN,
  openApiTagGroups,
  openApiTags,
} from './openapi/openapi-tag.registry';
export type { OpenApiTag, OpenApiTagGroup } from './openapi/openapi-tag.registry';

// Scoped data access (issue #699; origin #688): the user-owned data registry,
// the user-scoped client extension and the explicit unscoped escape. The app
// fills the registry and injects its generated client; nothing here imports a
// generated model type (`@prisma/client/extension` only).
export {
  ScopedAccessError,
  asSystem,
  forUser,
  ownerFieldOf,
  ownerRelationOf,
  registerUserOwnedModels,
  userOwnedModelRegistry,
  userScopeExtension,
} from './data-access/index';
export type {
  ExportPolicy,
  ExtendableClient,
  PurgePolicy,
  UserOwnedModelDef,
  UserOwnedModelLookup,
  UserScopeExtension,
} from './data-access/index';

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

// The pluggable-kind primitive (PP-14.5, issue #923): one registry of
// implementations per kind, each with its own settings schema, defaults and
// declared secrets, plus the descriptors a generated form renders. Framework-
// free like the registry. The conformance kit is `@marinoscar/platform-api/core/testing`.
export * from './pluggable/index';

// The host ports (issue #696): the access port (`definePlatformHost`), the
// DI-time ports (`AUDIT_SINK`, `SYSTEM_SETTINGS_STORE`, `PLATFORM_PRISMA`) and
// `PlatformHostModule`, which binds them. Every packaged slice reuses them.
export * from './host/index';

// Roles and permissions (issue #676, packaged by #866): the role and
// permission registries every slice declares into, the declaration types, and
// the seed catalog built from them. Framework-free, like the registry
// primitive. The platform's own declarations, in seed order, are
// `@marinoscar/platform-api/manifest`.
export {
  buildPermissionCatalog,
  catalogGrants,
  composePermissionCatalog,
  grantPermissions,
  permissionIds,
  permissionRegistry,
  registerPermissions,
  registerRoles,
  roleGrantRegistry,
  roleIds,
  roleRegistry,
} from './permissions/index';
export type {
  CatalogGrant,
  DeclarationList,
  Declarations,
  IdentifiedDeclaration,
  PermissionCatalog,
  PermissionCatalogDeclarations,
  PermissionCatalogEntry,
  PermissionCatalogSource,
  PermissionDeclaration,
  PermissionDeclarationMap,
  PermissionScope,
  RoleDeclaration,
  RoleDeclarationMap,
  RoleGrantDeclaration,
  RoleGrantEntry,
} from './permissions/index';

// Principal and scope contract (ADR 0001, issue #687) and the open principal
// and credential kind vocabularies (PP-14.14).
export type {
  BuiltinCredentialKind,
  BuiltinPrincipalKind,
  CredentialKindDef,
  GroupMembership,
  NodePrincipal,
  OrgMembership,
  Principal,
  PrincipalKindDef,
  Scope,
  SystemActor,
  TenancyMode,
  UserPrincipal,
} from './principal/index';
export {
  KIND_ID_PATTERN,
  UnknownCredentialKindError,
  credentialKindRegistry,
  isCredentialKind,
  principalKindRegistry,
  registerCredentialKind,
  registerPrincipalKind,
  requireCredentialKind,
} from './principal/index';

// ---- `PrincipalKinds` / `CredentialKinds`: augmentation targets, declared here, never re-exported (#865) ----

/**
 * The principal kinds the platform knows, as an augmentable interface: an app
 * adds a key to type its own kind (`service`) and registers the same id with
 * `registerPrincipalKind`. The value type is unused.
 *
 * Declared here, in the module `@marinoscar/platform-api/core` resolves to, so
 * the app's `declare module` merges in any file order.
 *
 * @extensionPoint schema
 * @stability experimental
 * @example
 * ```ts
 * declare module '@marinoscar/platform-api/core' {
 *   interface PrincipalKinds { service: true }
 * }
 * ```
 */
export interface PrincipalKinds {
  /** A human caller. */
  user: true;
  /** An unattended worker node. */
  node: true;
}

/**
 * The credential kinds the platform knows, as an augmentable interface: an app
 * adds a key to type its own kind (`'api-key'`) and registers the same id with
 * `registerCredentialKind`, naming the principal kind it authenticates as.
 * The value type is unused.
 *
 * @extensionPoint schema
 * @stability experimental
 * @example
 * ```ts
 * declare module '@marinoscar/platform-api/core' {
 *   interface CredentialKinds { 'api-key': true }
 * }
 * ```
 */
export interface CredentialKinds {
  /** A browser access JWT. */
  session: true;
  /** A device-flow access JWT. */
  device: true;
  /** A `pat_` personal access token. */
  pat: true;
  /** A `nod_` worker-node credential. */
  node: true;
}

/**
 * Every principal kind, built-in and augmented: `keyof PrincipalKinds`. The
 * unaugmented type is exactly `'user' | 'node'`.
 *
 * @stability experimental
 */
export type PrincipalKind = keyof PrincipalKinds;

/**
 * Every credential kind, built-in and augmented: `keyof CredentialKinds`. The
 * unaugmented type is exactly `'session' | 'device' | 'pat' | 'node'`. A run-time
 * check (`isCredentialKind`, `requireCredentialKind`) is still needed for a
 * value that arrives as a string.
 *
 * @stability experimental
 */
export type CredentialKind = keyof CredentialKinds;

// Errors: the application-wide exception filter, the error envelope's
// OpenAPI DTO and the two exceptions that go with it (issue #698).
export { HTTP_EXCEPTION_FILTER_OPTIONS, HttpExceptionFilter } from './errors/http-exception.filter';
export type { HttpExceptionFilterOptions } from './errors/http-exception.filter';
// The open error code vocabulary and the foreign-error mapper contract (PP-14.14).
export {
  BUILTIN_ERROR_CODES,
  ERROR_CODE_PATTERN,
  FALLBACK_ERROR_CODE,
  defaultErrorCodeForStatus,
  errorCodeRegistry,
  isErrorCodeForStatus,
  registerErrorCode,
} from './errors/error-codes';
export type { ErrorCodeDef, ErrorMapper } from './errors/error-codes';
export { withVerbatimErrorBody, hasVerbatimErrorBody } from './errors/verbatim-error-body.exception';
export { DatabaseSeedException } from './errors/database-seed.exception';
export { ErrorDto } from './errors/error.dto';

// Crypto: the AES-256-GCM secret cipher under every runtime-configured
// credential, and its bootstrap check (issue #698), plus HMAC signing sub-keys
// from the same master key (issue #822). The cipher reads
// SECRETS_ENCRYPTION_KEY from the environment once and caches it.
export {
  ORG_CREDENTIAL_DOMAIN_PREFIX,
  USER_CREDENTIAL_DOMAIN_PREFIX,
  assertEncryptionKeyConfigured,
  decryptSecret,
  deriveSigningKey,
  encryptSecret,
  isCanonicalUuid,
  orgCredentialPurpose,
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

// Organisation scoping and row-level security (issue #725; ADR 0002 D5): the
// transaction-local `forOrg` / `runInOrg` shapes, the bypass shapes for the
// separate system client, and the model ownership registry.
export {
  BUILTIN_SYSTEM_ACCESS_REASONS,
  RLS_SETTINGS,
  SYSTEM_ACCESS_REASONS,
  SYSTEM_ACCESS_REASON_ID_PATTERN,
  forOrg,
  forScope,
  forSystem,
  isSystemAccessReason,
  modelOwnershipRegistry,
  modelsOfKind,
  orgColumnOf,
  orgFieldOf,
  orgScopeExtension,
  registerModelOwnership,
  registerSystemAccessReason,
  runAsSystem,
  runInOrg,
  runInScope,
  systemAccessReasonRegistry,
  systemScopeExtension,
} from './data-access/index';
export type {
  BuiltinSystemAccessReason,
  ModelOwnershipDef,
  OrgScope,
  OrgScopedClient,
  OwnershipKind,
  RlsBaseClient,
  RlsRunnableClient,
  RlsTransactionClient,
  RlsTransactionOptions,
  SystemAccessReason,
  SystemAccessReasonDef,
} from './data-access/index';

// Cross-cutting decorators every packaged controller needs (issue #727): the
// maintenance-window exemption the app's `MaintenanceGuard` reads, and the
// `{ data: … }` envelope response documentation.
export { ALLOW_DURING_MAINTENANCE_KEY, AllowDuringMaintenance } from './maintenance/allow-during-maintenance.decorator';
export { ApiDataResponse } from './openapi/api-data-response.decorator';
export type { ApiDataResponseOptions, DataResponsePagination } from './openapi/api-data-response.decorator';

// The PostgreSQL connection string from `POSTGRES_*` (issue #172; packaged by
// #740 for the db-backup slice's dump, restore and admin connections).
export { buildDatabaseUrl } from './database-url';
export type { DatabaseEnv } from './database-url';

// Scoped data access (issue #699; origin #688): the user-owned data registry,
// `forUser()` / `userScopeExtension()` and `asSystem()`. Framework-free and
// schema-independent: model names are strings, and the only Prisma import is
// `@prisma/client/extension`. See ../README.md, "Scoped data access".

export type { ExportPolicy, PurgePolicy, UserOwnedModelDef, UserOwnedModelLookup } from './types';
export { ScopedAccessError } from './scoped-access.error';
export {
  ownerFieldOf,
  ownerRelationOf,
  registerUserOwnedModels,
  userOwnedModelRegistry,
} from './user-owned-data.registry';
export { asSystem, forUser, userScopeExtension } from './scoped-client';
export type { ExtendableClient, UserScopeExtension } from './scoped-client';
export {
  RLS_SETTINGS,
  SYSTEM_ACCESS_REASONS,
  forOrg,
  forScope,
  forSystem,
  orgScopeExtension,
  runAsSystem,
  runInOrg,
  runInScope,
  systemScopeExtension,
} from './rls';
export type {
  OrgScope,
  OrgScopedClient,
  RlsBaseClient,
  RlsRunnableClient,
  RlsTransactionClient,
  RlsTransactionOptions,
  SystemAccessReason,
} from './rls';
export {
  modelOwnershipRegistry,
  modelsOfKind,
  orgColumnOf,
  orgFieldOf,
  registerModelOwnership,
} from './model-ownership';
export type { ModelOwnershipDef, OwnershipKind } from './model-ownership';

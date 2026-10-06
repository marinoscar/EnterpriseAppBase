// The user-owned data registry and scoped data access (issue #688).
// Importing this folder fills the registry: consumers import from here, never
// from user-owned-model.registry.ts directly. See README.md.
import './user-owned-model.manifest';

export {
  ownerFieldOf,
  ownerRelationOf,
  registerUserOwnedModels,
  userOwnedModelRegistry,
} from './user-owned-model.registry';
export type { ExportPolicy, PurgePolicy, UserOwnedModelDef } from './user-owned-model.registry';
export { PLATFORM_USER_OWNED_MODELS } from './platform-user-owned-models';
export { ScopedAccessError } from './scoped-access.error';
export { ScopedPrismaService, buildUserScopedClient } from './scoped-prisma.service';
export type { UserScopedClient } from './scoped-prisma.service';

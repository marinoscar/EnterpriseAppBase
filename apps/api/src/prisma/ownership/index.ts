// The app side of scoped data access (issue #688; mechanism moved to
// `@marinoscar/platform-api/core` by #699). Importing this folder fills the
// package's user-owned registry with the platform and app inventories. The
// registry, `ScopedAccessError`, `forUser`, `userScopeExtension` and
// `asSystem` are imported from `@marinoscar/platform-api/core`, never
// re-exported here. See README.md.
import './user-owned-model.manifest';

export { PLATFORM_USER_OWNED_MODELS } from './platform-user-owned-models';
export { ScopedPrismaService } from './scoped-prisma.service';
export type { UserScopedClient } from './scoped-prisma.service';

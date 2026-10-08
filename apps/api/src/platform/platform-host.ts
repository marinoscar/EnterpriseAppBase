// =============================================================================
// The app's platform host: the ONE place the app's auth binds to the platform
// (issue #696, PP-2.7)
// =============================================================================
//
// Every packaged controller (`@marinoscar/platform-api/<slice>`) receives this
// host in its module's `forRoot({ host })` and applies `access.*` to its
// handlers. Both functions return the app's own `@Auth()`, so a packaged route
// gets exactly what a route of the app gets: `JwtAuthGuard` + `RolesGuard` +
// `PermissionsGuard`, the RBAC metadata the integration specs read, and the
// `x-rbac` OpenAPI extension the document builder renders.
//
// A packaged slice's permission string must exist in the app's RBAC
// (`common/constants/roles.constants.ts`); the cast below only widens the
// type, it never invents a permission. Recipe: packages/platform-api/src/core/README.md.
// =============================================================================

import { definePlatformHost } from '@marinoscar/platform-api/core';

import { Auth } from '@marinoscar/platform-api/identity';
import type { PermissionName } from '../common/constants/roles.constants';

export const platformHost = definePlatformHost({
  access: {
    requirePermissions: (permissions) => Auth({ permissions: [...permissions] as PermissionName[] }),
    requireAuthenticated: () => Auth(),
  },
});

// =============================================================================
// Background job queue permissions (issue #676, PP-1.4)
// =============================================================================
//
// Pure data: this module's permissions and their default role grants. Imports
// only types and has no side effect; `common/permissions/permission.manifest.ts`
// registers it, and `common/constants/roles.constants.ts` derives `PERMISSIONS`
// from it. After a change, run `npm run catalog:permissions --workspace=api` and
// commit the regenerated `prisma/catalog/permissions.json`.
// Recipe: common/permissions/README.md.
// =============================================================================

import type { PermissionDeclarationMap } from '../common/permissions/permission.types';

// #256, epic #254 — ADMIN ONLY, including the read halves. Contributor and
// Viewer are deliberately left off: the queue, the fleet and the backup
// history are operational surfaces, and a read there exposes job payload
// metadata, host names and the shape of the deployment's schedule. A later
// issue can widen a specific read to Contributor with an argument for that
// one surface; starting narrow is the direction that can be relaxed
// without a migration, since these are rows.
export const JOBS_PERMISSIONS = {
  // Jobs — the background queue (#256, epic #254)
  JOBS_READ: {
    id: 'jobs:read',
    description: 'View queued, running and completed jobs',
    defaultGrants: ['admin'],
  },
  JOBS_WRITE: {
    id: 'jobs:write',
    description: 'Enqueue, retry and cancel jobs',
    defaultGrants: ['admin'],
  },
} as const satisfies PermissionDeclarationMap;

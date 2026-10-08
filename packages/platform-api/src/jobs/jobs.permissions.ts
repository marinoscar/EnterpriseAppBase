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

/**
 * One permission the jobs slice declares, in the shape an app's
 * permission registry takes (structurally the reference app's
 * `PermissionDeclaration`).
 *
 * @typeParam Id - the permission string.
 *
 * @stability stable
 */
export interface JobsPermissionDeclaration<Id extends string = string> {
  /** `'<resource>:<action>'`: the exact string the slice's routes enforce. */
  readonly id: Id;
  /** Seeded into `permissions.description`. */
  readonly description: string;
  /** `'system'`: these operate the deployment, never one organization. */
  readonly scope: 'system' | 'org';
  /** Role ids seeded into `role_permissions`; the seed only adds grants. */
  readonly defaultGrants: readonly string[];
}

// #256, epic #254 — ADMIN ONLY, including the read halves. Contributor and
// Viewer are deliberately left off: the queue, the fleet and the backup
// history are operational surfaces, and a read there exposes job payload
// metadata, host names and the shape of the deployment's schedule. A later
// issue can widen a specific read to Contributor with an argument for that
// one surface; starting narrow is the direction that can be relaxed
// without a migration, since these are rows.
/**
 * The jobs slice's permissions, keyed by the `PERMISSIONS` constant name the
 * reference app derives from them. System scope, granted to `admin`. Register
 * them with the app's permission registry.
 *
 * @example
 * ```ts
 * registerPermissions(JOBS_PERMISSIONS);
 * ```
 *
 * @stability stable
 */
export const JOBS_PERMISSIONS: {
  /** `jobs:read`: view queued, running and completed jobs. */
  readonly JOBS_READ: JobsPermissionDeclaration<'jobs:read'>;
  /** `jobs:write`: enqueue, retry and cancel jobs. */
  readonly JOBS_WRITE: JobsPermissionDeclaration<'jobs:write'>;
} = {
  // Jobs — the background queue (#256, epic #254)
  JOBS_READ: {
    id: 'jobs:read',
    description: 'View queued, running and completed jobs',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  JOBS_WRITE: {
    id: 'jobs:write',
    description: 'Enqueue, retry and cancel jobs',
    scope: 'system',
    defaultGrants: ['admin'],
  },
};

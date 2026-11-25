// =============================================================================
// Worker node permissions (issue #676, PP-1.4)
// =============================================================================
//
// Pure data: this module's permissions and their default role grants. Imports
// only types and has no side effect; the manifest slice (`registerPlatformPermissions()`)
// registers it, and `common/constants/roles.constants.ts` derives `PERMISSIONS`
// from it. After a change, run `npm run catalog:permissions --workspace=api` and
// commit the regenerated `prisma/catalog/permissions.json`.
// Recipe: common/permissions/README.md.
// =============================================================================

import type { PermissionDeclaration } from '../core/index';

/**
 * One permission this slice declares: core's `PermissionDeclaration`, the
 * entry type of the permission registry (`registerPermissions`).
 *
 * @typeParam Id - the permission string.
 *
 * @stability stable
 */
export type NodesPermissionDeclaration<Id extends string = string> = PermissionDeclaration<Id>;

// Default grants: ADMIN ONLY, including the read half, for the reason given on
// `JOBS_PERMISSIONS` in `jobs/jobs.permissions.ts` (#256, epic #254: the queue,
// the fleet and the backup history are operational surfaces).
/**
 * The nodes slice's permissions, keyed by the `PERMISSIONS` constant name the
 * reference app derives from them. System scope, granted to `admin`. Register
 * them with the app's permission registry.
 *
 * @example
 * ```ts
 * registerPermissions(NODES_PERMISSIONS);
 * ```
 *
 * @stability stable
 */
export const NODES_PERMISSIONS: {
  /** `nodes:read`: view worker nodes and their health. */
  readonly NODES_READ: NodesPermissionDeclaration<'nodes:read'>;
  /** `nodes:write`: register, drain and remove worker nodes. */
  readonly NODES_WRITE: NodesPermissionDeclaration<'nodes:write'>;
} = {
  // Worker nodes — the fleet that executes those jobs (#256, epic #254).
  //
  // DELIBERATELY SPLIT FROM `jobs:*`, not folded into it. The Settings UI
  // Pattern (CLAUDE.md rule 3) requires a card's `permission` to be the exact
  // string the API controller enforces, so a Workers card gated on `jobs:read`
  // would be advertising a permission the nodes controller never checks — the
  // hub would hide or show the card on evidence unrelated to whether the
  // request behind it will be authorized. The two are also genuinely different
  // questions: "what work is queued" is operational, "which machines are
  // attached to this deployment" is closer to infrastructure inventory, and a
  // deployment may well want to grant one without the other.
  NODES_READ: {
    id: 'nodes:read',
    description: 'View worker nodes and their health',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  NODES_WRITE: {
    id: 'nodes:write',
    description: 'Register, drain and remove worker nodes',
    scope: 'system',
    defaultGrants: ['admin'],
  },
};

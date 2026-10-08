// =============================================================================
// Worker node permissions (issue #676, PP-1.4)
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
 * One permission the nodes slice declares, in the shape an app's
 * permission registry takes (structurally the reference app's
 * `PermissionDeclaration`).
 *
 * @typeParam Id - the permission string.
 *
 * @stability stable
 */
export interface NodesPermissionDeclaration<Id extends string = string> {
  /** `'<resource>:<action>'`: the exact string the slice's routes enforce. */
  readonly id: Id;
  /** Seeded into `permissions.description`. */
  readonly description: string;
  /** `'system'`: these operate the deployment, never one organization. */
  readonly scope: 'system' | 'org';
  /** Role ids seeded into `role_permissions`; the seed only adds grants. */
  readonly defaultGrants: readonly string[];
}

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
export const NODES_PERMISSIONS = {
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
} as const satisfies Record<string, NodesPermissionDeclaration>;

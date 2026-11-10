// =============================================================================
// The group-role registry (PP-14.15b): rung 2 of the extension contract
// =============================================================================
//
// A GROUP ROLE is what a member can do INSIDE a group: manage it, write the
// resources it owns, read them. The platform ships three, `admin`, `editor` and
// `viewer`; they register through `registerGroupRole` exactly as an app's role
// does (no private fast path). The database holds the role as text
// (`group_members.role`, `group_invites.role`), so an app adds `commenter` or
// `auditor` with one call and no migration.
//
// WHAT A ROLE IS MADE OF. `actions` lists what the role may do in the group.
// The platform knows three:
//
//   manage  administer the group: rename or delete it, add, change or remove
//           members, send and revoke invites; counts toward "the last manager"
//           guard, so a group is never left without one;
//   write   write the group's resources (rank 2);
//   read    read them (rank 1).
//
// Any other action is the app's own (`comment`): the platform stores it and
// `groupRoleCan(role, action)` answers it, but it grants nothing by itself.
// The role's RANK for `minGroupRole` filters is derived from the strongest
// platform action (`manage` 3, `write` 2, `read` 1, none 0).
//
// FAIL CLOSED. A role nobody registered is refused at the API (422
// `GROUP_ROLE_UNKNOWN`), ranks 0 and holds no action. A group-owned resource
// type decides what each role may do to ITS records with `groupRoleMap`; a role
// the map does not name gets NO access to them (only the three built-ins have a
// default mapping), so registering a role never widens access by itself.
// =============================================================================

import { SHARING_IDENTIFIER_PATTERN, SHARING_LIMITS, type GroupRoleDescriptor } from '@marinoscar/platform-contract/sharing';

import { defineRegistry } from '../core/index';

/**
 * The actions the platform itself understands in a group role's `actions`.
 *
 * @stability experimental
 */
export const GROUP_ROLE_PLATFORM_ACTIONS = ['manage', 'write', 'read'] as const;

/**
 * The ids the platform's own roles use. They are registered at import time.
 *
 * @stability experimental
 */
export const BUILTIN_GROUP_ROLE_IDS: readonly string[] = ['admin', 'editor', 'viewer'];

/** Ids no role may take: `owner` is the implicit resource role and would read as one. */
const RESERVED_ROLE_IDS: readonly string[] = ['owner'];

/** The rank each platform action gives a role. */
const ACTION_RANK: Readonly<Record<string, number>> = Object.freeze({ manage: 3, write: 2, read: 1 });

/**
 * One group role.
 *
 * @example
 * ```ts
 * registerGroupRole({
 *   id: 'commenter',
 *   label: 'Commenter',
 *   actions: ['read', 'comment'],
 * });
 * ```
 *
 * @stability experimental
 */
export interface GroupRoleDef {
  /** Stable id (`SHARING_IDENTIFIER_PATTERN`, lower-case snake_case). Permanent once members hold it. */
  readonly id: string;
  /** The label a role picker shows ("Commenter"). */
  readonly label: string;
  /** A sentence about what the role may do. */
  readonly description?: string;
  /**
   * What the role may do in the group: `manage`, `write`, `read` (see the
   * file header) and any action of the app's own. Lower-case snake_case.
   */
  readonly actions: readonly string[];
}

function check(condition: unknown, id: string, why: string): asserts condition {
  if (!condition) throw new Error(`group role "${id}": ${why}`);
}

function validateRole(def: GroupRoleDef): void {
  const id = typeof def?.id === 'string' ? def.id : '?';
  check(id.length <= SHARING_LIMITS.grantIdentifierMax, id, `the id must be at most ${SHARING_LIMITS.grantIdentifierMax} characters`);
  check(!RESERVED_ROLE_IDS.includes(id), id, `"${id}" is reserved ('owner' is the implicit resource role, never a group role)`);
  check(typeof def.label === 'string' && def.label.trim().length > 0, id, '`label` must be a non-empty string');
  check(def.description === undefined || typeof def.description === 'string', id, '`description` must be a string');
  check(Array.isArray(def.actions) && def.actions.length > 0, id, '`actions` must be a non-empty array');
  check(new Set(def.actions).size === def.actions.length, id, '`actions` must be unique');
  for (const action of def.actions) {
    check(typeof action === 'string' && SHARING_IDENTIFIER_PATTERN.test(action), id, `action ${JSON.stringify(action)} must be lower-case snake_case`);
  }
}

/**
 * The group roles. String ids, a duplicate-id error, registration order,
 * frozen after bootstrap (the core registry primitive). `admin`, `editor` and
 * `viewer` are registered when the sharing slice is imported.
 *
 * @stability experimental
 */
export const groupRoleRegistry = defineRegistry<GroupRoleDef>({
  name: 'sharing-group-roles',
  idOf: (def) => def.id,
  idPattern: SHARING_IDENTIFIER_PATTERN,
  validate: (def) => validateRole(def),
});

/**
 * Registers one group role. Call it at import time, before the application
 * bootstraps (an app's `app-registrations` module); register roles before the
 * resource types whose `groupRoleMap` names them.
 *
 * @param def - the role (the object is shallow-frozen, and so is its `actions` list).
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY` (the message names the
 *   role and the rule), `DUPLICATE_ID` or `FROZEN` (after bootstrap).
 *
 * @example
 * ```ts
 * registerGroupRole({ id: 'commenter', label: 'Commenter', actions: ['read', 'comment'] });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerGroupRole(def: GroupRoleDef): void {
  // Frozen at registration, actions included: a role is the app's decision at start-up, and the
  // manage check reads `actions` on every membership write.
  groupRoleRegistry.register(Object.freeze({ ...def, actions: Object.freeze([...(Array.isArray(def?.actions) ? def.actions : [])]) }));
}

/**
 * The registered role `id`, or `undefined`.
 *
 * @param id - a group role id.
 *
 * @stability experimental
 */
export function findGroupRole(id: string): GroupRoleDef | undefined {
  return typeof id === 'string' ? groupRoleRegistry.get(id) : undefined;
}

/**
 * The rank of a role: the strongest platform action it carries (`manage` 3,
 * `write` 2, `read` 1), or 0 for a role nobody registered or one with none.
 *
 * @param role - a role id.
 *
 * @stability experimental
 */
export function groupRoleRank(role: string | null | undefined): number {
  const def = role ? findGroupRole(role) : undefined;
  return def ? Math.max(0, ...def.actions.map((action) => ACTION_RANK[action] ?? 0)) : 0;
}

/**
 * Whether `role` is registered and carries `action`. An unregistered role can do nothing.
 *
 * @param role - a role id.
 * @param action - `manage`, `write`, `read` or an app action.
 *
 * @stability experimental
 */
export function groupRoleCan(role: string | null | undefined, action: string): boolean {
  const def = role ? findGroupRole(role) : undefined;
  return def !== undefined && def.actions.includes(action);
}

/**
 * The ids of the registered roles that can `manage` a group: what "the last
 * admin" guard and the orphaned-group check count.
 *
 * @stability experimental
 */
export function managerGroupRoleIds(): string[] {
  return groupRoleRegistry.list().filter((def) => def.actions.includes('manage')).map((def) => def.id);
}

/**
 * The registered roles, strongest first (ties in registration order).
 *
 * @stability experimental
 */
export function listGroupRoles(): GroupRoleDef[] {
  return groupRoleRegistry
    .list()
    .map((def, index) => ({ def, index }))
    .sort((a, b) => groupRoleRank(b.def.id) - groupRoleRank(a.def.id) || a.index - b.index)
    .map((entry) => entry.def);
}

/**
 * The descriptor `GET /api/sharing/group-roles` serves for `def`.
 *
 * @param def - the role.
 *
 * @stability experimental
 */
export function describeGroupRole(def: GroupRoleDef): GroupRoleDescriptor {
  return { id: def.id, label: def.label, description: def.description ?? null, actions: [...def.actions], builtin: BUILTIN_GROUP_ROLE_IDS.includes(def.id) };
}

// ---- the built-in roles: registered through the same call ---------------------------

const BUILTINS: readonly GroupRoleDef[] = [
  { id: 'admin', label: 'Admin', description: 'Manage the group, its members and invites; full rights on the resources it owns.', actions: ['read', 'write', 'manage'] },
  { id: 'editor', label: 'Editor', description: 'Write the resources the group owns.', actions: ['read', 'write'] },
  { id: 'viewer', label: 'Viewer', description: 'Read the resources the group owns.', actions: ['read'] },
];
for (const def of BUILTINS) {
  if (!groupRoleRegistry.has(def.id)) registerGroupRole(def);
}

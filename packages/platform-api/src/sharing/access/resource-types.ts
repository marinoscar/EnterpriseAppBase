// =============================================================================
// The resource-type registry (issue #729, PP-7.2): rung 2 of the extension
// contract
// =============================================================================
//
// An app makes one of its tables shareable with ONE call:
//
//   registerResourceType({
//     type: 'transcript',
//     roles: ['viewer', 'editor'],                 // weakest first; 'owner' is implicit
//     actions: { read: 'viewer', write: 'editor', share: 'owner', delete: 'owner' },
//     actionPermissions: { write: 'transcripts:write' },
//     ownership: 'user',
//     loadOwners: (ids, tx) => ...,                // one query for the whole batch
//   });
//
// and `AccessPolicy` (./access-policy.service.ts) then decides owner, group
// owner, grant and organization-default access for it, while the grants API
// (`/api/grants`) shares its records. The registry is the core registry
// primitive: string ids (permanent once grants exist, like a job type),
// a duplicate-id error, registration order, frozen after bootstrap.
//
// VALIDATED AT REGISTRATION, so a typo fails the process at start-up with a
// message naming the type, never on the first request that needs it.
//
// A type whose ownership includes `group` is ALSO registered in the
// group-owned-resource registry of #728 (`registerGroupOwnedResource`), with
// its `countOwnedByGroup`, so deleting a group that still owns such records is
// refused. An app does not register it twice.
// =============================================================================

import { GROUP_ROLES, SHARING_IDENTIFIER_PATTERN, type GroupRole } from '@marinoscar/platform-contract/sharing';

import { defineRegistry } from '../../core/index';
import { groupOwnedResourceRegistry, type ResourceOwner } from '../ownership';

/**
 * The app's Prisma transaction client, opaque to the slice: a resource type's
 * callbacks receive the client of the transaction the slice opened (scoped to
 * one organization, or the system bypass for the prune job) and cast it to
 * their own generated type.
 *
 * @stability experimental
 */
export type PrismaTx = unknown;

/**
 * Who owns one record, and its organization, as `loadOwners` returns it.
 *
 * @stability experimental
 */
export interface ResourceOwnerInfo {
  /** The owning user or group. */
  readonly owner: ResourceOwner;
  /** The record's organization. */
  readonly orgId: string;
}

/**
 * A record's label for notifications and "shared with me" lists.
 *
 * @stability experimental
 */
export interface ResourceDescription {
  /** A short title (user-typed: the slice escapes it wherever it renders it). */
  readonly title: string;
  /** The root-relative app path of the record (`/transcripts/<id>`). */
  readonly path?: string;
}

/**
 * The grantee kinds a type's `grantable` lists roles for.
 *
 * @stability experimental
 */
export type GrantableKind = 'user' | 'group' | 'link';

/**
 * One shareable resource type of the app.
 *
 * @typeParam TRole - the type's grantable roles.
 *
 * @stability stable
 */
export interface ResourceTypeDef<TRole extends string = string> {
  /** Stable id, permanent once grants exist, e.g. `'transcript'`, `'media_item'`, `'album'`: lower-case snake_case. */
  readonly type: string;
  /** Grantable roles, weakest first, e.g. `['viewer', 'editor']`. `'owner'` is implicit and never grantable. */
  readonly roles: readonly TRole[];
  /**
   * Minimum role per action, e.g. `{ read: 'viewer', write: 'editor', share: 'owner', delete: 'owner' }`.
   * `share` (what the grants API checks) defaults to `'owner'` when absent.
   */
  readonly actions: Readonly<Record<string, TRole | 'owner'>>;
  /** RBAC permission the principal must ALSO hold per action (kvox: `write` needs `'transcripts:write'`). */
  readonly actionPermissions?: Readonly<Record<string, string>>;
  /** Permission that grants an action regardless of ownership (MemoriaHub: `read` to `'media:read_any'`). */
  readonly bypassPermissions?: Readonly<Record<string, string>>;
  /** Who can own a record: a user, a group, or either. */
  readonly ownership: 'user' | 'group' | 'user_or_group';
  /**
   * Effective role of a member of the owning group, per group role. Default:
   * `admin` gets `'owner'`, `editor` the strongest role, `viewer` the weakest.
   */
  readonly groupRoleMap?: Readonly<Record<GroupRole, TRole | 'owner'>>;
  /**
   * The organization-wide default (Salesforce's OWD). `'private'` (default):
   * owner and grants only. `'org'`: every member of the record's organization
   * holds `orgRole`.
   */
  readonly defaultVisibility?: 'private' | 'org';
  /** The role `defaultVisibility: 'org'` gives every member of the organization. Required with `'org'`. */
  readonly orgRole?: TRole;
  /**
   * Roles allowed per grantee kind. Default: `user` and `group` get every
   * role; `link` gets none (link shares are off unless listed, #730).
   */
  readonly grantable?: { readonly user?: readonly TRole[]; readonly group?: readonly TRole[]; readonly link?: readonly TRole[] };
  /** Cap on the active grants of one record. Default 500. */
  readonly maxGrantsPerResource?: number;
  /** How a denial surfaces. Default `'not_found'` (kvox and MemoriaHub both hide existence). */
  readonly denyAs?: 'not_found' | 'forbidden';
  /**
   * Batch owner lookup: ONE query for the whole batch. Must return the owner
   * and organization of every id that exists; a missing id is treated as not
   * found.
   *
   * @param ids - the record ids (deduplicated, at most a few hundred).
   * @param tx - the transaction the slice opened.
   */
  loadOwners(ids: readonly string[], tx: PrismaTx): Promise<Map<string, ResourceOwnerInfo>>;
  /**
   * How many records a group owns. Required when `ownership` includes
   * `group`: it feeds the group-deletion guard of #728.
   *
   * @param groupId - the group about to be deleted.
   * @param tx - the deleting transaction.
   */
  countOwnedByGroup?(groupId: string, tx: PrismaTx): Promise<number>;
  /**
   * Optional labels for notifications and "shared with me" lists.
   *
   * @param ids - the record ids.
   * @param tx - the transaction the slice opened.
   */
  describe?(ids: readonly string[], tx: PrismaTx): Promise<Map<string, ResourceDescription>>;
}

/** The default cap on the active grants of one record. */
export const DEFAULT_MAX_GRANTS_PER_RESOURCE = 500;

/** The largest cap a type may declare. */
const MAX_GRANTS_CEILING = 10_000;

function check(condition: unknown, type: string, why: string): asserts condition {
  if (!condition) throw new Error(`resource type "${type}": ${why}`);
}

function validateDef(def: ResourceTypeDef): void {
  const type = typeof def?.type === 'string' ? def.type : '?';
  check(Array.isArray(def.roles) && def.roles.length > 0, type, '`roles` must be a non-empty array (weakest first)');
  check(new Set(def.roles).size === def.roles.length, type, '`roles` must be unique');
  for (const role of def.roles) {
    check(typeof role === 'string' && SHARING_IDENTIFIER_PATTERN.test(role), type, `role ${JSON.stringify(role)} must be lower-case snake_case`);
    check(role !== 'owner', type, "'owner' is implicit and never a grantable role");
  }
  const known = (value: unknown): boolean => value === 'owner' || (def.roles as readonly unknown[]).includes(value);
  const knownRole = (value: unknown): boolean => (def.roles as readonly unknown[]).includes(value);

  check(def.actions !== null && typeof def.actions === 'object', type, '`actions` must be an object');
  const actions = Object.keys(def.actions);
  check(actions.length > 0, type, '`actions` must name at least one action');
  for (const action of actions) {
    check(SHARING_IDENTIFIER_PATTERN.test(action), type, `action ${JSON.stringify(action)} must be lower-case snake_case`);
    check(known(def.actions[action]), type, `action "${action}" needs ${JSON.stringify(def.actions[action])}, which is neither a role of the type nor 'owner'`);
  }
  for (const [name, map] of [['actionPermissions', def.actionPermissions], ['bypassPermissions', def.bypassPermissions]] as const) {
    if (map === undefined) continue;
    check(map !== null && typeof map === 'object', type, `\`${name}\` must be an object`);
    for (const [action, permission] of Object.entries(map)) {
      check(action === 'share' || actions.includes(action), type, `\`${name}\` names action "${action}", which \`actions\` does not declare`);
      check(typeof permission === 'string' && permission.length > 0, type, `\`${name}.${action}\` must be a permission string`);
    }
  }
  check(['user', 'group', 'user_or_group'].includes(def.ownership), type, "`ownership` must be 'user', 'group' or 'user_or_group'");
  if (def.groupRoleMap !== undefined) {
    for (const [groupRole, role] of Object.entries(def.groupRoleMap)) {
      check((GROUP_ROLES as readonly string[]).includes(groupRole), type, `\`groupRoleMap\` key "${groupRole}" is not a group role`);
      check(known(role), type, `\`groupRoleMap.${groupRole}\` is ${JSON.stringify(role)}, neither a role of the type nor 'owner'`);
    }
  }
  check(def.defaultVisibility === undefined || ['private', 'org'].includes(def.defaultVisibility), type, "`defaultVisibility` must be 'private' or 'org'");
  if (def.orgRole !== undefined) check(knownRole(def.orgRole), type, `\`orgRole\` ${JSON.stringify(def.orgRole)} is not a role of the type`);
  if (def.defaultVisibility === 'org') check(def.orgRole !== undefined, type, "`defaultVisibility: 'org'` needs `orgRole`");
  if (def.grantable !== undefined) {
    for (const [kind, roles] of Object.entries(def.grantable)) {
      check(['user', 'group', 'link'].includes(kind), type, `\`grantable\` key "${kind}" is not a grantee kind`);
      check(Array.isArray(roles), type, `\`grantable.${kind}\` must be an array`);
      for (const role of roles as readonly unknown[]) check(knownRole(role), type, `\`grantable.${kind}\` lists ${JSON.stringify(role)}, which is not a role of the type`);
    }
  }
  if (def.maxGrantsPerResource !== undefined) {
    check(
      Number.isSafeInteger(def.maxGrantsPerResource) && def.maxGrantsPerResource >= 1 && def.maxGrantsPerResource <= MAX_GRANTS_CEILING,
      type,
      `\`maxGrantsPerResource\` must be an integer in 1..${MAX_GRANTS_CEILING}`,
    );
  }
  check(def.denyAs === undefined || ['not_found', 'forbidden'].includes(def.denyAs), type, "`denyAs` must be 'not_found' or 'forbidden'");
  check(typeof def.loadOwners === 'function', type, '`loadOwners` must be a function');
  if (def.ownership !== 'user') {
    check(typeof def.countOwnedByGroup === 'function', type, `ownership '${def.ownership}' needs \`countOwnedByGroup\` (the group-deletion guard)`);
  }
  check(def.describe === undefined || typeof def.describe === 'function', type, '`describe` must be a function');
}

/**
 * The shareable resource types. String ids, a duplicate-id error,
 * registration order, frozen after bootstrap (the core registry primitive).
 *
 * @stability experimental
 */
export const resourceTypeRegistry = defineRegistry<ResourceTypeDef>({
  name: 'sharing-resource-types',
  idOf: (def) => def.type,
  idPattern: SHARING_IDENTIFIER_PATTERN,
  validate: (def) => validateDef(def),
});

/**
 * Registers one shareable resource type. Call it at import time, before the
 * application bootstraps (an app's `app-registrations` module).
 *
 * A type whose ownership includes `group` is also registered as a
 * group-owned resource (`registerGroupOwnedResource`, #728) unless the app
 * already did.
 *
 * @param def - the resource type.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY` (the message names the
 *   type and the rule), `DUPLICATE_ID` or `FROZEN` (after bootstrap).
 *
 * @example
 * ```ts
 * registerResourceType({
 *   type: 'transcript',
 *   roles: ['viewer', 'editor'],
 *   actions: { read: 'viewer', write: 'editor', share: 'owner', delete: 'owner' },
 *   actionPermissions: { write: 'transcripts:write' },
 *   ownership: 'user',
 *   async loadOwners(ids, tx) {
 *     const rows = await (tx as Prisma.TransactionClient).transcript.findMany({
 *       where: { id: { in: [...ids] } },
 *       select: { id: true, orgId: true, ownerUserId: true },
 *     });
 *     return new Map(rows.map((r) => [r.id, { orgId: r.orgId, owner: { kind: 'user', userId: r.ownerUserId } }]));
 *   },
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability stable
 */
export function registerResourceType<TRole extends string>(def: ResourceTypeDef<TRole>): void {
  const entry = def as unknown as ResourceTypeDef;
  resourceTypeRegistry.register(entry);
  if (entry.ownership !== 'user' && !groupOwnedResourceRegistry.has(entry.type)) {
    const count = entry.countOwnedByGroup!;
    groupOwnedResourceRegistry.register({ type: entry.type, countOwnedByGroup: (groupId, tx) => count.call(entry, groupId, tx) });
  }
}

/**
 * A registered type with its defaults applied and its rules precomputed.
 * Internal to the slice.
 */
export interface ResolvedResourceType {
  readonly def: ResourceTypeDef;
  readonly type: string;
  readonly roles: readonly string[];
  readonly denyAs: 'not_found' | 'forbidden';
  readonly maxGrantsPerResource: number;
  readonly defaultVisibility: 'private' | 'org';
  readonly orgRole: string | null;
  /** Rank of a role: 0 unknown, 1 the weakest, roles.length + 1 for 'owner'. */
  rank(role: string | null | undefined): number;
  /** The role an action needs, or `undefined` for an action the type does not declare. */
  required(action: string): string | undefined;
  /** The role a member of the owning group holds. */
  groupRole(groupRole: string): string | null;
  /** The roles grantable to a grantee kind. */
  grantable(kind: GrantableKind): readonly string[];
  /** The roles at or above `minRole` (owner excluded), weakest first. */
  rolesAtLeast(minRole: string | undefined): readonly string[];
}

const resolved = new WeakMap<ResourceTypeDef, ResolvedResourceType>();

/** Applies the defaults to a registered definition (memoised per definition object). */
export function resolveResourceType(def: ResourceTypeDef): ResolvedResourceType {
  const cached = resolved.get(def);
  if (cached) return cached;
  const roles = [...def.roles];
  const ownerRank = roles.length + 1;
  const rank = (role: string | null | undefined): number => {
    if (role === 'owner') return ownerRank;
    const index = role ? roles.indexOf(role) : -1;
    return index + 1;
  };
  const groupRoleMap: Record<string, string> = {
    admin: 'owner',
    editor: roles[roles.length - 1]!,
    viewer: roles[0]!,
    ...(def.groupRoleMap ?? {}),
  };
  const grantable = {
    user: [...(def.grantable?.user ?? roles)],
    group: [...(def.grantable?.group ?? roles)],
    link: [...(def.grantable?.link ?? [])],
  };
  const actions: Record<string, string> = { share: 'owner', ...def.actions };
  const value: ResolvedResourceType = Object.freeze({
    def,
    type: def.type,
    roles,
    denyAs: def.denyAs ?? 'not_found',
    maxGrantsPerResource: def.maxGrantsPerResource ?? DEFAULT_MAX_GRANTS_PER_RESOURCE,
    defaultVisibility: def.defaultVisibility ?? 'private',
    orgRole: def.orgRole ?? null,
    rank,
    required: (action: string) => (Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : undefined),
    groupRole: (groupRole: string) => groupRoleMap[groupRole] ?? null,
    grantable: (kind: GrantableKind) => grantable[kind],
    rolesAtLeast: (minRole: string | undefined) => (minRole === undefined ? roles : roles.filter((role) => rank(role) >= rank(minRole))),
  });
  resolved.set(def, value);
  return value;
}

/**
 * The registered type `type`, resolved, or `undefined`.
 *
 * @param type - a resource type id.
 */
export function findResourceType(type: string): ResolvedResourceType | undefined {
  const def = resourceTypeRegistry.get(type);
  return def ? resolveResourceType(def) : undefined;
}

/**
 * The registered type `type`, resolved. An unknown type is a PROGRAMMING
 * error (a 500), never a 404: the code asked about a type nobody registered.
 *
 * @param type - a resource type id.
 * @throws Error naming the type.
 */
export function requireResourceType(type: string): ResolvedResourceType {
  const found = findResourceType(type);
  if (!found) {
    throw new Error(`Unknown resource type "${type}": register it with registerResourceType() before the application bootstraps.`);
  }
  return found;
}

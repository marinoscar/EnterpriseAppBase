// =============================================================================
// Resources owned by a user or by a group (issue #728, PP-7.1)
// =============================================================================
//
// THE COLUMN CONVENTION for an app table whose rows a group can own (the full
// guide is the README, completed in #732):
//
//   owner_user_id  uuid NULL REFERENCES users(id),
//   owner_group_id uuid NULL REFERENCES groups(id) ON DELETE RESTRICT,
//   CHECK (num_nonnulls(owner_user_id, owner_group_id) = 1)
//
// `ON DELETE RESTRICT` is the database's half of the deletion rule; the
// group-owned-resource registry below is the API's half: `DELETE
// /api/groups/:id` counts every registered resource type first and answers 409
// `GROUP_OWNS_RESOURCES` with the counts, instead of a foreign-key error.
//
// "All circles I am a member of" (MemoriaHub's cross-circle queries) becomes
// `where: ownedByMeOrMyGroups(principal, fields)` with a principal the
// `PrincipalGroupsProvider` enriched.
// =============================================================================

import { GROUP_ROLES, type GroupRole } from '@marinoscar/platform-contract/sharing';

import { defineRegistry, type GroupMembership, type Principal } from '../core/index';

/**
 * Who owns a record: exactly one user or exactly one group.
 *
 * @stability experimental
 * @example
 * ```ts
 * const owner: ResourceOwner = album.ownerGroupId
 *   ? { kind: 'group', groupId: album.ownerGroupId }
 *   : { kind: 'user', userId: album.ownerUserId! };
 * ```
 */
export type ResourceOwner =
  | {
      /** Owned by one user. */
      kind: 'user';
      /** The owner. */
      userId: string;
    }
  | {
      /** Owned by one group. */
      kind: 'group';
      /** The owning group. */
      groupId: string;
    };

/**
 * One app resource type whose rows a group can own. Registered once, at
 * import time, before the application bootstraps.
 *
 * @stability experimental
 */
export interface GroupOwnedResourceDef {
  /** Stable id, permanent like a job type string, e.g. `'media_item'`: lower-case snake_case. */
  readonly type: string;
  /**
   * How many rows this group owns; used to refuse group deletion. Runs inside
   * the deleting transaction, on the client scoped to the group's
   * organization (row-level security applies).
   *
   * @param groupId - the group about to be deleted.
   * @param tx - the app's Prisma transaction client.
   */
  countOwnedByGroup(groupId: string, tx: unknown): Promise<number>;
}

/** Resource type ids: lower-case snake_case, like a table name. */
const RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * The resource types a group can own. String ids, a duplicate-id error,
 * registration order, frozen after bootstrap (the core registry primitive).
 * #729 registers resource types into it automatically.
 *
 * @stability experimental
 */
export const groupOwnedResourceRegistry = defineRegistry<GroupOwnedResourceDef>({
  name: 'sharing-group-owned-resources',
  idOf: (def) => def.type,
  idPattern: RESOURCE_TYPE_PATTERN,
  validate: (def) => {
    if (typeof def.countOwnedByGroup !== 'function') throw new Error('countOwnedByGroup must be a function');
  },
});

/**
 * Registers one resource type a group can own, so deleting a group that still
 * owns such rows is refused with `409 GROUP_OWNS_RESOURCES`.
 *
 * @param def - the resource type.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN` (after bootstrap).
 *
 * @example
 * ```ts
 * registerGroupOwnedResource({
 *   type: 'album',
 *   countOwnedByGroup: (groupId, tx) => (tx as Prisma.TransactionClient).album.count({ where: { ownerGroupId: groupId } }),
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerGroupOwnedResource(def: GroupOwnedResourceDef): void {
  groupOwnedResourceRegistry.register(def);
}

/** Rank of a group role: admin 3, editor 2, viewer 1. */
const RANK: Readonly<Record<GroupRole, number>> = Object.freeze({ admin: 3, editor: 2, viewer: 1 });

/**
 * The rank of a group role (`admin` 3, `editor` 2, `viewer` 1; anything else 0).
 *
 * @param role - a role name.
 * @returns the rank.
 *
 * @stability experimental
 */
export function groupRoleRank(role: string | null | undefined): number {
  return role && (GROUP_ROLES as readonly string[]).includes(role) ? RANK[role as GroupRole] : 0;
}

/**
 * Whether `role` is at least `minimum`.
 *
 * @param role - the held role.
 * @param minimum - the role required.
 * @returns true when `role` ranks at or above `minimum`.
 *
 * @stability experimental
 */
export function groupRoleAtLeast(role: string | null | undefined, minimum: GroupRole): boolean {
  return groupRoleRank(role) >= RANK[minimum];
}

/**
 * The groups of `principal`'s ACTIVE organization, optionally narrowed to a
 * minimum role. Reads `principal.groups`, which `PrincipalGroupsProvider.enrich`
 * fills; an unenriched principal has none.
 *
 * @param principal - the caller, enriched.
 * @param minGroupRole - the least role to count.
 * @returns the memberships.
 *
 * @stability experimental
 */
export function activeGroupsOf(principal: Principal, minGroupRole?: GroupRole): GroupMembership[] {
  const org = principal.activeOrgId;
  return (principal.groups ?? []).filter(
    (group) => (org === undefined || group.orgId === org) && (minGroupRole === undefined || groupRoleAtLeast(group.role, minGroupRole)),
  );
}

/**
 * A Prisma `where` fragment: rows owned by the caller, or by any group of the
 * active organization the caller belongs to (optionally with at least
 * `opts.minGroupRole`). Give it a principal the `PrincipalGroupsProvider`
 * enriched; without groups it is `{ [ownerUserField]: userId }`.
 *
 * @param principal - the caller, enriched with its groups.
 * @param fields - the model's owner fields (`ownerUserField`, `ownerGroupField`).
 * @param opts - `minGroupRole`: only groups where the caller holds at least this role.
 * @returns the `where` fragment.
 *
 * @example
 * ```ts
 * const me = await principalGroups.enrich(principal);
 * const albums = await tx.album.findMany({
 *   where: ownedByMeOrMyGroups(me, { ownerUserField: 'ownerUserId', ownerGroupField: 'ownerGroupId' }),
 * });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function ownedByMeOrMyGroups(
  principal: Principal,
  fields: { ownerUserField: string; ownerGroupField: string },
  opts?: { minGroupRole?: GroupRole },
): Record<string, unknown> {
  const mine = { [fields.ownerUserField]: principal.userId };
  const groupIds = [...new Set(activeGroupsOf(principal, opts?.minGroupRole).map((group) => group.groupId))];
  if (groupIds.length === 0) return mine;
  return { OR: [mine, { [fields.ownerGroupField]: { in: groupIds } }] };
}

/**
 * The `where` fragment selecting exactly `owner`'s rows.
 *
 * @param owner - the owner.
 * @param fields - the model's owner fields.
 * @returns `{ [ownerUserField]: userId }` or `{ [ownerGroupField]: groupId }`.
 *
 * @stability experimental
 */
export function ownerWhere(owner: ResourceOwner, fields: { ownerUserField: string; ownerGroupField: string }): Record<string, unknown> {
  return owner.kind === 'user' ? { [fields.ownerUserField]: owner.userId } : { [fields.ownerGroupField]: owner.groupId };
}

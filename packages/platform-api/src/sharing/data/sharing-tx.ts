// =============================================================================
// The data the sharing slice reads and writes, structurally (issue #728)
// =============================================================================
//
// The slice never imports a generated Prisma client: the app's client (and
// its interactive transaction client) satisfies these structural shapes, so
// the package compiles without the app's schema and works with any app that
// composed the `sharing` fragment of `@marinoscar/platform-db`.
//
// Every table here except `users`, `memberships` and `org_invites` is an `org`
// table under FORCEd row-level security: it is only ever reached through a
// transaction the host's `SharingDataPort` opened in one organization's scope
// (or the system bypass, for the purge and the Doctor).
//
// NOT EXPORTED from the slice: internal to `@marinoscar/platform-api/sharing`.
// =============================================================================

import type { GroupRole } from '@marinoscar/platform-contract/sharing';

/** Prisma query arguments; the slice builds them, the client checks them. */
export type QueryArgs = Record<string, unknown>;

/** One Prisma model delegate, as the slice calls it. */
export interface Delegate<Row> {
  findUnique<T = Row>(args: QueryArgs): Promise<T | null>;
  findFirst<T = Row>(args: QueryArgs): Promise<T | null>;
  findMany<T = Row>(args: QueryArgs): Promise<T[]>;
  count(args?: QueryArgs): Promise<number>;
  create<T = Row>(args: QueryArgs): Promise<T>;
  update<T = Row>(args: QueryArgs): Promise<T>;
  updateMany(args: QueryArgs): Promise<{ count: number }>;
  delete<T = Row>(args: QueryArgs): Promise<T>;
  deleteMany(args?: QueryArgs): Promise<{ count: number }>;
  /** `GROUP BY` in SQL (unlike `distinct`, which Prisma applies in memory), so `take` bounds the query. */
  groupBy<T = Record<string, unknown>>(args: QueryArgs): Promise<T[]>;
}

/**
 * A `groups` row.
 *
 * @stability experimental
 */
export interface GroupRow {
  /** The group's id. */
  id: string;
  /** Its organization. */
  orgId: string;
  /** Display name. */
  name: string;
  /** Description, or `null`. */
  description: string | null;
  /** App-defined JSON, or `null`. */
  metadata: unknown;
  /** Who created it, or `null`. */
  createdById: string | null;
  /** Optimistic-concurrency version. */
  version: number;
  /** When it was created. */
  createdAt: Date;
  /** When it last changed. */
  updatedAt: Date;
}

/** A `group_members` row. */
export interface GroupMemberRow {
  id: string;
  groupId: string;
  userId: string;
  orgId: string;
  role: GroupRole;
  addedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A `group_invites` row. */
export interface GroupInviteRow {
  id: string;
  groupId: string;
  orgId: string;
  email: string;
  role: GroupRole;
  invitedById: string | null;
  expiresAt: Date | null;
  acceptedAt: Date | null;
  acceptedById: string | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** The `users` columns the slice reads. */
export interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  providerDisplayName: string | null;
  isActive: boolean;
}

/** The `memberships` columns the slice reads (identity; no row-level security). */
export interface OrgMembershipRow {
  orgId: string;
  userId: string;
  status: string;
}

/** The `org_invites` columns the slice reads (identity; no row-level security). */
export interface OrgInviteRow {
  orgId: string;
  email: string;
  status: string;
  expiresAt: Date | null;
}

/**
 * A `grants` row (#729).
 *
 * @stability experimental
 */
export interface GrantRow {
  /** The grant's id. */
  id: string;
  /** The organization of the shared record. */
  orgId: string;
  /** The registered resource type. */
  resourceType: string;
  /** The shared record. */
  resourceId: string;
  /** `user`, `group` or `link`. */
  granteeKind: 'user' | 'group' | 'link';
  /** The user grantee, or `null`. */
  granteeUserId: string | null;
  /** The group grantee, or `null`. */
  granteeGroupId: string | null;
  /** One of the type's roles. */
  role: string;
  /** Link grants only (#730): SHA-256 of the token. */
  linkTokenHash: string | null;
  /** Link grants only (#730): the token, encrypted. */
  linkTokenCiphertext: string | null;
  /** Link grants only (#730): a label. */
  linkLabel: string | null;
  /** When it stops working, or `null`. */
  expiresAt: Date | null;
  /** When it was revoked, or `null`. */
  revokedAt: Date | null;
  /** Who revoked it, or `null`. */
  revokedById: string | null;
  /** Who granted it, or `null`. */
  grantedById: string | null;
  /** App-defined JSON, or `null`. */
  metadata: unknown;
  /** When it was created. */
  createdAt: Date;
  /** When it last changed. */
  updatedAt: Date;
}

/**
 * A raw SQL fragment as Prisma's `$queryRaw` takes it (`Prisma.Sql`), seen
 * structurally.
 */
export interface SqlLike {
  readonly sql: string;
  readonly values: readonly unknown[];
  readonly strings: readonly string[];
}

/**
 * The transaction client the slice works with: the app's Prisma transaction
 * client, seen structurally.
 */
export interface SharingTx {
  group: Delegate<GroupRow>;
  groupMember: Delegate<GroupMemberRow>;
  groupInvite: Delegate<GroupInviteRow>;
  grant: Delegate<GrantRow>;
  user: Delegate<UserRow>;
  membership: Delegate<OrgMembershipRow>;
  invite: Delegate<OrgInviteRow>;
  auditEvent: { create(args: QueryArgs): Promise<unknown> };
  $queryRaw<T = unknown>(query: TemplateStringsArray | SqlLike, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray | SqlLike, ...values: unknown[]): Promise<number>;
}

/** Narrows the `unknown` transaction client a host port hands out. */
export function asSharingTx(tx: unknown): SharingTx {
  return tx as SharingTx;
}

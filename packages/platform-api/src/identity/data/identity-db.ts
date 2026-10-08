// =============================================================================
// The data the identity slice reads and writes, structurally (issue #727)
// =============================================================================
//
// The slice never imports a generated Prisma client, not even its types: a
// package is built, type-checked and tested before (and without) any app's
// `prisma generate`, and it must work with any app that composed the
// `identity` fragment of `@marinoscar/platform-db`. Same rule as core
// (`core/data-access/scoped-client.ts`) and the sharing slice
// (`sharing/data/sharing-tx.ts`).
//
// So the identity tables are declared here as plain row types, and the client
// as a set of structural model delegates. Every delegate method is generic in
// its result (`findUnique<T = Row>`): a call that `include`s or `select`s
// names the shape it reads, and the client (the app's generated one at run
// time) checks the query arguments. The app hands its own client to the core
// port `PLATFORM_PRISMA`; Nest injection is untyped, so no cast is needed at
// the binding, and an app call site that passes its client to a slice
// function says so once (`apps/api/src/platform/identity/identity-db.ts`).
//
// The row types mirror the identity fragment's columns
// (`apps/api/prisma/schema/platform.identity.prisma`); relations are not part
// of a row, a call that loads one declares it on its result type.
// =============================================================================

import type {
  DeviceSessionStatus,
  OrgInviteStatus,
  OrgMemberStatus,
  PatDurationUnitValue,
} from '@marinoscar/platform-contract/identity';

// ---- values ---------------------------------------------------------------------------

/**
 * A JSON value as a JSONB column stores and returns it.
 *
 * @stability experimental
 */
export type IdentityJsonValue =
  | string
  | number
  | boolean
  | null
  | IdentityJsonValue[]
  | { [key: string]: IdentityJsonValue };

/**
 * The scope of a role or a permission: a SYSTEM grant (`user_roles`) or an
 * ORG grant (a membership's role).
 *
 * @stability experimental
 */
export type IdentityRoleScope = 'system' | 'org';

/**
 * The statuses of a device authorization code: the `DeviceCodeStatus` enum.
 *
 * @stability experimental
 */
export const DEVICE_CODE_STATUS = {
  /** Issued, waiting for the user's decision. */
  pending: 'pending',
  /** Approved by the user. */
  approved: 'approved',
  /** Denied by the user. */
  denied: 'denied',
  /** Expired, or collected by the device. */
  expired: 'expired',
} as const satisfies Record<DeviceSessionStatus, DeviceSessionStatus>;

// ---- rows -----------------------------------------------------------------------------

/**
 * A `users` row.
 *
 * @stability experimental
 */
export interface IdentityUserRow {
  /** The user's id. */
  id: string;
  /** The (lower-cased) email. */
  email: string;
  /** The display name the user chose, or `null`. */
  displayName: string | null;
  /** The display name the identity provider reported, or `null`. */
  providerDisplayName: string | null;
  /** The uploaded profile image URL, or `null`. */
  profileImageUrl: string | null;
  /** The identity provider's profile image URL, or `null`. */
  providerProfileImageUrl: string | null;
  /** Whether the account may sign in. */
  isActive: boolean;
  /** When the user was created. */
  createdAt: Date;
  /** When the row last changed. */
  updatedAt: Date;
}

/**
 * A `user_identities` row: one provider identity of a user.
 *
 * @stability experimental
 */
export interface IdentityUserIdentityRow {
  /** The row's id. */
  id: string;
  /** The user. */
  userId: string;
  /** The provider (`google`). */
  provider: string;
  /** The provider's subject id. */
  providerSubject: string;
  /** The email the provider reported, or `null`. */
  providerEmail: string | null;
  /** When it was linked. */
  createdAt: Date;
}

/**
 * A `roles` row.
 *
 * @stability experimental
 */
export interface IdentityRoleRow {
  /** The role's id. */
  id: string;
  /** The role name (`admin`, `viewer`, ...). */
  name: string;
  /** Its description, or `null`. */
  description: string | null;
  /** `system` or `org`. */
  scope: IdentityRoleScope;
}

/**
 * A `permissions` row.
 *
 * @stability experimental
 */
export interface IdentityPermissionRow {
  /** The permission's id. */
  id: string;
  /** The permission string (`users:read`). */
  name: string;
  /** Its description, or `null`. */
  description: string | null;
  /** `system` or `org`. */
  scope: IdentityRoleScope;
}

/**
 * A `user_roles` row: one SYSTEM role of a user.
 *
 * @stability experimental
 */
export interface IdentityUserRoleRow {
  /** The user. */
  userId: string;
  /** The role. */
  roleId: string;
}

/**
 * An `audit_events` row.
 *
 * @stability experimental
 */
export interface IdentityAuditEventRow {
  /** The event's id. */
  id: string;
  /** Who acted, or `null` for the system. */
  actorUserId: string | null;
  /** The action (`user:roles_updated`). */
  action: string;
  /** The target's kind. */
  targetType: string;
  /** The target's id. */
  targetId: string;
  /** Event details, or `null`. */
  meta: IdentityJsonValue | null;
  /** The organization it happened in, or `null`. */
  orgId: string | null;
  /** When it happened. */
  createdAt: Date;
}

/**
 * A `refresh_tokens` row.
 *
 * @stability experimental
 */
export interface IdentityRefreshTokenRow {
  /** The row's id. */
  id: string;
  /** The user. */
  userId: string;
  /** SHA-256 of the token; the token itself is never stored. */
  tokenHash: string;
  /** When it expires. */
  expiresAt: Date;
  /** When it was issued. */
  createdAt: Date;
  /** When it was revoked, or `null`. */
  revokedAt: Date | null;
  /** The device session that minted it, or `null`. */
  deviceCodeId: string | null;
  /** The organization it is bound to, or `null`. */
  orgId: string | null;
}

/**
 * A `personal_access_tokens` row.
 *
 * @stability experimental
 */
export interface IdentityPersonalAccessTokenRow {
  /** The token's id. */
  id: string;
  /** The owner. */
  userId: string;
  /** Its name. */
  name: string;
  /** SHA-256 of the token; the token itself is never stored. */
  tokenHash: string;
  /** The displayable prefix. */
  tokenPrefix: string;
  /** The lifetime, in `durationUnit`. */
  durationValue: number;
  /** The lifetime's unit. */
  durationUnit: PatDurationUnitValue;
  /** When it expires. */
  expiresAt: Date;
  /** When it was last used, or `null`. */
  lastUsedAt: Date | null;
  /** When it was created. */
  createdAt: Date;
  /** When it was revoked, or `null`. */
  revokedAt: Date | null;
  /** The organization it is bound to, or `null`. */
  orgId: string | null;
}

/**
 * An `allowed_emails` row.
 *
 * @stability experimental
 */
export interface IdentityAllowedEmailRow {
  /** The entry's id. */
  id: string;
  /** The (lower-cased) email. */
  email: string;
  /** Who added it, or `null`. */
  addedById: string | null;
  /** When it was added. */
  addedAt: Date;
  /** The user who signed in with it, or `null`. */
  claimedById: string | null;
  /** When it was claimed, or `null`. */
  claimedAt: Date | null;
  /** Notes, or `null`. */
  notes: string | null;
}

/**
 * A `device_codes` row.
 *
 * @stability experimental
 */
export interface IdentityDeviceCodeRow {
  /** The session's id. */
  id: string;
  /** The device code the device polls with. */
  deviceCode: string;
  /** The code the user types. */
  userCode: string;
  /** The approving user, or `null`. */
  userId: string | null;
  /** Its status. */
  status: DeviceSessionStatus;
  /** What the device reported about itself, or `null`. */
  clientInfo: IdentityJsonValue | null;
  /** The requested scopes. */
  scopes: string[];
  /** When the code expires. */
  expiresAt: Date;
  /** When it was issued. */
  createdAt: Date;
  /** When the row last changed. */
  updatedAt: Date;
  /** The PAT it minted, or `null`. */
  patId: string | null;
  /** When the device collected its credential, or `null`. */
  collectedAt: Date | null;
  /** When the minted credential expires, or `null`. */
  credentialExpiresAt: Date | null;
  /** When the session was revoked, or `null`. */
  revokedAt: Date | null;
  /** The organization its credential is bound to, or `null`. */
  orgId: string | null;
}

/**
 * An `organizations` row.
 *
 * @stability experimental
 */
export interface IdentityOrganizationRow {
  /** The organization's id. */
  id: string;
  /** Its display name. */
  name: string;
  /** Its unique slug. */
  slug: string;
  /** Whether it is the deployment's default organization. */
  isDefault: boolean;
  /** Who created it, or `null`. */
  createdById: string | null;
  /** When it was created. */
  createdAt: Date;
  /** When the row last changed. */
  updatedAt: Date;
}

/**
 * A `memberships` row.
 *
 * @stability experimental
 */
export interface IdentityMembershipRow {
  /** The membership's id. */
  id: string;
  /** The organization. */
  orgId: string;
  /** The member. */
  userId: string;
  /** `active` or `suspended`. */
  status: OrgMemberStatus;
  /** When the user last acted in the organization, or `null`. */
  lastActiveAt: Date | null;
  /** The org role. */
  roleId: string;
  /** When it was created. */
  createdAt: Date;
  /** When the row last changed. */
  updatedAt: Date;
}

/**
 * An `org_invites` row.
 *
 * @stability experimental
 */
export interface IdentityInviteRow {
  /** The invitation's id. */
  id: string;
  /** The organization. */
  orgId: string;
  /** The invited (lower-cased) email. */
  email: string;
  /** Its status. */
  status: OrgInviteStatus;
  /** SHA-256 of the invitation token, or `null`. */
  tokenHash: string | null;
  /** When it expires, or `null`. */
  expiresAt: Date | null;
  /** Who invited, or `null`. */
  invitedById: string | null;
  /** Who accepted, or `null`. */
  acceptedById: string | null;
  /** When it was accepted, or `null`. */
  acceptedAt: Date | null;
  /** Notes, or `null`. */
  notes: string | null;
  /** The org role it grants, or `null`. */
  roleId: string | null;
  /** When it was created. */
  createdAt: Date;
}

// ---- the client -------------------------------------------------------------------------

/**
 * Prisma query arguments: the slice builds them, the app's client checks them.
 *
 * @stability experimental
 */
export type IdentityQueryArgs = Record<string, unknown>;

/**
 * What a bulk write (`createMany`, `updateMany`, `deleteMany`) resolves to.
 *
 * @stability experimental
 */
export interface IdentityBatchResult {
  /** How many rows it wrote. */
  count: number;
}

/**
 * One model delegate of the app's client, as identity calls it. Each read is
 * generic in its result, so a call that `include`s or `select`s names the
 * shape it gets back.
 *
 * @stability experimental
 */
export interface IdentityDelegate<Row> {
  /** One row by a unique key, or `null`. */
  findUnique<T = Row>(args: IdentityQueryArgs): Promise<T | null>;
  /** One row by a unique key; rejects when there is none. */
  findUniqueOrThrow<T = Row>(args: IdentityQueryArgs): Promise<T>;
  /** The first matching row, or `null`. */
  findFirst<T = Row>(args?: IdentityQueryArgs): Promise<T | null>;
  /** Every matching row. */
  findMany<T = Row>(args?: IdentityQueryArgs): Promise<T[]>;
  /** How many rows match. */
  count(args?: IdentityQueryArgs): Promise<number>;
  /** Inserts one row. */
  create<T = Row>(args: IdentityQueryArgs): Promise<T>;
  /** Inserts several rows. */
  createMany(args: IdentityQueryArgs): Promise<IdentityBatchResult>;
  /** Updates one row by a unique key. */
  update<T = Row>(args: IdentityQueryArgs): Promise<T>;
  /** Updates every matching row. */
  updateMany(args: IdentityQueryArgs): Promise<IdentityBatchResult>;
  /** Inserts or updates one row by a unique key. */
  upsert<T = Row>(args: IdentityQueryArgs): Promise<T>;
  /** Deletes one row by a unique key. */
  delete<T = Row>(args: IdentityQueryArgs): Promise<T>;
  /** Deletes every matching row. */
  deleteMany(args?: IdentityQueryArgs): Promise<IdentityBatchResult>;
}

/**
 * The identity models of the app's client, and its raw queries: what a
 * transaction client offers.
 *
 * @stability experimental
 */
export interface IdentityTx {
  /** `users`. */
  user: IdentityDelegate<IdentityUserRow>;
  /** `user_identities`. */
  userIdentity: IdentityDelegate<IdentityUserIdentityRow>;
  /** `roles`. */
  role: IdentityDelegate<IdentityRoleRow>;
  /** `permissions`. */
  permission: IdentityDelegate<IdentityPermissionRow>;
  /** `user_roles`. */
  userRole: IdentityDelegate<IdentityUserRoleRow>;
  /** `audit_events`. */
  auditEvent: IdentityDelegate<IdentityAuditEventRow>;
  /** `refresh_tokens`. */
  refreshToken: IdentityDelegate<IdentityRefreshTokenRow>;
  /** `personal_access_tokens`. */
  personalAccessToken: IdentityDelegate<IdentityPersonalAccessTokenRow>;
  /** `allowed_emails`. */
  allowedEmail: IdentityDelegate<IdentityAllowedEmailRow>;
  /** `device_codes`. */
  deviceCode: IdentityDelegate<IdentityDeviceCodeRow>;
  /** `organizations`. */
  organization: IdentityDelegate<IdentityOrganizationRow>;
  /** `memberships`. */
  membership: IdentityDelegate<IdentityMembershipRow>;
  /** `org_invites`. */
  invite: IdentityDelegate<IdentityInviteRow>;
  /** A tagged-template raw query. */
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  /** A tagged-template raw statement; resolves to the affected row count. */
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/**
 * The app's Prisma client as identity sees it: the identity models plus an
 * interactive transaction. The value is the app's own client, injected
 * through the core port `PLATFORM_PRISMA`; nothing here depends on a
 * generated client.
 *
 * @stability experimental
 */
export interface IdentityPrisma extends IdentityTx {
  /** Runs `fn` in one interactive transaction. */
  $transaction<T>(fn: (tx: IdentityTx) => Promise<T>, options?: IdentityQueryArgs): Promise<T>;
}

// ---- errors -----------------------------------------------------------------------------

/**
 * A Prisma known request error, seen structurally.
 *
 * @stability experimental
 */
export interface IdentityPrismaError extends Error {
  /** The Prisma error code (`P2002`). */
  code: string;
  /** Prisma's details (the violated `target`, ...), when present. */
  meta?: unknown;
}

/**
 * Whether `error` is a Prisma known request error with `code` (`P2002`, a
 * unique-constraint violation; `P2025`, record not found). Structural: the
 * slice never loads the client's error classes.
 *
 * @param error - anything a query rejected with.
 * @param code - the Prisma error code.
 * @returns `true` when `error` carries that code.
 *
 * @stability experimental
 */
export function isPrismaErrorCode(error: unknown, code: string): error is IdentityPrismaError {
  return error instanceof Error && (error as { code?: unknown }).code === code;
}

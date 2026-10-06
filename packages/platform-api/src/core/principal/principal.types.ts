// =============================================================================
// The org-aware principal and scope contract (ADR 0001)
// =============================================================================
//
// TYPES ONLY. This file has no runtime exports and imports nothing: not
// `@prisma/client`, not `@nestjs/*`, not an app module. It was written that
// way in the app (issue #687) so it could move into
// `@marinoscar/platform-api/core` unchanged, which it did (issue #698). Both
// properties are pinned by `test/core/principal.spec.ts` in this package.
//
// Nothing in the reference app consumes it yet. Requests still carry the
// app's `RequestUser` (`apps/api/src/auth/interfaces/authenticated-user.interface.ts`);
// attaching a `Principal` to the request, the runtime `toPrincipal()` mapper
// and `@CurrentPrincipal()` arrive later (issue #724). The derivation rules
// this contract is built on (credential mapping, scope derivation, tenancy
// modes, `SystemActor`) are written down in
// docs/adr/0001-org-aware-principal-and-scope.md. Read it before changing a
// field here.
// =============================================================================

/**
 * How a deployment isolates its users: one organisation everyone auto-joins
 * (`'single'`) or one organisation per customer (`'multi'`).
 *
 * A deployment setting, not a code path: the same code and the same tables
 * serve both modes. This type only names the two values; parsing the setting
 * is not part of this contract.
 *
 * @stability experimental
 * @example
 * ```ts
 * const mode: TenancyMode = 'single';
 * ```
 */
export type TenancyMode = 'single' | 'multi';

/**
 * How the request authenticated. One value per credential family the
 * authentication guard accepts:
 *
 * - `'session'`: a browser access JWT (`Authorization: Bearer <jwt>`) whose
 *   payload has no `did` claim.
 * - `'device'`: an access JWT carrying `did`, issued by the device
 *   authorization flow. A device flow that issued a `pat_` presents a PAT and
 *   is `'pat'`: the kind names the credential presented, not the flow that
 *   minted it.
 * - `'pat'`: a `pat_` personal access token.
 * - `'node'`: a `nod_` worker-node credential, confined to `/api/nodes`.
 *
 * Small and closed, so unlike an org id it is safe as a metric label.
 *
 * @stability experimental
 * @example
 * ```ts
 * const kind: CredentialKind = payload.did ? 'device' : 'session';
 * ```
 */
export type CredentialKind =
  | 'session'
  | 'device'
  | 'pat'
  | 'node';

/**
 * Discriminant of {@link Principal}: a human user (directly or through a
 * credential they delegated) or an unattended worker node.
 *
 * @stability experimental
 */
export type PrincipalKind = 'user' | 'node';

/**
 * One organisation a principal belongs to.
 *
 * @stability experimental
 * @example
 * ```ts
 * const membership: OrgMembership = { orgId: 'org_1', role: 'member' };
 * ```
 */
export interface OrgMembership {
  /** The organisation's id. */
  readonly orgId: string;
  /** Org-scoped role name (spec: "Org roles"), e.g. `'org_admin'`, `'member'`. */
  readonly role: string;
}

/**
 * One group a principal belongs to. A group is a set of users inside one
 * organisation that can own and share content; it is never a tenant.
 *
 * @stability experimental
 * @example
 * ```ts
 * const group: GroupMembership = { groupId: 'grp_1', orgId: 'org_1', role: 'member' };
 * ```
 */
export interface GroupMembership {
  /** The group's id. */
  readonly groupId: string;
  /** The organisation the group lives in. */
  readonly orgId: string;
  /** The member's role inside the group, e.g. `'owner'`, `'member'`. */
  readonly role: string;
}

/**
 * Fields every principal carries. Not exported: build a {@link UserPrincipal}
 * or a {@link NodePrincipal}.
 */
interface PrincipalBase {
  /** Discriminant; narrow on it. */
  readonly kind: PrincipalKind;
  /**
   * The user whose authority is exercised. For a node principal, the owner of
   * the node credential.
   */
  readonly userId: string;
  /** That user's email, for logs and audit. */
  readonly email: string;
  /** How the request authenticated. */
  readonly credential: CredentialKind;
  /**
   * System role names (spec: "System roles operate the deployment"). Today
   * every role is a system role.
   */
  readonly roles: readonly string[];
  /** Effective permission strings, deduplicated. */
  readonly permissions: readonly string[];
  /**
   * The active organisation. ABSENT until organisations exist; afterwards
   * always present on a user principal (single mode: the default org) and
   * never present on a node principal, which stays system-scoped. Carried in
   * the access token; switching org re-issues the token.
   */
  readonly activeOrgId?: string;
  /** Every organisation the user belongs to. Absent until organisations exist. */
  readonly memberships?: readonly OrgMembership[];
  /** Every group the user belongs to. Absent until groups exist. */
  readonly groups?: readonly GroupMembership[];
}

/**
 * A human caller: a browser session, a device-flow token or a personal
 * access token. A snapshot for one request; every field is readonly and a
 * change (for example switching org) produces a new principal on the next
 * request.
 *
 * There is no `isActive`: an inactive user never becomes a principal.
 *
 * @stability experimental
 * @example
 * ```ts
 * const principal: UserPrincipal = {
 *   kind: 'user',
 *   userId: requestUser.id,
 *   email: requestUser.email,
 *   credential: 'session',
 *   roles: requestUser.roles,
 *   permissions: requestUser.permissions,
 * };
 * ```
 */
export interface UserPrincipal extends PrincipalBase {
  readonly kind: 'user';
  readonly credential: 'session' | 'device' | 'pat';
}

/**
 * An unattended worker process authenticated with a `nod_` credential. It
 * acts with its owning user's roles and permissions and is confined to
 * `/api/nodes` by the authentication guard.
 *
 * @stability experimental
 * @example
 * ```ts
 * const principal: NodePrincipal = {
 *   kind: 'node',
 *   userId: owner.id,
 *   email: owner.email,
 *   credential: 'node',
 *   roles: owner.roles,
 *   permissions: owner.permissions,
 * };
 * ```
 */
export interface NodePrincipal extends PrincipalBase {
  readonly kind: 'node';
  readonly credential: 'node';
  /** The worker node the credential is enrolled as, when known. */
  readonly nodeId?: string;
}

/**
 * Who is calling. Narrow on `kind` (or `credential`) before reading the
 * variant-specific fields.
 *
 * @stability experimental
 * @example
 * ```ts
 * function describe(principal: Principal): string {
 *   return principal.kind === 'node' ? `node ${principal.nodeId ?? '?'}` : principal.email;
 * }
 * ```
 */
export type Principal = UserPrincipal | NodePrincipal;

/**
 * The data boundary one operation runs in.
 *
 * Derived from a {@link Principal}, NEVER from request input (path, query or
 * body): `userId = principal.userId`, `orgId = principal.activeOrgId`,
 * `groupIds` = the principal's group ids, optionally narrowed by the
 * operation, never widened.
 *
 * - `userId` is always required.
 * - `orgId` is required once organisations exist; it is what row-level
 *   security's transaction-local `app.org_id` setting will carry.
 * - `groupIds` narrows to groups the principal belongs to (sharing).
 *
 * @stability experimental
 * @example
 * ```ts
 * const scope: Scope = { userId: principal.userId, orgId: principal.activeOrgId };
 * ```
 */
export interface Scope {
  /** The user the operation acts for: always `principal.userId`. */
  readonly userId: string;
  /** The organisation: `principal.activeOrgId`. Required once organisations exist. */
  readonly orgId?: string;
  /** Groups to narrow to, each one the principal belongs to; never widened. */
  readonly groupIds?: readonly string[];
}

/**
 * An explicit, named escape from scoping for system work (backups, purges,
 * the Doctor). The only way to run unscoped. Never derived from a request.
 *
 * @stability experimental
 * @example
 * ```ts
 * const actor: SystemActor = { kind: 'system', reason: 'retention.purge' };
 * ```
 */
export interface SystemActor {
  /** Discriminant: always `'system'`. */
  readonly kind: 'system';
  /**
   * Short, greppable reason, e.g. `'retention.purge'`, `'db.backup.run'`.
   * Logged and put on spans.
   */
  readonly reason: string;
}

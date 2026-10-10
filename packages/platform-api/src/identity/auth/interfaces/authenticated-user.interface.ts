import type { OrgMemberStatus } from '@marinoscar/platform-contract/identity';
import type { CredentialKind } from '../../../core/index';
import type { IdentityUserRow } from '../../data/identity-db';
import { principalFactory } from '../principal.factory';

/**
 * A role row with its permissions, as the principal graph loads it.
 *
 * @stability stable
 */
export interface AuthenticatedRole {
  /** The role's id. */
  id: string;
  /** The role name (`admin`, `viewer`, ...). */
  name: string;
  /** Its description. */
  description: string | null;
  /** `system` or `org`. */
  scope?: 'system' | 'org';
  /** Its grants. */
  rolePermissions: Array<{
    /** The granted permission. */
    permission: AuthenticatedPermission;
  }>;
}

/**
 * A permission row, as the principal graph loads it.
 *
 * @stability stable
 */
export interface AuthenticatedPermission {
  /** The permission's id. */
  id: string;
  /** The permission string (`users:read`). */
  name: string;
  /** Its description. */
  description: string | null;
  /** `system` or `org`. */
  scope?: 'system' | 'org';
}

/**
 * One membership of the user, with its org role, as the principal graph loads it.
 *
 * @stability stable
 */
export interface AuthenticatedMembership {
  /** The organization. */
  orgId: string;
  /** `active` or `suspended`. */
  status: OrgMemberStatus;
  /** When the user last acted in the organization. */
  lastActiveAt: Date | null;
  /** When the membership was created. */
  createdAt?: Date;
  /** The organization's id and whether it is the default one. */
  org?: {
    /** The organization's id. */
    id: string;
    /** Whether it is the deployment's default organization. */
    isDefault: boolean;
  } | null;
  /** The org role on the membership. */
  role: AuthenticatedRole;
}

/**
 * User object attached to request after credential validation: the user,
 * their SYSTEM roles (`userRoles`) and their memberships with each one's ORG
 * role (issue #723). Loaded with `PRINCIPAL_USER_INCLUDE`
 * (`auth/principal.factory.ts`). `memberships` is optional so a graph loaded
 * without it (an older caller, a test fixture) still type-checks; it then
 * contributes no org role.
 *
 * @stability stable
 */
export interface AuthenticatedUser extends IdentityUserRow {
  /** The user's SYSTEM roles (`user_roles`). */
  userRoles: Array<{
    /** The role. */
    role: AuthenticatedRole;
  }>;
  /** The user's memberships, each with its ORG role. */
  memberships?: AuthenticatedMembership[];
  /**
   * The org this request's credential is bound to (#724), stamped by the
   * credential path that admitted it: the access token's `org` claim, the
   * PAT's `orgId`, or `null` for a system-scoped node credential. Absent on a
   * graph loaded outside a request; `PrincipalFactory` then applies the
   * sign-in rule. Never taken from a header, query or body.
   */
  activeOrgId?: string | null;
  /** How the request authenticated (#724): `session`, `device`, `pat` or `node`. */
  tokenKind?: CredentialKind;
}

/**
 * Simplified user info for request context.
 *
 * @stability stable
 */
export interface RequestUser {
  /** The user's id. */
  id: string;
  /** The user's email. */
  email: string;
  /** System role names plus the current org role name (issue #723). */
  roles: string[];
  /** Effective permissions: system grants ∪ current-org membership grants. */
  permissions: string[];
  /** Whether the account is active. */
  isActive: boolean;
  /** The active org (#724): present when the credential path stamped one; `null` for a node. */
  activeOrgId?: string | null;
}

/**
 * Extract RequestUser from AuthenticatedUser. The roles and permissions come
 * from `PrincipalFactory` (system roles ∪ current-org membership role).
 *
 * @param user - the loaded user graph.
 * @returns the simplified view.
 *
 * @stability stable
 */
export function toRequestUser(user: AuthenticatedUser): RequestUser {
  const { roles, permissions } = principalFactory.access(user);

  return {
    id: user.id,
    email: user.email,
    roles,
    permissions,
    isActive: user.isActive,
    ...(user.activeOrgId !== undefined ? { activeOrgId: user.activeOrgId } : {}),
  };
}

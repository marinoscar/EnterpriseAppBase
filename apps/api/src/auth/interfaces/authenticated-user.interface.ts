import { User, MembershipStatus } from '@prisma/client';
import { principalFactory } from '../principal.factory';

/** A role row with its permissions, as the principal graph loads it. */
interface AuthenticatedRole {
  id: string;
  name: string;
  description: string | null;
  scope?: 'system' | 'org';
  rolePermissions: Array<{
    permission: { id: string; name: string; description: string | null; scope?: 'system' | 'org' };
  }>;
}

/**
 * User object attached to request after credential validation: the user,
 * their SYSTEM roles (`userRoles`) and their memberships with each one's ORG
 * role (issue #723). Loaded with `PRINCIPAL_USER_INCLUDE`
 * (`auth/principal.factory.ts`). `memberships` is optional so a graph loaded
 * without it (an older caller, a test fixture) still type-checks; it then
 * contributes no org role.
 */
export interface AuthenticatedUser extends User {
  userRoles: Array<{
    role: AuthenticatedRole;
  }>;
  memberships?: Array<{
    orgId: string;
    status: MembershipStatus;
    lastActiveAt: Date | null;
    createdAt?: Date;
    org?: { id: string; isDefault: boolean } | null;
    role: AuthenticatedRole;
  }>;
}

/**
 * Simplified user info for request context
 */
export interface RequestUser {
  id: string;
  email: string;
  /** System role names plus the current org role name (issue #723). */
  roles: string[];
  /** Effective permissions: system grants ∪ current-org membership grants. */
  permissions: string[];
  isActive: boolean;
}

/**
 * Extract RequestUser from AuthenticatedUser. The roles and permissions come
 * from `PrincipalFactory` (system roles ∪ current-org membership role).
 */
export function toRequestUser(user: AuthenticatedUser): RequestUser {
  const { roles, permissions } = principalFactory.access(user);

  return {
    id: user.id,
    email: user.email,
    roles,
    permissions,
    isActive: user.isActive,
  };
}

// =============================================================================
// PrincipalFactory: effective roles and permissions (issue #723, PP-6.3)
// =============================================================================
//
// RBAC is split into SYSTEM roles (held in `user_roles`; they operate the
// deployment) and ORG roles (held on a membership, `memberships.role_id`; they
// operate one organization). A user's effective access is
//
//   permissions = (grants of every system role)
//               ∪ (grants of the role on the CURRENT-ORG membership)
//   roles       = system role names + the current org role name
//
// This file is the ONE place that rule is written. The guards (through
// `toRequestUser`), `/api/auth/me` (`AuthService.getCurrentUser`) and the users
// list all read it, so they cannot disagree.
//
// "Current org" (#724): the ACTIVE ORG the credential is bound to, when the
// caller knows it (`PrincipalSource.activeOrgId`):
//   - a string: that org's membership, if it is active (the access token's
//     `org` claim, a PAT's or device session's `orgId`);
//   - `null`: no org at all (a node credential is system-scoped).
// When it is not known (`undefined`: a graph loaded outside a request), the
// sign-in rule picks it, the same rule `AuthService` uses to choose the org
// a new access token is issued for:
//   - single mode: the default organization's membership;
//   - multi mode: the active membership with the latest `lastActiveAt`
//     (ties: the oldest membership).
// A suspended membership contributes nothing; no membership contributes
// nothing.
//
// Loading: every credential path (JWT, PAT, node) loads the user with
// `PRINCIPAL_USER_INCLUDE`, one shared constant, so the three cannot drift
// into loading different graphs. The JWT path keeps that graph in the
// principal cache (#683); the factory derives from it on every request, so a
// cached entry and a fresh read give the same answer.
//
// Compatibility: grants of ANY role in `user_roles` count, whatever its scope.
// After migration 0024 that table holds system roles only, but a row an older
// writer left behind keeps working rather than silently stopping.
// =============================================================================

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  CredentialKind,
  NodePrincipal,
  OrgMembership,
  Principal,
  TenancyMode,
  UserPrincipal,
} from '../../core/index';

import { currentTenancyMode } from './tenancy-mode';

/** The role graph a principal needs: the role and the names of its permissions. */
const PRINCIPAL_ROLE_INCLUDE = {
  rolePermissions: { include: { permission: true } },
} satisfies Prisma.RoleInclude;

/**
 * What every credential path loads with the user: system roles with their
 * permissions, and every membership with its organization's default flag and
 * its org role's permissions. Shared by `AuthService.validateJwtPayload`,
 * `PatService.resolveToken` and `NodeCredentialService.validateToken`; one
 * extra join per authenticated request, absorbed by the principal cache on
 * the JWT path.
 */
export const PRINCIPAL_USER_INCLUDE = {
  userRoles: { include: { role: { include: PRINCIPAL_ROLE_INCLUDE } } },
  memberships: {
    include: {
      org: { select: { id: true, isDefault: true } },
      role: { include: PRINCIPAL_ROLE_INCLUDE },
    },
  },
} satisfies Prisma.UserInclude;

/** A role as the factory reads it. `rolePermissions` may be absent where only names are loaded. */
export interface PrincipalRole {
  name: string;
  rolePermissions?: ReadonlyArray<{ permission: { name: string } }>;
}

/** A membership as the factory reads it. */
export interface PrincipalMembership {
  orgId: string;
  status: 'active' | 'suspended';
  lastActiveAt: Date | null;
  createdAt?: Date;
  org?: { id: string; isDefault: boolean } | null;
  role: PrincipalRole;
}

/** The part of a loaded user the factory reads. `memberships` absent means none were loaded. */
export interface PrincipalSource {
  userRoles: ReadonlyArray<{ role: PrincipalRole }>;
  memberships?: ReadonlyArray<PrincipalMembership>;
  /**
   * The org the credential is bound to (#724): a string for a user
   * credential, `null` for a system-scoped node credential, absent when the
   * graph was loaded outside a request (the sign-in rule then picks it).
   */
  activeOrgId?: string | null;
}

/** The effective access of one user, in one tenancy mode. */
export interface EffectiveAccess {
  /** Names of the roles held in `user_roles` (system roles). */
  systemRoles: string[];
  /** The membership of the current organization, or `null` (none, or suspended). */
  membership: PrincipalMembership | null;
  /** The org role on that membership, or `null`. */
  orgRole: string | null;
  /** System role names, then the org role name, deduplicated. */
  roles: string[];
  /** Effective permission strings, deduplicated, system grants first. */
  permissions: string[];
}

/** Most recent `lastActiveAt` first (never-used last), then the oldest membership. */
function byRecency(a: PrincipalMembership, b: PrincipalMembership): number {
  const at = a.lastActiveAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const bt = b.lastActiveAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (at !== bt) return bt - at;
  return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
}

/**
 * The membership whose role counts: see the file header for the rule.
 *
 * @param activeOrgId - the org the credential is bound to: a string selects
 *   that org's membership, `null` selects none (system-scoped), `undefined`
 *   applies the sign-in rule for `mode`.
 * @returns the membership, or `null` when there is none or it is suspended.
 */
export function selectCurrentMembership(
  memberships: ReadonlyArray<PrincipalMembership> | undefined,
  mode: TenancyMode,
  activeOrgId?: string | null,
): PrincipalMembership | null {
  if (activeOrgId === null) return null;
  if (!memberships || memberships.length === 0) return null;
  if (activeOrgId !== undefined) {
    const membership = memberships.find((candidate) => candidate.orgId === activeOrgId);
    return membership && membership.status === 'active' ? membership : null;
  }
  if (mode === 'single') {
    const membership = memberships.find((candidate) => candidate.org?.isDefault === true);
    return membership && membership.status === 'active' ? membership : null;
  }
  const active = memberships.filter((candidate) => candidate.status === 'active');
  return [...active].sort(byRecency)[0] ?? null;
}

/**
 * The effective roles and permissions of a loaded user. Pure.
 *
 * @param user - loaded with {@link PRINCIPAL_USER_INCLUDE} (or a narrower graph).
 * @param mode - the deployment's tenancy mode.
 */
export function resolveEffectiveAccess(user: PrincipalSource, mode: TenancyMode): EffectiveAccess {
  const systemRoles = user.userRoles.map((userRole) => userRole.role.name);
  const membership = selectCurrentMembership(user.memberships, mode, user.activeOrgId);
  const orgRole = membership?.role.name ?? null;

  const permissions = new Set<string>();
  for (const userRole of user.userRoles) {
    for (const grant of userRole.role.rolePermissions ?? []) permissions.add(grant.permission.name);
  }
  for (const grant of membership?.role.rolePermissions ?? []) permissions.add(grant.permission.name);

  const roles = [...new Set(orgRole ? [...systemRoles, orgRole] : systemRoles)];

  return { systemRoles, membership, orgRole, roles, permissions: [...permissions] };
}

/**
 * Builds effective access and `Principal` values (the #687 contract) from a
 * loaded user. Stateless; the tenancy mode is read per call. Injectable for
 * services, and available as {@link principalFactory} for the pure call sites
 * (`toRequestUser` in the guards).
 */
@Injectable()
export class PrincipalFactory {
  /** The tenancy mode the current-org rule uses (recorded by `TenancyService` at startup). */
  mode(): TenancyMode {
    return currentTenancyMode();
  }

  /** Effective roles and permissions; see {@link resolveEffectiveAccess}. */
  access(user: PrincipalSource): EffectiveAccess {
    return resolveEffectiveAccess(user, this.mode());
  }

  /**
   * A `UserPrincipal` for a human caller (#724). `activeOrgId` is the org the
   * credential is bound to (or, for a graph without one, the sign-in rule's
   * pick); `roles` carries the system role names plus that org's role name;
   * `memberships` every membership, suspended ones included, with its org
   * role and status; `groups` is empty until groups exist (PP-7).
   */
  forUser(
    user: PrincipalSource & { id: string; email: string },
    credential: Exclude<CredentialKind, 'node'>,
  ): UserPrincipal {
    const access = this.access(user);
    const activeOrgId =
      typeof user.activeOrgId === 'string' ? user.activeOrgId : access.membership?.orgId;
    return {
      kind: 'user',
      userId: user.id,
      email: user.email,
      credential,
      roles: access.roles,
      permissions: access.permissions,
      ...(activeOrgId ? { activeOrgId } : {}),
      ...(user.memberships ? { memberships: listMemberships(user.memberships) } : {}),
      groups: [],
    };
  }

  /**
   * A `NodePrincipal`: system-scoped (ADR 0001, #724). No active
   * organization, so only the owning user's SYSTEM grants count; no org role
   * contributes, whatever `user.activeOrgId` says.
   */
  forNode(user: PrincipalSource & { id: string; email: string }, nodeId?: string): NodePrincipal {
    const access = this.access({ ...user, activeOrgId: null });
    return {
      kind: 'node',
      userId: user.id,
      email: user.email,
      credential: 'node',
      roles: access.roles,
      permissions: access.permissions,
      ...(nodeId ? { nodeId } : {}),
    };
  }
}

function listMemberships(memberships: ReadonlyArray<PrincipalMembership>): OrgMembership[] {
  return memberships.map((membership) => ({
    orgId: membership.orgId,
    role: membership.role.name,
    status: membership.status,
  }));
}

/** The shared, stateless instance for call sites without dependency injection. */
export const principalFactory = new PrincipalFactory();

/**
 * The runtime mapper ADR 0001 specifies (#724): the request's `Principal`
 * from the loaded user graph and the credential kind `JwtAuthGuard` admitted
 * it with. A node credential yields a system-scoped `NodePrincipal` (no
 * `activeOrgId`); every other kind a `UserPrincipal` bound to
 * `user.activeOrgId`.
 */
export function toPrincipal(
  user: PrincipalSource & { id: string; email: string },
  credential: CredentialKind,
  nodeId?: string,
): Principal {
  return credential === 'node'
    ? principalFactory.forNode(user, nodeId)
    : principalFactory.forUser(user, credential);
}

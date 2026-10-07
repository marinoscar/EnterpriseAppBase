import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Principal } from '../../core/index';

import { ORG_ADMIN_ROLE } from '../identity.constants';

// =============================================================================
// Shared rules of the org administration API (#726, PP-6.7)
// =============================================================================

/**
 * The organization an `/api/org/*` request acts on: the ACTIVE org of the
 * request's principal, which the guard took from the signed token (or the
 * PAT's / device session's binding) and checked is an active membership.
 *
 * NEVER an org id from the path, the query or the body: that is the
 * confused-deputy hole this API is shaped to avoid (an admin of org A naming
 * org B). A principal with no active org (a system-scoped node credential)
 * is refused.
 */
export function requireActiveOrgId(principal: Principal | undefined): string {
  const orgId = principal && 'activeOrgId' in principal ? principal.activeOrgId : undefined;
  if (!orgId) {
    throw new ForbiddenException('This credential is not bound to an organization');
  }
  return orgId;
}

/**
 * Org role precedence, highest first: an invitation never DOWNGRADES an
 * existing membership (`org_admin` > `contributor` > `viewer`). A role this
 * list does not know (an app's own org role) ranks lowest.
 */
const ORG_ROLE_RANK: Readonly<Record<string, number>> = {
  [ORG_ADMIN_ROLE]: 3,
  contributor: 2,
  viewer: 1,
};

/** The rank of an org role name (0 for a role the platform does not rank). */
export function orgRoleRank(roleName: string | null | undefined): number {
  return roleName ? (ORG_ROLE_RANK[roleName] ?? 0) : 0;
}

/** `details.reason` of the 409 refusing to remove the last active org admin. */
export const LAST_ORG_ADMIN_REASON = 'LAST_ORG_ADMIN';

/** `details.reason` of the 409 refusing to create an organization in single mode. */
export const TENANCY_SINGLE_ORG_REASON = 'TENANCY_SINGLE_ORG';

/** The 409 for an action that would leave the organization without an active `org_admin`. */
export function lastOrgAdminConflict(): ConflictException {
  return new ConflictException({
    message:
      'This would leave the organization without an active administrator. Make another member an org_admin first.',
    details: { reason: LAST_ORG_ADMIN_REASON },
  });
}

/**
 * Serializes the membership writes of one organization for the rest of the
 * transaction (`SELECT ... FOR UPDATE` on its `organizations` row), so two
 * administrators demoting each other at once cannot both pass the last-admin
 * check. The lock is released when the transaction ends.
 */
export async function lockOrganization(tx: Prisma.TransactionClient, orgId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${orgId}::uuid FOR UPDATE`;
}

/** Writes one audit row inside the caller's transaction. */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  actorUserId: string | null,
  action: string,
  targetType: string,
  targetId: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await tx.auditEvent.create({
    data: { actorUserId, action, targetType, targetId, meta: meta as Prisma.InputJsonValue },
  });
}

/** The absolute sign-in URL for an invitation's CTA, or `undefined` without `APP_URL`. */
export function signInUrlFrom(appUrl: string | undefined): string | undefined {
  return appUrl ? `${appUrl.replace(/\/+$/, '')}/login` : undefined;
}

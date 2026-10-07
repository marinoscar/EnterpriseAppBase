import { Injectable, NotFoundException } from '@nestjs/common';
import type { Membership, MembershipStatus, Organization, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PrincipalCache } from '../auth/principal-cache/principal-cache.service';
import { DefaultOrganizationMissingException } from './organizations.errors';
import { DatabaseSeedException } from '@marinoscar/platform-api/core';
import { DEFAULT_ORG_ROLE } from '../common/constants/roles.constants';

/**
 * Organizations, the tenancy foundation (PP-6.1, ADR 0001).
 *
 * Read helpers, the write path new users go through, and the membership
 * mutations (#724) the member admin API (PP-6.8, #726) will call. There are no
 * HTTP routes here: switch-org lives in `AuthController` (PP-6.4). The
 * `organizations`, `memberships` and `org_invites` tables are identity tables,
 * read across organizations at login and guarded here, not by RLS (ADR 0002).
 *
 * PRINCIPAL CACHE (#724). A membership carries the org role and decides
 * whether an org-bound credential is still honoured, so every mutation here
 * that can change either calls `principalCache.invalidateUser` AFTER its write
 * commits (never inside a caller's transaction). `ensureMembership` is the
 * exception: it runs inside the caller's transaction, and the caller
 * invalidates after it commits.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly principalCache: PrincipalCache,
  ) {}

  /**
   * The deployment's default organization: the single row with `isDefault`,
   * kept unique by `organizations_default_uniq_idx`.
   *
   * @throws {@link DefaultOrganizationMissingException} when neither the
   * migration backfill nor the seed has created it.
   */
  async getDefaultOrg(): Promise<Organization> {
    const org = await this.prisma.organization.findFirst({
      where: { isDefault: true },
    });
    if (!org) {
      throw new DefaultOrganizationMissingException();
    }
    return org;
  }

  /**
   * The user's active memberships, each with its organization, most recently
   * used first (never-used last). Suspended memberships are excluded.
   */
  async listActiveMemberships(
    userId: string,
  ): Promise<Array<Membership & { org: Organization }>> {
    return this.prisma.membership.findMany({
      where: { userId, status: 'active' },
      include: { org: true },
      orderBy: [
        { lastActiveAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
    });
  }

  /**
   * Make the user a member of the organization with the given org role,
   * idempotently (upsert on `orgId_userId`). An existing membership is left
   * exactly as it is, role included: a suspended member stays suspended, and
   * a member whose role an administrator changed keeps it.
   *
   * Takes the caller's transaction client so a sign-up creates the user and the
   * membership atomically. Writes no audit event: the user-creation path does
   * not audit, and admin-initiated membership changes (PP-6.8) will. The
   * caller invalidates the principal cache after its transaction commits.
   *
   * @param roleId - the org-scoped role of a NEW membership (PP-6.3):
   *   `DEFAULT_ORG_ROLE` for an ordinary sign-up, `ORG_ADMIN_ROLE` for the
   *   initial administrator.
   */
  async ensureMembership(
    tx: Prisma.TransactionClient,
    orgId: string,
    userId: string,
    roleId: string,
  ): Promise<Membership> {
    return tx.membership.upsert({
      where: { orgId_userId: { orgId, userId } },
      update: {},
      create: { orgId, userId, roleId, lastActiveAt: new Date() },
    });
  }

  /**
   * The sign-in self-heal (PP-6.2, #722): make sure an EXISTING user is a
   * member of the default organization, writing only when the row is missing.
   *
   * Reads first, so the common case (the member is already there) costs one
   * indexed read and no write on every sign-in. The write is still the
   * idempotent `ensureMembership` upsert, so two concurrent sign-ins cannot
   * produce a duplicate (the `orgId_userId` unique key decides). A suspended
   * membership is left suspended: this restores a missing row, never a
   * revoked one.
   *
   * @param roleName - the org role a RESTORED membership gets (PP-6.3, #723):
   *   `DEFAULT_ORG_ROLE` by default, `ORG_ADMIN_ROLE` for a system
   *   administrator. An existing membership keeps its role.
   * @returns the default organization's id, and whether a membership was created.
   * @throws {@link DefaultOrganizationMissingException} when the default org is missing.
   * @throws `DatabaseSeedException` when the role row is missing (seed not run).
   */
  async ensureDefaultOrgMembership(
    userId: string,
    roleName: string = DEFAULT_ORG_ROLE,
  ): Promise<{ orgId: string; created: boolean }> {
    const org = await this.getDefaultOrg();
    const existing = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId: org.id, userId } },
      select: { id: true },
    });
    if (existing) {
      return { orgId: org.id, created: false };
    }
    const role = await this.prisma.role.findUnique({
      where: { name: roleName },
      select: { id: true },
    });
    if (!role) {
      throw new DatabaseSeedException(`Role "${roleName}"`, 'npm run prisma:seed');
    }
    await this.ensureMembership(this.prisma, org.id, userId, role.id);
    // Committed (no transaction here): the new membership grants its org role.
    this.principalCache.invalidateUser(userId);
    return { orgId: org.id, created: true };
  }

  /**
   * Record that the user just started acting in `orgId` (sign-in or
   * switch-org, #724): `lastActiveAt` picks the org of the next multi-mode
   * sign-in. A missing membership is not an error (nothing to touch).
   *
   * Does NOT invalidate the principal cache: `lastActiveAt` changes neither a
   * role nor whether a credential is honoured; it only feeds the sign-in
   * choice, which reads the database.
   */
  async touchMembership(orgId: string, userId: string): Promise<void> {
    await this.prisma.membership.updateMany({
      where: { orgId, userId },
      data: { lastActiveAt: new Date() },
    });
  }

  /**
   * Remove the user from the organization (#724). Their credentials bound to
   * it (access tokens, refresh tokens, PATs, device sessions) stop working:
   * at once on this replica, within event-bus latency elsewhere, and within
   * the principal cache TTL at worst.
   *
   * @throws NotFoundException when there is no such membership.
   */
  async removeMembership(orgId: string, userId: string): Promise<void> {
    const result = await this.prisma.membership.deleteMany({ where: { orgId, userId } });
    if (result.count === 0) {
      throw new NotFoundException('Membership not found');
    }
    this.principalCache.invalidateUser(userId);
  }

  /**
   * Suspend or reactivate a membership (#724). A suspended membership grants
   * nothing and its org-bound credentials are refused until it is active
   * again.
   *
   * @throws NotFoundException when there is no such membership.
   */
  async setMembershipStatus(
    orgId: string,
    userId: string,
    status: MembershipStatus,
  ): Promise<Membership> {
    const existing = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Membership not found');
    }
    const updated = await this.prisma.membership.update({
      where: { id: existing.id },
      data: { status },
    });
    this.principalCache.invalidateUser(userId);
    return updated;
  }

  /**
   * Change the member's org role (#724).
   *
   * @throws NotFoundException when there is no such membership.
   * @throws `DatabaseSeedException` when the role row is missing (seed not run).
   */
  async setMembershipRole(orgId: string, userId: string, roleName: string): Promise<Membership> {
    const role = await this.prisma.role.findUnique({
      where: { name: roleName },
      select: { id: true },
    });
    if (!role) {
      throw new DatabaseSeedException(`Role "${roleName}"`, 'npm run prisma:seed');
    }
    const existing = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Membership not found');
    }
    const updated = await this.prisma.membership.update({
      where: { id: existing.id },
      data: { roleId: role.id },
    });
    this.principalCache.invalidateUser(userId);
    return updated;
  }

  /** How many active (not suspended) memberships the user holds, in any org. */
  async countActiveMemberships(userId: string): Promise<number> {
    return this.prisma.membership.count({
      where: { userId, status: 'active' },
    });
  }
}

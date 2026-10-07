import { Injectable } from '@nestjs/common';
import type { Membership, Organization, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DefaultOrganizationMissingException } from './organizations.errors';

/**
 * Organizations, the tenancy foundation (PP-6.1, ADR 0001).
 *
 * Read helpers plus the one write path new users go through. There are no HTTP
 * routes yet: the admin API is PP-6.8 and switch-org is PP-6.4. The
 * `organizations`, `memberships` and `org_invites` tables are identity tables,
 * read across organizations at login and guarded here, not by RLS (ADR 0002).
 */
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

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
   * Make the user a member of the organization, idempotently (upsert on
   * `orgId_userId`). An existing membership is left exactly as it is: a
   * suspended member stays suspended.
   *
   * Takes the caller's transaction client so a sign-up creates the user and the
   * membership atomically. Writes no audit event: the user-creation path does
   * not audit, and admin-initiated membership changes (PP-6.8) will.
   */
  async ensureMembership(
    tx: Prisma.TransactionClient,
    orgId: string,
    userId: string,
  ): Promise<Membership> {
    return tx.membership.upsert({
      where: { orgId_userId: { orgId, userId } },
      update: {},
      create: { orgId, userId, lastActiveAt: new Date() },
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
   * @returns the default organization's id, and whether a membership was created.
   * @throws {@link DefaultOrganizationMissingException} when the default org is missing.
   */
  async ensureDefaultOrgMembership(
    userId: string,
  ): Promise<{ orgId: string; created: boolean }> {
    const org = await this.getDefaultOrg();
    const existing = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId: org.id, userId } },
      select: { id: true },
    });
    if (existing) {
      return { orgId: org.id, created: false };
    }
    await this.ensureMembership(this.prisma, org.id, userId);
    return { orgId: org.id, created: true };
  }

  /** How many active (not suspended) memberships the user holds, in any org. */
  async countActiveMemberships(userId: string): Promise<number> {
    return this.prisma.membership.count({
      where: { userId, status: 'active' },
    });
  }
}

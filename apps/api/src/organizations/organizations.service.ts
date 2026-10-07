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
}

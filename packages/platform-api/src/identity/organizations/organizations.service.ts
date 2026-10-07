import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { Membership, MembershipStatus, Organization, Prisma } from '@prisma/client';
import { PLATFORM_PRISMA } from '../../core/index';
import type { IdentityPrisma } from '../ports';
import { PrincipalCache } from '../auth/principal-cache/principal-cache.service';
import { DefaultOrganizationMissingException } from './organizations.errors';
import { DatabaseSeedException } from '../../core/index';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS, type ResolvedIdentityModuleOptions } from '../identity.options';
import { IDENTITY_EVENTS, emitIdentityEvent } from '../identity.events';
import { orgRoleRank } from './org-admin.common';

/** The audit action an invitation claimed at sign-in writes (#726). */
export const ORG_INVITE_ACCEPTED_AUDIT = 'org:invite_accepted';
import type { TenancyMode } from '../../core/index';

/**
 * Organizations, the tenancy foundation (PP-6.1, ADR 0001).
 *
 * Read helpers, the write path new users go through, the membership
 * mutations (#724) and the invitation claim at sign-in (#726). There are no
 * HTTP routes here: switch-org lives in `AuthController` (PP-6.4), and the
 * org administration API (#726) in `OrgMembersService`, `OrgInvitesService`
 * and `OrganizationsAdminService` beside this file. The
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
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    private readonly principalCache: PrincipalCache,
    @Optional() @Inject(IDENTITY_OPTIONS)
    private readonly identityOptions: ResolvedIdentityModuleOptions = DEFAULT_IDENTITY_OPTIONS,
    // #727: `identity.membership.changed` when a sign-in claims an invitation.
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  private readonly logger = new Logger(OrganizationsService.name);

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
    roleName: string = this.identityOptions.defaultOrgRole,
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

  /**
   * The organization a new sign-in acts in (#724), the one rule every token
   * issuer applies (`AuthService`, `TestAuthService`):
   *
   * - single mode: the default organization, unless the loaded graph shows
   *   the user's default-org membership suspended;
   * - multi mode: the active membership with the latest `lastActiveAt` (ties:
   *   the oldest), from the graph when it has one, else from the database.
   *
   * @param user - the user, with its memberships when they are loaded.
   * @returns the org id, or `null` when the user has no organization to act in
   *   (or the default organization is missing: fail closed).
   */
  async signInOrgId(
    user: {
      id: string;
      memberships?: ReadonlyArray<{
        orgId: string;
        status: MembershipStatus;
        lastActiveAt: Date | null;
        createdAt?: Date;
      }> | null;
    },
    mode: TenancyMode,
  ): Promise<string | null> {
    if (mode === 'single') {
      let orgId: string;
      try {
        orgId = (await this.getDefaultOrg()).id;
      } catch {
        return null;
      }
      const membership = user.memberships?.find((candidate) => candidate.orgId === orgId);
      return membership && membership.status !== 'active' ? null : orgId;
    }
    const loaded = (user.memberships ?? [])
      .filter((candidate) => candidate.status === 'active')
      .sort(
        (a, b) =>
          (b.lastActiveAt?.getTime() ?? Number.NEGATIVE_INFINITY) -
            (a.lastActiveAt?.getTime() ?? Number.NEGATIVE_INFINITY) ||
          (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
      )[0];
    if (loaded) return loaded.orgId;
    const [latest] = await this.listActiveMemberships(user.id);
    return latest?.orgId ?? null;
  }

  /**
   * Claim the user's pending invitations at sign-in (#726, PP-6.7; the
   * MemoriaHub `claimPendingCircleInvites` precedent). `AuthService` calls it
   * before the multi-mode "no organization" check, so an invitee's first
   * sign-in finds the membership the invitation grants.
   *
   * For each PENDING invitation addressed to `email`:
   * - lapsed (`expiresAt` passed): marked `expired`, nothing granted (lazy
   *   expiry);
   * - otherwise, in its own transaction: the membership is created with the
   *   invitation's org role (a NULL role means `DEFAULT_ORG_ROLE`), or an
   *   existing one is UPGRADED to it, never downgraded (`org_admin` >
   *   `contributor` > `viewer`); a suspended membership stays suspended
   *   (reactivating is an administrator's decision); and the invitation is
   *   marked `accepted` (`acceptedById`, `acceptedAt`) conditionally, so two
   *   concurrent sign-ins cannot both claim it.
   *
   * Invalidates the principal cache once, after the last commit, when
   * anything was granted.
   *
   * @param email - the signing-in address, lower-cased.
   * @returns how many invitations were accepted.
   */
  async claimPendingInvites(userId: string, email: string): Promise<number> {
    const now = new Date();
    const pending =
      (await this.prisma.invite.findMany({
        where: { email: email.toLowerCase(), status: 'pending' },
        include: { role: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      })) ?? [];
    if (pending.length === 0) return 0;

    let defaultRole: { id: string; name: string } | null = null;
    let accepted = 0;

    for (const invite of pending) {
      if (invite.expiresAt && invite.expiresAt < now) {
        await this.prisma.invite.updateMany({
          where: { id: invite.id, status: 'pending' },
          data: { status: 'expired' },
        });
        continue;
      }

      let role = invite.role;
      if (!role) {
        const defaultRoleName = this.identityOptions.defaultOrgRole;
        defaultRole ??= await this.prisma.role.findUnique({
          where: { name: defaultRoleName },
          select: { id: true, name: true },
        });
        if (!defaultRole) {
          throw new DatabaseSeedException(`Role "${defaultRoleName}"`, 'npm run prisma:seed');
        }
        role = defaultRole;
      }
      const grantedRole = role;

      const claimed = await this.prisma.$transaction(async (tx) => {
        const marked = await tx.invite.updateMany({
          where: { id: invite.id, status: 'pending' },
          data: { status: 'accepted', acceptedById: userId, acceptedAt: now },
        });
        if (marked.count !== 1) return null;

        const existing = await tx.membership.findUnique({
          where: { orgId_userId: { orgId: invite.orgId, userId } },
          include: { role: { select: { name: true } } },
        });
        const outcome: 'created' | 'upgraded' | 'unchanged' = !existing
          ? 'created'
          : orgRoleRank(grantedRole.name) > orgRoleRank(existing.role.name)
            ? 'upgraded'
            : 'unchanged';
        if (!existing) {
          await tx.membership.create({
            data: { orgId: invite.orgId, userId, roleId: grantedRole.id, lastActiveAt: now },
          });
        } else if (orgRoleRank(grantedRole.name) > orgRoleRank(existing.role.name)) {
          await tx.membership.update({
            where: { id: existing.id },
            data: { roleId: grantedRole.id },
          });
        }

        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            action: ORG_INVITE_ACCEPTED_AUDIT,
            targetType: 'org_invite',
            targetId: invite.id,
            meta: {
              orgId: invite.orgId,
              role: grantedRole.name,
              membership: outcome,
            },
          },
        });
        return outcome;
      });
      if (claimed) {
        accepted += 1;
        if (claimed !== 'unchanged') {
          // #727: committed (the transaction above resolved).
          emitIdentityEvent(this.events, this.logger, IDENTITY_EVENTS.MEMBERSHIP_CHANGED, {
            userId,
            orgId: invite.orgId,
            change: claimed === 'created' ? 'created' : 'role_changed',
            role: grantedRole.name,
            actorUserId: null,
          });
        }
      }
    }

    if (accepted > 0) {
      // Committed: the new or upgraded memberships grant their org roles.
      this.principalCache.invalidateUser(userId);
    }
    return accepted;
  }

  /** How many active (not suspended) memberships the user holds, in any org. */
  async countActiveMemberships(userId: string): Promise<number> {
    return this.prisma.membership.count({
      where: { userId, status: 'active' },
    });
  }
}

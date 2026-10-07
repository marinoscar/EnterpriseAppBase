import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { trace } from '@opentelemetry/api';
import type { MembershipStatus, Prisma } from '@prisma/client';

import { PLATFORM_PRISMA } from '../../core/index';
import type { IdentityPrisma } from '../ports';
import { PrincipalCache } from '../auth/principal-cache/principal-cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  IDENTITY_METRICS,
  IDENTITY_NOTIFIER,
  NOOP_IDENTITY_METRICS,
  type IdentityMetrics,
  type IdentityNotifier,
  type RoleChangedNotice,
} from '../ports';
import { IDENTITY_EVENTS, emitIdentityEvent } from '../identity.events';
import { ORG_ADMIN_ROLE } from '../identity.constants';
import { lastOrgAdminConflict, lockOrganization, writeAudit } from './org-admin.common';
import type { OrgMemberListQueryDto, UpdateOrgMemberDto } from './dto/org-member.dto';

/** Audit actions this service writes. */
export const ORG_MEMBER_AUDIT = {
  UPDATED: 'org:member_updated',
  REMOVED: 'org:member_removed',
} as const;

const MEMBER_INCLUDE = {
  user: { select: { id: true, email: true, displayName: true, providerDisplayName: true } },
  role: { select: { id: true, name: true } },
} satisfies Prisma.MembershipInclude;

type MemberRow = Prisma.MembershipGetPayload<{ include: typeof MEMBER_INCLUDE }>;

/** One member as the API returns it. */
export interface OrgMemberView {
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
  status: MembershipStatus;
  lastActiveAt: Date | null;
  joinedAt: Date;
}

/** What `DELETE /api/org/members/:userId` revoked, for the audit row and the tests. */
export interface RevokedCredentials {
  refreshTokens: number;
  personalAccessTokens: number;
  deviceSessions: number;
}

/**
 * The members of the ACTIVE organization (#726, PP-6.7): list, change a
 * member's org role or status, remove a member.
 *
 * Rules every write enforces, inside one transaction that first locks the
 * organization row (so two concurrent writes cannot both pass a check):
 *
 * - SELF-PROTECTION: an administrator cannot change their own role, suspend
 *   themselves or remove themselves (403). Another administrator has to.
 * - LAST ADMIN: no write may leave the organization without an ACTIVE
 *   `org_admin` (409, `details.reason: LAST_ORG_ADMIN`).
 * - The target is looked up in the caller's active org only: a user id of
 *   another organization is a 404, like one that does not exist.
 *
 * After the commit: the principal cache is invalidated for the member (a
 * changed role or status reaches their next request), and a role change
 * raises `security.role_changed`, outside the transaction. Removing a member
 * also revokes their refresh tokens, personal access tokens and device
 * sessions BOUND TO THIS ORGANIZATION; their other organizations are left
 * alone. An access token already issued stops validating within the
 * principal-cache TTL (at once on this replica), because its `org` claim is
 * no longer an active membership.
 *
 * @internal
 */
@Injectable()
export class OrgMembersService {
  private readonly logger = new Logger(OrgMembersService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: IdentityPrisma,
    private readonly principalCache: PrincipalCache,
    @Inject(IDENTITY_NOTIFIER) private readonly notifications: IdentityNotifier,
    private readonly config: ConfigService,
    @Optional() @Inject(IDENTITY_METRICS)
    private readonly metrics: IdentityMetrics = NOOP_IDENTITY_METRICS,
    // #727: `identity.membership.changed`, after commit.
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /** The organization's members, by email. */
  async list(orgId: string, query: OrgMemberListQueryDto) {
    trace.getActiveSpan()?.setAttribute('org.id', orgId);

    const search = query.search?.trim();
    const where: Prisma.MembershipWhereInput = {
      orgId,
      ...(query.status !== 'all' ? { status: query.status } : {}),
      ...(search
        ? {
            user: {
              OR: [
                { email: { contains: search, mode: 'insensitive' } },
                { displayName: { contains: search, mode: 'insensitive' } },
                { providerDisplayName: { contains: search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.membership.findMany({
        where,
        include: MEMBER_INCLUDE,
        orderBy: { user: { email: 'asc' } },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.membership.count({ where }),
    ]);

    return {
      items: rows.map(toMemberView),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /** Change a member's org role and/or status. */
  async update(
    actorUserId: string,
    orgId: string,
    userId: string,
    dto: UpdateOrgMemberDto,
  ): Promise<OrgMemberView> {
    trace.getActiveSpan()?.setAttribute('org.id', orgId);

    const result = await this.prisma.$transaction(async (tx) => {
      await lockOrganization(tx, orgId);
      const member = await this.findMember(tx, orgId, userId);

      const roleChanges = dto.roleName !== undefined && dto.roleName !== member.role.name;
      const statusChanges = dto.status !== undefined && dto.status !== member.status;

      if (userId === actorUserId && (roleChanges || dto.status === 'suspended')) {
        throw new ForbiddenException('You cannot change your own organization role or suspend yourself');
      }

      let newRole = member.role;
      if (roleChanges) {
        const role = await tx.role.findUnique({
          where: { name: dto.roleName! },
          select: { id: true, name: true, scope: true },
        });
        if (!role || role.scope !== 'org') {
          throw new BadRequestException(`Unknown organization role: ${dto.roleName}`);
        }
        newRole = { id: role.id, name: role.name };
      }
      const newStatus = dto.status ?? member.status;

      const wasActiveAdmin = member.role.name === ORG_ADMIN_ROLE && member.status === 'active';
      const staysActiveAdmin = newRole.name === ORG_ADMIN_ROLE && newStatus === 'active';
      if (wasActiveAdmin && !staysActiveAdmin) {
        await this.assertAnotherActiveAdmin(tx, orgId, userId);
      }

      if (!roleChanges && !statusChanges) {
        return { member, previousRole: member.role.name, roleChanged: false, statusChanged: false };
      }

      const updated = await tx.membership.update({
        where: { id: member.id },
        data: {
          ...(roleChanges ? { roleId: newRole.id } : {}),
          ...(statusChanges ? { status: newStatus } : {}),
        },
        include: MEMBER_INCLUDE,
      });

      await writeAudit(tx, actorUserId, ORG_MEMBER_AUDIT.UPDATED, 'membership', member.id, {
        orgId,
        userId,
        ...(roleChanges ? { previousRole: member.role.name, role: newRole.name } : {}),
        ...(statusChanges ? { previousStatus: member.status, status: newStatus } : {}),
      });

      return { member: updated, previousRole: member.role.name, roleChanged: roleChanges, statusChanged: statusChanges };
    });

    // Committed. The member's next request sees the new role or status.
    this.principalCache.invalidateUser(userId);

    if (result.roleChanged || result.statusChanged) {
      emitIdentityEvent(this.events, this.logger, IDENTITY_EVENTS.MEMBERSHIP_CHANGED, {
        userId,
        orgId,
        change: result.roleChanged ? 'role_changed' : 'status_changed',
        role: result.member.role.name,
        actorUserId,
      });
    }

    if (result.roleChanged) {
      // `security.role_changed` (mandatory, email + in-app), after the commit
      // and outside the transaction. The actor is not in the payload; the
      // audit row records who made the change.
      const payload: RoleChangedNotice = {
        recipientEmail: result.member.user.email,
        previousRoles: [result.previousRole],
        currentRoles: [result.member.role.name],
        changedAt: new Date(),
        ...(this.appUrl() ? { appUrl: this.appUrl() } : {}),
      };
      await this.notifications.roleChanged(userId, payload);
    }

    return toMemberView(result.member);
  }

  /**
   * Remove a member from the organization and revoke their credentials bound
   * to it (refresh tokens, personal access tokens, device sessions).
   */
  async remove(actorUserId: string, orgId: string, userId: string): Promise<RevokedCredentials> {
    trace.getActiveSpan()?.setAttribute('org.id', orgId);

    if (userId === actorUserId) {
      throw new ForbiddenException('You cannot remove yourself from the organization');
    }

    const revoked = await this.prisma.$transaction(async (tx) => {
      await lockOrganization(tx, orgId);
      const member = await this.findMember(tx, orgId, userId);

      if (member.role.name === ORG_ADMIN_ROLE && member.status === 'active') {
        await this.assertAnotherActiveAdmin(tx, orgId, userId);
      }

      await tx.membership.delete({ where: { id: member.id } });

      const now = new Date();
      const [refreshTokens, personalAccessTokens, deviceSessions] = await Promise.all([
        tx.refreshToken.updateMany({
          where: { userId, orgId, revokedAt: null },
          data: { revokedAt: now },
        }),
        tx.personalAccessToken.updateMany({
          where: { userId, orgId, revokedAt: null },
          data: { revokedAt: now },
        }),
        tx.deviceCode.updateMany({
          where: { userId, orgId, revokedAt: null },
          data: { revokedAt: now },
        }),
      ]);
      const counts: RevokedCredentials = {
        refreshTokens: refreshTokens.count,
        personalAccessTokens: personalAccessTokens.count,
        deviceSessions: deviceSessions.count,
      };

      await writeAudit(tx, actorUserId, ORG_MEMBER_AUDIT.REMOVED, 'membership', member.id, {
        orgId,
        userId,
        role: member.role.name,
        revoked: counts,
      });
      return counts;
    });

    // Committed: the membership is gone, so every credential bound to this
    // org stops validating (#724), at once on this replica.
    this.principalCache.invalidateUser(userId);
    this.metrics.add('orgMembersRemoved');
    emitIdentityEvent(this.events, this.logger, IDENTITY_EVENTS.MEMBERSHIP_CHANGED, {
      userId,
      orgId,
      change: 'removed',
      role: null,
      actorUserId,
    });
    this.logger.log(`User ${userId} removed from organization ${orgId} by ${actorUserId}`);
    return revoked;
  }

  /** The membership of `userId` in `orgId`, or a 404. */
  private async findMember(tx: Prisma.TransactionClient, orgId: string, userId: string): Promise<MemberRow> {
    const member = await tx.membership.findUnique({
      where: { orgId_userId: { orgId, userId } },
      include: MEMBER_INCLUDE,
    });
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    return member;
  }

  /** 409 unless another ACTIVE `org_admin` remains in the organization. */
  private async assertAnotherActiveAdmin(
    tx: Prisma.TransactionClient,
    orgId: string,
    userId: string,
  ): Promise<void> {
    const others = await tx.membership.count({
      where: {
        orgId,
        userId: { not: userId },
        status: 'active',
        role: { name: ORG_ADMIN_ROLE },
      },
    });
    if (others === 0) {
      throw lastOrgAdminConflict();
    }
  }

  private appUrl(): string | undefined {
    const appUrl = this.config.get<string>('appUrl');
    return appUrl ? appUrl.replace(/\/+$/, '') : undefined;
  }
}

function toMemberView(row: MemberRow): OrgMemberView {
  return {
    userId: row.userId,
    email: row.user.email,
    displayName: row.user.displayName || row.user.providerDisplayName || null,
    role: row.role.name,
    status: row.status,
    lastActiveAt: row.lastActiveAt,
    joinedAt: row.createdAt,
  };
}

// =============================================================================
// GroupInvitesService: invitations to a group (issue #728, PP-7.1)
// =============================================================================
//
// An invite names an e-mail address (stored lower-cased) and the role the
// invitee gets. Its state is derived from its timestamps WHEN IT IS READ:
//
//   accepted_at set  -> accepted      declined_at set -> declined
//   revoked_at set   -> revoked       expires_at past -> expired
//   otherwise        -> pending
//
// so no cron sweeps expired invites. `group_invites_pending_uniq_idx` (raw SQL)
// allows ONE pending row per (group, address): a second invite is 409
// `INVITE_PENDING`, while a declined or revoked address can be invited again.
// An expired pending row would still hold the index, so creating an invite
// first closes the address's expired rows (marks them revoked).
//
// The invitee answers from `GET /api/groups/invites/mine` (every organization
// they belong to) with accept or decline. The address must be the caller's:
// anyone else's invite is 404. An expired invite is 410 `INVITE_EXPIRED`.
//
// The `groups.invitation` notification is dispatched AFTER the invite's
// transaction commits, outside it: to the account when the address has one,
// else to the address (`notifyAddress`).
// =============================================================================

import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  CreateGroupInviteInput,
  GroupInviteDto,
  GroupInviteList,
  GroupInviteListQuery,
  GroupInviteStatus,
  GroupMembershipDto,
  MyGroupInviteDto,
  MyGroupInviteList,
} from '@marinoscar/platform-contract/sharing';

import type { Principal } from '../../core/index';
import { Trace } from '../../otel-core/index';
import { asSharingTx, type GroupInviteRow, type SharingTx } from '../data/sharing-tx';
import { SHARING_ERROR_REASONS, conflict, inviteExpired, inviteNotFound, notAnOrgMember } from '../errors';
import { SHARING_EVENTS } from '../events';
import { SHARING_DATA, SHARING_TENANCY, type SharingDataPort, type SharingTenancy } from '../ports';
import { SHARING_OPTIONS, type ResolvedSharingModuleOptions } from '../sharing.options';
import { iso, isUniqueViolation, lockGroup, paged, requireActiveOrg, writeAudit } from './group-common';
import { GroupMembershipService } from './group-membership.service';
import { SharingEffects } from './sharing-effects';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Optional injection token of the invites' clock (ms since epoch); tests inject one.
 *
 * @stability experimental
 */
export const GROUP_INVITES_CLOCK: unique symbol = Symbol.for('@marinoscar/platform/sharing/GROUP_INVITES_CLOCK');

/**
 * The status of an invite row at `now`, derived from its timestamps.
 *
 * @param row - the invite's timestamps.
 * @param now - the instant to judge expiry at.
 * @returns the status.
 *
 * @stability experimental
 */
export function inviteStatus(row: Pick<GroupInviteRow, 'acceptedAt' | 'declinedAt' | 'revokedAt' | 'expiresAt'>, now: Date): GroupInviteStatus {
  if (row.acceptedAt) return 'accepted';
  if (row.declinedAt) return 'declined';
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

/** The `where` of a row that is still open (neither accepted, declined nor revoked). */
const OPEN = { acceptedAt: null, declinedAt: null, revokedAt: null } as const;

/**
 * One invite row as a group admin sees it.
 *
 * @param row - the `group_invites` row.
 * @param now - the instant its status is judged at.
 * @returns the wire shape.
 *
 * @stability experimental
 */
export function toGroupInviteDto(row: GroupInviteRow, now: Date): GroupInviteDto {
  return {
    id: row.id,
    groupId: row.groupId,
    orgId: row.orgId,
    email: row.email,
    role: row.role,
    status: inviteStatus(row, now),
    invitedById: row.invitedById,
    expiresAt: iso(row.expiresAt),
    acceptedAt: iso(row.acceptedAt),
    declinedAt: iso(row.declinedAt),
    revokedAt: iso(row.revokedAt),
    createdAt: iso(row.createdAt)!,
  };
}

/** The organizations a principal belongs to and may act in, active one first. */
function orgsOf(principal: Principal): string[] {
  const listed = (principal.memberships ?? []).filter((m) => m.status !== 'suspended').map((m) => m.orgId);
  const all = principal.activeOrgId ? [principal.activeOrgId, ...listed] : listed;
  return [...new Set(all)];
}

/**
 * Invitations to groups: the admin routes and the invitee's answers.
 *
 * @stability experimental
 */
@Injectable()
export class GroupInvitesService {
  constructor(
    @Inject(SHARING_DATA) private readonly data: SharingDataPort,
    @Inject(SHARING_OPTIONS) private readonly options: ResolvedSharingModuleOptions,
    private readonly membership: GroupMembershipService,
    private readonly effects: SharingEffects,
    @Optional() @Inject(SHARING_TENANCY) private readonly tenancy?: SharingTenancy,
    @Optional() @Inject(GROUP_INVITES_CLOCK) private readonly clock: () => number = Date.now,
  ) {}

  private now(): Date {
    return new Date(this.clock());
  }

  /**
   * `GET /api/groups/:id/invites`.
   *
   * @param principal - the caller (group `admin`, or `groups:admin`).
   * @param groupId - the group.
   * @param query - page, and `pending` (default) or `all`.
   * @returns a page of invites, newest first.
   */
  @Trace('sharing.group.invites.list')
  async list(principal: Principal, groupId: string, query: GroupInviteListQuery): Promise<GroupInviteList> {
    const orgId = requireActiveOrg(principal);
    const now = this.now();
    return this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      await this.membership.access(tx, principal, orgId, groupId, 'admin');
      const where =
        query.status === 'all'
          ? { groupId }
          : { groupId, ...OPEN, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
      const total = await tx.groupInvite.count({ where });
      const rows = await tx.groupInvite.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return paged(rows.map((row) => toGroupInviteDto(row, now)), total, query.page, query.pageSize);
    });
  }

  /** Whether an address may be invited into `orgId` (multi mode: a member, or invited to the org). */
  private async addressInOrg(tx: SharingTx, orgId: string, email: string, now: Date): Promise<{ userId: string | null; allowed: boolean }> {
    const user = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, isActive: true } });
    const member = user
      ? await tx.membership.findFirst({ where: { orgId, userId: user.id, status: 'active' }, select: { userId: true } })
      : null;
    if (member) return { userId: user!.id, allowed: true };
    if ((this.tenancy?.mode() ?? 'single') === 'single') return { userId: user?.id ?? null, allowed: true };
    const orgInvite = await tx.invite.findFirst({
      where: { orgId, email, status: 'pending', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { orgId: true },
    });
    return { userId: user?.id ?? null, allowed: orgInvite !== null };
  }

  /**
   * `POST /api/groups/:id/invites`.
   *
   * @param principal - the caller (group `admin`, or `groups:admin`).
   * @param groupId - the group.
   * @param input - the address and role.
   * @returns the invite.
   * @throws UnprocessableEntityException 422 `NOT_AN_ORG_MEMBER` (multi mode).
   * @throws ConflictException 409 `INVITE_PENDING` or `ALREADY_A_MEMBER`.
   */
  @Trace('sharing.group.invites.create')
  async create(principal: Principal, groupId: string, input: CreateGroupInviteInput): Promise<GroupInviteDto> {
    const orgId = requireActiveOrg(principal);
    const now = this.now();
    const ttl = this.options.groups.inviteTtlDays;

    const result = await this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      const { group } = await this.membership.access(tx, principal, orgId, groupId, 'admin');
      const recipient = await this.addressInOrg(tx, orgId, input.email, now);
      if (!recipient.allowed) throw notAnOrgMember();
      if (recipient.userId) {
        const already = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: recipient.userId } } });
        if (already) throw conflict(SHARING_ERROR_REASONS.ALREADY_A_MEMBER, 'That person is already a member of the group');
      }

      // An expired pending row still holds group_invites_pending_uniq_idx: close it.
      await tx.groupInvite.updateMany({
        where: { groupId, email: input.email, ...OPEN, expiresAt: { lte: now } },
        data: { revokedAt: now },
      });
      let invite: GroupInviteRow;
      try {
        invite = await tx.groupInvite.create({
          data: {
            groupId,
            orgId,
            email: input.email,
            role: input.role,
            invitedById: principal.userId,
            expiresAt: ttl === null ? null : new Date(now.getTime() + ttl * DAY_MS),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict(SHARING_ERROR_REASONS.INVITE_PENDING, 'That address already has a pending invitation to this group');
        }
        throw error;
      }
      await writeAudit(tx, {
        orgId,
        actorUserId: principal.userId,
        action: 'group:invite_created',
        groupId,
        meta: { inviteId: invite.id, role: invite.role, existingAccount: recipient.userId !== null },
      });
      return { invite, groupName: group.name, recipientUserId: recipient.userId };
    });

    // After the commit, outside the transaction (CLAUDE.md invariant).
    this.effects.committed({
      op: 'invite_create',
      event: {
        name: SHARING_EVENTS.INVITE_CREATED,
        payload: { orgId, groupId, actorUserId: principal.userId, inviteId: result.invite.id, role: result.invite.role },
      },
    });
    this.effects.notifyInvitation(
      { userId: result.recipientUserId, email: result.invite.email },
      {
        recipientEmail: result.invite.email,
        groupName: result.groupName,
        role: result.invite.role,
        ...(principal.email ? { invitedBy: principal.email } : {}),
        ...(result.invite.expiresAt ? { expiresAt: result.invite.expiresAt.toISOString() } : {}),
      },
      result.invite.id,
    );
    return toGroupInviteDto(result.invite, now);
  }

  /**
   * `DELETE /api/groups/:id/invites/:inviteId`: revokes a pending invite.
   *
   * @param principal - the caller (group `admin`, or `groups:admin`).
   * @param groupId - the group.
   * @param inviteId - the invite.
   * @throws NotFoundException 404 when the group has no such invite.
   * @throws ConflictException 409 `INVITE_NOT_PENDING` when it was already answered or revoked.
   */
  @Trace('sharing.group.invites.revoke')
  async revoke(principal: Principal, groupId: string, inviteId: string): Promise<void> {
    const orgId = requireActiveOrg(principal);
    const now = this.now();
    await this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      await this.membership.access(tx, principal, orgId, groupId, 'admin');
      const invite = await tx.groupInvite.findFirst({ where: { id: inviteId, groupId } });
      if (!invite) throw inviteNotFound();
      const status = inviteStatus(invite, now);
      if (status !== 'pending' && status !== 'expired') {
        throw conflict(SHARING_ERROR_REASONS.INVITE_NOT_PENDING, `The invitation is already ${status}`);
      }
      await tx.groupInvite.update({ where: { id: inviteId }, data: { revokedAt: now } });
      await writeAudit(tx, { orgId, actorUserId: principal.userId, action: 'group:invite_revoked', groupId, meta: { inviteId } });
    });
    this.effects.committed({ op: 'invite_revoke' });
  }

  /**
   * `GET /api/groups/invites/mine`: pending, unexpired invites to the
   * caller's (verified) address, in every organization the caller belongs to.
   *
   * @param principal - the caller.
   * @returns newest first.
   */
  @Trace('sharing.group.invites.mine')
  async mine(principal: Principal): Promise<MyGroupInviteList> {
    const email = principal.email.toLowerCase();
    const now = this.now();
    const items: MyGroupInviteDto[] = [];
    for (const orgId of orgsOf(principal)) {
      const rows = await this.data.runInOrg({ orgId, userId: principal.userId }, (raw) =>
        asSharingTx(raw).groupInvite.findMany<GroupInviteRow & { group: { name: string } }>({
          where: { orgId, email, ...OPEN, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          include: { group: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      );
      for (const row of rows) {
        items.push({
          id: row.id,
          groupId: row.groupId,
          groupName: row.group.name,
          orgId: row.orgId,
          role: row.role,
          invitedById: row.invitedById,
          expiresAt: iso(row.expiresAt),
          createdAt: iso(row.createdAt)!,
        });
      }
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { items };
  }

  /** Finds the caller's invite in one of its organizations, or throws 404 / 410. */
  private async answerable(principal: Principal, inviteId: string, now: Date): Promise<{ orgId: string; invite: GroupInviteRow }> {
    const email = principal.email.toLowerCase();
    for (const orgId of orgsOf(principal)) {
      const invite = await this.data.runInOrg({ orgId, userId: principal.userId }, (raw) =>
        asSharingTx(raw).groupInvite.findFirst({ where: { id: inviteId, orgId } }),
      );
      if (!invite) continue;
      // Someone else's invite is indistinguishable from no invite.
      if (invite.email !== email) throw inviteNotFound();
      const status = inviteStatus(invite, now);
      if (status === 'expired') throw inviteExpired();
      if (status !== 'pending') throw inviteNotFound();
      return { orgId, invite };
    }
    throw inviteNotFound();
  }

  /**
   * `POST /api/groups/invites/:inviteId/accept`: joins the group with the
   * invite's role. Accepting when already a member keeps the current role.
   *
   * @param principal - the caller, whose address the invite names.
   * @param inviteId - the invite.
   * @returns the membership.
   * @throws NotFoundException 404 for another address's invite, an unknown or an answered one.
   * @throws GoneException 410 `INVITE_EXPIRED`.
   * @throws ConflictException 409 `GROUP_FULL`.
   */
  @Trace('sharing.group.invites.accept')
  async accept(principal: Principal, inviteId: string): Promise<GroupMembershipDto> {
    const now = this.now();
    const { orgId, invite } = await this.answerable(principal, inviteId, now);
    const groupId = invite.groupId;

    const result = await this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      await lockGroup(tx, groupId);
      // Re-check under the lock: a concurrent revoke or second accept loses.
      const fresh = await tx.groupInvite.findFirst({ where: { id: inviteId, orgId, ...OPEN } });
      if (!fresh) throw inviteNotFound();
      if (inviteStatus(fresh, now) === 'expired') throw inviteExpired();

      const existing = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: principal.userId } } });
      let role = existing?.role ?? fresh.role;
      if (!existing) {
        if ((await tx.groupMember.count({ where: { groupId } })) >= this.options.groups.maxMembersPerGroup) {
          throw conflict(SHARING_ERROR_REASONS.GROUP_FULL, 'The group has reached its member limit');
        }
        const created = await tx.groupMember.create({
          data: { groupId, orgId, userId: principal.userId, role: fresh.role, addedById: fresh.invitedById },
        });
        role = created.role;
      }
      await tx.groupInvite.update({ where: { id: inviteId }, data: { acceptedAt: now, acceptedById: principal.userId } });
      await writeAudit(tx, {
        orgId,
        actorUserId: principal.userId,
        action: 'group:invite_accepted',
        groupId,
        meta: { inviteId, role, alreadyMember: existing !== null },
      });
      return { role, joined: !existing };
    });

    const base = { orgId, groupId, actorUserId: principal.userId };
    this.effects.committed({
      op: 'invite_accept',
      invalidate: [principal.userId],
      events: [
        { name: SHARING_EVENTS.INVITE_ACCEPTED, payload: { ...base, inviteId, role: result.role } },
        ...(result.joined
          ? [{ name: SHARING_EVENTS.MEMBER_ADDED, payload: { ...base, userId: principal.userId, role: result.role, previousRole: null } }]
          : []),
      ],
    });
    return { groupId, orgId, role: result.role };
  }

  /**
   * `POST /api/groups/invites/:inviteId/decline`.
   *
   * @param principal - the caller, whose address the invite names.
   * @param inviteId - the invite.
   * @throws NotFoundException 404 for another address's invite, an unknown or an answered one.
   * @throws GoneException 410 `INVITE_EXPIRED`.
   */
  @Trace('sharing.group.invites.decline')
  async decline(principal: Principal, inviteId: string): Promise<void> {
    const now = this.now();
    const { orgId, invite } = await this.answerable(principal, inviteId, now);
    await this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      const { count } = await tx.groupInvite.updateMany({ where: { id: inviteId, orgId, ...OPEN }, data: { declinedAt: now } });
      if (count === 0) throw inviteNotFound();
      await writeAudit(tx, { orgId, actorUserId: principal.userId, action: 'group:invite_declined', groupId: invite.groupId, meta: { inviteId } });
    });
    this.effects.committed({ op: 'invite_decline' });
  }
}

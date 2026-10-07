// =============================================================================
// GroupMembershipService: who may do what in a group, and the member routes
// (issue #728, PP-7.1; modelled on MemoriaHub's circle-membership.service.ts)
// =============================================================================
//
// ACCESS (`access`), decided inside the request's org-scoped transaction:
//
//   - the group must exist IN THE CALLER'S ACTIVE ORGANIZATION (row-level
//     security hides every other organization's rows anyway);
//   - `member`: any role, or `groups:admin` (the organization-wide override,
//     MemoriaHub's CIRCLES_MANAGE_ANY); anyone else gets 404, never 403, so a
//     guessed id discloses nothing (as kvox's TranscriptAccessService does);
//   - `admin`: the group `admin` role, or `groups:admin`; a member with a lower
//     role gets 403 (they can already see the group), a non-member 404.
//
// THE LAST-ADMIN RULE. A group always has at least one `admin`: the last one
// can neither be demoted nor leave (409 `LAST_GROUP_ADMIN`). The check runs
// after `SELECT ... FOR UPDATE` on the group row, so two admins demoting each
// other at once cannot both pass it. Promote another member first.
// =============================================================================

import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type {
  AddGroupMemberInput,
  GroupMemberDto,
  GroupMemberList,
  GroupRole,
  PageQuery,
} from '@marinoscar/platform-contract/sharing';

import type { Principal } from '../../core/index';
import { Trace } from '../../otel-core/index';
import { asSharingTx, type GroupMemberRow, type GroupRow, type SharingTx, type UserRow } from '../data/sharing-tx';
import {
  SHARING_ERROR_REASONS,
  conflict,
  groupAdminRequired,
  groupNotFound,
  lastGroupAdmin,
  lookupThrottled,
  memberNotFound,
  notAnOrgMember,
} from '../errors';
import { SHARING_EVENTS } from '../events';
import { SHARING_PERMISSIONS } from '../permissions';
import { SHARING_DATA, type SharingDataPort } from '../ports';
import { SHARING_OPTIONS, type ResolvedSharingModuleOptions } from '../sharing.options';
import { holds, isGroupsAdmin, iso, lockGroup, paged, requireActiveOrg, writeAudit } from './group-common';
import { MemberLookupThrottle } from './member-lookup-throttle';
import { SharingEffects } from './sharing-effects';

/**
 * What `GroupMembershipService.access` found.
 *
 * @stability experimental
 */
export interface GroupAccess {
  /** The group row. */
  group: GroupRow;
  /** The caller's role in it, or `null` (a `groups:admin` holder who is not a member). */
  myRole: GroupRole | null;
}

/** A member row with the user columns the response shows. */
type MemberWithUser = GroupMemberRow & { user: Pick<UserRow, 'email' | 'displayName' | 'providerDisplayName'> };

const USER_COLUMNS = { select: { email: true, displayName: true, providerDisplayName: true } } as const;

/**
 * One member row (with its user columns) as the API returns it.
 *
 * @param row - the `group_members` row with `user`.
 * @returns the wire shape.
 *
 * @stability experimental
 */
export function toGroupMemberDto(row: MemberWithUser): GroupMemberDto {
  return {
    groupId: row.groupId,
    userId: row.userId,
    role: row.role,
    email: row.user.email,
    displayName: row.user.displayName ?? row.user.providerDisplayName ?? null,
    addedById: row.addedById,
    createdAt: iso(row.createdAt)!,
  };
}

/**
 * Group access decisions, the last-admin rule and the member routes.
 *
 * @stability experimental
 */
@Injectable()
export class GroupMembershipService {
  constructor(
    @Inject(SHARING_DATA) private readonly data: SharingDataPort,
    @Inject(SHARING_OPTIONS) private readonly options: ResolvedSharingModuleOptions,
    private readonly throttle: MemberLookupThrottle,
    private readonly effects: SharingEffects,
  ) {}

  /**
   * Loads a group of the caller's active organization and checks the caller
   * may act on it. Runs inside the caller's org-scoped transaction.
   *
   * @param tx - the org-scoped transaction client.
   * @param principal - the caller.
   * @param orgId - the caller's active organization.
   * @param groupId - the group.
   * @param need - `member` (read) or `admin` (manage).
   * @returns the group and the caller's role.
   * @throws NotFoundException (404) when the group does not exist or the caller may not see it.
   * @throws ForbiddenException (403) when the caller is a member without the `admin` role.
   */
  async access(tx: SharingTx, principal: Principal, orgId: string, groupId: string, need: 'member' | 'admin'): Promise<GroupAccess> {
    const group = await tx.group.findFirst({ where: { id: groupId, orgId } });
    if (!group) throw groupNotFound();
    const membership = await tx.groupMember.findUnique<Pick<GroupMemberRow, 'role'>>({
      where: { groupId_userId: { groupId, userId: principal.userId } },
      select: { role: true },
    });
    const myRole = membership?.role ?? null;
    if (isGroupsAdmin(principal)) return { group, myRole };
    if (myRole === null) throw groupNotFound();
    if (need === 'admin' && myRole !== 'admin') throw groupAdminRequired();
    return { group, myRole };
  }

  /** Counts the admins of a locked group. */
  private async adminCount(tx: SharingTx, groupId: string): Promise<number> {
    return tx.groupMember.count({ where: { groupId, role: 'admin' } });
  }

  /**
   * `GET /api/groups/:id/members`: admins first, then by join date.
   *
   * @param principal - the caller (member, or `groups:admin`).
   * @param groupId - the group.
   * @param query - the page.
   * @returns a page of members.
   */
  @Trace('sharing.group.members.list')
  async list(principal: Principal, groupId: string, query: PageQuery): Promise<GroupMemberList> {
    const orgId = requireActiveOrg(principal);
    return this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      await this.access(tx, principal, orgId, groupId, 'member');
      const [total, rows] = await Promise.all([
        tx.groupMember.count({ where: { groupId } }),
        tx.groupMember.findMany<MemberWithUser>({
          where: { groupId },
          include: { user: USER_COLUMNS },
          orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      return paged(rows.map(toGroupMemberDto), total, query.page, query.pageSize);
    });
  }

  /**
   * `POST /api/groups/:id/members`: adds a member of the organization, by
   * user id or by e-mail. A failed lookup by e-mail counts against the
   * caller's throttle.
   *
   * @param principal - the caller (group `admin`, or `groups:admin`).
   * @param groupId - the group.
   * @param input - `email` or `userId`, and the role.
   * @returns the new member.
   * @throws HttpException 429 `LOOKUP_THROTTLED` after too many failed lookups by e-mail.
   * @throws UnprocessableEntityException 422 `NOT_AN_ORG_MEMBER`.
   * @throws ConflictException 409 `ALREADY_A_MEMBER` or `GROUP_FULL`.
   */
  @Trace('sharing.group.members.add')
  async add(principal: Principal, groupId: string, input: AddGroupMemberInput): Promise<GroupMemberDto> {
    const orgId = requireActiveOrg(principal);
    const byEmail = input.email !== undefined;
    if (byEmail) {
      const wait = this.throttle.retryAfterMs(principal.userId);
      if (wait > 0) throw lookupThrottled(wait);
    }

    let missed = false;
    let created: MemberWithUser;
    try {
      created = await this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
        const tx = asSharingTx(raw);
        await this.access(tx, principal, orgId, groupId, 'admin');

        const select = { id: true, email: true, displayName: true, providerDisplayName: true, isActive: true };
        const target = byEmail
          ? await tx.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' } }, select })
          : await tx.user.findUnique({ where: { id: input.userId }, select });
        const inOrg =
          target && target.isActive
            ? await tx.membership.findFirst({ where: { orgId, userId: target.id, status: 'active' }, select: { userId: true } })
            : null;
        if (!target || !inOrg) {
          missed = byEmail;
          throw notAnOrgMember();
        }

        await lockGroup(tx, groupId);
        const existing = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: target.id } } });
        if (existing) throw conflict(SHARING_ERROR_REASONS.ALREADY_A_MEMBER, 'That person is already a member of the group');
        if ((await tx.groupMember.count({ where: { groupId } })) >= this.options.groups.maxMembersPerGroup) {
          throw conflict(SHARING_ERROR_REASONS.GROUP_FULL, 'The group has reached its member limit');
        }

        const row = await tx.groupMember.create<MemberWithUser>({
          data: { groupId, orgId, userId: target.id, role: input.role, addedById: principal.userId },
          include: { user: USER_COLUMNS },
        });
        await writeAudit(tx, {
          orgId,
          actorUserId: principal.userId,
          action: 'group:member_added',
          groupId,
          meta: { userId: target.id, role: input.role },
        });
        return row;
      });
    } catch (error) {
      if (missed) this.throttle.recordMiss(principal.userId);
      throw error;
    }

    this.effects.committed({
      op: 'member_add',
      invalidate: [created.userId],
      event: {
        name: SHARING_EVENTS.MEMBER_ADDED,
        payload: { orgId, groupId, actorUserId: principal.userId, userId: created.userId, role: created.role, previousRole: null },
      },
    });
    return toGroupMemberDto(created);
  }

  /**
   * `PATCH /api/groups/:id/members/:userId`: changes a member's role. The
   * last `admin` cannot be demoted.
   *
   * @param principal - the caller (group `admin`, or `groups:admin`).
   * @param groupId - the group.
   * @param userId - the member.
   * @param role - the new role.
   * @returns the member.
   * @throws ConflictException 409 `LAST_GROUP_ADMIN`.
   */
  @Trace('sharing.group.members.change_role')
  async changeRole(principal: Principal, groupId: string, userId: string, role: GroupRole): Promise<GroupMemberDto> {
    const orgId = requireActiveOrg(principal);
    const result = await this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      await this.access(tx, principal, orgId, groupId, 'admin');
      await lockGroup(tx, groupId);
      const target = await tx.groupMember.findUnique<MemberWithUser>({
        where: { groupId_userId: { groupId, userId } },
        include: { user: USER_COLUMNS },
      });
      if (!target) throw memberNotFound();
      if (target.role === role) return { row: target, previousRole: role, changed: false };
      if (target.role === 'admin' && (await this.adminCount(tx, groupId)) <= 1) throw lastGroupAdmin();

      const row = await tx.groupMember.update<MemberWithUser>({
        where: { groupId_userId: { groupId, userId } },
        data: { role },
        include: { user: USER_COLUMNS },
      });
      await writeAudit(tx, {
        orgId,
        actorUserId: principal.userId,
        action: 'group:member_role_changed',
        groupId,
        meta: { userId, role, previousRole: target.role },
      });
      return { row, previousRole: target.role, changed: true };
    });

    if (result.changed) {
      this.effects.committed({
        op: 'member_role_change',
        invalidate: [userId],
        event: {
          name: SHARING_EVENTS.MEMBER_ROLE_CHANGED,
          payload: { orgId, groupId, actorUserId: principal.userId, userId, role, previousRole: result.previousRole },
        },
      });
    }
    return toGroupMemberDto(result.row);
  }

  /**
   * `DELETE /api/groups/:id/members/:userId`: a member leaves (self, needs
   * only `groups:read`) or a group admin removes them (needs `groups:write`).
   * The last `admin` cannot leave.
   *
   * @param principal - the caller.
   * @param groupId - the group.
   * @param userId - the member to remove (the caller's own id to leave).
   * @throws ForbiddenException 403 when removing someone else without `groups:write`.
   * @throws ConflictException 409 `LAST_GROUP_ADMIN`.
   */
  @Trace('sharing.group.members.remove')
  async remove(principal: Principal, groupId: string, userId: string): Promise<void> {
    const orgId = requireActiveOrg(principal);
    const self = userId === principal.userId;
    if (!self && !holds(principal, SHARING_PERMISSIONS.GROUPS_WRITE)) {
      throw new ForbiddenException('Removing another member requires groups:write');
    }

    const removed = await this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      await this.access(tx, principal, orgId, groupId, self ? 'member' : 'admin');
      await lockGroup(tx, groupId);
      const target = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
      if (!target) throw memberNotFound();
      if (target.role === 'admin' && (await this.adminCount(tx, groupId)) <= 1) throw lastGroupAdmin();
      await tx.groupMember.delete({ where: { groupId_userId: { groupId, userId } } });
      await writeAudit(tx, {
        orgId,
        actorUserId: principal.userId,
        action: 'group:member_removed',
        groupId,
        meta: { userId, role: target.role, self },
      });
      return target;
    });

    this.effects.committed({
      op: 'member_remove',
      invalidate: [userId],
      event: {
        name: SHARING_EVENTS.MEMBER_REMOVED,
        payload: { orgId, groupId, actorUserId: principal.userId, userId, role: null, previousRole: removed.role },
      },
    });
  }
}

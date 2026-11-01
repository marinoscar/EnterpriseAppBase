// =============================================================================
// GroupsService: the group routes (issue #728, PP-7.1)
// =============================================================================
//
// Every query runs in ONE transaction scoped to the caller's ACTIVE
// organization (`SharingDataPort.runInOrg`), so row-level security confines
// it to that organization whatever id the request names. Audit rows are
// written in the same transaction; events, metrics and cache invalidation
// happen after it commits (`SharingEffects`).
// =============================================================================

import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type {
  CreateGroupInput,
  GroupDto,
  GroupList,
  GroupListQuery,
  GroupRole,
  UpdateGroupInput,
} from '@marinoscar/platform-contract/sharing';

import type { Principal } from '../../core/index';
import { Trace } from '../../otel-core/index';
import { asSharingTx, type GroupRow } from '../data/sharing-tx';
import { SHARING_ERROR_REASONS, conflict, groupOwnsResources } from '../errors';
import { SHARING_EVENTS } from '../events';
import { groupOwnedResourceRegistry } from '../ownership';
import { SHARING_DATA, type SharingDataPort } from '../ports';
import { SHARING_OPTIONS, type ResolvedSharingModuleOptions } from '../sharing.options';
import { isGroupsAdmin, iso, lockGroup, paged, requireActiveOrg, writeAudit } from './group-common';
import { GroupMembershipService } from './group-membership.service';
import { SharingEffects } from './sharing-effects';

/** A group row with its member count and (when asked) the caller's membership. */
type GroupWithCounts = GroupRow & {
  _count: { members: number };
  members?: Array<{ role: GroupRole }>;
};

/**
 * One group row as the API returns it.
 *
 * @param row - the `groups` row.
 * @param memberCount - its member count.
 * @param myRole - the caller's role, or `null`.
 * @returns the wire shape.
 *
 * @stability experimental
 */
export function toGroupDto(row: GroupRow, memberCount: number, myRole: GroupRole | null): GroupDto {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    description: row.description,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdById: row.createdById,
    version: row.version,
    myRole,
    memberCount,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

/**
 * Create, list, read, update and delete groups.
 *
 * @stability experimental
 */
@Injectable()
export class GroupsService {
  constructor(
    @Inject(SHARING_DATA) private readonly data: SharingDataPort,
    @Inject(SHARING_OPTIONS) private readonly options: ResolvedSharingModuleOptions,
    private readonly membership: GroupMembershipService,
    private readonly effects: SharingEffects,
  ) {}

  /**
   * `GET /api/groups`: `scope=mine` lists the groups the caller belongs to;
   * `scope=all` every group of the organization (`groups:admin`).
   *
   * @param principal - the caller.
   * @param query - scope and page.
   * @returns a page of groups, by name.
   * @throws ForbiddenException 403 for `scope=all` without `groups:admin`.
   */
  @Trace('sharing.group.list')
  async list(principal: Principal, query: GroupListQuery): Promise<GroupList> {
    const orgId = requireActiveOrg(principal);
    if (query.scope === 'all' && !isGroupsAdmin(principal)) {
      throw new ForbiddenException('Listing every group of the organization requires groups:admin');
    }
    const where =
      query.scope === 'all' ? { orgId } : { orgId, members: { some: { userId: principal.userId } } };

    return this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      const total = await tx.group.count({ where });
      const rows = await tx.group.findMany<GroupWithCounts>({
        where,
        include: {
          _count: { select: { members: true } },
          members: { where: { userId: principal.userId }, select: { role: true } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const items = rows.map((row) => toGroupDto(row, row._count.members, row.members?.[0]?.role ?? null));
      return paged(items, total, query.page, query.pageSize);
    });
  }

  /**
   * `POST /api/groups`: creates the group and makes the caller its `admin`,
   * in one transaction.
   *
   * @param principal - the caller (`groups:write`).
   * @param input - name, description, metadata.
   * @returns the group.
   * @throws ConflictException 409 `GROUP_LIMIT_REACHED` past `maxGroupsPerCreator`.
   */
  @Trace('sharing.group.create')
  async create(principal: Principal, input: CreateGroupInput): Promise<GroupDto> {
    const orgId = requireActiveOrg(principal);
    const group = await this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      const mine = await tx.group.count({ where: { orgId, createdById: principal.userId } });
      if (mine >= this.options.groups.maxGroupsPerCreator) {
        throw conflict(SHARING_ERROR_REASONS.GROUP_LIMIT_REACHED, 'You have created the maximum number of groups in this organization');
      }
      const created = await tx.group.create({
        data: {
          orgId,
          name: input.name,
          description: input.description ?? null,
          ...(input.metadata ? { metadata: input.metadata } : {}),
          createdById: principal.userId,
        },
      });
      await tx.groupMember.create({
        data: { groupId: created.id, orgId, userId: principal.userId, role: 'admin', addedById: principal.userId },
      });
      await writeAudit(tx, { orgId, actorUserId: principal.userId, action: 'group:created', groupId: created.id });
      return created;
    });

    this.effects.committed({
      op: 'group_create',
      invalidate: [principal.userId],
      events: [
        { name: SHARING_EVENTS.GROUP_CREATED, payload: { orgId, groupId: group.id, actorUserId: principal.userId } },
        {
          name: SHARING_EVENTS.MEMBER_ADDED,
          payload: { orgId, groupId: group.id, actorUserId: principal.userId, userId: principal.userId, role: 'admin', previousRole: null },
        },
      ],
    });
    return toGroupDto(group, 1, 'admin');
  }

  /**
   * `GET /api/groups/:id`.
   *
   * @param principal - the caller (member, or `groups:admin`).
   * @param groupId - the group.
   * @returns the group.
   * @throws NotFoundException 404 for a group the caller may not see.
   */
  @Trace('sharing.group.get')
  async get(principal: Principal, groupId: string): Promise<GroupDto> {
    const orgId = requireActiveOrg(principal);
    return this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      const { group, myRole } = await this.membership.access(tx, principal, orgId, groupId, 'member');
      const memberCount = await tx.groupMember.count({ where: { groupId } });
      return toGroupDto(group, memberCount, myRole);
    });
  }

  /**
   * `PATCH /api/groups/:id`, conditional on `If-Match` when given.
   *
   * @param principal - the caller (group `admin`, or `groups:admin`).
   * @param groupId - the group.
   * @param input - the fields to change.
   * @param expectedVersion - the `If-Match` version, or `undefined` to overwrite.
   * @returns the group.
   * @throws ConflictException 409 `VERSION_CONFLICT` when the version moved.
   */
  @Trace('sharing.group.update')
  async update(principal: Principal, groupId: string, input: UpdateGroupInput, expectedVersion?: number): Promise<GroupDto> {
    const orgId = requireActiveOrg(principal);
    const result = await this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      const { group, myRole } = await this.membership.access(tx, principal, orgId, groupId, 'admin');
      const data: Record<string, unknown> = { version: { increment: 1 } };
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;
      // A JSON column is cleared with SQL NULL, which Prisma spells
      // `Prisma.DbNull` (a generated-client value the package cannot import).
      if (input.metadata !== undefined && input.metadata !== null) data.metadata = input.metadata;

      const { count } = await tx.group.updateMany({
        where: { id: groupId, orgId, version: expectedVersion ?? group.version },
        data,
      });
      if (count === 0) {
        throw conflict(SHARING_ERROR_REASONS.VERSION_CONFLICT, 'The group changed since you read it. Reload and try again.');
      }
      if (input.metadata === null) {
        await tx.$executeRaw`UPDATE groups SET metadata = NULL WHERE id = ${groupId}::uuid`;
      }
      const updated = (await tx.group.findFirst({ where: { id: groupId, orgId } }))!;
      const memberCount = await tx.groupMember.count({ where: { groupId } });
      await writeAudit(tx, {
        orgId,
        actorUserId: principal.userId,
        action: 'group:updated',
        groupId,
        meta: { fields: Object.keys(input).sort().join(','), version: updated.version },
      });
      return toGroupDto(updated, memberCount, myRole);
    });

    this.effects.committed({ op: 'group_update' });
    return result;
  }

  /**
   * `DELETE /api/groups/:id`: refused while any registered resource type
   * still has rows owned by the group; otherwise removes the group with its
   * members and invites.
   *
   * @param principal - the caller (group `admin`, or `groups:admin`).
   * @param groupId - the group.
   * @throws ConflictException 409 `GROUP_OWNS_RESOURCES` with `details.counts`.
   */
  @Trace('sharing.group.delete')
  async delete(principal: Principal, groupId: string): Promise<void> {
    const orgId = requireActiveOrg(principal);
    const memberIds = await this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      await this.membership.access(tx, principal, orgId, groupId, 'admin');
      await lockGroup(tx, groupId);

      const counts: Record<string, number> = {};
      for (const def of groupOwnedResourceRegistry.list()) {
        const owned = await def.countOwnedByGroup(groupId, raw);
        if (owned > 0) counts[def.type] = owned;
      }
      if (Object.keys(counts).length > 0) throw groupOwnsResources(counts);

      const members = await tx.groupMember.findMany<{ userId: string }>({ where: { groupId }, select: { userId: true } });
      // Members and invites go with it (ON DELETE CASCADE through the composite keys).
      await tx.group.delete({ where: { id: groupId } });
      await writeAudit(tx, {
        orgId,
        actorUserId: principal.userId,
        action: 'group:deleted',
        groupId,
        meta: { members: members.length },
      });
      return members.map((member) => member.userId);
    });

    this.effects.committed({
      op: 'group_delete',
      invalidate: memberIds,
      event: { name: SHARING_EVENTS.GROUP_DELETED, payload: { orgId, groupId, actorUserId: principal.userId } },
    });
  }
}

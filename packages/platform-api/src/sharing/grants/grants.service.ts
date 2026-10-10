// =============================================================================
// GrantsService: the grants API and the dangling-grant hygiene (issue #729)
// =============================================================================
//
// Share one record with a user or a group of its organization, change or
// revoke the share (any kind: link grants, minted by `LinkGrantsService`
// (#730), are changed and revoked here too), and list what is shared with
// the caller. Every query runs in ONE transaction scoped to the caller's ACTIVE
// organization, so row-level security confines it there whatever id the
// request names; the `share` decision is `AccessPolicy`'s, inside the same
// transaction.
//
// ONE ROLE PER GRANTEE. Granting a user or group that already holds an ACTIVE
// grant on the record replaces its role: the write is an `INSERT ... ON
// CONFLICT` on the partial unique indexes `grants_active_user_uniq_idx` /
// `grants_active_group_uniq_idx` (raw SQL, intentional drift), never a
// `findFirst` pre-check, so two concurrent grants still leave one active row.
//
// SOFT REVOKE. `DELETE /api/grants/:id` sets `revoked_at` and
// `revoked_by_id`; the `sharing.grants.prune` job deletes the row after the
// retention period.
//
// AFTER COMMIT, outside the transaction: the `sharing.grant.*` events (ids
// only) and, for a USER grant that was created or whose ROLE changed, the
// `sharing.shared_with_you` notification (kvox's `changed` rule: never for an
// unchanged re-grant, never for a group grant).
// =============================================================================

import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
  CreateGrantInput,
  GrantDto,
  GrantList,
  GrantListQuery,
  SharedWithMeItem,
  SharedWithMeList,
  SharedWithMeQuery,
  UpdateGrantInput,
} from '@marinoscar/platform-contract/sharing';

import type { Principal } from '../../core/index';
import { Trace } from '../../otel-core/index';
import { AccessPolicy } from '../access/access-policy.service';
import { findResourceType, resourceTypeRegistry, type ResolvedResourceType, type ResourceDescription } from '../access/resource-types';
import { asSharingTx, type GrantRow, type SharingTx, type UserRow } from '../data/sharing-tx';
import {
  SHARING_ERROR_REASONS,
  conflict,
  expiryInPast,
  grantNotFound,
  groupNotInOrg,
  lookupThrottled,
  notALinkGrant,
  notAnOrgMember,
  resourceNotFound,
  roleNotGrantable,
  selfGrant,
} from '../errors';
import { SHARING_EVENTS, type GrantEventPayload } from '../events';
import { holds, iso, paged, requireActiveOrg } from '../groups/group-common';
import { MemberLookupThrottle } from '../groups/member-lookup-throttle';
import { SharingEffects } from '../groups/sharing-effects';
import type { SharedWithYouNotificationData } from '../notifications/shared-with-you.templates';
import { SHARING_PERMISSIONS } from '../permissions';
import { linkEventPayload, linkShareAction, resolveLinkExpiry, writeLinkAudit } from '../links/link-grants.service';
import { SHARING_DATA, type SharingDataPort } from '../ports';
import { PrincipalGroupsProvider } from '../principal-groups.provider';
import { SHARING_LINK_DEFAULTS, SHARING_OPTIONS, type ResolvedSharingModuleOptions } from '../sharing.options';

/**
 * Optional injection token of the grants service's clock (ms since epoch).
 *
 * @stability experimental
 */
export const GRANTS_CLOCK: unique symbol = Symbol.for('@marinoscar/platform/sharing/GRANTS_CLOCK');

/** Most ids one `deleteMany` of `deleteForResources` names. */
const DELETE_CHUNK = 1000;

/** The audit actions of grants, `grant:<verb>`. */
type GrantAuditAction = 'grant:create' | 'grant:update' | 'grant:revoke';

/**
 * A `grants` row with the grantee columns the response shows.
 *
 * @stability experimental
 */
export type GrantWithGrantee = GrantRow & {
  /** The user grantee's columns, or `null`. */
  granteeUser: {
    /** The e-mail address. */
    email: string;
    /** The chosen display name, or `null`. */
    displayName: string | null;
    /** The identity provider's display name, or `null`. */
    providerDisplayName: string | null;
  } | null;
  /** The group grantee's columns, or `null`. */
  granteeGroup: {
    /** The group's name. */
    name: string;
  } | null;
};

const GRANTEE_COLUMNS = {
  granteeUser: { select: { email: true, displayName: true, providerDisplayName: true } },
  granteeGroup: { select: { name: true } },
} as const;

/**
 * One user or group grant as the API returns it.
 *
 * @param row - the `grants` row with its grantee.
 * @returns the wire shape.
 *
 * @stability experimental
 */
export function toGrantDto(row: GrantWithGrantee): GrantDto {
  return {
    id: row.id,
    orgId: row.orgId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    grantee: {
      kind: row.granteeKind,
      userId: row.granteeUserId,
      email: row.granteeUser?.email ?? null,
      displayName: row.granteeUser ? (row.granteeUser.displayName ?? row.granteeUser.providerDisplayName ?? null) : null,
      groupId: row.granteeGroupId,
      groupName: row.granteeGroup?.name ?? null,
    },
    role: row.role,
    expiresAt: iso(row.expiresAt),
    revokedAt: iso(row.revokedAt),
    grantedById: row.grantedById,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

/**
 * Deletes every grant of the given records, of every grantee kind, revoked
 * ones included. Call it INSIDE the transaction that deletes the records, so
 * a deleted record never leaves a dangling grant behind (there is no foreign
 * key to the record: the resource is polymorphic). The prune job catches what
 * a forgotten call leaves.
 *
 * @param tx - the app's transaction client (org-scoped, or the system bypass).
 * @param type - the records' resource type.
 * @param ids - the records being deleted.
 * @returns how many grants were deleted.
 *
 * @stability stable
 */
export async function deleteGrantsForResources(tx: unknown, type: string, ids: readonly string[]): Promise<number> {
  const unique = [...new Set(ids)];
  let deleted = 0;
  for (let i = 0; i < unique.length; i += DELETE_CHUNK) {
    const { count } = await asSharingTx(tx).grant.deleteMany({
      where: { resourceType: type, resourceId: { in: unique.slice(i, i + DELETE_CHUNK) } },
    });
    deleted += count;
  }
  return deleted;
}

/** The row an upsert returns. */
interface UpsertResult {
  id: string;
  inserted: boolean;
  previous_role: string | null;
  previous_expires_at: Date | null;
}

/**
 * The grants API: list, share (upsert), change, revoke, "shared with me",
 * and `deleteForResources` for an app's delete transaction.
 *
 * @stability stable
 */
@Injectable()
export class GrantsService {
  constructor(
    @Inject(SHARING_DATA) private readonly data: SharingDataPort,
    private readonly policy: AccessPolicy,
    private readonly principalGroups: PrincipalGroupsProvider,
    private readonly throttle: MemberLookupThrottle,
    private readonly effects: SharingEffects,
    @Optional() @Inject(GRANTS_CLOCK) private readonly now: () => number = Date.now,
    @Optional() @Inject(SHARING_OPTIONS) private readonly options?: Pick<ResolvedSharingModuleOptions, 'links'>,
  ) {}

  /** The link lifetime bounds (#730). */
  private get linkTtl(): Pick<ResolvedSharingModuleOptions['links'], 'maxTtlDays' | 'defaultTtlDays'> {
    return this.options?.links ?? SHARING_LINK_DEFAULTS;
  }

  /**
   * Deletes every grant of the given records. Call it INSIDE the transaction
   * that deletes them; see {@link deleteGrantsForResources}.
   *
   * @param tx - the app's transaction client.
   * @param type - the records' resource type.
   * @param ids - the records being deleted.
   * @returns how many grants were deleted.
   *
   * @example
   * ```ts
   * await prisma.runInOrg(orgId, async (tx) => {
   *   await grants.deleteForResources(tx, 'transcript', [id]);
   *   await tx.transcript.delete({ where: { id } });
   * });
   * ```
   *
   * @extensionPoint hook
   * @stability stable
   */
  deleteForResources(tx: unknown, type: string, ids: readonly string[]): Promise<number> {
    return deleteGrantsForResources(tx, type, ids);
  }

  /** A registered type named by the request; an unknown one is a 404 like a missing record. */
  private registered(type: string): ResolvedResourceType {
    const rt = findResourceType(type);
    if (!rt) throw resourceNotFound();
    return rt;
  }

  /** An expiry from the request: in the future, or `null`. */
  private expiry(value: string | null | undefined): Date | null {
    if (value === undefined || value === null) return null;
    const at = new Date(value);
    if (!(at.getTime() > this.now())) throw expiryInPast();
    return at;
  }

  /**
   * `GET /api/grants?resourceType&resourceId`: the record's active user and
   * group grants, oldest first. The caller must pass the `share` action.
   *
   * @param principal - the caller (`sharing:read`).
   * @param query - the record and the page.
   * @returns a page of grants.
   * @throws NotFoundException 404 (or the type's `denyAs`) when the caller may not share the record.
   */
  @Trace('sharing.grant.list')
  async list(principal: Principal, query: GrantListQuery): Promise<GrantList> {
    const orgId = requireActiveOrg(principal);
    const rt = this.registered(query.resourceType);
    return this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      await this.policy.requireIn(raw, principal, 'share', { type: rt.type, id: query.resourceId });
      const where = { orgId, resourceType: rt.type, resourceId: query.resourceId, revokedAt: null, granteeKind: { in: ['user', 'group'] } };
      const total = await tx.grant.count({ where });
      const rows = await tx.grant.findMany<GrantWithGrantee>({
        where,
        include: GRANTEE_COLUMNS,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return paged(rows.map(toGrantDto), total, query.page, query.pageSize);
    });
  }

  /**
   * `POST /api/grants`: shares a record with a user (by id or e-mail) or a
   * group of its organization. A grantee that already holds an active grant
   * gets the new role (one role per grantee). Failed lookups by e-mail count
   * against the caller's throttle.
   *
   * @param principal - the caller (`sharing:write`).
   * @param input - the record, the grantee, the role and the expiry.
   * @returns the grant.
   * @throws NotFoundException 404 when the caller may not share the record (or the type is unknown).
   * @throws BadRequestException 400 `SELF_GRANT` or `EXPIRY_IN_PAST`.
   * @throws UnprocessableEntityException 422 `ROLE_NOT_GRANTABLE`, `NOT_AN_ORG_MEMBER` or `GROUP_NOT_IN_ORG`.
   * @throws ConflictException 409 `GRANT_LIMIT_REACHED`.
   * @throws HttpException 429 `LOOKUP_THROTTLED`.
   */
  @Trace('sharing.grant.create')
  async create(principal: Principal, input: CreateGrantInput): Promise<GrantDto> {
    const orgId = requireActiveOrg(principal);
    const rt = this.registered(input.resourceType);
    const grantee = input.grantee;
    const byEmail = grantee.kind === 'user' && grantee.email !== undefined;
    if (byEmail) {
      const wait = this.throttle.retryAfterMs(principal.userId);
      if (wait > 0) throw lookupThrottled(wait);
    }
    const expiresAt = this.expiry(input.expiresAt);
    const ref = { type: rt.type, id: input.resourceId };

    let missed = false;
    let outcome: { row: GrantWithGrantee; inserted: boolean; previousRole: string | null; changed: boolean; notify: SharedWithYouNotificationData | null };
    try {
      outcome = await this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
        const tx = asSharingTx(raw);
        await this.policy.requireIn(raw, principal, 'share', ref);
        const grantable = rt.grantable(grantee.kind);
        if (!grantable.includes(input.role)) throw roleNotGrantable(input.role, grantee.kind, grantable);

        // The grantee: an active member of the record's organization, or one of its groups.
        let granteeId: string;
        if (grantee.kind === 'user') {
          const select = { id: true, isActive: true };
          const target = byEmail
            ? await tx.user.findFirst<Pick<UserRow, 'id' | 'isActive'>>({ where: { email: { equals: grantee.email, mode: 'insensitive' } }, select })
            : await tx.user.findUnique<Pick<UserRow, 'id' | 'isActive'>>({ where: { id: grantee.userId }, select });
          if (target && target.id === principal.userId) throw selfGrant();
          const inOrg =
            target && target.isActive
              ? await tx.membership.findFirst({ where: { orgId, userId: target.id, status: 'active' }, select: { userId: true } })
              : null;
          if (!target || !inOrg) {
            missed = byEmail;
            throw notAnOrgMember();
          }
          granteeId = target.id;
        } else {
          const group = await tx.group.findFirst<{ id: string }>({ where: { id: grantee.groupId, orgId }, select: { id: true } });
          if (!group) throw groupNotInOrg();
          granteeId = group.id;
        }

        // The cap counts the record's active grants; replacing a grantee's role never hits it.
        const active = await tx.grant.count({ where: { resourceType: rt.type, resourceId: ref.id, revokedAt: null } });
        if (active >= rt.maxGrantsPerResource) {
          const mine = await tx.grant.count({
            where: {
              resourceType: rt.type,
              resourceId: ref.id,
              revokedAt: null,
              ...(grantee.kind === 'user' ? { granteeKind: 'user', granteeUserId: granteeId } : { granteeKind: 'group', granteeGroupId: granteeId }),
            },
          });
          if (mine === 0) throw conflict(SHARING_ERROR_REASONS.GRANT_LIMIT_REACHED, 'This record has reached its share limit');
        }

        const [result] = await this.upsert(tx, { orgId, type: rt.type, resourceId: ref.id, kind: grantee.kind, granteeId, role: input.role, expiresAt, actorUserId: principal.userId });
        const row = (await tx.grant.findUnique<GrantWithGrantee>({ where: { id: result!.id }, include: GRANTEE_COLUMNS }))!;
        const previousRole = result!.inserted ? null : result!.previous_role;
        // A concurrent first grant of the same grantee: the row was not in our snapshot. Treat as a change.
        const concurrent = !result!.inserted && result!.previous_role === null;
        const roleChanged = result!.inserted || concurrent || previousRole !== input.role;
        const expiryChanged = !result!.inserted && !concurrent && (result!.previous_expires_at?.getTime() ?? null) !== (expiresAt?.getTime() ?? null);
        const changed = roleChanged || expiryChanged;

        if (changed) {
          await this.audit(tx, {
            orgId,
            actorUserId: principal.userId,
            action: result!.inserted ? 'grant:create' : 'grant:update',
            row,
            previousRole,
          });
        }
        const notify = grantee.kind === 'user' && roleChanged ? await this.notificationData(raw, rt, row, previousRole, principal.userId) : null;
        return { row, inserted: result!.inserted, previousRole, changed, notify };
      });
    } catch (error) {
      if (missed) this.throttle.recordMiss(principal.userId);
      throw error;
    }

    if (outcome.changed) {
      this.effects.grantCommitted([
        { name: outcome.inserted ? SHARING_EVENTS.GRANT_CREATED : SHARING_EVENTS.GRANT_UPDATED, payload: eventPayload(outcome.row, outcome.previousRole, principal.userId) },
      ]);
    }
    if (outcome.notify) this.effects.notifySharedWithYou(outcome.row.granteeUserId!, outcome.notify, outcome.row.id);
    return toGrantDto(outcome.row);
  }

  /** `INSERT ... ON CONFLICT` on the partial unique index of the grantee's kind. */
  private upsert(
    tx: SharingTx,
    g: { orgId: string; type: string; resourceId: string; kind: 'user' | 'group'; granteeId: string; role: string; expiresAt: Date | null; actorUserId: string },
  ): Promise<UpsertResult[]> {
    // The RETURNING sub-selects read the statement's snapshot: the row as it
    // was BEFORE this statement updated it (NULL for a row a concurrent
    // transaction inserted after our snapshot).
    if (g.kind === 'user') {
      return tx.$queryRaw<UpsertResult[]>`
        INSERT INTO grants (id, org_id, resource_type, resource_id, grantee_kind, grantee_user_id, role, expires_at, granted_by_id, created_at, updated_at)
        VALUES (gen_random_uuid(), ${g.orgId}::uuid, ${g.type}, ${g.resourceId}::uuid, 'user', ${g.granteeId}::uuid, ${g.role}, ${g.expiresAt}::timestamptz, ${g.actorUserId}::uuid, now(), now())
        ON CONFLICT (resource_type, resource_id, grantee_user_id) WHERE grantee_kind = 'user' AND revoked_at IS NULL
        DO UPDATE SET role = EXCLUDED.role, expires_at = EXCLUDED.expires_at, updated_at = now()
        RETURNING id::text AS id, (xmax = 0) AS inserted,
          (SELECT p.role FROM grants p WHERE p.id = grants.id) AS previous_role,
          (SELECT p.expires_at FROM grants p WHERE p.id = grants.id) AS previous_expires_at`;
    }
    return tx.$queryRaw<UpsertResult[]>`
      INSERT INTO grants (id, org_id, resource_type, resource_id, grantee_kind, grantee_group_id, role, expires_at, granted_by_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${g.orgId}::uuid, ${g.type}, ${g.resourceId}::uuid, 'group', ${g.granteeId}::uuid, ${g.role}, ${g.expiresAt}::timestamptz, ${g.actorUserId}::uuid, now(), now())
      ON CONFLICT (resource_type, resource_id, grantee_group_id) WHERE grantee_kind = 'group' AND revoked_at IS NULL
      DO UPDATE SET role = EXCLUDED.role, expires_at = EXCLUDED.expires_at, updated_at = now()
      RETURNING id::text AS id, (xmax = 0) AS inserted,
        (SELECT p.role FROM grants p WHERE p.id = grants.id) AS previous_role,
        (SELECT p.expires_at FROM grants p WHERE p.id = grants.id) AS previous_expires_at`;
  }

  /**
   * Loads an active grant of the caller's organization (any kind, links
   * included, #730) and checks the caller may manage it: `share` on its
   * record (a link: the type's `share_link` action when it declares one). A
   * caller who may not gets the same 404 as for a missing grant.
   */
  private async manageable(raw: unknown, principal: Principal, orgId: string, grantId: string, self: (row: GrantRow) => boolean) {
    const tx = asSharingTx(raw);
    const row = await tx.grant.findFirst<GrantWithGrantee>({
      where: { id: grantId, orgId, revokedAt: null },
      include: GRANTEE_COLUMNS,
    });
    if (!row) throw grantNotFound();
    const rt = findResourceType(row.resourceType);
    if (!rt) throw grantNotFound();
    if (!self(row)) {
      const action = row.granteeKind === 'link' ? linkShareAction(rt) : 'share';
      try {
        await this.policy.requireIn(raw, principal, action, { type: rt.type, id: row.resourceId });
      } catch (error) {
        if (error instanceof NotFoundException) throw grantNotFound();
        throw error;
      }
    }
    return { tx, row, rt };
  }

  /**
   * `PATCH /api/grants/:id`: changes the role and/or the expiry, and a link
   * grant's label (#730). The caller must pass the `share` action on the
   * grant's record (a link: `share_link` when the type declares it). A link's
   * expiry is capped by `links.maxTtlDays`.
   *
   * @param principal - the caller (`sharing:write`).
   * @param grantId - the grant.
   * @param input - the new role, expiry and/or (links only) label.
   * @returns the grant.
   * @throws NotFoundException 404 for a grant the caller may not manage.
   * @throws UnprocessableEntityException 422 `NOT_A_LINK_GRANT` for a label on a user or group grant.
   */
  @Trace('sharing.grant.update')
  async update(principal: Principal, grantId: string, input: UpdateGrantInput): Promise<GrantDto> {
    const orgId = requireActiveOrg(principal);
    const now = this.now();
    // Validated before the transaction: an expiry in the past is a 400 for every kind.
    const expiresAt = input.expiresAt === undefined ? undefined : this.expiry(input.expiresAt);
    const outcome = await this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const { tx, row, rt } = await this.manageable(raw, principal, orgId, grantId, () => false);
      const isLink = row.granteeKind === 'link';
      if (input.label !== undefined && !isLink) throw notALinkGrant();
      if (input.role !== undefined) {
        const grantable = rt.grantable(row.granteeKind);
        if (!grantable.includes(input.role)) throw roleNotGrantable(input.role, row.granteeKind, grantable);
      }
      const data: Record<string, unknown> = {};
      if (input.role !== undefined) data.role = input.role;
      // A link's expiry is capped by the deployment's maximum link lifetime (#730).
      if (expiresAt !== undefined) data.expiresAt = isLink ? resolveLinkExpiry(input.expiresAt, this.linkTtl, now, 'update') : expiresAt;
      if (input.label !== undefined) data.linkLabel = input.label;
      const updated = await tx.grant.update<GrantWithGrantee>({ where: { id: row.id }, data, include: GRANTEE_COLUMNS });
      const roleChanged = updated.role !== row.role;
      const changed =
        roleChanged ||
        (updated.expiresAt?.getTime() ?? null) !== (row.expiresAt?.getTime() ?? null) ||
        (isLink && updated.linkLabel !== row.linkLabel);
      if (changed && isLink) {
        await writeLinkAudit(tx, { orgId, actorUserId: principal.userId, action: 'grant:link:update', row: updated, previousRole: row.role });
      } else if (changed) {
        await this.audit(tx, { orgId, actorUserId: principal.userId, action: 'grant:update', row: updated, previousRole: row.role });
      }
      const notify = updated.granteeKind === 'user' && roleChanged ? await this.notificationData(raw, rt, updated, row.role, principal.userId) : null;
      return { row: updated, previousRole: row.role, changed, notify };
    });

    if (outcome.changed) {
      const payload =
        outcome.row.granteeKind === 'link'
          ? linkEventPayload(outcome.row, outcome.previousRole, principal.userId)
          : eventPayload(outcome.row, outcome.previousRole, principal.userId);
      this.effects.grantCommitted([{ name: SHARING_EVENTS.GRANT_UPDATED, payload }]);
    }
    if (outcome.notify) this.effects.notifySharedWithYou(outcome.row.granteeUserId!, outcome.notify, outcome.row.id);
    return toGrantDto(outcome.row);
  }

  /**
   * `DELETE /api/grants/:id`: revokes a grant (soft: `revoked_at`,
   * `revoked_by_id`). A user grantee may always remove their own access
   * (`sharing:read` is enough); anyone else needs `sharing:write` and the
   * `share` action on the record, and gets the same 404 as for a missing
   * grant otherwise. Access ends on the next request.
   *
   * @param principal - the caller.
   * @param grantId - the grant.
   * @throws NotFoundException 404 for a grant the caller may not manage.
   */
  @Trace('sharing.grant.revoke')
  async revoke(principal: Principal, grantId: string): Promise<void> {
    const orgId = requireActiveOrg(principal);
    const isSelf = (row: GrantRow) => row.granteeKind === 'user' && row.granteeUserId === principal.userId;
    const canWrite = holds(principal, SHARING_PERMISSIONS.SHARING_WRITE);
    const revoked = await this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const { tx, row } = await this.manageable(raw, principal, orgId, grantId, (candidate) => {
        if (isSelf(candidate)) return true;
        // Without sharing:write nobody else's grant is manageable: the same 404 as a missing one.
        if (!canWrite) throw grantNotFound();
        return false;
      });
      const updated = await tx.grant.update<GrantWithGrantee>({
        where: { id: row.id },
        data: { revokedAt: new Date(this.now()), revokedById: principal.userId },
        include: GRANTEE_COLUMNS,
      });
      if (updated.granteeKind === 'link') {
        await writeLinkAudit(tx, { orgId, actorUserId: principal.userId, action: 'grant:link:revoke', row: updated, previousRole: row.role });
      } else {
        await this.audit(tx, { orgId, actorUserId: principal.userId, action: 'grant:revoke', row: updated, previousRole: row.role });
      }
      return updated;
    });
    this.effects.grantCommitted([{ name: SHARING_EVENTS.GRANT_REVOKED, payload: eventPayload(revoked, revoked.role, principal.userId) }]);
  }

  /**
   * `GET /api/grants/shared-with-me`: the records shared with the caller
   * through an active, unexpired grant to them or to one of their groups,
   * newest first, with the type's `describe()` labels when it has one.
   *
   * @param principal - the caller (`sharing:read`).
   * @param query - optionally one resource type, and the page.
   * @returns a page of items.
   */
  @Trace('sharing.grant.shared_with_me')
  async sharedWithMe(principal: Principal, query: SharedWithMeQuery): Promise<SharedWithMeList> {
    const orgId = requireActiveOrg(principal);
    const types = query.resourceType ? (findResourceType(query.resourceType) ? [query.resourceType] : []) : resourceTypeRegistry.ids();
    if (types.length === 0) return paged([], 0, query.page, query.pageSize);
    const groupIds = (await this.principalGroups.groupsFor(principal)).filter((g) => g.orgId === orgId).map((g) => g.groupId);
    const where = {
      orgId,
      resourceType: { in: types },
      revokedAt: null,
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(this.now()) } }] },
        {
          OR: [
            { granteeKind: 'user', granteeUserId: principal.userId },
            ...(groupIds.length > 0 ? [{ granteeKind: 'group', granteeGroupId: { in: groupIds } }] : []),
          ],
        },
      ],
    };
    return this.data.runInOrg({ orgId, userId: principal.userId }, async (raw) => {
      const tx = asSharingTx(raw);
      const total = await tx.grant.count({ where });
      const rows = await tx.grant.findMany<GrantRow>({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const labels = new Map<string, ResourceDescription>();
      for (const type of new Set(rows.map((row) => row.resourceType))) {
        const rt = findResourceType(type);
        if (!rt?.def.describe) continue;
        const ids = [...new Set(rows.filter((row) => row.resourceType === type).map((row) => row.resourceId))];
        for (const [id, label] of await rt.def.describe(ids, raw)) labels.set(`${type}:${id}`, label);
      }
      const items: SharedWithMeItem[] = rows.map((row) => {
        const label = labels.get(`${row.resourceType}:${row.resourceId}`);
        return {
          grantId: row.id,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          role: row.role,
          via: row.granteeKind === 'group' ? 'group_grant' : 'user_grant',
          groupId: row.granteeGroupId,
          title: label?.title ?? null,
          path: label?.path ?? null,
          grantedById: row.grantedById,
          expiresAt: iso(row.expiresAt),
          createdAt: iso(row.createdAt)!,
        };
      });
      return paged(items, total, query.page, query.pageSize);
    });
  }

  /** Writes one audit row INSIDE the caller's transaction: ids and roles only, never an address. */
  private async audit(
    tx: SharingTx,
    input: { orgId: string; actorUserId: string; action: GrantAuditAction; row: GrantRow; previousRole: string | null },
  ): Promise<void> {
    const { row } = input;
    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: 'grant',
        targetId: row.id,
        orgId: input.orgId,
        meta: {
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          granteeKind: row.granteeKind,
          granteeId: row.granteeUserId ?? row.granteeGroupId ?? null,
          role: row.role,
          previousRole: input.previousRole,
        },
      },
    });
  }

  /** The `sharing.shared_with_you` data, read inside the transaction (labels and the sharer's name). */
  private async notificationData(
    raw: unknown,
    rt: ResolvedResourceType,
    row: GrantRow,
    previousRole: string | null,
    actorUserId: string,
  ): Promise<SharedWithYouNotificationData> {
    const tx = asSharingTx(raw);
    const label = rt.def.describe ? (await rt.def.describe([row.resourceId], raw)).get(row.resourceId) : undefined;
    const actor = await tx.user.findUnique<Pick<UserRow, 'email' | 'displayName' | 'providerDisplayName'>>({
      where: { id: actorUserId },
      select: { email: true, displayName: true, providerDisplayName: true },
    });
    return {
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      role: row.role,
      ...(previousRole !== null ? { previousRole } : {}),
      ...(label ? { title: label.title, ...(label.path ? { path: label.path } : {}) } : {}),
      ...(actor ? { sharedBy: actor.displayName ?? actor.providerDisplayName ?? actor.email } : {}),
      ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
    };
  }
}

/** The event payload of a grant: ids and roles only. */
function eventPayload(row: GrantRow, previousRole: string | null, actorUserId: string): GrantEventPayload {
  return {
    orgId: row.orgId,
    grantId: row.id,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    granteeKind: row.granteeKind,
    granteeId: row.granteeUserId ?? row.granteeGroupId ?? null,
    role: row.role,
    previousRole,
    actorUserId,
  };
}

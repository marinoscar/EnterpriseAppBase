// =============================================================================
// PrincipalGroupsProvider: the principal's groups, lazily (issue #728, PP-7.1)
// =============================================================================
//
// `Scope.groupIds` (ADR 0001) is filled from group memberships here, NOT at
// token validation and NEVER from the JWT (a token would grow with every
// membership, and a removal would not take effect until it expired):
//
//   - loaded on first use in a request, for the principal's ACTIVE
//     organization, and memoised on the principal object for the rest of the
//     request;
//   - cached per (user, organization) for `membershipCacheTtlSeconds`, the
//     principal cache's TTL (#683);
//   - invalidated for the affected users by every membership mutation AFTER
//     its transaction commits: synchronously here, and on every other replica
//     through the event bus (`sharing.groups.invalidate`). The TTL is only the
//     backstop for a lost bus message.
//
// It also drops a user's entries on the identity cache's channel
// (`auth.principal.invalidate`): a removal from the ORGANIZATION (or a
// deactivation) must not leave group memberships served from memory.
//
// RACE-SAFE like the principal cache: a read that started before an
// invalidation never stores its stale result after it (`generation`).
// =============================================================================

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { GroupRole } from '@marinoscar/platform-contract/sharing';

import type { GroupMembership, Principal, Scope } from '../core/index';
import { asSharingTx } from './data/sharing-tx';
import { SHARING_DATA, SHARING_EVENT_BUS, type SharingDataPort, type SharingEventBus } from './ports';
import { SHARING_OPTIONS, type ResolvedSharingModuleOptions } from './sharing.options';

/**
 * The bus channel group-membership invalidations travel on. Payload:
 * `{ userIds: string[] }`.
 *
 * @stability experimental
 */
export const SHARING_GROUPS_INVALIDATE_CHANNEL = 'sharing.groups.invalidate';

/**
 * The identity principal cache's channel (#683), listened to so an org-level
 * change also drops group memberships. Payload: `{ userId } | { all: true }`.
 *
 * @stability experimental
 */
export const PRINCIPAL_INVALIDATE_CHANNEL = 'auth.principal.invalidate';

/** Most user ids per bus message (keeps the payload far below the bus limit). */
const IDS_PER_MESSAGE = 100;

/**
 * Most (user, org) entries one process caches.
 *
 * @stability experimental
 */
export const PRINCIPAL_GROUPS_MAX_ENTRIES = 10_000;

/**
 * Optional injection token of the clock (ms since epoch); tests inject one.
 *
 * @stability experimental
 */
export const PRINCIPAL_GROUPS_CLOCK: unique symbol = Symbol.for('@marinoscar/platform/sharing/PRINCIPAL_GROUPS_CLOCK');

interface Entry {
  userId: string;
  groups: readonly GroupMembership[];
  expiresAt: number;
}

/**
 * A principal with its group memberships in the active organization.
 *
 * @stability experimental
 */
export type PrincipalWithGroups = Principal & {
  /** The memberships in the active organization. */
  readonly groups: readonly GroupMembership[];
};

function isIdList(payload: unknown): payload is { userIds: string[] } {
  const ids = (payload as { userIds?: unknown } | null)?.userIds;
  return Array.isArray(ids) && ids.every((id) => typeof id === 'string');
}

/**
 * Loads, caches and invalidates a principal's group memberships, and builds
 * the `Scope` (with `groupIds`) work is done in.
 *
 * @stability experimental
 */
@Injectable()
export class PrincipalGroupsProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrincipalGroupsProvider.name);
  private readonly ttlMs: number;
  private readonly entries = new Map<string, Entry>();
  /** Per-request memo: the principal object of one request, mapped to its groups. */
  private readonly perRequest = new WeakMap<object, Promise<readonly GroupMembership[]>>();
  private counter = 0;
  private epoch = 0;
  private readonly generations = new Map<string, number>();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    @Inject(SHARING_DATA) private readonly data: SharingDataPort,
    @Inject(SHARING_OPTIONS) options: ResolvedSharingModuleOptions,
    @Optional() @Inject(SHARING_EVENT_BUS) private readonly bus?: SharingEventBus,
    @Optional() @Inject(PRINCIPAL_GROUPS_CLOCK) private readonly now: () => number = Date.now,
  ) {
    this.ttlMs = options.groups.membershipCacheTtlSeconds * 1000;
  }

  /** Subscribes to the invalidation channels (once). */
  onModuleInit(): void {
    if (!this.bus || this.unsubscribers.length > 0) return;
    this.unsubscribers.push(
      this.bus.subscribe<unknown>(SHARING_GROUPS_INVALIDATE_CHANNEL, (payload, meta) => {
        if (meta.local) return; // applied synchronously by invalidateUsers
        if (!isIdList(payload)) {
          this.logger.warn(`Ignoring a malformed message on "${SHARING_GROUPS_INVALIDATE_CHANNEL}"`);
          return;
        }
        this.drop(payload.userIds);
      }),
      this.bus.subscribe<unknown>(PRINCIPAL_INVALIDATE_CHANNEL, (payload) => {
        const p = payload as { userId?: unknown; all?: unknown } | null;
        if (p?.all === true) this.dropAll();
        else if (typeof p?.userId === 'string') this.drop([p.userId]);
      }),
    );
  }

  /** Unsubscribes and drops the cache. */
  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.entries.clear();
  }

  private key(userId: string, orgId: string): string {
    return `${userId}\u0000${orgId}`;
  }

  private generation(userId: string): number {
    return Math.max(this.epoch, this.generations.get(userId) ?? 0);
  }

  private drop(userIds: readonly string[]): void {
    for (const userId of userIds) {
      this.counter += 1;
      this.generations.set(userId, this.counter);
      for (const [key, entry] of this.entries) if (entry.userId === userId) this.entries.delete(key);
    }
  }

  private dropAll(): void {
    this.counter += 1;
    this.epoch = this.counter;
    this.generations.clear();
    this.entries.clear();
  }

  /**
   * The principal's memberships in its ACTIVE organization (none without
   * one). Loaded once per request, then served from the cache until a
   * membership change invalidates it.
   *
   * @param principal - the caller.
   * @returns `{ groupId, orgId, role }` per group.
   */
  async groupsFor(principal: Principal): Promise<readonly GroupMembership[]> {
    const orgId = principal.activeOrgId;
    if (!orgId) return [];
    const memo = this.perRequest.get(principal);
    if (memo) return memo;
    const pending = this.load(principal.userId, orgId);
    this.perRequest.set(principal, pending);
    try {
      return await pending;
    } catch (error) {
      this.perRequest.delete(principal);
      throw error;
    }
  }

  private async load(userId: string, orgId: string): Promise<readonly GroupMembership[]> {
    const key = this.key(userId, orgId);
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.groups;
    if (cached) this.entries.delete(key);

    const generation = this.generation(userId);
    const rows = await this.data.runInOrg({ orgId, userId }, (tx) =>
      asSharingTx(tx).groupMember.findMany<{ groupId: string; role: GroupRole }>({
        where: { userId, orgId },
        select: { groupId: true, role: true },
        orderBy: { groupId: 'asc' },
      }),
    );
    const groups: readonly GroupMembership[] = Object.freeze(
      rows.map((row) => Object.freeze({ groupId: row.groupId, orgId, role: row.role })),
    );

    if (this.ttlMs > 0 && this.generation(userId) === generation) {
      this.entries.delete(key);
      this.entries.set(key, { userId, groups, expiresAt: this.now() + this.ttlMs });
      while (this.entries.size > PRINCIPAL_GROUPS_MAX_ENTRIES) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
    }
    return groups;
  }

  /**
   * The principal with `groups` filled for its active organization.
   *
   * @param principal - the caller.
   * @returns a new, frozen principal object.
   */
  async enrich(principal: Principal): Promise<PrincipalWithGroups> {
    const groups = await this.groupsFor(principal);
    return Object.freeze({ ...principal, groups }) as PrincipalWithGroups;
  }

  /**
   * The data boundary of an operation: the user, the active organization and
   * `groupIds`, the groups the principal belongs to there (never widened).
   *
   * @param principal - the caller.
   * @returns the scope.
   */
  async scopeFor(principal: Principal): Promise<Scope> {
    const groups = await this.groupsFor(principal);
    return {
      userId: principal.userId,
      ...(principal.activeOrgId ? { orgId: principal.activeOrgId } : {}),
      groupIds: groups.map((group) => group.groupId),
    };
  }

  /**
   * The principal's role in one group of its active organization, or `null`.
   *
   * @param principal - the caller.
   * @param groupId - the group.
   * @returns the role, or `null` when not a member.
   */
  async groupRoleFor(principal: Principal, groupId: string): Promise<GroupRole | null> {
    const groups = await this.groupsFor(principal);
    return (groups.find((group) => group.groupId === groupId)?.role as GroupRole | undefined) ?? null;
  }

  /**
   * Drops the cached memberships of `userIds` here, synchronously, and on
   * every other replica. Call it AFTER the membership write commits, outside
   * any transaction. Never throws.
   *
   * @param userIds - the users whose memberships changed.
   */
  invalidateUsers(userIds: readonly string[]): void {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    try {
      this.drop(unique);
    } catch (error) {
      this.logger.error(`Group membership invalidation failed locally: ${String(error)}`);
    }
    if (!this.bus) return;
    for (let i = 0; i < unique.length; i += IDS_PER_MESSAGE) {
      try {
        this.bus.publish(SHARING_GROUPS_INVALIDATE_CHANNEL, { userIds: unique.slice(i, i + IDS_PER_MESSAGE) }).catch(() => undefined);
      } catch {
        // A misbehaving adapter never reaches the caller.
      }
    }
  }

  /** Entries cached in this process (diagnostics and tests). */
  size(): number {
    return this.entries.size;
  }
}

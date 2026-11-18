// =============================================================================
// System listings of groups and members (issue #1137)
// =============================================================================
//
// Background sweeps (a review-queue reconcile, a digest, a backup scope) must
// iterate every group and its members with no user in the loop. The sharing
// conformance rule forbids app code from reading `groups` / `group_members`,
// so the slice offers two listings:
//
//   GroupsService.listForSystem({ reason, orgId?, cursor?, limit? })
//   GroupMembershipService.membersForSystem(groupId, { reason, orgId?, roles? })
//
// Each REQUIRES a registered `SystemAccessReason` (an app adds its own with
// `registerSystemAccessReason`); an unregistered one throws `ScopedAccessError`
// before any query. With `orgId` the work runs in that organization's scope
// (row-level security on, no user id, no bypass); without it, it runs on the
// system client under the caller's reason, across organizations. Either way
// the reason is recorded on the active span (`db.access.reason`).
//
// They return ids, roles and plain group fields only: never e-mail addresses
// or display names (a sweep that needs them reads its own user table).
// =============================================================================

import { trace } from '@opentelemetry/api';
import type { GroupRole } from '@marinoscar/platform-contract/sharing';

import { isSystemAccessReason, ScopedAccessError } from '../../core/index';
import type { SharingDataPort, SharingSystemAccessReason } from '../ports';

/**
 * The largest page {@link GroupsService.listForSystem} returns.
 *
 * @stability experimental
 */
export const SYSTEM_GROUPS_MAX_LIMIT = 500;

/**
 * The page size of {@link GroupsService.listForSystem} when `limit` is absent.
 *
 * @stability experimental
 */
export const SYSTEM_GROUPS_DEFAULT_LIMIT = 100;

/**
 * What {@link GroupsService.listForSystem} reads.
 *
 * @stability experimental
 */
export interface SystemGroupListQuery {
  /** A REGISTERED system access reason (`registerSystemAccessReason`); recorded on the span. */
  readonly reason: SharingSystemAccessReason;
  /** One organization (scoped, no bypass); absent: every organization, on the system client. */
  readonly orgId?: string;
  /** The `nextCursor` of the previous page; absent for the first page. */
  readonly cursor?: string;
  /**
   * Groups per page, 1..{@link SYSTEM_GROUPS_MAX_LIMIT}.
   *
   * @defaultValue 100
   */
  readonly limit?: number;
}

/**
 * One group as a system listing returns it.
 *
 * @stability experimental
 */
export interface SystemGroup {
  /** The group. */
  readonly id: string;
  /** Its organization. */
  readonly orgId: string;
  /** Display name. */
  readonly name: string;
  /** Description, or `null`. */
  readonly description: string | null;
  /** App-defined JSON, or `null`. */
  readonly metadata: Record<string, unknown> | null;
  /** Who created it, or `null`. */
  readonly createdById: string | null;
  /** Its member count. */
  readonly memberCount: number;
  /** When it was created. */
  readonly createdAt: Date;
  /** When it last changed. */
  readonly updatedAt: Date;
}

/**
 * One page of {@link GroupsService.listForSystem}.
 *
 * @stability experimental
 */
export interface SystemGroupPage {
  /** The groups of this page, by id. */
  readonly items: readonly SystemGroup[];
  /** The cursor of the next page, or `null` on the last one. */
  readonly nextCursor: string | null;
}

/**
 * What {@link GroupMembershipService.membersForSystem} reads.
 *
 * @stability experimental
 */
export interface SystemMemberQuery {
  /** A REGISTERED system access reason; recorded on the span. */
  readonly reason: SharingSystemAccessReason;
  /** The group's organization (scoped, no bypass); absent: looked up on the system client. */
  readonly orgId?: string;
  /** Only members with one of these roles; absent or empty: every member. */
  readonly roles?: readonly GroupRole[];
}

/**
 * One member as a system listing returns it: ids and the role only.
 *
 * @stability experimental
 */
export interface SystemGroupMember {
  /** The group. */
  readonly groupId: string;
  /** Its organization. */
  readonly orgId: string;
  /** The member. */
  readonly userId: string;
  /** Their role in the group. */
  readonly role: GroupRole;
  /** Who added them, or `null`. */
  readonly addedById: string | null;
  /** When they joined. */
  readonly createdAt: Date;
}

/**
 * Refuses an unregistered reason (fail closed) and records it on the active span.
 *
 * @param reason - the caller's reason.
 * @param scope - `org` (scoped) or `system` (bypass).
 * @throws ScopedAccessError when the reason is not registered.
 */
export function requireSystemReason(reason: unknown, scope: 'org' | 'system'): void {
  if (!isSystemAccessReason(reason)) {
    throw new ScopedAccessError(
      `A system listing needs a registered system access reason, got ${JSON.stringify(reason)}. ` +
        'Register one with registerSystemAccessReason() at import time.',
    );
  }
  trace.getActiveSpan()?.setAttributes({ 'db.access.scope': scope, 'db.access.reason': reason });
}

/**
 * Runs `fn` in `orgId`'s scope when given (no bypass, no user id), else on the
 * system client under `reason`.
 *
 * @param data - the host's data port.
 * @param reason - the registered reason.
 * @param orgId - the organization, or `undefined` for every organization.
 * @param fn - the unit of work.
 * @returns what `fn` returns.
 */
export function runForSystem<R>(
  data: SharingDataPort,
  reason: SharingSystemAccessReason,
  orgId: string | undefined,
  fn: (tx: unknown) => Promise<R>,
): Promise<R> {
  requireSystemReason(reason, orgId === undefined ? 'system' : 'org');
  return orgId === undefined ? data.runAsSystem(reason, fn) : data.runInOrg({ orgId }, fn);
}

// =============================================================================
// Shared rules of the group services (issue #728, PP-7.1). Internal.
// =============================================================================

import { trace } from '@opentelemetry/api';
import type { GroupRole } from '@marinoscar/platform-contract/sharing';

import type { Principal } from '../../core/index';
import type { SharingTx } from '../data/sharing-tx';
import { noActiveOrganization } from '../errors';
import { SHARING_PERMISSIONS } from '../permissions';

/**
 * The organization a group request acts on: the ACTIVE organization of the
 * principal (from the signed token), never an id from the request.
 */
export function requireActiveOrg(principal: Principal): string {
  const orgId = principal.activeOrgId;
  if (!orgId) throw noActiveOrganization();
  trace.getActiveSpan()?.setAttribute('org.id', orgId);
  return orgId;
}

/** Whether the principal holds `permission` (effective, in its active organization). */
export function holds(principal: Principal, permission: string): boolean {
  return principal.permissions.includes(permission);
}

/** Whether the principal may read and administer every group of its organization. */
export function isGroupsAdmin(principal: Principal): boolean {
  return holds(principal, SHARING_PERMISSIONS.GROUPS_ADMIN);
}

/**
 * Serializes the membership writes of one group for the rest of the
 * transaction (`SELECT ... FOR UPDATE` on its row), so two admins demoting
 * each other at once cannot both pass the last-admin check.
 */
export async function lockGroup(tx: SharingTx, groupId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM groups WHERE id = ${groupId}::uuid FOR UPDATE`;
}

/** The audit actions of the slice, `group:<verb>`. */
export type GroupAuditAction =
  | 'group:created'
  | 'group:updated'
  | 'group:deleted'
  | 'group:member_added'
  | 'group:member_removed'
  | 'group:member_role_changed'
  | 'group:invite_created'
  | 'group:invite_revoked'
  | 'group:invite_accepted'
  | 'group:invite_declined';

/**
 * Writes one audit row INSIDE the caller's transaction, with the
 * organization (#725). `meta` carries ids and roles only, never an address.
 */
export async function writeAudit(
  tx: SharingTx,
  input: {
    orgId: string;
    actorUserId: string;
    action: GroupAuditAction;
    groupId: string;
    meta?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: 'group',
      targetId: input.groupId,
      orgId: input.orgId,
      meta: { groupId: input.groupId, ...(input.meta ?? {}) },
    },
  });
}

/** Whether `error` is Prisma's unique-constraint violation (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}

/** `Date` to ISO string; `null` stays `null`. */
export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** The `{ items, total, page, pageSize, totalPages }` envelope of a list. */
export function paged<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/**
 * Parses an `If-Match` header into a version: an integer, optionally quoted
 * or weak (`4`, `"4"`, `W/"4"`). Anything else is treated as absent
 * (docs/API.md, "Optimistic Concurrency").
 */
export function parseIfMatch(header: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return undefined;
  const match = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/.exec(raw);
  return match ? Number(match[1]) : undefined;
}

/** A role after a change, for event payloads. */
export type RoleOrNull = GroupRole | null;

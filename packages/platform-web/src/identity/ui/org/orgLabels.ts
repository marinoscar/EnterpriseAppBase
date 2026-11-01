/**
 * Display labels for org roles and statuses (#726). Presentation only: the
 * API decides which roles exist and who may assign them.
 */
import type { OrgInviteStatus, OrgMemberStatus, RoleDescriptor } from '../../headless/index.js';
import { NUMERIC_DATE, formatDate as formatZonedDate } from '../../../core/index.js';

/**
 * A role's label from the API's role list (`GET /api/roles`), or its raw id
 * for a role the list does not hold (not loaded yet, or removed since).
 */
export function orgRoleLabel(role: string, roles: readonly RoleDescriptor[] = []): string {
  return roles.find((candidate) => candidate.id === role)?.label ?? role;
}

export const MEMBER_STATUS_COLOR: Record<OrgMemberStatus, 'success' | 'warning'> = {
  active: 'success',
  suspended: 'warning',
};

export const INVITE_STATUS_COLOR: Record<OrgInviteStatus, 'info' | 'success' | 'default' | 'warning'> = {
  pending: 'info',
  accepted: 'success',
  revoked: 'default',
  expired: 'warning',
};

/** A date as the viewer's locale writes it, in their display zone, or an em dash. */
export function formatDate(iso: string | null | undefined): string {
  return formatZonedDate(iso, NUMERIC_DATE);
}

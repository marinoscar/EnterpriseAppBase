/**
 * Display labels for org roles and statuses (#726). Presentation only: the
 * API decides which roles exist and who may assign them.
 */
import type { OrgInviteStatus, OrgMemberStatus } from '../../headless/index.js';

const ROLE_LABELS: Record<string, string> = {
  org_admin: 'Administrator',
  contributor: 'Contributor',
  viewer: 'Viewer',
};

/** A role's label, or its raw name for a role this build does not know (an app's own org role). */
export function orgRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
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

/** A date as the viewer's locale writes it, or an em dash. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

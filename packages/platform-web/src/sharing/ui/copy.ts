// The sharing UI's fixed strings (issue #731). Not exported, except through
// the descriptor (`groupsSettingsPage.card`), which carries the page's title
// and subtitle so the registry card and the page read the same.

import type { GroupRole } from '@marinoscar/platform-contract/sharing';

export const GROUPS_PAGE_TITLE = 'Groups';
export const GROUPS_PAGE_DESCRIPTION = 'Create groups of people to share with, manage their members and answer your invitations.';

export const LINK_NOT_AVAILABLE = 'This link is not available.';
export const LINK_NOT_AVAILABLE_HINT =
  'It may have expired or been revoked, or the address is incomplete. Ask the person who shared it for a new link.';

export const GROUP_ROLE_OPTIONS: ReadonlyArray<{ value: GroupRole; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
];

export function groupRoleLabel(role: string | null | undefined): string {
  return GROUP_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? (role ?? '');
}

/** The default link lifetimes a share dialog offers. */
export const DEFAULT_LINK_EXPIRY_PRESETS: ReadonlyArray<{ label: string; days: number | null }> = [
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: 'Never', days: null },
];

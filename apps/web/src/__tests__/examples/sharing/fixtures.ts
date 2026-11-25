// Wire fixtures for the sharing examples (issue #732), shaped by
// `@marinoscar/platform-contract/sharing`. Not a test file.

import type { GrantDto, GroupDto, LinkGrantView, SharedWithMeItem } from '@marinoscar/platform-contract/sharing';

export const ORG = '00000000-0000-4000-8000-0000000000aa';
export const ME = 'test-user-id';
export const ANA = '00000000-0000-4000-8000-000000000002';
export const GROUP_ID = '00000000-0000-4000-8000-0000000000b1';
export const NOTE_ID = '00000000-0000-4000-8000-0000000000c1';
export const ALBUM_ID = '00000000-0000-4000-8000-0000000000c2';
export const NOW = '2026-10-01T12:00:00.000Z';
export const TOKEN = 'lnk_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';

/** The permissions the examples sign in with (the `contributor` org role's). */
export const SHARING_PERMISSIONS = ['groups:read', 'groups:write', 'sharing:read', 'sharing:write'];

export function page<T>(items: T[]) {
  return { items, total: items.length, page: 1, pageSize: 100, totalPages: 1 };
}

export function userGrant(overrides: Partial<GrantDto> = {}): GrantDto {
  return {
    id: '00000000-0000-4000-8000-0000000000f1',
    orgId: ORG,
    resourceType: 'example_note',
    resourceId: NOTE_ID,
    grantee: { kind: 'user', userId: ANA, email: 'ana@example.com', displayName: 'Ana', groupId: null, groupName: null },
    role: 'viewer',
    expiresAt: null,
    revokedAt: null,
    grantedById: ME,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function group(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    id: GROUP_ID,
    orgId: ORG,
    name: 'Family',
    description: null,
    metadata: null,
    createdById: ME,
    version: 1,
    myRole: 'admin',
    memberCount: 3,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function linkGrant(overrides: Partial<LinkGrantView> = {}): LinkGrantView {
  return {
    id: '00000000-0000-4000-8000-0000000000a9',
    orgId: ORG,
    resourceType: 'example_note',
    resourceId: NOTE_ID,
    role: 'viewer',
    label: null,
    url: `https://app.example.test/s#${TOKEN}`,
    expiresAt: '2026-10-08T12:00:00.000Z',
    revokedAt: null,
    grantedById: ME,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as LinkGrantView;
}

export function sharedItem(overrides: Partial<SharedWithMeItem> = {}): SharedWithMeItem {
  return {
    grantId: '00000000-0000-4000-8000-0000000000f9',
    resourceType: 'example_note',
    resourceId: NOTE_ID,
    role: 'editor',
    via: 'user_grant',
    groupId: null,
    title: 'Trip plan',
    path: `/notes/${NOTE_ID}`,
    grantedById: ANA,
    expiresAt: null,
    createdAt: NOW,
    ...overrides,
  } as SharedWithMeItem;
}

// Wire fixtures for the sharing slice's tests (issue #731), shaped by
// `@marinoscar/platform-contract/sharing`.

import type {
  GrantDto,
  GroupDto,
  GroupInviteDto,
  GroupMemberDto,
  LinkGrantView,
  MyGroupInviteDto,
  SharedWithMeItem,
} from '@marinoscar/platform-contract/sharing';

export const ORG = '00000000-0000-4000-8000-0000000000aa';
export const ME = '00000000-0000-4000-8000-000000000001';
export const ANA = '00000000-0000-4000-8000-000000000002';
export const GROUP_ID = '00000000-0000-4000-8000-0000000000b1';
export const RESOURCE_ID = '00000000-0000-4000-8000-0000000000c1';
export const NOW = '2026-10-01T12:00:00.000Z';

export function group(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    id: GROUP_ID,
    orgId: ORG,
    name: 'Design team',
    description: 'People who review mockups',
    metadata: null,
    createdById: ME,
    version: 3,
    myRole: 'admin',
    memberCount: 2,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function page<T>(items: T[]): { items: T[]; total: number; page: number; pageSize: number; totalPages: number } {
  return { items, total: items.length, page: 1, pageSize: 100, totalPages: 1 };
}

export function member(overrides: Partial<GroupMemberDto> = {}): GroupMemberDto {
  return {
    groupId: GROUP_ID,
    userId: ME,
    role: 'admin',
    email: 'me@example.com',
    displayName: 'Me Myself',
    addedById: null,
    createdAt: NOW,
    ...overrides,
  };
}

export function invite(overrides: Partial<GroupInviteDto> = {}): GroupInviteDto {
  return {
    id: '00000000-0000-4000-8000-0000000000d1',
    groupId: GROUP_ID,
    orgId: ORG,
    email: 'zoe@example.com',
    role: 'viewer',
    status: 'pending',
    invitedById: ME,
    expiresAt: '2026-10-15T12:00:00.000Z',
    acceptedAt: null,
    declinedAt: null,
    revokedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

export function myInvite(overrides: Partial<MyGroupInviteDto> = {}): MyGroupInviteDto {
  return {
    id: '00000000-0000-4000-8000-0000000000e1',
    groupId: '00000000-0000-4000-8000-0000000000b2',
    groupName: 'Book club',
    orgId: ORG,
    role: 'editor',
    invitedById: ANA,
    expiresAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

export function userGrant(overrides: Partial<GrantDto> = {}): GrantDto {
  return {
    id: '00000000-0000-4000-8000-0000000000f1',
    orgId: ORG,
    resourceType: 'transcript',
    resourceId: RESOURCE_ID,
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

export function groupGrant(overrides: Partial<GrantDto> = {}): GrantDto {
  return userGrant({
    id: '00000000-0000-4000-8000-0000000000f2',
    grantee: { kind: 'group', userId: null, email: null, displayName: null, groupId: GROUP_ID, groupName: 'Design team' },
    role: 'editor',
    ...overrides,
  });
}

export const TOKEN = 'lnk_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';

export function linkGrant(overrides: Partial<LinkGrantView> = {}): LinkGrantView {
  return {
    id: '00000000-0000-4000-8000-0000000000a9',
    orgId: ORG,
    resourceType: 'transcript',
    resourceId: RESOURCE_ID,
    role: 'viewer',
    label: null,
    url: `https://app.example.com/s#${TOKEN}`,
    expiresAt: '2026-10-08T12:00:00.000Z',
    revokedAt: null,
    grantedById: ME,
    createdAt: NOW,
    ...overrides,
  };
}

export function sharedItem(overrides: Partial<SharedWithMeItem> = {}): SharedWithMeItem {
  return {
    grantId: '00000000-0000-4000-8000-0000000000f9',
    resourceType: 'transcript',
    resourceId: RESOURCE_ID,
    role: 'viewer',
    via: 'user_grant',
    groupId: null,
    title: 'Quarterly review',
    path: '/transcripts/c1',
    grantedById: ANA,
    expiresAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

export const RESOLUTION = {
  resourceType: 'transcript',
  resourceId: RESOURCE_ID,
  role: 'viewer',
  expiresAt: null,
  title: 'Quarterly review',
};

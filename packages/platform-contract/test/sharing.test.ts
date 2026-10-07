// The sharing contract (issue #728): the group, member and invite schemas
// parse what the API accepts and reject what it refuses, and the subpath loads
// in both module formats.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import {
  GROUP_INVITE_STATUSES,
  GROUP_ROLES,
  SHARING_LIMITS,
  addGroupMemberSchema,
  createGroupInviteSchema,
  createGroupSchema,
  groupListQuerySchema,
  groupSchema,
  updateGroupSchema,
} from '../src/sharing/index.js';

const require = createRequire(import.meta.url);

describe('@marinoscar/platform-contract/sharing', () => {
  it('ranks the roles admin, editor, viewer and lists the invite statuses', () => {
    expect(GROUP_ROLES).toEqual(['admin', 'editor', 'viewer']);
    expect(GROUP_INVITE_STATUSES).toEqual(['pending', 'accepted', 'declined', 'revoked', 'expired']);
  });

  it('defaults the list to my groups, page 1 of 20, and caps the page size', () => {
    expect(groupListQuerySchema.parse({})).toEqual({ scope: 'mine', page: 1, pageSize: 20 });
    expect(groupListQuerySchema.parse({ scope: 'all', page: '3', pageSize: '50' })).toEqual({ scope: 'all', page: 3, pageSize: 50 });
    expect(groupListQuerySchema.safeParse({ pageSize: SHARING_LIMITS.pageSizeMax + 1 }).success).toBe(false);
    expect(groupListQuerySchema.safeParse({ scope: 'everything' }).success).toBe(false);
  });

  it('trims a group name, refuses an empty one and an unknown field', () => {
    expect(createGroupSchema.parse({ name: '  Family  ' })).toEqual({ name: 'Family' });
    expect(createGroupSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createGroupSchema.safeParse({ name: 'x'.repeat(SHARING_LIMITS.groupNameMax + 1) }).success).toBe(false);
    expect(createGroupSchema.safeParse({ name: 'Family', orgId: 'b' }).success).toBe(false);
  });

  it('needs at least one field to update, and lets description be cleared', () => {
    expect(updateGroupSchema.safeParse({}).success).toBe(false);
    expect(updateGroupSchema.parse({ description: null })).toEqual({ description: null });
  });

  it('adds a member by exactly one of email and userId, lower-casing the address', () => {
    expect(addGroupMemberSchema.parse({ email: ' Ana@Example.COM ' })).toEqual({ email: 'ana@example.com', role: 'viewer' });
    expect(addGroupMemberSchema.parse({ userId: '11111111-1111-4111-8111-111111111111', role: 'editor' })).toMatchObject({ role: 'editor' });
    expect(addGroupMemberSchema.safeParse({}).success).toBe(false);
    expect(addGroupMemberSchema.safeParse({ email: 'a@example.com', userId: '11111111-1111-4111-8111-111111111111' }).success).toBe(false);
    expect(addGroupMemberSchema.safeParse({ email: 'not-an-address' }).success).toBe(false);
    expect(addGroupMemberSchema.safeParse({ email: 'a@example.com', role: 'owner' }).success).toBe(false);
  });

  it('invites a lower-cased address as a viewer by default', () => {
    expect(createGroupInviteSchema.parse({ email: 'Bo@Example.com' })).toEqual({ email: 'bo@example.com', role: 'viewer' });
  });

  it('describes a group with the caller role and member count', () => {
    const now = new Date().toISOString();
    const group = {
      id: '11111111-1111-4111-8111-111111111111',
      orgId: '22222222-2222-4222-8222-222222222222',
      name: 'Family',
      description: null,
      metadata: null,
      createdById: null,
      version: 1,
      myRole: null,
      memberCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    expect(groupSchema.parse(group)).toEqual(group);
    expect(groupSchema.safeParse({ ...group, myRole: 'owner' }).success).toBe(false);
  });

  it('loads the same names through require and import', async () => {
    const cjs = require('@marinoscar/platform-contract/sharing') as typeof import('../src/sharing/index.js');
    const esm = await import('@marinoscar/platform-contract/sharing');
    expect(Object.keys(cjs).sort()).toEqual(Object.keys(esm).sort());
    expect(cjs.groupListQuerySchema.parse({})).toEqual(esm.groupListQuerySchema.parse({}));
  });
});

// The grants contract (issue #729): the grant, "shared with me" and link-share
// schemas parse what the API accepts and reject what it refuses; the link URL
// carries its token in the fragment only.
import { describe, expect, it } from 'vitest';

import {
  ACCESS_SCOPES,
  GRANT_GRANTEE_KINDS,
  LINK_TOKEN_HEADER,
  LINK_TOKEN_PATTERN,
  LINK_TOKEN_PREFIX,
  SHARING_LIMITS,
  buildLinkUrl,
  createGrantSchema,
  grantListQuerySchema,
  grantSchema,
  issuedLinkGrantSchema,
  linkGrantCreateSchema,
  linkGrantListSchema,
  linkGrantViewSchema,
  publicLinkResolutionSchema,
  sharedWithMeQuerySchema,
  updateGrantSchema,
} from '../src/sharing/index.js';

const RESOURCE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const GROUP = '33333333-3333-4333-8333-333333333333';

describe('@marinoscar/platform-contract/sharing grants', () => {
  it('lists the grantee kinds and the access scopes', () => {
    expect(GRANT_GRANTEE_KINDS).toEqual(['user', 'group', 'link']);
    expect(ACCESS_SCOPES).toEqual(['owned', 'groups', 'shared', 'all']);
  });

  it('grants a user by exactly one of email and userId, lower-casing the address', () => {
    const base = { resourceType: 'transcript', resourceId: RESOURCE, role: 'viewer' };
    expect(createGrantSchema.parse({ ...base, grantee: { kind: 'user', email: ' Ana@Example.COM ' } })).toEqual({
      ...base,
      grantee: { kind: 'user', email: 'ana@example.com' },
    });
    expect(createGrantSchema.parse({ ...base, grantee: { kind: 'user', userId: USER } }).grantee).toEqual({ kind: 'user', userId: USER });
    expect(createGrantSchema.safeParse({ ...base, grantee: { kind: 'user' } }).success).toBe(false);
    expect(createGrantSchema.safeParse({ ...base, grantee: { kind: 'user', email: 'a@example.com', userId: USER } }).success).toBe(false);
  });

  it('grants a group by id, and refuses a link grantee on the user/group route', () => {
    const base = { resourceType: 'album', resourceId: RESOURCE, role: 'editor' };
    expect(createGrantSchema.parse({ ...base, grantee: { kind: 'group', groupId: GROUP } }).grantee).toEqual({ kind: 'group', groupId: GROUP });
    expect(createGrantSchema.safeParse({ ...base, grantee: { kind: 'group' } }).success).toBe(false);
    expect(createGrantSchema.safeParse({ ...base, grantee: { kind: 'link' } }).success).toBe(false);
  });

  it('accepts only snake_case resource types and roles, and an ISO expiry with an offset', () => {
    const ok = { resourceType: 'media_item', resourceId: RESOURCE, role: 'viewer', grantee: { kind: 'group', groupId: GROUP } };
    expect(createGrantSchema.safeParse(ok).success).toBe(true);
    expect(createGrantSchema.safeParse({ ...ok, resourceType: 'Media-Item' }).success).toBe(false);
    expect(createGrantSchema.safeParse({ ...ok, resourceType: 'x'.repeat(SHARING_LIMITS.grantIdentifierMax + 1) }).success).toBe(false);
    expect(createGrantSchema.safeParse({ ...ok, role: "viewer'; drop" }).success).toBe(false);
    expect(createGrantSchema.safeParse({ ...ok, expiresAt: '2030-01-01T00:00:00Z' }).success).toBe(true);
    expect(createGrantSchema.safeParse({ ...ok, expiresAt: '2030-01-01T00:00:00+02:00' }).success).toBe(true);
    expect(createGrantSchema.safeParse({ ...ok, expiresAt: 'tomorrow' }).success).toBe(false);
    expect(createGrantSchema.safeParse({ ...ok, orgId: RESOURCE }).success).toBe(false);
  });

  it('updates the role or the expiry, at least one, and lets the expiry be cleared', () => {
    expect(updateGrantSchema.safeParse({}).success).toBe(false);
    expect(updateGrantSchema.parse({ expiresAt: null })).toEqual({ expiresAt: null });
    expect(updateGrantSchema.parse({ role: 'editor' })).toEqual({ role: 'editor' });
  });

  it('lists the grants of one record and the records shared with me, page 1 of 20 by default', () => {
    expect(grantListQuerySchema.parse({ resourceType: 'transcript', resourceId: RESOURCE })).toEqual({
      resourceType: 'transcript',
      resourceId: RESOURCE,
      page: 1,
      pageSize: 20,
    });
    expect(grantListQuerySchema.safeParse({ resourceType: 'transcript' }).success).toBe(false);
    expect(sharedWithMeQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(sharedWithMeQuerySchema.parse({ resourceType: 'album', page: '2' })).toEqual({ resourceType: 'album', page: 2, pageSize: 20 });
  });

  it('describes a grant with a flat grantee', () => {
    const now = new Date().toISOString();
    const grant = {
      id: RESOURCE,
      orgId: USER,
      resourceType: 'transcript',
      resourceId: RESOURCE,
      grantee: { kind: 'user', userId: USER, email: 'ana@example.com', displayName: null, groupId: null, groupName: null },
      role: 'viewer',
      expiresAt: null,
      revokedAt: null,
      grantedById: null,
      createdAt: now,
      updatedAt: now,
    };
    expect(grantSchema.parse(grant)).toEqual(grant);
  });

  it('defines the link-share shapes #730 builds on', () => {
    expect(linkGrantCreateSchema.parse({ resourceType: 'album', resourceId: RESOURCE, role: 'viewer', label: '  Printer  ' })).toEqual({
      resourceType: 'album',
      resourceId: RESOURCE,
      role: 'viewer',
      label: 'Printer',
    });
    expect(linkGrantCreateSchema.safeParse({ resourceType: 'album', resourceId: RESOURCE, role: 'viewer', token: 'x' }).success).toBe(false);
    const now = new Date().toISOString();
    const view = {
      id: RESOURCE,
      orgId: USER,
      resourceType: 'album',
      resourceId: RESOURCE,
      role: 'viewer',
      label: null,
      url: null,
      expiresAt: null,
      revokedAt: null,
      grantedById: null,
      createdAt: now,
    };
    expect(linkGrantViewSchema.parse(view)).toEqual(view);
    expect(publicLinkResolutionSchema.parse({ resourceType: 'album', resourceId: RESOURCE, role: 'viewer', expiresAt: null, title: null })).toBeTruthy();
  });

  it('takes an optional role and reuseActive on link creation, and a label on update (#730)', () => {
    expect(linkGrantCreateSchema.parse({ resourceType: 'album', resourceId: RESOURCE })).toEqual({ resourceType: 'album', resourceId: RESOURCE });
    expect(linkGrantCreateSchema.parse({ resourceType: 'album', resourceId: RESOURCE, reuseActive: true, expiresAt: null })).toMatchObject({
      reuseActive: true,
      expiresAt: null,
    });
    expect(linkGrantCreateSchema.safeParse({ resourceType: 'album', resourceId: RESOURCE, reuseActive: 'yes' }).success).toBe(false);
    expect(updateGrantSchema.parse({ label: '  Kitchen  ' })).toEqual({ label: 'Kitchen' });
    expect(updateGrantSchema.parse({ label: null })).toEqual({ label: null });
    expect(updateGrantSchema.safeParse({ label: 'x'.repeat(SHARING_LIMITS.linkLabelMax + 1) }).success).toBe(false);
  });

  it('shapes the issued link (its token once) and the link list (#730)', () => {
    const token = `lnk_${'A'.repeat(43)}`;
    const now = new Date().toISOString();
    const grant = {
      id: RESOURCE, orgId: USER, resourceType: 'album', resourceId: RESOURCE, role: 'viewer', label: null,
      url: `https://app.example.com/s#${token}`, expiresAt: null, revokedAt: null, grantedById: USER, createdAt: now,
    };
    expect(issuedLinkGrantSchema.parse({ grant, url: grant.url, token })).toEqual({ grant, url: grant.url, token });
    expect(issuedLinkGrantSchema.safeParse({ grant, url: grant.url, token: 'pat_x' }).success).toBe(false);
    expect(linkGrantListSchema.parse({ items: [grant], total: 1, page: 1, pageSize: 20, totalPages: 1 }).items).toHaveLength(1);
  });

  it('recognises a link token by its prefix and length only', () => {
    expect(LINK_TOKEN_PREFIX).toBe('lnk_');
    expect(LINK_TOKEN_PATTERN.test(`lnk_${'a-_9'.repeat(10)}abc`)).toBe(true);
    expect(LINK_TOKEN_PATTERN.test(`lnk_${'a'.repeat(42)}`)).toBe(false);
    expect(LINK_TOKEN_PATTERN.test(`lnk_${'a'.repeat(42)}=`)).toBe(false);
    expect(LINK_TOKEN_PATTERN.test(`pat_${'a'.repeat(43)}`)).toBe(false);
  });

  it('puts the link token in the URL fragment, never in a path or a query', () => {
    expect(LINK_TOKEN_HEADER).toBe('x-link-token');
    expect(buildLinkUrl('https://app.example.com', 'tok')).toBe('https://app.example.com/s#tok');
    expect(buildLinkUrl('https://app.example.com///', 'tok')).toBe('https://app.example.com/s#tok');
    const url = new URL(buildLinkUrl('https://app.example.com', 'tok'));
    expect(url.pathname).toBe('/s');
    expect(url.search).toBe('');
    expect(url.hash).toBe('#tok');
  });
});

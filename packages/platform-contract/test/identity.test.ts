// The identity contract (issue #727): the sign-in error codes are one closed
// list, and every request schema validates exactly as the API's DTOs always
// have (these cases moved here from apps/api's create-pat and org DTO specs).
import { describe, expect, it } from 'vitest';

import {
  ASSIGNABLE_ORG_ROLES,
  AUTH_ERROR_CODES,
  DEFAULT_AUTH_ERROR_CODE,
  authErrorCodeSchema,
  createOrgInviteSchema,
  createOrganizationSchema,
  createPatSchema,
  currentUserSchema,
  deviceAuthorizeRequestSchema,
  deviceCodeRequestSchema,
  deviceTokenRequestSchema,
  isAuthErrorCode,
  orgInviteListQuerySchema,
  orgMemberListQuerySchema,
  renameOrganizationSchema,
  switchOrgSchema,
  updateOrgMemberSchema,
  type CurrentUser,
} from '../src/identity/index.js';

describe('sign-in error codes', () => {
  it('is the closed list the API redirects with, in its published order', () => {
    expect(AUTH_ERROR_CODES).toEqual([
      'not_allowlisted',
      'account_disabled',
      'access_denied',
      'authentication_failed',
      'server_misconfigured',
      'no_organization',
    ]);
    expect(DEFAULT_AUTH_ERROR_CODE).toBe('authentication_failed');
  });

  it('recognises a code and nothing else', () => {
    for (const code of AUTH_ERROR_CODES) expect(isAuthErrorCode(code)).toBe(true);
    for (const value of ['', 'Not_Allowlisted', '<script>', null, undefined, 3]) {
      expect(isAuthErrorCode(value)).toBe(false);
    }
    expect(authErrorCodeSchema.safeParse('access_denied').success).toBe(true);
    expect(authErrorCodeSchema.safeParse('anything').success).toBe(false);
  });
});

describe('createPatSchema', () => {
  const valid = { name: 'My CI Token', durationValue: 30, durationUnit: 'days' };

  it.each(['minutes', 'days', 'months'])('accepts the unit %s', (durationUnit) => {
    expect(createPatSchema.safeParse({ ...valid, durationUnit }).success).toBe(true);
  });

  it('trims the name and accepts the bounds', () => {
    expect(createPatSchema.parse({ ...valid, name: '  My Token  ' }).name).toBe('My Token');
    expect(createPatSchema.safeParse({ ...valid, name: 'a'.repeat(100) }).success).toBe(true);
    expect(createPatSchema.safeParse({ ...valid, durationValue: 1 }).success).toBe(true);
    expect(createPatSchema.safeParse({ ...valid, durationValue: 999 }).success).toBe(true);
  });

  it.each([
    { name: '' },
    { name: '   ' },
    { name: 'a'.repeat(101) },
    { name: 123 },
    { durationValue: 0 },
    { durationValue: 1000 },
    { durationValue: 1.5 },
    { durationValue: '30' },
    { durationUnit: 'weeks' },
    { durationUnit: '' },
    { orgId: 'not-a-uuid' },
  ])('rejects %j', (patch) => {
    expect(createPatSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('rejects a missing body', () => {
    for (const body of [{}, null, undefined]) expect(createPatSchema.safeParse(body).success).toBe(false);
  });
});

describe('switch-org and device flow', () => {
  it('requires a UUID org id', () => {
    expect(switchOrgSchema.safeParse({ orgId: '0b6f1c2e-7a53-4a8e-9d0c-2f6a1e9b7c11' }).success).toBe(true);
    expect(switchOrgSchema.safeParse({ orgId: 'org-b' }).success).toBe(false);
  });

  it('defaults the device credential to a session and refuses an unknown type', () => {
    expect(deviceCodeRequestSchema.parse({ clientInfo: { deviceName: 'laptop' } })).toEqual({
      clientInfo: { deviceName: 'laptop', tokenType: 'session' },
    });
    expect(deviceCodeRequestSchema.parse({})).toEqual({});
    expect(deviceCodeRequestSchema.safeParse({ clientInfo: { tokenType: 'PAT' } }).success).toBe(false);
  });

  it('validates the user code format and a non-empty device code', () => {
    expect(deviceAuthorizeRequestSchema.safeParse({ userCode: 'ABCD-1234', approve: true }).success).toBe(true);
    expect(deviceAuthorizeRequestSchema.safeParse({ userCode: 'abcd-1234', approve: true }).success).toBe(false);
    expect(deviceTokenRequestSchema.safeParse({ deviceCode: '' }).success).toBe(false);
  });
});

describe('organization administration', () => {
  const valid = { name: '  Acme Corp ', slug: 'acme-corp', firstAdminEmail: 'Boss@Acme.COM' };

  it('trims the name and lower-cases the first admin email', () => {
    expect(createOrganizationSchema.parse(valid)).toEqual({
      name: 'Acme Corp',
      slug: 'acme-corp',
      firstAdminEmail: 'boss@acme.com',
    });
  });

  it.each(['a', '-acme', 'acme-', 'ac me', 'acme_corp', 'x'.repeat(64)])('rejects the slug %p', (slug) => {
    expect(() => createOrganizationSchema.parse({ ...valid, slug })).toThrow();
  });

  it.each(['ab', 'acme', 'a1-b2', 'x'.repeat(63)])('accepts the slug %p', (slug) => {
    expect(createOrganizationSchema.parse({ ...valid, slug }).slug).toBe(slug);
  });

  it('rejects an unknown key, an empty name and a bad email', () => {
    expect(() => createOrganizationSchema.parse({ ...valid, isDefault: true })).toThrow();
    expect(() => createOrganizationSchema.parse({ ...valid, name: '   ' })).toThrow();
    expect(() => createOrganizationSchema.parse({ ...valid, firstAdminEmail: 'nope' })).toThrow();
  });

  it('renames but never re-slugs', () => {
    expect(renameOrganizationSchema.parse({ name: 'New' })).toEqual({ name: 'New' });
    expect(() => renameOrganizationSchema.parse({ name: 'New', slug: 'new' })).toThrow();
  });

  it('updates a member role, status or both, and never to a system role', () => {
    expect(ASSIGNABLE_ORG_ROLES).toEqual(['org_admin', 'contributor', 'viewer']);
    expect(updateOrgMemberSchema.parse({ roleName: 'viewer' })).toEqual({ roleName: 'viewer' });
    expect(updateOrgMemberSchema.parse({ status: 'suspended' })).toEqual({ status: 'suspended' });
    expect(() => updateOrgMemberSchema.parse({})).toThrow();
    expect(() => updateOrgMemberSchema.parse({ roleName: 'admin' })).toThrow();
    expect(() => updateOrgMemberSchema.parse({ roleName: 'viewer', orgId: 'x' })).toThrow();
  });

  it('invites by lower-cased email with an org role and takes no org id', () => {
    expect(createOrgInviteSchema.parse({ email: 'A@B.CO', roleName: 'contributor' })).toEqual({
      email: 'a@b.co',
      roleName: 'contributor',
    });
    expect(() => createOrgInviteSchema.parse({ email: 'a@b.co' })).toThrow();
    expect(() => createOrgInviteSchema.parse({ email: 'a@b.co', roleName: 'admin' })).toThrow();
    expect(() => createOrgInviteSchema.parse({ email: 'a@b.co', roleName: 'viewer', notes: 'x'.repeat(501) })).toThrow();
    expect(() => createOrgInviteSchema.parse({ email: 'a@b.co', roleName: 'viewer', orgId: 'org-b' })).toThrow();
  });

  it('defaults the list queries', () => {
    expect(orgMemberListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20, status: 'all' });
    expect(orgInviteListQuerySchema.parse({ page: '2' })).toEqual({ page: 2, pageSize: 20, status: 'all' });
  });
});

describe('currentUserSchema', () => {
  it('accepts the /api/auth/me payload', () => {
    const me: CurrentUser = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      email: 'user@example.com',
      displayName: null,
      profileImageUrl: null,
      providerProfileImageUrl: null,
      hasUploadedProfileImage: false,
      isActive: true,
      roles: [{ name: 'viewer' }],
      permissions: ['user_settings:read'],
      tenancyMode: 'single',
      activeOrg: { id: '0b6f1c2e-7a53-4a8e-9d0c-2f6a1e9b7c11', name: 'Default', slug: 'default' },
      memberships: [{ orgId: '0b6f1c2e-7a53-4a8e-9d0c-2f6a1e9b7c11', name: 'Default', slug: 'default', role: 'viewer' }],
    };
    expect(currentUserSchema.parse(me)).toEqual(me);
    expect(currentUserSchema.safeParse({ ...me, tenancyMode: 'shared' }).success).toBe(false);
  });
});

// The identity contract (issue #727): the sign-in error codes are one closed
// list, and every request schema validates exactly as the API's DTOs always
// have (these cases moved here from apps/api's create-pat and org DTO specs).
import { describe, expect, it } from 'vitest';

import {
  ASSIGNABLE_ORG_ROLES,
  BUILTIN_ORG_ROLES,
  ROLE_ID_PATTERN,
  roleDescriptorSchema,
  roleIdSchema,
  roleListQuerySchema,
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
  USER_EXTENSION_ID_PATTERN,
  USER_EXTENSION_LIMITS,
  userExtensionsSchema,
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
  const valid = { name: '  Org Kappa ', slug: 'kappa', firstAdminEmail: 'Boss@KAPPA.EXAMPLE.TEST' };

  it('trims the name and lower-cases the first admin email', () => {
    expect(createOrganizationSchema.parse(valid)).toEqual({
      name: 'Org Kappa',
      slug: 'kappa',
      firstAdminEmail: 'boss@kappa.example.test',
    });
  });

  it.each(['a', '-kappa', 'kappa-', 'ac me', 'kappa_org', 'x'.repeat(64)])('rejects the slug %p', (slug) => {
    expect(() => createOrganizationSchema.parse({ ...valid, slug })).toThrow();
  });

  it.each(['ab', 'kappa', 'a1-b2', 'x'.repeat(63)])('accepts the slug %p', (slug) => {
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

  it('updates a member role, status or both; the role is an open id checked by the API', () => {
    expect(BUILTIN_ORG_ROLES).toEqual(['org_admin', 'contributor', 'viewer']);
    expect(ASSIGNABLE_ORG_ROLES).toBe(BUILTIN_ORG_ROLES);
    expect(updateOrgMemberSchema.parse({ roleName: 'viewer' })).toEqual({ roleName: 'viewer' });
    expect(updateOrgMemberSchema.parse({ roleName: 'coach' })).toEqual({ roleName: 'coach' });
    expect(updateOrgMemberSchema.parse({ status: 'suspended' })).toEqual({ status: 'suspended' });
    expect(() => updateOrgMemberSchema.parse({})).toThrow();
    expect(() => updateOrgMemberSchema.parse({ roleName: 'Not A Role' })).toThrow();
    expect(() => updateOrgMemberSchema.parse({ roleName: 'viewer', orgId: 'x' })).toThrow();
  });

  it('checks the shape of a role id, not its existence', () => {
    for (const id of ['viewer', 'org_admin', 'coach', 'a', 'support-lead', 'x'.repeat(64)]) {
      expect(roleIdSchema.safeParse(id).success).toBe(true);
      expect(ROLE_ID_PATTERN.test(id)).toBe(true);
    }
    for (const id of ['', 'Coach', '1coach', '_coach', 'co ach', 'co:ach', 'x'.repeat(65), 'coach\n']) {
      expect(roleIdSchema.safeParse(id).success).toBe(false);
    }
  });

  it('describes roles and lists them by an optional scope', () => {
    expect(roleListQuerySchema.parse({})).toEqual({});
    expect(roleListQuerySchema.parse({ scope: 'org' })).toEqual({ scope: 'org' });
    expect(() => roleListQuerySchema.parse({ scope: 'group' })).toThrow();
    const role = { id: 'coach', label: 'Coach', description: 'Reviews workouts', scope: 'org', assignable: true };
    expect(roleDescriptorSchema.parse(role)).toEqual(role);
    expect(() => roleDescriptorSchema.parse({ ...role, assignable: 'yes' })).toThrow();
  });

  it('invites by lower-cased email with an org role and takes no org id', () => {
    expect(createOrgInviteSchema.parse({ email: 'A@B.CO', roleName: 'contributor' })).toEqual({
      email: 'a@b.co',
      roleName: 'contributor',
    });
    expect(() => createOrgInviteSchema.parse({ email: 'a@b.co' })).toThrow();
    expect(() => createOrgInviteSchema.parse({ email: 'a@b.co', roleName: 'Admin!' })).toThrow();
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

describe('user extensions (PP-14.25)', () => {
  const me: CurrentUser = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'user@example.com',
    displayName: null,
    profileImageUrl: null,
    providerProfileImageUrl: null,
    hasUploadedProfileImage: false,
    isActive: true,
    roles: [{ name: 'viewer' }],
    permissions: [],
    tenancyMode: 'single',
    activeOrg: null,
    memberships: [],
  };

  it('accepts /api/auth/me with and without extensions', () => {
    expect(currentUserSchema.parse(me)).toEqual(me);
    const withExtensions = { ...me, extensions: { billing: { plan: 'pro', seats: [1, 2] } } };
    expect(currentUserSchema.parse(withExtensions)).toEqual(withExtensions);
    expect(currentUserSchema.strict().parse(withExtensions)).toEqual(withExtensions);
  });

  it('keys extensions by a lower-case id and holds a JSON object under each', () => {
    expect(userExtensionsSchema.safeParse({ team: { name: 'Core' } }).success).toBe(true);
    expect(userExtensionsSchema.safeParse({ Team: { name: 'Core' } }).success).toBe(false);
    expect(userExtensionsSchema.safeParse({ team: 'Core' }).success).toBe(false);
    expect(userExtensionsSchema.safeParse({ team: ['Core'] }).success).toBe(false);
  });

  it('publishes the id pattern and the bounds the API holds a contribution to', () => {
    expect(USER_EXTENSION_ID_PATTERN.test('billing')).toBe(true);
    expect(USER_EXTENSION_ID_PATTERN.test('team-2')).toBe(true);
    expect(USER_EXTENSION_ID_PATTERN.test('x')).toBe(false);
    expect(USER_EXTENSION_ID_PATTERN.test('1team')).toBe(false);
    expect(USER_EXTENSION_LIMITS).toEqual({
      currentUserBytes: 4096,
      currentUserTotalBytes: 16384,
      userListBytes: 1024,
      userListTotalBytes: 4096,
      maxDepth: 5,
    });
  });
});

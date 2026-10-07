import * as tenancyMode from './tenancy-mode';
import {
  PrincipalFactory,
  resolveEffectiveAccess,
  selectCurrentMembership,
  type PrincipalMembership,
  type PrincipalRole,
  type PrincipalSource,
} from './principal.factory';
import { toRequestUser, type AuthenticatedUser } from './interfaces/authenticated-user.interface';

// =============================================================================
// PrincipalFactory (issue #723, PP-6.3)
// =============================================================================
//
// Effective permissions = system roles' grants ∪ the current-org membership
// role's grants. These pin the rule and the "current org" choice per mode.
// =============================================================================

const role = (name: string, permissions: string[]): PrincipalRole => ({
  name,
  rolePermissions: permissions.map((permission) => ({ permission: { name: permission } })),
});

const ADMIN = role('admin', ['jobs:read', 'users:read']);
const ORG_ADMIN = role('org_admin', ['ai:use', 'org_members:read', 'storage:read']);
const CONTRIBUTOR = role('contributor', ['ai:use', 'storage:read', 'storage:write']);
const VIEWER = role('viewer', ['storage:read', 'user_settings:read']);

function membership(overrides: Partial<PrincipalMembership> & { role: PrincipalRole }): PrincipalMembership {
  return {
    orgId: 'org-default',
    status: 'active',
    lastActiveAt: new Date('2026-10-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    org: { id: overrides.orgId ?? 'org-default', isDefault: (overrides.orgId ?? 'org-default') === 'org-default' },
    ...overrides,
  };
}

const user = (systemRoles: PrincipalRole[], memberships?: PrincipalMembership[]): PrincipalSource => ({
  userRoles: systemRoles.map((r) => ({ role: r })),
  ...(memberships ? { memberships } : {}),
});

describe('resolveEffectiveAccess', () => {
  it('unions the system roles\' grants with the current membership role\'s grants', () => {
    const access = resolveEffectiveAccess(user([ADMIN], [membership({ role: ORG_ADMIN })]), 'single');

    expect(access.systemRoles).toEqual(['admin']);
    expect(access.orgRole).toBe('org_admin');
    expect(access.roles).toEqual(['admin', 'org_admin']);
    expect(access.permissions.sort()).toEqual(['ai:use', 'jobs:read', 'org_members:read', 'storage:read', 'users:read']);
  });

  it('deduplicates a permission granted by both sides', () => {
    const access = resolveEffectiveAccess(
      user([role('admin', ['storage:read'])], [membership({ role: VIEWER })]),
      'single',
    );

    expect(access.permissions.filter((p) => p === 'storage:read')).toHaveLength(1);
  });

  it('gives an org-only member the org role and no system role', () => {
    const access = resolveEffectiveAccess(user([], [membership({ role: CONTRIBUTOR })]), 'single');

    expect(access.roles).toEqual(['contributor']);
    expect(access.permissions.sort()).toEqual(['ai:use', 'storage:read', 'storage:write']);
  });

  it('gives nothing from the org side when there is no membership', () => {
    expect(resolveEffectiveAccess(user([ADMIN], []), 'single')).toMatchObject({
      membership: null,
      orgRole: null,
      roles: ['admin'],
    });
    // A graph loaded without memberships at all (an older caller) behaves the same.
    expect(resolveEffectiveAccess(user([ADMIN]), 'multi').permissions.sort()).toEqual(['jobs:read', 'users:read']);
  });

  it('gives nothing from the org side when the membership is suspended', () => {
    const access = resolveEffectiveAccess(user([], [membership({ role: CONTRIBUTOR, status: 'suspended' })]), 'single');

    expect(access.orgRole).toBeNull();
    expect(access.permissions).toEqual([]);
    expect(access.roles).toEqual([]);
  });

  it('still honours a pre-split user_roles row of an org role', () => {
    expect(resolveEffectiveAccess(user([CONTRIBUTOR]), 'single').permissions.sort()).toEqual([
      'ai:use',
      'storage:read',
      'storage:write',
    ]);
  });

  it('reads role names when the graph carries no rolePermissions (name-only loads)', () => {
    const access = resolveEffectiveAccess(user([{ name: 'admin' }], [membership({ role: { name: 'viewer' } })]), 'single');

    expect(access.roles).toEqual(['admin', 'viewer']);
    expect(access.permissions).toEqual([]);
  });
});

describe('selectCurrentMembership', () => {
  const recentOther = membership({ orgId: 'org-acme', role: ORG_ADMIN, lastActiveAt: new Date('2026-10-06T00:00:00Z') });
  const olderDefault = membership({ role: VIEWER, lastActiveAt: new Date('2026-09-01T00:00:00Z') });

  it('single mode: the default organization\'s membership, whatever the recency', () => {
    expect(selectCurrentMembership([recentOther, olderDefault], 'single')?.orgId).toBe('org-default');
  });

  it('single mode: none when the default-org membership is suspended (no fallback to another org)', () => {
    expect(selectCurrentMembership([recentOther, { ...olderDefault, status: 'suspended' }], 'single')).toBeNull();
  });

  it('multi mode: the active membership used most recently', () => {
    expect(selectCurrentMembership([olderDefault, recentOther], 'multi')?.orgId).toBe('org-acme');
  });

  it('multi mode: skips a suspended membership', () => {
    expect(selectCurrentMembership([{ ...recentOther, status: 'suspended' }, olderDefault], 'multi')?.orgId).toBe('org-default');
  });

  it('multi mode: a never-used membership ranks last; ties go to the oldest membership', () => {
    const neverUsed = membership({ orgId: 'org-new', role: VIEWER, lastActiveAt: null });
    expect(selectCurrentMembership([neverUsed, olderDefault], 'multi')?.orgId).toBe('org-default');

    const a = membership({ orgId: 'org-a', role: VIEWER, createdAt: new Date('2026-03-01T00:00:00Z') });
    const b = membership({ orgId: 'org-b', role: VIEWER, createdAt: new Date('2026-02-01T00:00:00Z') });
    expect(selectCurrentMembership([a, b], 'multi')?.orgId).toBe('org-b');
  });

  it('returns null for no memberships', () => {
    expect(selectCurrentMembership(undefined, 'multi')).toBeNull();
    expect(selectCurrentMembership([], 'single')).toBeNull();
  });
});

describe('PrincipalFactory', () => {
  const factory = new PrincipalFactory();
  const loaded = { id: 'u1', email: 'u1@example.test', ...user([ADMIN], [membership({ role: ORG_ADMIN })]) };

  afterEach(() => jest.restoreAllMocks());

  it('reads the tenancy mode TenancyService recorded, single before it has', () => {
    expect(factory.mode()).toBe('single');
    jest.spyOn(tenancyMode, 'currentTenancyMode').mockReturnValue('multi');
    expect(factory.mode()).toBe('multi');
  });

  it('follows the mode TenancyService records at startup', () => {
    try {
      tenancyMode.recordTenancyMode('multi');
      expect(factory.mode()).toBe('multi');
    } finally {
      tenancyMode.recordTenancyMode('single');
    }
  });

  it('builds a UserPrincipal (the #687 contract) with the active org and memberships', () => {
    expect(factory.forUser(loaded, 'session')).toEqual({
      kind: 'user',
      userId: 'u1',
      email: 'u1@example.test',
      credential: 'session',
      roles: ['admin', 'org_admin'],
      permissions: expect.arrayContaining(['jobs:read', 'org_members:read']),
      activeOrgId: 'org-default',
      memberships: [{ orgId: 'org-default', role: 'org_admin' }],
    });
  });

  it('builds a NodePrincipal with no active organization', () => {
    const principal = factory.forNode(loaded, 'node-1');

    expect(principal).toMatchObject({ kind: 'node', credential: 'node', nodeId: 'node-1', roles: ['admin', 'org_admin'] });
    expect(principal).not.toHaveProperty('activeOrgId');
  });

  it('is what toRequestUser (the guards) uses', () => {
    const requestUser = toRequestUser({ ...loaded, isActive: true } as unknown as AuthenticatedUser);

    expect(requestUser.roles).toEqual(['admin', 'org_admin']);
    expect(requestUser.permissions.sort()).toEqual(factory.access(loaded).permissions.sort());
  });
});

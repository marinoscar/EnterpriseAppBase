// =============================================================================
// AuthService × the active organization (PP-6.4, #724)
// =============================================================================
//
// The org a token acts in, end to end through AuthService, over a mocked
// Prisma with the REAL OrganizationsService, TenancyService and PrincipalCache:
//
//   issue     every access token carries `org`, every refresh row its `orgId`;
//             sign-in picks the default org (single) or the most recently used
//             active membership (multi) and moves its `lastActiveAt`.
//   validate  a token is honoured only while `org` is an ACTIVE membership of
//             `sub` (within the cache TTL; at once after `invalidateUser`); a
//             `did` token must match its session's org; a token WITHOUT `org`
//             is the temporary single-mode compatibility path.
//   refresh   org-preserving; refused once that membership is not active.
//   switch    `switchOrg`: session credentials only, active memberships only,
//             rotates the refresh token, audits `auth:org_switched`.
// =============================================================================

import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { AllowlistService } from '../allowlist/allowlist.service';
import { EVENT_BUS } from '../common/event-bus/event-bus.interface';
import { InProcessEventBus } from '../common/event-bus/in-process-event-bus';
import { AppMetricsService } from '../common/otel/app-metrics.service';
import { AdminBootstrapService } from '../common/services/admin-bootstrap.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { TenancyService } from '../organizations/tenancy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, ORG_SWITCHED_AUDIT_ACTION } from './auth.service';
import { PRINCIPAL_CACHE_CLOCK, PrincipalCache } from './principal-cache/principal-cache.service';
import { toPrincipal } from './principal.factory';
import { toRequestUser, type AuthenticatedUser } from './interfaces/authenticated-user.interface';
import type { GoogleProfile } from './strategies/google.strategy';
import * as tenancyMode from './tenancy-mode';

const DEFAULT_ORG = { id: 'org-default', name: 'Default organization', slug: 'default', isDefault: true };

const role = (name: string, permissions: string[]) => ({
  id: `role-${name}`,
  name,
  description: null,
  rolePermissions: permissions.map((permission) => ({ permission: { id: permission, name: permission, description: null } })),
});
const VIEWER = role('viewer', ['storage:read']);
const CONTRIBUTOR = role('contributor', ['storage:read', 'storage:write']);

const membership = (orgId: string, overrides: Record<string, unknown> = {}) => ({
  id: `m-${orgId}`,
  orgId,
  userId: 'user-1',
  status: 'active',
  lastActiveAt: null as Date | null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  org: { id: orgId, isDefault: orgId === DEFAULT_ORG.id, name: `Org ${orgId}`, slug: orgId },
  role: VIEWER,
  ...overrides,
});

/** A user graph as `PRINCIPAL_USER_INCLUDE` loads it. */
const userGraph = (memberships: unknown[] = [membership(DEFAULT_ORG.id)], overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'person@example.test',
  isActive: true,
  displayName: null,
  providerDisplayName: 'Person',
  providerProfileImageUrl: null,
  profileImageUrl: null,
  userRoles: [],
  memberships,
  ...overrides,
});

const profile: GoogleProfile = {
  id: 'google-1',
  email: 'person@example.test',
  displayName: 'Person',
  picture: 'https://example.test/p.jpg',
};

interface Harness {
  service: AuthService;
  prisma: MockPrismaService;
  cache: PrincipalCache;
  sign: jest.Mock;
  metrics: { authLogin: jest.Mock; authRefresh: jest.Mock };
  tick: (ms: number) => void;
}

async function build(mode: 'single' | 'multi' = 'single'): Promise<Harness> {
  const prisma = createMockPrismaService();
  const metrics = { authLogin: jest.fn(), authRefresh: jest.fn() };
  const sign = jest.fn(() => 'jwt');
  let clock = 1_000_000;
  const config: Record<string, unknown> = {
    'jwt.accessTtlMinutes': 15,
    'jwt.refreshTtlDays': 14,
    'deviceAuth.tokenExpiryDays': 7,
    'tenancy.mode': mode,
    'auth.principalCacheTtlSeconds': 30,
  };

  prisma.organization.findFirst.mockResolvedValue(DEFAULT_ORG as never);
  prisma.refreshToken.create.mockResolvedValue({} as never);
  prisma.refreshToken.update.mockResolvedValue({} as never);
  prisma.membership.updateMany.mockResolvedValue({ count: 1 } as never);
  prisma.auditEvent.create.mockResolvedValue({} as never);

  const module = await Test.createTestingModule({
    providers: [
      AuthService,
      OrganizationsService,
      TenancyService,
      PrincipalCache,
      { provide: PRINCIPAL_CACHE_CLOCK, useValue: () => clock },
      { provide: EVENT_BUS, useValue: new InProcessEventBus() },
      { provide: PrismaService, useValue: prisma },
      { provide: JwtService, useValue: { sign, signAsync: jest.fn(async () => 'jwt') } },
      { provide: ConfigService, useValue: { get: jest.fn((key: string) => config[key]) } },
      { provide: AdminBootstrapService, useValue: { shouldGrantAdminRole: jest.fn().mockResolvedValue(false) } },
      {
        provide: AllowlistService,
        useValue: { isEmailAllowed: jest.fn().mockResolvedValue(true), markEmailClaimed: jest.fn() },
      },
      { provide: NotificationsService, useValue: { notify: jest.fn(), notifyAddress: jest.fn() } },
      { provide: AppMetricsService, useValue: metrics },
    ],
  }).compile();

  return {
    service: module.get(AuthService),
    prisma,
    cache: module.get(PrincipalCache),
    sign,
    metrics,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

/** The payload of the n-th signed access token. */
const signed = (h: Harness, n = 0) => h.sign.mock.calls[n][0];

afterEach(() => {
  jest.restoreAllMocks();
  tenancyMode.recordTenancyMode('single');
});

// -----------------------------------------------------------------------------
// Issuing
// -----------------------------------------------------------------------------

describe('issuing: every token carries the active org', () => {
  it('single mode: generateFullTokens binds both tokens to the default org', async () => {
    const h = await build('single');

    await h.service.generateFullTokens(userGraph());

    expect(signed(h).org).toBe(DEFAULT_ORG.id);
    expect(h.prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orgId: DEFAULT_ORG.id }),
    });
  });

  it('multi mode: the active membership used most recently, never a suspended one', async () => {
    const h = await build('multi');
    const graph = userGraph([
      membership('org-a', { lastActiveAt: new Date('2026-10-01T00:00:00Z') }),
      membership('org-b', { lastActiveAt: new Date('2026-10-05T00:00:00Z') }),
      membership('org-c', { lastActiveAt: new Date('2026-10-06T00:00:00Z'), status: 'suspended' }),
    ]);

    await h.service.generateFullTokens(graph);

    expect(signed(h).org).toBe('org-b');
  });

  it('an explicit orgId wins (device sessions, switch-org)', async () => {
    const h = await build('multi');

    await h.service.generateFullTokens(userGraph([membership('org-a')]), { orgId: 'org-z' });

    expect(signed(h).org).toBe('org-z');
  });

  it('sign-in issues for the chosen org and moves its lastActiveAt', async () => {
    const h = await build('single');
    const graph = userGraph();
    h.prisma.userIdentity.findUnique.mockResolvedValue({ id: 'i-1', userId: 'user-1', user: graph } as never);
    h.prisma.user.update.mockResolvedValue(graph as never);
    h.prisma.membership.findUnique.mockResolvedValue({ id: 'm-default' } as never);

    await h.service.handleGoogleLogin(profile);

    expect(signed(h).org).toBe(DEFAULT_ORG.id);
    expect(h.prisma.membership.updateMany).toHaveBeenCalledWith({
      where: { orgId: DEFAULT_ORG.id, userId: 'user-1' },
      data: { lastActiveAt: expect.any(Date) },
    });
  });

  it('single mode: a suspended default-org member is refused with no_organization', async () => {
    const h = await build('single');
    const graph = userGraph([membership(DEFAULT_ORG.id, { status: 'suspended' })]);
    h.prisma.userIdentity.findUnique.mockResolvedValue({ id: 'i-1', userId: 'user-1', user: graph } as never);
    h.prisma.user.update.mockResolvedValue(graph as never);
    h.prisma.membership.findUnique.mockResolvedValue({ id: 'm-default' } as never);

    await expect(h.service.handleGoogleLogin(profile)).rejects.toMatchObject({ reason: 'no_organization' });
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.metrics.authLogin).toHaveBeenCalledWith('no_organization');
  });

  it('refuses to issue (401) for a user with no organization to act in', async () => {
    const h = await build('multi');
    h.prisma.membership.findMany.mockResolvedValue([] as never);

    await expect(h.service.generateFullTokens(userGraph([]))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

// -----------------------------------------------------------------------------
// Validating
// -----------------------------------------------------------------------------

describe('validateJwtPayload: the org claim', () => {
  const payload = (org?: string, extra: Record<string, unknown> = {}) => ({
    sub: 'user-1',
    email: 'person@example.test',
    roles: [],
    ...(org !== undefined ? { org } : {}),
    ...extra,
  });

  it('honours an org the user is an active member of, binding it (non-enumerably)', async () => {
    const h = await build('multi');
    h.prisma.user.findUnique.mockResolvedValue(userGraph([membership('org-a'), membership('org-b', { role: CONTRIBUTOR })]) as never);

    const user = (await h.service.validateJwtPayload(payload('org-b'))) as AuthenticatedUser;

    expect(user.activeOrgId).toBe('org-b');
    expect(user.tokenKind).toBe('session');
    expect(Object.keys(user)).not.toContain('activeOrgId');
    expect(toRequestUser(user).permissions).toContain('storage:write');
    expect(toPrincipal(user, 'session')).toMatchObject({ activeOrgId: 'org-b', roles: ['contributor'] });
  });

  it('refuses an org the user is not a member of, or is suspended in', async () => {
    const h = await build('multi');
    h.prisma.user.findUnique.mockResolvedValue(
      userGraph([membership('org-a'), membership('org-s', { status: 'suspended' })]) as never,
    );

    await expect(h.service.validateJwtPayload(payload('org-x'))).resolves.toBeNull();
    await expect(h.service.validateJwtPayload(payload('org-s'))).resolves.toBeNull();
  });

  it('refuses a malformed org claim', async () => {
    const h = await build('single');
    h.prisma.user.findUnique.mockResolvedValue(userGraph() as never);

    await expect(h.service.validateJwtPayload(payload(''))).resolves.toBeNull();
    await expect(h.service.validateJwtPayload({ ...payload(), org: 42 } as never)).resolves.toBeNull();
  });

  it('keys the cache by org: two orgs, two entries', async () => {
    const h = await build('multi');
    h.prisma.user.findUnique.mockResolvedValue(userGraph([membership('org-a'), membership('org-b')]) as never);

    await h.service.validateJwtPayload(payload('org-a'));
    await h.service.validateJwtPayload(payload('org-b'));
    await h.service.validateJwtPayload(payload('org-a'));

    expect(h.prisma.user.findUnique).toHaveBeenCalledTimes(2);
    expect(h.cache.stats()).toMatchObject({ size: 2, hits: 1 });
    expect(h.cache.get({ userId: 'user-1', orgId: 'org-b', tokenKind: 'session' })?.activeOrgId).toBe('org-b');
  });

  it('a removed membership is refused within the cache TTL, and at once after invalidateUser', async () => {
    const h = await build('multi');
    h.prisma.user.findUnique
      .mockResolvedValueOnce(userGraph([membership('org-a'), membership('org-b')]) as never)
      .mockResolvedValue(userGraph([membership('org-b')]) as never);

    await expect(h.service.validateJwtPayload(payload('org-a'))).resolves.not.toBeNull();

    // Removed without an invalidation (another replica, bus down): the cached
    // principal is served until the TTL, then the database says no.
    await expect(h.service.validateJwtPayload(payload('org-a'))).resolves.not.toBeNull();
    h.tick(h.cache.ttlMs);
    await expect(h.service.validateJwtPayload(payload('org-a'))).resolves.toBeNull();
  });

  it('invalidateUser makes the very next request see the removal', async () => {
    const h = await build('multi');
    h.prisma.user.findUnique
      .mockResolvedValueOnce(userGraph([membership('org-a')]) as never)
      .mockResolvedValue(userGraph([]) as never);

    await expect(h.service.validateJwtPayload(payload('org-a'))).resolves.not.toBeNull();
    h.cache.invalidateUser('user-1');
    await expect(h.service.validateJwtPayload(payload('org-a'))).resolves.toBeNull();
  });

  describe('a token without org (issued before #724)', () => {
    it('single mode: accepted and mapped to the default org, as before', async () => {
      const h = await build('single');
      h.prisma.user.findUnique.mockResolvedValue(userGraph([membership(DEFAULT_ORG.id, { role: CONTRIBUTOR })]) as never);

      const user = (await h.service.validateJwtPayload(payload())) as AuthenticatedUser;

      expect(user).not.toBeNull();
      expect(user.activeOrgId).toBeUndefined();
      expect(toPrincipal(user, user.tokenKind!)).toMatchObject({ activeOrgId: DEFAULT_ORG.id, credential: 'session' });
      expect(toRequestUser(user).permissions).toContain('storage:write');
    });

    it('multi mode: refused', async () => {
      const h = await build('multi');
      h.prisma.user.findUnique.mockResolvedValue(userGraph() as never);

      await expect(h.service.validateJwtPayload(payload())).resolves.toBeNull();
      expect(h.prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('single mode: refused once one access-token lifetime has passed since the deploy', async () => {
      const h = await build('single');
      h.prisma.user.findUnique.mockResolvedValue(userGraph() as never);
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now + 15 * 60 * 1000 + 1);

      await expect(h.service.validateJwtPayload(payload())).resolves.toBeNull();
    });

    it('single mode: a device token gets the device token lifetime', async () => {
      const h = await build('single');
      h.prisma.user.findUnique.mockResolvedValue(userGraph() as never);
      h.prisma.deviceCode.findUnique.mockResolvedValue({
        id: 'dc-1',
        userId: 'user-1',
        revokedAt: null,
        credentialExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      } as never);
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now + 60 * 60 * 1000);

      const user = (await h.service.validateJwtPayload(payload(undefined, { did: 'dc-1' }))) as AuthenticatedUser;
      expect(user?.tokenKind).toBe('device');
    });
  });

  describe('a device token (did)', () => {
    const live = (orgId: string | null) => ({
      id: 'dc-1',
      userId: 'user-1',
      revokedAt: null,
      credentialExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      orgId,
    });

    it('is honoured when its org matches its device session, as tokenKind device', async () => {
      const h = await build('single');
      h.prisma.user.findUnique.mockResolvedValue(userGraph() as never);
      h.prisma.deviceCode.findUnique.mockResolvedValue(live(DEFAULT_ORG.id) as never);

      const user = (await h.service.validateJwtPayload(payload(DEFAULT_ORG.id, { did: 'dc-1' }))) as AuthenticatedUser;

      expect(user?.tokenKind).toBe('device');
      expect(h.prisma.deviceCode.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ select: expect.objectContaining({ orgId: true }) }),
      );
    });

    it('is refused when it names another org than its device session', async () => {
      const h = await build('multi');
      h.prisma.user.findUnique.mockResolvedValue(userGraph([membership('org-a'), membership('org-b')]) as never);
      h.prisma.deviceCode.findUnique.mockResolvedValue(live('org-a') as never);

      await expect(h.service.validateJwtPayload(payload('org-b', { did: 'dc-1' }))).resolves.toBeNull();
    });
  });
});

// -----------------------------------------------------------------------------
// Refreshing
// -----------------------------------------------------------------------------

describe('refreshAccessToken: org-preserving', () => {
  const row = (orgId: string | null, graph = userGraph([membership('org-a'), membership('org-b')])) => ({
    id: 'rt-1',
    userId: 'user-1',
    tokenHash: 'h',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    createdAt: new Date(),
    deviceCodeId: null,
    deviceCode: null,
    orgId,
    user: graph,
  });

  it('re-issues for the same org', async () => {
    const h = await build('multi');
    h.prisma.refreshToken.findUnique.mockResolvedValue(row('org-b') as never);

    await h.service.refreshAccessToken('cookie');

    expect(signed(h).org).toBe('org-b');
    expect(h.prisma.refreshToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orgId: 'org-b' }) });
  });

  it('fails (401) once that membership is no longer active, revoking the presented token', async () => {
    const h = await build('multi');
    h.prisma.refreshToken.findUnique.mockResolvedValue(row('org-x') as never);

    await expect(h.service.refreshAccessToken('cookie')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.prisma.refreshToken.update).toHaveBeenCalledWith({ where: { id: 'rt-1' }, data: { revokedAt: expect.any(Date) } });
    expect(h.prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(h.metrics.authRefresh).toHaveBeenCalledWith('no_organization');
  });

  it('binds a row written before #724 (no org) to the org a sign-in would pick', async () => {
    const h = await build('single');
    h.prisma.refreshToken.findUnique.mockResolvedValue(row(null, userGraph()) as never);

    await h.service.refreshAccessToken('cookie');

    expect(signed(h).org).toBe(DEFAULT_ORG.id);
  });
});

// -----------------------------------------------------------------------------
// Switching
// -----------------------------------------------------------------------------

describe('switchOrg', () => {
  const session = { id: 'user-1', tokenKind: 'session' as const, activeOrgId: 'org-a' };
  const stored = (overrides: Record<string, unknown> = {}) => ({
    id: 'rt-1',
    userId: 'user-1',
    tokenHash: 'h',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    createdAt: new Date(),
    deviceCodeId: null,
    orgId: 'org-a',
    user: userGraph([membership('org-a'), membership('org-b'), membership('org-s', { status: 'suspended' })]),
    ...overrides,
  });

  it('refuses a PAT, device or node credential (403) before reading anything', async () => {
    const h = await build('multi');
    for (const tokenKind of ['pat', 'device', 'node'] as const) {
      await expect(h.service.switchOrg({ ...session, tokenKind }, 'org-b', 'cookie')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
    expect(h.prisma.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('requires a live, non-device refresh token of the caller (401)', async () => {
    const h = await build('multi');
    await expect(h.service.switchOrg(session, 'org-b', undefined)).rejects.toBeInstanceOf(UnauthorizedException);

    for (const bad of [
      null,
      stored({ userId: 'someone-else' }),
      stored({ revokedAt: new Date() }),
      stored({ expiresAt: new Date(Date.now() - 1) }),
      stored({ deviceCodeId: 'dc-1' }),
    ]) {
      h.prisma.refreshToken.findUnique.mockResolvedValueOnce(bad as never);
      await expect(h.service.switchOrg(session, 'org-b', 'cookie')).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('switches to another active membership: rotates the refresh token, issues for the new org, audits', async () => {
    const h = await build('multi');
    h.prisma.refreshToken.findUnique.mockResolvedValue(stored() as never);
    h.prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 } as never);

    const tokens = await h.service.switchOrg(session, 'org-b', 'cookie');

    expect(tokens.refreshToken).toEqual(expect.any(String));
    expect(signed(h).org).toBe('org-b');
    expect(h.prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'rt-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(h.prisma.refreshToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orgId: 'org-b' }) });
    expect(h.prisma.membership.updateMany).toHaveBeenCalledWith({
      where: { orgId: 'org-b', userId: 'user-1' },
      data: { lastActiveAt: expect.any(Date) },
    });
    expect(h.prisma.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user-1',
        action: ORG_SWITCHED_AUDIT_ACTION,
        targetType: 'organization',
        targetId: 'org-b',
        meta: { fromOrgId: 'org-a' },
      },
    });
    expect(ORG_SWITCHED_AUDIT_ACTION).toBe('auth:org_switched');
  });

  it('404s for an org the caller is not an active member of, issuing nothing', async () => {
    const h = await build('multi');
    h.prisma.refreshToken.findUnique.mockResolvedValue(stored() as never);

    await expect(h.service.switchOrg(session, 'org-x', 'cookie')).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.service.switchOrg(session, 'org-s', 'cookie')).rejects.toBeInstanceOf(NotFoundException);
    expect(h.prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(h.sign).not.toHaveBeenCalled();
  });

  it('refuses a refresh token another switch already consumed (401)', async () => {
    const h = await build('multi');
    h.prisma.refreshToken.findUnique.mockResolvedValue(stored() as never);
    h.prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(h.service.switchOrg(session, 'org-b', 'cookie')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.sign).not.toHaveBeenCalled();
  });

  it('single mode: the default org is a no-op re-issue, any other id is 404', async () => {
    const h = await build('single');
    h.prisma.refreshToken.findUnique.mockResolvedValue(
      stored({ orgId: DEFAULT_ORG.id, user: userGraph([membership(DEFAULT_ORG.id), membership('org-b')]) }) as never,
    );
    h.prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 } as never);

    await h.service.switchOrg({ ...session, activeOrgId: DEFAULT_ORG.id }, DEFAULT_ORG.id, 'cookie');
    expect(signed(h).org).toBe(DEFAULT_ORG.id);

    await expect(
      h.service.switchOrg({ ...session, activeOrgId: DEFAULT_ORG.id }, 'org-b', 'cookie'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// -----------------------------------------------------------------------------
// /api/auth/me
// -----------------------------------------------------------------------------

describe('getCurrentUser: activeOrg and memberships', () => {
  it('reports the bound org, and every active membership with its role', async () => {
    const h = await build('multi');
    h.prisma.user.findUnique.mockResolvedValue({
      ...userGraph([
        membership('org-a'),
        membership('org-b', { role: CONTRIBUTOR }),
        membership('org-s', { status: 'suspended' }),
      ]),
      userSettings: null,
    } as never);

    const me = await h.service.getCurrentUser('user-1', 'org-b');

    expect(me.activeOrg).toEqual({ id: 'org-b', name: 'Org org-b', slug: 'org-b' });
    expect(me.memberships).toEqual([
      { orgId: 'org-a', name: 'Org org-a', slug: 'org-a', role: 'viewer' },
      { orgId: 'org-b', name: 'Org org-b', slug: 'org-b', role: 'contributor' },
    ]);
    expect(me.permissions).toContain('storage:write');
    expect(me.tenancyMode).toBe('multi');
  });

  it('is null when the bound org is not an active membership', async () => {
    const h = await build('multi');
    h.prisma.user.findUnique.mockResolvedValue({ ...userGraph([membership('org-a')]), userSettings: null } as never);

    await expect(h.service.getCurrentUser('user-1', 'org-x')).resolves.toMatchObject({ activeOrg: null });
  });
});

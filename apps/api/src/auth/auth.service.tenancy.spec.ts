// =============================================================================
// AuthService × TENANCY_MODE (PP-6.2, #722)
// =============================================================================
//
// The sign-in rules by tenancy mode, through the REAL OrganizationsService and
// TenancyService over a mocked Prisma:
//
//   single  every signing-in user is ensured a default-org membership: a new
//           user inside the creation transaction, a returning one (self-heal)
//           at sign-in when the row is missing.
//   multi   nobody auto-joins except INITIAL_ADMIN_EMAIL; zero active
//           memberships is refused with `no_organization` (metric outcome of
//           the same name, a warn log with the user id and never the email).
//
// `auth.service.spec.ts` covers everything else (with the default, single).
// =============================================================================

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { installTestTracing, type TestTracing } from '../../test/helpers/otel-tracing.helper';
import { AllowlistService } from '../allowlist/allowlist.service';
import { EVENT_BUS } from '../common/event-bus/event-bus.interface';
import { InProcessEventBus } from '../common/event-bus/in-process-event-bus';
import { AppMetricsService } from '../common/otel/app-metrics.service';
import { AdminBootstrapService } from '../common/services/admin-bootstrap.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { TenancyService } from '../organizations/tenancy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthLoginDeniedException, buildAuthErrorRedirectUrl, resolveAuthErrorCode } from './auth-error-codes';
import { AuthService } from './auth.service';
import { PrincipalCache } from './principal-cache/principal-cache.service';
import type { GoogleProfile } from './strategies/google.strategy';

const DEFAULT_ORG = { id: 'org-default', name: 'Default organization', slug: 'default', isDefault: true };
const ADMIN_EMAIL = 'admin@example.test';

const profile: GoogleProfile = {
  id: 'google-1',
  email: 'person@example.test',
  displayName: 'Person',
  picture: 'https://example.test/p.jpg',
};
const adminProfile: GoogleProfile = { ...profile, id: 'google-admin', email: ADMIN_EMAIL };

const role = { id: 'role-viewer', name: 'viewer', rolePermissions: [] };
const userRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: profile.email,
  isActive: true,
  userRoles: [{ role }],
  ...overrides,
});

interface Harness {
  service: AuthService;
  prisma: MockPrismaService;
  metrics: { authLogin: jest.Mock; authRefresh: jest.Mock };
  notify: jest.Mock;
}

async function build(mode: 'single' | 'multi' | undefined): Promise<Harness> {
  const prisma = createMockPrismaService();
  const metrics = { authLogin: jest.fn(), authRefresh: jest.fn() };
  const notify = jest.fn().mockResolvedValue(undefined);
  const config: Record<string, unknown> = {
    'jwt.accessTtlMinutes': 15,
    'jwt.refreshTtlDays': 14,
    INITIAL_ADMIN_EMAIL: ADMIN_EMAIL,
    'tenancy.mode': mode,
  };

  prisma.organization.findFirst.mockResolvedValue(DEFAULT_ORG as never);
  prisma.membership.upsert.mockResolvedValue({ id: 'membership-1' } as never);
  prisma.role.findUnique.mockResolvedValue(role as never);
  prisma.$transaction.mockImplementation((async (callback: (tx: unknown) => unknown) => callback(prisma)) as never);
  prisma.refreshToken.create.mockResolvedValue({} as never);

  const module = await Test.createTestingModule({
    providers: [
      AuthService,
      OrganizationsService,
      TenancyService,
      PrincipalCache,
      { provide: EVENT_BUS, useValue: new InProcessEventBus() },
      { provide: PrismaService, useValue: prisma },
      { provide: JwtService, useValue: { sign: jest.fn(() => 'jwt'), signAsync: jest.fn(async () => 'jwt') } },
      { provide: ConfigService, useValue: { get: jest.fn((key: string) => config[key]) } },
      {
        provide: AdminBootstrapService,
        useValue: { shouldGrantAdminRole: jest.fn().mockResolvedValue(false) },
      },
      {
        provide: AllowlistService,
        useValue: {
          isEmailAllowed: jest.fn().mockResolvedValue(true),
          markEmailClaimed: jest.fn().mockResolvedValue(undefined),
        },
      },
      { provide: NotificationsService, useValue: { notify, notifyAddress: jest.fn() } },
      { provide: AppMetricsService, useValue: metrics },
    ],
  }).compile();

  return { service: module.get(AuthService), prisma, metrics, notify };
}

/** A sign-in that creates a brand-new user. */
function asNewUser(h: Harness, row = userRow()) {
  h.prisma.userIdentity.findUnique.mockResolvedValue(null);
  h.prisma.user.findUnique.mockResolvedValue(null);
  h.prisma.user.create.mockResolvedValue(row as never);
  h.prisma.user.update.mockResolvedValue(row as never);
}

/** A sign-in by a user whose Google identity is already linked. */
function asReturningUser(h: Harness, row = userRow()) {
  h.prisma.userIdentity.findUnique.mockResolvedValue({ id: 'identity-1', userId: row.id, user: row } as never);
  h.prisma.user.update.mockResolvedValue(row as never);
}

async function refusal(promise: Promise<unknown>): Promise<AuthLoginDeniedException> {
  try {
    await promise;
  } catch (error) {
    return error as AuthLoginDeniedException;
  }
  throw new Error('expected the sign-in to be refused');
}

afterEach(() => jest.restoreAllMocks());

describe('AuthService sign-in, TENANCY_MODE=single (the default)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await build(undefined);
  });

  it('joins a new user to the default org inside the creation transaction, once', async () => {
    asNewUser(h);

    await h.service.handleGoogleLogin(profile);

    expect(h.prisma.membership.upsert).toHaveBeenCalledTimes(1);
    expect(h.prisma.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId_userId: { orgId: DEFAULT_ORG.id, userId: 'user-1' } } }),
    );
    // Created on this sign-in: no self-heal read, no membership count.
    expect(h.prisma.membership.findUnique).not.toHaveBeenCalled();
    expect(h.prisma.membership.count).not.toHaveBeenCalled();
  });

  it('self-heals a returning user who has no default-org membership', async () => {
    asReturningUser(h);
    h.prisma.membership.findUnique.mockResolvedValue(null);

    const tokens = await h.service.handleGoogleLogin(profile);

    expect(tokens.accessToken).toBe('jwt');
    expect(h.prisma.membership.upsert).toHaveBeenCalledTimes(1);
    expect(h.prisma.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId_userId: { orgId: DEFAULT_ORG.id, userId: 'user-1' } },
        create: expect.objectContaining({ orgId: DEFAULT_ORG.id, userId: 'user-1' }),
      }),
    );
    expect(h.metrics.authLogin).toHaveBeenCalledWith('success');
  });

  it('writes nothing for a returning user who already has the membership', async () => {
    asReturningUser(h);
    h.prisma.membership.findUnique.mockResolvedValue({ id: 'membership-1' } as never);

    await h.service.handleGoogleLogin(profile);

    expect(h.prisma.membership.upsert).not.toHaveBeenCalled();
    expect(h.prisma.membership.count).not.toHaveBeenCalled();
  });

  it('self-heals on the identity-linking path too (existing user, new identity)', async () => {
    h.prisma.userIdentity.findUnique.mockResolvedValue(null);
    h.prisma.user.findUnique.mockResolvedValue(userRow() as never);
    h.prisma.userIdentity.create.mockResolvedValue({} as never);
    h.prisma.user.update.mockResolvedValue(userRow() as never);
    h.prisma.membership.findUnique.mockResolvedValue(null);

    await h.service.handleGoogleLogin(profile);

    expect(h.prisma.membership.upsert).toHaveBeenCalledTimes(1);
  });

  it('refuses a disabled user as account_disabled without writing a membership', async () => {
    asReturningUser(h, userRow({ isActive: false }));
    h.prisma.membership.findUnique.mockResolvedValue(null);

    expect((await refusal(h.service.handleGoogleLogin(profile))).reason).toBe('account_disabled');
    expect(h.prisma.membership.upsert).not.toHaveBeenCalled();
  });

  it('reports single on /api/auth/me', async () => {
    h.prisma.user.findUnique.mockResolvedValue({ ...userRow(), userSettings: null } as never);

    expect((await h.service.getCurrentUser('user-1')).tenancyMode).toBe('single');
  });
});

describe('AuthService sign-in, TENANCY_MODE=multi', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await build('multi');
  });

  it('creates a new non-admin user without a membership, then refuses with no_organization', async () => {
    asNewUser(h);
    h.prisma.membership.count.mockResolvedValue(0);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const error = await refusal(h.service.handleGoogleLogin(profile));

    expect(error).toBeInstanceOf(AuthLoginDeniedException);
    expect(error.reason).toBe('no_organization');
    expect(resolveAuthErrorCode(error)).toBe('no_organization');
    expect(buildAuthErrorRedirectUrl('http://localhost:3535', resolveAuthErrorCode(error))).toBe(
      'http://localhost:3535/auth/callback?error=no_organization',
    );
    // Not joined: the default org is not even looked up.
    expect(h.prisma.organization.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.membership.upsert).not.toHaveBeenCalled();
    expect(h.prisma.user.create).toHaveBeenCalledTimes(1);
    expect(h.prisma.membership.count).toHaveBeenCalledWith({ where: { userId: 'user-1', status: 'active' } });
    // Metric outcome, no tokens, no welcome.
    expect(h.metrics.authLogin).toHaveBeenCalledWith('no_organization');
    expect(h.metrics.authLogin).not.toHaveBeenCalledWith('success');
    expect(h.prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
    // Audit: the refusal log names the user id, never the email.
    const refusalLog = warn.mock.calls.map(([message]) => String(message)).find((m) => m.includes('no active organization'));
    expect(refusalLog).toContain('user-1');
    expect(refusalLog).not.toContain(profile.email);
  });

  it('joins the INITIAL_ADMIN_EMAIL user to the default org at creation and signs them in', async () => {
    asNewUser(h, userRow({ id: 'admin-1', email: ADMIN_EMAIL }));
    h.prisma.membership.count.mockResolvedValue(1);

    const tokens = await h.service.handleGoogleLogin(adminProfile);

    expect(tokens.accessToken).toBe('jwt');
    expect(h.prisma.membership.upsert).toHaveBeenCalledTimes(1);
    expect(h.prisma.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId_userId: { orgId: DEFAULT_ORG.id, userId: 'admin-1' } } }),
    );
    expect(h.metrics.authLogin).toHaveBeenCalledWith('success');
  });

  it('self-heals a returning INITIAL_ADMIN_EMAIL user who lost the membership', async () => {
    asReturningUser(h, userRow({ id: 'admin-1', email: ADMIN_EMAIL }));
    h.prisma.membership.findUnique.mockResolvedValue(null);
    h.prisma.membership.count.mockResolvedValue(1);

    await h.service.handleGoogleLogin(adminProfile);

    expect(h.prisma.membership.upsert).toHaveBeenCalledTimes(1);
  });

  it('signs in a returning user with an active membership, writing nothing', async () => {
    asReturningUser(h);
    h.prisma.membership.count.mockResolvedValue(1);

    const tokens = await h.service.handleGoogleLogin(profile);

    expect(tokens.accessToken).toBe('jwt');
    expect(h.prisma.membership.findUnique).not.toHaveBeenCalled();
    expect(h.prisma.membership.upsert).not.toHaveBeenCalled();
    expect(h.metrics.authLogin).toHaveBeenCalledWith('success');
  });

  it('refuses a returning user with zero active memberships', async () => {
    asReturningUser(h);
    h.prisma.membership.count.mockResolvedValue(0);

    expect((await refusal(h.service.handleGoogleLogin(profile))).reason).toBe('no_organization');
    expect(h.prisma.membership.upsert).not.toHaveBeenCalled();
    expect(h.prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('tells a disabled user account_disabled first, before any membership check', async () => {
    asReturningUser(h, userRow({ isActive: false }));
    h.prisma.membership.count.mockResolvedValue(0);

    expect((await refusal(h.service.handleGoogleLogin(profile))).reason).toBe('account_disabled');
    expect(h.prisma.membership.count).not.toHaveBeenCalled();
  });

  it('reports multi on /api/auth/me', async () => {
    h.prisma.user.findUnique.mockResolvedValue({ ...userRow(), userSettings: null } as never);

    expect((await h.service.getCurrentUser('user-1')).tenancyMode).toBe('multi');
  });
});

describe('AuthService sign-in: the tenancy.mode span attribute', () => {
  let tracing: TestTracing;

  beforeEach(() => {
    tracing = installTestTracing();
  });

  afterEach(() => tracing.uninstall());

  it('puts the mode (never an org id) on the active span', async () => {
    const h = await build('multi');
    asReturningUser(h);
    h.prisma.membership.count.mockResolvedValue(1);

    await tracing.tracer.startActiveSpan('GET /api/auth/google/callback', async (span) => {
      await h.service.handleGoogleLogin(profile);
      span.end();
    });

    const [span] = tracing.exporter.getFinishedSpans();
    expect(span.attributes['tenancy.mode']).toBe('multi');
    expect(Object.keys(span.attributes).some((key) => key.includes('org.id') || key.includes('org_id'))).toBe(false);
  });
});

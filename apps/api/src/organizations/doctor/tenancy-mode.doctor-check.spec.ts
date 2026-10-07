import { ConfigService } from '@nestjs/config';
import { DoctorCheckRegistry } from '@marinoscar/platform-api/doctor';

import { createMockPrismaService, MockPrismaService } from '../../../test/mocks/prisma.mock';
import { PrismaService } from '../../prisma/prisma.service';
import { TenancyService } from '../tenancy.service';
import { TenancyModeDoctorCheck, decideTenancyMode } from './tenancy-mode.doctor-check';

describe('decideTenancyMode (PP-6.2, #722)', () => {
  const healthy = { defaultOrgExists: true, organizations: 1, usersWithoutMembership: 0 };

  it('fails when no default organization exists, in either mode', () => {
    for (const mode of ['single', 'multi'] as const) {
      const outcome = decideTenancyMode(mode, { ...healthy, defaultOrgExists: false, organizations: 0 });

      expect(outcome.status).toBe('fail');
      expect(outcome.detail).toMatch(/No default organization/);
      expect(outcome.remedy).toMatch(/prisma:migrate.*prisma:seed/);
    }
  });

  it('fails single mode with more than one organization, naming TENANCY_MODE=multi and consolidation', () => {
    const outcome = decideTenancyMode('single', { ...healthy, organizations: 3 });

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toBe('Single-org mode, but 3 organizations exist');
    expect(outcome.remedy).toMatch(/TENANCY_MODE=multi/);
    expect(outcome.remedy).toMatch(/consolidate/);
  });

  it('warns single mode about active users without a default-org membership', () => {
    const outcome = decideTenancyMode('single', { ...healthy, usersWithoutMembership: 4 });

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toMatch(/^4 active user\(s\)/);
    expect(outcome.remedy).toMatch(/next sign-in/);
  });

  it('passes a healthy single-org deployment, with the data the story names', () => {
    expect(decideTenancyMode('single', healthy)).toEqual({
      status: 'pass',
      detail: 'Single-org: every active user is in the default organization',
      data: { mode: 'single', organizations: 1, usersWithoutMembership: 0 },
    });
  });

  it('passes multi mode with several organizations, reporting users who belong to none', () => {
    const outcome = decideTenancyMode('multi', { ...healthy, organizations: 5, usersWithoutMembership: 2 });

    expect(outcome.status).toBe('pass');
    expect(outcome.detail).toMatch(/Multi-org: 5 organization\(s\); 2 active user\(s\) belong to none/);
    expect(outcome.data).toEqual({ mode: 'multi', organizations: 5, usersWithoutMembership: 2 });
    expect(decideTenancyMode('multi', healthy).detail).toBe('Multi-org: 1 organization(s)');
  });
});

describe('TenancyModeDoctorCheck (PP-6.2, #722)', () => {
  let prisma: MockPrismaService;
  let registry: { register: jest.Mock };

  function checkFor(mode: string | undefined): TenancyModeDoctorCheck {
    const tenancy = new TenancyService({ get: () => mode } as unknown as ConfigService);
    return new TenancyModeDoctorCheck(
      registry as unknown as DoctorCheckRegistry,
      tenancy,
      prisma as unknown as PrismaService,
    );
  }

  beforeEach(() => {
    prisma = createMockPrismaService();
    registry = { register: jest.fn() };
    prisma.organization.count.mockImplementation((async (args?: { where?: { isDefault?: boolean } }) =>
      args?.where?.isDefault ? 1 : 2) as never);
    prisma.user.count.mockResolvedValue(0 as never);
  });

  it('registers itself as tenancy.mode in the auth category, after db.connection', () => {
    const check = checkFor(undefined);
    check.onModuleInit();

    expect(registry.register).toHaveBeenCalledWith(check);
    expect(check).toMatchObject({
      id: 'tenancy.mode',
      category: 'auth',
      settingsPath: '/admin/settings/users',
      dependsOn: ['db.connection'],
    });
  });

  it('counts default orgs, all orgs and active users without an active default-org membership (single)', async () => {
    const outcome = await checkFor('single').run();

    expect(prisma.organization.count).toHaveBeenCalledWith({ where: { isDefault: true } });
    expect(prisma.organization.count).toHaveBeenCalledWith();
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { isActive: true, memberships: { none: { status: 'active', org: { isDefault: true } } } },
    });
    // Two organizations in single mode.
    expect(outcome.status).toBe('fail');
  });

  it('counts active users without any active membership in multi mode, and passes', async () => {
    prisma.user.count.mockResolvedValue(3 as never);

    const outcome = await checkFor('multi').run();

    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { isActive: true, memberships: { none: { status: 'active' } } },
    });
    expect(outcome).toMatchObject({
      status: 'pass',
      data: { mode: 'multi', organizations: 2, usersWithoutMembership: 3 },
    });
  });

  it('is read-only: it never writes', async () => {
    await checkFor('single').run();

    expect(prisma.membership.upsert).not.toHaveBeenCalled();
    expect(prisma.membership.create).not.toHaveBeenCalled();
    expect(prisma.organization.create).not.toHaveBeenCalled();
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});

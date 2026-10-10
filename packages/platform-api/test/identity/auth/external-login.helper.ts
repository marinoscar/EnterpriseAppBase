import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AuthService } from '../../../src/identity/auth/auth.service';
import { AdminBootstrapService } from '../../../src/identity/auth/admin-bootstrap.service';
import { AllowlistService } from '../../../src/identity/allowlist/allowlist.service';
import { PRINCIPAL_CACHE_CLOCK, PrincipalCache } from '../../../src/identity/auth/principal-cache/principal-cache.service';
import { OrganizationsService } from '../../../src/identity/organizations/organizations.service';
import { TenancyService } from '../../../src/identity/organizations/tenancy.service';
import { IDENTITY_SIGNIN_POLICY, type SignInPolicy } from '../../../src/identity/auth/sign-in-policy';
import { IDENTITY_AUTH_CREDENTIALS, type AuthProviderCredentials } from '../../../src/identity/ports';
import {
  AppMetricsService,
  EVENT_BUS,
  InProcessEventBus,
  NOTIFY_MOCK,
  PrismaService,
  identityUserPorts,
  notifierProvider,
} from '../support/app-doubles';
import { createMockPrismaService } from '../support/prisma.mock';

const DEFAULT_ORG = { id: 'org-default', name: 'Default organization', slug: 'default', isDefault: true };

/** A role row as the harness's `role.findUnique` answers it. */
export interface HarnessRole {
  id: string;
  name: string;
  scope: 'org' | 'system';
  rolePermissions: never[];
}

/**
 * An `AuthService` over a mocked Prisma, a real principal cache, tenancy
 * `single` and the default organization, with the optional policy and credential
 * bindings of PP-14.9 and every identity event captured.
 */
export async function setupExternalLoginHarness(
  options: { policy?: SignInPolicy; credentials?: AuthProviderCredentials } = {},
) {
  const prisma = createMockPrismaService();
  const events: Array<[string, unknown]> = [];
  const config = {
    values: {
      'jwt.accessTtlMinutes': 15,
      'jwt.refreshTtlDays': 14,
      'jwt.secret': 'test-secret',
      appUrl: 'https://app.example.com',
    } as Record<string, unknown>,
  };
  const configService = { get: jest.fn((key: string) => config.values[key]) };
  const allowlist = {
    isEmailAllowed: jest.fn().mockResolvedValue(true),
    markEmailClaimed: jest.fn().mockResolvedValue(undefined),
  };
  const metrics = { authLogin: jest.fn(), authRefresh: jest.fn(), add: jest.fn() };

  const roles = new Map<string, HarnessRole>([
    ['viewer', { id: 'role-viewer', name: 'viewer', scope: 'org', rolePermissions: [] }],
    ['org_admin', { id: 'role-org_admin', name: 'org_admin', scope: 'org', rolePermissions: [] }],
    ['admin', { id: 'role-admin', name: 'admin', scope: 'system', rolePermissions: [] }],
  ]);

  const created = { id: 'user-1', email: 'octo@example.com', isActive: true, userRoles: [] as unknown[], memberships: [] as unknown[] };

  prisma.organization.findFirst.mockResolvedValue(DEFAULT_ORG as any);
  prisma.membership.upsert.mockResolvedValue({ id: 'membership-1' } as any);
  prisma.role.findUnique.mockImplementation((async (args: any) => roles.get(args.where.name) ?? null) as any);
  prisma.userIdentity.findUnique.mockResolvedValue(null);
  // By address: no such user. By id (the reload after a system role was added): the created one.
  prisma.user.findUnique.mockImplementation((async (args: any) => (args.where.id ? { ...created, userRoles: userRolesOf(prisma) } : null)) as any);
  prisma.$transaction.mockImplementation((async (callback: any) => callback(prisma)) as any);
  prisma.user.create.mockImplementation((async (args: any) => ({ ...created, email: args.data.email })) as any);
  prisma.user.update.mockResolvedValue(created as any);
  prisma.refreshToken.create.mockResolvedValue({} as any);
  prisma.userRole.upsert.mockResolvedValue({} as any);

  const module = await Test.createTestingModule({
    providers: [
      ...identityUserPorts,
      notifierProvider,
      AuthService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: JwtService,
        useValue: { sign: jest.fn().mockReturnValue('jwt'), signAsync: jest.fn().mockResolvedValue('jwt'), verify: jest.fn() },
      },
      { provide: ConfigService, useValue: configService },
      { provide: AdminBootstrapService, useValue: { shouldGrantAdminRole: jest.fn().mockResolvedValue(false), assignAdminRole: jest.fn() } },
      { provide: AllowlistService, useValue: allowlist },
      PrincipalCache,
      OrganizationsService,
      TenancyService,
      { provide: EVENT_BUS, useValue: new InProcessEventBus() },
      { provide: PRINCIPAL_CACHE_CLOCK, useValue: () => 1_000_000 },
      { provide: AppMetricsService, useValue: metrics },
      { provide: NOTIFY_MOCK, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifyAddress: jest.fn().mockResolvedValue(undefined) } },
      { provide: EventEmitter2, useValue: { emit: jest.fn((name: string, payload: unknown) => (events.push([name, payload]), true)) } },
      ...(options.policy ? [{ provide: IDENTITY_SIGNIN_POLICY, useValue: options.policy }] : []),
      ...(options.credentials ? [{ provide: IDENTITY_AUTH_CREDENTIALS, useValue: options.credentials }] : []),
    ],
  }).compile();

  return { service: module.get(AuthService), prisma, events, metrics, allowlist, config, roles };
}

/** The system roles the harness's `userRole.upsert` was asked to add, as the reloaded user's `userRoles`. */
function userRolesOf(prisma: ReturnType<typeof createMockPrismaService>): unknown[] {
  return prisma.userRole.upsert.mock.calls.map((call) => ({ role: { id: (call[0] as any).create.roleId, name: 'mapped', rolePermissions: [] } }));
}

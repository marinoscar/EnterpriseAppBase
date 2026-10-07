// =============================================================================
// Device authorization × the active organization (PP-6.4, #724)
// =============================================================================
//
// A device session is bound to the APPROVER's active org: set at approval (or,
// for a row approved before #724, at collection), carried by the session
// tokens as `org`, and the org of the PAT a device collects. A credential is
// minted only while that membership is active. Revoking a session invalidates
// the owner's cached principals after the transaction commits.
// =============================================================================

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DeviceCodeStatus } from '@prisma/client';

import { createMockPrismaService, MockPrismaService } from '../support/prisma.mock';
import { AuthService } from '../../../src/identity/auth/auth.service';
import { PrincipalCache } from '../../../src/identity/auth/principal-cache/principal-cache.service';
import { PatService } from '../../../src/identity/pat/pat.service';
import { PrismaService } from '../support/app-doubles';
import { DeviceAuthService } from '../../../src/identity/device-auth/device-auth.service';

const member = (orgId: string, status = 'active') => ({
  orgId,
  status,
  lastActiveAt: null,
  org: { id: orgId, isDefault: false },
  role: { name: 'viewer', rolePermissions: [] },
});

const approver = (memberships: unknown[]) => ({
  id: 'user-1',
  email: 'person@example.test',
  isActive: true,
  userRoles: [],
  memberships,
});

describe('DeviceAuthService org binding (#724)', () => {
  let service: DeviceAuthService;
  let prisma: MockPrismaService;
  let auth: { generateFullTokens: jest.Mock; chooseSignInOrg: jest.Mock };
  let pats: { createToken: jest.Mock };
  let cache: { invalidateUser: jest.Mock };
  let code = 0;

  /** A fresh device code per test: the service rate-limits polls per code. */
  const nextCode = () => `device-code-${++code}-${Date.now()}`;

  const approved = (orgId: string | null, memberships: unknown[], tokenType?: 'pat') => ({
    id: 'dc-1',
    status: DeviceCodeStatus.approved,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    userId: 'user-1',
    orgId,
    clientInfo: tokenType ? { tokenType, deviceName: 'laptop' } : null,
    user: approver(memberships),
  });

  beforeEach(async () => {
    prisma = createMockPrismaService();
    auth = {
      generateFullTokens: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 60 }),
      chooseSignInOrg: jest.fn().mockResolvedValue('org-default'),
    };
    pats = {
      createToken: jest.fn().mockResolvedValue({
        token: 'pat_x',
        id: 'pat-1',
        name: 'Device: laptop',
        tokenPrefix: 'pat_x',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString(),
        orgId: 'org-a',
      }),
    };
    cache = { invalidateUser: jest.fn() };
    prisma.deviceCode.updateMany.mockResolvedValue({ count: 1 } as never);

    const module = await Test.createTestingModule({
      providers: [
        DeviceAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthService, useValue: auth },
        { provide: PatService, useValue: pats },
        { provide: PrincipalCache, useValue: cache },
        { provide: ConfigService, useValue: { get: jest.fn((_key: string, fallback?: unknown) => fallback) } },
      ],
    }).compile();
    service = module.get(DeviceAuthService);
  });

  describe('authorizeDevice', () => {
    beforeEach(() => {
      prisma.deviceCode.findUnique.mockResolvedValue({
        id: 'dc-1',
        status: DeviceCodeStatus.pending,
        expiresAt: new Date(Date.now() + 60_000),
      } as never);
      prisma.deviceCode.update.mockResolvedValue({} as never);
    });

    it("binds an approved session to the approver's active org", async () => {
      await service.authorizeDevice('user-1', 'ABCD-1234', true, 'org-a');

      expect(prisma.deviceCode.update).toHaveBeenCalledWith({
        where: { id: 'dc-1' },
        data: { status: DeviceCodeStatus.approved, userId: 'user-1', orgId: 'org-a' },
      });
    });

    it('binds nothing on a denial', async () => {
      await service.authorizeDevice('user-1', 'ABCD-1234', false, 'org-a');

      expect(prisma.deviceCode.update).toHaveBeenCalledWith({
        where: { id: 'dc-1' },
        data: { status: DeviceCodeStatus.denied, userId: null },
      });
    });
  });

  describe('pollForToken', () => {
    it('session path: the tokens carry the session org', async () => {
      prisma.deviceCode.findUnique.mockResolvedValue(approved('org-a', [member('org-a')]) as never);

      await service.pollForToken(nextCode());

      expect(auth.generateFullTokens).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' }),
        expect.objectContaining({ deviceCodeId: 'dc-1', orgId: 'org-a' }),
      );
      // Already bound: the claim does not rewrite it.
      expect(prisma.deviceCode.updateMany.mock.calls[0][0].data).not.toHaveProperty('orgId');
    });

    it('a row approved before #724 is bound at collection, in the claim itself', async () => {
      prisma.deviceCode.findUnique.mockResolvedValue(approved(null, [member('org-default')]) as never);

      await service.pollForToken(nextCode());

      expect(auth.chooseSignInOrg).toHaveBeenCalled();
      expect(prisma.deviceCode.updateMany.mock.calls[0][0].data).toMatchObject({ orgId: 'org-default' });
      expect(auth.generateFullTokens).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ orgId: 'org-default' }),
      );
    });

    it('PAT path: the collected PAT is bound to the session org', async () => {
      prisma.deviceCode.findUnique.mockResolvedValue(approved('org-a', [member('org-a')], 'pat') as never);

      await service.pollForToken(nextCode());

      expect(pats.createToken).toHaveBeenCalledWith('user-1', expect.objectContaining({ orgId: 'org-a' }));
    });

    it('refuses (access_denied) and mints nothing once the approver left the org', async () => {
      for (const memberships of [[], [member('org-a', 'suspended')]]) {
        prisma.deviceCode.findUnique.mockResolvedValueOnce(approved('org-a', memberships) as never);
        await expect(service.pollForToken(nextCode())).rejects.toMatchObject({
          response: { error: 'access_denied' },
        });
      }
      expect(prisma.deviceCode.updateMany).not.toHaveBeenCalled();
      expect(auth.generateFullTokens).not.toHaveBeenCalled();
    });

    it('PAT path: a PatService org refusal becomes access_denied', async () => {
      prisma.deviceCode.findUnique.mockResolvedValue(approved('org-a', [member('org-a')], 'pat') as never);
      pats.createToken.mockRejectedValue(new BadRequestException('orgId must be ...'));

      await expect(service.pollForToken(nextCode())).rejects.toMatchObject({
        response: { error: 'access_denied' },
      });
    });
  });

  it('revokeDeviceSession invalidates the owner after the transaction committed', async () => {
    const order: string[] = [];
    prisma.deviceCode.findUnique.mockResolvedValue({
      id: 's-1',
      userId: 'user-1',
      collectedAt: new Date(),
      patId: null,
      revokedAt: null,
    } as never);
    prisma.$transaction.mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => {
      await fn(prisma);
      order.push('committed');
    }) as never);
    prisma.deviceCode.update.mockResolvedValue({} as never);
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 } as never);
    cache.invalidateUser.mockImplementation(() => order.push('invalidate'));

    await service.revokeDeviceSession('user-1', 's-1');

    expect(cache.invalidateUser).toHaveBeenCalledWith('user-1');
    expect(order).toEqual(['committed', 'invalidate']);
  });
});

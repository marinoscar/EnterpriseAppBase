import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseSeedException } from '@marinoscar/platform-api/core';
import { PrismaService } from '../prisma/prisma.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/mocks/prisma.mock';
import { OrganizationsService } from './organizations.service';
import { PrincipalCache } from '../auth/principal-cache/principal-cache.service';
import { NotFoundException } from '@nestjs/common';
import { DefaultOrganizationMissingException } from './organizations.errors';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prisma: MockPrismaService;
  let principalCache: { invalidateUser: jest.Mock; invalidate: jest.Mock };

  const defaultOrg = {
    id: 'org-default',
    name: 'Default organization',
    slug: 'default',
    isDefault: true,
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    principalCache = { invalidateUser: jest.fn(), invalidate: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: prisma },
        // #724: membership mutations invalidate the principal cache.
        { provide: PrincipalCache, useValue: principalCache },
      ],
    }).compile();
    service = module.get(OrganizationsService);
  });

  describe('getDefaultOrg', () => {
    it('returns the organization flagged isDefault', async () => {
      prisma.organization.findFirst.mockResolvedValue(defaultOrg as any);

      await expect(service.getDefaultOrg()).resolves.toBe(defaultOrg);
      expect(prisma.organization.findFirst).toHaveBeenCalledWith({
        where: { isDefault: true },
      });
    });

    it('throws a typed seed error when no default organization exists', async () => {
      prisma.organization.findFirst.mockResolvedValue(null);

      const error = await service.getDefaultOrg().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DefaultOrganizationMissingException);
      expect(error).toBeInstanceOf(DatabaseSeedException);
      expect((error as Error).message).toContain('npm run prisma:seed');
    });
  });

  describe('listActiveMemberships', () => {
    it('lists only the user\'s active memberships with their organization, most recently used first', async () => {
      const rows = [{ id: 'm1', userId: 'u1', orgId: 'org-default', org: defaultOrg }];
      prisma.membership.findMany.mockResolvedValue(rows as any);

      await expect(service.listActiveMemberships('u1')).resolves.toBe(rows);
      expect(prisma.membership.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', status: 'active' },
        include: { org: true },
        orderBy: [
          { lastActiveAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'asc' },
        ],
      });
    });
  });

  describe('ensureMembership', () => {
    it('upserts on orgId_userId through the caller\'s transaction client, never the service client', async () => {
      const tx = createMockPrismaService();
      const membership = { id: 'm1', orgId: 'org-default', userId: 'u1' };
      tx.membership.upsert.mockResolvedValue(membership as any);

      const result = await service.ensureMembership(tx as any, 'org-default', 'u1', 'role-viewer');

      expect(result).toBe(membership);
      expect(tx.membership.upsert).toHaveBeenCalledWith({
        where: { orgId_userId: { orgId: 'org-default', userId: 'u1' } },
        update: {},
        create: {
          orgId: 'org-default',
          userId: 'u1',
          roleId: 'role-viewer',
          lastActiveAt: expect.any(Date),
        },
      });
      expect(prisma.membership.upsert).not.toHaveBeenCalled();
    });

    it('leaves an existing membership untouched, role included (empty update)', async () => {
      const tx = createMockPrismaService();
      tx.membership.upsert.mockResolvedValue({ id: 'm1', status: 'suspended' } as any);

      await service.ensureMembership(tx as any, 'org-default', 'u1', 'role-org-admin');

      expect(tx.membership.upsert.mock.calls[0]![0]).toMatchObject({ update: {} });
    });
  });

  // PP-6.2 (#722): the sign-in self-heal and the multi-mode membership count.
  describe('ensureDefaultOrgMembership', () => {
    beforeEach(() => {
      prisma.organization.findFirst.mockResolvedValue(defaultOrg as any);
    });

    it('writes nothing when the user is already a member (any status)', async () => {
      prisma.membership.findUnique.mockResolvedValue({ id: 'm-1' } as any);

      await expect(service.ensureDefaultOrgMembership('user-1')).resolves.toEqual({
        orgId: 'org-default',
        created: false,
      });
      expect(prisma.membership.findUnique).toHaveBeenCalledWith({
        where: { orgId_userId: { orgId: 'org-default', userId: 'user-1' } },
        select: { id: true },
      });
      expect(prisma.membership.upsert).not.toHaveBeenCalled();
    });

    it('creates the missing membership through the idempotent upsert, with the default org role', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);
      prisma.membership.upsert.mockResolvedValue({ id: 'm-2' } as any);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-viewer' } as any);

      await expect(service.ensureDefaultOrgMembership('user-1')).resolves.toEqual({
        orgId: 'org-default',
        created: true,
      });
      expect(prisma.role.findUnique).toHaveBeenCalledWith({ where: { name: 'viewer' }, select: { id: true } });
      expect(prisma.membership.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_userId: { orgId: 'org-default', userId: 'user-1' } },
          update: {},
          create: expect.objectContaining({ roleId: 'role-viewer' }),
        }),
      );
      // #724: after the (untransacted) write.
      expect(principalCache.invalidateUser).toHaveBeenCalledWith('user-1');
      expect(principalCache.invalidateUser.mock.invocationCallOrder[0]).toBeGreaterThan(
        prisma.membership.upsert.mock.invocationCallOrder[0],
      );
    });

    it('restores a membership with the org role it is given (an administrator: org_admin, #723)', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);
      prisma.membership.upsert.mockResolvedValue({ id: 'm-3' } as any);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-org-admin' } as any);

      await service.ensureDefaultOrgMembership('user-1', 'org_admin');

      expect(prisma.role.findUnique).toHaveBeenCalledWith({ where: { name: 'org_admin' }, select: { id: true } });
      expect(prisma.membership.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ roleId: 'role-org-admin' }) }),
      );
    });

    it('fails with a seed error, writing nothing, when the role row is missing', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.ensureDefaultOrgMembership('user-1')).rejects.toThrow(/Role "viewer"/);
      expect(prisma.membership.upsert).not.toHaveBeenCalled();
    });

    it('throws DefaultOrganizationMissingException when the default org is missing', async () => {
      prisma.organization.findFirst.mockResolvedValue(null);

      await expect(service.ensureDefaultOrgMembership('user-1')).rejects.toBeInstanceOf(
        DefaultOrganizationMissingException,
      );
      expect(prisma.membership.upsert).not.toHaveBeenCalled();
    });
  });

  describe('countActiveMemberships', () => {
    it('counts only active memberships, in any organization', async () => {
      prisma.membership.count.mockResolvedValue(2);

      await expect(service.countActiveMemberships('user-1')).resolves.toBe(2);
      expect(prisma.membership.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: 'active' },
      });
    });
  });
  // PP-6.4 (#724): the membership mutations the member admin API will call.
  // Each invalidates the user's principals AFTER its write.
  describe('membership mutations invalidate the principal cache', () => {
    const after = (write: jest.Mock) => {
      expect(principalCache.invalidateUser).toHaveBeenCalledWith('user-1');
      expect(principalCache.invalidateUser.mock.invocationCallOrder[0]).toBeGreaterThan(
        write.mock.invocationCallOrder[0],
      );
    };

    it('removeMembership deletes, then invalidates', async () => {
      prisma.membership.deleteMany.mockResolvedValue({ count: 1 } as any);
      await service.removeMembership('org-a', 'user-1');
      expect(prisma.membership.deleteMany).toHaveBeenCalledWith({ where: { orgId: 'org-a', userId: 'user-1' } });
      after(prisma.membership.deleteMany as unknown as jest.Mock);
    });

    it('removeMembership 404s, invalidating nothing, when there is no membership', async () => {
      prisma.membership.deleteMany.mockResolvedValue({ count: 0 } as any);
      await expect(service.removeMembership('org-a', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(principalCache.invalidateUser).not.toHaveBeenCalled();
    });

    it('setMembershipStatus updates, then invalidates', async () => {
      prisma.membership.findUnique.mockResolvedValue({ id: 'm-1' } as any);
      prisma.membership.update.mockResolvedValue({ id: 'm-1', status: 'suspended' } as any);
      await service.setMembershipStatus('org-a', 'user-1', 'suspended');
      expect(prisma.membership.update).toHaveBeenCalledWith({ where: { id: 'm-1' }, data: { status: 'suspended' } });
      after(prisma.membership.update as unknown as jest.Mock);
    });

    it('setMembershipRole updates the role, then invalidates', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-contributor' } as any);
      prisma.membership.findUnique.mockResolvedValue({ id: 'm-1' } as any);
      prisma.membership.update.mockResolvedValue({ id: 'm-1' } as any);
      await service.setMembershipRole('org-a', 'user-1', 'contributor');
      expect(prisma.membership.update).toHaveBeenCalledWith({ where: { id: 'm-1' }, data: { roleId: 'role-contributor' } });
      after(prisma.membership.update as unknown as jest.Mock);
    });

    it('setMembershipStatus and setMembershipRole 404 on a missing membership, invalidating nothing', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-viewer' } as any);
      await expect(service.setMembershipStatus('org-a', 'user-1', 'active')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.setMembershipRole('org-a', 'user-1', 'viewer')).rejects.toBeInstanceOf(NotFoundException);
      expect(principalCache.invalidateUser).not.toHaveBeenCalled();
    });

    it('touchMembership moves lastActiveAt and does not invalidate', async () => {
      prisma.membership.updateMany.mockResolvedValue({ count: 1 } as any);
      await service.touchMembership('org-a', 'user-1');
      expect(prisma.membership.updateMany).toHaveBeenCalledWith({
        where: { orgId: 'org-a', userId: 'user-1' },
        data: { lastActiveAt: expect.any(Date) },
      });
      expect(principalCache.invalidateUser).not.toHaveBeenCalled();
    });
  });

  // PP-6.4 (#724): the org a new sign-in is bound to.
  describe('signInOrgId', () => {
    const member = (orgId: string, status: 'active' | 'suspended', lastActiveAt: Date | null) => ({
      orgId,
      status,
      lastActiveAt,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    it('single mode: the default org, unless that membership is suspended', async () => {
      prisma.organization.findFirst.mockResolvedValue(defaultOrg as any);
      await expect(service.signInOrgId({ id: 'user-1' }, 'single')).resolves.toBe('org-default');
      await expect(
        service.signInOrgId({ id: 'user-1', memberships: [member('org-default', 'active', null)] }, 'single'),
      ).resolves.toBe('org-default');
      await expect(
        service.signInOrgId({ id: 'user-1', memberships: [member('org-default', 'suspended', null)] }, 'single'),
      ).resolves.toBeNull();
    });

    it('single mode: null when the default org is missing (fail closed)', async () => {
      prisma.organization.findFirst.mockResolvedValue(null);
      await expect(service.signInOrgId({ id: 'user-1' }, 'single')).resolves.toBeNull();
    });

    it('multi mode: the active membership used most recently, from the graph', async () => {
      const memberships = [
        member('org-a', 'active', new Date('2026-10-01T00:00:00Z')),
        member('org-b', 'active', new Date('2026-10-05T00:00:00Z')),
        member('org-c', 'suspended', new Date('2026-10-06T00:00:00Z')),
      ];
      await expect(service.signInOrgId({ id: 'user-1', memberships }, 'multi')).resolves.toBe('org-b');
      expect(prisma.membership.findMany).not.toHaveBeenCalled();
    });

    it('multi mode: falls back to the database, and null with no active membership', async () => {
      prisma.membership.findMany.mockResolvedValueOnce([{ orgId: 'org-z', org: {} }] as any);
      await expect(service.signInOrgId({ id: 'user-1' }, 'multi')).resolves.toBe('org-z');
      prisma.membership.findMany.mockResolvedValueOnce([] as any);
      await expect(service.signInOrgId({ id: 'user-1', memberships: [] }, 'multi')).resolves.toBeNull();
    });
  });

  // #726 (PP-6.7): invitations claimed at sign-in.
  describe('claimPendingInvites', () => {
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);

    function invite(overrides: Record<string, unknown> = {}) {
      return {
        id: 'invite-1',
        orgId: 'org-b',
        email: 'new@example.com',
        status: 'pending',
        expiresAt: future,
        roleId: 'role-org_admin',
        role: { id: 'role-org_admin', name: 'org_admin' },
        ...overrides,
      };
    }

    beforeEach(() => {
      prisma.$transaction.mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)) as never);
      prisma.invite.updateMany.mockResolvedValue({ count: 1 } as any);
    });

    it('returns 0 and writes nothing when there is no pending invitation', async () => {
      prisma.invite.findMany.mockResolvedValue([] as any);

      await expect(service.claimPendingInvites('user-1', 'New@Example.com')).resolves.toBe(0);
      expect(prisma.invite.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'new@example.com', status: 'pending' } }),
      );
      expect(principalCache.invalidateUser).not.toHaveBeenCalled();
    });

    it('creates the membership with the invitation role and marks the invitation accepted', async () => {
      prisma.invite.findMany.mockResolvedValue([invite()] as any);
      prisma.membership.findUnique.mockResolvedValue(null);

      await expect(service.claimPendingInvites('user-1', 'new@example.com')).resolves.toBe(1);

      expect(prisma.invite.updateMany).toHaveBeenCalledWith({
        where: { id: 'invite-1', status: 'pending' },
        data: { status: 'accepted', acceptedById: 'user-1', acceptedAt: expect.any(Date) },
      });
      expect(prisma.membership.create).toHaveBeenCalledWith({
        data: { orgId: 'org-b', userId: 'user-1', roleId: 'role-org_admin', lastActiveAt: expect.any(Date) },
      });
      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'org:invite_accepted', targetId: 'invite-1' }),
      });
      expect(principalCache.invalidateUser).toHaveBeenCalledWith('user-1');
    });

    it('upgrades an existing lower membership role', async () => {
      prisma.invite.findMany.mockResolvedValue([invite()] as any);
      prisma.membership.findUnique.mockResolvedValue({ id: 'm-1', role: { name: 'viewer' } } as any);

      await service.claimPendingInvites('user-1', 'new@example.com');

      expect(prisma.membership.update).toHaveBeenCalledWith({ where: { id: 'm-1' }, data: { roleId: 'role-org_admin' } });
      expect(prisma.membership.create).not.toHaveBeenCalled();
    });

    it('never downgrades an existing higher membership role', async () => {
      prisma.invite.findMany.mockResolvedValue([
        invite({ roleId: 'role-viewer', role: { id: 'role-viewer', name: 'viewer' } }),
      ] as any);
      prisma.membership.findUnique.mockResolvedValue({ id: 'm-1', role: { name: 'contributor' } } as any);

      await expect(service.claimPendingInvites('user-1', 'new@example.com')).resolves.toBe(1);

      expect(prisma.membership.update).not.toHaveBeenCalled();
      expect(prisma.membership.create).not.toHaveBeenCalled();
    });

    it('grants the default org role for an invitation without a role', async () => {
      prisma.invite.findMany.mockResolvedValue([invite({ roleId: null, role: null })] as any);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-viewer', name: 'viewer' } as any);
      prisma.membership.findUnique.mockResolvedValue(null);

      await service.claimPendingInvites('user-1', 'new@example.com');

      expect(prisma.role.findUnique).toHaveBeenCalledWith({ where: { name: 'viewer' }, select: { id: true, name: true } });
      expect(prisma.membership.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ roleId: 'role-viewer' }),
      });
    });

    it('marks a lapsed invitation expired, lazily, and grants nothing', async () => {
      prisma.invite.findMany.mockResolvedValue([invite({ expiresAt: past })] as any);

      await expect(service.claimPendingInvites('user-1', 'new@example.com')).resolves.toBe(0);

      expect(prisma.invite.updateMany).toHaveBeenCalledWith({
        where: { id: 'invite-1', status: 'pending' },
        data: { status: 'expired' },
      });
      expect(prisma.membership.create).not.toHaveBeenCalled();
      expect(principalCache.invalidateUser).not.toHaveBeenCalled();
    });

    it('grants nothing when a concurrent sign-in already claimed the invitation', async () => {
      prisma.invite.findMany.mockResolvedValue([invite()] as any);
      prisma.invite.updateMany.mockResolvedValue({ count: 0 } as any);

      await expect(service.claimPendingInvites('user-1', 'new@example.com')).resolves.toBe(0);
      expect(prisma.membership.create).not.toHaveBeenCalled();
    });

    it('claims each organization in its own transaction', async () => {
      prisma.invite.findMany.mockResolvedValue([invite(), invite({ id: 'invite-2', orgId: 'org-c' })] as any);
      prisma.membership.findUnique.mockResolvedValue(null);

      await expect(service.claimPendingInvites('user-1', 'new@example.com')).resolves.toBe(2);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(principalCache.invalidateUser).toHaveBeenCalledTimes(1);
    });
  });
});

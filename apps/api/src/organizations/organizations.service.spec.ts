import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseSeedException } from '@marinoscar/platform-api/core';
import { PrismaService } from '../prisma/prisma.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../test/mocks/prisma.mock';
import { OrganizationsService } from './organizations.service';
import { DefaultOrganizationMissingException } from './organizations.errors';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prisma: MockPrismaService;

  const defaultOrg = {
    id: 'org-default',
    name: 'Default organization',
    slug: 'default',
    isDefault: true,
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: prisma },
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
});

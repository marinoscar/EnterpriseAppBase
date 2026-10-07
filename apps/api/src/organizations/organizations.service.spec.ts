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

      const result = await service.ensureMembership(tx as any, 'org-default', 'u1');

      expect(result).toBe(membership);
      expect(tx.membership.upsert).toHaveBeenCalledWith({
        where: { orgId_userId: { orgId: 'org-default', userId: 'u1' } },
        update: {},
        create: {
          orgId: 'org-default',
          userId: 'u1',
          lastActiveAt: expect.any(Date),
        },
      });
      expect(prisma.membership.upsert).not.toHaveBeenCalled();
    });

    it('leaves an existing membership untouched (empty update)', async () => {
      const tx = createMockPrismaService();
      tx.membership.upsert.mockResolvedValue({ id: 'm1', status: 'suspended' } as any);

      await service.ensureMembership(tx as any, 'org-default', 'u1');

      expect(tx.membership.upsert.mock.calls[0]![0]).toMatchObject({ update: {} });
    });
  });
});

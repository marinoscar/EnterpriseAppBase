import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenancyService } from './tenancy.service';
import type { OrgInvitesService } from './org-invites.service';
import { OrganizationsAdminService, ORGANIZATION_AUDIT } from './organizations-admin.service';
import { TENANCY_SINGLE_ORG_REASON } from './org-admin.common';

const ACTOR = 'user-admin';

function orgRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'org-b',
    name: 'Beta',
    slug: 'beta',
    isDefault: false,
    createdById: ACTOR,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    _count: { memberships: 0 },
    ...overrides,
  };
}

describe('OrganizationsAdminService (#726)', () => {
  let prisma: MockPrismaService;
  let tenancy: { isSingle: jest.Mock };
  let invites: { writeInvite: jest.Mock; dispatchInvitation: jest.Mock };
  let service: OrganizationsAdminService;
  let events: string[];

  beforeEach(() => {
    prisma = createMockPrismaService();
    events = [];
    prisma.$transaction.mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => {
      events.push('tx:begin');
      const result = await fn(prisma);
      events.push('tx:commit');
      return result;
    }) as never);
    tenancy = { isSingle: jest.fn(() => false) };
    invites = {
      writeInvite: jest.fn(async () => {
        events.push('writeInvite');
        return { invite: { id: 'invite-1', orgId: 'org-b' }, payload: { recipientEmail: 'first@example.com' } };
      }),
      dispatchInvitation: jest.fn(async () => events.push('dispatchInvitation')),
    };
    service = new OrganizationsAdminService(
      prisma as unknown as PrismaService,
      tenancy as unknown as TenancyService,
      invites as unknown as OrgInvitesService,
    );
  });

  describe('create', () => {
    const dto = { name: 'Beta', slug: 'beta', firstAdminEmail: 'first@example.com' };

    it('is refused in single mode with 409 TENANCY_SINGLE_ORG, writing nothing', async () => {
      tenancy.isSingle.mockReturnValue(true);

      const error = await service.create(ACTOR, dto).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        details: { reason: TENANCY_SINGLE_ORG_REASON },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates the org and an org_admin invitation in one transaction, then emails after the commit', async () => {
      prisma.organization.create.mockResolvedValue(orgRow() as never);
      prisma.organization.findUnique.mockResolvedValue(orgRow() as never);

      const view = await service.create(ACTOR, dto);

      expect(view).toMatchObject({ id: 'org-b', name: 'Beta', slug: 'beta', isDefault: false, memberCount: 0 });
      expect(prisma.organization.create).toHaveBeenCalledWith({
        data: { name: 'Beta', slug: 'beta', createdById: ACTOR },
      });
      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: ORGANIZATION_AUDIT.CREATED, targetId: 'org-b' }),
      });
      expect(invites.writeInvite).toHaveBeenCalledWith(prisma, {
        orgId: 'org-b',
        email: 'first@example.com',
        roleName: 'org_admin',
        invitedById: ACTOR,
      });
      expect(events).toEqual(['tx:begin', 'writeInvite', 'tx:commit', 'dispatchInvitation']);
    });

    it('maps a taken slug to 409 SLUG_TAKEN and sends nothing', async () => {
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' }) as never,
      );

      const error = await service.create(ACTOR, dto).catch((e: unknown) => e);

      expect((error as ConflictException).getResponse()).toMatchObject({ details: { reason: 'SLUG_TAKEN' } });
      expect(invites.dispatchInvitation).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('changes the name only and audits it', async () => {
      prisma.organization.findUnique
        .mockResolvedValueOnce({ id: 'org-b', name: 'Beta' } as never)
        .mockResolvedValueOnce(orgRow({ name: 'Beta Inc' }) as never);

      const view = await service.rename(ACTOR, 'org-b', { name: 'Beta Inc' });

      expect(view.name).toBe('Beta Inc');
      expect(prisma.organization.update).toHaveBeenCalledWith({ where: { id: 'org-b' }, data: { name: 'Beta Inc' } });
      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: ORGANIZATION_AUDIT.RENAMED,
          meta: { previousName: 'Beta', name: 'Beta Inc' },
        }),
      });
    });

    it('404s for an unknown organization', async () => {
      prisma.organization.findUnique.mockResolvedValue(null as never);

      await expect(service.rename(ACTOR, 'nope', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list', () => {
    it('lists default first, then by name, with active member counts', async () => {
      prisma.organization.findMany.mockResolvedValue([
        orgRow({ id: 'org-default', name: 'Default', slug: 'default', isDefault: true, _count: { memberships: 3 } }),
      ] as never);
      prisma.organization.count.mockResolvedValue(1 as never);

      const result = await service.list({ page: 1, pageSize: 20, search: 'def' });

      const args = prisma.organization.findMany.mock.calls[0][0] as any;
      expect(args.orderBy).toEqual([{ isDefault: 'desc' }, { name: 'asc' }]);
      expect(args.include).toEqual({ _count: { select: { memberships: { where: { status: 'active' } } } } });
      expect(args.where.OR).toHaveLength(2);
      expect(result.items[0]).toMatchObject({ isDefault: true, memberCount: 3 });
      expect(result.total).toBe(1);
    });
  });
});

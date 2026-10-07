import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import type { PrismaService } from '../prisma/prisma.service';
import type { PrincipalCache } from '../auth/principal-cache/principal-cache.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { AppMetricsService } from '../common/otel/app-metrics.service';
import { OrgMembersService, ORG_MEMBER_AUDIT } from './org-members.service';
import { LAST_ORG_ADMIN_REASON } from './org-admin.common';

const ORG = 'org-a';
const ACTOR = 'user-actor';
const TARGET = 'user-target';

function memberRow(overrides: Partial<{ userId: string; role: string; status: 'active' | 'suspended' }> = {}) {
  const userId = overrides.userId ?? TARGET;
  const role = overrides.role ?? 'contributor';
  return {
    id: `m-${userId}`,
    orgId: ORG,
    userId,
    status: overrides.status ?? 'active',
    roleId: `role-${role}`,
    lastActiveAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    user: { id: userId, email: `${userId}@example.com`, displayName: null, providerDisplayName: 'Target' },
    role: { id: `role-${role}`, name: role },
  };
}

describe('OrgMembersService (#726)', () => {
  let prisma: MockPrismaService;
  let principalCache: { invalidateUser: jest.Mock };
  let notifications: { notify: jest.Mock };
  let metrics: { add: jest.Mock };
  let service: OrgMembersService;
  /** The order in which the transaction committed and side effects ran. */
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
    prisma.$queryRaw.mockResolvedValue([] as never);
    prisma.auditEvent.create.mockImplementation((async () => {
      events.push('audit');
      return {};
    }) as never);
    principalCache = { invalidateUser: jest.fn(() => events.push('cache:invalidate')) };
    notifications = { notify: jest.fn(async () => events.push('notify')) };
    metrics = { add: jest.fn() };
    const config = { get: jest.fn((key: string) => (key === 'appUrl' ? 'https://app.example.com/' : undefined)) };
    service = new OrgMembersService(
      prisma as unknown as PrismaService,
      principalCache as unknown as PrincipalCache,
      notifications as unknown as NotificationsService,
      config as unknown as ConfigService,
      metrics as unknown as AppMetricsService,
    );
  });

  describe('list', () => {
    it('reads the given org only and maps rows to the API view', async () => {
      prisma.membership.findMany.mockResolvedValue([memberRow()] as never);
      prisma.membership.count.mockResolvedValue(1 as never);

      const result = await service.list(ORG, { page: 1, pageSize: 20, status: 'all' });

      expect(prisma.membership.findMany.mock.calls[0][0]).toMatchObject({ where: { orgId: ORG } });
      expect(result).toEqual({
        items: [
          {
            userId: TARGET,
            email: `${TARGET}@example.com`,
            displayName: 'Target',
            role: 'contributor',
            status: 'active',
            lastActiveAt: null,
            joinedAt: new Date('2026-01-01T00:00:00Z'),
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
    });

    it('filters by status and searches email and names case-insensitively', async () => {
      prisma.membership.findMany.mockResolvedValue([] as never);
      prisma.membership.count.mockResolvedValue(0 as never);

      await service.list(ORG, { page: 2, pageSize: 10, status: 'suspended', search: 'ann' });

      const args = prisma.membership.findMany.mock.calls[0][0] as any;
      expect(args.where.status).toBe('suspended');
      expect(args.where.user.OR[0]).toEqual({ email: { contains: 'ann', mode: 'insensitive' } });
      expect(args.skip).toBe(10);
    });
  });

  describe('update', () => {
    it('changes the role, audits it, invalidates the cache and notifies AFTER the commit', async () => {
      prisma.membership.findUnique.mockResolvedValue(memberRow({ role: 'viewer' }) as never);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-contributor', name: 'contributor', scope: 'org' } as never);
      prisma.membership.update.mockResolvedValue(memberRow({ role: 'contributor' }) as never);

      const view = await service.update(ACTOR, ORG, TARGET, { roleName: 'contributor' });

      expect(view.role).toBe('contributor');
      expect(prisma.$queryRaw).toHaveBeenCalled(); // the org row lock
      expect(prisma.membership.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId_userId: { orgId: ORG, userId: TARGET } } }),
      );
      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: ACTOR,
          action: ORG_MEMBER_AUDIT.UPDATED,
          meta: expect.objectContaining({ orgId: ORG, previousRole: 'viewer', role: 'contributor' }),
        }),
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        'security.role_changed',
        TARGET,
        expect.objectContaining({ previousRoles: ['viewer'], currentRoles: ['contributor'], appUrl: 'https://app.example.com' }),
      );
      expect(events).toEqual(['tx:begin', 'audit', 'tx:commit', 'cache:invalidate', 'notify']);
    });

    it('suspends a member without a role notification', async () => {
      prisma.membership.findUnique.mockResolvedValue(memberRow() as never);
      prisma.membership.update.mockResolvedValue(memberRow({ status: 'suspended' }) as never);

      const view = await service.update(ACTOR, ORG, TARGET, { status: 'suspended' });

      expect(view.status).toBe('suspended');
      expect(prisma.membership.update.mock.calls[0][0]).toMatchObject({ data: { status: 'suspended' } });
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(principalCache.invalidateUser).toHaveBeenCalledWith(TARGET);
    });

    it('404s for a user who is not a member of the active org', async () => {
      prisma.membership.findUnique.mockResolvedValue(null as never);

      await expect(service.update(ACTOR, ORG, 'someone-else', { roleName: 'viewer' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.membership.update).not.toHaveBeenCalled();
    });

    it('refuses to let an administrator demote or suspend themselves (403)', async () => {
      prisma.membership.findUnique.mockResolvedValue(memberRow({ userId: ACTOR, role: 'org_admin' }) as never);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-viewer', name: 'viewer', scope: 'org' } as never);

      await expect(service.update(ACTOR, ORG, ACTOR, { roleName: 'viewer' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.update(ACTOR, ORG, ACTOR, { status: 'suspended' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.membership.update).not.toHaveBeenCalled();
    });

    it.each([
      ['demoting', { roleName: 'contributor' as const }],
      ['suspending', { status: 'suspended' as const }],
    ])('refuses %s the last active org_admin (409 LAST_ORG_ADMIN)', async (_label, dto) => {
      prisma.membership.findUnique.mockResolvedValue(memberRow({ role: 'org_admin' }) as never);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-contributor', name: 'contributor', scope: 'org' } as never);
      prisma.membership.count.mockResolvedValue(0 as never);

      const error = await service.update(ACTOR, ORG, TARGET, dto).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ details: { reason: LAST_ORG_ADMIN_REASON } });
      expect(prisma.membership.count).toHaveBeenCalledWith({
        where: { orgId: ORG, userId: { not: TARGET }, status: 'active', role: { name: 'org_admin' } },
      });
      expect(prisma.membership.update).not.toHaveBeenCalled();
      expect(principalCache.invalidateUser).not.toHaveBeenCalled();
    });

    it('demotes an org_admin while another active org_admin remains', async () => {
      prisma.membership.findUnique.mockResolvedValue(memberRow({ role: 'org_admin' }) as never);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-viewer', name: 'viewer', scope: 'org' } as never);
      prisma.membership.count.mockResolvedValue(1 as never);
      prisma.membership.update.mockResolvedValue(memberRow({ role: 'viewer' }) as never);

      await expect(service.update(ACTOR, ORG, TARGET, { roleName: 'viewer' })).resolves.toMatchObject({ role: 'viewer' });
    });

    it('refuses a role that is not an org role', async () => {
      prisma.membership.findUnique.mockResolvedValue(memberRow() as never);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-admin', name: 'admin', scope: 'system' } as never);

      await expect(service.update(ACTOR, ORG, TARGET, { roleName: 'org_admin' })).rejects.toThrow(
        'Unknown organization role',
      );
    });

    it('writes nothing when nothing changes', async () => {
      prisma.membership.findUnique.mockResolvedValue(memberRow() as never);

      await service.update(ACTOR, ORG, TARGET, { status: 'active' });

      expect(prisma.membership.update).not.toHaveBeenCalled();
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 } as never);
      prisma.personalAccessToken.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.deviceCode.updateMany.mockResolvedValue({ count: 1 } as never);
    });

    it('deletes the membership and revokes only the credentials bound to this org', async () => {
      prisma.membership.findUnique.mockResolvedValue(memberRow() as never);

      const revoked = await service.remove(ACTOR, ORG, TARGET);

      expect(revoked).toEqual({ refreshTokens: 2, personalAccessTokens: 1, deviceSessions: 1 });
      expect(prisma.membership.delete).toHaveBeenCalledWith({ where: { id: `m-${TARGET}` } });
      for (const delegate of [prisma.refreshToken, prisma.personalAccessToken, prisma.deviceCode]) {
        expect(delegate.updateMany).toHaveBeenCalledWith({
          where: { userId: TARGET, orgId: ORG, revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        });
      }
      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: ORG_MEMBER_AUDIT.REMOVED, meta: expect.objectContaining({ orgId: ORG }) }),
      });
      expect(events).toEqual(['tx:begin', 'audit', 'tx:commit', 'cache:invalidate']);
      expect(metrics.add).toHaveBeenCalledWith('orgMembersRemoved');
    });

    it('refuses to remove yourself (403) before touching the database', async () => {
      await expect(service.remove(ACTOR, ORG, ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses to remove the last active org_admin (409)', async () => {
      prisma.membership.findUnique.mockResolvedValue(memberRow({ role: 'org_admin' }) as never);
      prisma.membership.count.mockResolvedValue(0 as never);

      await expect(service.remove(ACTOR, ORG, TARGET)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.membership.delete).not.toHaveBeenCalled();
      expect(metrics.add).not.toHaveBeenCalled();
    });

    it('removes a suspended org_admin without the last-admin check', async () => {
      prisma.membership.findUnique.mockResolvedValue(memberRow({ role: 'org_admin', status: 'suspended' }) as never);

      await service.remove(ACTOR, ORG, TARGET);

      expect(prisma.membership.count).not.toHaveBeenCalled();
      expect(prisma.membership.delete).toHaveBeenCalled();
    });

    it('404s for a user who is not a member of the active org', async () => {
      prisma.membership.findUnique.mockResolvedValue(null as never);

      await expect(service.remove(ACTOR, ORG, TARGET)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

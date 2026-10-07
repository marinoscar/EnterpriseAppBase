import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { AppMetricsService } from '../common/otel/app-metrics.service';
import { OrgInvitesService, ORG_INVITE_AUDIT, ORG_INVITE_TTL_DAYS } from './org-invites.service';

const ORG = 'org-a';
const ACTOR = 'user-actor';
const EMAIL = 'new.person@example.com';

function inviteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invite-1',
    orgId: ORG,
    email: EMAIL,
    status: 'pending',
    tokenHash: null,
    expiresAt: new Date('2099-01-01T00:00:00Z'),
    invitedById: ACTOR,
    acceptedById: null,
    acceptedAt: null,
    notes: 'private note',
    roleId: 'role-contributor',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    role: { name: 'contributor' },
    invitedBy: { id: ACTOR, email: 'actor@example.com' },
    acceptedBy: null,
    ...overrides,
  };
}

describe('OrgInvitesService (#726)', () => {
  let prisma: MockPrismaService;
  let notifications: { notifyAddress: jest.Mock };
  let metrics: { add: jest.Mock };
  let service: OrgInvitesService;
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
    prisma.auditEvent.create.mockImplementation((async (args: any) => {
      events.push(`audit:${args.data.action}`);
      return {};
    }) as never);
    notifications = { notifyAddress: jest.fn(async () => events.push('notifyAddress')) };
    metrics = { add: jest.fn() };
    const config = { get: jest.fn((key: string) => (key === 'appUrl' ? 'https://app.example.com' : undefined)) };
    service = new OrgInvitesService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      config as unknown as ConfigService,
      metrics as unknown as AppMetricsService,
    );

    prisma.organization.findUnique.mockResolvedValue({ id: ORG, name: 'Acme' } as never);
    prisma.role.findUnique.mockImplementation((async ({ where }: any) => ({
      id: `role-${where.name}`,
      name: where.name,
      scope: where.name === 'admin' ? 'system' : 'org',
    })) as never);
    prisma.user.findUnique.mockResolvedValue({
      email: 'actor@example.com',
      displayName: 'Ana Admin',
      providerDisplayName: null,
    } as never);
    prisma.membership.findFirst.mockResolvedValue(null as never);
    prisma.invite.findUnique.mockResolvedValue(null as never);
    prisma.invite.upsert.mockResolvedValue(inviteRow() as never);
    prisma.invite.findUniqueOrThrow.mockResolvedValue(inviteRow() as never);
    prisma.allowedEmail.findUnique.mockResolvedValue(null as never);
    prisma.allowedEmail.create.mockResolvedValue({ id: 'allowed-1' } as never);
  });

  describe('create', () => {
    it('writes the invite and an allowlist entry, audits both, and emails AFTER the commit', async () => {
      const view = await service.create(ACTOR, ORG, { email: EMAIL, roleName: 'contributor', notes: 'private note' });

      expect(view).toMatchObject({ id: 'invite-1', email: EMAIL, role: 'contributor', status: 'pending' });
      const upsert = prisma.invite.upsert.mock.calls[0][0] as any;
      expect(upsert.where).toEqual({ orgId_email: { orgId: ORG, email: EMAIL } });
      expect(upsert.create).toMatchObject({ orgId: ORG, email: EMAIL, status: 'pending', roleId: 'role-contributor' });
      const ttlMs = upsert.create.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan((ORG_INVITE_TTL_DAYS - 1) * 86_400_000);
      expect(ttlMs).toBeLessThanOrEqual(ORG_INVITE_TTL_DAYS * 86_400_000);
      expect(prisma.allowedEmail.create).toHaveBeenCalledWith({
        data: { email: EMAIL, addedById: ACTOR, notes: 'Invited to organization Acme' },
      });

      expect(events).toEqual([
        'tx:begin',
        'audit:allowlist:add',
        `audit:${ORG_INVITE_AUDIT.CREATED}`,
        'tx:commit',
        'notifyAddress',
      ]);
      expect(notifications.notifyAddress).toHaveBeenCalledWith('org.invitation', EMAIL, {
        recipientEmail: EMAIL,
        orgName: 'Acme',
        roleName: 'contributor',
        invitedBy: 'Ana Admin',
        signInUrl: 'https://app.example.com/login',
      });
      expect(metrics.add).toHaveBeenCalledWith('orgInvitesCreated');
    });

    it('never puts the notes (or anything token-like) in the email payload', async () => {
      await service.create(ACTOR, ORG, { email: EMAIL, roleName: 'viewer', notes: 'contractor, ends in March' });

      const payload = notifications.notifyAddress.mock.calls[0][2];
      expect(JSON.stringify(payload)).not.toContain('contractor');
      expect(Object.keys(payload)).not.toContain('token');
    });

    it('leaves an existing allowlist entry alone', async () => {
      prisma.allowedEmail.findUnique.mockResolvedValue({ id: 'allowed-old' } as never);

      await service.create(ACTOR, ORG, { email: EMAIL, roleName: 'viewer' });

      expect(prisma.allowedEmail.create).not.toHaveBeenCalled();
      expect(events).not.toContain('audit:allowlist:add');
    });

    it('renews a pending invitation (re-invite updates its role)', async () => {
      prisma.invite.findUnique.mockResolvedValue({ id: 'invite-1', status: 'pending' } as never);

      await service.create(ACTOR, ORG, { email: EMAIL, roleName: 'org_admin' });

      const upsert = prisma.invite.upsert.mock.calls[0][0] as any;
      expect(upsert.update).toMatchObject({ status: 'pending', roleId: 'role-org_admin' });
      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ meta: expect.objectContaining({ renewed: true }) }),
      });
    });

    it('refuses (409) to re-invite an accepted invitation whose invitee is a member, and sends nothing', async () => {
      prisma.invite.findUnique.mockResolvedValue({ id: 'invite-1', status: 'accepted' } as never);
      prisma.membership.findFirst.mockResolvedValue({ id: 'm-1' } as never);

      const error = await service.create(ACTOR, ORG, { email: EMAIL, roleName: 'viewer' }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ details: { reason: 'INVITE_ACCEPTED' } });
      expect(prisma.invite.upsert).not.toHaveBeenCalled();
      expect(notifications.notifyAddress).not.toHaveBeenCalled();
    });

    it('refuses (409) to invite an address that is already a member', async () => {
      prisma.membership.findFirst.mockResolvedValue({ id: 'm-1' } as never);

      const error = await service.create(ACTOR, ORG, { email: EMAIL, roleName: 'viewer' }).catch((e: unknown) => e);

      expect((error as ConflictException).getResponse()).toMatchObject({ details: { reason: 'ALREADY_MEMBER' } });
    });

    it('renews an accepted invitation whose member has since been removed', async () => {
      prisma.invite.findUnique.mockResolvedValue({ id: 'invite-1', status: 'accepted' } as never);

      await service.create(ACTOR, ORG, { email: EMAIL, roleName: 'viewer' });

      expect((prisma.invite.upsert.mock.calls[0][0] as any).update).toMatchObject({
        status: 'pending',
        acceptedById: null,
        acceptedAt: null,
      });
    });
  });

  describe('revoke', () => {
    it('marks a pending invitation of the org revoked and audits it', async () => {
      prisma.invite.findFirst.mockResolvedValue({ id: 'invite-1', status: 'pending', email: EMAIL } as never);

      await service.revoke(ACTOR, ORG, 'invite-1');

      expect(prisma.invite.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'invite-1', orgId: ORG } }),
      );
      expect(prisma.invite.updateMany).toHaveBeenCalledWith({
        where: { id: 'invite-1', status: 'pending' },
        data: { status: 'revoked' },
      });
      expect(events).toContain(`audit:${ORG_INVITE_AUDIT.REVOKED}`);
    });

    it('404s for an invitation of another organization', async () => {
      prisma.invite.findFirst.mockResolvedValue(null as never);

      await expect(service.revoke(ACTOR, ORG, 'invite-of-org-b')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses an accepted invitation (409) and ignores a revoked one', async () => {
      prisma.invite.findFirst.mockResolvedValueOnce({ id: 'i', status: 'accepted', email: EMAIL } as never);
      await expect(service.revoke(ACTOR, ORG, 'i')).rejects.toBeInstanceOf(ConflictException);

      prisma.invite.findFirst.mockResolvedValueOnce({ id: 'i', status: 'revoked', email: EMAIL } as never);
      await service.revoke(ACTOR, ORG, 'i');
      expect(prisma.invite.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('marks lapsed pending invitations expired first, then lists the org only', async () => {
      prisma.invite.findMany.mockResolvedValue([inviteRow({ role: null })] as never);
      prisma.invite.count.mockResolvedValue(1 as never);

      const result = await service.list(ORG, { page: 1, pageSize: 20, status: 'all' });

      expect(prisma.invite.updateMany).toHaveBeenCalledWith({
        where: { orgId: ORG, status: 'pending', expiresAt: { lt: expect.any(Date) } },
        data: { status: 'expired' },
      });
      expect((prisma.invite.findMany.mock.calls[0][0] as any).where).toEqual({ orgId: ORG });
      // A NULL role means the default org role.
      expect(result.items[0].role).toBe('viewer');
    });

    it('filters by status', async () => {
      prisma.invite.findMany.mockResolvedValue([] as never);
      prisma.invite.count.mockResolvedValue(0 as never);

      await service.list(ORG, { page: 1, pageSize: 20, status: 'pending' });

      expect((prisma.invite.findMany.mock.calls[0][0] as any).where).toEqual({ orgId: ORG, status: 'pending' });
    });
  });
});

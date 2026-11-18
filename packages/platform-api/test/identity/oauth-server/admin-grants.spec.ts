// The admin side of grants (#1195): OAuthGrantService.listForAdmin / revokeGrantAsAdmin and the controller's permissions.
import { NotFoundException } from '@nestjs/common';

import { PERMISSIONS_KEY } from '../../../src/identity/auth/decorators/permissions.decorator';
import { OAuthGrantsAdminController } from '../../../src/identity/oauth-server/clients/oauth-clients-admin.controller';
import { OAuthGrantService } from '../../../src/identity/oauth-server/oauth-grant.service';
import { oauthAdminGrantsQuerySchema } from '@marinoscar/platform-contract/identity';

const ADMIN = '00000000-0000-4000-8000-0000000000ad';
const GRANT = '00000000-0000-4000-8000-0000000000a1';

function grantRow(over: Record<string, unknown> = {}) {
  return {
    id: GRANT,
    userId: 'user-1',
    orgId: null,
    clientId: 'client-row-1',
    resource: 'https://app.example.test/api/notes-agent',
    scopes: ['notes:read'],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    lastUsedAt: null,
    revokedAt: null,
    revokedReason: null,
    client: { id: 'client-row-1', name: 'Client A', host: 'a.example.test', logoUri: null },
    user: { id: 'user-1', email: 'user-1@example.test' },
    org: null,
    ...over,
  };
}

function build(rows: unknown[] = [], existing: unknown = grantRow()) {
  const tx = { oAuthGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, oAuthToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) } };
  const prisma = {
    oAuthGrant: { findMany: jest.fn().mockResolvedValue(rows), count: jest.fn().mockResolvedValue(rows.length), findUnique: jest.fn().mockResolvedValue(existing) },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const context = { resourceForIdentifier: jest.fn(() => ({ id: 'notes', name: 'Notes agent' })) };
  const events = { emit: jest.fn() };
  const service = new OAuthGrantService(prisma as never, context as never, events as never);
  return { service, prisma, tx, events };
}

const query = (raw: Record<string, string> = {}) => oauthAdminGrantsQuerySchema.parse(raw);

describe('OAuthGrantService.listForAdmin', () => {
  it('lists active grants only by default, presentation-safe', async () => {
    const { service, prisma } = build([grantRow()]);
    const page = await service.listForAdmin(query());
    expect(prisma.oAuthGrant.findMany.mock.calls[0]![0].where).toEqual({ revokedAt: null });
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
    expect(page.items[0]).toEqual({
      id: GRANT,
      user: { id: 'user-1', email: 'user-1@example.test' },
      client: { id: 'client-row-1', name: 'Client A', host: 'a.example.test' },
      resource: { id: 'notes', name: 'Notes agent' },
      scopes: ['notes:read'],
      organization: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
      revokedReason: null,
    });
    expect(JSON.stringify(page)).not.toMatch(/token|secret/i);
  });

  it('filters by client and user and can include revoked grants', async () => {
    const { service, prisma } = build([]);
    const clientId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';
    await service.listForAdmin(query({ clientId, userId, includeRevoked: 'true', page: '2', pageSize: '5' }));
    const args = prisma.oAuthGrant.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ clientId, userId });
    expect(args).toMatchObject({ skip: 5, take: 5 });
  });

  it('parses includeRevoked=false as false', () => {
    expect(query({ includeRevoked: 'false' }).includeRevoked).toBe(false);
    expect(() => query({ includeRevoked: 'maybe' })).toThrow();
  });
});

describe('OAuthGrantService.revokeGrantAsAdmin', () => {
  it('revokes with reason admin, audits with the administrator as actor and emits the event', async () => {
    const { service, tx, prisma, events } = build();
    await expect(service.revokeGrantAsAdmin(GRANT, ADMIN)).resolves.toBe(true);
    expect(tx.oAuthGrant.updateMany.mock.calls[0]![0]).toMatchObject({ where: { id: GRANT, revokedAt: null }, data: { revokedReason: 'admin' } });
    expect(tx.oAuthToken.updateMany).toHaveBeenCalled();
    expect(prisma.auditEvent.create.mock.calls[0]![0].data).toMatchObject({
      actorUserId: ADMIN,
      action: 'oauth:grant.revoke',
      targetType: 'oauth_grant',
      targetId: GRANT,
      meta: { clientId: 'client-row-1', userId: 'user-1', by: 'admin' },
    });
    expect(events.emit).toHaveBeenCalledWith('identity.oauth.grant.revoked', expect.objectContaining({ grantId: GRANT, userId: 'user-1', reason: 'admin' }));
  });

  it('is a no-op for an already revoked grant: no audit row, no event', async () => {
    const { service, tx, prisma, events } = build();
    tx.oAuthGrant.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.revokeGrantAsAdmin(GRANT, ADMIN)).resolves.toBe(false);
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('throws NotFound for an unknown id', async () => {
    const { service } = build([], null);
    await expect(service.revokeGrantAsAdmin(GRANT, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OAuthGrantsAdminController access', () => {
  it('reads need oauth_clients:read, the revoke needs oauth_clients:write', () => {
    const proto = OAuthGrantsAdminController.prototype;
    const perms = (fn: unknown) => Reflect.getMetadata(PERMISSIONS_KEY, fn as object);
    expect(perms(proto.list)).toEqual(['oauth_clients:read']);
    expect(perms(proto.revoke)).toEqual(['oauth_clients:write']);
  });
});

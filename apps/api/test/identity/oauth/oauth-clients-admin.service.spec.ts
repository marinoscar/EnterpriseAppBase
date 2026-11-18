// =============================================================================
// OAuthClientsAdminService: the refused-hosts aggregation and the policy hints,
// against a scripted audit delegate (the real-Postgres proof is in
// oauth-clients.db.spec.ts)
// =============================================================================

import { OAuthClientsAdminService } from '@marinoscar/platform-api/identity';

const NOW = Date.parse('2026-06-30T12:00:00.000Z');

function serviceWith(rows: Array<{ targetId: string; createdAt: Date }>, hosts?: string[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma = { auditEvent: { findMany } } as never;
  const options = hosts === undefined ? undefined : ({ oauthServer: { defaultAllowedClientHosts: hosts } } as never);
  return { service: new OAuthClientsAdminService(prisma, {} as never, undefined, options), findMany };
}

describe('OAuthClientsAdminService.listRefusedHosts', () => {
  it('asks for the refusal rows of the last 30 days, newest first', async () => {
    const { service, findMany } = serviceWith([]);
    await service.listRefusedHosts(NOW);
    const args = findMany.mock.calls[0]![0];
    expect(args.where).toMatchObject({ action: 'oauth:client.refused', targetType: 'oauth_client' });
    expect(args.where.createdAt.gte).toEqual(new Date(NOW - 30 * 86_400_000));
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('groups by host with the count and the latest time, keeping the newest-first order', async () => {
    const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000);
    const { service } = serviceWith([
      { targetId: 'b.example.test', createdAt: at(1) },
      { targetId: 'a.example.test', createdAt: at(2) },
      { targetId: 'b.example.test', createdAt: at(30) },
      { targetId: 'b.example.test', createdAt: at(60) },
    ]);
    expect(await service.listRefusedHosts(NOW)).toEqual([
      { host: 'b.example.test', count: 3, lastSeenAt: at(1).toISOString() },
      { host: 'a.example.test', count: 1, lastSeenAt: at(2).toISOString() },
    ]);
  });

  it('returns at most 100 hosts', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ targetId: `h${i}.example.test`, createdAt: new Date(NOW - i * 1000) }));
    const { service } = serviceWith(rows);
    const result = await service.listRefusedHosts(NOW);
    expect(result).toHaveLength(100);
    expect(result[0]!.host).toBe('h0.example.test');
  });
});

describe('OAuthClientsAdminService.getPolicy', () => {
  it('returns the configured default allowed client hosts as a copy', () => {
    const hosts = ['tools.example.test', 'chat.example.test'];
    const { service } = serviceWith([], hosts);
    const policy = service.getPolicy();
    expect(policy).toEqual({ suggestedHosts: hosts });
    expect(policy.suggestedHosts).not.toBe(hosts);
  });

  it('returns none when the app configured none', () => {
    expect(serviceWith([]).service.getPolicy()).toEqual({ suggestedHosts: [] });
  });
});

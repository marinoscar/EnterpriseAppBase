// `oauth.token.cleanup` on real Postgres (PP-15.8, #1186): deletes exactly the rows
// the issue lists, with rows on BOTH sides of every threshold, and batches.
//
// THIS IS A `*.db.spec.ts`: skipped with a warning without Postgres.

delete process.env.DATABASE_URL; // the suite's own POSTGRES_* decide, as db-test-support does

import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { OAUTH_TOKEN_CLEANUP_TYPE, OAuthTokenCleanupHandler, OAuthTokenCleanupTask } from '@marinoscar/platform-api/identity';

import { createDbClient, resolveDbSuite } from '../../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('oauth-token-cleanup.db.spec');

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describeWithDb('oauth.token.cleanup (real Postgres, #1186)', () => {
  let client: PrismaClient;
  let handler: OAuthTokenCleanupHandler;
  let userId: string;
  let clientRowId: string;
  const run = randomUUID().slice(0, 8);
  const now = new Date();
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const ahead = (ms: number) => new Date(now.getTime() + ms);
  let seq = 0;

  const makeGrant = (over: Record<string, unknown> = {}) =>
    client.oAuthGrant.create({ data: { userId, clientId: clientRowId, resource: `https://app.example.test/api/cleanup-${run}-${seq++}`, scopes: ['x:read'], ...over } });
  const makeToken = (grantId: string, over: Record<string, unknown>) =>
    client.oAuthToken.create({ data: { kind: 'access', tokenHash: randomUUID(), tokenPrefix: 'abcd1234', grantId, scopes: ['x:read'], expiresAt: ahead(HOUR), ...over } });
  const exists = async (table: 'oAuthToken' | 'oAuthGrant' | 'oAuthAuthorizationCode' | 'oAuthAuthorizationRequest', id: string) =>
    (await (client[table] as unknown as { count(a: unknown): Promise<number> }).count({ where: { id } })) === 1;

  beforeAll(async () => {
    client = createDbClient();
    userId = (await client.user.create({ data: { email: `oclean-${run}@example.test`, isActive: true }, select: { id: true } })).id;
    clientRowId = (await client.oAuthClient.create({ data: { clientId: `oc_clean_${run}`, kind: 'registered', name: 'Cleanup client', redirectUris: ['https://client.example.test/cb'], tokenEndpointAuthMethod: 'none', host: 'client.example.test' } })).id;
    handler = new OAuthTokenCleanupHandler({ registerHandler: () => undefined } as never, client as never);
  });

  afterAll(async () => {
    await client.oAuthClient.deleteMany({ where: { id: clientRowId } }); // cascades requests and grants
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it('removes exactly the listed rows, and keeps the rest', async () => {
    const live = await makeGrant();
    const revoked40 = await makeGrant({ revokedAt: ago(40 * DAY), revokedReason: 'user' });
    const revoked10 = await makeGrant({ revokedAt: ago(10 * DAY), revokedReason: 'user' });
    const revoked100 = await makeGrant({ revokedAt: ago(100 * DAY), revokedReason: 'user' });
    const revoked80 = await makeGrant({ revokedAt: ago(80 * DAY), revokedReason: 'user' });

    // authorization requests
    const request = (status: string, expiresAt: Date) =>
      client.oAuthAuthorizationRequest.create({ data: { clientId: clientRowId, redirectUri: 'https://client.example.test/cb', scope: 'x:read', resource: 'r', codeChallenge: 'c', codeChallengeMethod: 'S256', status: status as never, expiresAt } });
    const reqExpired = await request('pending', ago(MIN));
    const reqLive = await request('pending', ahead(5 * MIN));
    const reqApproved = await request('approved', ahead(5 * MIN));
    const reqDenied = await request('denied', ahead(5 * MIN));

    // codes
    const code = (over: Record<string, unknown>) =>
      client.oAuthAuthorizationCode.create({ data: { codeHash: randomUUID(), grantId: live.id, redirectUri: 'r', codeChallenge: 'c', scope: 'x:read', resource: 'r', expiresAt: ahead(60_000), ...over } });
    const codeConsumedOld = await code({ createdAt: ago(2 * HOUR), consumedAt: ago(2 * HOUR) });
    const codeConsumedNew = await code({ createdAt: ago(10 * MIN), consumedAt: ago(9 * MIN) });
    const codeExpiredOld = await code({ createdAt: ago(2 * HOUR), expiresAt: ago(2 * HOUR - 60_000) });
    const codeExpiredNew = await code({ createdAt: ago(10 * MIN), expiresAt: ago(9 * MIN) });

    // access tokens
    const accessOld = await makeToken(live.id, { expiresAt: ago(25 * HOUR) });
    const accessRecent = await makeToken(live.id, { expiresAt: ago(23 * HOUR) });
    const accessLive = await makeToken(live.id, {});

    // refresh tokens
    const refreshExpiredOld = await makeToken(live.id, { kind: 'refresh', expiresAt: ago(8 * DAY) });
    const refreshExpiredRecent = await makeToken(live.id, { kind: 'refresh', expiresAt: ago(6 * DAY) });
    const refreshRotatedOld = await makeToken(live.id, { kind: 'refresh', rotatedAt: ago(8 * DAY) });
    const refreshRotatedRecent = await makeToken(live.id, { kind: 'refresh', rotatedAt: ago(6 * DAY) });
    const refreshLive = await makeToken(live.id, { kind: 'refresh' });

    // tokens of revoked grants
    const tokOfRevoked40 = await makeToken(revoked40.id, { kind: 'refresh' });
    const tokOfRevoked10 = await makeToken(revoked10.id, { kind: 'refresh' });

    const result = await handler.cleanup(now);
    expect(result).toMatchObject({ requests: expect.any(Number) });

    // requests
    expect(await exists('oAuthAuthorizationRequest', reqExpired.id)).toBe(false);
    expect(await exists('oAuthAuthorizationRequest', reqApproved.id)).toBe(false);
    expect(await exists('oAuthAuthorizationRequest', reqDenied.id)).toBe(false);
    expect(await exists('oAuthAuthorizationRequest', reqLive.id)).toBe(true);
    // codes
    expect(await exists('oAuthAuthorizationCode', codeConsumedOld.id)).toBe(false);
    expect(await exists('oAuthAuthorizationCode', codeExpiredOld.id)).toBe(false);
    expect(await exists('oAuthAuthorizationCode', codeConsumedNew.id)).toBe(true);
    expect(await exists('oAuthAuthorizationCode', codeExpiredNew.id)).toBe(true);
    // access tokens
    expect(await exists('oAuthToken', accessOld.id)).toBe(false);
    expect(await exists('oAuthToken', accessRecent.id)).toBe(true);
    expect(await exists('oAuthToken', accessLive.id)).toBe(true);
    // refresh tokens
    expect(await exists('oAuthToken', refreshExpiredOld.id)).toBe(false);
    expect(await exists('oAuthToken', refreshRotatedOld.id)).toBe(false);
    expect(await exists('oAuthToken', refreshExpiredRecent.id)).toBe(true);
    expect(await exists('oAuthToken', refreshRotatedRecent.id)).toBe(true);
    expect(await exists('oAuthToken', refreshLive.id)).toBe(true);
    // tokens of revoked grants: 30 days
    expect(await exists('oAuthToken', tokOfRevoked40.id)).toBe(false);
    expect(await exists('oAuthToken', tokOfRevoked10.id)).toBe(true);
    // grants: revoked more than 90 days ago are deleted; the others stay (the audit trail)
    expect(await exists('oAuthGrant', revoked100.id)).toBe(false);
    expect(await exists('oAuthGrant', revoked80.id)).toBe(true);
    expect(await exists('oAuthGrant', revoked40.id)).toBe(true);
    expect(await exists('oAuthGrant', revoked10.id)).toBe(true);
    expect(await exists('oAuthGrant', live.id)).toBe(true);
  });

  it('is idempotent and batches more rows than one batch', async () => {
    const grant = await makeGrant();
    await client.oAuthToken.createMany({
      data: Array.from({ length: 1200 }, () => ({ kind: 'access' as const, tokenHash: randomUUID(), tokenPrefix: 'abcd1234', grantId: grant.id, scopes: ['x:read'], expiresAt: ago(3 * DAY) })),
    });
    const first = await handler.cleanup(now);
    expect(first.accessTokens).toBeGreaterThanOrEqual(1200);
    expect(await client.oAuthToken.count({ where: { grantId: grant.id } })).toBe(0);
    expect((await handler.cleanup(now)).accessTokens).toBe(0);
  });

  it('has the permanent type and an enqueue-only cron', async () => {
    expect(handler.type).toBe('oauth.token.cleanup');
    expect(OAUTH_TOKEN_CLEANUP_TYPE).toBe('oauth.token.cleanup');
    const enqueue = jest.fn(async () => undefined);
    await new OAuthTokenCleanupTask({ enqueueHousekeepingJob: enqueue } as never).handleCron();
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: 'oauth.token.cleanup' }));
    // server-only: no node eligibility members
    expect((handler as unknown as Record<string, unknown>).nodeResultSchema).toBeUndefined();
    expect((handler as unknown as Record<string, unknown>).persistNodeResult).toBeUndefined();
  });
});

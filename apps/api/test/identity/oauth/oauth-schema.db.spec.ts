// The OAuth server schema invariants on real Postgres (PP-15.2, #1180):
//   - oauth_grants_active_uniq_idx refuses a second ACTIVE grant for one
//     (user, client, resource);
//   - a revoked grant allows a new active one, and another resource is free;
//   - deleting a user cascades its grants, codes and tokens (the client stays);
//   - deleting a client cascades its grants (and their codes and tokens).
import type { PrismaClient } from '@prisma/client';

import { createDbClient, resolveDbSuite } from '../../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('oauth-schema.db.spec');

describeWithDb('the OAuth server schema on real Postgres (#1180)', () => {
  let client: PrismaClient;
  const tag = `oauth-db-${process.pid}-${Date.now()}`;
  const userIds: string[] = [];
  const clientIds: string[] = [];
  let seq = 0;

  async function makeUser() {
    const n = seq++;
    const user = await client.user.create({ data: { email: `${tag}-${n}@example.test` } });
    userIds.push(user.id);
    return user;
  }

  async function makeClient() {
    const n = seq++;
    const row = await client.oAuthClient.create({
      data: {
        clientId: `oc_${tag}_${n}`,
        kind: 'registered',
        name: 'Client Alpha',
        redirectUris: ['https://client.example.test/cb'],
        tokenEndpointAuthMethod: 'none',
        host: 'client.example.test',
      },
    });
    clientIds.push(row.id);
    return row;
  }

  const grantData = (userId: string, clientId: string, resource = 'https://api.example.test/mcp') => ({
    userId,
    clientId,
    resource,
    scopes: ['read'],
  });

  async function addCodeAndToken(grantId: string, n: number) {
    await client.oAuthAuthorizationCode.create({
      data: {
        codeHash: `${tag}-code-${n}`,
        grantId,
        redirectUri: 'https://client.example.test/cb',
        codeChallenge: 'challenge',
        scope: 'read',
        resource: 'https://api.example.test/mcp',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await client.oAuthToken.create({
      data: {
        kind: 'access',
        tokenHash: `${tag}-tok-${n}`,
        tokenPrefix: 'abcdefgh',
        grantId,
        scopes: ['read'],
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
  }

  beforeAll(() => {
    client = createDbClient();
  });

  afterAll(async () => {
    await client.oAuthClient.deleteMany({ where: { id: { in: clientIds } } });
    await client.user.deleteMany({ where: { id: { in: userIds } } });
    await client.$disconnect();
  });

  it('refuses a second active grant for one user, client and resource', async () => {
    const user = await makeUser();
    const oc = await makeClient();
    await client.oAuthGrant.create({ data: grantData(user.id, oc.id) });
    await expect(client.oAuthGrant.create({ data: grantData(user.id, oc.id) })).rejects.toMatchObject({ code: 'P2002' });
    // another resource, another user and another client are not affected
    await client.oAuthGrant.create({ data: grantData(user.id, oc.id, 'https://other.example.test/mcp') });
    const other = await makeUser();
    await client.oAuthGrant.create({ data: grantData(other.id, oc.id) });
    const oc2 = await makeClient();
    await client.oAuthGrant.create({ data: grantData(user.id, oc2.id) });
  });

  it('allows a new active grant once the earlier one is revoked', async () => {
    const user = await makeUser();
    const oc = await makeClient();
    const first = await client.oAuthGrant.create({ data: grantData(user.id, oc.id) });
    await client.oAuthGrant.update({ where: { id: first.id }, data: { revokedAt: new Date(), revokedReason: 'user' } });
    const second = await client.oAuthGrant.create({ data: grantData(user.id, oc.id) });
    expect(second.id).not.toBe(first.id);
    await expect(client.oAuthGrant.create({ data: grantData(user.id, oc.id) })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('cascades grants, codes and tokens when the user is deleted, and keeps the client', async () => {
    const user = await makeUser();
    const oc = await makeClient();
    const grant = await client.oAuthGrant.create({ data: grantData(user.id, oc.id) });
    await addCodeAndToken(grant.id, seq++);
    await client.user.delete({ where: { id: user.id } });
    expect(await client.oAuthGrant.count({ where: { id: grant.id } })).toBe(0);
    expect(await client.oAuthAuthorizationCode.count({ where: { grantId: grant.id } })).toBe(0);
    expect(await client.oAuthToken.count({ where: { grantId: grant.id } })).toBe(0);
    expect(await client.oAuthClient.count({ where: { id: oc.id } })).toBe(1);
  });

  it('cascades grants (and their codes and tokens) when the client is deleted', async () => {
    const user = await makeUser();
    const oc = await makeClient();
    const grant = await client.oAuthGrant.create({ data: grantData(user.id, oc.id) });
    await addCodeAndToken(grant.id, seq++);
    await client.oAuthAuthorizationRequest.create({
      data: {
        clientId: oc.id,
        redirectUri: 'https://client.example.test/cb',
        scope: 'read',
        resource: 'https://api.example.test/mcp',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    await client.oAuthClient.delete({ where: { id: oc.id } });
    expect(await client.oAuthGrant.count({ where: { id: grant.id } })).toBe(0);
    expect(await client.oAuthAuthorizationCode.count({ where: { grantId: grant.id } })).toBe(0);
    expect(await client.oAuthToken.count({ where: { grantId: grant.id } })).toBe(0);
    expect(await client.oAuthAuthorizationRequest.count({ where: { clientId: oc.id } })).toBe(0);
    expect(await client.user.count({ where: { id: user.id } })).toBe(1);
  });

  it('sets created_by_user_id to null when the creating user is deleted', async () => {
    const user = await makeUser();
    const oc = await makeClient();
    await client.oAuthClient.update({ where: { id: oc.id }, data: { createdByUserId: user.id } });
    await client.user.delete({ where: { id: user.id } });
    const after = await client.oAuthClient.findUniqueOrThrow({ where: { id: oc.id } });
    expect(after.createdByUserId).toBeNull();
  });
});

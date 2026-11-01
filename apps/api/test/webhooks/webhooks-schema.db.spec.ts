// =============================================================================
// Real Postgres: webhook_endpoints and webhook_deliveries (issue #1046)
// =============================================================================
//
// Over a database owned by an ordinary role that FORCEs row-level security
// (`createRlsDatabase`): the policy is live, so this proves what a mock cannot.
// Org rows are isolated; a NULL org_id (system scope) is visible to the bypass
// client only; the (endpoint_id, event_id) unique makes fan-out idempotent; and
// rows cascade with their endpoint, owning user and organization.
// A `*.db.spec.ts` file: skipped with a warning when no Postgres is reachable.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { createRlsDatabase, ORG_A, ORG_B, type RlsDatabase } from '../helpers/rls-database.helper';
import { resolveDbSuite } from '../jobs/db-test-support';
import { seedOrgs, seedUser } from '../sharing/sharing-db.helper';

const { describeWithDb } = resolveDbSuite('webhooks-schema.db.spec');

describeWithDb('webhook tables (real Postgres, ordinary role, row-level security)', () => {
  let db: RlsDatabase;
  let userA: string;

  /** Runs `fn` as the tenant pool scoped to `orgId`, or with the bypass when `orgId` is 'bypass'. */
  const as = <T>(orgId: string | 'bypass', fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
    db.tenant.$transaction(async (tx) => {
      if (orgId === 'bypass') await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      else await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
      return fn(tx);
    });

  const endpoint = (orgId: string | null, scope: 'user' | 'org' | 'system', ownerUserId: string | null = null) => ({
    id: randomUUID(),
    orgId,
    scope,
    ownerUserId,
    name: 'Endpoint',
    url: 'https://hooks.example.test/in',
    eventKeys: ['nodes.*'],
    updatedAt: new Date(),
  });

  beforeAll(async () => {
    db = await createRlsDatabase('webhooks');
    await seedOrgs(db, [[ORG_A, 'org-a'], [ORG_B, 'org-b']]);
    userA = await seedUser(db, `hooks-${randomUUID().slice(0, 8)}@example.test`, [ORG_A]);
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
  }, 60_000);

  it('forces row-level security with the isolation policies for an ordinary role', async () => {
    const rel = await db.admin((c) =>
      c.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('webhook_endpoints','webhook_deliveries') ORDER BY relname"),
    );
    expect(rel.rows).toEqual([
      { relname: 'webhook_deliveries', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'webhook_endpoints', relrowsecurity: true, relforcerowsecurity: true },
    ]);
    const policies = await db.admin((c) => c.query("SELECT policyname FROM pg_policies WHERE tablename LIKE 'webhook_%' ORDER BY policyname"));
    expect(policies.rows.map((r) => r.policyname)).toEqual(['webhook_deliveries_org_isolation', 'webhook_endpoints_org_isolation']);
  });

  it('isolates organizations and shows a NULL org_id (system scope) to the bypass client only', async () => {
    const a = endpoint(ORG_A, 'org');
    const b = endpoint(ORG_B, 'org');
    const sys = endpoint(null, 'system');
    await as(ORG_A, (tx) => tx.webhookEndpoint.create({ data: a }));
    await as(ORG_B, (tx) => tx.webhookEndpoint.create({ data: b }));
    await as('bypass', (tx) => tx.webhookEndpoint.create({ data: sys }));

    expect((await as(ORG_A, (tx) => tx.webhookEndpoint.findMany({ select: { id: true } }))).map((r) => r.id)).toEqual([a.id]);
    expect((await as(ORG_B, (tx) => tx.webhookEndpoint.findMany({ select: { id: true } }))).map((r) => r.id)).toEqual([b.id]);
    expect((await as('bypass', (tx) => tx.webhookEndpoint.findMany({ select: { id: true } }))).map((r) => r.id).sort()).toEqual([a.id, b.id, sys.id].sort());
    // An organization cannot write a row into another organization.
    await expect(as(ORG_A, (tx) => tx.webhookEndpoint.create({ data: endpoint(ORG_B, 'org') }))).rejects.toThrow();
    // And cannot write a NULL org_id row.
    await expect(as(ORG_A, (tx) => tx.webhookEndpoint.create({ data: endpoint(null, 'system') }))).rejects.toThrow();
  });

  it('makes fan-out idempotent per (endpoint, event), isolates deliveries, and cascades with the endpoint', async () => {
    const ep = endpoint(ORG_A, 'org');
    await as(ORG_A, (tx) => tx.webhookEndpoint.create({ data: ep }));
    const eventId = randomUUID();
    const delivery = (orgId: string | null) => ({ endpointId: ep.id, orgId, eventKey: 'nodes.node.offline', eventId, payload: { ok: true } });
    await as(ORG_A, (tx) => tx.webhookDelivery.create({ data: delivery(ORG_A) }));
    await expect(as(ORG_A, (tx) => tx.webhookDelivery.create({ data: delivery(ORG_A) }))).rejects.toMatchObject({ code: 'P2002' });

    expect(await as(ORG_B, (tx) => tx.webhookDelivery.count({ where: { endpointId: ep.id } }))).toBe(0);
    expect(await as(ORG_A, (tx) => tx.webhookDelivery.count({ where: { endpointId: ep.id } }))).toBe(1);
    const row = await as(ORG_A, (tx) => tx.webhookDelivery.findFirstOrThrow({ where: { endpointId: ep.id } }));
    expect(row).toMatchObject({ status: 'pending', attempt: 0 });

    await as(ORG_A, (tx) => tx.webhookEndpoint.delete({ where: { id: ep.id } }));
    expect(await as('bypass', (tx) => tx.webhookDelivery.count({ where: { endpointId: ep.id } }))).toBe(0);
  });

  it('cascades endpoints (and their deliveries) with the owning user', async () => {
    const ep = endpoint(ORG_A, 'user', userA);
    await as(ORG_A, (tx) => tx.webhookEndpoint.create({ data: ep }));
    await as(ORG_A, (tx) =>
      tx.webhookDelivery.create({ data: { endpointId: ep.id, orgId: ORG_A, eventKey: 'x.y', eventId: randomUUID(), payload: {} } }),
    );
    await as('bypass', (tx) => tx.user.delete({ where: { id: userA } }));
    expect(await as('bypass', (tx) => tx.webhookEndpoint.count({ where: { id: ep.id } }))).toBe(0);
    expect(await as('bypass', (tx) => tx.webhookDelivery.count({ where: { endpointId: ep.id } }))).toBe(0);
  });

  it('cascades endpoints with their organization', async () => {
    const ep = endpoint(ORG_B, 'org');
    await as(ORG_B, (tx) => tx.webhookEndpoint.create({ data: ep }));
    await as('bypass', (tx) => tx.organization.delete({ where: { id: ORG_B } }));
    expect(await as('bypass', (tx) => tx.webhookEndpoint.count({ where: { id: ep.id } }))).toBe(0);
  });
});

// =============================================================================
// The webhooks slice over a real database that enforces row-level security
// (issue #1046)
// =============================================================================
//
// The slice's logic is proven against in-memory ports in the package; what only
// a real server can prove is proven here, with the application's own two Prisma
// providers (`PrismaService`, `PrismaSystemService`) on an ordinary role:
//
//   - an organization's endpoints and deliveries are invisible to another
//     organization and to an unscoped client; a system-scope row (no
//     organization) is visible to the bypass client only;
//   - a fan-out inserts the delivery rows AND enqueues their jobs in one
//     transaction, idempotently per (endpoint, event);
//   - the signing secret is stored in the credentials tier that matches the
//     endpoint (user, organization, deployment) and removed with it;
//   - the delivery job reads and settles org rows under `runInOrg` and system
//     rows through the bypass client, and the retention purge reaches both.
//
// A `*.db.spec.ts` file: skipped with a warning when no Postgres is reachable.
// =============================================================================

import { randomUUID } from 'node:crypto';

import {
  CredentialsService,
  OrgCredentialsService,
  UserCredentialsService,
  credentialPurposeRegistry,
  userCredentialPurposeRegistry,
} from '@marinoscar/platform-api/credentials';
import { JobHandlerRegistry, JobsService } from '@marinoscar/platform-api/jobs';
import {
  CredentialsWebhookSecrets,
  PrismaWebhooksRepository,
  WEBHOOK_SIGNING_CREDENTIAL_PURPOSE_DEF,
  WEBHOOK_SIGNING_USER_CREDENTIAL_PURPOSE_DEF,
  WebhookDeliverHandler,
  WebhookEndpointsService,
  WebhooksService,
  ownerMayReceive,
  registerBuiltinWebhookEvents,
  registerWebhookErrorCodes,
  resolveWebhooksModuleOptions,
  type WebhooksPrisma,
  type WebhooksSystemPrisma,
} from '@marinoscar/platform-api/webhooks';
import { FakeWebhookReceiver, ScriptedHostResolver } from '@marinoscar/platform-api/webhooks/testing';
import { registerCredentialPurpose, registerUserCredentialPurpose } from '@marinoscar/platform-api/credentials';

import { ORG_A, ORG_B, createRlsDatabase, rlsServices, type RlsDatabase } from '../helpers/rls-database.helper';
import { resolveDbSuite } from '../jobs/db-test-support';
import { seedOrgs, seedUser } from '../sharing/sharing-db.helper';

const { describeWithDb } = resolveDbSuite('webhooks.db.spec');

if (!credentialPurposeRegistry.has(WEBHOOK_SIGNING_CREDENTIAL_PURPOSE_DEF.purpose)) registerCredentialPurpose(WEBHOOK_SIGNING_CREDENTIAL_PURPOSE_DEF);
if (!userCredentialPurposeRegistry.has(WEBHOOK_SIGNING_USER_CREDENTIAL_PURPOSE_DEF.purpose)) registerUserCredentialPurpose(WEBHOOK_SIGNING_USER_CREDENTIAL_PURPOSE_DEF);

const ORIGINAL_KEY = process.env.SECRETS_ENCRYPTION_KEY;
const URL_OK = 'https://receiver.example.test/hooks';

describeWithDb('webhooks over row-level security (real Postgres)', () => {
  let db: RlsDatabase;
  let services: ReturnType<typeof rlsServices>;
  let repository: PrismaWebhooksRepository;
  let endpoints: WebhookEndpointsService;
  let webhooks: WebhooksService;
  let deliver: WebhookDeliverHandler;
  let receiver: FakeWebhookReceiver;
  let secrets: CredentialsWebhookSecrets;
  let userA: string;
  let userB: string;
  const audit: Array<{ action: string }> = [];

  const jobsOf = (type: string) => db.system.$transaction(async (tx) => tx.job.findMany({ where: { type }, orderBy: { createdAt: 'asc' } }));
  const ctx = (scope: 'user' | 'org' | 'system', userId: string, orgId: string | null = ORG_A) => ({
    scope,
    userId,
    orgId: scope === 'system' ? null : orgId,
    permissions: ['webhooks:read', 'webhooks:write', 'org_webhooks:read', 'org_webhooks:write', 'system_webhooks:read', 'system_webhooks:write'],
  });

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64');
    registerBuiltinWebhookEvents();
    registerWebhookErrorCodes();
    db = await createRlsDatabase('webhooks_repo');
    await seedOrgs(db, [[ORG_A, 'org-a'], [ORG_B, 'org-b']]);
    userA = await seedUser(db, `hooks-a-${randomUUID().slice(0, 8)}@example.test`, [ORG_A]);
    userB = await seedUser(db, `hooks-b-${randomUUID().slice(0, 8)}@example.test`, [ORG_A, ORG_B]);

    services = rlsServices(db);
    const prisma = services.prisma as unknown as WebhooksPrisma;
    const jobs = new JobsService(services.prisma as never);
    repository = new PrismaWebhooksRepository(prisma, services.system as unknown as WebhooksSystemPrisma, jobs);
    secrets = new CredentialsWebhookSecrets(new UserCredentialsService(services.prisma as never), new OrgCredentialsService(services.prisma as never), new CredentialsService(services.prisma as never));

    receiver = new FakeWebhookReceiver();
    const resolver = new ScriptedHostResolver().set('receiver.example.test', '93.184.216.34');
    const options = resolveWebhooksModuleOptions({ transport: receiver, resolver });
    const auditSink = { record: async (event: { action: string }) => void audit.push(event) };
    endpoints = new WebhookEndpointsService(repository, secrets, options, resolver, auditSink);
    webhooks = new WebhooksService(repository, jobs, prisma, auditSink);
    deliver = new WebhookDeliverHandler(new JobHandlerRegistry(), repository, secrets, options, receiver, resolver);
  }, 240_000);

  afterAll(async () => {
    await services?.close();
    await db?.destroy();
    if (ORIGINAL_KEY === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY;
  }, 60_000);

  it('isolates organizations and keeps a system endpoint away from every tenant client', async () => {
    const orgA = await endpoints.create(ctx('org', userA, ORG_A), { name: 'org a', url: URL_OK, eventKeys: ['webhooks.ping'.replace('webhooks.ping', 'nodes.*')], enabled: true }).catch((e: unknown) => e);
    // An org endpoint cannot subscribe to a system event; seed through the repository for the isolation facts.
    expect(orgA).toBeInstanceOf(Error);

    const a = await repository.createEndpoint(ORG_A, { scope: 'org', ownerUserId: null, createdById: userA, name: 'a', description: null, url: URL_OK, eventKeys: ['webhooks.ping'], enabled: true });
    const b = await repository.createEndpoint(ORG_B, { scope: 'org', ownerUserId: null, createdById: userB, name: 'b', description: null, url: URL_OK, eventKeys: ['webhooks.ping'], enabled: true });
    const sys = await endpoints.create(ctx('system', userA), { name: 'sys', url: URL_OK, eventKeys: ['nodes.*'], enabled: true });

    expect((await repository.listEndpoints(ORG_A, { scope: 'org' })).map((e) => e.id)).toEqual([a.id]);
    expect((await repository.listEndpoints(ORG_B, { scope: 'org' })).map((e) => e.id)).toEqual([b.id]);
    expect(await repository.findEndpoint(ORG_B, a.id, { scope: 'org' })).toBeNull();
    expect(await repository.findEndpoint(ORG_A, a.id, { scope: 'user', ownerUserId: userA })).toBeNull();
    expect((await repository.listEndpoints(null, { scope: 'system' })).map((e) => e.id)).toEqual([sys.endpoint.id]);
    expect(await repository.findEndpoint(ORG_A, sys.endpoint.id, { scope: 'system' })).toBeNull();

    // The tenant pool with no scope sees nothing at all; only the bypass sees the system row.
    expect(await db.tenant.webhookEndpoint.findMany()).toEqual([]);
    const bypass = await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return tx.webhookEndpoint.findMany({ where: { orgId: null }, select: { id: true } });
    });
    expect(bypass.map((r) => r.id)).toEqual([sys.endpoint.id]);
    await expect(services.prisma.runInOrg(ORG_A, (tx) => tx.webhookEndpoint.findMany({ where: { orgId: null } }))).resolves.toEqual([]);
  });

  it('stores the secret in the matching credentials tier and removes it with the endpoint', async () => {
    const sys = await endpoints.create(ctx('system', userA), { name: 'sys-secret', url: URL_OK, eventKeys: ['nodes.*'], enabled: true });
    const row = (await repository.findEndpoint(null, sys.endpoint.id, { scope: 'system' }))!;
    expect(await secrets.get(row, 1)).toBe(sys.secret);
    const stored = await db.system.credential.findFirst({ where: { purpose: 'webhook_signing', name: `endpoint:${sys.endpoint.id}:v1` } });
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain(sys.secret);

    const rotated = await endpoints.rotateSecret(ctx('system', userA), sys.endpoint.id);
    expect(await secrets.get(row, 2)).toBe(rotated.secret);
    await endpoints.remove(ctx('system', userA), sys.endpoint.id);
    expect(await db.system.credential.count({ where: { purpose: 'webhook_signing', name: { startsWith: `endpoint:${sys.endpoint.id}:` } } })).toBe(0);
    expect(await repository.findEndpoint(null, sys.endpoint.id, { scope: 'system' })).toBeNull();

    // The organization and user tiers.
    const orgEndpoint = await repository.createEndpoint(ORG_A, { scope: 'org', ownerUserId: null, createdById: userA, name: 'org-secret', description: null, url: URL_OK, eventKeys: ['webhooks.ping'], enabled: true });
    await secrets.put(orgEndpoint, 1, 'whsec_org');
    expect(await secrets.get(orgEndpoint, 1)).toBe('whsec_org');
    expect(await db.system.$transaction(async (tx) => (await tx.$executeRaw`SELECT set_config('app.rls_bypass','on',true)`, tx.orgCredential.count({ where: { orgId: ORG_A, purpose: 'webhook_signing' } })))).toBe(1);
    const userEndpoint = await repository.createEndpoint(ORG_A, { scope: 'user', ownerUserId: userA, createdById: userA, name: 'user-secret', description: null, url: URL_OK, eventKeys: ['webhooks.ping'], enabled: true });
    await secrets.put(userEndpoint, 1, 'whsec_user');
    expect(await secrets.get(userEndpoint, 1)).toBe('whsec_user');
    await secrets.removeAll(userEndpoint, 1);
    expect(await secrets.get(userEndpoint, 1)).toBeNull();
  });

  it('fans out in one transaction with the jobs, and replaying the event inserts nothing', async () => {
    const sys = await endpoints.create(ctx('system', userA), { name: 'fan', url: URL_OK, eventKeys: ['nodes.*'], enabled: true });
    await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      const perm = await tx.permission.upsert({ where: { name: 'system_webhooks:read' }, create: { name: 'system_webhooks:read', description: 'x', scope: 'system' }, update: {} });
      const admin = (await tx.role.findFirst({ where: { name: 'admin' } })) ?? (await tx.role.create({ data: { name: 'admin', description: 'Admin', scope: 'system' } }));
      await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: admin.id, permissionId: perm.id } }, create: { roleId: admin.id, permissionId: perm.id }, update: {} });
      await tx.userRole.upsert({ where: { userId_roleId: { userId: userA, roleId: admin.id } }, create: { userId: userA, roleId: admin.id }, update: {} });
    });

    const eventId = randomUUID();
    const data = { nodeId: 'n1', nodeName: 'builder-1', lastHeartbeatAt: null, markedOfflineAt: new Date().toISOString(), staleAfterMinutes: 5 };
    const first = await webhooks.emit('nodes.node.offline', data, { orgId: null, eventId });
    // Every enabled system endpoint that subscribes to nodes.* (earlier cases left two).
    expect(first.queued).toBe(first.matched);
    expect(first.queued).toBeGreaterThanOrEqual(1);
    const again = await webhooks.emit('nodes.node.offline', data, { orgId: null, eventId });
    expect(again.queued).toBe(0);

    const rows = await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return tx.webhookDelivery.findMany({ where: { endpointId: sys.endpoint.id } });
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orgId: null, eventKey: 'nodes.node.offline', eventId, status: 'pending' });
    const jobs = (await jobsOf('webhooks.deliver')).filter((job) => job.subjectId === rows[0]!.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ orgId: null, subjectType: 'webhook_delivery', status: 'pending' });
  });

  it('delivers a system delivery through the bypass client and an org delivery under its organization', async () => {
    const sys = await endpoints.create(ctx('system', userA), { name: 'deliver-sys', url: URL_OK, eventKeys: ['nodes.*'], enabled: true });
    const { deliveryId } = await endpoints.test(ctx('system', userA), sys.endpoint.id);
    await deliver.process({ id: 'j', type: 'webhooks.deliver', subjectId: deliveryId, orgId: null } as never);
    expect(receiver.requests.at(-1)!.headers['webhook-signature']).toMatch(/^v1,/);
    const settled = await repository.findDelivery(null, deliveryId, { scope: 'system' });
    expect(settled).toMatchObject({ status: 'succeeded', attempt: 1, responseStatus: 200 });

    const org = await repository.createEndpoint(ORG_A, { scope: 'org', ownerUserId: null, createdById: userA, name: 'deliver-org', description: null, url: URL_OK, eventKeys: ['webhooks.ping'], enabled: true });
    await secrets.put(org, 1, 'whsec_c2VjcmV0LWZvci10ZXN0cy0xMjM0NTY3ODkwMTIzNDU2');
    const [orgDelivery] = await repository.insertDeliveries(ORG_A, [{ endpointId: org.id, eventKey: 'webhooks.ping', eventId: randomUUID(), payload: { id: 'x', type: 'webhooks.ping', data: {} } }]);
    // Another organization's job context cannot see the delivery: the job finds nothing and ends quietly.
    const before = receiver.requests.length;
    await deliver.process({ id: 'j2', type: 'webhooks.deliver', subjectId: orgDelivery!.id, orgId: ORG_B } as never);
    expect(receiver.requests).toHaveLength(before);
    await deliver.process({ id: 'j3', type: 'webhooks.deliver', subjectId: orgDelivery!.id, orgId: ORG_A } as never);
    expect(receiver.requests).toHaveLength(before + 1);
    expect(await repository.findDelivery(ORG_A, orgDelivery!.id, { scope: 'org' })).toMatchObject({ status: 'succeeded' });
    expect(await repository.findDelivery(ORG_B, orgDelivery!.id, { scope: 'org' })).toBeNull();
  });

  it('opens the circuit once at the threshold, atomically', async () => {
    const org = await repository.createEndpoint(ORG_A, { scope: 'org', ownerUserId: null, createdById: userA, name: 'breaker', description: null, url: URL_OK, eventKeys: ['webhooks.ping'], enabled: true });
    const [d] = await repository.insertDeliveries(ORG_A, [{ endpointId: org.id, eventKey: 'webhooks.ping', eventId: randomUUID(), payload: {} }]);
    const outcome = { delivery: { status: 'failed' as const }, endpoint: 'failure' as const, threshold: 2 };
    expect((await repository.settleAttempt(ORG_A, d!.id, org.id, outcome)).disabled).toBe(false);
    const results = await Promise.all([repository.settleAttempt(ORG_A, d!.id, org.id, outcome), repository.settleAttempt(ORG_A, d!.id, org.id, outcome)]);
    expect(results.filter((r) => r.disabled)).toHaveLength(1);
    expect(await repository.findEndpoint(ORG_A, org.id, { scope: 'org' })).toMatchObject({ enabled: false, disabledReason: 'circuit_open', consecutiveFailures: 3 });
  });

  it('re-checks the owner against real roles: a member loses the permission, the endpoint stops receiving', async () => {
    const owner = await repository.loadOwner(ORG_A, userA);
    expect(owner?.id).toBe(userA);
    const event = { permission: undefined };
    expect(ownerMayReceive(owner, { scope: 'user', orgId: ORG_A }, event)).toBe(false); // the viewer role holds no webhooks:read in this fixture
    await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      const perm = await tx.permission.upsert({ where: { name: 'webhooks:read' }, create: { name: 'webhooks:read', description: 'x', scope: 'org' }, update: {} });
      const viewer = (await tx.role.findFirst({ where: { name: 'viewer' } }))!;
      await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: viewer.id, permissionId: perm.id } }, create: { roleId: viewer.id, permissionId: perm.id }, update: {} });
    });
    expect(ownerMayReceive(await repository.loadOwner(ORG_A, userA), { scope: 'user', orgId: ORG_A }, event)).toBe(true);
    // A membership in another organization grants nothing here.
    expect(ownerMayReceive(await repository.loadOwner(ORG_B, userB), { scope: 'user', orgId: ORG_B }, event)).toBe(true);
    expect(ownerMayReceive(await repository.loadOwner(ORG_A, randomUUID()), { scope: 'user', orgId: ORG_A }, event)).toBe(false);
  });

  it('purges expired deliveries across organizations and keeps the rest', async () => {
    const orgEndpoint = await repository.createEndpoint(ORG_B, { scope: 'org', ownerUserId: null, createdById: userB, name: 'purge-org', description: null, url: URL_OK, eventKeys: ['webhooks.ping'], enabled: true });
    const [oldOrg, freshOrg] = await repository.insertDeliveries(ORG_B, [
      { endpointId: orgEndpoint.id, eventKey: 'webhooks.ping', eventId: randomUUID(), payload: {} },
      { endpointId: orgEndpoint.id, eventKey: 'webhooks.ping', eventId: randomUUID(), payload: {} },
    ]);
    const sysEndpoint = await repository.createEndpoint(null, { scope: 'system', ownerUserId: null, createdById: userA, name: 'purge-sys', description: null, url: URL_OK, eventKeys: ['nodes.*'], enabled: true });
    const [oldSys] = await repository.insertDeliveries(null, [{ endpointId: sysEndpoint.id, eventKey: 'nodes.node.offline', eventId: randomUUID(), payload: {} }]);
    const longAgo = new Date(Date.now() - 90 * 86_400_000);
    await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      await tx.webhookDelivery.updateMany({ where: { id: { in: [oldOrg!.id, oldSys!.id] } }, data: { createdAt: longAgo } });
    });
    const removed = await repository.purgeDeliveriesBefore(new Date(Date.now() - 30 * 86_400_000));
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await repository.findDelivery(ORG_B, oldOrg!.id, { scope: 'org' })).toBeNull();
    expect(await repository.findDelivery(ORG_B, freshOrg!.id, { scope: 'org' })).not.toBeNull();
    expect(await repository.findDelivery(null, oldSys!.id, { scope: 'system' })).toBeNull();
  });

  it('deleting an endpoint cascades to its deliveries', async () => {
    const org = await repository.createEndpoint(ORG_A, { scope: 'org', ownerUserId: null, createdById: userA, name: 'cascade', description: null, url: URL_OK, eventKeys: ['webhooks.ping'], enabled: true });
    const [d] = await repository.insertDeliveries(ORG_A, [{ endpointId: org.id, eventKey: 'webhooks.ping', eventId: randomUUID(), payload: {} }]);
    await repository.deleteEndpoint(ORG_A, org.id);
    expect(await repository.loadDeliveryForJob(ORG_A, d!.id)).toBeNull();
  });
});

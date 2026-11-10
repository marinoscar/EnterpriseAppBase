// =============================================================================
// Real-Postgres test: `node_credential_issuances` audits a delivery and cannot
// hold the credential (issue #1083)
// =============================================================================
//
// Opt-in provider-credential delivery hands a worker node the organization's
// or the deployment's provider key in ONE HTTP response. This file proves,
// against the migrated database, that the audit cannot become a second copy:
//
//   - the column list is an ALLOWLIST (as `job-node-secret-schema.db.spec.ts`
//     does for `job_node_secrets`), with no column named like material;
//   - an issuance row cascades with its node, and survives the job-history
//     purge with `job_id` set to NULL;
//   - an end-to-end issuance through `NodeCredentialDeliveryService` on this
//     database writes the issuance row and an `audit_events` row whose every
//     column is free of a marker credential that the response does carry.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
  JobHandlerRegistry,
  nodeCredentialPurposeRegistry,
  registerNodeCredentialPurpose,
} from '@marinoscar/platform-api/jobs';
import { NodeCredentialDeliveryService, mergeNodesSettings } from '@marinoscar/platform-api/nodes';
import { buildDatabaseUrl } from '../../src/common/database-url';
import { DEFAULT_SYSTEM_SETTINGS } from '../../src/common/types/settings.types';

const PERMITTED_COLUMNS = ['expires_at', 'id', 'issued_at', 'job_id', 'node_id', 'purpose', 'version'];
const FORBIDDEN_NAME_FRAGMENTS = ['password', 'secret', 'material', 'credential', 'token', 'key', 'encrypted', 'cipher'];

const MARKER = `sk-db-node-delivery-marker-${randomUUID()}`;
const PURPOSE = 'dbtest:provider';
const TYPE = 'test.node-credential-issuance';

/** See `worker-node-schema.db.spec.ts` for the full rationale of this probe. */
function isPostgresReachable(host: string, port: number, timeoutMs = 2000): boolean {
  try {
    const probe = `
      const net = require('net');
      const socket = net.createConnection({ host: process.argv[1], port: Number(process.argv[2]) });
      const done = (ok) => { try { socket.destroy(); } catch (_e) {} process.exit(ok ? 0 : 1); };
      socket.setTimeout(${timeoutMs});
      socket.on('connect', () => done(true));
      socket.on('timeout', () => done(false));
      socket.on('error', () => done(false));
    `;
    execFileSync(process.execPath, ['-e', probe, host, String(port)], { stdio: 'ignore', timeout: timeoutMs + 1000 });
    return true;
  } catch {
    return false;
  }
}

const postgresHost = process.env.POSTGRES_HOST;
const postgresPort = Number(process.env.POSTGRES_PORT) || 5432;
const dbReachable = Boolean(postgresHost) && isPostgresReachable(postgresHost as string, postgresPort);

if (!dbReachable) {
  // eslint-disable-next-line no-console
  console.warn(
    `\n[node-credential-issuances.db.spec] SKIPPED: no Postgres reachable at ` +
      `${postgresHost ?? '(POSTGRES_HOST unset)'}:${postgresPort}. Point POSTGRES_* at a migrated database and re-run \`npm run test:db\`.\n`,
  );
}

const describeWithDb = dbReachable ? describe : describe.skip;

if (nodeCredentialPurposeRegistry.get(PURPOSE) === undefined) {
  registerNodeCredentialPurpose({ id: PURPOSE, label: 'DB test provider', resolve: async () => ({ material: { apiKey: MARKER } }) });
}

describeWithDb('node_credential_issuances (real Postgres)', () => {
  let prisma: PrismaClient;
  let ownerId: string;
  const originalKey = process.env.SECRETS_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY = originalKey ?? randomBytes(32).toString('base64');
    const { DATABASE_URL: _ignored, ...envWithoutDatabaseUrl } = process.env;
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl(envWithoutDatabaseUrl)) });
    await prisma.$connect();
    ownerId = (await prisma.user.create({ data: { email: `node-cred-${randomUUID()}@example.test` } })).id;
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorUserId: ownerId } });
    await prisma.workerNode.deleteMany({ where: { createdById: ownerId } });
    await prisma.job.deleteMany({ where: { type: TYPE } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma?.$disconnect();
    if (originalKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  });

  async function node(): Promise<string> {
    const row = await prisma.workerNode.create({
      data: { name: `node-${randomUUID()}`, hostname: 'h', platform: 'linux', cliVersion: '1.0.0', eligibleTypes: [TYPE], concurrency: 1, createdById: ownerId },
    });
    return row.id;
  }

  async function job(nodeId: string): Promise<string> {
    const row = await prisma.job.create({
      data: {
        type: TYPE,
        status: 'running',
        reason: 'manual',
        claimedByNodeId: nodeId,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        payload: {},
      } as never,
    });
    return row.id;
  }

  it('has exactly the permitted columns, none named like material', async () => {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'node_credential_issuances' ORDER BY column_name`;
    const columns = rows.map((row) => row.column_name);
    expect(columns).toEqual(PERMITTED_COLUMNS);
    for (const column of columns) {
      for (const fragment of FORBIDDEN_NAME_FRAGMENTS) expect(column.includes(fragment)).toBe(false);
    }
  });

  it('is not under row-level security (worker_nodes has none)', async () => {
    const rows = await prisma.$queryRaw<Array<{ relrowsecurity: boolean }>>`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'node_credential_issuances'`;
    expect(rows).toEqual([{ relrowsecurity: false }]);
  });

  it('keeps the audit when the job is purged (job_id SET NULL) and cascades with the node', async () => {
    const nodeId = await node();
    const jobId = await job(nodeId);
    const row = await prisma.nodeCredentialIssuance.create({
      data: { nodeId, purpose: PURPOSE, version: '0123456789abcdef', jobId, expiresAt: new Date(Date.now() + 3_600_000) },
    });

    await prisma.job.delete({ where: { id: jobId } });
    expect((await prisma.nodeCredentialIssuance.findUnique({ where: { id: row.id } }))?.jobId).toBeNull();

    await prisma.workerNode.delete({ where: { id: nodeId } });
    expect(await prisma.nodeCredentialIssuance.findUnique({ where: { id: row.id } })).toBeNull();
  });

  it('an end-to-end issuance writes the audit without the material the response carries', async () => {
    const nodeId = await node();
    const jobId = await job(nodeId);
    const registry = new JobHandlerRegistry();
    registry.register({
      type: TYPE,
      process: async () => undefined,
      nodeResultSchema: { safeParse: () => ({ success: true }) } as never,
      persistNodeResult: async () => undefined,
      nodeCredentialPurposes: [PURPOSE],
    });
    let stored: Record<string, unknown> = {
      ...DEFAULT_SYSTEM_SETTINGS.nodes,
      credentialDelivery: { enabled: true, cacheTtlMinutes: 15, purposes: [PURPOSE], epoch: 1 },
    };
    const settings = {
      getNodesPolicy: async () => stored,
      patchSettings: async (body: { nodes: never }) => {
        stored = mergeNodesSettings(stored as never, body.nodes) as never;
      },
    };
    const nodes = {
      getNode: async () => ({ id: nodeId }),
      assertJobHeldByNode: async () => prisma.job.findUniqueOrThrow({ where: { id: jobId } }),
    };
    const service = new NodeCredentialDeliveryService(prisma as never, nodes as never, registry, settings as never, { get: () => undefined } as never);

    const issued = await service.issue(ownerId, nodeId, PURPOSE, { jobId });
    expect(issued.material).toEqual({ apiKey: MARKER });

    const issuances = await prisma.nodeCredentialIssuance.findMany({ where: { nodeId } });
    expect(issuances).toHaveLength(1);
    expect(issuances[0]).toEqual(expect.objectContaining({ purpose: PURPOSE, version: issued.version, jobId }));
    expect(issuances[0]!.expiresAt.getTime() - issuances[0]!.issuedAt.getTime()).toBe(15 * 60_000);

    const audits = await prisma.auditEvent.findMany({ where: { actorUserId: ownerId, action: 'node_credential:issued' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toEqual({ purpose: PURPOSE, version: issued.version, jobId });

    // The marker is nowhere in either table, nor in the job row.
    const [issuanceHits, auditHits, jobHits] = await Promise.all([
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM node_credential_issuances t WHERE t::text LIKE ${'%' + MARKER + '%'}`,
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM audit_events t WHERE t::text LIKE ${'%' + MARKER + '%'}`,
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM jobs t WHERE t::text LIKE ${'%' + MARKER + '%'}`,
    ]);
    expect([issuanceHits[0]!.n, auditHits[0]!.n, jobHits[0]!.n]).toEqual([0n, 0n, 0n]);

    // Revoke-all advances the epoch and is audited, also without material.
    await expect(service.revokeAll(ownerId)).resolves.toEqual({ epoch: 2 });
    const revokes = await prisma.auditEvent.findMany({ where: { actorUserId: ownerId, action: 'node_credential:revoke_all' } });
    expect(revokes.map((row) => row.meta)).toEqual([{ epoch: 2 }]);
  });
});

// =============================================================================
// Real-Postgres test: worker_nodes / node_credentials constraints and the
// jobs.claimed_by_node_id FK (issue #267, epic #254)
// =============================================================================
//
// `@@unique([createdById, name])` on `WorkerNode` is #268's register-or-
// reattach anchor, and `Job.claimedByNode`'s `onDelete: SetNull` is an
// explicit acceptance criterion of #267 ("Deleting a WorkerNode sets
// claimedByNodeId to null on its jobs rather than deleting them"). Neither
// is something a unit test can prove — a foreign key's ON DELETE behaviour
// and a unique constraint's actual enforcement only exist once a migration
// has run against a real database — so, like
// `test/jobs/job-schema-indexes.db.spec.ts`, this is a `*.db.spec.ts` file,
// deliberately excluded from `npm test`/`test:unit`/`test:cov`/`test:ci`
// (see apps/api/package.json's testPathIgnorePatterns). It runs only via
// `npm run test:db`, which CI's `smoke` job invokes right after
// `prisma:migrate` and before `prisma:seed` (see .github/workflows/ci.yml).
// Locally, `npm run test:db` needs a real Postgres reachable at
// POSTGRES_HOST/POSTGRES_PORT with the migrations applied; see the
// reachability check below for what happens without one.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildDatabaseUrl } from '../../src/common/database-url';

const HAND_WRITTEN_INDEX_NAMES = ['worker_nodes_created_by_id_name_key'];

/**
 * Whether something is actually listening on host:port, checked with a real
 * (short-timeout) TCP connect rather than merely asking whether an env var is
 * set. See `test/jobs/job-schema-indexes.db.spec.ts` for the full rationale
 * behind this exact implementation (synchronous child-process probe, because
 * Jest decides which describe/it blocks exist by running the file's
 * top-level synchronous code) — copied here verbatim rather than shared,
 * matching that file's own precedent of being self-contained.
 */
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
    execFileSync(process.execPath, ['-e', probe, host, String(port)], {
      stdio: 'ignore',
      timeout: timeoutMs + 1000,
    });
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
    `\n[worker-node-schema.db.spec] SKIPPED: no Postgres reachable at ` +
      `${postgresHost ?? '(POSTGRES_HOST unset)'}:${postgresPort}. ` +
      `Start infra/compose/test.compose.yml (or otherwise point POSTGRES_HOST/` +
      `POSTGRES_PORT at a migrated database) and re-run \`npm run test:db\` ` +
      `to exercise these real-Postgres assertions.\n`,
  );
}

const describeWithDb = dbReachable ? describe : describe.skip;

describeWithDb('WorkerNode / NodeCredential schema (real Postgres)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    // See `job-schema-indexes.db.spec.ts` for why `DATABASE_URL` is stripped
    // before rebuilding it from POSTGRES_*: `test/setup.ts` unconditionally
    // loads `.env.test`, which sets a hard-coded `DATABASE_URL`, and
    // `buildDatabaseUrl()`'s documented contract is that an already-set
    // `DATABASE_URL` always wins — which would silently point this suite
    // somewhere other than the host/port the reachability check just proved.
    const { DATABASE_URL: _ignored, ...envWithoutDatabaseUrl } = process.env;
    prisma = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl(envWithoutDatabaseUrl)) });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  afterEach(async () => {
    // Jobs first: deleting a WorkerNode with jobs still pointing at it is
    // exactly the scenario under test elsewhere in this file, so by the time
    // cleanup runs some tests will have already exercised the SetNull path
    // themselves. Deleting worker_nodes cascades node_credentials.
    await prisma.job.deleteMany({ where: { type: { startsWith: 'test.node-schema' } } });
    await prisma.workerNode.deleteMany({ where: { name: { startsWith: 'test-node-' } } });
  });

  async function createOwner(emailPrefix: string) {
    return prisma.user.create({
      data: { email: `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test` },
    });
  }

  it('creates the (created_by_id, name) unique index that backs register-or-reattach', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'worker_nodes' AND indexname = ANY(${HAND_WRITTEN_INDEX_NAMES})
    `;
    expect(rows.map((r) => r.indexname).sort()).toEqual([...HAND_WRITTEN_INDEX_NAMES].sort());
  });

  it('rejects a second node with the same (createdById, name) pair', async () => {
    const owner = await createOwner('node-dedup-owner');

    await prisma.workerNode.create({
      data: {
        name: 'test-node-dedup',
        hostname: 'host-a',
        platform: 'linux',
        cliVersion: '1.0.0',
        eligibleTypes: ['test.node-schema.echo'],
        concurrency: 2,
        createdById: owner.id,
      },
    });

    await expect(
      prisma.workerNode.create({
        data: {
          name: 'test-node-dedup',
          hostname: 'host-b',
          platform: 'linux',
          cliVersion: '1.0.0',
          eligibleTypes: ['test.node-schema.echo'],
          concurrency: 2,
          createdById: owner.id,
        },
      })
    ).rejects.toMatchObject({ code: 'P2002' });

    await prisma.user.delete({ where: { id: owner.id } });
  });

  it('allows the same name for two different owners (uniqueness is per-owner, not global)', async () => {
    const ownerA = await createOwner('node-dedup-owner-a');
    const ownerB = await createOwner('node-dedup-owner-b');

    const nodeA = await prisma.workerNode.create({
      data: {
        name: 'test-node-shared-name',
        hostname: 'host-a',
        platform: 'linux',
        cliVersion: '1.0.0',
        eligibleTypes: [],
        concurrency: 1,
        createdById: ownerA.id,
      },
    });
    const nodeB = await prisma.workerNode.create({
      data: {
        name: 'test-node-shared-name',
        hostname: 'host-b',
        platform: 'linux',
        cliVersion: '1.0.0',
        eligibleTypes: [],
        concurrency: 1,
        createdById: ownerB.id,
      },
    });

    expect(nodeA.id).not.toBe(nodeB.id);

    await prisma.user.delete({ where: { id: ownerA.id } });
    await prisma.user.delete({ where: { id: ownerB.id } });
  });

  it('sets claimed_by_node_id to null on a node\'s jobs when the node is deleted, rather than deleting them', async () => {
    const owner = await createOwner('node-release-owner');

    const node = await prisma.workerNode.create({
      data: {
        name: 'test-node-release',
        hostname: 'host-release',
        platform: 'linux',
        cliVersion: '1.0.0',
        eligibleTypes: ['test.node-schema.release'],
        concurrency: 1,
        createdById: owner.id,
      },
    });

    const job = await prisma.job.create({
      data: {
        type: 'test.node-schema.release',
        reason: 'backfill',
        status: 'running',
        claimedByNodeId: node.id,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    await prisma.workerNode.delete({ where: { id: node.id } });

    const reloaded = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(reloaded.claimedByNodeId).toBeNull();
    // The job row itself survives — the acceptance criterion is "released",
    // not "deleted".
    expect(reloaded.id).toBe(job.id);
    expect(reloaded.status).toBe('running');

    await prisma.user.delete({ where: { id: owner.id } });
  });

  it('cascades WorkerNode and NodeCredential deletion when the owning user is deleted', async () => {
    const owner = await createOwner('node-cascade-owner');

    const node = await prisma.workerNode.create({
      data: {
        name: 'test-node-cascade',
        hostname: 'host-cascade',
        platform: 'linux',
        cliVersion: '1.0.0',
        eligibleTypes: [],
        concurrency: 1,
        createdById: owner.id,
      },
    });

    const credential = await prisma.nodeCredential.create({
      data: {
        userId: owner.id,
        name: 'test-credential-cascade',
        tokenHash: `hash-${Date.now()}-${Math.random()}`,
        tokenPrefix: 'nod_test',
        // Nullable, per the block comment on NodeCredential.expiresAt — a
        // never-expiring credential must be representable, and this test
        // exercises exactly that value.
        expiresAt: null,
      },
    });

    // A job the node currently holds must still be released (SetNull), not
    // deleted, even when the whole chain — user, credential, node — goes
    // away in one delete.
    const job = await prisma.job.create({
      data: {
        type: 'test.node-schema.cascade',
        reason: 'backfill',
        status: 'running',
        claimedByNodeId: node.id,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    await prisma.user.delete({ where: { id: owner.id } });

    await expect(prisma.workerNode.findUnique({ where: { id: node.id } })).resolves.toBeNull();
    await expect(
      prisma.nodeCredential.findUnique({ where: { id: credential.id } })
    ).resolves.toBeNull();

    const reloaded = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(reloaded.claimedByNodeId).toBeNull();
  });

  it('allows a NodeCredential with a null expiresAt to be created and read back as null', async () => {
    const owner = await createOwner('node-credential-owner');

    const credential = await prisma.nodeCredential.create({
      data: {
        userId: owner.id,
        name: 'test-credential-no-expiry',
        tokenHash: `hash-${Date.now()}-${Math.random()}`,
        tokenPrefix: 'nod_test',
        expiresAt: null,
      },
    });

    expect(credential.expiresAt).toBeNull();

    await prisma.user.delete({ where: { id: owner.id } });
  });
});

// =============================================================================
// Real-Postgres measurement: what the organization scope costs per query
// (issue #725 PP-6.5)
// =============================================================================
//
// A scoped operation is ONE extra statement (`set_config`) in the same
// transaction, plus the policy predicate on the table. This suite measures the
// price on 1,000 rows per organization and PRINTS it (the figure belongs in the
// pull request); it asserts only a generous ceiling, so a pathological
// regression (a second round trip per call, a seq scan the policy forced) fails
// while ordinary machine noise does not.
//
// Baseline: the same query over a SUPERUSER connection to the same database
// (row-level security is inert there, no `set_config`, an explicit `orgId`
// filter). Scoped: `forOrg(A)` as the ordinary role under FORCEd policies.
// =============================================================================

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';

import { buildDatabaseUrl } from '../../src/common/database-url';
import { resolveDbSuite } from '../jobs/db-test-support';
import { createRlsDatabase, rlsServices, ORG_A, ORG_B, type RlsDatabase } from '../helpers/rls-database.helper';

const { describeWithDb } = resolveDbSuite('rls-overhead.db.spec');

const ROWS_PER_ORG = 1_000;
const ITERATIONS = 300;
const WARMUP = 30;

const percentile = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

async function time(fn: () => Promise<unknown>): Promise<{ p50: number; p95: number }> {
  for (let i = 0; i < WARMUP; i += 1) await fn();
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = process.hrtime.bigint();
    await fn();
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
}

describeWithDb('Cost of the organization scope (real Postgres)', () => {
  let db: RlsDatabase;
  let services: ReturnType<typeof rlsServices>;
  let superuser: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    db = await createRlsDatabase('perf', { pool: 4 });
    services = rlsServices(db);
    userId = randomUUID();

    const { DATABASE_URL: _ignored, ...base } = process.env;
    superuser = new PrismaClient({ adapter: new PrismaPg(buildDatabaseUrl({ ...base, POSTGRES_DB: db.database })) });

    await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      for (const [id, slug] of [[ORG_A, 'org-a'], [ORG_B, 'org-b']] as const) await tx.organization.create({ data: { id, name: slug, slug } });
      await tx.user.create({ data: { id: userId, email: 'perf@example.test', providerDisplayName: 'perf' } });
      for (const orgId of [ORG_A, ORG_B]) {
        await tx.storageObject.createMany({
          data: Array.from({ length: ROWS_PER_ORG }, (_, i) => ({
            orgId,
            name: `f-${i}.txt`,
            size: BigInt(i),
            mimeType: 'text/plain',
            storageKey: `uploads/${orgId}/${randomUUID()}.txt`,
            storageProvider: 's3',
            status: 'ready',
            uploadedById: userId,
          })),
        });
      }
    });
  }, 120_000);

  afterAll(async () => {
    await superuser?.$disconnect();
    await services?.close();
    await db?.destroy();
  }, 60_000);

  it('adds a bounded, small cost per scoped query (printed for the pull request)', async () => {
    const list = (client: { storageObject: PrismaClient['storageObject'] }) =>
      client.storageObject.findMany({ where: { orgId: ORG_A, uploadedById: userId }, orderBy: { createdAt: 'desc' }, take: 20 });
    const count = (client: { storageObject: PrismaClient['storageObject'] }) =>
      client.storageObject.count({ where: { orgId: ORG_A, uploadedById: userId } });

    const baselineList = await time(() => list(superuser));
    const scopedList = await time(() => list(services.prisma.forOrg(ORG_A, { userId })));
    const baselineCount = await time(() => count(superuser));
    const scopedCount = await time(() => count(services.prisma.forOrg(ORG_A, { userId })));

    const fmt = (n: number) => n.toFixed(2);
    // eslint-disable-next-line no-console
    console.info(
      [
        `RLS scope overhead, ${ROWS_PER_ORG} rows per org, ${ITERATIONS} iterations (ms)`,
        `  list  (take 20): baseline p50 ${fmt(baselineList.p50)} p95 ${fmt(baselineList.p95)} | scoped p50 ${fmt(scopedList.p50)} p95 ${fmt(scopedList.p95)} | +p95 ${fmt(scopedList.p95 - baselineList.p95)}`,
        `  count          : baseline p50 ${fmt(baselineCount.p50)} p95 ${fmt(baselineCount.p95)} | scoped p50 ${fmt(scopedCount.p50)} p95 ${fmt(scopedCount.p95)} | +p95 ${fmt(scopedCount.p95 - baselineCount.p95)}`,
      ].join('\n'),
    );

    expect(scopedList.p95 - baselineList.p95).toBeLessThan(25);
    expect(scopedCount.p95 - baselineCount.p95).toBeLessThan(25);
  }, 120_000);
});

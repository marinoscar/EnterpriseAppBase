// =============================================================================
// Real-Postgres test: the database, not the service, is the single-active-run
// arbiter (issue #281, epic #254)
// =============================================================================
//
// `database_backup_runs_active_uniq_idx` is a PARTIAL UNIQUE index — a UNIQUE
// on `status` restricted to `status IN ('pending','running')` — and the Prisma
// schema language cannot express it. It exists only in
// `prisma/migrations/20260907120000_add_database_backup_runs/migration.sql`,
// written by hand, so nothing in `schema.prisma` proves it is applied and
// `prisma migrate diff` will actively want to drop it. The only way to know it
// is really there, and really doing what the comments claim, is to ask a real
// Postgres.
//
// AND THE CLAIM IT BACKS IS NOT A CLAIM A MOCK CAN TEST. `db-backup-runner
// .service.spec.ts` proves that a P2002 BECOMES a
// `DatabaseBackupAlreadyRunningError` — but it proves that by handing the
// service a P2002 it constructed itself. Whether Postgres actually raises one
// when two replicas insert an active run in the same instant is a property of
// the SQL, and a service that had quietly grown a
// `findFirst`-then-`create` would pass every mocked test in this repository
// and would start two concurrent `pg_dump` processes the first time a
// scheduled tick and an administrator's click landed in the same millisecond —
// in production, streaming into one storage key, producing an archive that
// restores nothing and reports no error.
//
// So the two racers here are two INDEPENDENT `PrismaClient`s with their own
// connection pools, which is as close to "two replicas" as one process gets.
//
// THIS IS A `*.db.spec.ts` FILE, excluded from `npm test` and run by
// `npm run test:db` (CI's `smoke` job, after `prisma:migrate` — the migration
// has to have actually run for this index to exist). See
// `../../test/jobs/db-test-support.ts`.
// =============================================================================

import { PrismaClient } from '@prisma/client';

import { createDbClient, resolveDbSuite } from '../../test/jobs/db-test-support';
import { ACTIVE_RUN_INDEX_NAME } from './db-backup-runner.service';

const { describeWithDb } = resolveDbSuite('db-backup-active-index.db.spec');

describeWithDb('The single-active-run index (real Postgres)', () => {
  let a: PrismaClient;
  let b: PrismaClient;

  /**
   * Every row this suite creates carries this marker in `bucket`, so cleanup
   * deletes only its own — the same discipline the queue's real-Postgres
   * suites use with a `type` prefix. A backup run table in a shared CI
   * database may legitimately hold rows this suite did not write.
   */
  const MARKER = `test.backup-index.${process.pid}`;

  /** A minimally valid run row; `status` and `storageKey` are per-test. */
  const row = (status: 'pending' | 'running' | 'completed' | 'failed' | 'stale', key: string) => ({
    status,
    trigger: 'manual' as const,
    storageProvider: 'test',
    storageKey: `${MARKER}/${key}`,
    bucket: MARKER,
    format: 'custom',
  });

  const cleanup = async (): Promise<void> => {
    await a?.databaseBackupRun.deleteMany({ where: { bucket: MARKER } });
  };

  beforeAll(async () => {
    a = createDbClient();
    b = createDbClient();
    await Promise.all([a.$connect(), b.$connect()]);
  });

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await Promise.all([a?.$disconnect(), b?.$disconnect()]);
  });

  it('is actually applied, as a UNIQUE partial index with the documented predicate', async () => {
    const rows = await a.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'database_backup_runs' AND indexname = ${ACTIVE_RUN_INDEX_NAME}
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('UNIQUE INDEX');
    expect(rows[0].indexdef).toContain('WHERE');
    expect(rows[0].indexdef).toContain('pending');
    expect(rows[0].indexdef).toContain('running');
  });

  it('lets exactly ONE of two concurrent active inserts succeed', async () => {
    // THE DETERMINISTIC FORM: two simultaneous inserts, repeated. Exactly one
    // side wins every round — no sampling, no "very likely".
    for (let round = 0; round < 10; round += 1) {
      const results = await Promise.allSettled([
        a.databaseBackupRun.create({ data: row('running', `a-${round}`) }),
        b.databaseBackupRun.create({ data: row('running', `b-${round}`) }),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // And it is THIS constraint that refused, not some incidental one.
      const error = (rejected[0] as PromiseRejectedResult).reason as { code?: string };
      expect(error.code).toBe('P2002');

      await cleanup();
    }
  });

  it('refuses a second active run even when the first is already committed', async () => {
    await a.databaseBackupRun.create({ data: row('running', 'first') });

    await expect(
      b.databaseBackupRun.create({ data: row('running', 'second') })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('frees the slot as soon as the holder settles', async () => {
    // The predicate is what makes the guard temporary rather than permanent: a
    // completed run drops out of the index, and tomorrow's backup can start.
    const first = await a.databaseBackupRun.create({ data: row('running', 'settling') });

    await a.databaseBackupRun.update({
      where: { id: first.id },
      data: { status: 'completed' },
    });

    const second = await b.databaseBackupRun.create({ data: row('running', 'after') });
    expect(second.status).toBe('running');
  });

  it('does not constrain SETTLED runs — any number may coexist', async () => {
    // Otherwise the table could hold one backup, ever.
    await a.databaseBackupRun.createMany({
      data: [
        row('completed', 'c1'),
        row('completed', 'c2'),
        row('failed', 'f1'),
        row('failed', 'f2'),
        row('stale', 's1'),
        row('stale', 's2'),
      ],
    });

    const count = await a.databaseBackupRun.count({ where: { bucket: MARKER } });
    expect(count).toBe(6);
  });
});

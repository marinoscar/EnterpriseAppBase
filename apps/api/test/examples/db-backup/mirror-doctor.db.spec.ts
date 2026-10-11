// =============================================================================
// Real-Postgres test: the mirror results the engine records and the
// `backup.mirrors` Doctor check reads (PP-14.12)
// =============================================================================
//
// A mirror copy's outcome is an `audit_events` row (`db_backup.mirror.completed`
// or `.failed`, `target_type = 'database_backup_run'`, `target_id` the run, the
// result in the JSONB `meta`), and the Doctor check reads the newest few hundred
// of them with one `findMany` and takes the first row it sees per `meta.targetId`.
// A mocked Prisma returns whatever the test hands it, so it cannot prove that the
// runner's `meta` round-trips through the real JSONB column under the key the
// check reads (`targetId`, `error`), that `action IN (...)` plus `ORDER BY
// created_at DESC` returns the newest first, or that a row written with a past
// `created_at` is ordered by it. Only a real database can, so this is a
// `*.db.spec.ts` file, run only via `npm run test:db`.
//
// ⚠ AUTHORED WITHOUT A POSTGRES TO RUN IT AGAINST. It compiles (the API
// typecheck covers it) and follows `db-backup-run-job-link.db.spec.ts`; CI's
// real-database tier is the first place it executes.
// =============================================================================

import { PrismaClient } from '@prisma/client';

import { BackupMirrorsDoctorCheck } from '@marinoscar/platform-api/db-backup/testing';
import { DoctorCheckRegistry } from '@marinoscar/platform-api/doctor';

import { createDbClient, resolveDbSuite } from '../../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('mirror-doctor.db.spec');

describeWithDb('backup.mirrors over audit_events (real Postgres)', () => {
  let prisma: PrismaClient;

  /** Every row this suite writes carries the marker in `target_type`, so cleanup removes only its own. */
  const MARKER = `test.mirror-doctor.${process.pid}`;
  const RUN_ID = '11111111-1111-4111-8111-111111111111';
  /** Mirror ids are unique to this process, so rows from a shared database cannot interfere. */
  const id = (name: string) => `${name}-${process.pid}`;

  const audit = (action: string, targetId: string, secondsAgo: number, extra: Record<string, unknown> = {}) =>
    prisma.auditEvent.create({
      data: {
        action,
        targetType: MARKER,
        targetId: RUN_ID,
        meta: { targetId, status: action.endsWith('failed') ? 'failed' : 'ok', sizeBytes: 10, ...extra },
        createdAt: new Date(Date.now() - secondsAgo * 1000),
      },
    });

  const check = (...ids: string[]) =>
    new BackupMirrorsDoctorCheck(
      new DoctorCheckRegistry(),
      prisma as never,
      ids.map((id) => ({ id }) as never),
    );

  beforeAll(async () => {
    prisma = createDbClient();
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma?.auditEvent.deleteMany({ where: { targetType: MARKER } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // The check filters on the real action names; rows of this suite use them with a marker target type.
  it('takes the NEWEST result per mirror: an old failure followed by a success passes', async () => {
    await audit('db_backup.mirror.failed', id('cold'), 3600, { error: 'old outage' });
    await audit('db_backup.mirror.completed', id('cold'), 60);

    const outcome = await check(id('cold')).run();

    expect(outcome.status).toBe('pass');
  });

  it('warns for a mirror whose newest result is a failure, carrying the stored error', async () => {
    await audit('db_backup.mirror.completed', id('cold'), 3600);
    await audit('db_backup.mirror.failed', id('cold'), 60, { error: 'cold store unreachable' });
    await audit('db_backup.mirror.completed', id('local-dir'), 30);

    const outcome = await check(id('cold'), id('local-dir')).run();

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain(`"${id('cold')}"`);
    expect(outcome.error).toBe('cold store unreachable');
  });

  it('warns for a configured mirror with no result yet, and ignores a retired mirror\'s rows', async () => {
    await audit('db_backup.mirror.failed', id('retired'), 60, { error: 'gone' });

    const outcome = await check(id('new-mirror')).run();

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain(`No copy to "${id('new-mirror')}"`);
  });
});

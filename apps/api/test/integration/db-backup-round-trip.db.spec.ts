// =============================================================================
// Real-Postgres test: a genuine `pg_dump` round trip through the streaming
// backup engine (issue #290, epic #254, Phase 8)
// =============================================================================
//
// EVIDENCE FOR EPIC #254'S SUCCESS CRITERION 10: a backup marked `completed`
// is provably an archive `pg_restore` can read, not merely a row that says
// so.
//
// `db-backup-runner.service.spec.ts` proves the ORCHESTRATION — the ordering
// of the heartbeat, the metering transform, the two-way `Promise.all`, the
// failure/verify/prune sequencing — against a `DatabaseBackupEngine` double
// that never spawns a real process. `db-backup-active-index.db.spec.ts`
// proves the single-active-run INDEX against real Postgres, with two real
// connections racing an insert. NEITHER runs a real `pg_dump`. This suite is
// the one that does: `DatabaseBackupRunnerService` is constructed with its
// REAL engine (`systemDatabaseBackupEngine` — actual `pg_dump -Fc`, actual
// `pg_restore --list`) and a storage provider that genuinely streams to
// local disk (`TmpDirStorageProvider`), and it backs up THIS suite's own
// reachable database.
//
// ⚠ IT NOW DRIVES THROUGH THE QUEUE, NOT AROUND IT (issue #351, epic #345).
// The dump is a `db.backup.run` job, so proving "a backup completes" by
// calling the runner directly would prove it about a path production no
// longer takes. Every backup in this file goes enqueue → REAL claim
// (`JobClaimService`, `FOR UPDATE SKIP LOCKED`, `attempts` charged, the lease
// derived from the handler's own six-hour profile) → the REAL handler →
// REAL settle (`JobTerminalService`). The only piece deliberately left out is
// `JobWorker`'s poll timer, which is a loop around exactly the two calls this
// file makes by hand and which `job.worker.spec.ts` already owns.
//
// THE ASSERTION THAT MATTERS IS NOT `status === 'completed'`. Asserting only
// that proves the bookkeeping — see this file's own runner's header, "VERIFY
// WHAT ARRIVED, NOT WHAT WE SENT". This suite additionally, and
// INDEPENDENTLY of the runner's own verification, downloads the stored
// object back out of the tmp-dir provider and runs `pg_restore --list` over
// it itself, and recomputes its sha256 and compares it to what the row
// recorded — so a runner that flipped `completed` without ever truly
// checking would still be caught here even if its own internal check were
// deleted.
//
// A REAL `pg_dump` OF THIS SUITE'S OWN DATABASE IS SAFE: `pg_dump` never
// writes to the database it reads. Nothing in this file creates, drops or
// renames anything at the database level — see
// `database-restore-round-trip.db.spec.ts` for the suite that does, and for
// why THAT one needs a throwaway database instead.
//
// THIS IS A `*.db.spec.ts` FILE, excluded from `npm test` and run by
// `npm run test:db` (CI's `smoke` job — no new service container; see
// `docs/TESTING.md`). See `../jobs/db-test-support.ts`.
//
// MEASURED WALL CLOCK: ~1.5s for this file alone (a real `pg_dump`/
// `pg_restore --list` pair against this suite's small database). See
// `docs/TESTING.md` for the whole real-Postgres suite's budget.
// =============================================================================

import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job, PrismaClient } from '@prisma/client';

import { DEFAULT_SYSTEM_SETTINGS } from '../../src/common/types/settings.types';
import {
  BACKUP_JOB_TYPE,
  DatabaseBackupRunnerService,
  type DatabaseBackupEngine,
} from '../../src/db-backup/db-backup-runner.service';
import { DatabaseBackupAlreadyRunningError } from '../../src/db-backup/db-backup.errors';
import { DatabaseBackupRunHandler } from '../../src/db-backup/handlers/db-backup-run.handler';
import { buildClaimLeases } from '../../src/jobs/job-execution-profile';
import { JobClaimService } from '../../src/jobs/job-claim.service';
import { JobHandlerRegistry } from '../../src/jobs/job-handler.registry';
import { JobTerminalService } from '../../src/jobs/job-terminal.service';
import { JobsService } from '../../src/jobs/jobs.service';
import { ProviderThrottleService } from '../../src/jobs/provider-throttle.service';
import { spawnPgDump } from '../../src/db-backup/pg-dump.util';
import { readTocEntryCount } from '../../src/db-backup/pg-restore.util';
import { PgJobRoleBroker } from '../../src/db-backup/pg-job-role.broker';
import { checkPgClientVersion, readServerVersionNumWithPgClient } from '../../src/db-backup/pg-version.util';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { DatabaseBackupRetentionService } from '../../src/db-backup/db-backup-retention.service';
import type { NotificationsService } from '../../src/notifications/notifications.service';
import type { SystemSettingsService } from '../../src/settings/system-settings/system-settings.service';
import { cleanupTmpDir, TmpDirStorageProvider } from '../helpers/tmp-storage-provider.helper';
import { createDbClient, resolveDbSuite } from '../jobs/db-test-support';

/**
 * The real engine, but pointed at `POSTGRES_*` with `DATABASE_URL` stripped —
 * the same discipline `db-test-support.ts`'s `createDbClient` documents at
 * length: `test/setup.ts` loads `.env.test`, which hard-codes a
 * `DATABASE_URL` for the port-5433 compose test database, and it would win
 * over the `POSTGRES_*` variables the reachability probe just verified.
 * `systemDatabaseBackupEngine` itself has no `env` seam (production always
 * spawns against `process.env`, deliberately — see its own file), so this
 * suite builds the equivalent engine with the override applied.
 */
function realEngineWithoutDatabaseUrl(): DatabaseBackupEngine {
  const { DATABASE_URL: _ignored, ...env } = process.env;

  return {
    startDump: ({ compressionLevel, timeoutMs }) => spawnPgDump({ compressionLevel, timeoutMs, env }),
    readTocEntryCount: (source) => readTocEntryCount({ source }),
    checkClientVersion: () =>
      checkPgClientVersion({ readServerVersionNum: () => readServerVersionNumWithPgClient({ env }) }),
  };
}

const { describeWithDb } = resolveDbSuite('db-backup-round-trip.db.spec');

describeWithDb('A real pg_dump round trip through the backup engine', () => {
  let prisma: PrismaClient;
  let baseDir: string;
  let storage: TmpDirStorageProvider;
  let runner: DatabaseBackupRunnerService;
  let claimer: JobClaimService;
  let terminal: JobTerminalService;
  let registry: JobHandlerRegistry;
  let config: ConfigService;

  /** Every backup run this suite creates, so cleanup is exact and exhaustive. */
  const createdRunIds: string[] = [];
  /** Every `db.backup.run` job it queued, likewise. */
  const createdJobIds: string[] = [];

  beforeAll(async () => {
    prisma = createDbClient();
    await prisma.$connect();

    baseDir = join(tmpdir(), `db-backup-round-trip-${process.pid}-${randomUUID()}`);
    storage = new TmpDirStorageProvider(baseDir);

    const settings = {
      getDatabaseBackupPolicy: async () => DEFAULT_SYSTEM_SETTINGS.databaseBackup,
    } as unknown as SystemSettingsService;

    // Retention is STUBBED, deliberately: the real service prunes by count
    // across EVERY `completed` row in `database_backup_runs`, which in a
    // database shared with the other `*.db.spec.ts` suites (and, locally, a
    // developer's own data) could delete a backup this suite did not create.
    // What is under test here is the dump/upload/verify path, not retention
    // — `db-backup-retention.service.spec.ts` already owns that.
    const retention = {
      prune: async () => ({ prunedByCount: 0, prunedByAge: 0 }),
    } as unknown as DatabaseBackupRetentionService;

    const notifications = {
      notifyPermissionHolders: async () => undefined,
    } as unknown as NotificationsService;

    // The deployment-wide job defaults. Nothing here should govern
    // `db.backup.run` — the handler's own profile does — and the assertions
    // below say so.
    config = {
      get: (key: string) =>
        key === 'jobs.maxAttempts' ? 3 : key === 'jobs.jobTimeoutMs' ? 600_000 : undefined,
    } as unknown as ConfigService;

    // ⚠ THE REAL QUEUE, NOT A DOUBLE. #351 made the dump a `db.backup.run`
    // job, and a suite that kept calling the runner directly would still pass
    // while proving nothing about the path production now takes: the enqueue,
    // the claim, the handler, the settle. All four are real here, against real
    // Postgres, and only the CLOCK of the worker's poll loop is missing —
    // `JobWorker` itself is a timer around exactly the two calls this file
    // makes by hand.
    const jobs = new JobsService(prisma as unknown as PrismaService);

    runner = new DatabaseBackupRunnerService(
      prisma as unknown as PrismaService,
      settings,
      storage,
      retention,
      notifications,
      config,
      jobs,
      // The REAL engine (real `pg_dump`, real `pg_restore --list`) — see
      // `realEngineWithoutDatabaseUrl`'s own comment for why the `env`
      // override is the only thing that differs from production's.
      realEngineWithoutDatabaseUrl()
      // No timers override: the real (unref'd) heartbeat timer.
    );

    registry = new JobHandlerRegistry();
    // ⚠ THE REAL BROKER, AND IT IS NEVER CALLED ON THIS PATH (#350). A
    // `db.backup.run` claimed by THIS process dumps with the application's own
    // credentials; the broker exists for a REMOTE executor, which reaches it
    // through `POST /api/nodes/:id/jobs/:jobId/secret` and not through
    // `process()`. Passing the real one rather than a double is the cheaper
    // honesty: if `process()` ever grew a call to it, this suite would mint a
    // role against the real cluster instead of quietly satisfying a stub.
    // Its cluster behaviour is `src/db-backup/pg-job-role.broker.db.spec.ts`.
    new DatabaseBackupRunHandler(registry, runner, new PgJobRoleBroker()).onModuleInit();

    claimer = new JobClaimService(prisma as unknown as PrismaService);
    terminal = new JobTerminalService(
      prisma as unknown as PrismaService,
      config,
      new ProviderThrottleService(config),
      new EventEmitter2(),
      registry
    );
  });

  afterEach(async () => {
    if (createdRunIds.length > 0) {
      await prisma.databaseBackupRun.deleteMany({ where: { id: { in: createdRunIds } } });
      createdRunIds.length = 0;
    }

    // AFTER the runs, always: `job_id` is `onDelete: SetNull`, so deleting a
    // job first would silently unlink a run row this suite still means to
    // assert on.
    if (createdJobIds.length > 0) {
      await prisma.job.deleteMany({ where: { id: { in: createdJobIds } } });
      createdJobIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await cleanupTmpDir(baseDir);
  });

  /** Polls a run's row until it leaves `pending`/`running`, or times out. */
  async function awaitSettled(runId: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const row = await prisma.databaseBackupRun.findUniqueOrThrow({ where: { id: runId } });

      if (row.status !== 'pending' && row.status !== 'running') return row;
      if (Date.now() >= deadline) {
        throw new Error(`Backup run ${runId} did not settle within ${timeoutMs}ms (still ${row.status}).`);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * The whole production path for one backup: enqueue, claim, run, settle.
   *
   * ⚠ THE CLAIM IS THE REAL ONE (`FOR UPDATE SKIP LOCKED`, `attempts`
   * incremented, the lease applied from the type's own profile), and the
   * settle is the real `JobTerminalService`. What is NOT here is `JobWorker`'s
   * poll timer, which is the only part of the worker this file would be
   * testing twice — `job.worker.spec.ts` owns it.
   */
  async function takeQueuedBackup(): Promise<{ job: Job; runId: string }> {
    const queued = await runner.queueBackup({ trigger: 'manual', createdById: null });
    createdRunIds.push(queued.run.id);
    createdJobIds.push(queued.job.id);

    // Queued, and nothing has started: the run row does not claim a `pg_dump`
    // exists before one does.
    expect(queued.run.status).toBe('pending');
    expect(queued.run.startedAt).toBeNull();
    expect(queued.job.type).toBe(BACKUP_JOB_TYPE);

    const [claimed] = await claimer.claim({
      nodeId: null,
      executor: 'server',
      eligibleTypes: [BACKUP_JOB_TYPE],
      limit: 1,
      leases: buildClaimLeases(config, registry, [BACKUP_JOB_TYPE]),
    });

    expect(claimed?.id).toBe(queued.job.id);
    // ⚠ THE LEASE IS THE PROFILE'S, NOT THE DEPLOYMENT DEFAULT'S. This is the
    // objection that used to make a backup unsafe as a queue job: a 30-minute
    // reaper deadline over a multi-hour dump. The claim's lease must sit past
    // the six-hour ceiling, not past ten minutes.
    const leaseMs = (claimed.leaseExpiresAt as Date).getTime() - Date.now();
    expect(leaseMs).toBeGreaterThan(6 * 60 * 60 * 1000);

    const handler = registry.get(BACKUP_JOB_TYPE);
    expect(handler).toBeDefined();

    await handler!.process(claimed);

    // ⚠ THE ASSERTION #351 EXISTS FOR, AND THE ONE A THIN WRAPPER WOULD FAIL.
    // `process()` has RETURNED, and the run is ALREADY `completed` and already
    // verified — the job's lifetime is the dump's lifetime, so there is no
    // window in which a `succeeded` job describes a dump still streaming.
    const onReturn = await prisma.databaseBackupRun.findUniqueOrThrow({
      where: { id: queued.run.id },
    });
    expect(onReturn.status).toBe('completed');
    expect(onReturn.verifiedAt).not.toBeNull();

    await terminal.completeSucceeded(claimed);

    return { job: claimed, runId: queued.run.id };
  }

  it('produces a `completed` run whose stored object is a real, independently-verifiable archive', async () => {
    const { job, runId } = await takeQueuedBackup();

    const settled = await awaitSettled(runId);

    // The two rows, and the link between them. `job_id` is what lets a run
    // found in this table be traced back to who asked for it and which attempt
    // produced it; `succeeded` is what makes the backup visible in
    // `GET /api/admin/jobs` and in insights at all.
    expect(settled.jobId).toBe(job.id);
    const settledJob = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(settledJob.status).toBe('succeeded');
    // One attempt, charged at claim time, and never a second one.
    expect(settledJob.attempts).toBe(1);

    // --- The bookkeeping half ------------------------------------------------
    expect(settled.status).toBe('completed');
    expect(settled.checksumSha256).not.toBeNull();
    expect(settled.verifiedAt).not.toBeNull();
    expect(settled.sizeBytes).toBeGreaterThan(0n);
    expect(settled.lastError).toBeNull();

    // --- The independent half: read the object back OURSELVES, not through --
    // --- any method the runner itself calls, and prove it is a real archive -
    const downloaded = await storage.download(settled.storageKey);

    const hash = createHash('sha256');
    const chunks: Buffer[] = [];
    for await (const chunk of downloaded as AsyncIterable<Buffer>) {
      hash.update(chunk);
      chunks.push(chunk);
    }
    const recomputedSha256 = hash.digest('hex');
    const bytes = Buffer.concat(chunks);

    // The row's checksum is not merely present — it is the ACTUAL sha256 of
    // the bytes that ended up in storage, recomputed here from scratch.
    expect(recomputedSha256).toBe(settled.checksumSha256);
    expect(BigInt(bytes.length)).toBe(settled.sizeBytes);

    // And it is a readable custom-format `pg_dump` archive with a non-empty
    // table of contents — the assertion that actually distinguishes "a real
    // backup" from "a file that happens to exist at the right key". A fresh
    // stream, from a freshly re-downloaded copy: this must not reuse
    // anything the runner itself already computed.
    const redownloaded = await storage.download(settled.storageKey);
    const tocEntries = await readTocEntryCount({ source: redownloaded });
    expect(tocEntries).toBeGreaterThan(0);
  });

  it('never auto-retries a failed dump: one attempt, terminally failed, nothing rescheduled', async () => {
    // ⚠ THE THIRD OBJECTION, PROVEN AGAINST REAL POSTGRES WITH THE REAL
    // PROFILE. `JobTerminalService` reads `maxAttempts` through
    // `resolveMaxAttempts(config, registry.get(type))`, so what decides this
    // is the handler's own `maxAttempts: 1` and not the deployment default of
    // 3 that `config` above deliberately reports. A backup that failed must
    // not be re-run unattended against a database that is probably already
    // unwell; the retry is the next scheduled one.
    const queued = await runner.queueBackup({ trigger: 'manual', createdById: null });
    createdRunIds.push(queued.run.id);
    createdJobIds.push(queued.job.id);

    const [claimed] = await claimer.claim({
      nodeId: null,
      executor: 'server',
      eligibleTypes: [BACKUP_JOB_TYPE],
      limit: 1,
      leases: buildClaimLeases(config, registry, [BACKUP_JOB_TYPE]),
    });

    // The dump is not run at all here: what is under test is what the queue
    // does with a failure, and spawning a real `pg_dump` only to break it
    // would test `pg_dump`.
    await terminal.completeFailed(claimed, new Error('pg_dump exited 1'));

    const settledJob = await prisma.job.findUniqueOrThrow({ where: { id: claimed.id } });
    expect(settledJob.status).toBe('failed');
    expect(settledJob.attempts).toBe(1);
    // Not 'pending' with a backoff: `scheduled_for` is what a retry would be
    // written as, and there must not be one.
    expect(settledJob.scheduledFor).toBeNull();
    expect(settledJob.lastError).toContain('pg_dump exited 1');

    // ⚠ THE RUN ROW IS STILL `pending`, AND THAT IS A REAL STATE RATHER THAN
    // AN OVERSIGHT. This job failed before its handler ever touched the row,
    // so nothing wrote a terminal status onto it — and under the tightened
    // `database_backup_runs_active_uniq_idx` that leftover row HOLDS THE
    // SINGLE ACTIVE SLOT across `pending` and `running` combined. Both halves
    // are asserted, because the second is what the stale sweep's new `pending`
    // arm exists to resolve.
    const stranded = await prisma.databaseBackupRun.findUniqueOrThrow({
      where: { id: queued.run.id },
    });
    expect(stranded.status).toBe('pending');

    await expect(
      runner.queueBackup({ trigger: 'scheduled', createdById: null })
    ).rejects.toBeInstanceOf(DatabaseBackupAlreadyRunningError);

    // Released the way `releaseStaleRuns` releases it (aged by `createdAt`,
    // since a pending row has neither a start nor a heartbeat) — and the next
    // backup queues normally, with a fresh job under the same dedup key.
    await prisma.databaseBackupRun.update({
      where: { id: queued.run.id },
      data: { status: 'stale' },
    });

    const next = await runner.queueBackup({ trigger: 'scheduled', createdById: null });
    createdRunIds.push(next.run.id);
    createdJobIds.push(next.job.id);
    expect(next.job.id).not.toBe(claimed.id);
  });

  it('records provenance: db version, app version and the migration ledger name', async () => {
    const { runId } = await takeQueuedBackup();

    const settled = await awaitSettled(runId);

    expect(settled.status).toBe('completed');
    expect(settled.dbVersion).not.toBeNull();
    expect(settled.appVersion).not.toBeNull();
    expect(settled.migrationName).not.toBeNull();
  });
});

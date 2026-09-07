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
import { PrismaClient } from '@prisma/client';

import { DEFAULT_SYSTEM_SETTINGS } from '../../src/common/types/settings.types';
import {
  DatabaseBackupRunnerService,
  type DatabaseBackupEngine,
} from '../../src/db-backup/db-backup-runner.service';
import { spawnPgDump } from '../../src/db-backup/pg-dump.util';
import { readTocEntryCount } from '../../src/db-backup/pg-restore.util';
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

  /** Every backup run this suite creates, so cleanup is exact and exhaustive. */
  const createdRunIds: string[] = [];

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

    const config = { get: () => undefined } as unknown as ConfigService;

    runner = new DatabaseBackupRunnerService(
      prisma as unknown as PrismaService,
      settings,
      storage,
      retention,
      notifications,
      config,
      // The REAL engine (real `pg_dump`, real `pg_restore --list`) — see
      // `realEngineWithoutDatabaseUrl`'s own comment for why the `env`
      // override is the only thing that differs from production's.
      realEngineWithoutDatabaseUrl()
      // No timers override: the real (unref'd) heartbeat timer.
    );
  });

  afterEach(async () => {
    if (createdRunIds.length > 0) {
      await prisma.databaseBackupRun.deleteMany({ where: { id: { in: createdRunIds } } });
      createdRunIds.length = 0;
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

  it('produces a `completed` run whose stored object is a real, independently-verifiable archive', async () => {
    const claimed = await runner.startBackup({ trigger: 'manual', createdById: null });
    createdRunIds.push(claimed.id);

    expect(claimed.status).toBe('running');

    const settled = await awaitSettled(claimed.id);

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

  it('records provenance: db version, app version and the migration ledger name', async () => {
    const claimed = await runner.startBackup({ trigger: 'manual', createdById: null });
    createdRunIds.push(claimed.id);

    const settled = await awaitSettled(claimed.id);

    expect(settled.status).toBe('completed');
    expect(settled.dbVersion).not.toBeNull();
    expect(settled.appVersion).not.toBeNull();
    expect(settled.migrationName).not.toBeNull();
  });
});

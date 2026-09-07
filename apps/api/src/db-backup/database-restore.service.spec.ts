// =============================================================================
// The scratch-database restore and the atomic swap (issue #285, epic #254)
// =============================================================================
//
// This suite exists because the sequence it covers is the most dangerous thing
// in the repository and cannot be rehearsed anywhere else: a real restore takes
// hours, destroys a production database, and ends by killing its own process.
// Everything below drives that sequence through the injected seam, so the whole
// design — including `process.exit` — is exercised with no PostgreSQL, no
// `pg_restore` binary, and no risk to the Jest worker.
//
// The claims worth holding, in the order they matter:
//
//   1. A FAILURE AT ANY POINT BEFORE THE RENAME LEAVES THE LIVE DATABASE
//      COMPLETELY UNTOUCHED and drops the scratch database. Asserted per phase,
//      and asserted against the SQL the fake cluster actually received rather
//      than only against spies — the assertion a refactor cannot route around.
//   2. A FAILED SECOND RENAME PUTS THE ORIGINAL BACK. It is the one genuinely
//      dangerous moment in the design and it has two tests: one where the
//      recovery works, one where it does not.
//   3. THE CATALOG SURVIVES THE SWAP — this restore's own record, every backup
//      newer than the archive, user FKs through a subselect, the self-FK in a
//      second pass.
//   4. THE MAINTENANCE WINDOW IS OPENED IN MEMORY WITH `allowAdmins: false`.
//      The persisted flag lives inside the database being renamed.
//   5. THE ARCHIVE IS RE-VERIFIED AGAINST THE BYTES AS THEY ARE NOW, and a
//      corrupt one fails before anything is created.
// =============================================================================

import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { DatabaseBackupRun } from '@prisma/client';

import type { MaintenanceModeService } from '../common/maintenance/maintenance-mode.service';
import type { SystemDatabaseBackupValue } from '../common/schemas/settings.schema';
import { JOB_TEMP_PREFIX } from '../jobs/job-temp';
import type { PrismaService } from '../prisma/prisma.service';
import type { SystemSettingsService } from '../settings/system-settings/system-settings.service';
import type { StorageProvider } from '../storage/providers/storage-provider.interface';
import type { AdminConnection, AdminQueryClient } from './admin-connection.util';
import {
  DatabaseRestoreService,
  RESTORE_AUDIT_COMPLETE,
  RESTORE_AUDIT_FAILED,
  RESTORE_AUDIT_ROLLBACK,
  RESTORE_AUDIT_START,
  RESTORE_AUDIT_SWAP,
  RESTORE_JOBS,
  defaultDatabaseRestoreSeam,
  type DatabaseRestoreSeam,
} from './database-restore.service';
import type { DatabaseBackupRunnerService } from './db-backup-runner.service';
import { DatabaseRestoreSwapError } from './db-backup.errors';
import type {
  DatabaseRestorePreflightService,
  RestorePreflightResult,
} from './restore-preflight.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-09-07T12:00:00.000Z');
const LIVE = 'appdb';
const SCRATCH = 'appdb_restore_20260907T120000Z';
const OLD = 'appdb_old_20260907T120000Z';

const CONNECTION: AdminConnection = {
  host: '127.0.0.1',
  port: '5432',
  user: 'appuser',
  password: 'super-secret-password',
  database: 'postgres',
  sslMode: null,
  liveDatabase: LIVE,
};

const POLICY: SystemDatabaseBackupValue = {
  enabled: true,
  frequency: 'daily',
  dayOfWeek: 0,
  dayOfMonth: 1,
  timeOfDay: '02:00',
  timezone: 'UTC',
  retentionCount: 7,
  storageProvider: '',
  runStaleMinutes: 120,
  compressionLevel: 6,
  restoreRollbackMode: 'retain_database',
  oldDatabaseRetentionHours: 48,
};

/** The sha256 the fake storage's bytes actually hash to. Computed, never guessed. */
const ARCHIVE_BYTES = Buffer.from('a custom-format archive, for testing purposes');
const ARCHIVE_SHA256 = createHash('sha256').update(ARCHIVE_BYTES).digest('hex');

const ACTOR = '11111111-0000-4000-8000-000000000001';

function backupRow(overrides: Partial<DatabaseBackupRun> = {}): DatabaseBackupRun {
  return {
    id: '0d1f1c9e-0000-4000-8000-000000000285',
    status: 'completed',
    trigger: 'manual',
    startedAt: new Date('2026-09-06T02:00:00.000Z'),
    finishedAt: new Date('2026-09-06T02:10:00.000Z'),
    lastHeartbeatAt: new Date('2026-09-06T02:10:00.000Z'),
    bytesWritten: 4096n,
    sizeBytes: 4096n,
    storageProvider: 's3',
    storageKey: 'database-backups/app/2026/09/app-20260906T020000Z-run.dump',
    bucket: 'backups',
    format: 'custom',
    checksumSha256: ARCHIVE_SHA256,
    dbVersion: '16.4',
    appVersion: '1.0.0',
    migrationName: '20260907120000_add_database_backup_runs',
    verifiedAt: new Date('2026-09-06T02:10:05.000Z'),
    lastError: null,
    createdById: ACTOR,
    restoreStatus: null,
    restoreError: null,
    restoredAt: null,
    restoredById: null,
    restoreScratchDb: null,
    restoreOldDb: null,
    swappedAt: null,
    preRestoreBackupId: null,
    createdAt: new Date('2026-09-06T02:00:00.000Z'),
    updatedAt: new Date('2026-09-06T02:10:00.000Z'),
    ...overrides,
  } as DatabaseBackupRun;
}

interface PreflightOverrides {
  scratchDatabase?: string;
  oldDatabase?: string;
  effectiveRollback?: 'retain_database' | 'pre_restore_dump';
}

function okPreflight(overrides: PreflightOverrides = {}): RestorePreflightResult {
  const effective = overrides.effectiveRollback ?? 'retain_database';

  return {
    outcome: 'ok',
    runId: backupRow().id,
    targetDatabase: LIVE,
    scratchDatabase: overrides.scratchDatabase ?? SCRATCH,
    oldDatabase: overrides.oldDatabase ?? OLD,
    gates: [],
    rollback: {
      configured: effective === 'retain_database' ? 'retain_database' : 'drop_database',
      effective,
      downgraded: false,
      reason: null,
    },
    archiveMigration: backupRow().migrationName,
    liveMigration: backupRow().migrationName,
    databaseSizeBytes: '1024',
    freeDiskBytes: '999999',
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface HarnessOptions {
  /** Databases the fake cluster starts with. The live one is always there. */
  databases?: string[];
  policy?: Partial<SystemDatabaseBackupValue>;
  preflight?: RestorePreflightResult;
  /** Rows `exportCatalog` reads out of the pre-swap database. */
  catalogRows?: DatabaseBackupRun[];
  /** Bytes the storage provider hands back. Change them to corrupt the archive. */
  archiveBytes?: Buffer;
  /** Table-of-contents entries the downloaded file reports. */
  tocEntries?: number;
  /** Tables the restored database reports. Zero fails verification. */
  restoredTables?: number;
  /** Migration-ledger rows the restored database reports. */
  restoredMigrations?: number;
  /** Throws instead of downloading. */
  downloadError?: Error;
  /** Throws instead of replaying. */
  restoreError?: Error;
  /** Holds the replay open, so a test can observe a restore that is in flight. */
  restoreGate?: Promise<void>;
  /** Any statement matching this regex throws, wherever it is issued. */
  failStatement?: { pattern: RegExp; error: Error; onCall?: number };
  /** How the `pre_restore` safety backup settles. */
  preRestoreStatus?: string;
  /** Rows the retained-database sweep finds. Distinguished from the catalog read. */
  sweepRows?: Array<{ id: string; restoreOldDb: string | null; swappedAt: Date }>;
  startBackupError?: Error;
}

function makeHarness(options: HarnessOptions = {}) {
  /** `<attached database>: <statement>`, in order. The no-mutation assertions read this. */
  const sql: string[] = [];
  /** The cluster's database names. */
  const cluster = new Set<string>([LIVE, 'postgres', ...(options.databases ?? [])]);
  /** Rows the carry-over inserted, in the order it inserted them. */
  const carried: unknown[][] = [];
  const selfLinks: unknown[][] = [];
  const carriedAudit: unknown[][] = [];

  let statementFailures = 0;

  const makeClient = (attachedTo: string): AdminQueryClient => ({
    connect: jest.fn(async () => undefined),
    end: jest.fn(async () => undefined),
    query: jest.fn(async (text: string, values?: unknown[]) => {
      sql.push(`${attachedTo}: ${text}`);

      const failure = options.failStatement;
      if (failure && failure.pattern.test(text)) {
        statementFailures += 1;
        if (failure.onCall === undefined || failure.onCall === statementFailures) {
          throw failure.error;
        }
      }

      if (text.startsWith('SELECT 1 FROM pg_database')) {
        return { rows: cluster.has(String(values?.[0])) ? [{ '?column?': 1 }] : [] };
      }

      const create = /^CREATE DATABASE "([^"]+)"/.exec(text);
      if (create) {
        cluster.add(create[1]);
        return { rows: [] };
      }

      const drop = /^DROP DATABASE IF EXISTS "([^"]+)"/.exec(text);
      if (drop) {
        cluster.delete(drop[1]);
        return { rows: [] };
      }

      const rename = /^ALTER DATABASE "([^"]+)" RENAME TO "([^"]+)"/.exec(text);
      if (rename) {
        if (!cluster.has(rename[1])) {
          throw new Error(`database "${rename[1]}" does not exist`);
        }
        cluster.delete(rename[1]);
        cluster.add(rename[2]);
        return { rows: [] };
      }

      if (text.startsWith('SELECT pg_terminate_backend')) return { rows: [] };

      if (text.includes('FROM pg_class c')) {
        return { rows: [{ count: String(options.restoredTables ?? 42) }] };
      }

      if (text.includes("to_regclass('_prisma_migrations')")) {
        return { rows: [{ count: String(options.restoredMigrations ?? 7) }] };
      }

      if (text.startsWith('INSERT INTO database_backup_runs')) {
        carried.push(values ?? []);
        return { rows: [] };
      }

      if (text.startsWith('UPDATE database_backup_runs')) {
        selfLinks.push(values ?? []);
        return { rows: [] };
      }

      if (text.startsWith('INSERT INTO audit_events')) {
        carriedAudit.push(values ?? []);
        return { rows: [] };
      }

      return { rows: [] };
    }),
  });

  // --- Prisma -------------------------------------------------------------
  const stateWrites: Array<Record<string, unknown>> = [];
  const auditRows: Array<Record<string, unknown>> = [];

  const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
    stateWrites.push(data);
    return {};
  });

  // ONE mock, two callers. The sweep is the only `findMany` that filters on
  // `restoreOldDb`, which is what makes them safe to tell apart here.
  const findMany = jest.fn(async (args?: { where?: { restoreOldDb?: unknown } }) =>
    args?.where?.restoreOldDb !== undefined
      ? options.sweepRows ?? []
      : options.catalogRows ?? [backupRow()]
  );

  // Two callers, told apart by `select`: `awaitBackupSettled` asks only for a
  // status, the rollback delegation reads the whole row.
  const findUnique = jest.fn(
    async ({ where, select }: { where: { id: string }; select?: unknown }) =>
      select === undefined
        ? backupRow({ id: where.id, trigger: 'pre_restore' })
        : { status: options.preRestoreStatus ?? 'completed' }
  );

  const auditCreate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
    auditRows.push(data);
    return {};
  });

  const disconnect = jest.fn(async () => undefined);

  const prisma = {
    databaseBackupRun: { update, findMany, findUnique },
    auditEvent: { create: auditCreate },
    $disconnect: disconnect,
  } as unknown as PrismaService;

  // --- Collaborators -------------------------------------------------------
  const policy = { ...POLICY, ...options.policy };

  const settings = {
    getDatabaseBackupPolicy: jest.fn(async () => policy),
  } as unknown as SystemSettingsService;

  const download = jest.fn(async () => {
    if (options.downloadError) throw options.downloadError;
    return Readable.from([options.archiveBytes ?? ARCHIVE_BYTES]);
  });

  const storage = { download } as unknown as StorageProvider;

  const check = jest.fn(async () => options.preflight ?? okPreflight());
  const preflight = { check } as unknown as DatabaseRestorePreflightService;

  const startBackup = jest.fn(async () => {
    if (options.startBackupError) throw options.startBackupError;
    return { id: 'pre-restore-run' } as DatabaseBackupRun;
  });

  const runner = { startBackup } as unknown as DatabaseBackupRunnerService;

  const setInMemoryOverride = jest.fn();
  const maintenance = { setInMemoryOverride } as unknown as MaintenanceModeService;

  // --- Seam ----------------------------------------------------------------
  const removed: string[] = [];
  const exitProcess = jest.fn();
  const runPgRestore = jest.fn(async () => {
    if (options.restoreGate) await options.restoreGate;
    if (options.restoreError) throw options.restoreError;
  });
  const writeArchiveToFile = jest.fn(async (source: Readable) => {
    const chunks: Buffer[] = [];
    for await (const chunk of source) chunks.push(Buffer.from(chunk as Buffer));
    const bytes = Buffer.concat(chunks);

    return {
      bytes: BigInt(bytes.length),
      // Hashed from what actually arrived — the whole point of the check.
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });

  const seam: DatabaseRestoreSeam = {
    resolveConnection: () => CONNECTION,
    withAdminConnection: (config, fn) => fn(makeClient(config.database)),
    tempFilePath: () => `/tmp/${JOB_TEMP_PREFIX}restore-test.dump`,
    writeArchiveToFile,
    readTocEntryCount: jest.fn(async () => options.tocEntries ?? 250),
    runPgRestore,
    removeFile: jest.fn(async (path: string) => {
      removed.push(path);
    }),
    sleep: jest.fn(async () => undefined),
    now: () => NOW,
    exitProcess,
  };

  const service = new DatabaseRestoreService(
    prisma,
    settings,
    storage,
    preflight,
    runner,
    maintenance,
    seam
  );

  return {
    service,
    seam,
    sql,
    cluster,
    carried,
    selfLinks,
    carriedAudit,
    stateWrites,
    auditRows,
    removed,
    exitProcess,
    setInMemoryOverride,
    runPgRestore,
    writeArchiveToFile,
    download,
    startBackup,
    check,
    disconnect,
    update,
    /** Every statement, without the attachment prefix. */
    statements: () => sql.map((line) => line.slice(line.indexOf(': ') + 2)),
    /** The restore's terminal state write, if there was one. */
    finalStatus: () => {
      const withStatus = stateWrites.filter((write) => 'restoreStatus' in write);
      return withStatus.length === 0
        ? undefined
        : (withStatus[withStatus.length - 1].restoreStatus as string);
    },
    /** Every audit action written through Prisma (i.e. pre-swap), in order. */
    auditActions: () => auditRows.map((row) => row.action as string),
    /** The `where` the last `findMany` was given. */
    findManyArgs: () => findMany.mock.calls[findMany.mock.calls.length - 1]?.[0],
  };
}

type Harness = ReturnType<typeof makeHarness>;

/** Drives a restore to completion (or failure) and returns the start verdict. */
async function runRestore(h: Harness, run = backupRow()) {
  const result = await h.service.startRestore(run, { actorUserId: ACTOR });

  await waitFor(
    () => h.exitProcess.mock.calls.length > 0 || h.finalStatus() === 'failed',
    'the restore to settle'
  );

  return result;
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }

  throw new Error(`timed out waiting for: ${label}`);
}

/** Every `ALTER DATABASE ... RENAME` the cluster saw. */
function renames(h: Harness): string[] {
  return h.statements().filter((text) => /^ALTER DATABASE/.test(text));
}

beforeAll(() => {
  // These paths log warnings and errors on purpose; the suite asserts behaviour,
  // not console noise.
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

// ===========================================================================
describe('the happy path', () => {
  it('restores into a scratch database, verifies, swaps, and exits', async () => {
    const h = makeHarness();

    const result = await runRestore(h);

    expect(result.outcome).toBe('started');

    // The whole sequence, in order, from the statements the cluster received.
    expect(h.statements().filter((s) => /^(CREATE|ALTER|DROP) DATABASE/.test(s))).toEqual([
      `CREATE DATABASE "${SCRATCH}"`,
      `ALTER DATABASE "${LIVE}" RENAME TO "${OLD}"`,
      `ALTER DATABASE "${SCRATCH}" RENAME TO "${LIVE}"`,
    ]);

    // The replay used the scratch database and the parallel path.
    expect(h.runPgRestore).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: expect.objectContaining({ database: SCRATCH }),
        jobs: RESTORE_JOBS,
      })
    );

    // `retain_database`: the displaced database is still there.
    expect(h.cluster.has(OLD)).toBe(true);
    expect(h.cluster.has(LIVE)).toBe(true);
    expect(h.cluster.has(SCRATCH)).toBe(false);

    expect(h.exitProcess).toHaveBeenCalledWith(0);
  });

  it('writes restoring -> verifying -> swapping, in that order', async () => {
    const h = makeHarness();
    await runRestore(h);

    const statuses = h.stateWrites
      .map((write) => write.restoreStatus)
      .filter((status): status is string => typeof status === 'string');

    expect(statuses).toEqual(['restoring', 'verifying', 'swapping']);
  });

  it('records the two database names before either exists', async () => {
    // A restore that dies without reaching its own `catch` still has to say
    // which names it was going to use.
    const h = makeHarness();
    await runRestore(h);

    expect(h.stateWrites[0]).toMatchObject({
      restoreStatus: 'restoring',
      restoreScratchDb: SCRATCH,
      restoreOldDb: OLD,
      restoredById: ACTOR,
      restoredAt: NOW,
    });
  });

  it('writes start and swap audit rows before the swap, and the completion row after it', async () => {
    const h = makeHarness();
    await runRestore(h);

    // Pre-swap, through Prisma, into the database about to be displaced.
    expect(h.auditActions()).toEqual([RESTORE_AUDIT_START, RESTORE_AUDIT_SWAP]);

    // Post-swap, through the raw client, into the promoted database.
    expect(h.carriedAudit).toHaveLength(1);
    expect(h.carriedAudit[0][1]).toBe(RESTORE_AUDIT_COMPLETE);
    expect(h.carriedAudit[0][3]).toBe(backupRow().id);

    const meta = JSON.parse(String(h.carriedAudit[0][4])) as Record<string, unknown>;
    expect(meta).toMatchObject({ scratchDatabase: SCRATCH, oldDatabase: OLD });
  });

  it('takes no pre-restore backup in retain_database mode', async () => {
    // The displaced database IS the way back; a full dump as well would add
    // hours to duplicate a guarantee the restore already has.
    const h = makeHarness();
    await runRestore(h);

    expect(h.startBackup).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe('the archive is re-verified against the bytes as they are now', () => {
  it('rejects a checksum mismatch BEFORE anything is created', async () => {
    const h = makeHarness({ archiveBytes: Buffer.from('these are not those bytes') });

    await runRestore(h);

    expect(h.finalStatus()).toBe('failed');
    // NOTHING was created, dropped or renamed. Asserted against the SQL.
    expect(h.statements().filter((s) => /DATABASE/.test(s))).toEqual([]);
    expect(h.cluster.has(SCRATCH)).toBe(false);
    expect(h.cluster.has(LIVE)).toBe(true);
    expect(h.runPgRestore).not.toHaveBeenCalled();
  });

  it('names both checksums so an operator can tell storage rot from the wrong object', async () => {
    const h = makeHarness({ archiveBytes: Buffer.from('these are not those bytes') });
    await runRestore(h);

    const error = String(
      h.stateWrites.filter((write) => 'restoreError' in write && write.restoreError).pop()
        ?.restoreError
    );

    expect(error).toContain(ARCHIVE_SHA256);
    expect(error).toContain('did not survive re-verification');
  });

  it('rejects an archive whose table of contents is empty', async () => {
    const h = makeHarness({ tocEntries: 0 });
    await runRestore(h);

    expect(h.finalStatus()).toBe('failed');
    expect(h.statements().filter((s) => /DATABASE/.test(s))).toEqual([]);
  });

  it('proceeds with a warning when the backup recorded no checksum at all', async () => {
    // A best-effort provenance field must not become load-bearing after the
    // fact; the table-of-contents check still runs.
    const h = makeHarness();
    await runRestore(h, backupRow({ checksumSha256: null }));

    expect(h.exitProcess).toHaveBeenCalledWith(0);
  });
});

// ===========================================================================
describe('a failure before the rename leaves the live database untouched', () => {
  /** Every phase that can fail before the first `ALTER DATABASE`. */
  const phases: Array<[string, HarnessOptions, boolean]> = [
    ['the download', { downloadError: new Error('connection reset by peer') }, false],
    ['archive verification', { tocEntries: 0 }, false],
    [
      'the pre-restore safety backup',
      {
        preflight: okPreflight({ effectiveRollback: 'pre_restore_dump' }),
        preRestoreStatus: 'failed',
      },
      false,
    ],
    [
      'CREATE DATABASE',
      { failStatement: { pattern: /^CREATE DATABASE/, error: new Error('permission denied') } },
      false,
    ],
    ['pg_restore', { restoreError: new Error('pg_restore exited with code 1') }, true],
    ['verification of the restored database', { restoredTables: 0 }, true],
    ['the migration-ledger check', { restoredMigrations: 0 }, true],
  ];

  it.each(phases)(
    'a failure in %s leaves the live database alone and drops the scratch database',
    async (_label, harnessOptions, scratchWasCreated) => {
      const h = makeHarness(harnessOptions);

      await runRestore(h);

      expect(h.finalStatus()).toBe('failed');

      // ⚠ THE ASSERTION THAT MATTERS: not one rename, on any of these paths.
      expect(renames(h)).toEqual([]);
      expect(h.cluster.has(LIVE)).toBe(true);
      expect(h.cluster.has(OLD)).toBe(false);

      // And the scratch database is gone — either never created, or dropped.
      expect(h.cluster.has(SCRATCH)).toBe(false);

      if (scratchWasCreated) {
        expect(h.statements()).toContain(`DROP DATABASE IF EXISTS "${SCRATCH}"`);
      }

      // The maintenance window was never opened: traffic never stopped.
      expect(h.setInMemoryOverride).not.toHaveBeenCalled();
      expect(h.exitProcess).not.toHaveBeenCalled();
    }
  );

  it('records the failure on the row and in the audit trail', async () => {
    const h = makeHarness({ restoreError: new Error('pg_restore exited with code 1') });
    await runRestore(h);

    expect(h.stateWrites.pop()).toMatchObject({
      restoreStatus: 'failed',
      restoreError: 'pg_restore exited with code 1',
    });
    expect(h.auditActions()).toContain(RESTORE_AUDIT_FAILED);
  });

  it('refuses to reuse a scratch database that already exists', async () => {
    // It holds another restore's half-replayed contents, and `pg_restore` would
    // happily add to them.
    const h = makeHarness({ databases: [SCRATCH] });

    await runRestore(h);

    expect(h.finalStatus()).toBe('failed');
    expect(h.runPgRestore).not.toHaveBeenCalled();
    // ⚠ AND IT IS NOT DROPPED. It belongs to whatever created it.
    expect(h.cluster.has(SCRATCH)).toBe(true);
    expect(h.statements()).not.toContain(`DROP DATABASE IF EXISTS "${SCRATCH}"`);
  });

  it('never masks the original failure when the scratch drop also fails', async () => {
    const h = makeHarness({
      restoreError: new Error('pg_restore exited with code 1'),
      failStatement: { pattern: /^DROP DATABASE/, error: new Error('being accessed by others') },
    });

    await runRestore(h);

    expect(h.stateWrites.pop()).toMatchObject({
      restoreError: 'pg_restore exited with code 1',
    });
  });
});

// ===========================================================================
describe('the pre-restore safety backup', () => {
  const dumpModePreflight = okPreflight({ effectiveRollback: 'pre_restore_dump' });

  it('is taken, awaited to completion, and linked before the swap', async () => {
    const h = makeHarness({ preflight: dumpModePreflight });

    await runRestore(h);

    expect(h.startBackup).toHaveBeenCalledWith({
      trigger: 'pre_restore',
      createdById: ACTOR,
    });

    // ⚠ AWAITED. `startBackup` returns while `pg_dump` is still streaming, and
    // swapping under an in-flight dump produces a truncated way back.
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { preRestoreBackupId: 'pre-restore-run' } })
    );
    expect(h.exitProcess).toHaveBeenCalledWith(0);
  });

  it('abandons the restore when the safety backup does not complete', async () => {
    const h = makeHarness({ preflight: dumpModePreflight, preRestoreStatus: 'failed' });

    await runRestore(h);

    expect(h.finalStatus()).toBe('failed');
    expect(renames(h)).toEqual([]);
  });

  it('drops the displaced database immediately in pre_restore_dump mode', async () => {
    // The archive is the way back here, not the displaced database, so keeping
    // a full second copy on disk would buy nothing.
    const h = makeHarness({ preflight: dumpModePreflight });

    await runRestore(h);

    expect(h.statements()).toContain(`DROP DATABASE IF EXISTS "${OLD}"`);
    expect(h.cluster.has(OLD)).toBe(false);
    expect(h.cluster.has(LIVE)).toBe(true);
  });
});

// ===========================================================================
describe('the swap', () => {
  it('opens the maintenance window in memory with allowAdmins: false', async () => {
    // The persisted flag lives INSIDE the database being renamed, and an admin
    // request during the window would reach a database that does not exist.
    const h = makeHarness();
    await runRestore(h);

    expect(h.setInMemoryOverride).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, allowAdmins: false })
    );
  });

  it('does not close the window on success — the exit is the release', async () => {
    const h = makeHarness();
    await runRestore(h);

    expect(h.setInMemoryOverride).toHaveBeenCalledTimes(1);
    expect(h.setInMemoryOverride).not.toHaveBeenCalledWith(null);
    expect(h.exitProcess).toHaveBeenCalledWith(0);
  });

  it('disconnects Prisma and terminates every other session before renaming', async () => {
    const h = makeHarness();
    await runRestore(h);

    expect(h.disconnect).toHaveBeenCalled();

    const order = h.statements();
    const terminate = order.findIndex((s) => s.startsWith('SELECT pg_terminate_backend'));
    const firstRename = order.findIndex((s) => s.startsWith('ALTER DATABASE'));

    expect(terminate).toBeGreaterThanOrEqual(0);
    expect(terminate).toBeLessThan(firstRename);
  });

  it('carries no product name into the maintenance message', async () => {
    const h = makeHarness();
    await runRestore(h);

    const override = h.setInMemoryOverride.mock.calls[0][0] as { message: string };
    expect(override.message).toMatch(/database restore/i);
    expect(override.message).not.toMatch(/appdb/i);
  });
});

// ===========================================================================
describe('THE FAILED SECOND RENAME — the one genuinely dangerous moment', () => {
  it('renames the original back into place', async () => {
    const h = makeHarness({
      failStatement: {
        pattern: /RENAME TO/,
        error: new Error('source database is being accessed by other users'),
        // The SECOND rename — the one that promotes the scratch database.
        onCall: 2,
      },
    });

    await runRestore(h);

    // Three renames: park, the failed promote, and the recovery.
    expect(renames(h)).toEqual([
      `ALTER DATABASE "${LIVE}" RENAME TO "${OLD}"`,
      `ALTER DATABASE "${SCRATCH}" RENAME TO "${LIVE}"`,
      `ALTER DATABASE "${OLD}" RENAME TO "${LIVE}"`,
    ]);

    // ⚠ THE DEPLOYMENT IS BACK ON THE DATABASE IT STARTED ON.
    expect(h.cluster.has(LIVE)).toBe(true);
    expect(h.cluster.has(OLD)).toBe(false);
    // ⚠ THE RESTORED DATABASE IS KEPT under its scratch name. It cost hours to
    // build and it is intact; dropping it because a rename failed would throw
    // that away, and section 5.2 of the runbook tells an operator how to finish
    // the swap by hand from exactly this state.
    expect(h.cluster.has(SCRATCH)).toBe(true);
    expect(h.statements()).not.toContain(`DROP DATABASE IF EXISTS "${SCRATCH}"`);

    expect(h.finalStatus()).toBe('failed');
    expect(h.exitProcess).not.toHaveBeenCalled();
  });

  it('closes the maintenance window once the original is back', async () => {
    // There is a working database to serve from, and a window nothing will ever
    // close is an outage of its own.
    const h = makeHarness({
      failStatement: { pattern: /RENAME TO/, error: new Error('nope'), onCall: 2 },
    });

    await runRestore(h);

    expect(h.setInMemoryOverride).toHaveBeenLastCalledWith(null);
  });

  it('reports originalRestored and keeps the window OPEN when the recovery also fails', async () => {
    // Both renames after the park fail: there is no database under the live
    // name, and an orderly 503 beats five hundred stack traces.
    const h = makeHarness({
      failStatement: { pattern: /RENAME TO "appdb"$/, error: new Error('nope') },
    });

    await runRestore(h);

    expect(h.cluster.has(LIVE)).toBe(false);
    expect(h.cluster.has(OLD)).toBe(true);
    expect(h.cluster.has(SCRATCH)).toBe(true);

    // The window is still open: the only `setInMemoryOverride` call was the one
    // that opened it.
    expect(h.setInMemoryOverride).toHaveBeenCalledTimes(1);
    expect(h.setInMemoryOverride).not.toHaveBeenCalledWith(null);
    expect(h.exitProcess).not.toHaveBeenCalled();
  });

  it('carries the recovery verdict on the typed error', () => {
    const restored = new DatabaseRestoreSwapError(LIVE, true, new Error('boom'));
    const lost = new DatabaseRestoreSwapError(LIVE, false, new Error('boom'));

    expect(restored.originalRestored).toBe(true);
    expect(restored.message).toContain('renamed back into place');
    expect(lost.originalRestored).toBe(false);
    expect(lost.message).toContain('5.2');
    // `instanceof` survives downlevelling — the reason for the explicit
    // `setPrototypeOf` in `db-backup.errors.ts`.
    expect(lost).toBeInstanceOf(DatabaseRestoreSwapError);
  });

  it('does not attempt the catalog carry-over when the swap failed', async () => {
    const h = makeHarness({
      failStatement: { pattern: /RENAME TO/, error: new Error('nope'), onCall: 2 },
    });

    await runRestore(h);

    expect(h.carried).toEqual([]);
  });
});

// ===========================================================================
describe('catalog carry-over', () => {
  const newerBackup = backupRow({
    id: '0d1f1c9e-0000-4000-8000-00000000aaaa',
    createdAt: new Date('2026-09-07T02:00:00.000Z'),
    createdById: 'deleted-user-0000-4000-8000-000000000000',
  });

  it('preserves this run\'s record and every backup newer than the archive', async () => {
    const h = makeHarness({ catalogRows: [backupRow(), newerBackup] });

    await runRestore(h);

    expect(h.carried).toHaveLength(2);
    expect(h.carried.map((values) => values[0])).toEqual([backupRow().id, newerBackup.id]);
  });

  it('writes THIS run\'s post-swap audit values, not the pre-swap ones', async () => {
    // Writing "restore completed" into the database nobody will ever open again
    // is exactly the mistake this avoids.
    const h = makeHarness({ catalogRows: [backupRow(), newerBackup] });

    await runRestore(h);

    const mine = h.carried[0];
    expect(mine[19]).toBe('completed'); // restore_status
    expect(mine[23]).toBe(SCRATCH); // restore_scratch_db
    expect(mine[24]).toBe(OLD); // restore_old_db
    expect(mine[25]).toBe(NOW.toISOString()); // swapped_at

    // ...and the other row is carried through unchanged.
    expect(h.carried[1][19]).toBeNull();
  });

  it('resolves both user FKs through a subselect, so a missing user is NULL not an abort', async () => {
    // The promoted database's `users` table is the ARCHIVE's: an administrator
    // created after the backup does not exist in it, and a plain value would
    // raise a foreign-key violation that aborts the WHOLE carry-over.
    const h = makeHarness();
    await runRestore(h);

    const insert = h.statements().find((s) => s.startsWith('INSERT INTO database_backup_runs'));

    expect(insert).toContain('(SELECT id FROM users WHERE id = $19::uuid)');
    expect(insert).toContain('(SELECT id FROM users WHERE id = $23::uuid)');
    // And it REPLACES the stale row rather than leaving it.
    expect(insert).toContain('ON CONFLICT (id) DO UPDATE SET');
  });

  it('applies the self-FK in a SECOND pass, after every referent is inserted', async () => {
    const h = makeHarness({
      preflight: okPreflight({ effectiveRollback: 'pre_restore_dump' }),
    });

    await runRestore(h);

    // The insert never carries `pre_restore_backup_id`...
    const insert = h.statements().find((s) => s.startsWith('INSERT INTO database_backup_runs'));
    expect(insert).not.toContain('pre_restore_backup_id');

    // ...and the second pass sets it, itself through a subselect.
    expect(h.selfLinks).toEqual([[backupRow().id, 'pre-restore-run']]);
    const link = h.statements().find((s) => s.startsWith('UPDATE database_backup_runs'));
    expect(link).toContain('(SELECT id FROM database_backup_runs WHERE id = $2::uuid)');

    // Ordering: every insert precedes every link.
    const order = h.statements();
    const lastInsert = order.reduce(
      (last, text, index) => (text.startsWith('INSERT INTO database_backup_runs') ? index : last),
      -1
    );
    expect(order.findIndex((s) => s.startsWith('UPDATE database_backup_runs'))).toBeGreaterThan(
      lastInsert
    );
  });

  it('goes into the PROMOTED database, on a session of its own', async () => {
    const h = makeHarness();
    await runRestore(h);

    const insert = h.sql.find((line) => line.includes('INSERT INTO database_backup_runs'));
    expect(insert?.startsWith(`${LIVE}: `)).toBe(true);
  });

  it('never undoes a successful swap when it fails', async () => {
    // Losing the backup catalog is bad. Undoing a restore the deployment is
    // already serving from, to avoid losing it, would be worse.
    const h = makeHarness({
      failStatement: {
        pattern: /^INSERT INTO database_backup_runs/,
        error: new Error('relation "database_backup_runs" does not exist'),
      },
    });

    await runRestore(h);

    expect(h.cluster.has(LIVE)).toBe(true);
    expect(h.cluster.has(SCRATCH)).toBe(false);
    expect(h.exitProcess).toHaveBeenCalledWith(0);
  });
});

// ===========================================================================
describe('the temp file', () => {
  it('carries the janitor-swept prefix', () => {
    // A file whose prefix merely RESEMBLES the janitor's is a file the janitor
    // never sweeps — which is the whole reason this imports the prefix rather
    // than copying it.
    const path = defaultDatabaseRestoreSeam.tempFilePath();

    expect(path.startsWith(join(tmpdir(), JOB_TEMP_PREFIX))).toBe(true);
    expect(path.endsWith('.dump')).toBe(true);
  });

  it('is removed on success, BEFORE the swap the process does not return from', async () => {
    const h = makeHarness();
    await runRestore(h);

    expect(h.removed).toEqual([`/tmp/${JOB_TEMP_PREFIX}restore-test.dump`]);

    const order = h.statements();
    // Removed before the first rename, because there is no "after" here.
    expect(h.removed).toHaveLength(1);
    expect(order.filter((s) => s.startsWith('ALTER DATABASE'))).toHaveLength(2);
  });

  it('is removed on failure too', async () => {
    const h = makeHarness({ restoreError: new Error('pg_restore exited with code 1') });
    await runRestore(h);

    expect(h.removed).toEqual([`/tmp/${JOB_TEMP_PREFIX}restore-test.dump`]);
  });

  it('is removed even when the archive never verified', async () => {
    const h = makeHarness({ tocEntries: 0 });
    await runRestore(h);

    expect(h.removed).toEqual([`/tmp/${JOB_TEMP_PREFIX}restore-test.dump`]);
  });
});

// ===========================================================================
describe('starting a restore', () => {
  it('releases the concurrency slot when the pre-flight refuses', async () => {
    // The slot is claimed BEFORE the pre-flight (several network round trips,
    // and two clicks must not both get through it), so every path that does not
    // hand it to the detached body has to give it back.
    const h = makeHarness({
      preflight: {
        ...okPreflight(),
        outcome: 'blocked',
        block: {
          gateId: 'schema_compatibility',
          message: 'the archive predates the running code',
          overridable: true,
          overrideParameter: 'overrideSchemaMismatch',
        },
      } as RestorePreflightResult,
    });

    expect((await h.service.startRestore(backupRow())).outcome).toBe('refused');
    expect((await h.service.startRestore(backupRow())).outcome).toBe('refused');
  });

  it('refuses without touching anything when the pre-flight is not ok', async () => {
    const h = makeHarness({
      preflight: {
        ...okPreflight(),
        outcome: 'blocked',
        block: {
          gateId: 'schema_compatibility',
          message: 'the archive predates the running code',
          overridable: true,
          overrideParameter: 'overrideSchemaMismatch',
        },
      } as RestorePreflightResult,
    });

    const result = await h.service.startRestore(backupRow(), { actorUserId: ACTOR });

    expect(result.outcome).toBe('refused');
    // ⚠ AND NOTHING WAS WRITTEN. A refused restore is not an attempted one.
    expect(h.stateWrites).toEqual([]);
    expect(h.statements()).toEqual([]);
  });

  it('runs the pre-flight itself rather than trusting its caller', async () => {
    const h = makeHarness();
    await runRestore(h);

    expect(h.check).toHaveBeenCalledTimes(1);
  });

  it('uses the pre-flight\'s own derived names, so the row and the DDL agree', async () => {
    const h = makeHarness({
      preflight: okPreflight({
        scratchDatabase: 'appdb_restore_29991231T235959Z',
        oldDatabase: 'appdb_old_29991231T235959Z',
      }),
    });

    await runRestore(h);

    expect(h.statements()).toContain('CREATE DATABASE "appdb_restore_29991231T235959Z"');
    expect(h.stateWrites[0]).toMatchObject({
      restoreScratchDb: 'appdb_restore_29991231T235959Z',
      restoreOldDb: 'appdb_old_29991231T235959Z',
    });
  });

  it('refuses a second concurrent restore in this process', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = makeHarness({ restoreGate: gate, restoreError: new Error('released') });

    const first = await h.service.startRestore(backupRow(), { actorUserId: ACTOR });
    expect(first.outcome).toBe('started');

    await waitFor(() => h.runPgRestore.mock.calls.length === 1, 'the first replay to start');

    // A second restore would replay an archive into a database the first one is
    // about to rename.
    const second = await h.service.startRestore(backupRow(), { actorUserId: ACTOR });
    expect(second.outcome).toBe('already_running');
    expect((second as { runId: string }).runId).toBe(backupRow().id);

    release();
    await waitFor(() => h.finalStatus() === 'failed', 'the first restore to settle');

    // ...and the slot is released once it settles.
    expect(h.runPgRestore).toHaveBeenCalledTimes(1);
  });

  it('puts process.exit behind the seam so a test can assert it', async () => {
    // The property this whole seam exists for: the most dangerous sequence in
    // the repository is exercised without killing the Jest worker.
    const h = makeHarness();
    await runRestore(h);

    expect(h.exitProcess).toHaveBeenCalledWith(0);
    expect(typeof defaultDatabaseRestoreSeam.exitProcess).toBe('function');
  });
});

// ===========================================================================
describe('rollback', () => {
  const swapped = backupRow({
    restoreStatus: 'completed',
    restoreScratchDb: SCRATCH,
    restoreOldDb: OLD,
    swappedAt: new Date('2026-09-07T11:00:00.000Z'),
    restoredAt: new Date('2026-09-07T10:00:00.000Z'),
    restoredById: ACTOR,
  });

  it('renames the retained database back into place — seconds', async () => {
    const h = makeHarness({ databases: [OLD] });

    const result = await h.service.rollback(swapped, ACTOR);

    expect(result).toMatchObject({ outcome: 'renamed', promoted: OLD });

    expect(renames(h)).toEqual([
      // The bad restore is parked under a fresh scratch name...
      `ALTER DATABASE "${LIVE}" RENAME TO "${SCRATCH}"`,
      // ...and the original is promoted.
      `ALTER DATABASE "${OLD}" RENAME TO "${LIVE}"`,
    ]);

    expect(h.cluster.has(LIVE)).toBe(true);
    expect(h.cluster.has(SCRATCH)).toBe(true);
  });

  it('carries the catalog over, so the rollback does not delete newer backup records', async () => {
    // Including the `pre_restore` dump's, which under some configurations is
    // the only remaining way back from the thing being undone.
    const h = makeHarness({ databases: [OLD], catalogRows: [swapped, backupRow({ id: 'newer' })] });

    await h.service.rollback(swapped, ACTOR);

    expect(h.carried.map((values) => values[0])).toEqual([swapped.id, 'newer']);
    expect(h.carried[0][19]).toBe('rolled_back');
    expect(h.carriedAudit[0][1]).toBe(RESTORE_AUDIT_ROLLBACK);
  });

  it('never drops the database it parked', async () => {
    // It is the restore being undone, and an operator who rolled back at 3am
    // may still want to look at it.
    const h = makeHarness({ databases: [OLD] });

    await h.service.rollback(swapped, ACTOR);

    expect(h.statements().filter((s) => s.startsWith('DROP DATABASE'))).toEqual([]);
  });

  it('exits with a delay, so its HTTP response can be flushed first', async () => {
    const h = makeHarness({ databases: [OLD] });

    await h.service.rollback(swapped, ACTOR);

    expect(h.exitProcess).toHaveBeenCalledWith(0, expect.any(Number));
    expect((h.exitProcess.mock.calls[0][1] as number) > 0).toBe(true);
  });

  it('delegates to a full restore of the pre-restore dump when the database is gone', async () => {
    // Hours, not seconds — and the caller is told which it got.
    const h = makeHarness({
      catalogRows: [],
      restoreError: new Error('stop before the swap so the assertion is about the delegation'),
    });

    const result = await h.service.rollback(
      { ...swapped, preRestoreBackupId: 'pre-restore-run' } as DatabaseBackupRun,
      ACTOR
    );

    expect(result).toMatchObject({ outcome: 'restore_started', preRestoreRunId: 'pre-restore-run' });

    // ⚠ WITH THE SCHEMA CHECK OVERRIDDEN. That dump came from the schema the
    // code was running moments before the restore, so a compatibility block
    // would be spurious — and would fire exactly when the way back is needed.
    expect(h.check).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pre-restore-run' }),
      expect.objectContaining({ overrideSchemaMismatch: true })
    );

    await waitFor(() => h.finalStatus() === 'failed', 'the delegated restore to settle');
  });

  it('reports unavailable — honestly — when neither route exists', async () => {
    const h = makeHarness();

    const result = await h.service.rollback(swapped, ACTOR);

    expect(result.outcome).toBe('unavailable');
    expect((result as { reason: string }).reason).toContain('oldDatabaseRetentionHours');
    // Nothing was renamed to report it.
    expect(renames(h)).toEqual([]);
  });

  it('reports unavailable for a backup that was never restored', async () => {
    const h = makeHarness();

    const result = await h.service.rollback(backupRow(), ACTOR);

    expect(result).toMatchObject({ outcome: 'unavailable' });
    expect((result as { reason: string }).reason).toContain('no recorded restore');
  });
});

// ===========================================================================
describe('the retained-database sweep', () => {
  const expired = {
    id: 'run-expired',
    restoreOldDb: OLD,
    swappedAt: new Date('2026-09-01T00:00:00.000Z'),
  };

  it('drops a displaced database past its retention window', async () => {
    const h = makeHarness({ databases: [OLD], sweepRows: [expired] });

    const dropped = await h.service.dropExpiredOldDatabases(POLICY, NOW);

    expect(dropped).toBe(1);
    expect(h.statements()).toContain(`DROP DATABASE IF EXISTS "${OLD}"`);
    expect(h.cluster.has(OLD)).toBe(false);
  });

  it('never sweeps an in-flight restore, because its swappedAt is still NULL', async () => {
    // `NULL < cutoff` is never true in SQL, so the filter carries this property
    // on its own — asserted here as the `where` the service actually sends.
    const h = makeHarness({ sweepRows: [] });

    await h.service.dropExpiredOldDatabases(POLICY, NOW);

    expect(h.findManyArgs()).toMatchObject({
      where: {
        restoreOldDb: { not: null },
        swappedAt: { lt: new Date(NOW.getTime() - 48 * 3_600_000) },
      },
    });
  });

  it('refuses to drop the live or the maintenance database, whatever the row says', async () => {
    // `quoteIdentifier` makes the statement safe to SEND. This makes it safe to
    // MEAN: a hand-edited row must not be able to have a cron drop the database
    // the application is serving from.
    const h = makeHarness({
      sweepRows: [
        { id: 'a', restoreOldDb: LIVE, swappedAt: expired.swappedAt },
        { id: 'b', restoreOldDb: 'postgres', swappedAt: expired.swappedAt },
      ],
    });

    const dropped = await h.service.dropExpiredOldDatabases(POLICY, NOW);

    expect(dropped).toBe(0);
    expect(h.statements().filter((text) => text.startsWith('DROP DATABASE'))).toEqual([]);
    expect(h.cluster.has(LIVE)).toBe(true);
  });

  it('keeps going when one database refuses to be dropped', async () => {
    const h = makeHarness({
      databases: [OLD, 'appdb_old_20260902T000000Z'],
      sweepRows: [
        expired,
        { id: 'run-2', restoreOldDb: 'appdb_old_20260902T000000Z', swappedAt: expired.swappedAt },
      ],
      failStatement: {
        pattern: /^DROP DATABASE IF EXISTS "appdb_old_20260907T120000Z"/,
        error: new Error('is being accessed by other users'),
      },
    });

    const dropped = await h.service.dropExpiredOldDatabases(POLICY, NOW);

    expect(dropped).toBe(1);
    expect(h.cluster.has(OLD)).toBe(true);
    expect(h.cluster.has('appdb_old_20260902T000000Z')).toBe(false);
  });

  it('skips a database that has already gone, without failing', async () => {
    // Re-running the sweep, or a restore that dropped its own displaced
    // database in `pre_restore_dump` mode.
    const h = makeHarness({ sweepRows: [expired] });

    expect(await h.service.dropExpiredOldDatabases(POLICY, NOW)).toBe(0);
    expect(h.statements().filter((text) => text.startsWith('DROP DATABASE'))).toEqual([]);
  });

  it('opens no connection at all when nothing is due', async () => {
    const h = makeHarness({ sweepRows: [] });

    expect(await h.service.dropExpiredOldDatabases(POLICY, NOW)).toBe(0);
    expect(h.statements()).toEqual([]);
  });
});

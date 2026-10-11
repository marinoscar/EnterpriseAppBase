// =============================================================================
// The `local-dir` backup mirror: an app keeps a second copy of every archive WITHOUT touching a package (PP-14.12)
// =============================================================================
//
// `apps/api/src/platform-extensions/db-backup/local-dir.target.ts` is a
// `BackupTarget` (`@marinoscar/platform-api/db-backup`). The reference app binds
// no mirror by default (`APP_BACKUP_MIRROR_TARGETS` in
// `app-registrations/db-backup.ts` is empty), so this suite binds one the way a
// fork would, by supplying that array, and proves the story against the REAL
// application wiring:
//
//   1. the target passes the backup target conformance kit (a temp directory):
//      a 20 MiB streamed write that is not buffered, chunked reads, listing,
//      idempotent delete, a failed write that leaves nothing, and a key that
//      climbs out of the directory refused;
//   2. `DbBackupModule.forRoot({ mirrorTargets })` hands the REAL runner,
//      retention service and admin service the mirror (and leaves the primary
//      the default adapter over the storage provider);
//   3. a backup is written to the primary FIRST, then copied to the directory
//      with the same bytes and the same key, and the copy is recorded
//      (`audit_events`, `db_backup.mirror.completed`);
//   4. a mirror that cannot be written never fails the backup, and is recorded as
//      `db_backup.mirror.failed` for the `backup.mirrors` Doctor check;
//   5. `db_backup.run.completed` reaches an `@OnEvent` listener with the
//      documented payload;
//   6. the Doctor check is registered in the real app.
//
// No Postgres here: what only a real database can prove (the audit rows and the
// Doctor check's `DISTINCT ON` over `audit_events.meta`) is in
// `mirror-doctor.db.spec.ts`; these tests assert the values handed to Prisma.
// =============================================================================

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  DB_BACKUP_MIRROR_TARGETS,
  DB_BACKUP_RUN_COMPLETED_EVENT,
  DB_BACKUP_TARGET,
  DatabaseBackupRetentionService,
  DatabaseBackupRunnerService,
  StorageProviderBackupTarget,
  type BackupTarget,
  type DbBackupRunCompletedEvent,
} from '@marinoscar/platform-api/db-backup';
import { describeBackupTargetConformance } from '@marinoscar/platform-api/db-backup/testing';
import { DoctorCheckRegistry } from '@marinoscar/platform-api/doctor';
import { JobsService } from '@marinoscar/platform-api/jobs';
import { STORAGE_PROVIDER } from '@marinoscar/platform-api/storage';

import {
  LOCAL_DIR_TARGET_ID,
  LocalDirBackupTarget,
  defaultLocalDirBackupDirectory,
  localDirMirror,
} from '../../../src/platform-extensions/db-backup/local-dir.target';
import { setupBaseMocks } from '../../fixtures/mock-setup.helper';
import { closeTestApp, createTestApp, type TestContext } from '../../helpers/test-app.helper';
import { cleanupTmpDir, TmpDirStorageProvider } from '../../helpers/tmp-storage-provider.helper';
import { resetPrismaMock } from '../../mocks/prisma.mock';

// The mirror a fork would add to `APP_BACKUP_MIRROR_TARGETS`, bound BEFORE the
// application module is imported (the module is built once, at import time).
// The directory is exported from the mock so the suite can read it.
jest.mock('../../../src/app-registrations/db-backup', () => {
  const actual = jest.requireActual('../../../src/app-registrations/db-backup');
  const { mkdtempSync: makeDir } = jest.requireActual('node:fs');
  const { tmpdir: tmp } = jest.requireActual('node:os');
  const { join: joinPath } = jest.requireActual('node:path');
  const { localDirMirror: mirror } = jest.requireActual('../../../src/platform-extensions/db-backup/local-dir.target');
  const MIRROR_DIRECTORY: string = makeDir(joinPath(tmp(), 'app-backup-mirror-spec-'));

  return { ...actual, MIRROR_DIRECTORY, APP_BACKUP_MIRROR_TARGETS: [mirror(MIRROR_DIRECTORY)] };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MIRROR_DIRECTORY } = require('../../../src/app-registrations/db-backup') as { MIRROR_DIRECTORY: string };

// ---- 1. the conformance kit -----------------------------------------------------------

const kitDirectory = mkdtempSync(join(tmpdir(), 'local-dir-kit-'));
afterAll(() => rmSync(kitDirectory, { recursive: true, force: true }));

describeBackupTargetConformance(() => new LocalDirBackupTarget(kitDirectory), {
  describe,
  it,
  expect,
  rejectsEscapingKeys: true,
});

describe('LocalDirBackupTarget', () => {
  it('defaults to a folder under the system temp directory and has the documented id', () => {
    expect(defaultLocalDirBackupDirectory().startsWith(tmpdir())).toBe(true);
    expect(new LocalDirBackupTarget().id).toBe(LOCAL_DIR_TARGET_ID);
    expect(new LocalDirBackupTarget(kitDirectory, 'second').id).toBe('second');
    expect(new LocalDirBackupTarget(kitDirectory).location).toBe(kitDirectory);
  });

  it('builds from the binding an app puts in APP_BACKUP_MIRROR_TARGETS', () => {
    const binding = localDirMirror(kitDirectory, 'cold') as { useFactory: () => BackupTarget };

    expect(binding.useFactory().id).toBe('cold');
  });

  it('removes the partial file when the write fails, and says so through done', async () => {
    const target = new LocalDirBackupTarget(kitDirectory);
    const key = 'database-backups/app/partial.dump';
    const sink = target.openWrite(key, { contentType: 'application/octet-stream', metadata: {} });
    sink.stream.on('error', () => undefined);

    sink.stream.write(Buffer.alloc(1024, 1));
    sink.stream.destroy(new Error('the dump died'));

    await expect(sink.done).rejects.toBeDefined();
    await expect(target.openRead(key)).rejects.toBeDefined();
  });

  it('lists with sizes and refuses to list outside its directory', async () => {
    const target = new LocalDirBackupTarget(kitDirectory);
    const sink = target.openWrite('database-backups/a/b.dump', { contentType: 'application/octet-stream', metadata: {} });
    sink.stream.end(Buffer.from('12345'));
    await sink.done;

    const listed: Array<{ key: string; sizeBytes?: number }> = [];
    for await (const object of target.list('database-backups/a/')) listed.push(object);

    expect(listed).toEqual([expect.objectContaining({ key: 'database-backups/a/b.dump', sizeBytes: 5 })]);
    await expect(target.list('../')[Symbol.asyncIterator]().next()).rejects.toThrow(/leave the target directory/);
  });
});

// ---- 2 to 6. the real application ---------------------------------------------------

describe('a mirror bound through DbBackupModule.forRoot, in the real application', () => {
  let context: TestContext;
  let primaryDirectory: string;
  let primary: TmpDirStorageProvider;

  beforeAll(async () => {
    primaryDirectory = mkdtempSync(join(tmpdir(), 'backup-primary-'));
    primary = new TmpDirStorageProvider(primaryDirectory);
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [{ provide: STORAGE_PROVIDER, useValue: primary }],
    });
  });

  afterAll(async () => {
    await closeTestApp(context);
    cleanupTmpDir(primaryDirectory);
    rmSync(MIRROR_DIRECTORY, { recursive: true, force: true });
  });

  const dump = Buffer.from('PGDMP-archive-bytes-for-the-mirror');
  const rows = new Map<string, Record<string, unknown>>();

  /** `pg_dump` is replaced by the engine seam: this is the archive. */
  const useEngine = (runner: DatabaseBackupRunnerService): void => {
    Object.assign(runner, {
      engine: {
        startDump: () => ({ stdout: Readable.from([dump]), done: Promise.resolve(), kill: jest.fn() }),
        readTocEntryCount: async (source: Readable) => {
          for await (const chunk of source) void chunk;
          return 3;
        },
        checkClientVersion: async () => ({ status: 'ok', clientMajor: 17, serverMajor: 17, message: 'ok' }),
      },
    });
  };

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    rows.clear();
    context.prismaMock.auditEvent.create.mockResolvedValue({} as never);
    context.prismaMock.databaseBackupRun.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      rows.set(String(data.id), { ...data });
      return { ...data } as never;
    });
    context.prismaMock.databaseBackupRun.update.mockImplementation(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = { ...(rows.get(where.id) ?? {}), ...data };
        rows.set(where.id, row);
        return row as never;
      },
    );
    context.prismaMock.databaseBackupRun.findFirst.mockResolvedValue(null);
    // The queue is not under test: the retention sweep a completed backup enqueues is a stub.
    jest.spyOn(context.app.get(JobsService), 'enqueue').mockResolvedValue({ id: 'job-sweep' } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  const auditActions = () =>
    context.prismaMock.auditEvent.create.mock.calls.map(([args]: [{ data: Record<string, unknown> }]) => args.data);

  async function backup(): Promise<{ id: string; storageKey: string }> {
    const runner = context.module.get(DatabaseBackupRunnerService, { strict: false });
    useEngine(runner);
    const run = await runner.startBackup({ trigger: 'manual', createdById: 'admin-1' });
    // Detached and doing real file I/O: wait for the audit row of the mirror, which comes last.
    for (let attempt = 0; attempt < 500 && auditActions().length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return run as { id: string; storageKey: string };
  }

  it('hands the real slice the mirror, and leaves the primary the default adapter over the storage provider', () => {
    const mirrors = context.module.get<BackupTarget[]>(DB_BACKUP_MIRROR_TARGETS, { strict: false });
    const target = context.module.get<BackupTarget>(DB_BACKUP_TARGET, { strict: false });

    expect(mirrors.map((mirror) => mirror.id)).toEqual([LOCAL_DIR_TARGET_ID]);
    expect(mirrors[0]).toBeInstanceOf(LocalDirBackupTarget);
    expect(target).toBeInstanceOf(StorageProviderBackupTarget);
    // The consumers hold them: the runner copies, retention and the admin delete clean up.
    const runner = context.module.get(DatabaseBackupRunnerService, { strict: false }) as unknown as { mirrors: BackupTarget[]; target: BackupTarget };
    expect(runner.mirrors).toBe(mirrors);
    expect(runner.target).toBe(target);
    const retention = context.module.get(DatabaseBackupRetentionService, { strict: false }) as unknown as { mirrors: BackupTarget[] };
    expect(retention.mirrors).toBe(mirrors);
  });

  it('copies a verified backup to the directory: same key, same bytes, after the primary, and records it', async () => {
    const run = await backup();

    // The primary holds the archive and the run is completed on it...
    expect((await readFile(join(primaryDirectory, run.storageKey))).equals(dump)).toBe(true);
    expect(rows.get(run.id)).toMatchObject({ status: 'completed', storageProvider: 's3' });
    // ...and the mirror holds the same bytes under the same key.
    expect((await readFile(join(MIRROR_DIRECTORY, run.storageKey))).equals(dump)).toBe(true);

    expect(auditActions()).toEqual([
      expect.objectContaining({
        action: 'db_backup.mirror.completed',
        targetType: 'database_backup_run',
        targetId: run.id,
        meta: expect.objectContaining({ targetId: LOCAL_DIR_TARGET_ID, status: 'ok', sizeBytes: dump.length, storageKey: run.storageKey }),
      }),
    ]);
  });

  it('a mirror that cannot be written never fails the backup, and the failure is recorded', async () => {
    // A directory that cannot be created: its parent is a file.
    const mirror = context.module.get<BackupTarget[]>(DB_BACKUP_MIRROR_TARGETS, { strict: false })[0] as LocalDirBackupTarget;
    const original = Object.getOwnPropertyDescriptor(mirror, 'directory');
    Object.defineProperty(mirror, 'directory', { value: join(kitDirectory, 'a-file-not-a-folder', 'x'), configurable: true });
    const blocker = join(kitDirectory, 'a-file-not-a-folder');
    writeFileSync(blocker, 'x');

    try {
      const run = await backup();

      expect(rows.get(run.id)).toMatchObject({ status: 'completed' });
      expect(auditActions()).toEqual([
        expect.objectContaining({
          action: 'db_backup.mirror.failed',
          targetId: run.id,
          meta: expect.objectContaining({ targetId: LOCAL_DIR_TARGET_ID, status: 'failed', sizeBytes: 0 }),
        }),
      ]);
    } finally {
      if (original) Object.defineProperty(mirror, 'directory', original);
      rmSync(blocker, { force: true });
    }
  });

  it('db_backup.run.completed reaches a listener with the documented payload', async () => {
    const emitter = context.app.get(EventEmitter2);
    const received: DbBackupRunCompletedEvent[] = [];
    emitter.on(DB_BACKUP_RUN_COMPLETED_EVENT, (event: DbBackupRunCompletedEvent) => received.push(event));

    const run = await backup();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ runId: run.id, status: 'completed', targetId: 's3', sizeBytes: dump.length });
    expect(typeof received[0].durationMs).toBe('number');
    emitter.removeAllListeners(DB_BACKUP_RUN_COMPLETED_EVENT);
  });

  it('registers the backup.mirrors Doctor check', async () => {
    const registry = context.module.get(DoctorCheckRegistry, { strict: false });

    expect(registry.get('backup.mirrors')).toBeDefined();
  });
});


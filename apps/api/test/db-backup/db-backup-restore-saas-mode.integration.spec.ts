// =============================================================================
// DEPLOYMENT_MODE and the in-app restore routes (#685)
// =============================================================================
//
// Modelled on `db-backup-restore.integration.spec.ts`, with one deliberate
// difference: the RESTORE ENGINE IS REAL here. That file substitutes
// `DatabaseRestoreService` because it is about the HTTP contract; this one is
// about the deployment-mode gate, which lives at three layers (admin service,
// restore service, job handler), and a substituted engine would hide whether
// the inner two hold. What is substituted is only what would reach outside the
// process — the runner, the storage provider and, through spies on the two
// default seams, any cluster admin connection — so the spies can prove that a
// refused request opened nothing.
//
// Both modes boot their own application, because the mode is read once when
// the container builds, exactly as in production. `saas` overrides
// `DeploymentModeService` with a real instance built for that mode; the
// self-hosted app takes whatever the environment says (unset, in tests).
// =============================================================================

import request from 'supertest';

import { DeploymentModeService } from '../../src/common/deployment/deployment-mode.service';
import {
  DatabaseRestoreService,
  DB_RESTORE_RUN_TYPE,
  defaultDatabaseRestoreSeam,
} from '../../src/db-backup/database-restore.service';
import { DatabaseBackupRunnerService } from '../../src/db-backup/db-backup-runner.service';
import { DatabaseRestoreDisabledError } from '../../src/db-backup/db-backup.errors';
import { DatabaseRestoreRunHandler } from '../../src/db-backup/handlers/db-restore-run.handler';
import {
  DatabaseRestorePreflightService,
  defaultRestorePreflightSeam,
} from '../../src/db-backup/restore-preflight.service';
import { JobsService } from '../../src/jobs/jobs.service';
import { STORAGE_PROVIDER } from '../../src/storage/providers/storage-provider.interface';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser } from '../helpers/auth-mock.helper';
import { deploymentModeFor } from '../helpers/deployment-mode.helper';
import { TestContext, closeTestApp, createTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const RESTORE_PATH = `/api/admin/db-backup/runs/${RUN_ID}/restore`;
const ROLLBACK_PATH = `/api/admin/db-backup/runs/${RUN_ID}/rollback`;
const CONFIG_PATH = '/api/admin/db-backup/config';

/** One completed, never-restored `database_backup_runs` row. */
function backupRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RUN_ID,
    status: 'completed',
    trigger: 'manual',
    startedAt: new Date('2026-09-07T02:00:00.000Z'),
    finishedAt: new Date('2026-09-07T02:41:00.000Z'),
    lastHeartbeatAt: new Date('2026-09-07T02:41:00.000Z'),
    bytesWritten: 1024n,
    sizeBytes: 1024n,
    storageProvider: 's3',
    storageKey: 'database-backups/app/2026/09/app-20260907T020000Z-run.dump',
    bucket: 'backups',
    format: 'custom',
    checksumSha256: 'abc123',
    dbVersion: '16.4',
    appVersion: '1.0.0',
    migrationName: '20260907120000_add_database_backup_runs',
    verifiedAt: new Date('2026-09-07T02:41:00.000Z'),
    lastError: null,
    createdById: null,
    restoreStatus: null,
    restoreError: null,
    restoredAt: null,
    restoredById: null,
    restoreScratchDb: null,
    restoreOldDb: null,
    swappedAt: null,
    preRestoreBackupId: null,
    createdAt: new Date('2026-09-07T02:00:00.000Z'),
    updatedAt: new Date('2026-09-07T02:41:00.000Z'),
    ...overrides,
  };
}

/** A run a restore was performed from — what a rollback needs. */
function restoredRow(): Record<string, unknown> {
  return backupRow({
    restoreStatus: 'completed',
    restoredAt: new Date('2026-09-07T03:30:00.000Z'),
    restoreScratchDb: 'appdb_restore_20260907T030000Z',
    restoreOldDb: 'appdb_old_20260907T030000Z',
    swappedAt: new Date('2026-09-07T03:30:00.000Z'),
  });
}

interface ModeHarness {
  context: () => TestContext;
  runner: {
    assertStorageProviderUsable: jest.Mock;
    startBackup: jest.Mock;
    queueBackup: jest.Mock;
    cancel: jest.Mock;
  };
  storage: { download: jest.Mock; delete: jest.Mock; getSignedDownloadUrl: jest.Mock };
  spies: () => {
    restoreAdminConnection: jest.SpyInstance;
    restoreResolveConnection: jest.SpyInstance;
    preflightAdminConnection: jest.SpyInstance;
    preflightResolveConnection: jest.SpyInstance;
    preflightCheck: jest.SpyInstance;
    enqueue: jest.SpyInstance;
  };
}

/** Boots one application in `mode` and wires the spies every case reads. */
function bootInMode(mode: 'self-hosted' | 'saas'): ModeHarness {
  let context: TestContext;
  let spies: ReturnType<ModeHarness['spies']>;

  const runner = {
    assertStorageProviderUsable: jest.fn(),
    startBackup: jest.fn(),
    queueBackup: jest.fn(),
    cancel: jest.fn(),
  };
  const storage = {
    download: jest.fn(),
    delete: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
  };

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [
        { provide: DatabaseBackupRunnerService, useValue: runner },
        { provide: STORAGE_PROVIDER, useValue: storage },
        ...(mode === 'saas'
          ? [{ provide: DeploymentModeService, useValue: deploymentModeFor('saas') }]
          : []),
      ],
    });
  }, 60000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();

    const prisma = context.prismaMock as any;
    prisma.databaseBackupRun.findUnique.mockResolvedValue(backupRow());
    prisma.databaseBackupRun.findFirst.mockResolvedValue(null);
    prisma.job.findFirst.mockResolvedValue(null);

    runner.assertStorageProviderUsable.mockReset().mockImplementation(() => undefined);
    runner.startBackup.mockReset();
    runner.queueBackup.mockReset().mockResolvedValue({
      run: backupRow({ status: 'pending', id: '99999999-9999-4999-8999-999999999999' }),
      job: { id: 'job-backup-1' },
    });
    storage.download.mockReset();

    // Every way out of the process a restore has. None of them may be reached
    // in saas mode; in self-hosted mode they answer harmlessly so a request can
    // run to a 200 without a real cluster.
    spies = {
      restoreAdminConnection: jest
        .spyOn(defaultDatabaseRestoreSeam, 'withAdminConnection')
        .mockImplementation(async () => false as never),
      restoreResolveConnection: jest
        .spyOn(defaultDatabaseRestoreSeam, 'resolveConnection')
        .mockImplementation(
          () =>
            ({
              host: 'db.internal',
              port: 5432,
              user: 'appuser',
              password: 'x',
              database: 'postgres',
              liveDatabase: 'appdb',
              ssl: false,
            }) as never
        ),
      preflightAdminConnection: jest
        .spyOn(defaultRestorePreflightSeam, 'withAdminConnection')
        .mockImplementation(async () => {
          throw new Error('no cluster in this test');
        }),
      preflightResolveConnection: jest.spyOn(defaultRestorePreflightSeam, 'resolveConnection'),
      preflightCheck: jest
        .spyOn(context.app.get(DatabaseRestorePreflightService), 'check')
        .mockResolvedValue({
          outcome: 'blocked',
          runId: RUN_ID,
          targetDatabase: 'appdb',
          scratchDatabase: 'appdb_restore_20260907T030000Z',
          oldDatabase: 'appdb_old_20260907T030000Z',
          gates: [],
          rollback: {
            configured: 'retain_database',
            effective: 'retain_database',
            downgraded: false,
            reason: null,
          },
          archiveMigration: 'a',
          liveMigration: 'b',
          databaseSizeBytes: null,
          freeDiskBytes: null,
          block: {
            gateId: 'schema_compatibility',
            message: 'mismatch',
            overridable: true,
            overrideParameter: 'overrideSchemaCheck',
          },
        } as never),
      enqueue: jest.spyOn(context.app.get(JobsService), 'enqueue'),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  return { context: () => context, runner, storage, spies: () => spies };
}

describe('In-app restore by deployment mode (Integration, #685)', () => {
  // ===========================================================================
  // saas
  // ===========================================================================
  describe('DEPLOYMENT_MODE=saas', () => {
    const h = bootInMode('saas');
    const server = () => h.context().app.getHttpServer();

    /** Nothing was probed, downloaded, dumped or queued. */
    function expectNothingStarted(): void {
      const spies = h.spies();
      expect(spies.preflightCheck).not.toHaveBeenCalled();
      expect(spies.preflightAdminConnection).not.toHaveBeenCalled();
      expect(spies.preflightResolveConnection).not.toHaveBeenCalled();
      expect(spies.restoreAdminConnection).not.toHaveBeenCalled();
      expect(spies.restoreResolveConnection).not.toHaveBeenCalled();
      expect(spies.enqueue).not.toHaveBeenCalled();
      expect(h.runner.startBackup).not.toHaveBeenCalled();
      expect(h.storage.download).not.toHaveBeenCalled();
      expect((h.context().prismaMock as any).job.findFirst).not.toHaveBeenCalled();
      expect((h.context().prismaMock as any).databaseBackupRun.findUnique).not.toHaveBeenCalled();
    }

    it('POST runs/:id/restore answers 403 with details.reason = deployment_mode_saas', async () => {
      const admin = await createMockAdminUser(h.context());

      const response = await request(server())
        .post(RESTORE_PATH)
        .set(authHeader(admin.accessToken))
        .send({ confirmation: 'RESTORE' })
        .expect(403);

      expect(response.body.details).toEqual({ reason: 'deployment_mode_saas' });
      expect(response.body.message).toMatch(/point-in-time recovery/);
      expectNothingStarted();
    });

    it('refuses even with overrideSchemaCheck, which never unblocks this gate', async () => {
      const admin = await createMockAdminUser(h.context());

      await request(server())
        .post(RESTORE_PATH)
        .set(authHeader(admin.accessToken))
        .send({ confirmation: 'RESTORE', overrideSchemaCheck: true })
        .expect(403);

      expectNothingStarted();
    });

    it('POST runs/:id/rollback answers 403 with details.reason = deployment_mode_saas', async () => {
      const admin = await createMockAdminUser(h.context());
      (h.context().prismaMock as any).databaseBackupRun.findUnique.mockResolvedValue(restoredRow());

      const response = await request(server())
        .post(ROLLBACK_PATH)
        .set(authHeader(admin.accessToken))
        .send({ confirmation: 'ROLLBACK' })
        .expect(403);

      expect(response.body.details).toEqual({ reason: 'deployment_mode_saas' });
      expectNothingStarted();
    });

    it('still validates the confirmation first (the pipe runs before the handler)', async () => {
      const admin = await createMockAdminUser(h.context());

      await request(server())
        .post(RESTORE_PATH)
        .set(authHeader(admin.accessToken))
        .send({ confirmation: 'restore' })
        .expect(400);

      expectNothingStarted();
    });

    it('GET config reports restore unavailable, with the same reason token', async () => {
      const admin = await createMockAdminUser(h.context());

      const response = await request(server())
        .get(CONFIG_PATH)
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.restore).toEqual({
        available: false,
        reason: 'deployment_mode_saas',
      });
    });

    it('still takes backups: POST runs queues one', async () => {
      const admin = await createMockAdminUser(h.context());

      await request(server()).post('/api/admin/db-backup/runs').set(authHeader(admin.accessToken)).expect(202);

      expect(h.runner.queueBackup).toHaveBeenCalled();
    });

    it('fails a db.restore.run job queued before the switch, touching no database', async () => {
      const handler = h.context().app.get(DatabaseRestoreRunHandler);
      const engine = h.context().app.get(DatabaseRestoreService);
      const execute = jest.spyOn(engine, 'executeRestoreJob');
      const prisma = h.context().prismaMock as any;

      await expect(
        handler.process({
          id: 'job-queued-while-self-hosted',
          type: DB_RESTORE_RUN_TYPE,
          payload: { runId: RUN_ID },
        } as never)
      ).rejects.toBeInstanceOf(DatabaseRestoreDisabledError);

      expect(execute).not.toHaveBeenCalled();
      expect(prisma.databaseBackupRun.findUnique).not.toHaveBeenCalled();
      expect(prisma.databaseBackupRun.update).not.toHaveBeenCalled();
      expect(h.spies().restoreAdminConnection).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // self-hosted (the default): unchanged
  // ===========================================================================
  describe('DEPLOYMENT_MODE unset (self-hosted)', () => {
    const h = bootInMode('self-hosted');
    const server = () => h.context().app.getHttpServer();

    it('GET config reports restore available', async () => {
      const admin = await createMockAdminUser(h.context());

      const response = await request(server())
        .get(CONFIG_PATH)
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.restore).toEqual({ available: true, reason: null });
    });

    it('POST runs/:id/restore reaches the real engine and its pre-flight', async () => {
      const admin = await createMockAdminUser(h.context());

      const response = await request(server())
        .post(RESTORE_PATH)
        .set(authHeader(admin.accessToken))
        .send({ confirmation: 'RESTORE' })
        .expect(200);

      // The (stubbed) pre-flight blocked it, which is a 200 that started
      // nothing — what matters here is that the gate let the request through.
      expect(response.body.data.mode).toBe('blocked');
      expect(h.spies().preflightCheck).toHaveBeenCalledTimes(1);
      expect(h.spies().enqueue).not.toHaveBeenCalled();
    });

    it('POST runs/:id/rollback reaches the real engine', async () => {
      const admin = await createMockAdminUser(h.context());
      (h.context().prismaMock as any).databaseBackupRun.findUnique.mockResolvedValue(restoredRow());

      const response = await request(server())
        .post(ROLLBACK_PATH)
        .set(authHeader(admin.accessToken))
        .send({ confirmation: 'ROLLBACK' })
        .expect(200);

      // The retained database "does not exist" and there is no pre-restore
      // dump, so the honest answer is `unavailable` — reached through the
      // engine's existence probe, which is the proof the gate admitted it.
      expect(response.body.data.mode).toBe('unavailable');
      expect(h.spies().restoreAdminConnection).toHaveBeenCalledTimes(1);
    });
  });
});

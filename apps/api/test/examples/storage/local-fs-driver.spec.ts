// =============================================================================
// The `local-fs` example: an app adds a storage driver WITHOUT touching a package (PP-14.7, #925)
// =============================================================================
//
// `apps/api/src/platform-extensions/storage/local-fs.driver.ts` is registered
// from `app-registrations/storage.ts` with `registerStorageDriver`, the same
// function the three built-in S3 drivers use. This spec proves the whole story
// the issue lists, against the REAL application wiring:
//
//   1. the driver passes the storage driver conformance kit (a temp directory);
//   2. its signed download URLs round-trip, and a forged, tampered or expired
//      token is refused;
//   3. it is listed beside the built-ins and OFF until selected: a fresh install
//      keeps `s3`;
//   4. an administrator selects it through `PUT /api/admin/storage-config`,
//      tests it (`POST /test`) and creates its folder (`POST /bucket`) with no
//      secret and no S3 code involved;
//   5. once selected, EVERY consumer of `STORAGE_PROVIDER` writes through it: a
//      profile image upload, an export job and a database backup each leave
//      their bytes under the directory, recorded with `storage_provider =
//      local-fs`;
//   6. a custom driver `kind` works as `databaseBackup.storageProvider`.
//
// No Postgres here, so what only a real database can prove (the `bucket` and
// `storage_provider` columns round-tripping through `storage_objects` and
// `database_backup_runs`, row-level security on the object rows) stays in the
// `*.db.spec.ts` suites; these tests assert the values handed to Prisma.
// =============================================================================

import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';

import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { DatabaseBackupRunnerService } from '@marinoscar/platform-api/db-backup';
import { ExportRunHandler } from '@marinoscar/platform-api/exports';
import { JobsService } from '@marinoscar/platform-api/jobs';
import {
  ObjectsService,
  STORAGE_PROVIDER,
  StorageConfigService,
  ResolvingStorageProvider,
  getStorageDriver,
  storageDriverIds,
  storageDriverKind,
  type StorageProvider,
} from '@marinoscar/platform-api/storage';
import { describeStorageDriverConformance } from '@marinoscar/platform-api/storage/testing';

import {
  LOCAL_FS_DRIVER_ID,
  LOCAL_FS_URL_PATH,
  LocalFsStorageProvider,
  localFsStorageDriver,
  resolveLocalFsDirectory,
  signLocalFsToken,
  verifyLocalFsToken,
} from '../../../src/platform-extensions/storage/local-fs.driver';
// The registration under test: what `platform/storage/storage.config.ts` imports.
import '../../../src/app-registrations/storage';
import { setupBaseMocks, setupMockUserSettings } from '../../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser, createMockTestUser } from '../../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../../helpers/test-app.helper';
import { resetPrismaMock } from '../../mocks/prisma.mock';

// `deriveSigningKey` needs the deployment's master key; the suite has its own.
const ORIGINAL_KEY_ENV = process.env.SECRETS_ENCRYPTION_KEY;
process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
afterAll(() => {
  if (ORIGINAL_KEY_ENV === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY_ENV;
});

const collect = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const tokenOf = (url: string): string => url.slice(url.indexOf(LOCAL_FS_URL_PATH) + LOCAL_FS_URL_PATH.length);

// ---- 1. the conformance kit -----------------------------------------------------------

const kitDirectory = mkdtempSync(join(tmpdir(), 'local-fs-kit-'));
afterAll(() => rmSync(kitDirectory, { recursive: true, force: true }));

describeStorageDriverConformance(LOCAL_FS_DRIVER_ID, {
  describe,
  it,
  expect,
  settings: { directory: kitDirectory },
  secrets: {},
  // The URL names this deployment's own download route; the kit reads the bytes through the same verification that route would do.
  readSignedUrl: async (url) => {
    const verdict = verifyLocalFsToken(tokenOf(url));
    if (!verdict.ok) throw new Error(`token refused: ${verdict.reason}`);
    return collect(await new LocalFsStorageProvider(kitDirectory).download(verdict.key));
  },
});

// ---- 2. signed URLs ------------------------------------------------------------------

describe('local-fs signed URLs', () => {
  const now = Math.floor(Date.now() / 1000);

  it('verify what they sign, and carry no secret of their own (the key is derived from SECRETS_ENCRYPTION_KEY)', () => {
    const token = signLocalFsToken('exports/users/u/report.csv', now + 60);

    expect(verifyLocalFsToken(token)).toEqual({ ok: true, key: 'exports/users/u/report.csv' });
    expect(token).not.toContain(process.env.SECRETS_ENCRYPTION_KEY ?? '\u0000');
  });

  it('refuse an expired token, a tampered payload or signature, and garbage', () => {
    const [payload, signature] = signLocalFsToken('a/b.txt', now + 60).split('.');
    const forged = Buffer.from(JSON.stringify({ k: 'other/key', e: now + 60 })).toString('base64url');

    expect(verifyLocalFsToken(signLocalFsToken('a/b.txt', now - 1))).toEqual({ ok: false, reason: 'expired' });
    expect(verifyLocalFsToken(`${forged}.${signature}`)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyLocalFsToken(`${payload}.${signature.slice(0, -2)}AA`)).toEqual({ ok: false, reason: 'invalid' });
    for (const garbage of ['', 'nope', 'a.b.c', `${payload}.`]) {
      expect(verifyLocalFsToken(garbage)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('are produced for the deployment origin and the key, and refuse a key that escapes the directory', async () => {
    const provider = new LocalFsStorageProvider(kitDirectory, 'https://app.example.test');

    const url = await provider.getSignedDownloadUrl('avatars/u/a.png', { expiresIn: 30 });
    expect(url.startsWith(`https://app.example.test${LOCAL_FS_URL_PATH}`)).toBe(true);
    expect(verifyLocalFsToken(tokenOf(url))).toEqual({ ok: true, key: 'avatars/u/a.png' });

    for (const key of ['../escape', 'a/../../escape', '/etc/passwd', 'a\\b', '', 'a\0b']) {
      await expect(provider.getSignedDownloadUrl(key)).rejects.toThrow(/Refusing the object key/);
      await expect(provider.upload(key, Readable.from(['x']), { mimeType: 'text/plain' })).rejects.toThrow(/Refusing the object key/);
    }
  });
});

// ---- 3 to 6. the real application ---------------------------------------------------

describe('local-fs, selected by an administrator, serves every storage consumer', () => {
  let context: TestContext;
  let directory: string;
  let stored: Record<string, unknown>;
  let version: number;

  const server = () => context.app.getHttpServer();
  const credentials = { describe: jest.fn(), setSecret: jest.fn(), getSecret: jest.fn(), deleteSecret: jest.fn() };

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [{ provide: CredentialsService, useValue: credentials }],
    });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    directory = mkdtempSync(join(tmpdir(), 'local-fs-app-'));

    credentials.describe.mockReset().mockResolvedValue(null);
    credentials.getSecret.mockReset().mockResolvedValue(null);
    credentials.setSecret.mockReset().mockResolvedValue(undefined);

    // A stateful `system_settings` row: a fresh install (nothing stored).
    stored = {};
    version = 1;
    context.prismaMock.systemSettings.findUnique.mockImplementation(async () => ({
      id: 'settings-global',
      key: 'global',
      value: stored,
      version,
      updatedAt: new Date('2026-03-03T00:00:00.000Z'),
      updatedByUserId: 'admin-1',
      updatedByUser: { id: 'admin-1', email: 'admin@example.com' },
    }));
    context.prismaMock.systemSettings.update.mockImplementation(async ({ data }: { data: { value: Record<string, unknown> } }) => {
      stored = data.value;
      version += 1;
      return {
        id: 'settings-global',
        key: 'global',
        value: stored,
        version,
        updatedAt: new Date(),
        updatedByUserId: 'admin-1',
        updatedByUser: { id: 'admin-1', email: 'admin@example.com' },
      };
    });
    context.prismaMock.auditEvent.create.mockResolvedValue({} as never);
    context.prismaMock.storageObject.count.mockResolvedValue(0);
    context.prismaMock.databaseBackupRun.count.mockResolvedValue(0);
    context.app.get(StorageConfigService).invalidateCache();
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  /** Selects the driver the way the admin page does. */
  async function selectLocalFs(): Promise<void> {
    const admin = await createMockAdminUser(context);
    await request(server())
      .put('/api/admin/storage-config')
      .set(authHeader(admin.accessToken))
      .send({ provider: LOCAL_FS_DRIVER_ID, drivers: { [LOCAL_FS_DRIVER_ID]: { directory } } })
      .expect(200);
  }

  const adminView = async () => {
    const admin = await createMockAdminUser(context);
    return (await request(server()).get('/api/admin/storage-config').set(authHeader(admin.accessToken)).expect(200)).body.data;
  };

  it('is registered after the built-ins, listed with a generated form, and OFF until selected', async () => {
    expect(storageDriverIds()).toEqual(['s3', 'r2', 's3compatible', LOCAL_FS_DRIVER_ID]);
    expect(getStorageDriver(LOCAL_FS_DRIVER_ID)?.label).toBe('Local filesystem');

    const view = await adminView();

    // A fresh install keeps S3 and is not configured; the example only appears in the list.
    expect(view).toMatchObject({ provider: 's3', configured: false });
    const descriptor = view.descriptors.find((d: { id: string }) => d.id === LOCAL_FS_DRIVER_ID);
    expect(descriptor).toMatchObject({ kind: 'storage-driver', id: LOCAL_FS_DRIVER_ID, label: 'Local filesystem' });
    // One setting, no secret field at all: the form is just a directory.
    expect(descriptor.fields).toEqual([expect.objectContaining({ name: 'directory', kind: 'string', maxLength: 512 })]);
    expect(view.drivers[LOCAL_FS_DRIVER_ID]).toEqual({ directory: '' });
  });

  it('is selected, tested and provisioned through the admin routes, with no secret', async () => {
    const admin = await createMockAdminUser(context);
    const auth = authHeader(admin.accessToken);

    // Test BEFORE saving: the body is the configuration under test.
    const tested = await request(server())
      .post('/api/admin/storage-config/test')
      .set(auth)
      .send({ provider: LOCAL_FS_DRIVER_ID, drivers: { [LOCAL_FS_DRIVER_ID]: { directory } } })
      .expect(200);
    expect(tested.body.data).toMatchObject({
      success: true,
      provider: LOCAL_FS_DRIVER_ID,
      bucket: directory,
      usedStoredSecret: false,
      checks: [],
      details: { directory, writable: true },
    });
    expect(tested.body.data.message).toContain('Wrote, read back and deleted a probe file');

    // Create the folder.
    const provisioned = await request(server())
      .post('/api/admin/storage-config/bucket')
      .set(auth)
      .send({ provider: LOCAL_FS_DRIVER_ID, drivers: { [LOCAL_FS_DRIVER_ID]: { directory } } })
      .expect(200);
    expect(provisioned.body.data).toMatchObject({ outcome: 'created', provider: LOCAL_FS_DRIVER_ID, bucket: directory });
    expect(await readdir(directory)).toEqual(expect.arrayContaining(['objects', '.meta', '.tmp']));

    // Save it.
    await selectLocalFs();
    expect(stored.storage).toEqual({
      provider: LOCAL_FS_DRIVER_ID,
      drivers: expect.objectContaining({ [LOCAL_FS_DRIVER_ID]: { directory }, s3: expect.any(Object) }),
    });
    expect(Object.keys(stored.storage as object).sort()).toEqual(['drivers', 'provider']);

    const view = await adminView();
    expect(view).toMatchObject({ provider: LOCAL_FS_DRIVER_ID, configured: true, missing: [], effectiveEndpoint: null });
    // The deprecated flat view is empty for a driver that declares none of those fields.
    expect(view).toMatchObject({ bucket: '', region: '', accessKeyId: '' });
    // Nothing was ever sent to the credential store: the driver declares no secret.
    expect(credentials.setSecret).not.toHaveBeenCalled();
  });

  it('refuses an unknown driver and a settings value the driver rejects, with a 400', async () => {
    const admin = await createMockAdminUser(context);
    const auth = authHeader(admin.accessToken);

    const unknown = await request(server()).put('/api/admin/storage-config').set(auth).send({ provider: 'azure-blob' }).expect(400);
    expect(unknown.body.details).toMatchObject({ reason: 'STORAGE_UNKNOWN_DRIVER', driver: 'azure-blob' });

    const invalid = await request(server())
      .put('/api/admin/storage-config')
      .set(auth)
      .send({ provider: LOCAL_FS_DRIVER_ID, drivers: { [LOCAL_FS_DRIVER_ID]: { directory: 'x'.repeat(513) } } })
      .expect(400);
    expect(JSON.stringify(invalid.body)).toMatch(/STORAGE_DRIVER_SETTINGS_INVALID|directory/);
    expect(stored).toEqual({});
  });

  it('hands every storage consumer the one provider the settings select', async () => {
    await selectLocalFs();

    const storage = context.module.get<StorageProvider>(STORAGE_PROVIDER, { strict: false });
    expect(storage).toBeInstanceOf(ResolvingStorageProvider);
    expect(context.module.get(ObjectsService, { strict: false })).toBeDefined();

    // The first call resolves the active driver and builds it: the filesystem, no S3 client.
    await storage.exists('probe/none');
    expect(storage.kind).toBe(LOCAL_FS_DRIVER_ID);
    expect(storage.getBucket()).toBe(directory);
  });

  it('a profile image upload lands under the directory and is recorded with the driver', async () => {
    await selectLocalFs();
    const user = await createMockTestUser(context);
    setupMockUserSettings(user.id, { theme: 'system', profile: { imageSource: 'provider', imageObjectId: null } });

    const newObjectId = '33333333-3333-4333-8333-333333333333';
    context.prismaMock.storageObject.create.mockResolvedValue({ id: newObjectId } as never);
    context.prismaMock.storageObject.findUnique.mockResolvedValue({
      id: newObjectId,
      uploadedById: user.id,
      storageKey: `avatars/${user.id}/avatar.png`,
      status: 'ready',
      mimeType: 'image/png',
      metadata: { purpose: 'avatar' },
    } as never);

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
    const response = await request(server())
      .post('/api/user-settings/profile-image')
      .set(authHeader(user.accessToken))
      .attach('file', png, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(200);
    expect(response.body.data.settings.profile.imageObjectId).toBe(newObjectId);

    const row = (context.prismaMock.storageObject.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(row).toMatchObject({ storageProvider: LOCAL_FS_DRIVER_ID, bucket: directory, mimeType: 'image/png', status: 'ready' });

    const stored = await readFile(join(directory, 'objects', String(row.storageKey)));
    expect(stored.equals(png)).toBe(true);
    expect(JSON.parse(await readFile(join(directory, '.meta', `${row.storageKey}.json`), 'utf8'))).toMatchObject({
      mimeType: 'image/png',
      metadata: { purpose: 'avatar' },
    });
  });

  it('an export job writes its output through it', async () => {
    await selectLocalFs();
    const handler = context.module.get(ExportRunHandler, { strict: false });
    const userId = '11111111-1111-4111-8111-111111111111';
    const orgId = '22222222-2222-4222-8222-222222222222';
    const jobId = '44444444-4444-4444-8444-444444444444';

    // The example source reads the caller's notifications through the system client.
    context.prismaMock.notification.findMany.mockResolvedValue([
      { id: 'n1', userId, title: 'Hello', body: 'World', readAt: null, createdAt: new Date('2026-10-01T00:00:00.000Z') },
    ] as never);
    // The org transaction that commits the row and the result.
    (context.prismaMock.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(context.prismaMock));
    context.prismaMock.storageObject.upsert.mockResolvedValue({ id: 'object-1' } as never);
    context.prismaMock.job.update.mockResolvedValue({} as never);

    await handler.process({
      id: jobId,
      type: 'export.run',
      subjectType: 'user',
      subjectId: userId,
      attempts: 1,
      payload: { source: 'example-notification-inbox', format: 'json', scope: 'user', subjectId: userId, requestedById: userId, orgId, request: {} },
    } as never);

    const key = `exports/users/${userId}/${jobId}.json`;
    const file = JSON.parse(await readFile(join(directory, 'objects', key), 'utf8'));
    expect(file.source).toBe('example-notification-inbox');

    const created = (context.prismaMock.storageObject.upsert.mock.calls[0][0] as { create: Record<string, unknown> }).create;
    expect(created).toMatchObject({ storageKey: key, storageProvider: LOCAL_FS_DRIVER_ID, bucket: directory, status: 'ready' });
  });

  it('a database backup writes its archive through it, and a custom driver kind is a usable databaseBackup.storageProvider', async () => {
    await selectLocalFs();
    const runner = context.module.get(DatabaseBackupRunnerService, { strict: false });

    // `pg_dump` is replaced by the engine seam: this is the archive.
    const dump = Buffer.from('PGDMP-local-fs-archive-bytes');
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
    const rows = new Map<string, Record<string, unknown>>();
    context.prismaMock.databaseBackupRun.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      rows.set(String(data.id), { ...data });
      return { ...data } as never;
    });
    context.prismaMock.databaseBackupRun.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = { ...(rows.get(where.id) ?? {}), ...data };
      rows.set(where.id, row);
      return row as never;
    });
    context.prismaMock.databaseBackupRun.findFirst.mockResolvedValue(null);
    // The queue is not under test: the retention sweep a completed backup enqueues is a stub.
    jest.spyOn(context.app.get(JobsService), 'enqueue').mockResolvedValue({ id: 'job-sweep' } as never);

    // `databaseBackup.storageProvider` is a free string: it can pin a backup to a driver an app registered.
    const admin = await createMockAdminUser(context);
    await request(server())
      .patch('/api/system-settings')
      .set(authHeader(admin.accessToken))
      .send({ databaseBackup: { storageProvider: LOCAL_FS_DRIVER_ID } })
      .expect(200);
    expect((stored.databaseBackup as { storageProvider: string }).storageProvider).toBe(LOCAL_FS_DRIVER_ID);
    await runner.assertStorageProviderUsable(LOCAL_FS_DRIVER_ID);
    // A pin on a driver that is not the active one is still a loud refusal.
    await expect(runner.assertStorageProviderUsable('azure-blob')).rejects.toThrow(/azure-blob/);

    const run = await runner.startBackup({ trigger: 'manual', createdById: 'admin-1' });
    for (let attempt = 0; attempt < 400 && rows.get(run.id)?.status !== 'completed'; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(rows.get(run.id)).toMatchObject({ status: 'completed', storageProvider: LOCAL_FS_DRIVER_ID, bucket: directory });
    expect((await readFile(join(directory, 'objects', run.storageKey))).equals(dump)).toBe(true);
  });

  it('keeps a legacy flat row working: selecting back to s3 finds the old settings, untouched', async () => {
    // A row an earlier release stored.
    stored = {
      storage: { provider: 's3', bucket: 'legacy-bucket', region: 'us-west-2', endpoint: '', accountId: '', accessKeyId: 'AKIALEGACY', forcePathStyle: null },
    };

    expect(await adminView()).toMatchObject({
      provider: 's3',
      bucket: 'legacy-bucket',
      drivers: { s3: { bucket: 'legacy-bucket', region: 'us-west-2', accessKeyId: 'AKIALEGACY' } },
    });

    await selectLocalFs();
    const admin = await createMockAdminUser(context);
    await request(server())
      .put('/api/admin/storage-config')
      .set(authHeader(admin.accessToken))
      .send({ provider: 's3', confirmation: 'SWITCH' })
      .expect(200);

    // Switching away and back kept the S3 settings under their driver.
    expect((stored.storage as { drivers: Record<string, unknown> }).drivers.s3).toMatchObject({ bucket: 'legacy-bucket', accessKeyId: 'AKIALEGACY' });
  });

  it('writes under the system temp directory when no directory is configured, and declares no secret', () => {
    expect(resolveLocalFsDirectory({ directory: '' }).startsWith(tmpdir())).toBe(true);
    expect(resolveLocalFsDirectory({ directory: directory })).toBe(directory);
    expect(storageDriverKind.has(LOCAL_FS_DRIVER_ID)).toBe(true);
    expect(localFsStorageDriver.secrets).toBeUndefined();
  });
});

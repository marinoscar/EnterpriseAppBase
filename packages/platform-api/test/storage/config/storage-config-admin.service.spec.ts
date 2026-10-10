import { BadRequestException, ConflictException } from '@nestjs/common';

import { StorageConfigAdminService } from '../../../src/storage/config/storage-config-admin.service';
import { STORAGE_SWITCH_CONFIRMATION } from '../../../src/storage/config/dto/update-storage-config.dto';
import type { UpdateStorageConfigInput } from '../../../src/storage/config/dto/update-storage-config.dto';
import type { SystemStorageValue } from '@marinoscar/platform-contract/storage';
import { z } from 'zod';
import { STORAGE_SYSTEM_SETTINGS } from '../../../src/storage/config/storage.system-settings';
import { registerStorageDriver } from '../../../src/storage/drivers/storage-driver';

// =============================================================================
// StorageConfigAdminService — tests (issue #375, epic #372)
// =============================================================================
//
// Four properties, and each of them is something that breaks a deployment
// quietly if it regresses:
//
//   1. THE READ NEVER DECRYPTS. `getSecret` is the one method that yields
//      plaintext and this service must never call it — there is an explicit
//      negative assertion, not merely an absence of one.
//   2. BLANK PRESERVES. An admin correcting a typo in the region must not have
//      the deployment's credential wiped because the form rendered the secret
//      field empty.
//   3. THE SWITCH GATE fires on a real relocation with real rows behind it, and
//      stays silent on a first configuration, a cosmetic edit, or an empty
//      deployment. A gate that cries wolf is a gate people learn to click past.
//   4. `invalidateCache()` HAPPENS BEFORE THE AUDIT WRITE. Ordering is the whole
//      point: anything awaited in between widens the window in which this
//      instance still answers storage questions from the pre-save value.
// =============================================================================

const SECRET_INFO = {
  purpose: 'storage',
  name: 'default',
  hint: '••••x9fQ',
  label: 'Storage secret access key',
  updatedByUserId: 'admin-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-02-02T00:00:00.000Z'),
};

const SETTINGS_ROW = {
  version: 7,
  updatedAt: new Date('2026-03-03T00:00:00.000Z'),
  updatedByUser: { id: 'admin-1', email: 'admin@example.com' },
};

// What `getStoragePolicy()` returns: the namespace's own `read` over a stored
// row in the current shape (PP-14.7). `overrides` are the active driver's
// settings, plus `provider`.
function policy(overrides: Record<string, unknown> = {}): SystemStorageValue {
  const { provider = 's3', ...settings } = overrides;

  return STORAGE_SYSTEM_SETTINGS.read(
    {
      provider,
      drivers: {
        [provider as string]: {
          bucket: 'live-bucket',
          region: 'us-west-2',
          endpoint: '',
          accountId: '',
          accessKeyId: 'AKIAEXAMPLE',
          forcePathStyle: null,
          ...settings,
        },
      },
    },
    {
      asPlainObject: (value: unknown) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined),
    } as never,
  );
}

// The flat body the web page has always sent (the legacy aliases of the active driver's settings).
function body(overrides: Partial<UpdateStorageConfigInput> = {}): UpdateStorageConfigInput {
  return {
    provider: 's3',
    bucket: 'live-bucket',
    region: 'us-west-2',
    endpoint: '',
    accountId: '',
    accessKeyId: 'AKIAEXAMPLE',
    forcePathStyle: null,
    secretAccessKey: undefined,
    confirmation: undefined,
    ...overrides,
  };
}

// A driver an app registered: a directory, one required secret, no bucket.
registerStorageDriver({
  id: 'toy-store',
  label: 'Toy store',
  settingsSchema: z.object({ directory: z.string() }),
  defaults: { directory: '' },
  secrets: [{ name: 'token', label: 'Token', required: true }],
  build: () => {
    throw new Error('not built here');
  },
  testConnection: async () => ({ ok: true, message: 'ok' }),
  location: (settings) => ({ bucket: String(settings.directory) }),
  missing: (settings, secrets) => [...(settings.directory ? [] : ['directory']), ...(secrets.token ? [] : ['token'])],
});

describe('StorageConfigAdminService', () => {
  let service: StorageConfigAdminService;
  let prisma: any;
  let systemSettings: { getStoragePolicy: jest.Mock; patchSettings: jest.Mock };
  let credentials: { describe: jest.Mock; setSecret: jest.Mock; getSecret: jest.Mock };
  let storageConfig: { invalidateCache: jest.Mock };
  /** Every mutating call, in the order it happened. See property 4 above. */
  let order: string[];

  beforeEach(() => {
    order = [];

    prisma = {
      systemSettings: { findUnique: jest.fn().mockResolvedValue(SETTINGS_ROW) },
      storageObject: { count: jest.fn().mockResolvedValue(0) },
      databaseBackupRun: { count: jest.fn().mockResolvedValue(0) },
      auditEvent: {
        create: jest.fn().mockImplementation(async () => {
          order.push('audit');
          return {};
        }),
      },
    };

    systemSettings = {
      getStoragePolicy: jest.fn().mockResolvedValue(policy()),
      patchSettings: jest.fn().mockImplementation(async () => {
        order.push('patchSettings');
        return {};
      }),
    };

    credentials = {
      describe: jest.fn().mockResolvedValue(SECRET_INFO),
      setSecret: jest.fn().mockImplementation(async () => {
        order.push('setSecret');
      }),
      getSecret: jest.fn(),
    };

    storageConfig = {
      invalidateCache: jest.fn().mockImplementation(() => {
        order.push('invalidateCache');
      }),
    };

    service = new StorageConfigAdminService(
      prisma,
      systemSettings as never,
      credentials as never,
      storageConfig as never,
      // The usage count reads every organization's rows through the system client (#725).
      { asSystem: jest.fn().mockReturnValue(prisma) } as never,
    );
  });

  // ==========================================================================
  // The read
  // ==========================================================================

  describe('describeForAdmin', () => {
    it('returns the settings plus a MASKED secret status, and never decrypts', async () => {
      const result = await service.describeForAdmin();

      expect(result.accessKeyId).toBe('AKIAEXAMPLE');
      expect(result.secretStatus).toEqual({
        configured: true,
        hint: '••••x9fQ',
        updatedAt: '2026-02-02T00:00:00.000Z',
        updatedByUserId: 'admin-1',
      });
      // ⚠ The negative assertion that matters: an admin READ has no business
      // holding plaintext, so the plaintext-yielding method is never called.
      expect(credentials.getSecret).not.toHaveBeenCalled();
      expect(credentials.describe).toHaveBeenCalledWith('storage', 'default');
      expect(JSON.stringify(result)).not.toContain('credential present');
    });

    it('reports `configured` from the single definition, and names what is missing', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(policy({ bucket: '', region: '' }));
      credentials.describe.mockResolvedValue(null);

      const result = await service.describeForAdmin();

      expect(result.configured).toBe(false);
      expect(result.missing).toEqual(
        expect.arrayContaining(['bucket', 'region', 'secretAccessKey']),
      );
      expect(result.secretStatus.configured).toBe(false);
    });

    it('a stored credential alone is enough to clear secretAccessKey from `missing`', async () => {
      const result = await service.describeForAdmin();

      expect(result.configured).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('derives R2’s endpoint so a settings page never has to build that host', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(
        policy({ provider: 'r2', region: 'auto', accountId: 'acct123', endpoint: '' }),
      );

      const result = await service.describeForAdmin();

      expect(result.effectiveEndpoint).toBe('https://acct123.r2.cloudflarestorage.com');
      // The stored field is untouched: `endpoint` is what a PUT writes.
      expect(result.endpoint).toBe('');
    });

    it('still shows a derived endpoint for a half-filled form that cannot resolve', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(
        policy({ provider: 'r2', region: 'auto', accountId: 'acct123', bucket: '' }),
      );

      const result = await service.describeForAdmin();

      expect(result.configured).toBe(false);
      expect(result.effectiveEndpoint).toBe('https://acct123.r2.cloudflarestorage.com');
    });

    it('does NOT create the settings row as a side effect of being read', async () => {
      prisma.systemSettings.findUnique.mockResolvedValue(null);

      const result = await service.describeForAdmin();

      expect(result.version).toBe(0);
      expect(result.updatedAt).toBeNull();
      expect(prisma.systemSettings.findUnique).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // If-Match
  // ==========================================================================

  describe('optimistic concurrency', () => {
    it('refuses a stale If-Match BEFORE the credential is touched', async () => {
      await expect(service.replace(body({ secretAccessKey: 'new' }), 'admin-1', 3)).rejects.toThrow(
        ConflictException,
      );

      // ⚠ The point of checking here as well as inside `patchSettings`: a loser
      // must not have already rotated the deployment's secret out from under
      // the winner by the time it learns it lost.
      expect(credentials.setSecret).not.toHaveBeenCalled();
      expect(systemSettings.patchSettings).not.toHaveBeenCalled();
    });

    it('passes the expected version through so the write is checked again', async () => {
      await service.replace(body(), 'admin-1', 7);

      expect(systemSettings.patchSettings).toHaveBeenCalledWith(
        { storage: expect.objectContaining({ provider: 's3', bucket: 'live-bucket' }) },
        'admin-1',
        7,
      );
    });

    it('treats an absent If-Match as an unconditional overwrite', async () => {
      await service.replace(body(), 'admin-1', undefined);

      expect(systemSettings.patchSettings).toHaveBeenCalledWith(
        expect.anything(),
        'admin-1',
        undefined,
      );
    });
  });

  // ==========================================================================
  // Blank preserves
  // ==========================================================================

  describe('the secret access key', () => {
    it.each([
      ['omitted', undefined],
      ['null', null],
      ['the empty string', ''],
    ] as Array<[string, string | null | undefined]>)(
      '%s leaves the stored secret completely alone',
      async (_label, secretAccessKey) => {
        await service.replace(body({ secretAccessKey }), 'admin-1');

        // Not even a metadata-only write: `setSecret` raises a 400 for a blank
        // secret at an address that does not exist yet, which is exactly the
        // first save of a half-filled form.
        expect(credentials.setSecret).not.toHaveBeenCalled();
        expect(systemSettings.patchSettings).toHaveBeenCalled();
      },
    );

    it('a non-blank value rotates the credential, with the label and the actor', async () => {
      await service.replace(body({ secretAccessKey: 'brand-new-secret' }), 'admin-1');

      expect(credentials.setSecret).toHaveBeenCalledWith(
        'storage',
        'default',
        'brand-new-secret',
        { label: 'Storage secret access key', updatedByUserId: 'admin-1' },
      );
    });

    it('never puts the submitted secret in the audit row — only whether one was written', async () => {
      await service.replace(body({ secretAccessKey: 'brand-new-secret' }), 'admin-1');

      const data = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(data.meta.secretRotated).toBe(true);
      expect(JSON.stringify(data)).not.toContain('brand-new-secret');
    });
  });

  // ==========================================================================
  // The switch gate
  // ==========================================================================

  describe('the switch gate', () => {
    /** Pretend the old location still holds things. */
    function withRows(objects = 1284, backups = 30): void {
      prisma.storageObject.count.mockResolvedValue(objects);
      prisma.databaseBackupRun.count.mockResolvedValue(backups);
    }

    it('refuses a bucket change with a 409 that NAMES THE COUNTS', async () => {
      withRows();

      const error = await service
        .replace(body({ bucket: 'new-bucket' }), 'admin-1')
        .catch((thrown) => thrown);

      expect(error).toBeInstanceOf(ConflictException);
      const response = error.getResponse();
      expect(response.code).toBe('STORAGE_LOCATION_IN_USE');
      // "Are you sure?" is not a question anyone can answer. These numbers are.
      expect(response.message).toContain('1284 stored object(s)');
      expect(response.message).toContain('30 database backup(s)');
      expect(response.message).toContain('does NOT copy them');
      expect(response.details.confirmation).toBe('SWITCH');
      expect(response.details.from.bucket).toBe('live-bucket');
      expect(response.details.to.bucket).toBe('new-bucket');
      // And nothing was written.
      expect(systemSettings.patchSettings).not.toHaveBeenCalled();
      expect(credentials.setSecret).not.toHaveBeenCalled();
    });

    it('refuses a provider change', async () => {
      withRows(5, 0);

      await expect(
        service.replace(
          body({ provider: 'r2', region: 'auto', accountId: 'acct123' }),
          'admin-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses an R2 ACCOUNT change — the effective endpoint moved, though `endpoint` did not', async () => {
      // The raw `endpoint` field is empty on both sides; only the derived host
      // differs. Comparing the raw field would let "move to another Cloudflare
      // account" through without a word.
      systemSettings.getStoragePolicy.mockResolvedValue(
        policy({ provider: 'r2', region: 'auto', accountId: 'old-acct' }),
      );
      withRows(3, 0);

      await expect(
        service.replace(
          body({ provider: 'r2', region: 'auto', accountId: 'new-acct' }),
          'admin-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('allows a region, key-id or path-style edit — those reach the same bytes', async () => {
      withRows();

      await service.replace(
        body({ region: 'eu-west-1', accessKeyId: 'AKIANEW', forcePathStyle: true }),
        'admin-1',
      );

      expect(systemSettings.patchSettings).toHaveBeenCalled();
    });

    it('allows the switch when the caller typed the word', async () => {
      withRows();

      await service.replace(
        body({ bucket: 'new-bucket', confirmation: STORAGE_SWITCH_CONFIRMATION }),
        'admin-1',
      );

      expect(systemSettings.patchSettings).toHaveBeenCalled();
      expect(prisma.auditEvent.create.mock.calls[0][0].data.meta.switchConfirmed).toBe(true);
    });

    it('stays silent when nothing is stored at the old location', async () => {
      prisma.storageObject.count.mockResolvedValue(0);
      prisma.databaseBackupRun.count.mockResolvedValue(0);

      await service.replace(body({ bucket: 'new-bucket' }), 'admin-1');

      expect(systemSettings.patchSettings).toHaveBeenCalled();
    });

    it('stays silent on a FIRST configuration — there is no old location', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(policy({ bucket: '' }));
      withRows();

      await service.replace(body({ bucket: 'first-bucket' }), 'admin-1');

      expect(systemSettings.patchSettings).toHaveBeenCalled();
      // It does not even ask: with no old location there is nothing to count.
      expect(prisma.storageObject.count).not.toHaveBeenCalled();
    });

    it('counts the rows that would be stranded, and excludes the ones that would not', async () => {
      withRows();

      await service
        .replace(body({ bucket: 'new-bucket' }), 'admin-1')
        .catch(() => undefined);

      expect(prisma.storageObject.count).toHaveBeenCalledWith({
        where: {
          storageProvider: 's3',
          // Legacy rows with a null bucket are in whatever bucket was in use at
          // the time, which is the current one — the oldest and least
          // replaceable data in the deployment.
          OR: [{ bucket: 'live-bucket' }, { bucket: null }],
          // A failed upload has no bytes at the old location to lose.
          status: { not: 'failed' },
        },
      });
      expect(prisma.databaseBackupRun.count).toHaveBeenCalledWith({
        where: {
          storageProvider: 's3',
          bucket: 'live-bucket',
          // `failed`/`stale` archives are not offered for restore anywhere.
          status: { in: ['pending', 'running', 'completed'] },
        },
      });
    });
  });

  // ==========================================================================
  // ⚠ Cache invalidation ordering
  // ==========================================================================

  describe('cache invalidation', () => {
    it('invalidates SYNCHRONOUSLY after the write and BEFORE the audit row', async () => {
      await service.replace(body({ secretAccessKey: 'rotated' }), 'admin-1');

      // Anything awaited between the write and the invalidation widens the
      // window in which this instance still answers from the pre-save value —
      // which an admin experiences as "I fixed the bucket and it still failed".
      expect(order).toEqual(['setSecret', 'patchSettings', 'invalidateCache', 'audit']);
    });

    it('does not invalidate at all when the save was refused', async () => {
      prisma.storageObject.count.mockResolvedValue(9);

      await service
        .replace(body({ bucket: 'new-bucket' }), 'admin-1')
        .catch(() => undefined);

      expect(storageConfig.invalidateCache).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Auditing
  // ==========================================================================

  describe('auditing', () => {
    it('records the whole non-secret namespace against the stable settings key', async () => {
      await service.replace(body({ bucket: 'live-bucket', region: 'eu-west-1' }), 'admin-1');

      const data = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(data.action).toBe('storage_config:replace');
      expect(data.actorUserId).toBe('admin-1');
      expect(data.targetType).toBe('system_settings');
      // Not a row id: a first save can audit before anyone has read the row back.
      expect(data.targetId).toBe('storage');
      expect(data.meta.settings.drivers.s3.region).toBe('eu-west-1');
      expect(data.meta.settings.provider).toBe('s3');
      expect(data.meta.settings).not.toHaveProperty('secretAccessKey');
    });
  });

  // ==========================================================================
  // Drivers an app registered (PP-14.7)
  // ==========================================================================

  describe('a registered non-S3 driver', () => {
    const toyBody = (overrides: Record<string, unknown> = {}): UpdateStorageConfigInput =>
      ({ provider: 'toy-store', drivers: { 'toy-store': { directory: '/data/objects' } }, ...overrides }) as UpdateStorageConfigInput;

    it('describes every registered driver, with secret presence per driver and never a value', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(policy({ provider: 'toy-store', directory: '/data/objects' }));
      credentials.describe.mockImplementation(async (purpose: string) => (purpose === 'storage_toy-store' ? { ...SECRET_INFO, purpose } : null));

      const result = await service.describeForAdmin();

      expect(result.provider).toBe('toy-store');
      expect(result.configured).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.drivers['toy-store']).toEqual({ directory: '/data/objects' });
      expect(result.drivers.s3).toBeDefined();
      expect(result.descriptors.map((descriptor) => descriptor.id)).toEqual(expect.arrayContaining(['s3', 'r2', 's3compatible', 'toy-store']));
      const toy = result.descriptors.find((descriptor) => descriptor.id === 'toy-store');
      expect(toy?.fields).toEqual([
        expect.objectContaining({ name: 'directory', kind: 'string' }),
        { name: 'token', label: 'Token', kind: 'secret', hasValue: true, required: true },
      ]);
      // The built-ins keep their secret at the address it has always had.
      expect(result.descriptors.find((descriptor) => descriptor.id === 's3')?.fields.at(-1)).toMatchObject({ name: 'secretAccessKey', kind: 'secret', hasValue: false });
      expect(result.secretStatus).toMatchObject({ configured: true, hint: '••••x9fQ' });
      // The deprecated flat view is empty for a driver that declares none of those fields.
      expect(result).toMatchObject({ bucket: '', region: '', endpoint: '', accountId: '', accessKeyId: '', forcePathStyle: null });
      expect(credentials.getSecret).not.toHaveBeenCalled();
    });

    it('names the driver\'s own missing fields', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(policy({ provider: 'toy-store', directory: '' }));
      credentials.describe.mockResolvedValue(null);

      expect((await service.describeForAdmin()).missing).toEqual(['directory', 'token']);
    });

    it('saves the driver\'s settings through `drivers`, and its secret at its own purpose', async () => {
      await service.replace(toyBody({ secrets: { 'toy-store': { token: 'brand-new-token' } } }), 'admin-1');

      expect(credentials.setSecret).toHaveBeenCalledWith('storage_toy-store', 'token', 'brand-new-token', {
        label: 'Token',
        updatedByUserId: 'admin-1',
      });
      expect(systemSettings.patchSettings).toHaveBeenCalledWith(
        { storage: { provider: 'toy-store', drivers: { 'toy-store': { directory: '/data/objects' } } } },
        'admin-1',
        undefined,
      );
      expect(JSON.stringify(prisma.auditEvent.create.mock.calls[0][0].data)).not.toContain('brand-new-token');
    });

    it('a blank per-driver secret keeps the stored one', async () => {
      await service.replace(toyBody({ secrets: { 'toy-store': { token: '' } } }), 'admin-1');

      expect(credentials.setSecret).not.toHaveBeenCalled();
    });

    it('relocating to it is gated by the same SWITCH confirmation, comparing driver and location', async () => {
      prisma.storageObject.count.mockResolvedValue(12);

      const error = await service.replace(toyBody(), 'admin-1').catch((thrown) => thrown);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse().details).toMatchObject({
        from: { provider: 's3', bucket: 'live-bucket' },
        to: { provider: 'toy-store', bucket: '/data/objects' },
      });
      expect(systemSettings.patchSettings).not.toHaveBeenCalled();
    });

    it.each([
      ['an unregistered driver', toyBody({ provider: 'nope' })],
      ['settings the driver refuses', toyBody({ drivers: { 'toy-store': { directory: 42 } } })],
      ['a flat alias contradicting drivers.<provider>', body({ drivers: { s3: { bucket: 'other' } } })],
    ])('refuses %s with a 400 before anything is written', async (_label, input) => {
      await expect(service.replace(input as UpdateStorageConfigInput, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);

      expect(credentials.setSecret).not.toHaveBeenCalled();
      expect(systemSettings.patchSettings).not.toHaveBeenCalled();
    });
  });
});

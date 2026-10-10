import type { CredentialsService } from '../../../src/credentials/index';
import type { SystemSettingsService } from '../../../src/settings/index';
import type { SystemStorageValue } from '@marinoscar/platform-contract/storage';
import { z } from 'zod';
import {
  STORAGE_CREDENTIAL_NAME,
  STORAGE_CREDENTIAL_PURPOSE,
} from '../../../src/storage/storage-credential.constants';
import { STORAGE_SYSTEM_SETTINGS } from '../../../src/storage/config/storage.system-settings';
import { registerStorageDriver } from '../../../src/storage/drivers/storage-driver';
import {
  STORAGE_POLICY_CACHE_MS,
  StorageConfigService,
} from '../../../src/storage/config/storage-config.service';

// =============================================================================
// StorageConfigService — tests (issue #373, epic #372)
// =============================================================================
//
// Mirrors `../../common/maintenance/maintenance-mode.service.spec.ts`'s
// cache-testing shape (fake timers advanced past the TTL, `invalidateCache`,
// `fresh`), because this service copies that same "{ value, readAt }" pattern
// for its settings half. What is specific to this service, and gets its own
// tests: the secret is fetched on every resolve and is never part of that
// cache, and `lastKnownBucket()` is a snapshot populated only by successful
// reads that named a bucket.
// =============================================================================

// What `getStoragePolicy()` returns: the namespace's own `read`, over a stored
// row in the current shape. `overrides` are the active driver's settings, plus
// `provider`.
function policy(overrides: Record<string, unknown> = {}): SystemStorageValue {
  const { provider = 's3', ...settings } = overrides;
  const stored = {
    provider,
    drivers: {
      [provider as string]: {
        bucket: 'configured-bucket',
        region: 'us-west-2',
        endpoint: 'https://object-store.internal',
        accountId: 'acct',
        accessKeyId: 'AKIAEXAMPLE',
        forcePathStyle: false,
        ...settings,
      },
    },
  };

  return STORAGE_SYSTEM_SETTINGS.read(stored, {
    asPlainObject: (value: unknown) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined),
  } as never);
}

// A driver an app would register: no bucket, no region, one required secret.
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

describe('StorageConfigService', () => {
  let systemSettings: { getStoragePolicy: jest.Mock };
  let credentials: { getSecret: jest.Mock };
  let service: StorageConfigService;

  beforeEach(() => {
    systemSettings = {
      getStoragePolicy: jest.fn().mockResolvedValue(policy()),
    };
    credentials = {
      getSecret: jest.fn().mockResolvedValue('the-secret-access-key'),
    };

    service = new StorageConfigService(
      systemSettings as unknown as SystemSettingsService,
      credentials as unknown as CredentialsService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // ===========================================================================
  // The settings-half cache
  // ===========================================================================

  describe('the settings cache', () => {
    it('reuses a recent settings read across resolves within the TTL', async () => {
      jest.useFakeTimers();

      await service.resolve();
      await service.resolve();

      expect(systemSettings.getStoragePolicy).toHaveBeenCalledTimes(1);
    });

    it('consults the row again once the TTL has passed', async () => {
      jest.useFakeTimers();

      await service.resolve();
      jest.advanceTimersByTime(STORAGE_POLICY_CACHE_MS + 1);
      await service.resolve();

      expect(systemSettings.getStoragePolicy).toHaveBeenCalledTimes(2);
    });

    it('is bypassed by { fresh: true }', async () => {
      await service.resolve();
      await service.resolve({ fresh: true });

      expect(systemSettings.getStoragePolicy).toHaveBeenCalledTimes(2);
    });

    it('is dropped by invalidateCache(), so the very next resolve reads the row', async () => {
      jest.useFakeTimers();

      await service.resolve();
      service.invalidateCache();
      await service.resolve();

      expect(systemSettings.getStoragePolicy).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // The secret is NEVER cached
  // ===========================================================================

  describe('the secret', () => {
    it('is read on every resolve, even when the settings half is served from cache', async () => {
      jest.useFakeTimers();

      await service.resolve();
      await service.resolve();
      await service.resolve();

      // The settings row was consulted once (cache hit twice)...
      expect(systemSettings.getStoragePolicy).toHaveBeenCalledTimes(1);
      // ...but the secret was fetched fresh on every single call. A rotation
      // must never be delayed by the settings TTL.
      expect(credentials.getSecret).toHaveBeenCalledTimes(3);
    });

    it('is looked up at the storage credential address', async () => {
      await service.resolve();

      expect(credentials.getSecret).toHaveBeenCalledWith(
        STORAGE_CREDENTIAL_PURPOSE,
        STORAGE_CREDENTIAL_NAME,
      );
    });

    it('resolveActiveConfig also re-reads the secret on every call', async () => {
      jest.useFakeTimers();

      await service.resolveActiveConfig();
      await service.resolveActiveConfig();

      expect(systemSettings.getStoragePolicy).toHaveBeenCalledTimes(1);
      expect(credentials.getSecret).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // resolveActiveConfig() — the narrow form
  // ===========================================================================

  describe('resolveActiveConfig()', () => {
    it('returns the config when configured', async () => {
      const config = await service.resolveActiveConfig();

      expect(config).not.toBeNull();
      expect(config?.bucket).toBe('configured-bucket');
    });

    it('returns null when not configured', async () => {
      credentials.getSecret.mockResolvedValue(null);

      const config = await service.resolveActiveConfig();

      expect(config).toBeNull();
    });
  });

  // ===========================================================================
  // lastKnownBucket()
  // ===========================================================================

  describe('lastKnownBucket()', () => {
    it('is null before any read has happened', () => {
      expect(service.lastKnownBucket()).toBeNull();
    });

    it('is populated by a successful settings read that names a bucket', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(
        policy({ bucket: 'first-bucket' }),
      );

      await service.resolve();

      expect(service.lastKnownBucket()).toBe('first-bucket');
    });

    it('is NOT populated by a read whose bucket is empty (the seeded default)', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(policy({ bucket: '' }));

      await service.resolve();

      expect(service.lastKnownBucket()).toBeNull();
    });

    it('is not cleared by a later read that comes back empty', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(
        policy({ bucket: 'first-bucket' }),
      );
      await service.resolve({ fresh: true });
      expect(service.lastKnownBucket()).toBe('first-bucket');

      systemSettings.getStoragePolicy.mockResolvedValue(policy({ bucket: '' }));
      await service.resolve({ fresh: true });

      expect(service.lastKnownBucket()).toBe('first-bucket');
    });

    it('is populated even when the credential half is missing (bucket-only readiness)', async () => {
      credentials.getSecret.mockResolvedValue(null);
      systemSettings.getStoragePolicy.mockResolvedValue(
        policy({ bucket: 'bucket-without-secret-yet' }),
      );

      await service.resolve();

      expect(service.lastKnownBucket()).toBe('bucket-without-secret-yet');
    });

    it('updates to the newest successfully-read bucket', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(
        policy({ bucket: 'bucket-one' }),
      );
      await service.resolve({ fresh: true });

      systemSettings.getStoragePolicy.mockResolvedValue(
        policy({ bucket: 'bucket-two' }),
      );
      await service.resolve({ fresh: true });

      expect(service.lastKnownBucket()).toBe('bucket-two');
    });
  });

  // ===========================================================================
  // activeProvider()
  // ===========================================================================

  describe('activeProvider()', () => {
    it('returns the live provider from the settings row', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(
        policy({ provider: 'r2' }),
      );

      expect(await service.activeProvider()).toBe('r2');
    });

    it('reflects a change once the cache is invalidated', async () => {
      jest.useFakeTimers();
      systemSettings.getStoragePolicy.mockResolvedValue(
        policy({ provider: 's3' }),
      );
      expect(await service.activeProvider()).toBe('s3');

      systemSettings.getStoragePolicy.mockResolvedValue(
        policy({ provider: 's3compatible' }),
      );
      service.invalidateCache();

      expect(await service.activeProvider()).toBe('s3compatible');
    });

    it('refreshes the synchronous lastKnownProvider() snapshot (PP-14.1)', async () => {
      expect(service.lastKnownProvider()).toBe('s3');

      systemSettings.getStoragePolicy.mockResolvedValue(
        policy({ provider: 'r2' }),
      );
      await service.activeProvider();

      expect(service.lastKnownProvider()).toBe('r2');
    });

    it('goes through the same cache as resolve(), so a fresh read costs one call', async () => {
      jest.useFakeTimers();

      await service.activeProvider();
      await service.resolve();

      expect(systemSettings.getStoragePolicy).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // resolve() — a failed settings read is not swallowed
  // ===========================================================================

  describe('a failed settings read', () => {
    it('propagates rather than degrading to a stale or default value', async () => {
      systemSettings.getStoragePolicy.mockRejectedValue(new Error('db down'));

      await expect(service.resolve()).rejects.toThrow('db down');
    });
  });

  // ===========================================================================
  // A driver an app registered (PP-14.7)
  // ===========================================================================

  describe('a registered non-S3 driver', () => {
    const toy = (settings: Record<string, unknown> = {}) =>
      policy({ provider: 'toy-store', directory: '/data/objects', ...settings });

    beforeEach(() => {
      systemSettings.getStoragePolicy.mockResolvedValue(toy());
    });

    it('is resolved with ITS settings, its location and its own secret address', async () => {
      credentials.getSecret.mockResolvedValue('toy-token');

      const resolution = await service.resolve();

      expect(resolution).toMatchObject({
        configured: true,
        config: { provider: 'toy-store', bucket: '/data/objects', settings: { directory: '/data/objects' }, secrets: { token: 'toy-token' } },
      });
      expect(credentials.getSecret).toHaveBeenCalledWith('storage_toy-store', 'token');
      expect(credentials.getSecret).not.toHaveBeenCalledWith(STORAGE_CREDENTIAL_PURPOSE, STORAGE_CREDENTIAL_NAME);
    });

    it("reports the driver's own missing fields, not the S3 ones", async () => {
      credentials.getSecret.mockResolvedValue(null);
      systemSettings.getStoragePolicy.mockResolvedValue(toy({ directory: '' }));

      expect(await service.resolve()).toEqual({ configured: false, provider: 'toy-store', missing: ['directory', 'token'] });
    });

    it('feeds the synchronous snapshots: kind and bucket follow the active driver', async () => {
      await service.resolve();

      expect(service.lastKnownProvider()).toBe('toy-store');
      expect(service.lastKnownBucket()).toBe('/data/objects');
    });
  });

  describe('a provider no driver is registered for (a removed package)', () => {
    it('is "not configured", missing `driver`, never a crash', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue({ ...policy(), provider: 'azure-blob' });

      expect(await service.resolve()).toEqual({ configured: false, provider: 'azure-blob', missing: ['driver'] });
      expect(credentials.getSecret).not.toHaveBeenCalled();
    });
  });
});

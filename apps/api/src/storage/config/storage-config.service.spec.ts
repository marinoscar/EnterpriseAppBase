import { Logger } from '@nestjs/common';

import type { CredentialsService } from '../../credentials/credentials.service';
import type { SystemSettingsService } from '../../settings/system-settings/system-settings.service';
import type { SystemStorageValue } from '../../common/schemas/settings.schema';
import {
  STORAGE_CREDENTIAL_NAME,
  STORAGE_CREDENTIAL_PURPOSE,
} from '../storage-credential.constants';
import {
  STORAGE_POLICY_CACHE_MS,
  StorageConfigService,
} from './storage-config.service';

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

function policy(overrides: Partial<SystemStorageValue> = {}): SystemStorageValue {
  return {
    provider: 's3',
    bucket: 'configured-bucket',
    region: 'us-west-2',
    endpoint: '',
    accountId: '',
    accessKeyId: 'AKIAEXAMPLE',
    forcePathStyle: false,
    ...overrides,
  };
}

/** The seeded, never-configured namespace — nothing saved through the API. */
function unconfiguredPolicy(
  overrides: Partial<SystemStorageValue> = {},
): SystemStorageValue {
  return policy({
    bucket: '',
    region: '',
    endpoint: '',
    accountId: '',
    accessKeyId: '',
    ...overrides,
  });
}

/**
 * ⚠ TEMPORARY (#377). The five variables the environment bridge reads.
 *
 * Listed here so the suite can CLEAR them before every test: this service is
 * the one place that touches `process.env`, and a developer (or a CI runner)
 * with `AWS_ACCESS_KEY_ID` exported in their shell must not change what these
 * tests assert. Deleted with the bridge.
 */
const STORAGE_ENV_KEYS = [
  'S3_BUCKET',
  'S3_REGION',
  'S3_ENDPOINT',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const;

describe('StorageConfigService', () => {
  let systemSettings: { getStoragePolicy: jest.Mock };
  let credentials: { getSecret: jest.Mock };
  let service: StorageConfigService;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = Object.fromEntries(
      STORAGE_ENV_KEYS.map((key) => [key, process.env[key]]),
    );
    for (const key of STORAGE_ENV_KEYS) {
      delete process.env[key];
    }

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
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

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
  // ⚠ TEMPORARY BRIDGE — the environment fallback (issue #377)
  // ===========================================================================
  //
  // Deleted by #377 with the code they cover. The rules themselves are pinned
  // in `storage-config.spec.ts`; what belongs HERE is the part that is this
  // service's own job: that it reads `process.env` at all, that it hands those
  // values to the resolver rather than deciding anything itself, that the
  // deprecation warning is emitted ONCE per process, and that the synchronous
  // `lastKnownBucket()` snapshot does not go blind on a deployment the
  // fallback is keeping alive.
  // ===========================================================================

  describe('the temporary environment fallback (#377)', () => {
    /**
     * Silenced for the whole block, and asserted on where it matters.
     *
     * A deprecation warning is meant to be seen by an operator, not by whoever
     * is reading a test run — and several tests here deliberately take the
     * fallback path, so without this the suite's output is mostly this one
     * sentence. `restoreAllMocks()` in the outer `afterEach` puts it back.
     */
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    function setFullEnv(overrides: Record<string, string> = {}): void {
      process.env.S3_BUCKET = 'env-bucket';
      process.env.S3_REGION = 'eu-central-1';
      process.env.AWS_ACCESS_KEY_ID = 'ENV-AKIA';
      process.env.AWS_SECRET_ACCESS_KEY = 'env-secret';

      for (const [key, value] of Object.entries(overrides)) {
        process.env[key] = value;
      }
    }

    it('resolves from the environment when nothing at all is saved', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(unconfiguredPolicy());
      credentials.getSecret.mockResolvedValue(null);
      setFullEnv();

      const resolution = await service.resolve();

      expect(resolution).toEqual({
        configured: true,
        fromEnvironment: true,
        config: {
          provider: 's3',
          bucket: 'env-bucket',
          region: 'eu-central-1',
          accessKeyId: 'ENV-AKIA',
          secretAccessKey: 'env-secret',
          forcePathStyle: false,
        },
      });
    });

    it('is invisible when nothing is set in the environment', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(unconfiguredPolicy());
      credentials.getSecret.mockResolvedValue(null);

      const resolution = await service.resolve();

      expect(resolution.configured).toBe(false);
    });

    it('never overrides saved settings, which win whole', async () => {
      setFullEnv();

      const config = await service.resolveActiveConfig();

      expect(config?.bucket).toBe('configured-bucket');
      expect(config?.secretAccessKey).toBe('the-secret-access-key');
    });

    it('does not complete a half-saved configuration from the environment', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(
        unconfiguredPolicy({ bucket: 'half-saved' }),
      );
      credentials.getSecret.mockResolvedValue(null);
      setFullEnv();

      expect(await service.resolveActiveConfig()).toBeNull();
    });

    it('re-reads the environment per call, so a change is picked up', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(unconfiguredPolicy());
      credentials.getSecret.mockResolvedValue(null);

      expect(await service.resolveActiveConfig()).toBeNull();

      setFullEnv();

      expect((await service.resolveActiveConfig())?.bucket).toBe('env-bucket');
    });

    it('writes nothing back: no settings are saved and no credential is created', async () => {
      systemSettings.getStoragePolicy.mockResolvedValue(unconfiguredPolicy());
      credentials.getSecret.mockResolvedValue(null);
      setFullEnv();

      await service.resolve();
      await service.resolve({ fresh: true });

      // The only two collaborators this service has, and it called nothing on
      // either of them but the two reads.
      expect(Object.keys(systemSettings)).toEqual(['getStoragePolicy']);
      expect(Object.keys(credentials)).toEqual(['getSecret']);
    });

    describe('the deprecation warning', () => {
      it('is emitted once, not per call', async () => {
        systemSettings.getStoragePolicy.mockResolvedValue(unconfiguredPolicy());
        credentials.getSecret.mockResolvedValue(null);
        setFullEnv();

        await service.resolve();
        await service.resolve();
        await service.resolve({ fresh: true });
        await service.resolveActiveConfig();

        expect(warn).toHaveBeenCalledTimes(1);
      });

      it('names the settings page that replaces it', async () => {
        systemSettings.getStoragePolicy.mockResolvedValue(unconfiguredPolicy());
        credentials.getSecret.mockResolvedValue(null);
        setFullEnv();

        await service.resolve();

        expect(warn.mock.calls[0]?.[0]).toContain('/admin/settings/storage');
      });

      it('never contains the secret access key', async () => {
        systemSettings.getStoragePolicy.mockResolvedValue(unconfiguredPolicy());
        credentials.getSecret.mockResolvedValue(null);
        setFullEnv({ AWS_SECRET_ACCESS_KEY: 'TOTALLY-SECRET-VALUE' });

        await service.resolve();

        expect(String(warn.mock.calls[0]?.[0])).not.toContain(
          'TOTALLY-SECRET-VALUE',
        );
      });

      it('is not emitted at all when the saved settings answered', async () => {
        setFullEnv();

        await service.resolve();

        expect(warn).not.toHaveBeenCalled();
      });
    });

    describe('lastKnownBucket()', () => {
      it('falls back to the environment bucket, so getBucket() still answers', async () => {
        // Without this, `StorageProvider.getBucket()` — synchronous, and the
        // only path `DatabaseBackupRunnerService.queueBackup` has — would 503
        // on a deployment the bridge is otherwise keeping alive.
        systemSettings.getStoragePolicy.mockResolvedValue(unconfiguredPolicy());
        credentials.getSecret.mockResolvedValue(null);
        setFullEnv();

        await service.resolve();

        expect(service.lastKnownBucket()).toBe('env-bucket');
      });

      it('prefers a saved bucket over the environment one', async () => {
        setFullEnv();

        await service.resolve();

        expect(service.lastKnownBucket()).toBe('configured-bucket');
      });

      it('ignores the environment once ANY settings field has been saved', async () => {
        systemSettings.getStoragePolicy.mockResolvedValue(
          unconfiguredPolicy({ accessKeyId: 'SAVED-AKIA' }),
        );
        credentials.getSecret.mockResolvedValue(null);
        setFullEnv();

        await service.resolve();

        expect(service.lastKnownBucket()).toBeNull();
      });
    });
  });
});

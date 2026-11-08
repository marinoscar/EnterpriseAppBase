import type { CredentialsService } from '../../../src/credentials/index';
import type { SystemSettingsService } from '../../../src/settings/index';
import { STORAGE_SYSTEM_SETTINGS } from '../../../src/storage/config/storage.system-settings';
import { StorageConfigService } from '../../../src/storage/config/storage-config.service';
import { StorageProviderRouter } from '../../../src/storage/providers/storage-provider-router';
import { S3StorageProvider } from '../../../src/storage/providers/s3/s3-storage.provider';
import type { StorageProvider } from '../../../src/storage/providers/storage-provider.interface';
import {
  getStorageDriver,
  readStorageDriverSecret,
  storageSecretAddress,
  storageSecretReadAddresses,
} from '../../../src/storage/drivers/storage-driver';
import '../../../src/storage/drivers/builtin-storage-drivers';

// =============================================================================
// Per-driver credential addresses (#1124, gap 1)
// =============================================================================
//
// Production data can live on several S3-family providers at once (old rows on
// S3, new ones on R2), each with its OWN key pair. Before #1124 the three
// built-ins read one shared slot, `storage/default`, so the rows of whichever
// provider was not active became unreadable. This spec runs the REAL config
// service and the REAL router over an in-memory credential store and proves:
//
//   - each built-in reads its own `storage/<driverId>` address first;
//   - `storage/default` stays the read fallback, so a deployment that has only
//     the old slot keeps working with no data move;
//   - two S3-family drivers with different keys each sign their own rows with
//     their own secret, whichever one is active.
// =============================================================================

const FIXED_NOW = new Date('2026-06-01T12:00:00.000Z');

function storedPolicy(provider: string) {
  return STORAGE_SYSTEM_SETTINGS.read(
    {
      provider,
      drivers: {
        s3: { bucket: 's3-bucket', region: 'us-east-1', endpoint: '', accessKeyId: 'AKIAS3EXAMPLE', forcePathStyle: null },
        r2: { bucket: 'r2-bucket', accountId: 'acct', region: '', endpoint: '', accessKeyId: 'AKIAR2EXAMPLE', forcePathStyle: null },
      },
    },
    {
      asPlainObject: (value: unknown) =>
        typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined,
    } as never,
  );
}

/** A credential store keyed by `purpose/name`. */
function credentialStore(initial: Record<string, string>) {
  const rows = new Map(Object.entries(initial));
  return {
    rows,
    getSecret: jest.fn(async (purpose: string, name: string) => rows.get(`${purpose}/${name}`) ?? null),
  };
}

function expectedS3(secret: string): S3StorageProvider {
  return new S3StorageProvider({
    provider: 's3',
    bucket: 's3-bucket',
    region: 'us-east-1',
    accessKeyId: 'AKIAS3EXAMPLE',
    secretAccessKey: secret,
    forcePathStyle: false,
    partSize: 10 * 1024 * 1024,
  });
}

function expectedR2(secret: string): S3StorageProvider {
  return new S3StorageProvider({
    provider: 'r2',
    bucket: 'r2-bucket',
    region: 'auto',
    endpoint: 'https://acct.r2.cloudflarestorage.com',
    accessKeyId: 'AKIAR2EXAMPLE',
    secretAccessKey: secret,
    forcePathStyle: false,
    partSize: 10 * 1024 * 1024,
  });
}

function signatureOf(url: string): string | null {
  return new URL(url).searchParams.get('X-Amz-Signature');
}

describe('per-driver storage credentials (#1124)', () => {
  beforeEach(() => {
    // Only Date is frozen, so two presigned URLs signed a moment apart are comparable.
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function build(activeId: string, secrets: Record<string, string>) {
    const credentials = credentialStore(secrets);
    const systemSettings = { getStoragePolicy: jest.fn(async () => storedPolicy(activeId)) };
    const storageConfig = new StorageConfigService(
      systemSettings as unknown as SystemSettingsService,
      credentials as unknown as CredentialsService,
    );
    const active = { kind: activeId, getBucket: () => `${activeId}-bucket` } as unknown as StorageProvider;
    const config = { get: <T>(_key: string, fallback?: T) => fallback as T } as never;
    const router = new StorageProviderRouter(
      { resolveCurrent: async () => active } as unknown as StorageProvider,
      storageConfig,
      config,
    );
    return { credentials, storageConfig, router, active };
  }

  it('gives each built-in its own address with storage/default as the read fallback', () => {
    for (const id of ['s3', 'r2', 's3compatible']) {
      const driver = getStorageDriver(id)!;
      expect(storageSecretAddress(driver, 'secretAccessKey')).toMatchObject({ purpose: 'storage', name: id });
      expect(storageSecretReadAddresses(driver, 'secretAccessKey')).toEqual([
        { purpose: 'storage', name: id },
        { purpose: 'storage', name: 'default' },
      ]);
    }
  });

  it('reads the driver\'s own address before the shared fallback', async () => {
    const store = credentialStore({ 'storage/default': 'legacy-secret', 'storage/r2': 'r2-secret' });
    expect(await readStorageDriverSecret(store, getStorageDriver('r2')!, 'secretAccessKey')).toBe('r2-secret');
    expect(await readStorageDriverSecret(store, getStorageDriver('s3')!, 'secretAccessKey')).toBe('legacy-secret');
    expect(await readStorageDriverSecret(credentialStore({}), getStorageDriver('s3')!, 'secretAccessKey')).toBeNull();
  });

  it('keeps a deployment with only storage/default working (no data move)', async () => {
    const { storageConfig } = build('s3', { 'storage/default': 'legacy-secret' });

    const s3 = await storageConfig.resolveDriver('s3');
    const r2 = await storageConfig.resolveDriver('r2');

    expect(s3.configured && s3.config.secrets.secretAccessKey).toBe('legacy-secret');
    expect(r2.configured && r2.config.secrets.secretAccessKey).toBe('legacy-secret');
  });

  it('resolves two S3-family drivers with different keys each with its own', async () => {
    const { storageConfig } = build('r2', { 'storage/default': 'legacy-secret', 'storage/s3': 's3-secret', 'storage/r2': 'r2-secret' });

    const s3 = await storageConfig.resolveDriver('s3');
    const r2 = await storageConfig.resolve();

    expect(s3.configured && s3.config.secrets.secretAccessKey).toBe('s3-secret');
    expect(r2.configured && r2.config.provider).toBe('r2');
    expect(r2.configured && r2.config.secrets.secretAccessKey).toBe('r2-secret');
  });

  it.each(['s3', 'r2'])('serves both drivers\' rows with their own keys while %s is active', async (activeId) => {
    const { router } = build(activeId, { 'storage/default': 'legacy-secret', 'storage/s3': 's3-secret', 'storage/r2': 'r2-secret' });
    const otherId = activeId === 's3' ? 'r2' : 's3';

    // The non-active driver's row is served by a client the router builds from
    // that driver's OWN settings and secret.
    const other = await router.forObject({ storageProvider: otherId, bucket: `${otherId}-bucket` });
    expect(other.kind).toBe(otherId);

    const url = await other.getSignedDownloadUrl('org/photo.jpg');
    const own = otherId === 's3' ? expectedS3('s3-secret') : expectedR2('r2-secret');
    const wrong = otherId === 's3' ? expectedS3('legacy-secret') : expectedR2('legacy-secret');
    const expected = await own.getSignedDownloadUrl('org/photo.jpg');

    expect(url).toBe(expected);
    expect(signatureOf(url)).not.toBe(signatureOf(await wrong.getSignedDownloadUrl('org/photo.jpg')));
    expect(new URL(url).searchParams.get('X-Amz-Credential')).toContain(otherId === 's3' ? 'AKIAS3EXAMPLE' : 'AKIAR2EXAMPLE');
  });
});

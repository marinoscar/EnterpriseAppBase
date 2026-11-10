import { StorageProviderRouter } from '../../../src/storage/providers/storage-provider-router';
import type { StorageConfigResolution } from '../../../src/storage/config/storage-config';
import type { StorageConfigService } from '../../../src/storage/config/storage-config.service';
import type { StorageProvider } from '../../../src/storage/providers/storage-provider.interface';
import '../../../src/storage/drivers/builtin-storage-drivers';

// Real built-in drivers, no network: a presigned URL is computed locally.

const s3Config = (bucket = 's3-bucket'): StorageConfigResolution => ({
  configured: true,
  config: {
    provider: 's3',
    bucket,
    region: 'us-east-1',
    settings: { bucket, region: 'us-east-1', endpoint: '', accessKeyId: 'AKIAS3', forcePathStyle: null },
    secrets: { secretAccessKey: 's3-secret' },
  },
});

const r2Config = (secret = 'r2-secret'): StorageConfigResolution => ({
  configured: true,
  config: {
    provider: 'r2',
    bucket: 'r2-bucket',
    region: 'auto',
    endpoint: 'https://acct.r2.cloudflarestorage.com',
    settings: { bucket: 'r2-bucket', accountId: 'acct', region: '', endpoint: '', accessKeyId: 'AKIAR2', forcePathStyle: null },
    secrets: { secretAccessKey: secret },
  },
});

describe('StorageProviderRouter', () => {
  let activeId: string;
  let resolutions: Record<string, StorageConfigResolution>;
  let current: StorageProvider;
  let router: StorageProviderRouter;
  const config = { get: <T>(_k: string, fallback?: T) => fallback as T } as never;

  beforeEach(() => {
    activeId = 's3';
    resolutions = { s3: s3Config(), r2: r2Config() };
    current = { kind: 's3', getBucket: () => 's3-bucket' } as unknown as StorageProvider;
    const storageConfig = {
      activeProvider: jest.fn(async () => activeId),
      resolveDriver: jest.fn(async (id: string) => resolutions[id] ?? { configured: false, provider: id, missing: ['driver'] }),
    } as unknown as StorageConfigService;
    router = new StorageProviderRouter({ resolveCurrent: async () => current } as unknown as StorageProvider, storageConfig, config);
  });

  it('routes a legacy row (no recorded provider) to the active provider', async () => {
    expect(await router.forLocation(null)).toBe(current);
    expect(await router.forObject({ storageProvider: null, bucket: null })).toBe(current);
  });

  it('routes the active location to the active provider\'s own client', async () => {
    expect(await router.forObject({ storageProvider: 's3', bucket: 's3-bucket' })).toBe(current);
    expect(await router.forObject({ storageProvider: 's3', bucket: '' })).toBe(current);
  });

  it('keeps routing a row to its recorded driver after the active driver changes', async () => {
    activeId = 'r2';
    resolutions = { s3: s3Config('old-s3-bucket'), r2: r2Config() };

    const provider = await router.forObject({ storageProvider: 's3', bucket: 'old-s3-bucket' });

    expect(provider).not.toBe(current);
    expect(provider.kind).toBe('s3');
    expect(provider.getBucket()).toBe('old-s3-bucket');
    expect(await provider.getSignedDownloadUrl('k.txt')).toContain('old-s3-bucket');
  });

  it('prefers the bucket the row recorded over the driver\'s current one', async () => {
    const provider = await router.forObject({ storageProvider: 's3', bucket: 'previous-bucket' });
    expect(provider).not.toBe(current);
    expect(provider.getBucket()).toBe('previous-bucket');
  });

  it('builds a recorded driver\'s client once per configuration and rebuilds after a secret rotation', async () => {
    const first = await router.forObject({ storageProvider: 'r2', bucket: 'r2-bucket' });
    expect(await router.forObject({ storageProvider: 'r2', bucket: 'r2-bucket' })).toBe(first);

    resolutions.r2 = r2Config('rotated');
    const rotated = await router.forObject({ storageProvider: 'r2', bucket: 'r2-bucket' });
    expect(rotated).not.toBe(first);
  });

  it('serves a row whose recorded driver cannot be built here from the active provider (rows from before #373 recorded "s3" for every provider)', async () => {
    expect(await router.forObject({ storageProvider: 'azure-blob', bucket: 'x' })).toBe(current);

    resolutions.r2 = { configured: false, provider: 'r2', missing: ['secretAccessKey'] };
    expect(await router.forObject({ storageProvider: 'r2', bucket: 'x' })).toBe(current);
  });

  it('hands an app-bound provider back for every row (it routes itself)', async () => {
    const bound = { kind: 'app' } as unknown as StorageProvider;
    const appRouter = new StorageProviderRouter(bound);

    expect(await appRouter.forObject({ storageProvider: 'r2', bucket: 'b' })).toBe(bound);
    expect(await appRouter.forLocation(null)).toBe(bound);
  });
});

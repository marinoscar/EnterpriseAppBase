import { EgressRegistry } from '../../../../../src/doctor/index';

import { StorageConfigAdminService } from '../../../../../src/storage/config/storage-config-admin.service';
import { StorageEgressContributor } from '../../../../../src/storage/config/doctor/egress/storage.egress.contributor';

function setup(view: Record<string, unknown>) {
  const storageAdmin = {
    describeForAdmin: jest.fn().mockResolvedValue({
      provider: 's3',
      bucket: 'acme-files',
      region: '',
      endpoint: '',
      accountId: '',
      accessKeyId: 'AKIAEXAMPLEKEYID',
      forcePathStyle: null,
      effectiveEndpoint: null,
      configured: true,
      secretAccessKeyStatus: { configured: true, hint: '••••XYZ' },
      ...view,
    }),
  } as unknown as StorageConfigAdminService;
  return new StorageEgressContributor(new EgressRegistry(), storageAdmin);
}

describe('StorageEgressContributor (#773)', () => {
  it("uses AWS's regional host when there is no endpoint", async () => {
    const [dep] = await setup({ region: 'eu-central-1' }).describe();

    expect(dep).toMatchObject({
      id: 'storage.s3',
      capability: 'Object storage (Amazon S3)',
      direction: 'both',
      enabled: true,
      hosts: ['s3.eu-central-1.amazonaws.com'],
      scope: 'public',
    });
    expect(JSON.stringify(dep)).not.toMatch(/AKIA|XYZ|acme-files/);
  });

  it('uses the effective endpoint host: MinIO is private, R2 is public', async () => {
    const [minio] = await setup({ provider: 's3compatible', effectiveEndpoint: 'http://minio:9000' }).describe();
    expect(minio).toMatchObject({ hosts: ['minio'], scope: 'private', capability: 'Object storage (S3-compatible)' });

    const [r2] = await setup({ provider: 'r2', effectiveEndpoint: 'https://acct.r2.cloudflarestorage.com' }).describe();
    expect(r2).toMatchObject({ hosts: ['acct.r2.cloudflarestorage.com'], scope: 'public' });
  });

  it('is disabled while storage is not configured', async () => {
    const [dep] = await setup({ configured: false }).describe();

    expect(dep).toMatchObject({ enabled: false, hosts: ['s3.amazonaws.com'] });
  });
});

import { z } from 'zod';

import { EgressRegistry } from '../../../../../src/doctor/index';

import { StorageConfigAdminService } from '../../../../../src/storage/config/storage-config-admin.service';
import { StorageEgressContributor } from '../../../../../src/storage/config/doctor/egress/storage.egress.contributor';
import { registerStorageDriver } from '../../../../../src/storage/drivers/storage-driver';
// Registers the built-in drivers the contributor asks for their hosts.
import '../../../../../src/storage/drivers/builtin-storage-drivers';

// A driver that calls a cloud API, and one that calls nowhere.
registerStorageDriver({
  id: 'toy-cloud',
  label: 'Toy cloud',
  settingsSchema: z.object({ account: z.string() }),
  defaults: { account: '' },
  build: () => {
    throw new Error('not built here');
  },
  testConnection: async () => ({ ok: true, message: 'ok' }),
  egressHosts: (settings) => [`${settings.account}.blob.toy.example`],
});
registerStorageDriver({
  id: 'toy-local',
  label: 'Toy local',
  settingsSchema: z.object({}),
  defaults: {},
  build: () => {
    throw new Error('not built here');
  },
  testConnection: async () => ({ ok: true, message: 'ok' }),
});

// The admin view, as `describeForAdmin()` returns it: the active driver and ITS settings.
function setup(view: { provider?: string; configured?: boolean; settings?: Record<string, unknown> }) {
  const { provider = 's3', configured = true, settings = {} } = view;
  const storageAdmin = {
    describeForAdmin: jest.fn().mockResolvedValue({
      provider,
      drivers: { [provider]: { bucket: 'acme-files', accessKeyId: 'AKIAEXAMPLEKEYID', ...settings } },
      configured,
      secretStatus: { configured: true, hint: '••••XYZ' },
    }),
  } as unknown as StorageConfigAdminService;
  return new StorageEgressContributor(new EgressRegistry(), storageAdmin);
}

describe('StorageEgressContributor (#773)', () => {
  it("uses AWS's regional host when there is no endpoint", async () => {
    const [dep] = await setup({ settings: { region: 'eu-central-1' } }).describe();

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
    const [minio] = await setup({ provider: 's3compatible', settings: { endpoint: 'http://minio:9000' } }).describe();
    expect(minio).toMatchObject({ hosts: ['minio'], scope: 'private', capability: 'Object storage (S3-compatible)' });

    // R2's host is DERIVED from the account id: the page never has to build it.
    const [r2] = await setup({ provider: 'r2', settings: { accountId: 'acct' } }).describe();
    expect(r2).toMatchObject({ id: 'storage.s3', hosts: ['acct.r2.cloudflarestorage.com'], scope: 'public' });
  });

  it('is disabled while storage is not configured', async () => {
    const [dep] = await setup({ configured: false }).describe();

    expect(dep).toMatchObject({ enabled: false, hosts: ['s3.amazonaws.com'] });
  });

  it("asks the active driver for its hosts, under the driver's own id and label", async () => {
    const [dep] = await setup({ provider: 'toy-cloud', settings: { account: 'acme' } }).describe();

    expect(dep).toMatchObject({
      id: 'storage.toy-cloud',
      capability: 'Object storage (Toy cloud)',
      hosts: ['acme.blob.toy.example'],
      enabled: true,
    });
  });

  it('lists nothing for a driver that calls nowhere, or one that is no longer registered', async () => {
    expect(await setup({ provider: 'toy-local' }).describe()).toEqual([]);
    expect(await setup({ provider: 'removed-plugin' }).describe()).toEqual([]);
  });
});

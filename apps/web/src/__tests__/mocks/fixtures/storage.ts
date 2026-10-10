/**
 * Fixtures of `GET /api/admin/storage-config` as the API serves it since the
 * storage drivers became pluggable (PP-14.7, #925): `drivers` (every
 * registered driver's settings, defaults filled), `descriptors` (one per
 * driver), and the deprecated flat read view of the active built-in.
 *
 * `local-fs` is the reference app's example driver (no secret); `vault-blob`
 * is an invented driver that declares a secret, so the write-only rules have
 * something to be tested against.
 */

import type { StorageConfigView } from '@marinoscar/platform-web/storage/headless';

type PluggableDescriptor = StorageConfigView['descriptors'][number];

const bucketField: PluggableDescriptor['fields'][number] = { kind: 'string', name: 'bucket', label: 'Bucket', maxLength: 255 };

const s3Fields = (): PluggableDescriptor['fields'] => [
  bucketField,
  { kind: 'string', name: 'region', label: 'Region', maxLength: 255 },
  { kind: 'string', name: 'endpoint', label: 'Endpoint', maxLength: 512 },
  { kind: 'string', name: 'accessKeyId', label: 'Access key ID', maxLength: 255 },
  { kind: 'boolean', name: 'forcePathStyle', label: 'Force path style' },
  { kind: 'secret', name: 'secretAccessKey', label: 'Secret access key', hasValue: true, required: true },
];

/** The descriptors of the three built-in drivers. */
export const builtinDescriptors = (): PluggableDescriptor[] => [
  { kind: 'storage-driver', id: 's3', label: 'Amazon S3', description: 'AWS S3.', fields: s3Fields() },
  {
    kind: 'storage-driver',
    id: 'r2',
    label: 'Cloudflare R2',
    description: 'Cloudflare R2.',
    fields: [
      bucketField,
      { kind: 'string', name: 'accountId', label: 'Account ID', maxLength: 255 },
      ...s3Fields().slice(1),
    ],
  },
  { kind: 'storage-driver', id: 's3compatible', label: 'S3-compatible (MinIO, Wasabi, Backblaze B2…)', description: 'MinIO and friends.', fields: s3Fields() },
];

/** The reference app's example driver: objects as files in a folder; no secret. */
export const localFsDescriptor = (): PluggableDescriptor => ({
  kind: 'storage-driver',
  id: 'local-fs',
  label: 'Local filesystem',
  description: 'Objects as files in a folder on the API host. For development, demos and single-node installs; no cloud account needed.',
  fields: [
    {
      kind: 'string',
      name: 'directory',
      label: 'Directory',
      help: 'Absolute path of the folder the objects are written under. Leave empty for a folder in the system temp directory.',
      maxLength: 512,
    },
  ],
});

/** An invented driver with a `string`, an `enum`, a `number` and a required write-only secret. */
export const vaultBlobDescriptor = (hasValue = false): PluggableDescriptor => ({
  kind: 'storage-driver',
  id: 'vault-blob',
  label: 'Vault Blob',
  description: 'A hosted blob store.',
  fields: [
    { kind: 'string', name: 'container', label: 'Container', maxLength: 63 },
    { kind: 'enum', name: 'tier', label: 'Tier', options: ['hot', 'cool'] },
    { kind: 'number', name: 'timeoutSeconds', label: 'Timeout (seconds)', min: 1, max: 300, integer: true },
    { kind: 'secret', name: 'connectionString', label: 'Connection string', hasValue, required: true },
  ],
});

/** The stored settings of the built-in drivers, defaults filled. */
export const builtinDrivers = (overrides: Record<string, Record<string, unknown>> = {}): StorageConfigView['drivers'] => ({
  s3: { bucket: 'app-objects', region: 'us-east-1', endpoint: '', accessKeyId: 'AKIAEXAMPLE', forcePathStyle: null },
  r2: { bucket: '', accountId: '', region: '', endpoint: '', accessKeyId: '', forcePathStyle: null },
  s3compatible: { bucket: '', region: '', endpoint: '', accessKeyId: '', forcePathStyle: null },
  ...overrides,
});

/** A configured `s3` deployment with the three built-ins registered. */
export function storageConfigFixture(overrides: Partial<StorageConfigView> = {}): StorageConfigView {
  return {
    provider: 's3',
    drivers: builtinDrivers(),
    descriptors: builtinDescriptors(),
    bucket: 'app-objects',
    region: 'us-east-1',
    endpoint: '',
    accountId: '',
    accessKeyId: 'AKIAEXAMPLE',
    forcePathStyle: null,
    effectiveEndpoint: null,
    configured: true,
    missing: [],
    secretStatus: {
      configured: true,
      hint: '••••ab12',
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedByUserId: 'admin-user-id',
    },
    version: 3,
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: { id: 'admin-user-id', email: 'admin@example.com' },
    ...overrides,
  };
}

/** The same deployment with `local-fs` and `vault-blob` registered besides the built-ins. */
export function storageConfigWithCustomDrivers(overrides: Partial<StorageConfigView> = {}): StorageConfigView {
  return storageConfigFixture({
    drivers: builtinDrivers({
      'local-fs': { directory: '' },
      'vault-blob': { container: 'objects', tier: 'hot' },
    }),
    descriptors: [...builtinDescriptors(), localFsDescriptor(), vaultBlobDescriptor(false)],
    ...overrides,
  });
}

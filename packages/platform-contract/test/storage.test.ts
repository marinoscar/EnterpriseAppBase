// The storage contract (#736): representative bodies and rows parse, the
// namespace's no-secret proof holds at run time too, and the value lists
// match the schemas built from them.
import { describe, expect, it } from 'vitest';

import {
  BUILTIN_STORAGE_PROVIDER_KINDS,
  LEGACY_STORAGE_FLAT_FIELDS,
  STORAGE_DRIVER_ID_PATTERN,
  STORAGE_OBJECT_STATUSES,
  STORAGE_PROVIDER_KINDS,
  STORAGE_SECRET_FIELD_NAMES,
  STORAGE_SETTINGS_CARRIES_NO_SECRET,
  STORAGE_SWITCH_CONFIRMATION,
  objectListQuerySchema,
  objectResponseSchema,
  storageConfigResponseSchema,
  storageConnectionTestResultSchema,
  storageDriverIdSchema,
  storageDriversPatchSchema,
  storageResponseSchema,
  storageSettingsPatchSchema,
  storageSettingsSchema,
  systemStoragePatchSchema,
  systemStorageSchema,
  testStorageConfigSchema,
  updateStorageConfigSchema,
} from '../src/storage/index.js';

// The flat settings an earlier release stored and the admin PUT still accepts as an alias.
const FLAT = {
  bucket: 'app-objects',
  region: 'us-east-1',
  endpoint: '',
  accountId: '',
  accessKeyId: 'AKIAEXAMPLE',
  forcePathStyle: null,
};
const STORED = { provider: 's3', ...FLAT };
// The current stored shape: the active driver and every driver's own settings.
const DRIVERS = { s3: { ...FLAT }, 'local-fs': { directory: '/var/lib/app/objects' } };

describe('@marinoscar/platform-contract/storage', () => {
  it('parses the stored namespace and keeps forcePathStyle tri-state', () => {
    expect(systemStorageSchema.parse({ provider: 's3', drivers: DRIVERS })).toEqual({ provider: 's3', drivers: DRIVERS });
    expect(storageSettingsPatchSchema.parse({ bucket: '' })).toEqual({ bucket: '' });
    expect(storageSettingsPatchSchema.parse({ forcePathStyle: null })).toEqual({ forcePathStyle: null });
  });

  it('still reads the legacy flat fields next to drivers, as optional aliases', () => {
    expect(systemStorageSchema.parse({ ...STORED, drivers: {} })).toEqual({ ...STORED, drivers: {} });
    expect(storageSettingsSchema.parse(STORED)).toEqual(STORED);
    expect(systemStoragePatchSchema.parse({ drivers: { s3: { bucket: 'b' }, 'local-fs': null } })).toEqual({
      drivers: { s3: { bucket: 'b' }, 'local-fs': null },
    });
    expect([...LEGACY_STORAGE_FLAT_FIELDS]).toEqual(Object.keys(FLAT));
  });

  it('opens the provider kind: any well-formed driver id, never an enum', () => {
    expect(storageDriverIdSchema.parse('azure-blob')).toBe('azure-blob');
    for (const bad of ['', 'S3', '1s3', 'a', 'has space', 'x'.repeat(49)]) {
      expect(storageDriverIdSchema.safeParse(bad).success).toBe(false);
    }
    expect(STORAGE_DRIVER_ID_PATTERN.test('local-fs')).toBe(true);
    expect(systemStorageSchema.parse({ provider: 'gcs', drivers: {} }).provider).toBe('gcs');
    expect(updateStorageConfigSchema.parse({ provider: 'azure-blob' }).provider).toBe('azure-blob');
    expect(storageConnectionTestResultSchema.shape.provider.safeParse('azure-blob').success).toBe(true);
    expect([...STORAGE_PROVIDER_KINDS]).toEqual([...BUILTIN_STORAGE_PROVIDER_KINDS]);
    expect([...BUILTIN_STORAGE_PROVIDER_KINDS]).toEqual(['s3', 'r2', 's3compatible']);
  });

  it('the admin PUT and test take drivers and per-driver secrets beside the flat aliases', () => {
    const body = {
      provider: 'local-fs',
      drivers: { 'local-fs': { directory: '/data' }, s3: null },
      secrets: { 'azure-blob': { connectionString: 'typed', blank: '' } },
    };
    expect(updateStorageConfigSchema.parse(body)).toEqual(body);
    expect(testStorageConfigSchema.parse(body)).toEqual(body);
    expect(storageDriversPatchSchema.safeParse({ BAD: {} }).success).toBe(false);
  });

  it('cannot carry a secret: no stored, response or admin-view field is secret-named', () => {
    expect(STORAGE_SETTINGS_CARRIES_NO_SECRET).toBe(true);
    const forbidden = new Set(STORAGE_SECRET_FIELD_NAMES.map((name) => name.toLowerCase()));
    for (const schema of [systemStorageSchema, storageResponseSchema, storageConfigResponseSchema]) {
      expect(Object.keys(schema.shape).filter((key) => forbidden.has(key.toLowerCase()))).toEqual([]);
    }
  });

  it('the admin PUT accepts the write-only secret and only the SWITCH literal', () => {
    const body = { ...STORED, secretAccessKey: 'typed', confirmation: STORAGE_SWITCH_CONFIRMATION };
    expect(updateStorageConfigSchema.parse(body)).toMatchObject({ secretAccessKey: 'typed', confirmation: 'SWITCH' });
    expect(() => updateStorageConfigSchema.parse({ ...STORED, confirmation: 'switch' })).toThrow();
  });

  it('builds its enums from the value lists, in order', () => {
    expect(objectResponseSchema.shape.status.options).toEqual([...STORAGE_OBJECT_STATUSES]);
  });

  it('applies the list query defaults', () => {
    expect(objectListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' });
    expect(() => objectListQuerySchema.parse({ pageSize: '101' })).toThrow();
  });
});

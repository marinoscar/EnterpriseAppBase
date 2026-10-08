// The storage contract (#736): representative bodies and rows parse, the
// namespace's no-secret proof holds at run time too, and the value lists
// match the schemas built from them.
import { describe, expect, it } from 'vitest';

import {
  MISSING_STORAGE_CONFIG_FIELDS,
  STORAGE_OBJECT_STATUSES,
  STORAGE_PROVIDER_KINDS,
  STORAGE_SECRET_FIELD_NAMES,
  STORAGE_SETTINGS_CARRIES_NO_SECRET,
  STORAGE_SWITCH_CONFIRMATION,
  objectListQuerySchema,
  objectResponseSchema,
  storageConfigResponseSchema,
  storageResponseSchema,
  storageSettingsPatchSchema,
  systemStorageSchema,
  updateStorageConfigSchema,
} from '../src/storage/index.js';

const STORED = {
  provider: 's3',
  bucket: 'app-objects',
  region: 'us-east-1',
  endpoint: '',
  accountId: '',
  accessKeyId: 'AKIAEXAMPLE',
  forcePathStyle: null,
};

describe('@marinoscar/platform-contract/storage', () => {
  it('parses the stored namespace and keeps forcePathStyle tri-state', () => {
    expect(systemStorageSchema.parse(STORED)).toEqual(STORED);
    expect(storageSettingsPatchSchema.parse({ bucket: '' })).toEqual({ bucket: '' });
    expect(storageSettingsPatchSchema.parse({ forcePathStyle: null })).toEqual({ forcePathStyle: null });
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
    expect(updateStorageConfigSchema.shape.provider.options).toEqual([...STORAGE_PROVIDER_KINDS]);
    expect(objectResponseSchema.shape.status.options).toEqual([...STORAGE_OBJECT_STATUSES]);
    expect(storageConfigResponseSchema.shape.missing.element.options).toEqual([...MISSING_STORAGE_CONFIG_FIELDS]);
  });

  it('applies the list query defaults', () => {
    expect(objectListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' });
    expect(() => objectListQuerySchema.parse({ pageSize: '101' })).toThrow();
  });
});

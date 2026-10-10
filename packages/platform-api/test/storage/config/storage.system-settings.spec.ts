import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import {
  STORAGE_SYSTEM_SETTINGS,
  mergeStorageSettings,
} from '../../../src/storage/config/storage.system-settings';
import { registerStorageDriver } from '../../../src/storage/drivers/storage-driver';

// =============================================================================
// The `storage` system-settings namespace (issue #373; drivers: PP-14.7, #925)
// =============================================================================
//
// What this pins:
//
//   * AN OLD STORED ROW LOADS UNCHANGED. A row written before drivers were
//     pluggable has six flat fields and no `drivers`; reading it yields the same
//     configuration, now as `drivers.<provider>`, with the flat fields still
//     published. Field by field: one damaged field keeps the bucket beside it.
//   * THE NEW SHAPE ROUND-TRIPS. read -> merge(no patch) -> read is the identity.
//   * A WRITE STORES THE NEW SHAPE ONLY, from a PATCH (merge) and from a PUT (the
//     stored schema), and `drivers.<provider>` and a flat alias that disagree
//     are a 400 rather than a silently ignored change.
//   * A driver removed since the row was written never bricks it.
// =============================================================================

// A driver an app would register: one non-secret setting, one secret.
registerStorageDriver({
  id: 'toy-store',
  label: 'Toy store',
  settingsSchema: z.object({ directory: z.string().max(40), retries: z.number().int().min(0) }),
  defaults: { directory: '', retries: 3 },
  secrets: [{ name: 'token', label: 'Token', required: true }],
  build: () => {
    throw new Error('not built here');
  },
  testConnection: async () => ({ ok: true, message: 'ok' }),
});

const helpers = {
  asPlainObject: (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined,
} as never;

const read = (stored: unknown) => STORAGE_SYSTEM_SETTINGS.read(stored, helpers);

/** The row an earlier release stored: six flat fields beside `provider`. */
const OLD_ROW = {
  provider: 's3compatible',
  bucket: 'minio-bucket',
  region: '',
  endpoint: 'https://minio.internal:9000',
  accountId: '',
  accessKeyId: 'AKIAMINIO',
  forcePathStyle: true,
};

describe('the storage namespace: reading', () => {
  it('loads a row stored before drivers were pluggable, unchanged in meaning', () => {
    const value = read(OLD_ROW);

    expect(value.provider).toBe('s3compatible');
    // The flat fields became the settings of the active driver...
    expect(value.drivers.s3compatible).toEqual({
      bucket: 'minio-bucket',
      region: '',
      endpoint: 'https://minio.internal:9000',
      accessKeyId: 'AKIAMINIO',
      forcePathStyle: true,
    });
    // ...every other registered driver is present with its defaults...
    expect(value.drivers.s3).toEqual({ bucket: '', region: '', endpoint: '', accessKeyId: '', forcePathStyle: null });
    expect(value.drivers.r2).toMatchObject({ bucket: '', accountId: '' });
    expect(value.drivers['toy-store']).toEqual({ directory: '', retries: 3 });
    // ...and the deprecated flat view still answers, exactly as it did.
    expect(value).toMatchObject({
      bucket: 'minio-bucket',
      region: '',
      endpoint: 'https://minio.internal:9000',
      accountId: '',
      accessKeyId: 'AKIAMINIO',
      forcePathStyle: true,
    });
  });

  it('keeps R2’s account id, and maps the flat fields to the ACTIVE provider only', () => {
    const value = read({ ...OLD_ROW, provider: 'r2', accountId: 'acct123', region: 'auto', endpoint: '' });

    expect(value.drivers.r2).toMatchObject({ bucket: 'minio-bucket', accountId: 'acct123', region: 'auto' });
    expect(value.drivers.s3compatible).toMatchObject({ bucket: '' });
    expect(value.accountId).toBe('acct123');
  });

  it('salvages a legacy row field by field: a damaged region keeps the bucket next to it', () => {
    const value = read({ ...OLD_ROW, region: 42, forcePathStyle: 'yes' });

    expect(value.drivers.s3compatible).toMatchObject({ bucket: 'minio-bucket', region: '', forcePathStyle: null });
    expect(value.bucket).toBe('minio-bucket');
  });

  it('reads the unconfigured defaults for a missing, null or unusable namespace', () => {
    for (const stored of [undefined, null, 'garbage', 42, [], {}]) {
      const value = read(stored);

      expect(value.provider).toBe('s3');
      expect(value.drivers.s3).toMatchObject({ bucket: '' });
      expect(value).toMatchObject({ bucket: '', accessKeyId: '', forcePathStyle: null });
    }
  });

  it('prefers drivers.<provider> over stale flat fields once a row has both', () => {
    const value = read({ ...OLD_ROW, drivers: { s3compatible: { bucket: 'new-bucket' } } });

    expect(value.drivers.s3compatible).toMatchObject({ bucket: 'new-bucket', endpoint: '' });
    expect(value.bucket).toBe('new-bucket');
  });

  it('reads a driver an app registered, and publishes empty flat fields when it declares none', () => {
    const value = read({ provider: 'toy-store', drivers: { 'toy-store': { directory: '/data', retries: 5 } } });

    expect(value.drivers['toy-store']).toEqual({ directory: '/data', retries: 5 });
    expect(value).toMatchObject({ bucket: '', region: '', endpoint: '', accountId: '', accessKeyId: '', forcePathStyle: null });
  });

  it('falls back to the driver’s defaults for an unusable field, and drops an id nobody registered', () => {
    const value = read({
      provider: 'toy-store',
      drivers: { 'toy-store': { directory: 'x'.repeat(41), retries: 7 }, 'removed-plugin': { anything: true } },
    });

    expect(value.drivers['toy-store']).toEqual({ directory: '', retries: 7 });
    expect(Object.keys(value.drivers)).not.toContain('removed-plugin');
  });

  it('keeps a provider whose driver is no longer registered, rather than bricking the row', () => {
    const value = read({ provider: 'azure-blob', drivers: { 'azure-blob': { container: 'c' } } });

    expect(value.provider).toBe('azure-blob');
    expect(value.drivers).not.toHaveProperty('azure-blob');
  });

  it('round-trips: reading what a merge produced changes nothing', () => {
    const merged = mergeStorageSettings(read(OLD_ROW), { drivers: { 'toy-store': { directory: '/data' } } });

    expect(read(merged)).toMatchObject({ provider: 's3compatible', drivers: merged.drivers });
    expect(mergeStorageSettings(read(merged))).toEqual(merged);
  });

  it('declares defaults the stored schema accepts, and the PUT branch an optional namespace', () => {
    expect(STORAGE_SYSTEM_SETTINGS.storedSchema.safeParse(STORAGE_SYSTEM_SETTINGS.defaults).success).toBe(true);
    expect(STORAGE_SYSTEM_SETTINGS.requiredOnPut).toBe(false);
    expect(STORAGE_SYSTEM_SETTINGS.defaults.provider).toBe('s3');
    expect(Object.keys(STORAGE_SYSTEM_SETTINGS.defaults.drivers)).toEqual(expect.arrayContaining(['s3', 'r2', 's3compatible']));
  });
});

describe('the storage namespace: a PATCH writes the new shape only', () => {
  const current = () => read(OLD_ROW);

  it('merges the legacy flat fields into drivers.<provider> and drops them', () => {
    const merged = mergeStorageSettings(current(), { bucket: 'other-bucket' });

    expect(merged.drivers.s3compatible).toMatchObject({ bucket: 'other-bucket', endpoint: 'https://minio.internal:9000', forcePathStyle: true });
    expect(Object.keys(merged).sort()).toEqual(['drivers', 'provider']);
  });

  it('keeps forcePathStyle tri-state: only undefined leaves it alone, null restores the convention', () => {
    expect(mergeStorageSettings(current(), { bucket: 'b' }).drivers.s3compatible.forcePathStyle).toBe(true);
    expect(mergeStorageSettings(current(), { forcePathStyle: null }).drivers.s3compatible.forcePathStyle).toBeNull();
    expect(mergeStorageSettings(current(), { forcePathStyle: false }).drivers.s3compatible.forcePathStyle).toBe(false);
  });

  it('an empty string clears a text field; it is not "keep the old one"', () => {
    expect(mergeStorageSettings(current(), { endpoint: '' }).drivers.s3compatible.endpoint).toBe('');
  });

  it('switches the active driver and merges into THAT driver’s settings', () => {
    const merged = mergeStorageSettings(current(), { provider: 'r2', accountId: 'acct', bucket: 'r2-bucket' });

    expect(merged.provider).toBe('r2');
    expect(merged.drivers.r2).toMatchObject({ accountId: 'acct', bucket: 'r2-bucket' });
    // The driver we left keeps its settings: switching back finds them.
    expect(merged.drivers.s3compatible).toMatchObject({ bucket: 'minio-bucket' });
  });

  it('merges drivers.<id> over the stored settings and validates it with the driver', () => {
    const merged = mergeStorageSettings(current(), {
      provider: 'toy-store',
      drivers: { 'toy-store': { directory: '/data' } },
    });

    expect(merged.drivers['toy-store']).toEqual({ directory: '/data', retries: 3 });
    expect(mergeStorageSettings(merged, { drivers: { 'toy-store': { retries: 9 } } }).drivers['toy-store']).toEqual({ directory: '/data', retries: 9 });
  });

  it('null resets a driver to its defaults', () => {
    const merged = mergeStorageSettings(current(), { drivers: { s3compatible: null } });

    // Removed from the stored record; the next read fills the driver's defaults in.
    expect(merged.drivers.s3compatible).toBeUndefined();
    expect(read(merged).drivers.s3compatible).toMatchObject({ bucket: '', endpoint: '' });
  });

  it('keeps the other drivers when the patch names one', () => {
    const base = mergeStorageSettings(current(), { drivers: { 'toy-store': { directory: '/data' } } });
    const merged = mergeStorageSettings(base, { bucket: 'again' });

    expect(merged.drivers['toy-store']).toEqual({ directory: '/data', retries: 3 });
  });

  it('is a no-op for a namespace the patch does not mention', () => {
    expect(mergeStorageSettings(current())).toEqual({ provider: 's3compatible', drivers: current().drivers });
  });

  it.each([
    ['an unregistered provider', { provider: 'nope' }],
    ['settings an unregistered driver cannot have', { drivers: { nope: { a: 1 } } }],
    ['settings the driver refuses', { drivers: { 'toy-store': { directory: 'x'.repeat(41) } } }],
    ['a flat alias contradicting drivers.<provider>', { drivers: { s3compatible: { bucket: 'one' } }, bucket: 'two' }],
  ])('refuses %s with a 400', (_label, patch) => {
    expect(() => mergeStorageSettings(current(), patch as never)).toThrow(BadRequestException);
  });

  it('accepts a flat alias that agrees with drivers.<provider>', () => {
    const merged = mergeStorageSettings(current(), { drivers: { s3compatible: { bucket: 'same' } }, bucket: 'same' });

    expect(merged.drivers.s3compatible.bucket).toBe('same');
  });
});

describe('the storage namespace: a PUT', () => {
  const parse = (value: unknown) => STORAGE_SYSTEM_SETTINGS.storedSchema.safeParse(value);

  it('folds the legacy flat fields into drivers and stores the new shape only', () => {
    const result = parse({ provider: 's3compatible', bucket: 'b', region: '', endpoint: 'http://minio:9000', accountId: '', accessKeyId: 'K', forcePathStyle: null });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      provider: 's3compatible',
      drivers: { s3compatible: { bucket: 'b', region: '', endpoint: 'http://minio:9000', accessKeyId: 'K', forcePathStyle: null } },
    });
  });

  it('accepts the new shape, and checks each entry with the driver that owns it', () => {
    expect(parse({ provider: 'toy-store', drivers: { 'toy-store': { directory: '/d', retries: 1 } } }).success).toBe(true);
    expect(parse({ provider: 'toy-store', drivers: { 'toy-store': { directory: 5 } } }).success).toBe(false);
    expect(parse({ provider: 's3', drivers: { nope: {} } }).success).toBe(false);
  });

  it('refuses a flat field and drivers.<provider> that disagree', () => {
    expect(parse({ provider: 's3', bucket: 'one', drivers: { s3: { bucket: 'two' } } }).success).toBe(false);
    expect(parse({ provider: 's3', bucket: 'one', drivers: { s3: { bucket: 'one' } } }).success).toBe(true);
  });

  it('refuses a provider nobody registered, on the wire schema', () => {
    expect(STORAGE_SYSTEM_SETTINGS.putSchema.safeParse({ provider: 'nope' }).success).toBe(false);
    expect(STORAGE_SYSTEM_SETTINGS.putSchema.safeParse({ provider: 'toy-store' }).success).toBe(true);
  });
});

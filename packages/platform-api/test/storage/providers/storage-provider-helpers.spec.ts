import { deleteStorageKeys, storageObjectSize } from '../../../src/storage/providers/storage-provider.interface';
import type { StorageProvider } from '../../../src/storage/providers/storage-provider.interface';
import { StorageSizeUnsupportedError } from '../../../src/storage/providers/storage-provider.types';

// The bulk delete and size probe helpers (#1124): a provider without the
// optional methods keeps working through the per-key fallback.

function provider(extra: Partial<StorageProvider> = {}): StorageProvider {
  return {
    kind: 'test',
    delete: jest.fn(async (key: string) => {
      if (key === 'bad') throw new Error('nope');
    }),
    ...extra,
  } as unknown as StorageProvider;
}

describe('deleteStorageKeys', () => {
  it('uses deleteMany when the provider has it, deduplicating the keys', async () => {
    const deleteMany = jest.fn(async (keys: readonly string[]) => ({ deleted: [...keys], failed: [] }));
    const target = provider({ deleteMany });

    expect(await deleteStorageKeys(target, ['a', 'b', 'a'])).toEqual({ deleted: ['a', 'b'], failed: [] });
    expect(deleteMany).toHaveBeenCalledWith(['a', 'b']);
    expect(target.delete).not.toHaveBeenCalled();
  });

  it('falls back to delete per key, reporting a failure without stopping the rest', async () => {
    const target = provider();

    expect(await deleteStorageKeys(target, ['a', 'bad', 'c'])).toEqual({
      deleted: ['a', 'c'],
      failed: [{ key: 'bad', message: 'nope' }],
    });
    expect(target.delete).toHaveBeenCalledTimes(3);
  });

  it('makes no call for an empty list', async () => {
    const deleteMany = jest.fn();
    expect(await deleteStorageKeys(provider({ deleteMany }), [])).toEqual({ deleted: [], failed: [] });
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

describe('storageObjectSize', () => {
  it('returns the probe, null for an absent object, undefined when unsupported', async () => {
    expect(await storageObjectSize(provider({ size: async () => 42 }), 'k')).toBe(42);
    expect(await storageObjectSize(provider({ size: async () => null }), 'k')).toBeNull();
    expect(await storageObjectSize(provider(), 'k')).toBeUndefined();
    expect(
      await storageObjectSize(
        provider({
          size: async () => {
            throw new StorageSizeUnsupportedError('test');
          },
        }),
        'k',
      ),
    ).toBeUndefined();
  });
});

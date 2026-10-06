// The storage key-prefix registry (issue #679): validation, overlap, the frozen
// view, and the app extension seam.

import { RegistryError, withTemporaryEntries } from '@marinoscar/platform-api/core';
import {
  STORAGE_KEY_PREFIX_PATTERN,
  isRegisteredStorageKey,
  registerStorageKeyPrefixes,
  storageKeyPrefixRegistry,
  type StorageKeyPrefixDef,
} from './storage-key-prefix.registry';
import { STORAGE_KEY_PREFIXES } from './storage-key-prefix.view';

const def = (id: string, prefix: string, owner = 'test-app'): StorageKeyPrefixDef => ({
  id,
  prefix,
  owner,
  description: `test entry ${id}`,
});

/** Runs `fn` and returns the RegistryError it threw. */
function thrown(fn: () => unknown): RegistryError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RegistryError);
    return err as RegistryError;
  }
  throw new Error('expected a RegistryError, nothing was thrown');
}

/** What a registration does to the live registry, rolled back afterwards. */
async function attempt(defs: StorageKeyPrefixDef[]): Promise<RegistryError | undefined> {
  let error: RegistryError | undefined;
  await withTemporaryEntries(storageKeyPrefixRegistry, [], () => {
    try {
      registerStorageKeyPrefixes(defs);
    } catch (err) {
      error = err as RegistryError;
    }
  });
  return error;
}

describe('storageKeyPrefixRegistry', () => {
  it('is the registry named storage-key-prefixes and holds the platform six in purge order', () => {
    expect(storageKeyPrefixRegistry.name).toBe('storage-key-prefixes');
    expect(storageKeyPrefixRegistry.ids()).toEqual([
      'uploads',
      'avatars',
      'database-backups',
      'node-outputs',
      'ai-outputs',
      'storage-config-test',
    ]);
  });

  describe('a bad prefix cannot be registered', () => {
    it.each([
      ['lacks the trailing slash', 'exports'],
      ['contains //', 'exports//'],
      ['contains // mid-way', 'exports//daily/'],
      ['starts with /', '/exports/'],
      ['is only a slash', '/'],
      ['is empty', ''],
      ['ends in a segment without its slash', 'exports/daily'],
      ['has upper case', 'Exports/'],
      ['has a space', 'my exports/'],
      ['has a dot segment', './exports/'],
    ])('rejects a prefix that %s with INVALID_ENTRY', async (_why, prefix) => {
      const err = await attempt([def('exports', prefix)]);

      expect(err).toBeInstanceOf(RegistryError);
      expect(err?.code).toBe('INVALID_ENTRY');
      expect(err?.registry).toBe('storage-key-prefixes');
      expect(err?.id).toBe('exports');
    });

    it('rejects the same prefix under a second id', async () => {
      const err = await attempt([def('uploads-again', 'uploads/')]);

      expect(err?.code).toBe('INVALID_ENTRY');
      expect(err?.message).toContain('already registered by "uploads"');
    });

    it('rejects a prefix under an existing one, and one above an existing one', async () => {
      const below = await attempt([def('uploads-sub', 'uploads/sub/')]);
      const above = await attempt([def('ai', 'ai-outputs/x/')]);

      expect(below?.code).toBe('INVALID_ENTRY');
      expect(below?.message).toContain('overlaps "uploads/"');
      expect(above?.code).toBe('INVALID_ENTRY');

      await withTemporaryEntries(storageKeyPrefixRegistry, [def('reports-daily', 'reports/daily/')], () => {
        expect(thrown(() => registerStorageKeyPrefixes([def('reports', 'reports/')])).code).toBe('INVALID_ENTRY');
      });
    });

    it('does not mistake a shared leading word for an overlap', async () => {
      // `uploads-archive/` does not start with `uploads/`: the slash is part of the prefix.
      expect(await attempt([def('uploads-archive', 'uploads-archive/')])).toBeUndefined();
    });

    it('rejects two overlapping entries inside one batch, and registers neither', async () => {
      await withTemporaryEntries(storageKeyPrefixRegistry, [], () => {
        const err = thrown(() =>
          registerStorageKeyPrefixes([def('reports', 'reports/'), def('reports-daily', 'reports/daily/')]),
        );

        expect(err.code).toBe('INVALID_ENTRY');
        expect(err.id).toBe('reports-daily');
        expect(storageKeyPrefixRegistry.has('reports')).toBe(false);
      });
    });

    it('rejects a duplicate id with DUPLICATE_ID', async () => {
      expect((await attempt([def('uploads', 'other/')]))?.code).toBe('DUPLICATE_ID');
    });

    it('rejects a non-kebab id with INVALID_ID', async () => {
      expect((await attempt([def('Exports', 'exports/')]))?.code).toBe('INVALID_ID');
      expect((await attempt([def('exports:daily', 'exports/')]))?.code).toBe('INVALID_ID');
    });

    it('requires an owner and a description', async () => {
      expect((await attempt([{ ...def('exports', 'exports/'), owner: ' ' }]))?.message).toContain('owner is required');
      expect((await attempt([{ ...def('exports', 'exports/'), description: '' }]))?.message).toContain(
        'description is required',
      );
    });

    it('applies the overlap rule to a bare registerAll too', async () => {
      await withTemporaryEntries(storageKeyPrefixRegistry, [], () => {
        expect(thrown(() => storageKeyPrefixRegistry.register(def('uploads-sub', 'uploads/sub/'))).code).toBe(
          'INVALID_ENTRY',
        );
      });
    });
  });

  it('STORAGE_KEY_PREFIX_PATTERN accepts nested lowercase prefixes', () => {
    for (const prefix of ['uploads/', 'database-backups/', 'exports/daily/', 'a1/b-2/']) {
      expect(STORAGE_KEY_PREFIX_PATTERN.test(prefix)).toBe(true);
    }
  });

  describe('isRegisteredStorageKey', () => {
    it('is true for a key under a registered prefix and false otherwise', () => {
      expect(isRegisteredStorageKey('uploads/abc/file.png')).toBe(true);
      expect(isRegisteredStorageKey('database-backups/2026/x.dump')).toBe(true);
      expect(isRegisteredStorageKey('uploads')).toBe(false);
      expect(isRegisteredStorageKey('uploads-archive/x')).toBe(false);
      expect(isRegisteredStorageKey('exports/x.zip')).toBe(false);
      expect(isRegisteredStorageKey('')).toBe(false);
    });

    it('sees a temporary app entry', async () => {
      await withTemporaryEntries(storageKeyPrefixRegistry, [def('exports', 'exports/')], () => {
        expect(isRegisteredStorageKey('exports/x.zip')).toBe(true);
      });
      expect(isRegisteredStorageKey('exports/x.zip')).toBe(false);
    });
  });
});

describe('STORAGE_KEY_PREFIXES (the view)', () => {
  it('holds the six platform values, in the order the purge has always used, and is frozen', () => {
    expect(STORAGE_KEY_PREFIXES).toEqual([
      'uploads/',
      'avatars/',
      'database-backups/',
      'node-outputs/',
      'ai-outputs/',
      'storage-config-test/',
    ]);
    expect(Object.isFrozen(STORAGE_KEY_PREFIXES)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(STORAGE_KEY_PREFIXES, '0')).toHaveProperty('value');
  });

  describe('app extension through app-registrations/storage-prefixes.ts', () => {
    // Each case loads the manifest and view afresh with a stand-in app file, which
    // is exactly what a fork's edit to that file does at import time.
    function loadViewWith(appEntries: StorageKeyPrefixDef[]): readonly string[] {
      let view: readonly string[] = [];
      jest.isolateModules(() => {
        jest.doMock('../app-registrations/storage-prefixes', () => ({ APP_STORAGE_KEY_PREFIXES: appEntries }));
        view = (require('./storage-key-prefix.view') as typeof import('./storage-key-prefix.view')).STORAGE_KEY_PREFIXES;
      });
      jest.dontMock('../app-registrations/storage-prefixes');
      return view;
    }

    it('appends an app prefix after the platform six', () => {
      const view = loadViewWith([def('exports', 'exports/', 'health-export')]);

      expect(view).toEqual([...STORAGE_KEY_PREFIXES, 'exports/']);
      expect(Object.isFrozen(view)).toBe(true);
    });

    it('fails at import time with a RegistryError for an overlapping app prefix', () => {
      expect(() => loadViewWith([def('uploads-sub', 'uploads/sub/')])).toThrow(
        expect.objectContaining({ name: 'RegistryError', code: 'INVALID_ENTRY', id: 'uploads-sub' }),
      );
    });

    it('fails at import time for a malformed app prefix', () => {
      for (const prefix of ['exports', 'exports//', '/exports/']) {
        expect(() => loadViewWith([def('exports', prefix)])).toThrow(
          expect.objectContaining({ name: 'RegistryError', code: 'INVALID_ENTRY' }),
        );
      }
    });

    it('fails at import time when the app reuses a platform id', () => {
      expect(() => loadViewWith([def('uploads', 'exports/')])).toThrow(
        expect.objectContaining({ name: 'RegistryError', code: 'DUPLICATE_ID', id: 'uploads' }),
      );
    });
  });

  it('a temporary entry shows up in the registry the view is built from, and is gone afterwards', async () => {
    await withTemporaryEntries(storageKeyPrefixRegistry, [def('exports', 'exports/')], () => {
      expect(storageKeyPrefixRegistry.list().map((d) => d.prefix)).toEqual([...STORAGE_KEY_PREFIXES, 'exports/']);
    });
    expect(storageKeyPrefixRegistry.has('exports')).toBe(false);
  });
});

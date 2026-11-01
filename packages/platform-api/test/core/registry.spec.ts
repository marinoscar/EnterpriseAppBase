import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_REGISTRY_ID_PATTERN,
  REGISTRY_ID_MAX_LENGTH,
  Registry,
  RegistryError,
  RegistryOptions,
  defineRegistry,
  freezeDefinedRegistries,
  listDefinedRegistries,
  withTemporaryEntries,
} from '../../src/core';

interface Entry {
  id: string;
  label?: string;
}

const entry = (id: string, label?: string): Entry => ({ id, label });

function makeRegistry(options: Partial<RegistryOptions<Entry>> = {}): Registry<Entry> {
  return new Registry<Entry>({ name: 'test', idOf: (e) => e.id, ...options });
}

/** Runs `fn` and returns what it threw, failing the test when it did not throw. */
function thrown(fn: () => unknown): RegistryError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RegistryError);
    return err as RegistryError;
  }
  throw new Error('expected a RegistryError, nothing was thrown');
}

/** Every module specifier a TypeScript source imports, re-exports or requires. */
function specifiersOf(file: string): string[] {
  // Comments are stripped first, so a TSDoc example never counts as an import.
  const source = readFileSync(join(__dirname, '..', '..', 'src', 'core', 'registry', file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const patterns = [
    /\bimport\s+(?:type\s+)?[^'";]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[^'";]*?from\s*['"]([^'"]+)['"]/g,
    /(?<![.\w$])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?<![.\w$])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((re) => [...source.matchAll(re)].map((m) => m[1]));
}

describe('registry primitive is framework-free', () => {
  it('registry.ts imports nothing at all (no @nestjs/*, no @prisma/*, no application code)', () => {
    expect(specifiersOf('registry.ts')).toEqual([]);
  });

  it('testing.ts and index.ts import only each other and registry.ts', () => {
    const allowed = new Set(['./registry', './testing']);
    for (const file of ['testing.ts', 'index.ts']) {
      const outside = specifiersOf(file).filter((s) => !allowed.has(s));
      expect({ file, outside }).toEqual({ file, outside: [] });
    }
  });

  it('the scanner itself detects imports (guards against a regex that matches nothing)', () => {
    expect(specifiersOf('registry-freeze.service.ts')).toEqual(expect.arrayContaining(['@nestjs/common', './registry']));
  });
});

describe('Registry', () => {
  describe('basic reads', () => {
    it('registers, gets, has, requires and counts entries', () => {
      const registry = makeRegistry();
      const a = entry('a');

      registry.register(a);

      expect(registry.get('a')).toBe(a);
      expect(registry.get('missing')).toBeUndefined();
      expect(registry.has('a')).toBe(true);
      expect(registry.has('missing')).toBe(false);
      expect(registry.require('a')).toBe(a);
      expect(registry.size).toBe(1);
      expect(registry.name).toBe('test');
    });

    it('stores entries by reference, without cloning', () => {
      const registry = makeRegistry();
      const a = entry('a', 'before');

      registry.register(a);
      a.label = 'after';

      expect(registry.get('a')?.label).toBe('after');
    });

    it('require() throws UNKNOWN_ID naming the registry, the id and the known ids', () => {
      const registry = makeRegistry();
      registry.register(entry('known'));

      const err = thrown(() => registry.require('nope'));

      expect(err.code).toBe('UNKNOWN_ID');
      expect(err.registry).toBe('test');
      expect(err.id).toBe('nope');
      expect(err.message).toBe('Unknown id "nope" in registry "test". Known ids: known.');
    });

    it('snapshot() reports name, frozen state and ids', () => {
      const registry = makeRegistry();
      registry.registerAll([entry('b'), entry('a')]);

      expect(registry.snapshot()).toEqual({ name: 'test', frozen: false, ids: ['b', 'a'] });
      registry.freeze();
      expect(registry.snapshot()).toEqual({ name: 'test', frozen: true, ids: ['b', 'a'] });
    });

    it('rejects an empty registry name', () => {
      expect(() => new Registry<Entry>({ name: ' ', idOf: (e) => e.id })).toThrow(RegistryError);
    });
  });

  describe('ids', () => {
    it.each([
      ['empty', ''],
      [`${REGISTRY_ID_MAX_LENGTH + 1} characters`, 'a'.repeat(REGISTRY_ID_MAX_LENGTH + 1)],
      ['inner whitespace', 'a b'],
      ['leading whitespace', ' a'],
      ['trailing newline', 'a\n'],
      ['leading -', '-a'],
      ['leading .', '.a'],
      ['a disallowed character', 'a#b'],
    ])('rejects an id that is %s with INVALID_ID', (_why, id) => {
      const registry = makeRegistry();

      const err = thrown(() => registry.register(entry(id)));

      expect(err.code).toBe('INVALID_ID');
      expect(err.registry).toBe('test');
      expect(registry.size).toBe(0);
    });

    it('rejects a non-string id with INVALID_ID', () => {
      const registry = new Registry<{ key: unknown }>({ name: 'loose', idOf: (e) => e.key as string });

      expect(thrown(() => registry.register({ key: 42 })).code).toBe('INVALID_ID');
    });

    it.each([
      'a'.repeat(REGISTRY_ID_MAX_LENGTH),
      'db.connection',
      'auth.initial-admin',
      'jobs:read',
      'storage_config:write',
      'coach@marinoscar/platform-api',
      'coach/weekly-review',
      '0',
    ])('accepts %s', (id) => {
      const registry = makeRegistry();

      registry.register(entry(id));

      expect(registry.has(id)).toBe(true);
    });

    it('applies a custom idPattern instead of the default', () => {
      const registry = makeRegistry({ idPattern: /^[a-z]+$/ });

      registry.register(entry('lower'));

      expect(thrown(() => registry.register(entry('jobs:read'))).code).toBe('INVALID_ID');
    });

    it('ignores a global flag, so repeated matching does not depend on lastIndex', () => {
      const registry = makeRegistry({ idPattern: /^[a-z]+$/g });

      registry.register(entry('one'));
      registry.register(entry('two'));
      registry.register(entry('three'));

      expect(registry.ids()).toEqual(['one', 'two', 'three']);
    });

    it('the default pattern is exported and admits the doctor check ids', () => {
      for (const id of ['db.connection', 'secrets.encryption-key', 'telemetry.tables', 'auth.jwt-secret']) {
        expect(DEFAULT_REGISTRY_ID_PATTERN.test(id)).toBe(true);
      }
    });
  });

  describe('validate', () => {
    it('wraps a throwing validate as INVALID_ENTRY with the original message and cause', () => {
      const original = new Error('label is required');
      const registry = makeRegistry({
        validate: (e) => {
          if (!e.label) throw original;
        },
      });

      const err = thrown(() => registry.register(entry('a')));

      expect(err.code).toBe('INVALID_ENTRY');
      expect(err.id).toBe('a');
      expect(err.message).toContain('label is required');
      expect(err.cause).toBe(original);
      expect(registry.size).toBe(0);
    });

    it('accepts a thrown non-Error value', () => {
      const registry = makeRegistry({
        validate: () => {
          throw 'plain string';
        },
      });

      expect(thrown(() => registry.register(entry('a'))).message).toContain('plain string');
    });

    it('receives the registry and runs after the id check', () => {
      const validate = jest.fn();
      const registry = makeRegistry({ validate });

      registry.register(entry('a'));
      expect(validate).toHaveBeenCalledWith(entry('a'), registry);

      validate.mockClear();
      thrown(() => registry.register(entry('')));
      expect(validate).not.toHaveBeenCalled();
    });
  });

  describe('duplicates', () => {
    it("throws DUPLICATE_ID by default ('throw') and keeps the first entry", () => {
      const registry = makeRegistry();
      const first = entry('a', 'first');
      registry.register(first);

      const err = thrown(() => registry.register(entry('a', 'second')));

      expect(err.code).toBe('DUPLICATE_ID');
      expect(err.id).toBe('a');
      expect(err.message).toBe('Duplicate id "a" in registry "test".');
      expect(registry.get('a')).toBe(first);
      expect(registry.size).toBe(1);
    });

    it('uses describeDuplicate for the message', () => {
      const registry = makeRegistry({
        describeDuplicate: (existing, incoming) => `${existing.label} vs ${incoming.label}`,
      });
      registry.register(entry('a', 'first'));

      expect(thrown(() => registry.register(entry('a', 'second'))).message).toBe('first vs second');
    });

    it("'replace' keeps the new entry at the old position and calls onReplace", () => {
      const onReplace = jest.fn();
      const registry = makeRegistry({ onDuplicate: 'replace', onReplace });
      const oldB = entry('b', 'old');
      registry.registerAll([entry('a'), oldB, entry('c')]);

      const newB = entry('b', 'new');
      registry.register(newB);

      expect(registry.ids()).toEqual(['a', 'b', 'c']);
      expect(registry.get('b')).toBe(newB);
      expect(registry.size).toBe(3);
      expect(onReplace).toHaveBeenCalledTimes(1);
      expect(onReplace).toHaveBeenCalledWith(oldB, newB);
    });

    it("'replace' without onReplace replaces silently", () => {
      const registry = makeRegistry({ onDuplicate: 'replace' });
      registry.register(entry('a', 'old'));

      registry.register(entry('a', 'new'));

      expect(registry.get('a')?.label).toBe('new');
    });

    it("'replace' never calls onReplace for a batch that was rejected", () => {
      const onReplace = jest.fn();
      const registry = makeRegistry({ onDuplicate: 'replace', onReplace });
      registry.register(entry('a', 'old'));

      thrown(() => registry.registerAll([entry('a', 'new'), entry('bad id')]));

      expect(onReplace).not.toHaveBeenCalled();
      expect(registry.get('a')?.label).toBe('old');
    });
  });

  describe('registerAll is atomic', () => {
    const seeded = (): Registry<Entry> => {
      const registry = makeRegistry({
        validate: (e) => {
          if (e.label === 'invalid') throw new Error('rejected');
        },
      });
      registry.registerAll([entry('x'), entry('y')]);
      return registry;
    };

    it.each<[string, Entry[], string]>([
      ['an invalid id in the middle', [entry('a'), entry(''), entry('b')], 'INVALID_ID'],
      ['an entry validate rejects', [entry('a'), entry('b', 'invalid')], 'INVALID_ENTRY'],
      ['a duplicate of an existing entry', [entry('a'), entry('x')], 'DUPLICATE_ID'],
      ['a duplicate inside the batch', [entry('a'), entry('b'), entry('a')], 'DUPLICATE_ID'],
    ])('rejects the whole batch for %s and leaves the registry unchanged', (_why, batch, code) => {
      const registry = seeded();

      expect(thrown(() => registry.registerAll(batch)).code).toBe(code);

      expect(registry.ids()).toEqual(['x', 'y']);
      expect(registry.has('a')).toBe(false);
    });

    it('adds every entry of a valid batch, in order', () => {
      const registry = seeded();

      registry.registerAll([entry('b'), entry('a')]);

      expect(registry.ids()).toEqual(['x', 'y', 'b', 'a']);
    });

    it('accepts an empty batch', () => {
      const registry = seeded();

      registry.registerAll([]);

      expect(registry.size).toBe(2);
    });
  });

  describe('order', () => {
    const ids = ['b', 'C', 'a', 'B'];

    it('defaults to registration order', () => {
      const registry = makeRegistry();
      registry.registerAll(ids.map((id) => entry(id)));

      expect(registry.ids()).toEqual(['b', 'C', 'a', 'B']);
      expect(registry.list().map((e) => e.id)).toEqual(['b', 'C', 'a', 'B']);
    });

    it("'id' sorts by code unit, independent of locale (uppercase before lowercase)", () => {
      const registry = makeRegistry({ order: 'id' });
      registry.registerAll(ids.map((id) => entry(id)));

      expect(registry.ids()).toEqual(['B', 'C', 'a', 'b']);
      expect(registry.list().map((e) => e.id)).toEqual(['B', 'C', 'a', 'b']);
    });

    it('a comparator sorts entries and keeps registration order for ties', () => {
      const registry = makeRegistry({ order: (x, y) => (x.label ?? '').localeCompare(y.label ?? '') });
      registry.registerAll([entry('third', '2'), entry('first', '1'), entry('second', '1')]);

      expect(registry.ids()).toEqual(['first', 'second', 'third']);
    });

    it('list() and ids() return fresh arrays; mutating them never changes the registry', () => {
      const registry = makeRegistry();
      registry.registerAll([entry('a'), entry('b')]);

      const list = registry.list();
      list.pop();
      list.push(entry('z'));
      const keys = registry.ids();
      keys.reverse();
      keys.length = 0;

      expect(registry.ids()).toEqual(['a', 'b']);
      expect(registry.list()).not.toBe(registry.list());
      expect(registry.size).toBe(2);
    });
  });

  describe('freeze', () => {
    it('refuses register and registerAll with FROZEN after freeze(), and reads keep working', () => {
      const registry = makeRegistry();
      registry.register(entry('a'));

      registry.freeze();

      expect(registry.frozen).toBe(true);
      expect(thrown(() => registry.register(entry('b'))).code).toBe('FROZEN');
      expect(thrown(() => registry.registerAll([entry('b')])).code).toBe('FROZEN');
      expect(thrown(() => registry.registerAll([])).code).toBe('FROZEN');
      expect(registry.ids()).toEqual(['a']);
      expect(registry.require('a').id).toBe('a');
    });

    it('is idempotent', () => {
      const registry = makeRegistry();

      registry.freeze();
      registry.freeze();

      expect(registry.frozen).toBe(true);
    });

    it('starts unfrozen', () => {
      expect(makeRegistry().frozen).toBe(false);
    });
  });
});

describe('defineRegistry and the catalogue', () => {
  it('records defined registries in definition order', () => {
    const first = defineRegistry<Entry>({ name: 'catalogue-first', idOf: (e) => e.id });
    const second = defineRegistry<Entry>({ name: 'catalogue-second', idOf: (e) => e.id });

    const names = listDefinedRegistries().map((r) => r.name);

    expect(names.indexOf('catalogue-first')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('catalogue-second')).toBeGreaterThan(names.indexOf('catalogue-first'));
    expect(listDefinedRegistries()).toEqual(expect.arrayContaining([first, second]));
  });

  it('throws DUPLICATE_REGISTRY for a name that is already defined', () => {
    defineRegistry<Entry>({ name: 'catalogue-dup', idOf: (e) => e.id });

    const err = thrown(() => defineRegistry<Entry>({ name: 'catalogue-dup', idOf: (e) => e.id }));

    expect(err.code).toBe('DUPLICATE_REGISTRY');
    expect(err.registry).toBe('catalogue-dup');
  });

  it('listDefinedRegistries() returns a fresh array', () => {
    defineRegistry<Entry>({ name: 'catalogue-copy', idOf: (e) => e.id });

    const list = listDefinedRegistries() as Array<Registry<unknown>>;
    list.length = 0;

    expect(listDefinedRegistries().length).toBeGreaterThan(0);
  });

  it('freezeDefinedRegistries() freezes every defined registry and no instance registry', () => {
    const defined = defineRegistry<Entry>({ name: 'catalogue-freeze', idOf: (e) => e.id });
    const instance = makeRegistry();

    freezeDefinedRegistries();
    freezeDefinedRegistries();

    expect(listDefinedRegistries().every((r) => r.frozen)).toBe(true);
    expect(defined.frozen).toBe(true);
    expect(instance.frozen).toBe(false);
  });
});

describe('withTemporaryEntries', () => {
  it('adds the entries for the duration of fn and removes them afterwards', async () => {
    const registry = makeRegistry();
    registry.register(entry('base'));

    const seen = await withTemporaryEntries(registry, [entry('tmp1'), entry('tmp2')], () => registry.ids());

    expect(seen).toEqual(['base', 'tmp1', 'tmp2']);
    expect(registry.ids()).toEqual(['base']);
  });

  it('removes the entries and rethrows when fn throws', async () => {
    const registry = makeRegistry();

    await expect(
      withTemporaryEntries(registry, [entry('tmp')], async () => {
        expect(registry.has('tmp')).toBe(true);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(registry.has('tmp')).toBe(false);
  });

  it('unfreezes for the duration and restores the frozen state, after success and after a throw', async () => {
    const registry = makeRegistry();
    registry.freeze();

    await withTemporaryEntries(registry, [entry('tmp')], () => {
      expect(registry.frozen).toBe(false);
      expect(registry.has('tmp')).toBe(true);
    });
    expect(registry.frozen).toBe(true);
    expect(registry.has('tmp')).toBe(false);

    await expect(
      withTemporaryEntries(registry, [entry('tmp')], () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(registry.frozen).toBe(true);
    expect(registry.size).toBe(0);
  });

  it('leaves an unfrozen registry unfrozen', async () => {
    const registry = makeRegistry();

    await withTemporaryEntries(registry, [entry('tmp')], () => undefined);

    expect(registry.frozen).toBe(false);
  });

  it('restores an entry a temporary one replaced, at its old position', async () => {
    const registry = makeRegistry({ onDuplicate: 'replace' });
    const original = entry('b', 'original');
    registry.registerAll([entry('a'), original, entry('c')]);

    await withTemporaryEntries(registry, [entry('b', 'temporary')], () => {
      expect(registry.get('b')?.label).toBe('temporary');
    });

    expect(registry.get('b')).toBe(original);
    expect(registry.ids()).toEqual(['a', 'b', 'c']);
  });

  it('applies the registry rules: a refused entry rejects and leaves the registry as it was', async () => {
    const registry = makeRegistry();
    registry.register(entry('a'));
    registry.freeze();
    const fn = jest.fn();

    await expect(withTemporaryEntries(registry, [entry('a')], fn)).rejects.toMatchObject({ code: 'DUPLICATE_ID' });

    expect(fn).not.toHaveBeenCalled();
    expect(registry.ids()).toEqual(['a']);
    expect(registry.frozen).toBe(true);
  });

  it('composes when nested', async () => {
    const registry = makeRegistry();

    await withTemporaryEntries(registry, [entry('outer')], async () => {
      await withTemporaryEntries(registry, [entry('inner')], () => {
        expect(registry.ids()).toEqual(['outer', 'inner']);
      });
      expect(registry.ids()).toEqual(['outer']);
    });

    expect(registry.size).toBe(0);
  });

  it('returns what fn returns', async () => {
    await expect(withTemporaryEntries(makeRegistry(), [], async () => 42)).resolves.toBe(42);
  });

  describe('outside a test runner', () => {
    const saved = { jest: process.env.JEST_WORKER_ID, vitest: process.env.VITEST };

    afterEach(() => {
      if (saved.jest === undefined) delete process.env.JEST_WORKER_ID;
      else process.env.JEST_WORKER_ID = saved.jest;
      if (saved.vitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = saved.vitest;
    });

    it('throws and touches nothing', async () => {
      delete process.env.JEST_WORKER_ID;
      delete process.env.VITEST;
      const registry = makeRegistry();
      registry.freeze();
      const fn = jest.fn();

      await expect(withTemporaryEntries(registry, [entry('tmp')], fn)).rejects.toThrow(/test helper/);

      expect(fn).not.toHaveBeenCalled();
      expect(registry.frozen).toBe(true);
      expect(registry.size).toBe(0);
    });

    it('runs under Vitest (VITEST set) as well as Jest', async () => {
      delete process.env.JEST_WORKER_ID;
      process.env.VITEST = 'true';

      await expect(withTemporaryEntries(makeRegistry(), [entry('tmp')], () => 'ok')).resolves.toBe('ok');
    });
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import * as ts from 'typescript';

import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import { NODE_OUTPUT_KEY_PREFIX } from '@marinoscar/platform-api/nodes';
import {
  AVATARS_KEY_PREFIX,
  NODE_OUTPUTS_KEY_PREFIX,
  STORAGE_KEY_PREFIX_PATTERN,
  STORAGE_PROBE_KEY_PREFIX,
  STORAGE_TEST_KEY_PREFIX,
  UPLOADS_KEY_PREFIX,
  allKeyPrefixes,
  avatarKeyPrefix,
  buildObjectKey,
  storageKeyPrefixRegistry,
  type StorageKeyPrefixDef,
} from '@marinoscar/platform-api/storage';

import { BACKUP_KEY_PREFIX } from '../../db-backup/db-backup-storage';
import { aiOutputKeyPrefix } from '../../ai/storage/ai-output-writer';
import { STORAGE_KEY_PREFIXES } from './storage-key-prefix.view';
import { AI_OUTPUTS_KEY_PREFIX, DATABASE_BACKUPS_KEY_PREFIX } from './storage-key-prefixes';

/**
 * These assertions exist because of one concrete failure, recorded in the
 * portable deploy specification: a transcribed prefix list said `backups/`
 * where the real constant was `database-backups/`, and the purge built from it
 * would have reported COMPLETE while leaving every database backup in the
 * bucket. Nothing failed and nothing warned.
 *
 * So the list is not allowed to be a hypothesis about the code. Each entry is
 * checked against the writer that actually produces it, and the source is
 * scanned for writer constants no registered prefix covers (issue #679).
 */

/** The roots the writer scan reads: the app's source and the packaged slices' (#736: the storage writers live there now). */
const SRC_ROOT = join(__dirname, '..', '..');
const PACKAGE_SRC_ROOT = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'platform-api', 'src');

/** A `*_KEY_PREFIX` constant initialised with a plain string literal. */
interface KeyPrefixConstant {
  file: string;
  name: string;
  value: string;
}

/** Strips `as const`, `satisfies`, `<T>` assertions and parentheses. */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Every quoted or substitution-free template literal assigned to an identifier
 * ending in `_KEY_PREFIX` (a `const`/`let`/`var` or a class property), parsed
 * with the TypeScript compiler so comments and strings never confuse it.
 */
function findKeyPrefixConstants(sources: ReadonlyArray<{ file: string; text: string }>): KeyPrefixConstant[] {
  const found: KeyPrefixConstant[] = [];
  for (const { file, text } of sources) {
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.initializer) {
        const name = ts.isIdentifier(node.name) ? node.name.text : undefined;
        const init = unwrap(node.initializer);
        if (name?.endsWith('_KEY_PREFIX') && (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))) {
          found.push({ file, name, value: init.text });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return found;
}

/** The constants whose value, normalised to end with `/`, no registered prefix covers. */
function unregisteredKeyPrefixes(
  constants: readonly KeyPrefixConstant[],
  registered: readonly string[],
): KeyPrefixConstant[] {
  return constants.filter(({ value }) => {
    const normalised = value.endsWith('/') ? value : `${value}/`;
    return !registered.some((prefix) => normalised.startsWith(prefix));
  });
}

/** Every non-spec `.ts` file under `apps/api/src` and `packages/platform-api/src` (the latter as `platform-api/...`). */
function apiSources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const [root, label] of [[SRC_ROOT, ''], [PACKAGE_SRC_ROOT, 'platform-api/']] as const) {
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
          out.push({ file: `${label}${relative(root, path).split('\\').join('/')}`, text: readFileSync(path, 'utf8') });
        }
      }
    };
    walk(root);
  }
  return out;
}

/** Owners of the platform's own entries; anything else is an app's. */
const PLATFORM_OWNERS = new Set(['storage', 'storage/profile-image', 'db-backup', 'nodes', 'ai', 'storage/config', 'exports']);

describe('STORAGE_KEY_PREFIXES', () => {
  it('every registered prefix is well formed and no two overlap', () => {
    const entries = storageKeyPrefixRegistry.list();

    for (const { prefix } of entries) {
      expect(prefix).toMatch(STORAGE_KEY_PREFIX_PATTERN);
      expect(prefix.endsWith('/')).toBe(true);
      expect(prefix).not.toMatch(/\/\//);
      expect(prefix.startsWith('/')).toBe(false);
    }
    for (const a of entries) {
      for (const b of entries) {
        if (a !== b) expect({ a: a.prefix, overlaps: b.prefix.startsWith(a.prefix) }).toEqual({ a: a.prefix, overlaps: false });
      }
    }
  });

  it('is exactly the registry, in registration order', () => {
    expect(STORAGE_KEY_PREFIXES).toEqual(storageKeyPrefixRegistry.list().map((d) => d.prefix));
    expect(allKeyPrefixes()).toEqual(STORAGE_KEY_PREFIXES);
  });

  it('the platform baseline: the entries with a platform owner are the eight the platform writes', () => {
    // Filtered by owner, not counted, so an app adding entries never breaks it;
    // removing or renaming a platform entry does.
    const platform = storageKeyPrefixRegistry
      .list()
      .filter((d) => PLATFORM_OWNERS.has(d.owner))
      .map(({ id, prefix, owner, scope }) => ({ id, prefix, owner, scope }));

    expect(platform).toEqual([
      { id: 'uploads', prefix: 'uploads/', owner: 'storage', scope: 'org' },
      { id: 'avatars', prefix: 'avatars/', owner: 'storage/profile-image', scope: 'user' },
      { id: 'database-backups', prefix: 'database-backups/', owner: 'db-backup', scope: 'deployment' },
      { id: 'node-outputs', prefix: 'node-outputs/', owner: 'nodes', scope: 'deployment' },
      { id: 'ai-outputs', prefix: 'ai-outputs/', owner: 'ai', scope: 'user' },
      { id: 'storage-config-test', prefix: 'storage-config-test/', owner: 'storage/config', scope: 'deployment' },
      { id: 'exports-users', prefix: 'exports/users/', owner: 'exports', scope: 'user' },
      { id: 'exports-orgs', prefix: 'exports/orgs/', owner: 'exports', scope: 'org' },
    ]);
  });

  it('is frozen, so a caller cannot narrow it and still believe it purged everything', () => {
    expect(Object.isFrozen(STORAGE_KEY_PREFIXES)).toBe(true);
  });

  describe('each entry matches the writer that produces it', () => {
    it('database backups: BACKUP_KEY_PREFIX is this list, not a second literal', () => {
      expect(BACKUP_KEY_PREFIX).toBe(DATABASE_BACKUPS_KEY_PREFIX);
      expect(STORAGE_KEY_PREFIXES).toContain(BACKUP_KEY_PREFIX);
    });

    it('node outputs: the writer joins `<prefix>/<jobId>`, so its constant has no slash', () => {
      expect(NODE_OUTPUT_KEY_PREFIX).toBe('node-outputs');
      expect(`${NODE_OUTPUT_KEY_PREFIX}/`).toBe(NODE_OUTPUTS_KEY_PREFIX);
    });

    it('avatars: the per-user key sits under the root prefix, as the user-scoped builder places it', () => {
      const user = '11111111-1111-4111-8111-111111111111';
      expect(avatarKeyPrefix('user-123')).toBe(`${AVATARS_KEY_PREFIX}user-123/`);
      expect(avatarKeyPrefix('user-123').startsWith(AVATARS_KEY_PREFIX)).toBe(true);
      expect(buildObjectKey('avatars', { userId: user }, 'x.png')).toBe(`${avatarKeyPrefix(user)}x.png`);
    });

    it('AI outputs: the per-user, per-run folder sits under the root prefix', () => {
      expect(aiOutputKeyPrefix('user-123', 'run-9')).toBe(`${AI_OUTPUTS_KEY_PREFIX}user-123/run-9/`);
      expect(aiOutputKeyPrefix('user-123', 'run-9').startsWith(AI_OUTPUTS_KEY_PREFIX)).toBe(true);
      expect(AI_OUTPUTS_KEY_PREFIX).toBe('ai-outputs/');
    });

    it('storage probes: the connection test writes under this list', () => {
      expect(STORAGE_PROBE_KEY_PREFIX).toBe(STORAGE_TEST_KEY_PREFIX);
    });

    it('uploads: the object service builds its key through the registry, not a literal', () => {
      // Read rather than invoked: the key is built inside a method that needs a
      // provider, a database and a request. What must be true is that the
      // literal is GONE from the source -- it appeared twice, and a third copy
      // is exactly how this drifts. Since #736 the key is org-aware and comes
      // from the builder of the registered `uploads` prefix.
      const source = readFileSync(join(PACKAGE_SRC_ROOT, 'storage', 'objects', 'objects.service.ts'), 'utf8');

      expect(source).not.toMatch(/`uploads\//);
      expect(source).toContain("buildObjectKey('uploads'");
      expect(UPLOADS_KEY_PREFIX).toBe('uploads/');
    });
  });

  describe('no writer in apps/api/src or the packaged slices invents a prefix outside the registry', () => {
    // The tripwire for a NEW writer. The rule: a writer names its prefix
    // constant `*_KEY_PREFIX`. Every such constant initialised with a literal
    // must equal, or sit under, a registered prefix; otherwise its objects
    // would survive a purge, and a purge cannot tell the difference.

    it('finds the platform constants (guards against a scan that matches nothing)', () => {
      const names = findKeyPrefixConstants(apiSources()).map((c) => `${c.file}:${c.name}`);

      expect(names).toEqual(
        expect.arrayContaining([
          'platform-api/storage/storage-key-prefixes.ts:UPLOADS_KEY_PREFIX',
          'platform-api/storage/storage-key-prefixes.ts:AVATARS_KEY_PREFIX',
          'platform/storage/storage-key-prefixes.ts:DATABASE_BACKUPS_KEY_PREFIX',
          'platform-api/nodes/node-data-plane.service.ts:NODE_OUTPUT_KEY_PREFIX',
          'platform/storage/storage-key-prefixes.ts:AI_OUTPUTS_KEY_PREFIX',
          'platform-api/storage/storage-key-prefixes.ts:STORAGE_TEST_KEY_PREFIX',
        ]),
      );
    });

    it('every *_KEY_PREFIX literal in apps/api/src and packages/platform-api/src is covered by a registered prefix', () => {
      expect(unregisteredKeyPrefixes(findKeyPrefixConstants(apiSources()), STORAGE_KEY_PREFIXES)).toEqual([]);
    });

    describe('the scan itself', () => {
      const scan = (text: string) => findKeyPrefixConstants([{ file: 'fixture.ts', text }]);

      it('fails on an unregistered `export const FOO_KEY_PREFIX = \'foo/\'`', () => {
        const constants = scan("export const FOO_KEY_PREFIX = 'foo/';");

        expect(unregisteredKeyPrefixes(constants, STORAGE_KEY_PREFIXES)).toEqual([
          { file: 'fixture.ts', name: 'FOO_KEY_PREFIX', value: 'foo/' },
        ]);
      });

      it('passes once foo/ is registered', async () => {
        const foo: StorageKeyPrefixDef = { id: 'foo', prefix: 'foo/', owner: 'test-app', description: 'fixture' };
        await withTemporaryEntries(storageKeyPrefixRegistry, [foo], () => {
          const registered = storageKeyPrefixRegistry.list().map((d) => d.prefix);

          expect(unregisteredKeyPrefixes(scan("export const FOO_KEY_PREFIX = 'foo/';"), registered)).toEqual([]);
        });
      });

      it('reads double quotes, template literals, `as const`, type annotations, class properties and nesting', () => {
        const constants = scan(`
          const A_KEY_PREFIX = "a/";
          export const B_KEY_PREFIX = \`b/\`;
          export const C_KEY_PREFIX = 'c/' as const;
          export const D_KEY_PREFIX: string = 'd';
          class Writer { static readonly E_KEY_PREFIX = 'e/'; }
          function f() { const F_KEY_PREFIX = 'f/'; return F_KEY_PREFIX; }
        `);

        expect(constants.map((c) => [c.name, c.value])).toEqual([
          ['A_KEY_PREFIX', 'a/'],
          ['B_KEY_PREFIX', 'b/'],
          ['C_KEY_PREFIX', 'c/'],
          ['D_KEY_PREFIX', 'd'],
          ['E_KEY_PREFIX', 'e/'],
          ['F_KEY_PREFIX', 'f/'],
        ]);
      });

      it('ignores comments, other names, substitutions and derived values', () => {
        const constants = scan(`
          // export const COMMENTED_KEY_PREFIX = 'x/';
          /* const BLOCK_KEY_PREFIX = 'y/'; */
          const text = "const STRING_KEY_PREFIX = 'z/'";
          export const KEY_PREFIX_LIKE = 'w/';
          export const TEMPLATE_KEY_PREFIX = \`\${'uploads'}/\`;
          export const DERIVED_KEY_PREFIX = UPLOADS_KEY_PREFIX;
        `);

        expect(constants).toEqual([]);
      });

      it('normalises a value without its trailing slash, and accepts a key under a registered prefix', () => {
        const constants = scan(`
          export const NODE_KEY_PREFIX = 'node-outputs';
          export const NESTED_KEY_PREFIX = 'uploads/archive/';
          export const NEAR_MISS_KEY_PREFIX = 'uploads-archive';
        `);

        expect(unregisteredKeyPrefixes(constants, STORAGE_KEY_PREFIXES).map((c) => c.name)).toEqual([
          'NEAR_MISS_KEY_PREFIX',
        ]);
      });
    });
  });
});

describe("the app's storage-key-prefixes.ts stays a no-import leaf", () => {
  const LEAF = join(__dirname, 'storage-key-prefixes.ts');

  it('evaluates with a require that is never called', () => {
    // Loaded the way Node would, with a recording `require`: any import,
    // including a type-only one that survives compilation, shows up here.
    const { outputText } = ts.transpileModule(readFileSync(LEAF, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const required: string[] = [];
    const fakeModule = { exports: {} as Record<string, unknown> };
    new Function('require', 'module', 'exports', outputText)(
      (specifier: string) => {
        required.push(specifier);
        return {};
      },
      fakeModule,
      fakeModule.exports,
    );

    expect(required).toEqual([]);
    expect(fakeModule.exports).toEqual({
      DATABASE_BACKUPS_KEY_PREFIX: 'database-backups/',
      AI_OUTPUTS_KEY_PREFIX: 'ai-outputs/',
    });
  });

  it('loaded alone (jest.isolateModules), it pulls in neither the manifest nor the registry', () => {
    jest.isolateModules(() => {
      require('./storage-key-prefixes');
      const { listDefinedRegistries } = require('@marinoscar/platform-api/core') as typeof import('@marinoscar/platform-api/core');

      // Had the leaf loaded the manifest, this isolated copy of the primitive
      // would already have the storage-key-prefixes registry defined.
      expect(listDefinedRegistries().map((r) => r.name)).not.toContain('storage-key-prefixes');
    });
  });
});

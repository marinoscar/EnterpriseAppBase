import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// =============================================================================
// No local copies of what moved into @marinoscar/platform-api/core (issue #698)
// or @marinoscar/platform-api/host (issue #867)
// =============================================================================
//
// The registry primitive, the principal and scope contract, the exception
// filter and its exceptions, the error DTO, the secret cipher and (#866) the
// role and permission registries used to live under apps/api/src/common/. They now live in `@marinoscar/platform-api/core`
// and the app imports them from there, with no re-export shims left behind:
// a shim becomes the next local copy, and two copies of the cipher (two key
// caches) or of the verbatim-body brand are exactly the drift the package
// exists to end.
//
// This spec fails when
//   1. any of those paths exists again under apps/api/src/common/, or
//   2. any file under apps/api/{src,test,prisma,scripts} has an import,
//      export-from, require(), import() or jest.mock() specifier that
//      resolves to one of them.
//
// The fix for a failure is always the same: import the symbol from
// `@marinoscar/platform-api/core`. If the package lacks something the app
// needs, that is a seam request (docs/specs/platform-packages.md), not a
// local copy.
// =============================================================================

const API_ROOT = resolve(__dirname, '..', '..');
const COMMON = join(API_ROOT, 'src', 'common');

/** What moved, relative to apps/api/src/common. A directory forbids everything under it. */
const MOVED: ReadonlyArray<{ path: string; kind: 'file' | 'dir' }> = [
  { path: 'registry', kind: 'dir' },
  { path: 'principal', kind: 'dir' },
  { path: 'filters/http-exception.filter', kind: 'file' },
  { path: 'exceptions', kind: 'dir' },
  { path: 'dto/error.dto', kind: 'file' },
  { path: 'crypto', kind: 'dir' },
  // The role and permission registries (#866): the registry, the id helper and
  // the platform roles are core's and the manifest slice's now.
  { path: 'permissions/permission.registry', kind: 'file' },
  { path: 'permissions/permission-ids', kind: 'file' },
  { path: 'permissions/platform-roles', kind: 'file' },
  // The host core (#867), `@marinoscar/platform-api/host`: the event bus, the
  // platform's app metrics, maintenance mode, the envelope, the request log
  // line and request ids. (`maintenance/allow-during-maintenance.decorator`
  // stays: core's decorator, re-exported.)
  { path: 'event-bus', kind: 'dir' },
  { path: 'interceptors', kind: 'dir' },
  { path: 'middleware', kind: 'dir' },
  { path: 'otel/app-metrics.service', kind: 'file' },
  { path: 'otel/app-metrics.module', kind: 'file' },
  { path: 'otel/platform-app-metrics', kind: 'file' },
  { path: 'maintenance/maintenance-mode.service', kind: 'file' },
  { path: 'maintenance/maintenance.guard', kind: 'file' },
  { path: 'maintenance/maintenance.controller', kind: 'file' },
  { path: 'maintenance/maintenance.module', kind: 'file' },
  { path: 'maintenance/maintenance.system-settings', kind: 'file' },
  { path: 'maintenance/dto', kind: 'dir' },
  { path: 'maintenance/doctor', kind: 'dir' },
];

const SCANNED_DIRS = ['src', 'test', 'prisma', 'scripts'];

/** Every .ts file under `dir`, skipping node_modules and build output. */
function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'generated') return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * Every module specifier a TypeScript source names: static and type imports,
 * export-from, side-effect imports, `require()`, `import()` (including
 * `typeof import()`), and `jest.mock`/`doMock`/`requireActual`. Comments are
 * stripped first, so prose that mentions an old path never counts.
 */
function specifiersOf(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\b(?:require|import|jest\.(?:mock|doMock|requireActual|requireMock|unmock))\s*\(\s*['"]([^'"]+)['"]/g,
  ];
  return patterns.flatMap((re) => [...code.matchAll(re)].map((m) => m[1]));
}

/**
 * The moved path a specifier written in `fromFile` resolves to, or null.
 * Only relative specifiers can reach apps/api/src/common; a package name
 * (including `@marinoscar/platform-api/core`) never matches.
 */
function movedTargetOf(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const target = resolve(dirname(fromFile), specifier).replace(/\.(ts|js)$/, '');
  const rel = relative(COMMON, target).split(sep).join('/');
  if (rel.startsWith('..')) return null;
  for (const moved of MOVED) {
    const hit =
      moved.kind === 'dir'
        ? rel === moved.path || rel.startsWith(`${moved.path}/`)
        : rel === moved.path;
    if (hit) return `src/common/${moved.path}`;
  }
  return null;
}

describe('no local copies of @marinoscar/platform-api/core (issue #698)', () => {
  it('none of the moved paths exists under apps/api/src/common', () => {
    const present = MOVED.flatMap(({ path, kind }) => {
      const full = join(COMMON, path);
      if (kind === 'dir') {
        // An empty directory left behind by a checkout is not a copy.
        return existsSync(full) && statSync(full).isDirectory() && tsFiles(full).length > 0 ? [`src/common/${path}/`] : [];
      }
      return ['.ts', '.js'].filter((ext) => existsSync(full + ext)).map((ext) => `src/common/${path}${ext}`);
    });

    expect(present).toEqual([]);
  });

  it('no file under apps/api imports a moved path', () => {
    const files = SCANNED_DIRS.flatMap((dir) => tsFiles(join(API_ROOT, dir)));
    expect(files.length).toBeGreaterThan(100);

    const offenders = files.flatMap((file) =>
      specifiersOf(readFileSync(file, 'utf8')).flatMap((specifier) => {
        const target = movedTargetOf(specifier, file);
        return target ? [`${relative(API_ROOT, file)}: '${specifier}' -> ${target} (import @marinoscar/platform-api/core)`] : [];
      }),
    );

    expect(offenders).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // The scanner itself: proves the two checks above would fail on a re-added
  // copy, rather than passing because a regex matches nothing.
  // ---------------------------------------------------------------------------

  describe('scanner', () => {
    const inSrc = (path: string) => join(API_ROOT, 'src', path);

    it('finds every specifier form the app uses', () => {
      const source = [
        "import { a } from '../common/registry';",
        "import type { B } from './x';",
        "export { c } from '../common/crypto/secret-cipher';",
        "import '../side-effect';",
        "const d = require('../common/exceptions/database-seed.exception');",
        "type E = typeof import('../common/dto/error.dto');",
        "jest.mock('../common/filters/http-exception.filter');",
        "// import { z } from '../common/registry';",
        "/* require('../common/crypto') */",
      ].join('\n');

      expect(specifiersOf(source)).toEqual(
        expect.arrayContaining([
          '../common/registry',
          './x',
          '../common/crypto/secret-cipher',
          '../side-effect',
          '../common/exceptions/database-seed.exception',
          '../common/dto/error.dto',
          '../common/filters/http-exception.filter',
        ]),
      );
      expect(specifiersOf(source)).toHaveLength(7);
    });

    it('resolves relative specifiers to a moved path, from src and from test', () => {
      expect(movedTargetOf('../common/registry', inSrc('doctor/x.ts'))).toBe('src/common/registry');
      expect(movedTargetOf('../registry', inSrc('common/permissions/x.ts'))).toBe('src/common/registry');
      expect(movedTargetOf('./index', inSrc('common/registry/x.ts'))).toBe('src/common/registry');
      expect(movedTargetOf('../../common/crypto/secret-cipher', inSrc('ai/keys/x.ts'))).toBe('src/common/crypto');
      expect(movedTargetOf('../exceptions/verbatim-error-body.exception', inSrc('common/filters/x.ts'))).toBe(
        'src/common/exceptions',
      );
      expect(movedTargetOf('./common/filters/http-exception.filter', inSrc('app.module.ts'))).toBe(
        'src/common/filters/http-exception.filter',
      );
      expect(movedTargetOf('../../src/common/dto/error.dto', join(API_ROOT, 'test', 'x', 'y.spec.ts'))).toBe(
        'src/common/dto/error.dto',
      );
      expect(movedTargetOf('../../src/common/principal', join(API_ROOT, 'test', 'x', 'y.spec.ts'))).toBe(
        'src/common/principal',
      );
    });

    it('leaves the package, unrelated common/ paths and look-alikes alone', () => {
      expect(movedTargetOf('@marinoscar/platform-api/core', inSrc('app.module.ts'))).toBeNull();
      expect(movedTargetOf('../common/filters/other.filter', inSrc('auth/x.ts'))).toBeNull();
      expect(movedTargetOf('../common/dto/pagination.dto', inSrc('auth/x.ts'))).toBeNull();
      expect(movedTargetOf('../common/registry-helpers', inSrc('auth/x.ts'))).toBeNull();
      expect(movedTargetOf('../common/permissions', inSrc('auth/x.ts'))).toBeNull();
      expect(movedTargetOf('./filters/google-oauth-exception.filter', inSrc('auth/x.ts'))).toBeNull();
    });
  });
});

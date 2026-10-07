// =============================================================================
// ⚠ EVERY PRINCIPAL-CHANGING WRITE INVALIDATES THE CACHE (PP-1.12, issue #683)
// =============================================================================
//
// `PrincipalCache` lets a JWT request reuse the user/role/permission join for
// up to AUTH_PRINCIPAL_CACHE_TTL_SECONDS. docs/SECURITY-ARCHITECTURE.md §1 still
// promises that a deactivation or role change reaches the NEXT request, and the
// only thing keeping that promise is every write site calling
// `principalCache.invalidate(...)` after it commits.
//
// The regression this stops is invisible from inside the file that causes it:
// somebody adds a `userRole.create` for a new "grant role on invite" feature,
// every test passes, and the grantee simply keeps their old permissions for up
// to the TTL on every replica. So the rule is executable.
//
// WHAT IT CHECKS: every non-test `.ts` file under `apps/api/src` that WRITES a
// principal-shaping table through Prisma — `userRole.<write>(`,
// `user.<write>(` (update, updateMany, upsert, delete, deleteMany),
// `rolePermission.<write>(`, `role.<write>(` or `membership.<write>(` (the
// org role lives on the membership since PP-6.3) — must also contain
// `principalCache.invalidate(`. It is a tripwire on the shape of a file, not
// a proof about the call graph: it does not check that the call is on every
// branch, or after the commit. Each site's own spec pins that.
//
// `user.create(` is deliberately NOT a marker: nothing can be cached for a
// user who did not exist a moment ago.
//
// THE ALLOWLIST IS A LIST, each entry argued, so adding one is a reviewed
// change. The role ↔ permission seed (`prisma/seed.ts`, `seed-data.ts`) lives
// outside `src/` and is not scanned: it runs at deploy time, before the API
// restarts with an empty cache (see docs/SECURITY-ARCHITECTURE.md §1).
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', 'src');

/** The identity slice's source (#727): the user, role and membership writers moved there. */
const IDENTITY_SRC = join(__dirname, '..', '..', '..', '..', 'packages', 'platform-api', 'src', 'identity');

/** Files under `src/` that may write without invalidating. Each entry says why. */
// Empty since PP-6.4 (#724): `organizations/organizations.service.ts` now
// invalidates after its own committed membership writes.
const ALLOWLIST: ReadonlyArray<{ file: string; why: string }> = [];

const WRITE = '(?:create|createMany|createManyAndReturn|upsert|update|updateMany|updateManyAndReturn|delete|deleteMany)';

const WRITE_MARKERS: ReadonlyArray<{ pattern: RegExp; what: string }> = [
  { pattern: new RegExp(`\\buserRole\\.${WRITE}\\(`), what: 'a userRole write' },
  { pattern: /\buser\.(?:update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\(/, what: 'a user write' },
  { pattern: new RegExp(`\\brolePermission\\.${WRITE}\\(`), what: 'a rolePermission write' },
  { pattern: new RegExp(`\\brole\\.${WRITE}\\(`), what: 'a role write' },
  // PP-6.3 (#723): the membership carries the org role, so a membership write
  // changes what the user's principal resolves to.
  { pattern: new RegExp(`\\bmembership\\.${WRITE}\\(`), what: 'a membership write' },
];

// `invalidateUser(userId)` (#724) is `invalidate({ userId })` under its own name.
const INVALIDATION = /\bprincipalCache\.invalidate(?:User)?\(/;

/** Every non-test `.ts` file under `dir`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) return [];
    return [full];
  });
}

/** Comments removed, so a prose mention neither triggers nor satisfies the rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The write markers present in `source`. */
function writesIn(source: string): string[] {
  const code = stripComments(source);
  return WRITE_MARKERS.filter(({ pattern }) => pattern.test(code)).map(({ what }) => what);
}

function invalidates(source: string): boolean {
  return INVALIDATION.test(stripComments(source));
}

const files = [
  ...sourceFiles(SRC).map((full) => ({
    file: relative(SRC, full).split('\\').join('/'),
    source: readFileSync(full, 'utf8'),
  })),
  // Labelled `identity/<path>` so they cannot collide with an app path.
  ...sourceFiles(IDENTITY_SRC).map((full) => ({
    file: `identity/${relative(IDENTITY_SRC, full).split('\\').join('/')}`,
    source: readFileSync(full, 'utf8'),
  })),
];

const writers = files.filter(({ source }) => writesIn(source).length > 0);

describe('principal cache invalidation sites (PP-1.12, #683)', () => {
  it('the detector recognises writes and invalidations, and ignores reads and comments', () => {
    expect(writesIn('await tx.userRole.createMany({ data })')).toEqual(['a userRole write']);
    expect(writesIn('await this.prisma.user.update({ where })')).toEqual(['a user write']);
    expect(writesIn('await this.prisma.rolePermission.deleteMany({})')).toEqual(['a rolePermission write']);
    expect(writesIn('await this.prisma.userRole.count({ where })')).toEqual([]);
    expect(writesIn('await this.prisma.user.findUnique({ where })')).toEqual([]);
    expect(writesIn('await this.prisma.user.create({ data })')).toEqual([]);
    expect(writesIn('// we used to call prisma.user.update( here')).toEqual([]);

    expect(invalidates('this.principalCache.invalidate({ userId });')).toBe(true);
    expect(invalidates('// remember principalCache.invalidate(')).toBe(false);
    expect(invalidates('this.principalCache.invalidateUser(userId);')).toBe(true);
  });

  it('finds the known write sites (so the scan cannot silently rot to "nothing to check")', () => {
    const found = writers.map(({ file }) => file);
    for (const known of [
      'identity/users/users.service.ts',
      'identity/auth/auth.service.ts',
      'identity/auth/admin-bootstrap.service.ts',
      'identity/testing/test-auth.service.ts',
      'settings/user-settings/user-settings.service.ts',
      'identity/organizations/organizations.service.ts',
    ]) {
      expect(found).toContain(known);
    }
  });

  it('every file that writes a principal-shaping table calls principalCache.invalidate', () => {
    const allowed = new Set(ALLOWLIST.map(({ file }) => file));
    const offenders = writers
      .filter(({ file }) => !allowed.has(file))
      .filter(({ source }) => !invalidates(source))
      .map(({ file, source }) => `${file} (${writesIn(source).join(', ')})`);

    expect(offenders).toEqual([]);
  });

  it('every allowlist entry still exists, still writes, and says why', () => {
    for (const { file, why } of ALLOWLIST) {
      const entry = files.find((f) => f.file === file);
      expect(entry).toBeDefined();
      expect(writesIn(entry!.source).length).toBeGreaterThan(0);
      expect(why.length).toBeGreaterThan(40);
    }
  });
});

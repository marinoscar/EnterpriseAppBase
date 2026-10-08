// =============================================================================
// Tripwire: only allowlisted files inject PrismaSystemService (issue #725)
// =============================================================================
//
// The system client is the ONE way to read or write across organizations: its
// transactions set `app.rls_bypass`. A file that injects it by accident has
// quietly opted out of tenant isolation, so every injection is a reviewed
// decision: this list. The scan reads every source file under src/ (specs
// excluded) for the class name in a constructor parameter, a property, an
// `@Inject(...)` or a `moduleRef.get(...)`, and fails for a file that is not on
// the list AND for an entry that no longer injects it (a stale allowlist).
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', '..', 'src');

/**
 * The packaged storage slice (#736): it reaches the bypass client through its
 * `STORAGE_SYSTEM_DATA` port (bound above), so its acquisitions are checked
 * for a reason from the closed list too.
 */
const STORAGE_SLICE_SRC = join(__dirname, '..', '..', '..', '..', 'packages', 'platform-api', 'src', 'storage');

/**
 * Files that may mention PrismaSystemService, each with why. Relative to
 * apps/api/src, forward slashes.
 */
const ALLOWLIST: Record<string, string> = {
  'prisma/prisma-system.service.ts': 'defines it',
  'prisma/prisma.module.ts': 'provides and exports it',
  'platform/storage/storage-host.module.ts':
    'purge and admin-aggregate: the storage slice\'s STORAGE_SYSTEM_DATA port (#736): the stale-upload sweep (purge), the stranded-object count (admin-aggregate), the public avatar route (admin-aggregate) and the previous avatar removed across an org switch (purge)',
  'platform/settings/settings-profile-images.adapter.ts':
    'admin-aggregate: the settings slice\'s profile-image port validates the user\'s own avatar row across an org switch',
  'platform/ai/ai-host.module.ts':
    'retention and admin-aggregate: the AI slice\'s AI_SYSTEM_PRISMA port (its two retention purges, the deployment-wide usage report and the catalogue sync\'s organization-less usage row)',
  'health/doctor/rls-role.doctor-check.ts': 'doctor: read-only catalogue reads',
  'db-backup/doctor/backup-rls.doctor-check.ts': 'doctor: read-only row counts',
  'platform/exports/exports-host.module.ts':
    'export and purge: the exports slice\'s EXPORTS_SYSTEM_DATA port (#744): the user-data and org-data sources read one user\'s or one organization\'s rows with an explicit filter (export), the status and download routes find the file\'s row (export), and export.purge deletes expired export files (purge)',
  'platform/sharing/sharing-data.adapter.ts':
    'purge and doctor: the sharing slice\'s user purge (GroupMembershipPurge) and its read-only orphaned-groups check',
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
  });
}

/** The code of a file with comments removed, so a mention in prose never counts. */
function code(file: string): string {
  return readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
}

describe('PrismaSystemService injection boundary', () => {
  const mentions = sources(SRC)
    .filter((file) => /\bPrismaSystemService\b/.test(code(file)))
    .map((file) => relative(SRC, file).split(sep).join('/'))
    .sort();

  it('finds the injections (guards against a scan that matches nothing)', () => {
    // Fewer since the storage (#736) and AI (#739) slices moved their
    // bypass-client users into the packages (each binds its own port).
    expect(mentions.length).toBeGreaterThanOrEqual(8);
  });

  it('is mentioned only by allowlisted files', () => {
    expect(mentions.filter((file) => !(file in ALLOWLIST))).toEqual([]);
  });

  it('has no stale allowlist entry', () => {
    expect(Object.keys(ALLOWLIST).filter((file) => !mentions.includes(file))).toEqual([]);
  });

  it('is never constructed by hand outside its module (no `new PrismaSystemService`)', () => {
    const offenders = sources(SRC)
      .filter((file) => /new\s+PrismaSystemService\s*\(/.test(code(file)))
      .map((file) => relative(SRC, file).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });

  it('is never exported from a package entry point or re-provided by another module', () => {
    const providers = sources(SRC)
      .filter((file) => /provide:\s*PrismaSystemService/.test(code(file)))
      .map((file) => relative(SRC, file).split(sep).join('/'));
    expect(providers).toEqual([]);
  });

  it('gives every system acquisition a reason from the closed list', () => {
    const reasons = ['backup', 'restore', 'purge', 'doctor', 'retention', 'admin-aggregate', 'migration-tooling', 'link-resolution', 'export'];
    const bad: string[] = [];
    for (const file of [...sources(SRC), ...sources(STORAGE_SLICE_SRC)]) {
      for (const match of code(file).matchAll(/\.(?:asSystem|runAsSystem)\(\s*'([^']*)'/g)) {
        if (!reasons.includes(match[1]!)) bad.push(`${relative(SRC, file)}: ${match[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

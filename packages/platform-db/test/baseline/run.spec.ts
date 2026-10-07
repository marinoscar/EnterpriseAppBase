import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BaselineError,
  isBaselineClean,
  renderReport,
  resolveThrough,
  runBaseline,
  type BaselineOptions,
} from '../../src/baseline/index.js';
import { parseLock, parseManifest, sha256Hex } from '../../src/lock/index.js';
import {
  ACTIVE_INDEX,
  APP_DIRS,
  PACKAGE_SQL,
  appLedger,
  dropFromApp,
  fakeDeps,
  finished,
  makeBaselineWorkspace,
  snapshot,
  type BaselineWorkspace,
} from '../helpers/baseline.js';

const options = (ws: BaselineWorkspace, extra: Partial<BaselineOptions> = {}): BaselineOptions => ({
  appPrismaDir: ws.appPrismaDir,
  packageDir: ws.packageDir,
  apply: false,
  through: '5',
  ...extra,
});
const codes = (r: { refusals: { code: string }[] }): string[] => r.refusals.map((x) => x.code);
const localDirs = (ws: BaselineWorkspace): string[] => readdirSync(ws.migrationsDir).filter((d) => /^\d{14}_/.test(d)).sort();

describe('dry run (the default)', () => {
  it('writes no file and runs no prisma command, even when there is something to resolve', async () => {
    // 0002's effect is in the database under an app-only name; the app has no directory for it.
    const ws = makeBaselineWorkspace();
    const deps = fakeDeps({ ledger: dropFromApp(ws, '20260102000000_add_orgs') });
    const before = snapshot(ws.root);

    const report = await runBaseline(options(ws), deps);

    expect(report.applied).toBe(false);
    expect(report.unmatched).toEqual(['platform:0002_add_orgs']);
    expect(report.toResolve).toEqual([{ originId: 'platform:0002_add_orgs', localDir: '20260101000001_add_orgs', install: true }]);
    expect(deps.calls.prisma).toEqual([]);
    expect(snapshot(ws.root)).toEqual(before);
    expect(existsSync(ws.lockFile)).toBe(false);
    expect(isBaselineClean(report)).toBe(true);
    expect(renderReport(report).join('\n')).toContain('would resolve --applied 20260101000001_add_orgs');
  });

  it('reports a clean full mapping and says writing the lock is all --apply would do', async () => {
    const ws = makeBaselineWorkspace();
    const report = await runBaseline(options(ws), fakeDeps({ ledger: appLedger(ws) }));
    expect(report.matched.map((m) => m.kind)).toEqual(['sha256', 'sha256', 'sha256', 'sha256', 'sha256']);
    expect(report.toResolve).toEqual([]);
    expect(report.diff).toEqual({ allowed: [], blocking: [] });
    expect(renderReport(report).join('\n')).toContain('--apply writes platform.lock only');
  });

  it('says there is nothing to do once the lock holds the mapping', async () => {
    const ws = makeBaselineWorkspace();
    const deps = fakeDeps({ ledger: appLedger(ws) });
    await runBaseline(options(ws, { apply: true }), deps);
    const again = await runBaseline(options(ws), fakeDeps({ ledger: appLedger(ws) }));
    expect(again.lockUpToDate).toBe(true);
    expect(again.notes.filter((n) => n.includes('force-remap'))).toEqual([]);
    expect(renderReport(again).join('\n')).toContain('nothing to do');
  });
});

describe('refusals', () => {
  it('a non-empty diff blocks --apply, prints the statements and writes nothing', async () => {
    const ws = makeBaselineWorkspace();
    const before = snapshot(ws.root);
    const deps = fakeDeps({ ledger: appLedger(ws), diff: '-- AlterTable\nALTER TABLE "public"."bl_orgs" ADD COLUMN     "extra" TEXT;\n' });
    const report = await runBaseline(options(ws, { apply: true }), deps);
    expect(codes(report)).toEqual(['DIFF_BLOCKING']);
    expect(report.diff.blocking).toEqual(['ALTER TABLE "bl_orgs" ADD COLUMN "extra" TEXT;']);
    expect(report.applied).toBe(false);
    expect(isBaselineClean(report)).toBe(false);
    expect(deps.calls.prisma).toEqual([]);
    expect(snapshot(ws.root)).toEqual(before);
    expect(renderReport(report).join('\n')).toContain('BLOCKING: ALTER TABLE "bl_orgs" ADD COLUMN "extra" TEXT;');
  });

  it('a declared deviation moves its statement from blocking to allowed', async () => {
    const ws = makeBaselineWorkspace();
    writeFileSync(
      ws.lockFile,
      JSON.stringify({
        lockVersion: 1,
        platformVersion: '0.1.0',
        migrations: [],
        deviations: [{ id: 'app:extra', reason: 'the app adds a column', expectDiff: ['ALTER TABLE "bl_orgs" ADD COLUMN "extra" TEXT;'] }],
      }),
    );
    const report = await runBaseline(
      options(ws),
      fakeDeps({ ledger: appLedger(ws), diff: 'ALTER TABLE "public"."bl_orgs" ADD COLUMN     "extra" TEXT;\n' }),
    );
    expect(report.diff).toEqual({ allowed: ['ALTER TABLE "bl_orgs" ADD COLUMN "extra" TEXT;'], blocking: [] });
    expect(report.refusals).toEqual([]);
  });

  it('a failed _prisma_migrations row blocks everything and points to the runbook', async () => {
    const ws = makeBaselineWorkspace();
    const rows = [...appLedger(ws), { migrationName: '20260104000000_broken', checksum: 'x', finishedAt: null, rolledBackAt: null }];
    const deps = fakeDeps({ ledger: rows });
    const report = await runBaseline(options(ws, { apply: true }), deps);
    expect(codes(report)).toEqual(['LEDGER_FAILED_ROW']);
    expect(report.refusals[0]!.message).toContain('docs/runbooks/database-baseline.md');
    expect(report.ledger.problems).toEqual(['20260104000000_broken: never finished']);
    expect(deps.calls.diff).toEqual([]); // detected before anything else
    expect(deps.calls.prisma).toEqual([]);
    expect(existsSync(ws.lockFile)).toBe(false);
  });

  it('a rolled-back row blocks too, unless a later run of the same migration finished', async () => {
    const ws = makeBaselineWorkspace();
    const rolledBack = { migrationName: APP_DIRS['0002_add_orgs']!, checksum: 'x', finishedAt: null, rolledBackAt: new Date('2026-01-01') };
    const blocked = await runBaseline(options(ws), fakeDeps({ ledger: [...appLedger(ws).filter((r) => r.migrationName !== rolledBack.migrationName), rolledBack] }));
    expect(codes(blocked)).toEqual(['LEDGER_FAILED_ROW']);
    const superseded = await runBaseline(options(ws), fakeDeps({ ledger: [rolledBack, ...appLedger(ws)] }));
    expect(superseded.refusals).toEqual([]);
  });

  it('refuses a mapped directory with no finished row, and one whose checksum differs', async () => {
    const ws = makeBaselineWorkspace();
    const rows = appLedger(ws);
    const noRow = await runBaseline(options(ws), fakeDeps({ ledger: rows.slice(0, 4) }));
    expect(codes(noRow)).toEqual(['LEDGER_ROW_MISSING']);
    const wrong = await runBaseline(options(ws), fakeDeps({ ledger: [rows[0]!, finished(rows[1]!.migrationName, 'f'.repeat(64)), ...rows.slice(2)] }));
    expect(codes(wrong)).toEqual(['LEDGER_CHECKSUM_MISMATCH']);
  });

  it('refuses --apply when the lock already has entries, unless --force-remap', async () => {
    const ws = makeBaselineWorkspace();
    await runBaseline(options(ws, { apply: true }), fakeDeps({ ledger: appLedger(ws) }));
    const locked = await runBaseline(options(ws, { apply: true }), fakeDeps({ ledger: appLedger(ws) }));
    expect(codes(locked)).toEqual(['LOCK_NOT_EMPTY']);
    expect(locked.applied).toBe(false);
    const forced = await runBaseline(options(ws, { apply: true, forceRemap: true }), fakeDeps({ ledger: appLedger(ws) }));
    expect(forced.refusals).toEqual([]);
    expect(forced.applied).toBe(true);
  });

  it('asserts the package indexes up to --through, and the lock\'s own indexes always', async () => {
    const ws = makeBaselineWorkspace();
    const ledger = appLedger(ws);
    const missing = await runBaseline(options(ws), fakeDeps({ ledger, indexes: [] }));
    expect(codes(missing)).toEqual(['INDEX_MISSING']);
    const weakened = await runBaseline(
      options(ws),
      fakeDeps({ ledger, indexes: [{ name: ACTIVE_INDEX.name, definition: 'CREATE UNIQUE INDEX bl_orgs_active_idx ON public.bl_orgs USING btree (name)' }] }),
    );
    expect(codes(weakened)).toEqual(['INDEX_DEFINITION_DIFFERS']);
    expect((await runBaseline(options(ws), fakeDeps({ ledger, indexes: [ACTIVE_INDEX] }))).refusals).toEqual([]);
    // Claiming only 0003: the 0005 index is not expected yet.
    expect((await runBaseline(options(ws, { through: '3' }), fakeDeps({ ledger }))).indexProblems).toEqual([]);

    writeFileSync(
      ws.lockFile,
      JSON.stringify({ lockVersion: 1, platformVersion: '0.1.0', migrations: [], rawSqlIndexes: [{ name: 'app_x_idx', definition: 'CREATE INDEX app_x_idx ON public.t USING btree (a) WHERE (a > 1)' }] }),
    );
    const appIndex = await runBaseline(options(ws), fakeDeps({ ledger, indexes: [ACTIVE_INDEX] }));
    expect(appIndex.refusals.map((r) => r.message)).toEqual([expect.stringContaining('app_x_idx')]);
  });

  it('rejects a --through that names no package migration', async () => {
    const ws = makeBaselineWorkspace();
    await expect(runBaseline(options(ws, { through: '9' }), fakeDeps({ ledger: appLedger(ws) }))).rejects.toThrow(/THROUGH_UNKNOWN/);
  });
});

describe('--apply', () => {
  it('installs the missing migration after its predecessor, resolves it in order, writes the lock and verifies', async () => {
    const ws = makeBaselineWorkspace();
    const ledger = dropFromApp(ws, '20260102000000_add_orgs');
    // After the resolve the ledger holds the new row too.
    const resolved: string[] = [];
    const deps = fakeDeps({ ledger, indexes: [ACTIVE_INDEX] });
    const live = deps.readLedger;
    deps.readLedger = async () => [
      ...(await live())!,
      ...resolved.map((dir) => finished(dir, sha256Hex(readFileSync(join(ws.migrationsDir, dir, 'migration.sql'))))),
    ];
    const prisma = deps.prisma;
    deps.prisma = async (args) => {
      if (args[1] === 'resolve') resolved.push(args[3]!);
      return prisma(args);
    };

    const report = await runBaseline(options(ws, { apply: true }), deps);

    expect(report.applied).toBe(true);
    expect(report.verify).toEqual({ ok: true, problems: [] });
    expect(deps.calls.prisma).toEqual([
      ['migrate', 'resolve', '--applied', '20260101000001_add_orgs'],
      ['migrate', 'status'],
    ]);
    expect(localDirs(ws)).toEqual([
      '20260101000000_initial',
      '20260101000001_add_orgs',
      '20260103000000_add_org_slug_index',
      '20260104000000_add_org_name',
      '20260105000000_add_org_active_index',
    ]);
    expect(readFileSync(join(ws.migrationsDir, '20260101000001_add_orgs', 'migration.sql'), 'utf8')).toBe(PACKAGE_SQL['0002_add_orgs']);
    const lock = parseLock(readFileSync(ws.lockFile, 'utf8'));
    expect(lock.platformVersion).toBe('0.1.0'); // a prerelease package version is not written as such
    expect(lock.migrations.map((m) => [m.originId, m.localDir])).toEqual([
      ['platform:0001_initial', '20260101000000_initial'],
      ['platform:0002_add_orgs', '20260101000001_add_orgs'],
      ['platform:0003_add_org_slug_index', '20260103000000_add_org_slug_index'],
      ['platform:0004_add_org_name', '20260104000000_add_org_name'],
      ['platform:0005_add_org_active_index', '20260105000000_add_org_active_index'],
    ]);
    expect(lock.migrations[1]!.sha256).toBe(sha256Hex(PACKAGE_SQL['0002_add_orgs']!));
  });

  it('records localSha256 and a note for a comment-only divergence and keeps the deviations and indexes of the lock', async () => {
    const edited = `-- fork comment\n${PACKAGE_SQL['0003_add_org_slug_index']}`;
    const ws = makeBaselineWorkspace({ app: { '20260103000000_add_org_slug_index': edited } });
    writeFileSync(
      ws.lockFile,
      JSON.stringify({ lockVersion: 1, platformVersion: '0.1.0', migrations: [], deviations: [{ id: 'app:d', reason: 'r', expectDiff: [] }] }),
    );
    const report = await runBaseline(options(ws, { apply: true }), fakeDeps({ ledger: appLedger(ws), indexes: [ACTIVE_INDEX] }));
    expect(report.matched.map((m) => m.kind)).toEqual(['sha256', 'sha256', 'normalised', 'sha256', 'sha256']);
    const lock = parseLock(readFileSync(ws.lockFile, 'utf8'));
    expect(lock.migrations[2]).toMatchObject({ localSha256: sha256Hex(edited) });
    expect(lock.migrations[2]!.note).toBeTruthy();
    expect(lock.deviations).toEqual([{ id: 'app:d', reason: 'r', expectDiff: [] }]);
    expect(report.notes.some((n) => n.includes('by normalised'))).toBe(true);
  });

  it('through below the newest: installs the rest at the end, never resolves it, and accepts a status that lists exactly those', async () => {
    const ws = makeBaselineWorkspace({ appCount: 3, extra: { '20991231000000_app_future': 'SELECT 1;\n' } });
    const deps = fakeDeps({
      ledger: appLedger(ws),
      prisma: (args) =>
        args[1] === 'status'
          ? { status: 1, stdout: 'Following migrations have not yet been applied:\n20991231000001_add_org_name\n20991231000002_add_org_active_index\n\nTo apply...\n', stderr: '' }
          : { status: 0, stdout: '', stderr: '' },
    });
    const report = await runBaseline(options(ws, { apply: true, through: '0003' }), deps);
    expect(report.toInstall.map((i) => i.localDir)).toEqual(['20991231000001_add_org_name', '20991231000002_add_org_active_index']);
    expect(deps.calls.prisma.filter((c) => c[1] === 'resolve')).toEqual([]);
    expect(report.verify).toEqual({ ok: true, problems: [] });
    expect(localDirs(ws)).toContain('20991231000001_add_org_name');
    const lock = parseLock(readFileSync(ws.lockFile, 'utf8'));
    expect(lock.migrations).toHaveLength(5);
  });

  it('a failed resolve takes back the directory it created, writes no lock and throws', async () => {
    const ws = makeBaselineWorkspace();
    const deps = fakeDeps({
      ledger: dropFromApp(ws, '20260102000000_add_orgs'),
      indexes: [ACTIVE_INDEX],
      prisma: () => ({ status: 1, stdout: '', stderr: 'P3008: already recorded' }),
    });
    await expect(runBaseline(options(ws, { apply: true }), deps)).rejects.toThrow(/RESOLVE_FAILED.*P3008/s);
    expect(localDirs(ws)).toEqual([
      '20260101000000_initial',
      '20260103000000_add_org_slug_index',
      '20260104000000_add_org_name',
      '20260105000000_add_org_active_index',
    ]);
    expect(existsSync(ws.lockFile)).toBe(false);
  });

  it('on a database Prisma never managed, records every migration up to --through with resolve, in order', async () => {
    const ws = makeBaselineWorkspace({ appCount: 3, extra: { '20260110000000_app_only': 'SELECT 1;\n' } });
    const resolved: string[] = [];
    const deps = fakeDeps({
      ledger: undefined,
      prisma: (args) => {
        if (args[1] === 'resolve') resolved.push(args[3]!);
        return { status: 0, stdout: 'Database schema is up to date!\n', stderr: '' };
      },
    });
    deps.readLedger = async () => (resolved.length ? resolved.map((d) => finished(d, sha256Hex(readFileSync(join(ws.migrationsDir, d, 'migration.sql'))))) : undefined);
    const report = await runBaseline(options(ws, { apply: true, through: '3' }), deps);
    expect(resolved).toEqual(Object.values(APP_DIRS).slice(0, 3));
    expect(report.ledger.managed).toBe(false);
    expect(report.notes.some((n) => n.includes('App-only directories are NOT resolved'))).toBe(true);
    expect(report.appOnly).toEqual(['20260110000000_app_only']);
  });

  it('a verification failure makes the run unclean without undoing the lock', async () => {
    const ws = makeBaselineWorkspace();
    const deps = fakeDeps({ ledger: appLedger(ws), prisma: () => ({ status: 1, stdout: 'Drift detected', stderr: '' }) });
    const report = await runBaseline(options(ws, { apply: true }), deps);
    expect(report.applied).toBe(true);
    expect(report.verify!.ok).toBe(false);
    expect(isBaselineClean(report)).toBe(false);
    expect(existsSync(ws.lockFile)).toBe(true);
  });

  it('reads the operator map and reports the kind', async () => {
    const rewritten = 'CREATE TABLE IF NOT EXISTS "bl_orgs" ("id" UUID NOT NULL, "slug" TEXT NOT NULL, CONSTRAINT "bl_orgs_pkey" PRIMARY KEY ("id"));\n';
    const ws = makeBaselineWorkspace({ app: { '20260102000000_add_orgs': rewritten } });
    const mapFile = join(ws.root, 'map.json');
    writeFileSync(mapFile, JSON.stringify({ 'platform:0002_add_orgs': '20260102000000_add_orgs' }));
    const report = await runBaseline(options(ws, { mapFile, apply: true }), fakeDeps({ ledger: appLedger(ws) }));
    expect(report.matched.map((m) => m.kind)).toEqual(['sha256', 'operator-map', 'sha256', 'sha256', 'sha256']);
    const lock = parseLock(readFileSync(ws.lockFile, 'utf8'));
    expect(lock.migrations[1]).toMatchObject({ localSha256: sha256Hex(rewritten) });
    writeFileSync(mapFile, '[1,2]');
    await expect(runBaseline(options(ws, { mapFile }), fakeDeps({ ledger: appLedger(ws) }))).rejects.toThrow(/MAP_INVALID/);
  });
});

describe('resolveThrough', () => {
  const manifest = parseManifest(readFileSync(join(makeBaselineWorkspace().packageDir, 'migrations', 'manifest.json'), 'utf8'));
  it('accepts a number, a padded number, an id and an origin id; defaults to the newest', () => {
    for (const form of ['3', '0003', '0003_add_org_slug_index', 'platform:0003_add_org_slug_index']) {
      expect(resolveThrough(manifest, form).id).toBe('0003_add_org_slug_index');
    }
    expect(resolveThrough(manifest).id).toBe('0005_add_org_active_index');
    expect(() => resolveThrough(manifest, '12')).toThrow(BaselineError);
    expect(() => resolveThrough([], undefined)).toThrow(/no migrations/);
  });
});

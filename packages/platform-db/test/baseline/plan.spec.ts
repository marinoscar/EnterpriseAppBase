import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BaselineError, planBaseline, type MatchedMigration } from '../../src/baseline/index.js';
import { parseManifest, originIdOf } from '../../src/lock/index.js';
import { planSync } from '../../src/sync/index.js';
import { emptyLock } from '../../src/lock/index.js';
import { makeBaselineWorkspace } from '../helpers/baseline.js';

const ws = makeBaselineWorkspace();
const manifest = parseManifest(readFileSync(join(ws.packageDir, 'migrations', 'manifest.json'), 'utf8'));
const NOW = new Date('2026-10-06T10:00:00Z');
const hit = (id: string, localDir: string): MatchedMigration => ({ originId: `platform:${id}`, localDir, kind: 'sha256' });

describe('planBaseline', () => {
  it('maps what exists and names nothing', () => {
    const matched = [hit('0001_initial', '20260101000000_initial'), hit('0002_add_orgs', '20260102000000_add_orgs')];
    const plan = planBaseline(manifest.slice(0, 2), matched, matched.map((m) => m.localDir), 2, new Set(matched.map((m) => m.localDir)), NOW);
    expect(plan.map((p) => [p.action, p.localDir, p.resolve])).toEqual([
      ['mapped', '20260101000000_initial', false],
      ['mapped', '20260102000000_add_orgs', false],
    ]);
  });

  it('places an installed-and-resolved migration right after its predecessor, not at the end', () => {
    const matched = [hit('0001_initial', '20260101000000_initial'), hit('0003_add_org_slug_index', '20260103000000_add_org_slug_index')];
    const dirs = [...matched.map((m) => m.localDir), '20260105000000_app_only'];
    const plan = planBaseline(manifest.slice(0, 3), matched, dirs, 3, new Set(matched.map((m) => m.localDir)), NOW);
    expect(plan[1]).toMatchObject({ action: 'install-resolve', localDir: '20260101000001_add_orgs', resolve: true });
  });

  it('takes the next free second when the one after the predecessor is taken', () => {
    const matched = [hit('0001_initial', '20260101000000_initial'), hit('0003_add_org_slug_index', '20260101000005_add_org_slug_index')];
    const dirs = [...matched.map((m) => m.localDir), '20260101000001_app_only', '20260101000002_other'];
    const plan = planBaseline(manifest.slice(0, 3), matched, dirs, 3, new Set(matched.map((m) => m.localDir)), NOW);
    expect(plan[1]!.localDir).toBe('20260101000003_add_orgs');
  });

  it('places a migration without a predecessor before everything', () => {
    const matched = [hit('0002_add_orgs', '20260102000000_add_orgs')];
    const plan = planBaseline(manifest.slice(0, 2), matched, ['20260102000000_add_orgs', '20260101120000_app_base'], 2, new Set(), NOW);
    expect(plan[0]).toMatchObject({ action: 'install-resolve', localDir: '20260101115959_initial' });
  });

  it('installs what is above --through at the end by the sync naming rule', () => {
    const matched = [hit('0001_initial', '20260101000000_initial'), hit('0002_add_orgs', '20260102000000_add_orgs')];
    const dirs = [...matched.map((m) => m.localDir), '20991231000000_app_future'];
    const plan = planBaseline(manifest, matched, dirs, 2, new Set(matched.map((m) => m.localDir)), NOW);
    expect(plan.slice(2).map((p) => [p.action, p.resolve, p.localDir])).toEqual([
      ['install', false, '20991231000001_add_org_slug_index'],
      ['install', false, '20991231000002_add_org_name'],
      ['install', false, '20991231000003_add_org_active_index'],
    ]);
  });

  it('names an installed migration exactly as platform db sync does', () => {
    const sync = planSync(manifest, emptyLock('0.1.0'), ['20260101000000_app_base'], NOW);
    const plan = planBaseline(manifest, [], ['20260101000000_app_base'], 0, new Set(), NOW);
    expect(plan.map((p) => p.localDir)).toEqual(sync.installs.map((i) => i.localDir));
    expect(plan.map((p) => p.originId)).toEqual(manifest.map(originIdOf));
  });

  it('resolves mapped directories too when the database records none (never managed by Prisma)', () => {
    const matched = [hit('0001_initial', '20260101000000_initial')];
    const plan = planBaseline(manifest.slice(0, 1), matched, ['20260101000000_initial'], 1, new Set(), NOW);
    expect(plan[0]).toMatchObject({ action: 'mapped', resolve: true });
  });

  it('carries localSha256 and a note for a match that is not identical', () => {
    const matched: MatchedMigration[] = [{ originId: 'platform:0001_initial', localDir: '20260101000000_initial', kind: 'normalised', localSha256: 'a'.repeat(64) }];
    const [entry] = planBaseline(manifest.slice(0, 1), matched, ['20260101000000_initial'], 1, new Set(['20260101000000_initial']), NOW);
    expect(entry).toMatchObject({ localSha256: 'a'.repeat(64) });
    expect(entry!.note).toMatch(/comments or whitespace/);
  });

  it('refuses when the directories cannot sort in package order', () => {
    // 0002 exists but sorts before 0001: a fresh database would apply them the other way round.
    const matched = [hit('0001_initial', '20260105000000_initial'), hit('0002_add_orgs', '20260102000000_add_orgs')];
    expect(() => planBaseline(manifest.slice(0, 2), matched, matched.map((m) => m.localDir), 2, new Set(), NOW)).toThrow(BaselineError);
    expect(() => planBaseline(manifest.slice(0, 2), matched, matched.map((m) => m.localDir), 2, new Set(), NOW)).toThrow(/PLACEMENT_IMPOSSIBLE/);
  });

  it('refuses when the only free seconds would sort after the successor', () => {
    const matched = [hit('0001_initial', '20260101000000_initial'), hit('0003_add_org_slug_index', '20260101000002_add_org_slug_index')];
    const dirs = [...matched.map((m) => m.localDir), '20260101000001_app_only'];
    expect(() => planBaseline(manifest.slice(0, 3), matched, dirs, 3, new Set(), NOW)).toThrow(/PLACEMENT_IMPOSSIBLE/);
  });
});

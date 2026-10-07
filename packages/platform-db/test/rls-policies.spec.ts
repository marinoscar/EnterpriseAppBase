import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RLS_POLICIES,
  assertRlsPolicies,
  checkRlsPolicies,
  checkRlsPolicySources,
  scanRlsPolicies,
  type PackageRlsPolicy,
} from '../src/drift/index.js';
import { readManifest } from '../src/lock/index.js';

const PACKAGE_DIR = join(__dirname, '..');
const REPO_ROOT = join(PACKAGE_DIR, '..', '..');
const MIGRATIONS = join(PACKAGE_DIR, 'migrations');
const manifest = readManifest(join(MIGRATIONS, 'manifest.json'));

const POLICY = (table: string, name = `${table}_org_isolation`, createdIn = '0001_a'): PackageRlsPolicy => ({
  name,
  table,
  reason: 'test',
  doc: 'docs/x.md',
  createdIn,
});

describe('the shipped package', () => {
  it('passes the tripwire: every policy the migrations leave is listed, and enables and forces its table', () => {
    expect(() => assertRlsPolicies({ manifest, migrationsDir: MIGRATIONS })).not.toThrow();
  });

  it('derives exactly the listed policies from the migration SQL', () => {
    const sql: Array<[string, string]> = manifest.map((e) => [e.id, readFileSync(join(MIGRATIONS, e.dir, 'migration.sql'), 'utf8')]);
    const found = scanRlsPolicies(sql);
    expect(found.policies.map((p) => `${p.table}/${p.name}`).sort()).toEqual(RLS_POLICIES.map((p) => `${p.table}/${p.name}`).sort());
    expect([...found.forced].sort()).toEqual([...new Set(RLS_POLICIES.map((p) => p.table))].sort());
    for (const listed of RLS_POLICIES) {
      expect(found.policies.find((p) => p.name === listed.name)?.createdIn).toBe(listed.createdIn);
    }
  });

  it('lists the seven org-owned tables, each with a policy named <table>_org_isolation and a document that exists', () => {
    expect(RLS_POLICIES.map((p) => p.table).sort()).toEqual([
      'ai_runs',
      'ai_usage_events',
      'group_invites',
      'group_members',
      'groups',
      'storage_object_chunks',
      'storage_objects',
    ]);
    for (const policy of RLS_POLICIES) {
      expect(policy.name).toBe(`${policy.table}_org_isolation`);
      expect(manifest.map((e) => e.id)).toContain(policy.createdIn);
      expect(readFileSync(join(REPO_ROOT, policy.doc), 'utf8').length).toBeGreaterThan(0);
    }
  });

  it('flags the migrations that create them with rls: true in the manifest', () => {
    const flagged = manifest.filter((e) => e.rls === true).map((e) => e.id);
    expect(flagged).toEqual(['0025_org_scoped_rls', '0026_add_groups']);
    expect(new Set(RLS_POLICIES.map((p) => p.createdIn))).toEqual(new Set(flagged));
  });

  it('puts the standard policy shape in the SQL: NULLIF guard, bypass flag and WITH CHECK', () => {
    const sqlOf = (id: string) => readFileSync(join(MIGRATIONS, id, 'migration.sql'), 'utf8');
    for (const policy of RLS_POLICIES) {
      const sql = sqlOf(policy.createdIn);
      const block = new RegExp(`CREATE POLICY "${policy.name}" ON "${policy.table}"[\\s\\S]*?;`).exec(sql)?.[0] ?? '';
      expect(block, policy.name).toContain("NULLIF(current_setting('app.org_id', true), '')::uuid");
      expect(block, policy.name).toContain("current_setting('app.rls_bypass', true) = 'on'");
      expect(block, policy.name).toContain('WITH CHECK');
    }
    for (const id of new Set(RLS_POLICIES.map((p) => p.createdIn))) {
      expect(sqlOf(id)).not.toMatch(/set_config\([^)]*,\s*false\)/);
    }
  });
});

describe('scanRlsPolicies', () => {
  it('reads creates, enables and forces in statement order', () => {
    const found = scanRlsPolicies([
      [
        '0001_a',
        `ALTER TABLE "t" ENABLE ROW LEVEL SECURITY;
         ALTER TABLE "t" FORCE ROW LEVEL SECURITY;
         CREATE POLICY "t_org_isolation" ON "t" USING (true);`,
      ],
    ]);
    expect(found).toEqual({ policies: [{ name: 't_org_isolation', table: 't', createdIn: '0001_a' }], enabled: ['t'], forced: ['t'] });
  });

  it('forgets a dropped policy, a disabled table and a dropped table', () => {
    const found = scanRlsPolicies([
      ['0001_a', 'ALTER TABLE a ENABLE ROW LEVEL SECURITY; ALTER TABLE a FORCE ROW LEVEL SECURITY; CREATE POLICY p ON a USING (true);'],
      ['0002_b', 'DROP POLICY IF EXISTS p ON a; ALTER TABLE a NO FORCE ROW LEVEL SECURITY; ALTER TABLE a DISABLE ROW LEVEL SECURITY;'],
      ['0003_c', 'ALTER TABLE b ENABLE ROW LEVEL SECURITY; CREATE POLICY q ON b USING (true); DROP TABLE b;'],
    ]);
    expect(found).toEqual({ policies: [], enabled: [], forced: [] });
  });

  it('ignores comments and string literals', () => {
    const found = scanRlsPolicies([
      ['0001_a', "-- CREATE POLICY ghost ON x USING (true);\nSELECT 'CREATE POLICY ghost ON x USING (true)';\n/* ALTER TABLE x FORCE ROW LEVEL SECURITY; */"],
    ]);
    expect(found).toEqual({ policies: [], enabled: [], forced: [] });
  });

  it('keeps the first migration as createdIn when a policy is re-created', () => {
    const found = scanRlsPolicies([
      ['0001_a', 'CREATE POLICY p ON a USING (true);'],
      ['0002_b', 'DROP POLICY p ON a; CREATE POLICY p ON a USING (false);'],
    ]);
    expect(found.policies).toEqual([{ name: 'p', table: 'a', createdIn: '0001_a' }]);
  });
});

describe('checkRlsPolicySources', () => {
  const sourcesOf = (files: Record<string, string>) => ({
    manifest: Object.keys(files).map((id) => ({ id, dir: id })),
    readMigration: (dir: string) => files[dir],
  });
  const ENABLED = 'ALTER TABLE t ENABLE ROW LEVEL SECURITY; ALTER TABLE t FORCE ROW LEVEL SECURITY; CREATE POLICY t_org_isolation ON t USING (true);';

  it('is clean when migrations and list agree', () => {
    expect(checkRlsPolicySources({ ...sourcesOf({ '0001_a': ENABLED }), listed: [POLICY('t')] })).toEqual([]);
  });

  it('reports a policy no list names', () => {
    const problems = checkRlsPolicySources({ ...sourcesOf({ '0001_a': ENABLED }), listed: [] });
    expect(problems.map((p) => p.code)).toEqual(['UNLISTED_POLICY']);
  });

  it('reports a listed policy no migration creates', () => {
    const problems = checkRlsPolicySources({ ...sourcesOf({ '0001_a': 'SELECT 1;' }), listed: [POLICY('t')] });
    expect(problems.map((p) => p.code)).toEqual(['LISTED_POLICY_NOT_FOUND']);
  });

  it('reports a wrong createdIn', () => {
    const problems = checkRlsPolicySources({ ...sourcesOf({ '0001_a': ENABLED }), listed: [POLICY('t', 't_org_isolation', '0009_z')] });
    expect(problems.map((p) => p.code)).toEqual(['LISTED_POLICY_MISMATCH']);
  });

  it('reports a policy on a table that never enables or never forces row-level security', () => {
    const notForced = 'ALTER TABLE t ENABLE ROW LEVEL SECURITY; CREATE POLICY t_org_isolation ON t USING (true);';
    const notEnabled = 'CREATE POLICY t_org_isolation ON t USING (true);';
    expect(checkRlsPolicySources({ ...sourcesOf({ '0001_a': notForced }), listed: [POLICY('t')] }).map((p) => p.code)).toEqual(['POLICY_TABLE_NOT_FORCED']);
    expect(checkRlsPolicySources({ ...sourcesOf({ '0001_a': notEnabled }), listed: [POLICY('t')] }).map((p) => p.code)).toEqual([
      'POLICY_TABLE_NOT_ENABLED',
      'POLICY_TABLE_NOT_FORCED',
    ]);
  });
});

describe('checkRlsPolicies (the live catalogue)', () => {
  const expected = [{ name: 't_org_isolation', table: 't' }];
  const good = { policies: [{ table: 't', name: 't_org_isolation' }], tables: [{ table: 't', enabled: true, forced: true }, { table: 'u', enabled: false, forced: false }] };

  it('is clean when the catalogue matches', () => {
    expect(checkRlsPolicies(expected, good.policies, good.tables)).toEqual([]);
  });

  it('reports a missing policy', () => {
    expect(checkRlsPolicies(expected, [], good.tables).map((p) => p.code)).toEqual(['POLICY_MISSING']);
  });

  it('reports an extra policy', () => {
    const problems = checkRlsPolicies(expected, [...good.policies, { table: 'u', name: 'sneaky' }], good.tables);
    expect(problems.map((p) => p.code)).toEqual(['POLICY_UNLISTED']);
  });

  it('reports a table whose row-level security is off, or enabled but not forced', () => {
    expect(checkRlsPolicies(expected, good.policies, [{ table: 't', enabled: false, forced: false }]).map((p) => p.code)).toEqual(['RLS_NOT_ENABLED']);
    expect(checkRlsPolicies(expected, good.policies, [{ table: 't', enabled: true, forced: false }]).map((p) => p.code)).toEqual(['RLS_NOT_FORCED']);
  });

  it('reports a forced table no listed policy protects (it would deny everything)', () => {
    const problems = checkRlsPolicies(expected, good.policies, [...good.tables, { table: 'v', enabled: true, forced: true }]);
    expect(problems.map((p) => p.code)).toEqual(['RLS_FORCED_WITHOUT_POLICY']);
  });
});

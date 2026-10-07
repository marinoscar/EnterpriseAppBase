import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkRawSqlIndexes, isRawSqlIndex, readPackageRawSqlIndexes } from '../../src/drift/index.js';

const PACKAGE_LIST = join(__dirname, '..', '..', 'raw-sql-indexes.json');

describe('raw-sql-indexes.json', () => {
  const indexes = readPackageRawSqlIndexes(PACKAGE_LIST);

  it('lists exactly the six raw-SQL indexes, each with a reason and the migration that creates it', () => {
    expect(indexes.map((i) => i.name).sort()).toEqual([
      'database_backup_runs_active_uniq_idx',
      'group_invites_pending_uniq_idx',
      'jobs_active_dedup_uniq_idx',
      'jobs_attempts_gt1_idx',
      'jobs_succeeded_duration_idx',
      'organizations_default_uniq_idx',
    ]);
    for (const index of indexes) {
      expect(index.reason.length).toBeGreaterThan(20);
      expect(index.createdIn).toMatch(/^\d{4}_[a-z0-9_]+$/);
      expect(isRawSqlIndex(index.definition)).toBe(true);
    }
  });

  it('is shipped with the package', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { files: string[] };
    expect(pkg.files).toContain('raw-sql-indexes.json');
  });
});

describe('checkRawSqlIndexes', () => {
  const expected = [
    { name: 'a_idx', definition: 'CREATE INDEX a_idx ON public.t USING btree (x) WHERE (x > 1)' },
    { name: 'b_idx', definition: 'CREATE UNIQUE INDEX b_idx ON public.t USING btree ((true))' },
  ];

  it('passes when every index exists with its definition (whitespace-insensitive)', () => {
    const live = [
      { name: 'a_idx', definition: 'CREATE INDEX a_idx ON public.t USING btree (x)   WHERE (x > 1)' },
      { name: 'b_idx', definition: expected[1]!.definition },
      { name: 'unrelated_idx', definition: 'CREATE INDEX unrelated_idx ON public.t USING btree (y)' },
    ];
    expect(checkRawSqlIndexes(expected, live)).toEqual([]);
  });

  it('reports a dropped index and one re-created without its WHERE clause', () => {
    const problems = checkRawSqlIndexes(expected, [{ name: 'a_idx', definition: 'CREATE INDEX a_idx ON public.t USING btree (x)' }]);
    expect(problems.map((p) => [p.code, p.name])).toEqual([
      ['INDEX_DEFINITION_DIFFERS', 'a_idx'],
      ['INDEX_MISSING', 'b_idx'],
    ]);
  });

  it('recognises partial and expression indexes, not plain ones', () => {
    expect(isRawSqlIndex('CREATE INDEX i ON public.t USING btree (a, b)')).toBe(false);
    expect(isRawSqlIndex('CREATE UNIQUE INDEX i ON public.t USING btree (a)')).toBe(false);
    expect(isRawSqlIndex('CREATE INDEX i ON public.t USING btree (a) WHERE (a > 1)')).toBe(true);
    expect(isRawSqlIndex('CREATE INDEX i ON public.t USING btree (lower(name))')).toBe(true);
    expect(isRawSqlIndex('CREATE UNIQUE INDEX i ON public.t USING btree ((true))')).toBe(true);
  });
});

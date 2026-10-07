import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RAW_SQL_INDEXES,
  assertRawSqlIndexes,
  checkRawSqlIndexSources,
  scanFragmentIndexes,
  scanRawSqlIndexes,
  type PackageRawSqlIndex,
  type TripwireProblemCode,
} from '../src/drift/index.js';
import { readManifest, sha256Hex } from '../src/lock/index.js';

const PACKAGE_DIR = join(__dirname, '..');
const REPO_ROOT = join(PACKAGE_DIR, '..', '..');
const MIGRATIONS = join(PACKAGE_DIR, 'migrations');
const FRAGMENTS = join(PACKAGE_DIR, 'schema');
const manifest = readManifest(join(MIGRATIONS, 'manifest.json'));

const codes = (problems: Array<{ code: TripwireProblemCode }>): TripwireProblemCode[] => problems.map((p) => p.code);

describe('the shipped package', () => {
  it('passes the tripwire: every raw-SQL index the migrations leave behind is listed, and nothing else', () => {
    expect(() => assertRawSqlIndexes({ manifest, migrationsDir: MIGRATIONS, fragmentsDir: FRAGMENTS })).not.toThrow();
  });

  it('derives exactly the listed indexes from the migration SQL', () => {
    const sql: Array<[string, string]> = manifest.map((e) => [e.id, readFileSync(join(MIGRATIONS, e.dir, 'migration.sql'), 'utf8')]);
    const found = scanRawSqlIndexes(sql);
    expect(found.map((i) => i.name).sort()).toEqual(RAW_SQL_INDEXES.map((i) => i.name).sort());
    for (const listed of RAW_SQL_INDEXES) {
      const actual = found.find((i) => i.name === listed.name)!;
      expect({ table: actual.table, unique: actual.unique, createdIn: actual.createdIn }).toEqual({
        table: listed.table,
        unique: listed.unique,
        createdIn: listed.createdIn,
      });
    }
  });

  it('lists the six indexes of CLAUDE.md, each pointing at a document that exists', () => {
    expect(RAW_SQL_INDEXES.map((i) => [i.name, i.unique])).toEqual([
      ['jobs_active_dedup_uniq_idx', true],
      ['jobs_attempts_gt1_idx', false],
      ['jobs_succeeded_duration_idx', false],
      ['database_backup_runs_active_uniq_idx', true],
      ['organizations_default_uniq_idx', true],
      ['group_invites_pending_uniq_idx', true],
    ]);
    for (const index of RAW_SQL_INDEXES) {
      expect(['docs/specs/job-queue.md', 'docs/specs/database-backup.md', 'docs/specs/platform-packages.md']).toContain(index.doc);
      expect(existsSync(join(REPO_ROOT, index.doc)), `${index.doc} does not exist`).toBe(true);
      expect(manifest.map((e) => e.id)).toContain(index.createdIn);
      expect(index.reason.length).toBeGreaterThan(20);
    }
  });

  it('handles the dropped-and-recreated backup index: created in 0010, still present after 0012', () => {
    const sql: Array<[string, string]> = manifest.map((e) => [e.id, readFileSync(join(MIGRATIONS, e.dir, 'migration.sql'), 'utf8')]);
    const upTo0011 = scanRawSqlIndexes(sql.filter(([id]) => id.slice(0, 4) <= '0011'));
    const upTo0012 = scanRawSqlIndexes(sql.filter(([id]) => id.slice(0, 4) <= '0012'));
    expect(upTo0011.find((i) => i.name === 'database_backup_runs_active_uniq_idx')?.columns).toEqual(['status']);
    expect(upTo0012.find((i) => i.name === 'database_backup_runs_active_uniq_idx')?.columns).toBeNull();
  });
});

describe('scanRawSqlIndexes', () => {
  const scan = (...sql: string[]) => scanRawSqlIndexes(sql.map((s, i) => [`000${i + 1}_m`, s] as const));

  it('ignores plain, composite and ordered indexes', () => {
    expect(
      scan(`CREATE INDEX "a_idx" ON "t"("x");
CREATE UNIQUE INDEX "b_idx" ON "t"("x", "y");
CREATE INDEX "c_idx" ON "t"("created_at" DESC NULLS LAST);`),
    ).toEqual([]);
  });

  it('finds a partial index and an expression index', () => {
    const found = scan(`CREATE UNIQUE INDEX "p_idx" ON "t" ("x") WHERE "x" IS NOT NULL;
CREATE INDEX "e_idx" ON "t" (lower("name"));
CREATE UNIQUE INDEX "c_idx" ON "t" ((true)) WHERE "s" IN ('a','b');`);
    expect(found.map((i) => [i.name, i.unique, i.columns])).toEqual([
      ['p_idx', true, ['x']],
      ['e_idx', false, null],
      ['c_idx', true, null],
    ]);
  });

  it('does not read an index from a comment, a string or a block comment', () => {
    expect(
      scan(`-- CREATE UNIQUE INDEX "ghost_idx" ON "t" ("x") WHERE "x" > 1;
/* CREATE UNIQUE INDEX "ghost2_idx" ON "t" ("x") WHERE "x" > 1; */
INSERT INTO "t" ("note") VALUES ('CREATE UNIQUE INDEX ghost3_idx ON t (x) WHERE x > 1; -- no');`),
    ).toEqual([]);
  });

  it('follows DROP INDEX and RENAME across migrations, keeping the first createdIn', () => {
    const found = scan(
      'CREATE UNIQUE INDEX "a_idx" ON "t" ("x") WHERE "x" > 1;\nCREATE INDEX "b_idx" ON "t" ("y") WHERE "y" > 1;',
      'DROP INDEX "a_idx";\nCREATE UNIQUE INDEX "a_idx" ON "t" ((true)) WHERE "x" > 1;\nALTER INDEX "b_idx" RENAME TO "c_idx";',
      'DROP INDEX IF EXISTS "c_idx";',
    );
    expect(found).toEqual([{ name: 'a_idx', table: 't', unique: true, columns: null, createdIn: '0001_m' }]);
  });
});

describe('scanFragmentIndexes', () => {
  const jobs = `model Job {
  id       String  @id @db.Uuid
  dedupKey String? @map("dedup_key")
  status   String
  email    String  @unique

  @@index([status, dedupKey(sort: Desc)], map: "jobs_status_idx")
  @@map("jobs")
}`;

  it('translates field names to column names and reads map names and field-level @unique', () => {
    const found = scanFragmentIndexes('f.prisma', jobs);
    expect(found.map((f) => [f.kind, f.table, f.columns, f.names])).toEqual([
      ['@unique', 'jobs', ['email'], []],
      ['@@index', 'jobs', ['status', 'dedup_key'], ['jobs_status_idx']],
    ]);
  });
});

describe('checkRawSqlIndexSources (fixtures)', () => {
  const listed: PackageRawSqlIndex[] = [
    {
      name: 'jobs_active_dedup_uniq_idx',
      table: 'jobs',
      unique: true,
      definition: 'CREATE UNIQUE INDEX jobs_active_dedup_uniq_idx ON public.jobs USING btree (dedup_key) WHERE (dedup_key IS NOT NULL)',
      reason: 'a fixture index',
      doc: 'docs/specs/job-queue.md',
      createdIn: '0001_base',
    },
  ];
  const baseSql = 'CREATE UNIQUE INDEX "jobs_active_dedup_uniq_idx" ON "jobs"("dedup_key") WHERE "dedup_key" IS NOT NULL;';
  const entries = [
    { id: '0001_base', dir: '0001_base' },
    { id: '0002_more', dir: '0002_more' },
  ];
  const run = (more: string, fragments: Array<{ file: string; text: string }> = [], list = listed) =>
    checkRawSqlIndexSources({
      manifest: entries,
      readMigration: (dir) => (dir === '0001_base' ? baseSql : dir === '0002_more' ? more : undefined),
      fragments,
      listed: list,
    });

  it('passes a clean fixture', () => {
    expect(run('CREATE INDEX "plain_idx" ON "jobs"("type");')).toEqual([]);
  });

  it('UNLISTED_RAW_INDEX: a new migration adds a partial index nobody listed', () => {
    const problems = run('CREATE UNIQUE INDEX "orders_open_uniq_idx" ON "orders"("ref") WHERE "open";');
    expect(codes(problems)).toEqual(['UNLISTED_RAW_INDEX']);
    expect(problems[0]!.message).toContain('orders_open_uniq_idx');
    expect(problems[0]!.message).toContain('0002_more');
  });

  it('UNLISTED_RAW_INDEX: an expression index is caught too', () => {
    expect(codes(run('CREATE INDEX "users_lower_email_idx" ON "users"(lower("email"));'))).toEqual(['UNLISTED_RAW_INDEX']);
  });

  it('LISTED_INDEX_NOT_FOUND: a listed index is dropped, or listed but never created', () => {
    expect(codes(run('DROP INDEX "jobs_active_dedup_uniq_idx";'))).toEqual(['LISTED_INDEX_NOT_FOUND']);
    expect(codes(run('', [], [...listed, { ...listed[0]!, name: 'never_created_idx' }]))).toEqual(['LISTED_INDEX_NOT_FOUND']);
  });

  it('LISTED_INDEX_NOT_FOUND: a listed index re-created without its WHERE clause is no longer raw', () => {
    expect(
      codes(run('DROP INDEX "jobs_active_dedup_uniq_idx";\nCREATE UNIQUE INDEX "jobs_active_dedup_uniq_idx" ON "jobs"("dedup_key");')),
    ).toEqual(['LISTED_INDEX_NOT_FOUND']);
  });

  it('LISTED_INDEX_MISMATCH: the listed table, uniqueness or createdIn is wrong', () => {
    const wrong = [{ ...listed[0]!, table: 'tasks', unique: false, createdIn: '0002_more' }];
    const problems = run('', [], wrong);
    expect(codes(problems)).toEqual(['LISTED_INDEX_MISMATCH']);
    expect(problems[0]!.message).toMatch(/table jobs.*unique=true.*created in 0001_base/);
  });

  it('FRAGMENT_DECLARES_RAW_INDEX: @@unique on jobs.dedup_key (the same key columns)', () => {
    const fragment = `model Job {
  id       String  @id
  dedupKey String? @map("dedup_key")

  @@unique([dedupKey])
  @@map("jobs")
}`;
    const problems = run('', [{ file: 'schema/jobs.prisma', text: fragment }]);
    expect(codes(problems)).toEqual(['FRAGMENT_DECLARES_RAW_INDEX']);
    expect(problems[0]!.message).toContain('schema/jobs.prisma:5');
    expect(problems[0]!.message).toContain('docs/specs/job-queue.md');
  });

  it('FRAGMENT_DECLARES_RAW_INDEX: a field-level @unique, or the index name in map:', () => {
    const field = 'model Job {\n  dedupKey String? @unique @map("dedup_key")\n  @@map("jobs")\n}';
    expect(codes(run('', [{ file: 'a.prisma', text: field }]))).toEqual(['FRAGMENT_DECLARES_RAW_INDEX']);
    const named = 'model Job {\n  x String\n  @@index([x], map: "jobs_active_dedup_uniq_idx")\n  @@map("jobs")\n}';
    expect(codes(run('', [{ file: 'b.prisma', text: named }]))).toEqual(['FRAGMENT_DECLARES_RAW_INDEX']);
  });

  it('does not flag the same column in another table, or other key columns on the same table', () => {
    const other = 'model Task {\n  dedupKey String? @map("dedup_key")\n  @@unique([dedupKey])\n  @@map("tasks")\n}';
    const wider = 'model Job {\n  dedupKey String? @map("dedup_key")\n  type String\n  @@unique([type, dedupKey])\n  @@map("jobs")\n}';
    expect(run('', [{ file: 'c.prisma', text: other }, { file: 'd.prisma', text: wider }])).toEqual([]);
  });
});

describe('assertRawSqlIndexes (on disk)', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('throws naming every problem, and passes once the index is listed', () => {
    dir = mkdtempSync(join(tmpdir(), 'raw-sql-tripwire-'));
    const sql = 'CREATE UNIQUE INDEX "orders_open_uniq_idx" ON "orders"("ref") WHERE "open";\n';
    mkdirSync(join(dir, 'migrations', '0001_x'), { recursive: true });
    writeFileSync(join(dir, 'migrations', '0001_x', 'migration.sql'), sql);
    mkdirSync(join(dir, 'schema'));
    writeFileSync(join(dir, 'schema', 'orders.prisma'), 'model Order {\n  ref String @unique\n  @@map("orders")\n}\n');
    const entries = [{ id: '0001_x', dir: '0001_x', sha256: sha256Hex(sql) }];
    const options = { manifest: entries, migrationsDir: join(dir, 'migrations'), fragmentsDir: join(dir, 'schema'), listed: [] };
    expect(() => assertRawSqlIndexes(options)).toThrow(/UNLISTED_RAW_INDEX.*orders_open_uniq_idx/s);
    const listed: PackageRawSqlIndex[] = [
      {
        name: 'orders_open_uniq_idx',
        table: 'orders',
        unique: true,
        definition: 'CREATE UNIQUE INDEX orders_open_uniq_idx ON public.orders USING btree (ref) WHERE open',
        reason: 'one open order per ref',
        doc: 'docs/specs/x.md',
        createdIn: '0001_x',
      },
    ];
    // Listed, but the fragment now declares a full @unique on the same key: still tripped.
    expect(() => assertRawSqlIndexes({ ...options, listed })).toThrow(/FRAGMENT_DECLARES_RAW_INDEX/);
    writeFileSync(join(dir, 'schema', 'orders.prisma'), 'model Order {\n  ref String\n  @@map("orders")\n}\n');
    expect(() => assertRawSqlIndexes({ ...options, listed })).not.toThrow();
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertAppSchemaObjects,
  checkAppSchemaObjects,
  normaliseSqlExpression,
  parseLock,
  readAppMigrations,
  scanRlsPolicies,
  sqlExpressionSha256,
  type AppSchemaObjectsInput,
} from '../../src/index.js';

const SQL_CREATE = `
CREATE TABLE "coach_notes" ("id" UUID PRIMARY KEY, "org_id" UUID NOT NULL, "title" TEXT);
CREATE UNIQUE INDEX "coach_notes_active_title_uniq_idx" ON "coach_notes"("org_id", "title") WHERE ("title" IS NOT NULL);
ALTER TABLE "coach_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coach_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "coach_notes_org_isolation" ON "coach_notes"
  USING ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid);
`;

const INDEX_DEFINITION =
  'CREATE UNIQUE INDEX coach_notes_active_title_uniq_idx ON public.coach_notes USING btree (org_id, title) WHERE (title IS NOT NULL)';

const USING_HASH = sqlExpressionSha256(
  `"org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid OR current_setting('app.rls_bypass', true) = 'on'`,
);
const CHECK_HASH = sqlExpressionSha256(`"org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid`);

function input(overrides: Partial<AppSchemaObjectsInput> = {}): AppSchemaObjectsInput {
  return {
    lock: {
      rawSqlIndexes: [{ name: 'coach_notes_active_title_uniq_idx', definition: INDEX_DEFINITION }],
      rlsPolicies: [{ name: 'coach_notes_org_isolation', table: 'coach_notes', usingSha256: USING_HASH, checkSha256: CHECK_HASH }],
    },
    migrations: [['20270101000000_add_coach_notes', SQL_CREATE]],
    packageIndexes: [],
    packagePolicies: [],
    ...overrides,
  };
}

const codes = (value: AppSchemaObjectsInput): string[] => checkAppSchemaObjects(value).map((p) => p.code);

describe('normaliseSqlExpression', () => {
  it('collapses whitespace, folds case outside quotes and keeps literals byte for byte', () => {
    expect(normaliseSqlExpression(`  "Org_Id"  =  ( Current_Setting( 'App.Org' ,  true ) )\n AND\tX `)).toBe(`"Org_Id" = (current_setting('App.Org',true)) and x`);
  });

  it('keeps different expressions different', () => {
    expect(sqlExpressionSha256('a AND b')).not.toBe(sqlExpressionSha256('b AND a'));
    expect(sqlExpressionSha256('A   AND  b')).toBe(sqlExpressionSha256('a and b'));
  });
});

describe('scanRlsPolicies expressions', () => {
  it('reads USING and WITH CHECK, and follows ALTER POLICY and a rename', () => {
    const found = scanRlsPolicies([
      ['0001', 'CREATE POLICY p ON t FOR ALL TO public USING (a = 1) WITH CHECK (b = 2);'],
      ['0002', 'ALTER POLICY p ON t USING (a = 3);'],
      ['0003', 'ALTER POLICY p ON t RENAME TO q;'],
    ]);
    expect(found.policies).toEqual([{ name: 'q', table: 't', createdIn: '0001', using: 'a = 3', check: 'b = 2' }]);
  });

  it('leaves the expressions of a policy without them undefined and survives nested parentheses', () => {
    const found = scanRlsPolicies([['0001', 'CREATE POLICY p ON t USING ((a = 1) OR (b IN (SELECT 1)));']]);
    expect(found.policies[0]).toMatchObject({ using: '(a = 1) or (b in (select 1))' });
    expect(found.policies[0]!.check).toBeUndefined();
  });
});

describe('checkAppSchemaObjects', () => {
  it('passes when the lock and the migrations agree', () => {
    expect(codes(input())).toEqual([]);
  });

  it('accepts an optional hash being absent', () => {
    expect(codes(input({ lock: { ...input().lock, rlsPolicies: [{ name: 'coach_notes_org_isolation', table: 'coach_notes' }] } }))).toEqual([]);
  });

  it('fails a listed index no migration creates', () => {
    expect(codes(input({ migrations: [['20270101000000_x', 'SELECT 1;']] }))).toContain('APP_INDEX_NOT_FOUND');
  });

  it('fails a listed index a later migration drops, and a listed policy a later migration drops', () => {
    const migrations: AppSchemaObjectsInput['migrations'] = [
      ['20270101000000_add', SQL_CREATE],
      ['20270102000000_drop', 'DROP INDEX "coach_notes_active_title_uniq_idx"; DROP POLICY "coach_notes_org_isolation" ON "coach_notes";'],
    ];
    expect(codes(input({ migrations }))).toEqual(expect.arrayContaining(['APP_INDEX_NOT_FOUND', 'APP_POLICY_NOT_FOUND']));
  });

  it('fails a listed index whose definition disagrees with the migrations', () => {
    const lock = {
      ...input().lock,
      rawSqlIndexes: [{ name: 'coach_notes_active_title_uniq_idx', definition: INDEX_DEFINITION.replace('UNIQUE ', '').replace('(org_id, title)', '(title)') }],
    };
    const [problem] = checkAppSchemaObjects(input({ lock }));
    expect(problem).toMatchObject({ code: 'APP_INDEX_MISMATCH' });
    expect(problem!.message).toMatch(/unique=true \(lock false\).*key \(org_id, title\)/);
  });

  it('fails a listed policy whose expression changed after it was locked', () => {
    const migrations: AppSchemaObjectsInput['migrations'] = [
      ['20270101000000_add', SQL_CREATE],
      ['20270102000000_weaken', 'ALTER POLICY "coach_notes_org_isolation" ON "coach_notes" USING (true);'],
    ];
    const problems = checkAppSchemaObjects(input({ migrations }));
    expect(problems.map((p) => p.code)).toEqual(['APP_POLICY_EXPRESSION_MISMATCH']);
    expect(problems[0]!.message).toMatch(/USING/);
  });

  it('fails a listed policy whose table does not enable and force row-level security', () => {
    const migrations: AppSchemaObjectsInput['migrations'] = [
      ['20270101000000_add', SQL_CREATE.replace('ALTER TABLE "coach_notes" FORCE ROW LEVEL SECURITY;', '')],
    ];
    expect(codes(input({ migrations }))).toEqual(['APP_POLICY_TABLE_NOT_FORCED']);
    const none: AppSchemaObjectsInput['migrations'] = [['20270101000000_add', SQL_CREATE.replace(/ALTER TABLE[^;]*;/g, '')]];
    expect(codes(input({ migrations: none }))).toEqual(['APP_POLICY_TABLE_NOT_ENABLED', 'APP_POLICY_TABLE_NOT_FORCED']);
  });

  it('fails an unlisted raw-SQL index and an unlisted policy, but not a plain unlisted index', () => {
    const migrations: AppSchemaObjectsInput['migrations'] = [
      ['20270101000000_add', `${SQL_CREATE}\nCREATE INDEX "plain_idx" ON "coach_notes"("title");`],
    ];
    expect(codes(input({ lock: {}, migrations }))).toEqual(['UNLISTED_APP_RAW_INDEX', 'UNLISTED_APP_POLICY']);
  });

  it('leaves the package entries alone: they are neither required nor reported', () => {
    const migrations: AppSchemaObjectsInput['migrations'] = [['0001_platform', SQL_CREATE]];
    expect(
      codes({
        lock: {},
        migrations,
        packageIndexes: [{ name: 'coach_notes_active_title_uniq_idx' }],
        packagePolicies: [{ name: 'coach_notes_org_isolation', table: 'coach_notes' }],
      }),
    ).toEqual([]);
  });

  const REFERENCE_APP = join(__dirname, '..', '..', '..', '..', 'apps', 'api');

  it.skipIf(!existsSync(join(REFERENCE_APP, 'prisma', 'platform.lock')))(
    'reports nothing for the shipped package lists over the reference app history (the platform entries are unchanged)',
    () => {
      const lock = parseLock(readFileSync(join(REFERENCE_APP, 'prisma', 'platform.lock'), 'utf8'));
      const migrations = readAppMigrations(join(REFERENCE_APP, 'prisma', 'migrations'));
      expect(migrations.length).toBeGreaterThan(30);
      expect(checkAppSchemaObjects({ lock, migrations })).toEqual([]);
    },
  );
});

describe('assertAppSchemaObjects and readAppMigrations', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the directories in order, skips a directory without migration.sql and throws a readable list', () => {
    dir = mkdtempSync(join(tmpdir(), 'app-objects-'));
    for (const name of ['20270102000000_b', '20270101000000_a', '20270103000000_empty']) mkdirSync(join(dir, name));
    writeFileSync(join(dir, '20270101000000_a', 'migration.sql'), SQL_CREATE);
    writeFileSync(join(dir, '20270102000000_b', 'migration.sql'), 'SELECT 1;');
    writeFileSync(join(dir, 'migration_lock.toml'), 'provider = "postgresql"');
    expect(readAppMigrations(dir).map(([name]) => name)).toEqual(['20270101000000_a', '20270102000000_b']);
    expect(() => assertAppSchemaObjects({ lock: {}, migrationsDir: dir, packageIndexes: [], packagePolicies: [] })).toThrow(
      /app schema-object check failed \(2\).*UNLISTED_APP_RAW_INDEX.*UNLISTED_APP_POLICY/s,
    );
    expect(() =>
      assertAppSchemaObjects({
        lock: parseLock(
          JSON.stringify({
            lockVersion: 1,
            platformVersion: '1.0.0',
            migrations: [],
            rawSqlIndexes: input().lock.rawSqlIndexes,
            rlsPolicies: input().lock.rlsPolicies,
          }),
        ),
        migrationsDir: dir,
        packageIndexes: [],
        packagePolicies: [],
      }),
    ).not.toThrow();
  });
});

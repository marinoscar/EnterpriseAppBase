// =============================================================================
// An app table with relations to platform models, an app raw-SQL index and an
// app RLS policy, all checked offline (PP-14.27)
// =============================================================================
//
// `coach-notes.prisma` + `coach-notes.migration.sql` are an app's own table
// beside the platform's. This spec proves, without a database and without
// editing a package:
//
//   1. the fragment composes against the REAL platform fragments: its
//      `extend model` blocks reach `Notification`, `Grant` and `Organization`
//      (the extensible models), and the same block on `Permission` is refused;
//   2. the lock entries the app wrote for its index and policy agree with its
//      migration SQL (`checkAppSchemaObjects`), the platform's own entries are
//      left alone, and each way of drifting is named;
//   3. the app migration does not collide with the installed platform history.
//
// `app-extension.db.spec.ts` runs the same migration against Postgres and
// asserts the lock's index definition against `pg_indexes`.
// =============================================================================

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkAppMigrations, checkAppSchemaObjects, composeSchema, ComposeError, parseManifest } from '@marinoscar/platform-db';

import {
  APP_PRISMA,
  COACH_NOTES_DIR,
  COACH_NOTES_FRAGMENT,
  COACH_NOTES_POLICY_HASH,
  COACH_NOTES_SQL,
  historyWithCoachNotes,
  lockWithCoachNotes,
} from './coach-fixture';

const PLATFORM_DB = join(require.resolve('@marinoscar/platform-db/package.json'), '..');

describe('an app fragment with relations to platform models', () => {
  let fragments = '';
  beforeEach(() => {
    fragments = mkdtempSync(join(tmpdir(), 'coach-fragments-'));
  });
  afterEach(() => rmSync(fragments, { recursive: true, force: true }));

  const compose = () => composeSchema({ appFragmentsDir: fragments, outDir: join(fragments, 'out') });
  const text = (result: ReturnType<typeof compose>, name: string): string => result.files.find((f) => f.path.endsWith(name))!.contents;

  it('composes: the back-relations land on Notification, Grant and Organization', () => {
    writeFileSync(join(fragments, 'coach.prisma'), COACH_NOTES_FRAGMENT);
    const result = compose();
    expect(result.warnings).toEqual([]);
    expect(text(result, 'platform.notifications.prisma')).toMatch(/composed from app:coach\.prisma\n {2}coachNotes CoachNote\[\]/);
    expect(text(result, 'platform.sharing.prisma')).toMatch(/composed from app:coach\.prisma\n {2}coachNotes CoachNote\[\]/);
    expect(text(result, 'platform.identity.prisma')).toMatch(/composed from app:coach\.prisma\n {2}coachNotes CoachNote\[\]/);
    expect(text(result, 'app.coach.prisma')).toContain('model CoachNote');
  });

  it('refuses the same block on Permission, which stays closed', () => {
    writeFileSync(join(fragments, 'coach.prisma'), COACH_NOTES_FRAGMENT);
    writeFileSync(join(fragments, 'closed.prisma'), 'extend model Permission {\n  coachNotes CoachNote[]\n}\n');
    expect(compose).toThrow(ComposeError);
    expect(compose).toThrow(/NOT_EXTENSIBLE.*Permission/);
  });
});

describe('the example index and policy against platform.lock', () => {
  const check = (overrides: { lock?: ReturnType<typeof lockWithCoachNotes>; migrations?: Array<[string, string]> } = {}) =>
    checkAppSchemaObjects({ lock: overrides.lock ?? lockWithCoachNotes(), migrations: overrides.migrations ?? historyWithCoachNotes() });

  it('agrees, with the platform entries unchanged', () => {
    expect(check()).toEqual([]);
  });

  it('names an index or policy the app forgot to list', () => {
    const lock = lockWithCoachNotes();
    const problems = check({ lock: { ...lock, rawSqlIndexes: lock.rawSqlIndexes!.slice(0, -1), rlsPolicies: lock.rlsPolicies!.slice(0, -1) } });
    expect(problems.map((p) => p.code)).toEqual(['UNLISTED_APP_RAW_INDEX', 'UNLISTED_APP_POLICY']);
  });

  it('names a listed entry the migrations never create', () => {
    const history = historyWithCoachNotes().filter(([dir]) => dir !== COACH_NOTES_DIR);
    expect(check({ migrations: history }).map((p) => p.code)).toEqual(['APP_INDEX_NOT_FOUND', 'APP_POLICY_NOT_FOUND']);
  });

  it('catches a policy weakened by a later migration, offline', () => {
    const weakened: Array<[string, string]> = [
      ...historyWithCoachNotes(),
      ['20270102000000_open_coach_notes', 'ALTER POLICY "coach_notes_org_isolation" ON "coach_notes" USING (true);'],
    ];
    const problems = check({ migrations: weakened });
    expect(problems.map((p) => p.code)).toEqual(['APP_POLICY_EXPRESSION_MISMATCH']);
    expect(problems[0]!.message).toContain(COACH_NOTES_POLICY_HASH.slice(0, 12));
  });

  it('catches a table that lost FORCE ROW LEVEL SECURITY', () => {
    const history: Array<[string, string]> = historyWithCoachNotes().map(([dir, sql]) => [dir, dir === COACH_NOTES_DIR ? sql.replace('ALTER TABLE "coach_notes" FORCE ROW LEVEL SECURITY;', '') : sql]);
    expect(check({ migrations: history }).map((p) => p.code)).toEqual(['APP_POLICY_TABLE_NOT_FORCED']);
  });

  it('does not collide with the installed platform history', () => {
    const manifest = parseManifest(readFileSync(join(PLATFORM_DB, 'migrations', 'manifest.json'), 'utf8'));
    const dirs = [...readdirSync(join(APP_PRISMA, 'migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name), COACH_NOTES_DIR];
    expect(checkAppMigrations(manifest, lockWithCoachNotes(), dirs)).toEqual([]);
    // an app migration named like a platform migration, or dated before the last installed one, does
    expect(checkAppMigrations(manifest, lockWithCoachNotes(), [...dirs, '0036_add_app_metadata']).map((p) => p.code)).toEqual(['APP_MIGRATION_ID_COLLISION']);
    expect(checkAppMigrations(manifest, lockWithCoachNotes(), [...dirs, '20261001000000_stale']).map((p) => p.code)).toEqual(['APP_MIGRATION_OUT_OF_ORDER']);
  });

  it('keeps the example SQL honest about its own text', () => {
    expect(COACH_NOTES_SQL).toContain('FORCE ROW LEVEL SECURITY');
  });
});

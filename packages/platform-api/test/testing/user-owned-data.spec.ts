import { join } from 'node:path';

import type { UserOwnedModelDef } from '../../src/core';
import { runPlatformConformance, userOwnedDataSuite, type DatamodelField, type DatamodelModel, type UserOwnedDataOptions } from '../../src/testing';
import {
  blankCommentsAndStrings,
  checkRawSqlAllowlist,
  checkUserOwnedModels,
  rawSqlUses,
} from '../../src/testing/suites/user-owned-data';
import { emptySourceRoot, outcome, recordingTestApi, removeSourceRoots, writeSource } from '../support/conformance-harness';

/** Every recorded test with the error it threw (null when it passed). */
async function runAll(tests: ReturnType<typeof recordingTestApi>['tests']): Promise<Array<{ name: string; error: Error | null }>> {
  const results: Array<{ name: string; error: Error | null }> = [];
  for (const test of tests) results.push({ name: test.name, error: await outcome(test) });
  return results;
}

afterAll(removeSourceRoots);

// =============================================================================
// The user-owned-data suite (#688's two tripwires, moved by #699)
// =============================================================================

// -----------------------------------------------------------------------------
// The registry checker, against synthetic datamodels: each rule fires
// -----------------------------------------------------------------------------

const id: DatamodelField = { name: 'id', type: 'String', isList: false, isOptional: false };
const scalar = (name: string, isOptional = false): DatamodelField => ({ name, type: 'String', isList: false, isOptional });
const userRelation = (name: string, fk: string, onDelete?: string, isOptional = false): DatamodelField => ({
  name,
  type: 'User',
  isList: false,
  isOptional,
  relation: { fields: [fk], references: ['id'], ...(onDelete ? { onDelete } : {}) },
});

const user: DatamodelModel = { name: 'User', fields: [id] };
const note: DatamodelModel = {
  name: 'Note',
  fields: [id, scalar('userId'), scalar('body'), userRelation('user', 'userId', 'Cascade')],
};
const log: DatamodelModel = {
  name: 'Log',
  fields: [id, scalar('actorId', true), scalar('reviewerId', true), userRelation('actor', 'actorId', 'SetNull', true), userRelation('reviewer', 'reviewerId', undefined, true)],
};

const noteDef = { model: 'Note', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'x' } as UserOwnedModelDef;
const logDef = { model: 'Log', actorFields: ['actorId', 'reviewerId'], purge: 'detach', export: 'exclude', rationale: 'x' } as UserOwnedModelDef;
const def = (overrides: Record<string, unknown>, base = noteDef) => ({ ...base, ...overrides }) as unknown as UserOwnedModelDef;

describe('checkUserOwnedModels', () => {
  const datamodel = [user, note, log];

  it('passes a consistent registry (including Prisma default onDelete for an optional relation)', () => {
    expect(checkUserOwnedModels(datamodel, [noteDef, logDef])).toEqual([]);
  });

  it('fails when a model with a User relation is not registered, naming the fix', () => {
    const problems = checkUserOwnedModels(datamodel, [logDef], { registerIn: 'src/app-registrations/user-owned-models.ts' });
    expect(problems).toEqual([
      'Note.userId is a foreign key to User with no registry entry. Register Note.userId in src/app-registrations/user-owned-models.ts, with a purge and export policy.',
    ]);
    expect(checkUserOwnedModels(datamodel, [logDef])[0]).toContain('Register Note.userId in the user-owned data registry');
  });

  it('fails when a registered model gains a second User relation', () => {
    const grown: DatamodelModel = {
      ...note,
      fields: [...note.fields, scalar('editorId', true), userRelation('editor', 'editorId', 'SetNull', true)],
    };
    expect(checkUserOwnedModels([user, grown, log], [noteDef, logDef])).toEqual([
      expect.stringContaining('Note.editorId is a foreign key to User with no registry entry'),
    ]);
  });

  it('fails when a registered model does not exist', () => {
    expect(checkUserOwnedModels(datamodel, [noteDef, logDef, def({ model: 'Ghost' })])).toEqual([
      'Ghost is registered but schema.prisma has no such model. Remove or rename the entry.',
    ]);
  });

  it('fails when a registered field does not exist', () => {
    const problems = checkUserOwnedModels(datamodel, [noteDef, def({ actorFields: ['actorId', 'reviewerId', 'gone'] }, logDef)]);
    expect(problems).toEqual(['Log.gone is registered as the actor field but schema.prisma has no such column.']);
  });

  it('fails when a registered field is not a foreign key to User', () => {
    const problems = checkUserOwnedModels(datamodel, [def({ ownerField: 'body' }), logDef]);
    expect(problems).toEqual(
      expect.arrayContaining([
        'Note.body is registered as the owner field but is not a foreign key to User.',
        expect.stringContaining('Note.userId is a foreign key to User with no registry entry'),
      ]),
    );
  });

  it("fails when purge 'detach' contradicts onDelete Cascade, naming model, field and both values", () => {
    expect(checkUserOwnedModels(datamodel, [def({ purge: 'detach' }), logDef])).toEqual([
      "Note.userId: purge 'detach' requires onDelete SetNull, but schema.prisma has Cascade (relation user).",
    ]);
  });

  it("fails when purge 'delete' contradicts onDelete SetNull on an actor field", () => {
    expect(checkUserOwnedModels(datamodel, [noteDef, def({ purge: 'delete' }, logDef)])).toEqual([
      "Log.actorId: purge 'delete' requires onDelete Cascade, but schema.prisma has SetNull (relation actor).",
      "Log.reviewerId: purge 'delete' requires onDelete Cascade, but schema.prisma has SetNull (relation reviewer).",
    ]);
  });

  it("fails when purge 'retain' meets a relation that cascades or nulls", () => {
    expect(checkUserOwnedModels(datamodel, [noteDef, def({ purge: 'retain' }, logDef)])).toHaveLength(2);
  });

  it('treats a required relation without onDelete as Restrict', () => {
    const strict: DatamodelModel = { ...note, fields: [id, scalar('userId'), userRelation('user', 'userId')] };
    expect(checkUserOwnedModels([user, strict, log], [noteDef, logDef])).toEqual([
      "Note.userId: purge 'delete' requires onDelete Cascade, but schema.prisma has Restrict (relation user).",
    ]);
  });

  it('fails when the owner relation is not where ownerRelation (or its default) points', () => {
    const renamed: DatamodelModel = { ...note, fields: [id, scalar('userId'), userRelation('owner', 'userId', 'Cascade')] };
    expect(checkUserOwnedModels([user, renamed, log], [noteDef, logDef])).toEqual([
      'Note.userId: the owner relation field is "owner", not "user". Set ownerRelation: \'owner\'.',
    ]);
    expect(checkUserOwnedModels([user, renamed, log], [def({ ownerRelation: 'owner' }), logDef])).toEqual([]);
  });

  it('fails when an actor field on an owned model cascades', () => {
    const mixed: DatamodelModel = {
      ...note,
      fields: [...note.fields, scalar('editorId'), userRelation('editor', 'editorId', 'Cascade')],
    };
    expect(checkUserOwnedModels([user, mixed, log], [def({ actorFields: ['editorId'] }), logDef])).toEqual([
      'Note.editorId: an actor field on an owned model cannot be onDelete Cascade: deleting the actor would delete a row another user owns.',
    ]);
  });

  it('fails when exportOmit names a missing column', () => {
    expect(checkUserOwnedModels(datamodel, [def({ exportOmit: ['body', 'secret'] }), logDef])).toEqual([
      'Note.exportOmit names "secret", which schema.prisma does not have.',
    ]);
  });

  it('tracks another owner model when told to', () => {
    const account: DatamodelModel = { name: 'Account', fields: [id] };
    const item: DatamodelModel = {
      name: 'Item',
      fields: [id, scalar('accountId'), { ...userRelation('account', 'accountId', 'Cascade'), type: 'Account' }],
    };
    expect(checkUserOwnedModels([account, item], [], { userModel: 'Account' })).toEqual([
      expect.stringContaining('Item.accountId is a foreign key to Account with no registry entry'),
    ]);
  });
});

// -----------------------------------------------------------------------------
// Raw-SQL detection and the allowlist checker
// -----------------------------------------------------------------------------

describe('raw SQL detection', () => {
  it.each([
    ['a tagged template', 'await this.prisma.$queryRaw`SELECT 1`;', ['$queryRaw']],
    ['a typed call', 'prisma.$queryRaw<Row[]>(Prisma.sql`SELECT 1`)', ['$queryRaw']],
    ['the unsafe variants', 'db.$executeRawUnsafe(sql); db.$queryRawUnsafe(sql);', ['$executeRawUnsafe', '$queryRawUnsafe']],
    ['an executeRaw', 'tx.$executeRaw`UPDATE t SET x = 1`', ['$executeRaw']],
  ])('finds %s', (_label, source, uses) => {
    expect(rawSqlUses(source)).toEqual(uses);
  });

  it.each([
    ['a line comment', '// uses $queryRaw here'],
    ['a block comment', '/* $executeRaw\n is not used */ const x = 1;'],
    ['a doc comment', '/**\n * `$queryRaw<{ v: string }[]>` or a pg client\n */'],
    ['a string literal', "type C = Pick<PrismaService, '$queryRaw'>;"],
    ['a double-quoted string', 'const s = "$executeRawUnsafe";'],
    ['a longer identifier', 'const $queryRawish = 1;'],
  ])('ignores %s', (_label, source) => {
    expect(rawSqlUses(source)).toEqual([]);
  });

  it('does not treat a quote inside a template literal as a string', () => {
    expect(rawSqlUses("const m = `it's`; await db.$queryRaw`SELECT 1`;")).toEqual(['$queryRaw']);
  });

  it('keeps line breaks, so a block comment does not swallow code after it', () => {
    expect(blankCommentsAndStrings('/* a\nb */x')).toBe('    \n    x');
  });
});

describe('checkRawSqlAllowlist', () => {
  const found = new Map([['jobs/claim.ts', ['$queryRaw']]]);
  const allowlist = [{ file: 'jobs/claim.ts', why: 'FOR UPDATE SKIP LOCKED.' }];

  it('passes when every raw file is listed with a reason', () => {
    expect(checkRawSqlAllowlist(found, allowlist)).toEqual([]);
  });

  it('fails for a new unlisted raw call', () => {
    expect(checkRawSqlAllowlist(new Map([...found, ['users/users.service.ts', ['$queryRawUnsafe']]]), allowlist)).toEqual([
      {
        file: 'users/users.service.ts',
        message:
          'uses $queryRawUnsafe: add it to the raw-SQL allowlist with a reason, and make sure it never runs with request-derived ids unscoped.',
      },
    ]);
  });

  it('fails for a stale (or missing) allowlist entry', () => {
    expect(checkRawSqlAllowlist(found, [...allowlist, { file: 'users/users.service.ts', why: 'Was raw once.' }])).toEqual([
      {
        file: 'users/users.service.ts',
        message: 'is in the raw-SQL allowlist but no longer uses raw SQL (or no longer exists): remove the entry.',
      },
    ]);
  });

  it('fails for an entry without a reason', () => {
    expect(checkRawSqlAllowlist(found, [{ file: 'jobs/claim.ts', why: ' ' }])).toEqual([
      { file: 'jobs/claim.ts', message: 'the raw-SQL allowlist entry needs a reason.' },
    ]);
  });
});

// -----------------------------------------------------------------------------
// check() and the generated tests, on a fixture schema and fixture sources
// -----------------------------------------------------------------------------

const FIXTURE_SCHEMA = `
model User {
  id    String @id
  notes Note[]
  logs  Log[]  @relation("actor")
}

model Note {
  id     String @id
  userId String
  body   String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Log {
  id      String  @id
  actorId String?
  actor   User?   @relation("actor", fields: [actorId], references: [id], onDelete: SetNull)
}
`;

const FIXTURE_POLICIES: readonly UserOwnedModelDef[] = [
  { model: 'Note', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'The user’s own notes.' },
  { model: 'Log', actorFields: ['actorId'], purge: 'detach', export: 'exclude', rationale: 'Who acted, not who owns.' },
];

/** A fixture app: a schema folder and a source root with one allowlisted raw file. */
function fixtureApp(): { schemaPath: string; root: string; options: UserOwnedDataOptions } {
  const app = emptySourceRoot();
  writeSource(app, 'prisma/schema/app.prisma', FIXTURE_SCHEMA);
  writeSource(app, 'src/notes/notes.service.ts', 'export class NotesService { list() { return this.db.note.findMany(); } }\n');
  writeSource(app, 'src/health/probe.ts', 'export const probe = (db: any) => db.$queryRaw`SELECT 1`;\n');
  writeSource(app, 'src/health/probe.spec.ts', 'db.$executeRawUnsafe("TRUNCATE x");\n');
  const schemaPath = join(app, 'prisma', 'schema');
  return {
    schemaPath,
    root: join(app, 'src'),
    options: {
      schemaPath,
      policies: FIXTURE_POLICIES,
      rawSqlAllowlist: [{ file: 'health/probe.ts', why: 'Health probe: SELECT 1.' }],
      registerIn: 'src/app-registrations/user-owned-models.ts',
    },
  };
}

describe('user-owned-data suite: check()', () => {
  it('passes a conforming fixture app, and counts what it saw (spec files skipped)', () => {
    const { root, options } = fixtureApp();
    expect(userOwnedDataSuite.check({ sourceRoots: [root] }, options)).toEqual({
      scanned: { models: 3, userForeignKeyModels: 2, sourceFiles: 2, rawSqlFiles: 1 },
      scannedFiles: { rawSqlFiles: ['health/probe.ts'] },
      findings: [],
    });
  });

  it('fails when an owner-column model has no policy, with the schema as the file', () => {
    const { root, options } = fixtureApp();
    const report = userOwnedDataSuite.check({ sourceRoots: [root] }, { ...options, policies: [FIXTURE_POLICIES[1]!] });
    expect(report.findings).toEqual([
      {
        file: 'schema',
        message:
          'Note.userId is a foreign key to User with no registry entry. Register Note.userId in src/app-registrations/user-owned-models.ts, with a purge and export policy.',
      },
    ]);
  });

  it('fails for unscoped raw SQL outside the allowlist, and for a stale entry', () => {
    const { root, options } = fixtureApp();
    writeSource(root, 'notes/raw.ts', 'db.$executeRaw`DELETE FROM notes`;\n');
    const report = userOwnedDataSuite.check(
      { sourceRoots: [root] },
      { ...options, rawSqlAllowlist: [...options.rawSqlAllowlist, { file: 'gone.ts', why: 'Removed.' }] },
    );
    expect(report.findings.map((finding) => finding.file)).toEqual(['notes/raw.ts', 'gone.ts']);
  });

  it('throws on an unreadable schema or source root, and on no source roots', () => {
    const { root, options } = fixtureApp();
    expect(() => userOwnedDataSuite.check({ sourceRoots: [root] }, { ...options, schemaPath: join(root, 'nope') })).toThrow(
      /cannot read the schema at/,
    );
    expect(() => userOwnedDataSuite.check({ sourceRoots: [join(root, 'nope')] }, options)).toThrow(/cannot read source root/);
    expect(() => userOwnedDataSuite.check({ sourceRoots: [] }, options)).toThrow(/sourceRoots is empty/);
  });
});

describe('user-owned-data suite through runPlatformConformance', () => {
  it('registers three tests, all passing on a conforming app', async () => {
    const { root, options } = fixtureApp();
    const recorder = recordingTestApi();
    runPlatformConformance({ sourceRoots: [root], suites: { userOwnedData: options }, testApi: recorder.api });
    const results = await runAll(recorder.tests);
    expect(results.map((result) => [result.name, result.error])).toEqual([
      ['user-owned data is registered and raw SQL is allowlisted > reads the schema and the sources at all, so a broken scan cannot pass vacuously', null],
      ['user-owned data is registered and raw SQL is allowlisted > registers every User foreign key, with purge policies that match onDelete', null],
      ['user-owned data is registered and raw SQL is allowlisted > issues raw SQL only from allowlisted files, each with a reason', null],
    ]);
  });

  it('fails the registry test, and only it, when a model gains an unregistered owner column', async () => {
    const { schemaPath, root, options } = fixtureApp();
    writeSource(
      join(schemaPath, '..', '..'),
      'prisma/schema/zz-new.prisma',
      'model Draft {\n  id String @id\n  userId String\n  user User @relation(fields: [userId], references: [id], onDelete: Cascade)\n}\n',
    );
    const recorder = recordingTestApi();
    runPlatformConformance({ sourceRoots: [root], suites: { userOwnedData: options }, testApi: recorder.api });
    const failed = (await runAll(recorder.tests)).filter((result) => result.error !== null);
    expect(failed.map((result) => result.name)).toEqual([
      'user-owned data is registered and raw SQL is allowlisted > registers every User foreign key, with purge policies that match onDelete',
    ]);
    expect(String(failed[0]!.error)).toContain('Draft.userId is a foreign key to User with no registry entry');
  });
});

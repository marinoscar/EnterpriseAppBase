import { describe, expect, it } from 'vitest';

import { GENERATED_HEADER, composeFragments, type FragmentInput } from '../../src/compose/compose.js';
import { ComposeError, type ComposeErrorCode } from '../../src/compose/errors.js';

const pkg = (name: string, text: string): FragmentInput => ({ origin: 'package', name, text });
const app = (name: string, text: string): FragmentInput => ({ origin: 'app', name, text });

const BASE = 'generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n}\n';
const IDENTITY = `// Users.
// @extensible
model User {
  id String @id

  @@map("users")
}

model Locked {
  id String @id
}
`;
const WORKOUT = `model Workout {
  id     String @id
  userId String
  user   User   @relation(fields: [userId], references: [id])
}
`;

function rejection(inputs: FragmentInput[]): ComposeError {
  try {
    composeFragments(inputs);
  } catch (e) {
    if (e instanceof ComposeError) return e;
    throw e;
  }
  throw new Error('expected the composition to be rejected');
}

describe('composeFragments: merge', () => {
  it('merges an extend block into its model before @@map, under a "composed from" comment, and drops the extend block', () => {
    const { files, extensions } = composeFragments([
      pkg('base.prisma', BASE),
      pkg('identity.prisma', IDENTITY),
      app('workouts.prisma', `${WORKOUT}\nextend model User {\n  // my workouts\n  workouts Workout[]\n}\n`),
    ]);
    expect(files.get('platform.identity.prisma')).toBe(`${GENERATED_HEADER}
// source: package:identity.prisma

// Users.
// @extensible
model User {
  id String @id

  // composed from app:workouts.prisma
  // my workouts
  workouts Workout[]

  @@map("users")
}

model Locked {
  id String @id
}
`);
    expect(files.get('app.workouts.prisma')).toBe(`${GENERATED_HEADER}\n// source: app:workouts.prisma\n\n${WORKOUT}`);
    expect(extensions).toEqual([{ model: 'User', field: 'workouts', from: 'app:workouts.prisma' }]);
  });

  it('appends at the end of a model that has no block attribute', () => {
    const { files } = composeFragments([
      pkg('a.prisma', '// @extensible\nmodel Job {\n  id String @id\n}\n'),
      app('x.prisma', 'model X {\n  id String @id\n  jobId String\n  job Job @relation(fields: [jobId], references: [id])\n}\n\nextend model Job {\n  x X[]\n}\n'),
    ]);
    expect(files.get('platform.a.prisma')).toContain('model Job {\n  id String @id\n\n  // composed from app:x.prisma\n  x X[]\n}\n');
  });

  it('keeps the comment run directly above an extend block with it', () => {
    const { files } = composeFragments([
      pkg('identity.prisma', IDENTITY),
      app('w.prisma', `${WORKOUT}\n// Why: workouts belong to a user.\nextend model User {\n  workouts Workout[]\n}\n`),
    ]);
    expect(files.get('platform.identity.prisma')).toContain('  // composed from app:w.prisma\n  // Why: workouts belong to a user.\n  workouts Workout[]\n');
  });

  it('merges extends of several sources in load order (package before app, each alphabetical)', () => {
    const extend = (field: string, type: string): string => `extend model User {\n  ${field} ${type}[]\n}\n`;
    const fk = (n: string): string => `model ${n} {\n  id String @id\n  userId String\n  user User @relation(fields: [userId], references: [id])\n}\n`;
    const { files, extensions } = composeFragments([
      app('b.prisma', `${fk('B')}\n${extend('bs', 'B')}`),
      pkg('zeta.prisma', `${fk('Z')}\n${extend('zs', 'Z')}`),
      app('a.prisma', `${fk('A')}\n${extend('as', 'A')}`),
      pkg('identity.prisma', IDENTITY),
      pkg('alpha.prisma', `${fk('P')}\n${extend('ps', 'P')}`),
    ]);
    expect(extensions.map((e) => e.from)).toEqual(['package:alpha.prisma', 'package:zeta.prisma', 'app:a.prisma', 'app:b.prisma']);
    const user = files.get('platform.identity.prisma') as string;
    const order = ['alpha.prisma', 'zeta.prisma', 'a.prisma', 'b.prisma'].map((f) => user.indexOf(`composed from ${f.startsWith('a.') || f.startsWith('b.') ? 'app' : 'package'}:${f}`));
    expect(order.every((n) => n > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('writes one file per declaring fragment and none for a fragment of pure extend blocks', () => {
    const { files } = composeFragments([
      pkg('identity.prisma', IDENTITY),
      pkg('ai.prisma', `${WORKOUT.replace('Workout', 'Thing')}\nextend model User {\n  things Thing[]\n}\n`),
      app('only-extends.prisma', 'extend model User {\n  things2 Thing[]\n}\n'),
    ]);
    expect([...files.keys()].sort()).toEqual(['platform.ai.prisma', 'platform.identity.prisma']);
  });

  it('is deterministic whatever order the inputs arrive in', () => {
    const inputs = [pkg('base.prisma', BASE), pkg('identity.prisma', IDENTITY), app('w.prisma', `${WORKOUT}\nextend model User {\n  workouts Workout[]\n}\n`)];
    const a = composeFragments(inputs);
    const b = composeFragments([...inputs].reverse());
    expect(b.files.size).toBe(a.files.size);
    for (const [name, text] of a.files) expect(b.files.get(name)).toBe(text);
  });

  it('lists the models the owners marked extensible', () => {
    expect(composeFragments([pkg('identity.prisma', IDENTITY)]).extensible).toEqual(['User']);
  });

  it('keeps CRLF input from leaking into the output', () => {
    const { files } = composeFragments([pkg('identity.prisma', IDENTITY.replace(/\n/g, '\r\n'))]);
    expect(files.get('platform.identity.prisma')).not.toContain('\r');
  });
});

describe('composeFragments: base.prisma', () => {
  it('lets an app base.prisma replace the package one and warns about it', () => {
    const custom = 'generator client {\n  provider = "prisma-client-js"\n  output   = "../generated"\n}\n\ndatasource db {\n  provider = "postgresql"\n}\n';
    const { files, warnings } = composeFragments([pkg('base.prisma', BASE), app('base.prisma', custom)]);
    expect([...files.keys()]).toEqual(['app.base.prisma']);
    expect(files.get('app.base.prisma')).toContain('output   = "../generated"');
    expect(warnings).toEqual([expect.stringContaining("replaces the package's base.prisma")]);
  });

  it('warns when no fragment declares a datasource', () => {
    expect(composeFragments([pkg('identity.prisma', IDENTITY)]).warnings).toEqual([expect.stringContaining('no datasource')]);
  });
});

describe('composeFragments: rejections', () => {
  const cases: Array<{
    name: string;
    code: ComposeErrorCode;
    inputs: FragmentInput[];
    file: string;
    line: number;
    message: RegExp;
  }> = [
    {
      name: 'extend of a model its owner did not mark @extensible',
      code: 'NOT_EXTENSIBLE',
      inputs: [pkg('identity.prisma', IDENTITY), app('w.prisma', `${WORKOUT}\nextend model Locked {\n  workouts Workout[]\n}\n`)],
      file: 'app:w.prisma',
      line: 7,
      message: /Locked \(declared at package:identity\.prisma:9\) is not marked "\/\/ @extensible"/,
    },
    {
      name: 'extend of a model no fragment declares',
      code: 'UNKNOWN_MODEL',
      inputs: [pkg('identity.prisma', IDENTITY), app('w.prisma', `${WORKOUT}\nextend model Nobody {\n  workouts Workout[]\n}\n`)],
      file: 'app:w.prisma',
      line: 7,
      message: /no fragment declares a model named Nobody/,
    },
    {
      name: 'a field that already exists on the package model',
      code: 'FIELD_COLLISION',
      inputs: [pkg('identity.prisma', IDENTITY), app('w.prisma', `${WORKOUT}\nextend model User {\n  id Workout[]\n}\n`)],
      file: 'app:w.prisma',
      line: 8,
      message: /field "id" already exists on User \(declared at package:identity\.prisma:4\)/,
    },
    {
      name: 'a field added twice by two fragments',
      code: 'FIELD_COLLISION',
      inputs: [
        pkg('identity.prisma', IDENTITY),
        app('a.prisma', `${WORKOUT}\nextend model User {\n  workouts Workout[]\n}\n`),
        app('b.prisma', 'extend model User {\n  workouts Workout[]\n}\n'),
      ],
      file: 'app:b.prisma',
      line: 2,
      message: /field "workouts" already exists on User \(added at app:a\.prisma:8\)/,
    },
    {
      name: 'a scalar field in an extend block (it would add a column)',
      code: 'EXTEND_SCALAR_FIELD',
      inputs: [pkg('identity.prisma', IDENTITY), app('w.prisma', 'extend model User {\n  nickname String?\n}\n')],
      file: 'app:w.prisma',
      line: 2,
      message: /field "nickname" has type String; an extend block may only add back-relation fields/,
    },
    {
      name: 'an enum-typed field in an extend block',
      code: 'EXTEND_SCALAR_FIELD',
      inputs: [pkg('identity.prisma', IDENTITY), app('w.prisma', 'enum Tier {\n  A\n}\n\nextend model User {\n  tier Tier\n}\n')],
      file: 'app:w.prisma',
      line: 6,
      message: /field "tier" has type Tier/,
    },
    {
      name: 'an owning relation in an extend block (it would add a foreign key column)',
      code: 'EXTEND_OWNING_RELATION',
      inputs: [pkg('identity.prisma', IDENTITY), app('w.prisma', `${WORKOUT}\nextend model User {\n  best Workout? @relation(fields: [id], references: [id])\n}\n`)],
      file: 'app:w.prisma',
      line: 8,
      message: /owning side of a relation \(fields: \[\.\.\.\]\)/,
    },
    {
      name: 'a block attribute in an extend block',
      code: 'EXTEND_BLOCK_ATTRIBUTE',
      inputs: [pkg('identity.prisma', IDENTITY), app('w.prisma', `${WORKOUT}\nextend model User {\n  workouts Workout[]\n  @@index([id])\n}\n`)],
      file: 'app:w.prisma',
      line: 9,
      message: /may not carry block attributes \(@@index\(\[id\]\)\)/,
    },
    {
      name: 'a field whose type is no model',
      code: 'EXTEND_UNKNOWN_TYPE',
      inputs: [pkg('identity.prisma', IDENTITY), app('w.prisma', 'extend model User {\n  things Thing[]\n}\n')],
      file: 'app:w.prisma',
      line: 2,
      message: /type Thing, which no fragment declares as a model/,
    },
    {
      name: 'a model declared in two fragments',
      code: 'DUPLICATE_MODEL',
      inputs: [pkg('identity.prisma', IDENTITY), app('w.prisma', 'model User {\n  id String @id\n}\n')],
      file: 'app:w.prisma',
      line: 1,
      message: /model "User" is already declared at package:identity\.prisma:3 \(again at app:w\.prisma:1\); .*extend model User/,
    },
    {
      name: 'an enum declared in two fragments',
      code: 'DUPLICATE_MODEL',
      inputs: [pkg('a.prisma', 'enum E {\n  A\n}\n'), pkg('b.prisma', 'enum E {\n  B\n}\n')],
      file: 'package:b.prisma',
      line: 1,
      message: /enum "E" is already declared at package:a\.prisma:1/,
    },
    {
      name: 'a second generator of the same name',
      code: 'DUPLICATE_BASE',
      inputs: [pkg('base.prisma', BASE), app('gen.prisma', 'generator client {\n  provider = "prisma-client-js"\n}\n')],
      file: 'app:gen.prisma',
      line: 1,
      message: /generator "client" is already declared at package:base\.prisma:1; an app replaces .* base\.prisma/,
    },
    {
      name: 'a second datasource',
      code: 'DUPLICATE_BASE',
      inputs: [pkg('base.prisma', BASE), app('db.prisma', 'datasource other {\n  provider = "postgresql"\n}\n')],
      file: 'app:db.prisma',
      line: 1,
      message: /datasource "other" is already declared at package:base\.prisma:5/,
    },
    {
      name: 'an extend of something that is not a model',
      code: 'MALFORMED',
      inputs: [pkg('a.prisma', 'enum E {\n  A\n}\n'), app('w.prisma', 'extend enum E {\n  B\n}\n')],
      file: 'app:w.prisma',
      line: 1,
      message: /only "extend model" is supported/,
    },
    {
      name: 'a header that is not prisma format shaped',
      code: 'MALFORMED',
      inputs: [pkg('identity.prisma', 'model User\n{\n  id String @id\n}\n')],
      file: 'package:identity.prisma',
      line: 1,
      message: /"<kind> <Name> \{" on one line at column 0/,
    },
  ];

  it.each(cases)('$code: $name', ({ code, inputs, file, line, message }) => {
    const err = rejection(inputs);
    expect({ code: err.code, file: err.file, line: err.line }).toEqual({ code, file, line });
    expect(err.message).toBe(`${file}:${line}: ${code}: ${err.detail}`);
    expect(err.detail).toMatch(message);
  });

  it('names the real path of a file when the caller supplies one', () => {
    const err = rejection([
      pkg('identity.prisma', IDENTITY),
      { origin: 'app', name: 'w.prisma', path: '/repo/apps/api/prisma/fragments/w.prisma', text: 'extend model Nobody {\n  w W[]\n}\n' },
    ]);
    expect(err.message).toMatch(/^\/repo\/apps\/api\/prisma\/fragments\/w\.prisma:1: UNKNOWN_MODEL: /);
  });
});

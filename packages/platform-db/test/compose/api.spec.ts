import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ComposeError, checkComposedSchema, composeSchema, writeComposedSchema, type ComposeOptions } from '../../src/compose/index.js';

const BASE = 'generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n}\n';
const IDENTITY = '// @extensible\nmodel User {\n  id String @id\n\n  @@map("users")\n}\n';
const WORKOUT = 'model Workout {\n  id String @id\n  userId String\n  user User @relation(fields: [userId], references: [id])\n}\n\nextend model User {\n  workouts Workout[]\n}\n';

let dir: string;
let opts: ComposeOptions;

function put(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'platform-db-compose-'));
  put(join(dir, 'platform', 'base.prisma'), BASE);
  put(join(dir, 'platform', 'identity.prisma'), IDENTITY);
  put(join(dir, 'app', 'workouts.prisma'), WORKOUT);
  opts = { platformSchemaDir: join(dir, 'platform'), appFragmentsDir: join(dir, 'app'), outDir: join(dir, 'out') };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('composeSchema', () => {
  it('reads the fragment folders and writes nothing', () => {
    const { files, warnings } = composeSchema(opts);
    expect(files.map((f) => f.path)).toEqual([
      join(dir, 'out', 'platform.base.prisma'),
      join(dir, 'out', 'platform.identity.prisma'),
      join(dir, 'out', 'app.workouts.prisma'),
    ]);
    expect(warnings).toEqual([]);
    expect(() => readdirSync(join(dir, 'out'))).toThrow();
  });

  it('treats a missing app fragment folder as no fragments', () => {
    const { files } = composeSchema({ ...opts, appFragmentsDir: join(dir, 'nope') });
    expect(files.map((f) => f.path.split('/').pop())).toEqual(['platform.base.prisma', 'platform.identity.prisma']);
  });

  it('ignores files that are not *.prisma and subfolders', () => {
    put(join(dir, 'app', 'README.md'), '# notes');
    put(join(dir, 'app', 'nested', 'deep.prisma'), 'model Deep {\n}\n');
    expect(composeSchema(opts).files).toHaveLength(3);
  });

  it('names the real path of a bad fragment in the error', () => {
    put(join(dir, 'app', 'workouts.prisma'), 'extend model Nobody {\n  w W[]\n}\n');
    let error: unknown;
    try {
      composeSchema(opts);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ComposeError);
    expect((error as ComposeError).file).toBe(join(dir, 'app', 'workouts.prisma'));
    expect((error as ComposeError).line).toBe(1);
  });

  it('fails clearly when the platform schema folder is missing', () => {
    expect(() => composeSchema({ ...opts, platformSchemaDir: join(dir, 'gone') })).toThrow(/platform schema folder not found/);
  });
});

describe('the default platform schema folder', () => {
  it('is the schema/ folder shipped in the package', () => {
    const { files } = composeSchema({ appFragmentsDir: join(dir, 'app'), outDir: join(dir, 'out') });
    expect(files.map((f) => f.path.split('/').pop())).toEqual([
      'platform.ai.prisma', 'platform.base.prisma', 'platform.credentials.prisma', 'platform.db-backup.prisma',
      'platform.identity.prisma', 'platform.jobs.prisma', 'platform.notifications.prisma', 'platform.settings.prisma',
      'platform.sharing.prisma', 'platform.storage.prisma', 'app.workouts.prisma',
    ]);
  });
});

describe('writeComposedSchema', () => {
  it('writes the files, creating the folder', () => {
    const res = writeComposedSchema(opts);
    expect(readdirSync(join(dir, 'out')).sort()).toEqual(['app.workouts.prisma', 'platform.base.prisma', 'platform.identity.prisma']);
    for (const f of res.files) expect(readFileSync(f.path, 'utf8')).toBe(f.contents);
  });

  it('deletes a generated file no fragment produces any more, and leaves other files alone', () => {
    writeComposedSchema(opts);
    put(join(dir, 'out', 'notes.txt'), 'keep me');
    rmSync(join(dir, 'app', 'workouts.prisma'));
    writeComposedSchema(opts);
    expect(readdirSync(join(dir, 'out')).sort()).toEqual(['notes.txt', 'platform.base.prisma', 'platform.identity.prisma']);
  });

  it('writes nothing when a fragment is rejected', () => {
    put(join(dir, 'app', 'workouts.prisma'), 'extend model Nobody {\n  w W[]\n}\n');
    expect(() => writeComposedSchema(opts)).toThrow(ComposeError);
    expect(() => readdirSync(join(dir, 'out'))).toThrow();
  });
});

describe('checkComposedSchema (--check)', () => {
  it('passes on a fresh compose', () => {
    writeComposedSchema(opts);
    expect(checkComposedSchema(opts)).toEqual({ upToDate: true, diff: '' });
  });

  it('fails when the generated folder does not exist yet', () => {
    const res = checkComposedSchema(opts);
    expect(res.upToDate).toBe(false);
    expect(res.diff).toContain(`missing: ${join(dir, 'out', 'platform.identity.prisma')}`);
  });

  it('fails when a fragment is edited without re-composing, and the diff shows the line', () => {
    writeComposedSchema(opts);
    put(join(dir, 'platform', 'identity.prisma'), IDENTITY.replace('id String @id', 'id String @id\n  email String @unique'));
    const res = checkComposedSchema(opts);
    expect(res.upToDate).toBe(false);
    expect(res.diff).toContain(`changed: ${join(dir, 'out', 'platform.identity.prisma')}`);
    expect(res.diff).toContain('+   email String @unique');
  });

  it('fails when a generated file is edited by hand', () => {
    writeComposedSchema(opts);
    const file = join(dir, 'out', 'platform.identity.prisma');
    writeFileSync(file, `${readFileSync(file, 'utf8')}// hand edit\n`);
    const res = checkComposedSchema(opts);
    expect(res.upToDate).toBe(false);
    expect(res.diff).toContain('- // hand edit');
  });

  it('fails on a stale generated file no fragment produces', () => {
    writeComposedSchema(opts);
    put(join(dir, 'out', 'platform.old.prisma'), '// old');
    const res = checkComposedSchema(opts);
    expect(res.upToDate).toBe(false);
    expect(res.diff).toContain(`stale (no fragment produces it): ${join(dir, 'out', 'platform.old.prisma')}`);
  });

  it('writes nothing', () => {
    checkComposedSchema(opts);
    expect(() => readdirSync(join(dir, 'out'))).toThrow();
  });

  it('ignores CRLF line endings (a Windows checkout)', () => {
    const res = writeComposedSchema(opts);
    for (const f of res.files) writeFileSync(f.path, f.contents.replace(/\n/g, '\r\n'));
    expect(checkComposedSchema(opts).upToDate).toBe(true);
  });
});

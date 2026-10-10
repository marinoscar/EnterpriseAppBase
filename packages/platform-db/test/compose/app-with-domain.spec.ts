// The fixture app (test/fixtures/app-with-domain): a domain model plus
// `extend model` blocks on User, StorageObject and Job. The heavy test runs
// the real Prisma CLI and the real TypeScript compiler, because "the composed
// schema is valid and the client is typed" cannot be proven by string checks.
// The work folder lives inside this package so the generated client resolves
// @prisma/client the way an app's would; it is deleted afterwards.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ComposeError, checkComposedSchema, composeSchema, writeComposedSchema, type ComposeOptions } from '../../src/compose/index.js';

const PACKAGE_ROOT = join(__dirname, '..', '..');
const FIXTURE = join(__dirname, '..', 'fixtures', 'app-with-domain');
const nodeRequire = createRequire(__filename);
const PRISMA_BIN = nodeRequire.resolve('prisma/build/index.js');
const TSC_BIN = nodeRequire.resolve('typescript/bin/tsc');

const BASE_WITH_OUTPUT = `generator client {
  provider = "prisma-client-js"
  output   = "../../client"
}

datasource db {
  provider = "postgresql"
}
`;

function run(bin: string, args: string[], cwd: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env: { ...process.env, DATABASE_URL: 'postgresql://dummy:dummy@localhost:5432/dummy' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

let work: string;
let opts: ComposeOptions;

beforeAll(() => {
  work = mkdtempSync(join(PACKAGE_ROOT, '.work-fixture-'));
  mkdirSync(join(work, 'prisma'), { recursive: true });
  cpSync(join(FIXTURE, 'fragments'), join(work, 'prisma', 'fragments'), { recursive: true });
  // The app replaces the package's base.prisma to control the generator output.
  writeFileSync(join(work, 'prisma', 'fragments', 'base.prisma'), BASE_WITH_OUTPUT);
  opts = { appFragmentsDir: join(work, 'prisma', 'fragments'), outDir: join(work, 'prisma', 'schema') };
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('fixture app with a domain (Workout)', () => {
  it('composes: three back-relations land on three different platform models', () => {
    const { files, warnings } = composeSchema(opts);
    const text = (name: string): string => files.find((f) => f.path.endsWith(name))!.contents;
    expect(text('platform.identity.prisma')).toMatch(/\/\/ composed from app:workouts\.prisma\n {2}workouts Workout\[\]\n/);
    expect(text('platform.storage.prisma')).toMatch(/\/\/ composed from app:workouts\.prisma\n {2}workoutPhotos Workout\[\]\n/);
    expect(text('platform.jobs.prisma')).toMatch(/\/\/ composed from app:workouts\.prisma\n {2}workoutExport WorkoutExport\?\n/);
    expect(text('app.workouts.prisma')).not.toMatch(/^extend model/m);
    expect(files.some((f) => f.path.endsWith('platform.base.prisma'))).toBe(false); // replaced by the app's
    expect(warnings).toEqual([expect.stringContaining("replaces the package's base.prisma")]);
  });

  it('is up to date after a write and stale after the fixture changes', () => {
    writeComposedSchema(opts);
    expect(checkComposedSchema(opts).upToDate).toBe(true);
    const frag = join(opts.appFragmentsDir, 'workouts.prisma');
    const before = readFileSync(frag, 'utf8');
    writeFileSync(frag, before.replace('title     String', 'title     String\n  notes     String?'));
    expect(checkComposedSchema(opts).upToDate).toBe(false);
    writeFileSync(frag, before);
    expect(checkComposedSchema(opts).upToDate).toBe(true);
  });

  it('rejects the same fixture when a platform model is not extensible', () => {
    const frag = join(opts.appFragmentsDir, 'locked.prisma');
    writeFileSync(frag, 'extend model Role {\n  workouts Workout[]\n}\n');
    try {
      expect(() => composeSchema(opts)).toThrow(ComposeError);
      expect(() => composeSchema(opts)).toThrow(/locked\.prisma:1: NOT_EXTENSIBLE: .*Role/);
    } finally {
      rmSync(frag);
    }
  });

  it(
    'passes prisma validate, generates a client, and type-checks include: { workouts: true }',
    () => {
      writeComposedSchema(opts);

      const validate = run(PRISMA_BIN, ['validate', '--schema', opts.outDir], work);
      expect(validate.out).toMatch(/schemas? at .* (is|are) valid/);
      expect(validate.status).toBe(0);

      const generate = run(PRISMA_BIN, ['generate', '--schema', opts.outDir], work);
      expect(generate.status, generate.out).toBe(0);
      expect(existsSync(join(work, 'client', 'index.d.ts'))).toBe(true);

      writeFileSync(
        join(work, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { strict: true, noEmit: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022', skipLibCheck: true, types: [] },
          files: ['check-include.ts'],
        }),
      );
      cpSync(join(FIXTURE, 'check-include.ts.txt'), join(work, 'check-include.ts'));
      const positive = run(TSC_BIN, ['-p', 'tsconfig.json'], work);
      expect(positive.out).toBe('');
      expect(positive.status).toBe(0);

      // The negative control: the same compiler rejects a relation that does not exist.
      writeFileSync(join(work, 'tsconfig.negative.json'), JSON.stringify({ extends: './tsconfig.json', files: ['check-negative.ts'] }));
      cpSync(join(FIXTURE, 'check-negative.ts.txt'), join(work, 'check-negative.ts'));
      const negative = run(TSC_BIN, ['-p', 'tsconfig.negative.json'], work);
      expect(negative.status).not.toBe(0);
      expect(negative.out).toContain("'notARelation' does not exist");
    },
    240_000,
  );

  it('without the composer the same models are invalid (the back-relations are the hard problem)', () => {
    // Plain Prisma cannot extend a model across files: drop the extend blocks and validation fails.
    const bare = join(work, 'bare');
    mkdirSync(bare, { recursive: true });
    const { files } = composeSchema(opts);
    for (const f of files) {
      const name = f.path.split('/').pop()!;
      writeFileSync(join(bare, name), f.contents.replace(/\n {2}\/\/ composed from [^\n]*\n(?: {2}[^\n]*\n)+/g, '\n'));
    }
    const validate = run(PRISMA_BIN, ['validate', '--schema', bare], work);
    expect(validate.status).not.toBe(0);
    expect(validate.out).toMatch(/opposite relation field|relation field/i);
  });
});

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main } from '../../src/bin/platform.js';

let root: string;
let out: string[];
let err: string[];
const io = {
  out: (l: string): void => void out.push(l),
  err: (l: string): void => void err.push(l),
};

function put(rel: string, text: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'platform-db-cli-'));
  out = [];
  err = [];
  put('schema/base.prisma', 'datasource db {\n  provider = "postgresql"\n}\n');
  put('schema/identity.prisma', '// @extensible\nmodel User {\n  id String @id\n}\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const args = (...rest: string[]): string[] => ['db', 'compose', '--root', root, '--platform-schema', 'schema', ...rest];

describe('platform db compose', () => {
  it('writes prisma/schema and exits 0', async () => {
    expect(await main(args(), io)).toBe(0);
    expect(readdirSync(join(root, 'prisma', 'schema')).sort()).toEqual(['platform.base.prisma', 'platform.identity.prisma']);
    expect(out).toEqual(['composed 2 files into prisma/schema']);
  });

  it('--check exits 1 with the diff before compose and 0 after', async () => {
    expect(await main(args('--check'), io)).toBe(1);
    expect(err.join('\n')).toMatch(/missing: .*platform\.identity\.prisma[\s\S]*out of date: run "platform db compose"/);
    expect(await main(args(), io)).toBe(0);
    out = [];
    expect(await main(args('--check'), io)).toBe(0);
    expect(out).toEqual(['prisma/schema is up to date']);
  });

  it('exits 2 and prints file:line: CODE: for a rejected fragment', async () => {
    put('prisma/fragments/w.prisma', 'extend model Nobody {\n  w W[]\n}\n');
    expect(await main(args(), io)).toBe(2);
    expect(err[0]).toBe(`${join(root, 'prisma/fragments/w.prisma')}:1: UNKNOWN_MODEL: ${err[0]?.split('UNKNOWN_MODEL: ')[1]}`);
    expect(err[0]).toContain('no fragment declares a model named Nobody');
  });

  it('honours --fragments and --out', async () => {
    put('frag/w.prisma', 'model W {\n  id String @id\n}\n');
    expect(await main(args('--fragments', 'frag', '--out', 'gen'), io)).toBe(0);
    expect(readdirSync(join(root, 'gen')).sort()).toEqual(['app.w.prisma', 'platform.base.prisma', 'platform.identity.prisma']);
  });

  it('prints a warning for an app base.prisma and still succeeds', async () => {
    put('prisma/fragments/base.prisma', 'datasource db {\n  provider = "postgresql"\n}\n');
    expect(await main(args(), io)).toBe(0);
    expect(err).toEqual([expect.stringMatching(/^warning: .*replaces the package's base\.prisma/)]);
  });

  it('exits 2 on an unknown subcommand', async () => {
    expect(await main(['db', 'nope'], io)).toBe(2);
  });

  it('prints help and exits 0', async () => {
    expect(await main(['db', 'compose', '--help'], io)).toBe(0);
    expect(out.join('\n')).toContain('--check');
  });
});

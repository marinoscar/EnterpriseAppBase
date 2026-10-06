import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, USAGE, type CliIo } from './cli.js';

let app: string;
let out: string[];
let err: string[];
const io: CliIo = { out: (line) => out.push(line), err: (line) => err.push(line) };

beforeEach(() => {
  app = mkdtempSync(join(tmpdir(), 'platform-infra-cli-'));
  out = [];
  err = [];
});

afterEach(() => {
  rmSync(app, { recursive: true, force: true });
});

describe('platform-infra command', () => {
  it('syncs into --root and reports what it wrote', () => {
    expect(main(['sync', '--root', app], io)).toBe(0);
    expect(out).toContain('wrote    infra/compose/telemetry.compose.yml');
    expect(out).toContain('created  infra/otel/app-collector.yaml (app-owned: edit it freely)');
    expect(out).toContain('wrote    infra/platform-infra.lock.json');
    expect(out.at(-1)).toBe('platform-infra sync: 3 written, 0 unchanged, 1 created.');
  });

  it('exits 0 from --check after a sync', () => {
    main(['sync', '--root', app], io);
    out = [];
    expect(main(['sync', '--check', '--root', app], io)).toBe(0);
    expect(out.at(-1)).toMatch(/^platform-infra sync --check: 3 generated file\(s\) match @marinoscar\/platform-infra@/);
    expect(err).toEqual([]);
  });

  it('exits 1 from --check after a hand edit, naming the file and the fix on stderr', () => {
    main(['sync', '--root', app], io);
    const file = join(app, 'infra/compose/telemetry.compose.yml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('memory: 1G', 'memory: 2G'));

    expect(main(['sync', '--root', app, '--check'], io)).toBe(1);
    expect(err[0]).toMatch(/^error: infra\/compose\/telemetry\.compose\.yml:\d+: differs from @marinoscar\/platform-infra@/);
    expect(err[0]).toContain('npx platform-infra sync');
    expect(err[0]).toContain('infra/otel/app-collector.yaml');
    expect(err.at(-1)).toBe('platform-infra sync --check: 1 problem(s). Generated files are never edited by hand.');
  });

  it('--check writes nothing', () => {
    expect(main(['sync', '--check', '--root', app], io)).toBe(1);
    expect(() => readFileSync(join(app, 'infra/platform-infra.lock.json'))).toThrow();
  });

  it.each([
    [[], 2],
    [['--help'], 0],
    [['deploy'], 2],
    [['sync', '--force'], 2],
    [['sync', '--root'], 2],
    [['sync', '--root', '--check'], 2],
  ] as const)('%j exits %i with the usage', (argv, code) => {
    expect(main(argv, io)).toBe(code);
    expect([...out, ...err].join('\n')).toContain(USAGE.split('\n')[0]!);
  });

  it('reports an error (exit 1) instead of throwing', () => {
    const missing = mkdtempSync(join(tmpdir(), 'platform-infra-nopkg-'));
    try {
      expect(main(['sync', '--root', app], io, { packageRoot: missing })).toBe(1);
      expect(err.join('\n')).toMatch(/package\.json|ENOENT/);
    } finally {
      rmSync(missing, { recursive: true, force: true });
    }
  });
});

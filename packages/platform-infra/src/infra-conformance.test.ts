import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { runInfraConformance, type InfraConformanceTestApi, type InfraExec } from './infra-conformance.js';

const REPO_ROOT = join(fileURLToPath(new URL('../', import.meta.url)), '..', '..');

/** A test API that records the cases and runs them on demand, collecting assertion failures. */
function recorder() {
  const cases: { name: string; body: () => unknown }[] = [];
  const failures: string[] = [];
  const api: InfraConformanceTestApi = {
    describe: (_name, body) => body(),
    it: (name, body) => void cases.push({ name, body }),
    expect: (actual) => ({
      toEqual: (expected) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
      },
    }),
  };
  const runAll = async (): Promise<string[]> => {
    for (const testCase of cases) await testCase.body();
    return failures;
  };
  return { api, cases, runAll, failures };
}

/** An exec that answers by command line, recording every call. */
function fakeExec(answer: (line: string) => { status: number | null; output?: string }, log: string[] = []): InfraExec {
  return (command, args) => {
    const line = [command, ...args].join(' ');
    log.push(line);
    const result = answer(line);
    return { status: result.status, output: result.output ?? '' };
  };
}

const present: InfraExec = fakeExec(() => ({ status: 0 }));

describe('runInfraConformance', () => {
  it('registers a sync case, a compose case per mode and an nginx case per CSP file', () => {
    const r = recorder();
    runInfraConformance({ appRoot: REPO_ROOT, testApi: r.api, exec: present });
    expect(r.cases.map((c) => c.name.split(':')[0])).toEqual([
      'sync --check',
      'compose config',
      'compose config',
      'compose config',
      'compose config',
      'compose config',
      'nginx -t',
      'nginx -t',
    ]);
  });

  it('passes the reference app: the sync check is real, docker and nginx are the fake', async () => {
    const r = recorder();
    const calls: string[] = [];
    runInfraConformance({ appRoot: REPO_ROOT, testApi: r.api, exec: fakeExec(() => ({ status: 0 }), calls) });
    expect(await r.runAll()).toEqual([]);
    // vps renders with the telemetry files and the app overlays after every platform file.
    const vps = calls.find((line) => line.includes('vps.compose.yml'));
    expect(vps).toContain('-f base.compose.yml -f prod.compose.yml -f telemetry.compose.yml -f vps.compose.yml -f vps.telemetry.compose.yml config -q');
    expect(calls.find((line) => line.includes('test.compose.yml'))).toBe('docker compose -f test.compose.yml config -q');
  });

  it('fails a mode whose compose config fails, with the docker output', async () => {
    const r = recorder();
    runInfraConformance({
      appRoot: REPO_ROOT,
      testApi: r.api,
      modes: ['vps'],
      exec: fakeExec((line) => (line.includes('config -q') ? { status: 1, output: 'services.api.memory: invalid' } : { status: 0 })),
    });
    const failures = await r.runAll();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('services.api.memory: invalid');
  });

  it('fails nginx -t with its output', async () => {
    const r = recorder();
    runInfraConformance({
      appRoot: REPO_ROOT,
      testApi: r.api,
      skip: { sync: 'covered elsewhere', compose: 'covered elsewhere' },
      exec: fakeExec((line) => (line.startsWith('nginx -t') ? { status: 1, output: 'unknown directive locatoin' } : { status: 0 })),
    });
    const failures = await r.runAll();
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain('unknown directive locatoin');
  });

  it('skips compose with a reason when docker is absent, and nginx when neither tool is', async () => {
    const r = recorder();
    runInfraConformance({
      appRoot: REPO_ROOT,
      testApi: r.api,
      skip: { sync: 'covered elsewhere' },
      exec: fakeExec(() => ({ status: null })),
    });
    expect(r.cases.map((c) => c.name)).toEqual([
      'sync --check: skipped by the app (covered elsewhere)',
      'compose config: skipped (docker compose is not available)',
      'nginx -t: skipped (neither an nginx binary nor a running docker daemon is available)',
    ]);
    expect(await r.runAll()).toEqual([]);
  });

  it('runs nginx -t in the pinned image when only docker is available', async () => {
    const r = recorder();
    const calls: string[] = [];
    runInfraConformance({
      appRoot: REPO_ROOT,
      testApi: r.api,
      skip: { sync: 'x', compose: 'x' },
      exec: fakeExec((line) => (line.startsWith('nginx -v') ? { status: null } : { status: 0 }), calls),
    });
    expect(await r.runAll()).toEqual([]);
    const run = calls.find((line) => line.startsWith('docker run'));
    expect(run).toMatch(/^docker run --rm --add-host api:127\.0\.0\.1 --add-host web:127\.0\.0\.1 /);
    expect(run).toContain(':/etc/nginx/app.d:ro nginx:');
    expect(run).toMatch(/ nginx -t$/);
  });

  it('tests a scratch copy whose listeners are unprivileged (nginx -t binds them)', async () => {
    const r = recorder();
    const listens: string[] = [];
    runInfraConformance({
      appRoot: REPO_ROOT,
      testApi: r.api,
      skip: { sync: 'x', compose: 'x' },
      exec: fakeExec((line) => {
        if (line.startsWith('nginx -t')) {
          const conf = line.split(' ').at(-1) as string;
          listens.push(...(readFileSync(conf, 'utf8').match(/^\s*listen\s+[^;]+;/gm) ?? []).map((l) => l.trim()));
        }
        return { status: 0 };
      }),
    });
    expect(await r.runAll()).toEqual([]);
    expect(listens.length).toBeGreaterThanOrEqual(4);
    for (const listen of listens) expect(listen).toMatch(/^listen 127\.0\.0\.1:\d{5};$/);
    expect(new Set(listens).size).toBe(listens.length);
  });

  it('reports a sync problem: a hand-edited generated file', async () => {
    const app = mkdtempSync(join(tmpdir(), 'infra-conformance-'));
    try {
      cpSync(join(REPO_ROOT, 'infra'), join(app, 'infra'), { recursive: true });
      cpSync(join(REPO_ROOT, 'packages', 'shared'), join(app, 'packages', 'shared'), { recursive: true });
      cpSync(join(REPO_ROOT, 'apps', 'cli', 'package.json'), join(app, 'apps', 'cli', 'package.json'));
      writeFileSync(join(app, 'infra', 'nginx', 'csp.conf'), '# hand edited\n');
      const r = recorder();
      runInfraConformance({ appRoot: app, testApi: r.api, skip: { compose: 'x', nginx: 'x' } });
      const failures = await r.runAll();
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain('infra/nginx/csp.conf');
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it('refuses an opt-out without a reason, and a root without infra/', () => {
    const r = recorder();
    expect(() => runInfraConformance({ appRoot: REPO_ROOT, testApi: r.api, skip: { nginx: '  ' } })).toThrow(/skip\.nginx needs a reason/);
    expect(() => runInfraConformance({ appRoot: tmpdir(), testApi: r.api })).toThrow(/has no infra\/ folder/);
  });
});

const HAS_NGINX = spawnSync('nginx', ['-v']).status === 0;

describe.skipIf(!HAS_NGINX)('with a real nginx binary', () => {
  it('accepts the reference app (and a broken app.d/ fails)', async () => {
    const good = recorder();
    runInfraConformance({ appRoot: REPO_ROOT, testApi: good.api, skip: { sync: 'x', compose: 'x' } });
    expect(await good.runAll()).toEqual([]);

    const app = mkdtempSync(join(tmpdir(), 'infra-conformance-nginx-'));
    try {
      cpSync(join(REPO_ROOT, 'infra'), join(app, 'infra'), { recursive: true });
      writeFileSync(join(app, 'infra', 'nginx', 'app.d', 'locations', 'broken.conf'), 'locatoin /x { }\n');
      const bad = recorder();
      runInfraConformance({ appRoot: app, testApi: bad.api, skip: { sync: 'x', compose: 'x' } });
      expect((await bad.runAll()).length).toBeGreaterThan(0);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});

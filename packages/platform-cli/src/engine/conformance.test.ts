import { afterEach, describe, expect, it } from 'vitest';

import {
  cliConformanceSuites,
  registerCliConformanceSuite,
  resetCliConformanceSuitesForTests,
  runPlatformConformance,
  type ConformanceTestApi,
} from './conformance.js';
import type { JobExecutor } from './node/executors/index.js';

// =============================================================================
// The CLI's runPlatformConformance  (PP-8.9, #715)
// =============================================================================

/** A test API that records the cases and runs them on demand. */
function recorder() {
  const cases: { name: string; body: () => unknown }[] = [];
  const failures: string[] = [];
  let current = '';
  const api: ConformanceTestApi = {
    describe: (name, body) => {
      current = name;
      body();
    },
    it: (name, body) => cases.push({ name: `${current} > ${name}`, body }),
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
  return { api, cases, runAll };
}

const clean: JobExecutor = { type: 'app.clean', requiresInput: false, execute: async () => ({ ok: true }) };
const leaky: JobExecutor = {
  type: 'app.leaky',
  requiresInput: false,
  execute: async (context) => ({ echoed: (await context.api.jobSecret(context.nodeId, context.job.id)).material.password }),
};

describe('runPlatformConformance (cli suite)', () => {
  it('registers one case per fragment and per executor', () => {
    const r = recorder();
    runPlatformConformance({
      suites: { cli: { envFragments: [{ name: 'a.env', text: 'A=1\n' }], executors: [clean] } },
      testApi: r.api,
    });
    expect(r.cases.map((c) => c.name)).toEqual([
      'cli conformance > env fragment a.env declares no commented KEY=value line',
      'cli conformance > executor app.clean never persists or logs a job-scoped credential',
    ]);
  });

  it('passes clean fragments and executors, and fails a commented assignment and a leaky executor', async () => {
    const ok = recorder();
    runPlatformConformance({ suites: { cli: { envFragments: [{ name: 'a.env', text: 'A=1\n' }], executors: [clean] } }, testApi: ok.api });
    expect(await ok.runAll()).toEqual([]);

    const bad = recorder();
    runPlatformConformance({
      suites: { cli: { envFragments: [{ name: 'b.env', text: '# For example:\n# B=2\n' }], executors: [leaky] } },
      testApi: bad.api,
    });
    const failures = await bad.runAll();
    expect(failures).toHaveLength(2);
    expect(failures[0]).toBe('["B"] != []');
    expect(failures[1]).toContain('the credential is in the result the node reports to the server');
  });

  it('allows the keys a fragment documents on purpose', async () => {
    const r = recorder();
    runPlatformConformance({
      suites: { cli: { envFragments: [{ name: 'base', text: '# B=2\n', allowCommented: ['B'] }], executors: [] } },
      testApi: r.api,
    });
    expect(await r.runAll()).toEqual([]);
  });

  it('refuses an unknown suite, and shows an opt-out with its reason', () => {
    const r = recorder();
    expect(() => runPlatformConformance({ suites: { clii: false } as never, testApi: r.api })).toThrow(/unknown CLI conformance suite "clii"/);
    runPlatformConformance({ suites: { cli: { skip: 'the app has no CLI env' } }, testApi: r.api });
    expect(r.cases.map((c) => c.name)).toEqual(['cli conformance > cli: skipped by the app (the app has no CLI env)']);
  });
});

describe('the skip reason is required', () => {
  it.each([false, { skip: '' }, { skip: '   ' }, { skip: undefined }])('refuses %j', (value) => {
    const r = recorder();
    expect(() => runPlatformConformance({ suites: { cli: value as never }, testApi: r.api })).toThrow(/cli/);
  });

  it('names the fix for the old `cli: false` opt-out', () => {
    expect(() => runPlatformConformance({ suites: { cli: false as never }, testApi: recorder().api })).toThrow(
      /switched off with `false`.*cli: \{ skip: 'why this app does not run it' \}/,
    );
  });

  it('prints a summary naming every run and skipped suite', () => {
    let table = '';
    runPlatformConformance({
      suites: { cli: { envFragments: [], executors: [] }, deployRegistrations: { skip: 'no VPS deployment' } },
      testApi: recorder().api,
      summaryOutput: (text) => (table = text),
    });
    expect(table).toBe(['suite                 status', 'cli                   run', 'deploy-registrations  skipped: no VPS deployment', '1 run, 1 skipped'].join('\n'));
  });
});

describe('the suite registry', () => {
  afterEach(() => resetCliConformanceSuitesForTests());

  it('holds the built-in suites by id', () => {
    expect(cliConformanceSuites.list().map((suite) => suite.id)).toEqual(['cli', 'deploy-registrations']);
  });

  it('runs a suite an app registered, with its options', () => {
    const r = recorder();
    registerCliConformanceSuite<{ minimum: number }>({
      id: 'coach-commands',
      title: 'coach commands',
      description: 'x',
      register: (api, options) => api.describe('coach commands', () => api.it(`has at least ${options.minimum}`, () => undefined)),
    });
    runPlatformConformance({ suites: { coachCommands: { minimum: 2 } } as never, testApi: r.api });
    expect(r.cases.map((c) => c.name)).toEqual(['coach commands > has at least 2']);
  });

  it('refuses a duplicate id, a malformed id and a registration after the runner froze it', () => {
    expect(() => registerCliConformanceSuite({ id: 'cli', title: 't', description: 'd', register: () => undefined })).toThrow(/already registered/);
    expect(() => registerCliConformanceSuite({ id: 'Bad Id', title: 't', description: 'd', register: () => undefined })).toThrow(/invalid/);
    runPlatformConformance({ suites: {}, testApi: recorder().api });
    expect(() => registerCliConformanceSuite({ id: 'late', title: 't', description: 'd', register: () => undefined })).toThrow(
      /after runPlatformConformance/,
    );
  });
});

describe('the deploy-registrations suite', () => {
  it('passes for the platform as built', async () => {
    const ok = recorder();
    runPlatformConformance({ suites: { deployRegistrations: {} }, testApi: ok.api });
    expect(await ok.runAll()).toEqual([]);
  });
});

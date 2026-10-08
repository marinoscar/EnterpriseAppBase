import { describe, expect, it } from 'vitest';

import { runPlatformConformance, type ConformanceTestApi } from './conformance.js';
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

  it('refuses an unknown suite, and shows an opt-out', () => {
    const r = recorder();
    expect(() => runPlatformConformance({ suites: { clii: false } as never, testApi: r.api })).toThrow(/unknown CLI conformance suite "clii"/);
    runPlatformConformance({ suites: { cli: false }, testApi: r.api });
    expect(r.cases.map((c) => c.name)).toEqual(['cli conformance > cli: disabled by the app']);
  });
});

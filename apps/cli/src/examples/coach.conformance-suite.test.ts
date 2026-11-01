import {
  cliConformanceSuites,
  registerCliConformanceSuite,
  resetCliConformanceSuitesForTests,
  runPlatformConformance,
  type ConformanceTestApi,
} from '@marinoscar/platform-cli/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { coachCommandsSuite } from './coach.conformance-suite.js';

// The registerCliConformanceSuite example (PP-14.22): a registered suite gets
// its options; skipping needs a reason.

afterEach(() => resetCliConformanceSuitesForTests());

function recorder() {
  const cases: string[] = [];
  const failures: string[] = [];
  let current = '';
  const api: ConformanceTestApi = {
    describe: (name, body) => {
      current = name;
      body();
    },
    it: (name, body) => {
      cases.push(`${current} > ${name}`);
      void body();
    },
    expect: (actual) => ({
      toEqual: (expected) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
      },
    }),
  };
  return { api, cases, failures };
}

describe('coachCommandsSuite', () => {
  it('registers once, by id, beside the built-ins', () => {
    registerCliConformanceSuite(coachCommandsSuite);
    expect(cliConformanceSuites.list().map((suite) => suite.id)).toEqual(['cli', 'deploy-registrations', 'coach-commands']);
  });

  it('runs with the options the app passes under its camelCase key', () => {
    registerCliConformanceSuite(coachCommandsSuite);
    const r = recorder();
    runPlatformConformance({
      suites: { coachCommands: { required: ['coach-seed', 'coach-export'], commands: ['coach-seed'] } } as never,
      testApi: r.api,
      summaryOutput: () => undefined,
    });
    expect(r.cases).toEqual([
      'coach commands conformance > command coach-seed is registered',
      'coach commands conformance > command coach-export is registered',
    ]);
    expect(r.failures).toEqual(['false != true']);
  });

  it('can be skipped, with a reason, and not without one', () => {
    registerCliConformanceSuite(coachCommandsSuite);
    const r = recorder();
    runPlatformConformance({ suites: { coachCommands: { skip: 'the app has no coach commands yet' } } as never, testApi: r.api, summaryOutput: () => undefined });
    expect(r.cases).toEqual(['coach commands conformance > coach-commands: skipped by the app (the app has no coach commands yet)']);
    expect(() => runPlatformConformance({ suites: { coachCommands: { skip: '' } } as never, testApi: r.api })).toThrow(/without a reason/);
  });
});

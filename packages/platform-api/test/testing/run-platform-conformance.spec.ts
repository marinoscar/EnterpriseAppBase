import { runPlatformConformance, conformanceSuites } from '../../src/testing';
import type { CronEnqueueOnlyOptions } from '../../src/testing';
import {
  emptySourceRoot,
  fixtureSourceRoot,
  outcome,
  recordingTestApi,
  removeSourceRoots,
  writeSource,
} from '../support/conformance-harness';

afterAll(removeSourceRoots);

const WHY = 'Fixture exemption: the reaper recovers abandoned work and cannot depend on the queue.';

const compliantRoot = (): string => {
  const root = emptySourceRoot();
  writeSource(root, 'jobs/tasks/ok.task.ts', "class T { @Cron('0 0 * * *') async tick() { await this.jobs.enqueue('x'); } }\n");
  return root;
};

describe('runPlatformConformance', () => {
  it('registers one describe block per enabled suite, with the suite title and its cases', () => {
    const { api, tests, titles } = recordingTestApi();

    runPlatformConformance({
      sourceRoots: [compliantRoot()],
      suites: { cronEnqueueOnly: { exempt: [], minCronFiles: 1 } },
      testApi: api,
    });

    expect(titles).toEqual(['every @Cron enqueues rather than working']);
    expect(tests.map((t) => t.name)).toEqual([
      'every @Cron enqueues rather than working > finds the crons at all, so a broken scan cannot pass vacuously',
      'every @Cron enqueues rather than working > queues its work instead of doing it, in every non-exempt cron',
    ]);
  });

  it('registers one "exempts <file>, on the record" test per exemption and runs them against the scan', async () => {
    const { api, tests } = recordingTestApi();
    const options: CronEnqueueOnlyOptions = {
      exempt: [{ file: 'jobs/tasks/exempt.task.ts', why: WHY }],
      minCronFiles: 6,
    };

    runPlatformConformance({
      sourceRoots: [fixtureSourceRoot()],
      suites: { cronEnqueueOnly: options },
      testApi: api,
    });

    const byName = (fragment: string) => tests.find((t) => t.name.includes(fragment))!;
    expect(await outcome(byName('finds the crons at all'))).toBeNull();
    expect(await outcome(byName('exempts jobs/tasks/exempt.task.ts, on the record'))).toBeNull();
    // The fixture tree holds offenders, so the last test fails with the findings.
    const failure = await outcome(byName('queues its work instead of doing it'));
    expect(failure).not.toBeNull();
    expect(failure!.message).toContain('deletes-inline.task.ts');
    expect(failure!.message).toContain('a @Cron body containing a bulk delete');
  });

  it('passes on a compliant tree', async () => {
    const { api, tests } = recordingTestApi();

    runPlatformConformance({
      sourceRoots: [compliantRoot()],
      suites: { cronEnqueueOnly: { exempt: [], minCronFiles: 1 } },
      testApi: api,
    });

    for (const test of tests) expect(await outcome(test)).toBeNull();
  });

  it('fails the vacuity guard when fewer crons are found than the app expects', async () => {
    const { api, tests } = recordingTestApi();

    runPlatformConformance({
      sourceRoots: [compliantRoot()],
      suites: { cronEnqueueOnly: { exempt: [], minCronFiles: 8 } },
      testApi: api,
    });

    expect(await outcome(tests[0])).not.toBeNull();
  });

  it('fails an exemption whose file holds no @Cron, or whose reason is too short', async () => {
    const { api, tests } = recordingTestApi();

    runPlatformConformance({
      sourceRoots: [compliantRoot()],
      suites: {
        cronEnqueueOnly: {
          exempt: [
            { file: 'jobs/tasks/gone.task.ts', why: WHY },
            { file: 'jobs/tasks/ok.task.ts', why: 'too short' },
          ],
          minCronFiles: 1,
        },
      },
      testApi: api,
    });

    const exemptTests = tests.filter((t) => t.name.includes('exempts '));
    expect(exemptTests).toHaveLength(2);
    expect(await outcome(exemptTests[0])).not.toBeNull();
    expect(await outcome(exemptTests[1])).not.toBeNull();
  });

  it('throws on an unknown suite key, so a typo cannot disable a check silently', () => {
    const { api } = recordingTestApi();

    expect(() =>
      runPlatformConformance({
        sourceRoots: [compliantRoot()],
        suites: { cronEnqueueOnlyy: { exempt: [], minCronFiles: 1 } } as never,
        testApi: api,
      }),
    ).toThrow('unknown conformance suite "cronEnqueueOnlyy"');
  });

  it('makes an opt-out visible: a passing "<id>: disabled by the app" test replaces the suite', async () => {
    const { api, tests, titles } = recordingTestApi();

    runPlatformConformance({
      sourceRoots: [compliantRoot()],
      suites: { cronEnqueueOnly: false },
      testApi: api,
    });

    expect(titles).toEqual(['every @Cron enqueues rather than working']);
    expect(tests.map((t) => t.name)).toEqual([
      'every @Cron enqueues rather than working > cron-enqueue-only: disabled by the app',
    ]);
    expect(await outcome(tests[0])).toBeNull();
  });

  it('registers nothing for a suite the app leaves out', () => {
    const { api, tests, titles } = recordingTestApi();

    runPlatformConformance({ sourceRoots: [compliantRoot()], suites: {}, testApi: api });

    expect(titles).toEqual([]);
    expect(tests).toEqual([]);
  });

  it('refuses an empty sourceRoots list', () => {
    const { api } = recordingTestApi();

    expect(() => runPlatformConformance({ sourceRoots: [], suites: {}, testApi: api })).toThrow('sourceRoots is empty');
  });

  it('freezes the suite registry on the first run, so a late registration fails loudly', () => {
    const { api } = recordingTestApi();

    runPlatformConformance({ sourceRoots: [compliantRoot()], suites: {}, testApi: api });

    expect(conformanceSuites.frozen).toBe(true);
    expect(conformanceSuites.ids()).toEqual(['cron-enqueue-only']);
    expect(() => conformanceSuites.register({ id: 'late', title: 't', description: 'd', check: () => ({ scanned: {}, scannedFiles: {}, findings: [] }), cases: () => [] })).toThrow(
      expect.objectContaining({ code: 'FROZEN' }),
    );
  });

  it('falls back to the global describe/it/expect when no testApi is given', () => {
    // Under Jest the globals exist; registering a disabled suite adds one passing test to this file.
    expect(() =>
      runPlatformConformance({ sourceRoots: [compliantRoot()], suites: {} }),
    ).not.toThrow();
  });

  it('says what to do when there is no test runner', () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = g.describe;
    g.describe = undefined;
    try {
      expect(() => runPlatformConformance({ sourceRoots: [compliantRoot()], suites: {} })).toThrow('no global describe/it/expect');
    } finally {
      g.describe = saved;
    }
  });
});

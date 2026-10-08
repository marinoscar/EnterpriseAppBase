import { conformanceSuites, formatConformanceSummary, runPlatformConformance } from '../../src/testing';
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

    expect(titles).toEqual(['every @Cron enqueues rather than working', 'platform conformance: suites run and skipped']);
    expect(tests.map((t) => t.name)).toEqual([
      'every @Cron enqueues rather than working > finds the crons at all, so a broken scan cannot pass vacuously',
      'every @Cron enqueues rather than working > queues its work instead of doing it, in every non-exempt cron',
      'platform conformance: suites run and skipped > prints the summary table',
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

  it('makes an opt-out visible: a passing "<id>: skipped by the app (<reason>)" test replaces the suite', async () => {
    const { api, tests, titles } = recordingTestApi();

    runPlatformConformance({
      sourceRoots: [compliantRoot()],
      suites: { cronEnqueueOnly: { skip: 'This fixture app has no crons.' } },
      testApi: api,
    });

    expect(titles).toEqual(['every @Cron enqueues rather than working', 'platform conformance: suites run and skipped']);
    expect(tests.map((t) => t.name)).toEqual([
      'every @Cron enqueues rather than working > cron-enqueue-only: skipped by the app (This fixture app has no crons.)',
      'platform conformance: suites run and skipped > prints the summary table',
    ]);
    expect(await outcome(tests[0])).toBeNull();
  });

  it('throws when a skip has no reason, or is spelled false', () => {
    const { api } = recordingTestApi();
    const run = (value: unknown) => () =>
      runPlatformConformance({ sourceRoots: [compliantRoot()], suites: { cronEnqueueOnly: value } as never, testApi: api });

    expect(run({ skip: '' })).toThrow('skipped without a reason');
    expect(run({ skip: '   ' })).toThrow('skipped without a reason');
    expect(run({})).not.toThrow('skipped without a reason');
    expect(run({ skip: undefined })).toThrow('skipped without a reason');
    expect(run(false)).toThrow("An opt-out needs a reason: `cronEnqueueOnly: { skip: 'why this app does not run it' }`");
  });

  it('prints a summary of the suites run and skipped, with the reasons', async () => {
    const { api, tests } = recordingTestApi();
    const written: string[] = [];
    const write = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });

    try {
      runPlatformConformance({
        sourceRoots: [compliantRoot()],
        suites: {
          cronEnqueueOnly: { exempt: [], minCronFiles: 1 },
          userOwnedData: { skip: 'No Prisma schema in this fixture.' } as never,
        },
        testApi: api,
      });
      const summary = tests.find((t) => t.name.endsWith('prints the summary table'))!;
      expect(await outcome(summary)).toBeNull();
    } finally {
      write.mockRestore();
    }

    const table = written.join('');
    expect(table).toContain('cron-enqueue-only  run');
    expect(table).toContain('user-owned-data    skipped: No Prisma schema in this fixture.');
    expect(table).toContain('1 run, 1 skipped');
  });

  it('formats the summary table', () => {
    expect(
      formatConformanceSummary([
        { id: 'a', status: 'run' },
        { id: 'long-id', status: 'skipped', reason: 'why' },
      ]),
    ).toBe(['suite    status', 'a        run', 'long-id  skipped: why', '1 run, 1 skipped'].join('\n'));
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
    expect(conformanceSuites.ids()).toEqual(['cron-enqueue-only', 'user-owned-data']);
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

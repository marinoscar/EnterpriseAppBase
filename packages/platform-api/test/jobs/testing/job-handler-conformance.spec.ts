// The job handler kit proves a handler against the contract, and fails on a planted violation (PP-14.26).

import { z } from 'zod';

import type { Job, JobHandler } from '../../../src/jobs';
import { createFakeJobQueue, describeJobHandlerConformance, findJobHandlerContractViolations } from '../../../src/jobs/testing';
import type { JobHandlerConformanceOptions } from '../../../src/jobs/testing';
import { outcome, recordingTestApi } from '../../support/conformance-harness';

const NODE_PAIR = { nodeResultSchema: z.object({ ok: z.boolean() }), persistNodeResult: async () => undefined };

const handler = (extra: Partial<JobHandler> = {}): JobHandler => ({ type: 'example.report', label: 'Example report', process: async () => undefined, ...extra });

describe('findJobHandlerContractViolations', () => {
  it('accepts a labelled handler with a bounded two-number profile and a node pair', () => {
    expect(findJobHandlerContractViolations(handler({ profile: { maxRuntimeMs: 60_000, maxAttempts: 3 }, ...NODE_PAIR }))).toEqual([]);
    expect(findJobHandlerContractViolations(handler({ profile: { maxRuntimeMs: 0, maxAttempts: 1 } }))).toEqual([]);
  });

  it.each([
    ['a type that is not dotted', { type: 'Report' }, 'dotted and lower-case'],
    ['a handler without a label', { label: undefined }, 'no label'],
    ['a profile with a third member', { profile: { maxRuntimeMs: 1, maxAttempts: 1, leaseMs: 5 } as never }, 'exactly { maxRuntimeMs, maxAttempts }'],
    ['a profile the worker would ignore', { profile: { maxRuntimeMs: -1, maxAttempts: 0 } }, 'unusable'],
    ['a runtime in the wrong unit', { profile: { maxRuntimeMs: 90_000_000, maxAttempts: 1 } }, 'above the 86400000 ms ceiling'],
    ['an attempt budget above the ceiling', { profile: { maxRuntimeMs: 1, maxAttempts: 11 } }, 'above the ceiling of 10'],
    ['a fractional attempt budget', { profile: { maxRuntimeMs: 1, maxAttempts: 2.5 } }, 'whole number'],
    ['a schema without persistNodeResult', { nodeResultSchema: z.object({}) }, 'without persistNodeResult'],
    ['persistNodeResult without a schema', { persistNodeResult: async () => undefined }, 'without nodeResultSchema'],
    ['an ai.* type that is node-eligible', { type: 'ai.thing.run', ...NODE_PAIR }, 'server-only, permanently'],
    ['an ai.* type with a secret broker', { type: 'ai.thing.run', nodeSecretBroker: { kind: 'x.y' } as never }, 'nodeSecretBroker'],
    ['a canDelete that is not a function', { canDelete: 'no' as never }, 'canDelete must be a function'],
  ] as Array<[string, Partial<JobHandler>, string]>)('names %s', (_name, extra, fragment) => {
    const problems = findJobHandlerContractViolations(handler(extra));

    expect(problems.some((problem) => problem.includes(fragment))).toBe(true);
  });

  it('honours the ceilings and the label opt-out the caller sets', () => {
    expect(findJobHandlerContractViolations(handler({ profile: { maxRuntimeMs: 100_000, maxAttempts: 20 } }), { maxRuntimeCeilingMs: 200_000, maxAttemptsCeiling: 20 })).toEqual([]);
    expect(findJobHandlerContractViolations(handler({ label: undefined }), { allowUnlabelled: true })).toEqual([]);
  });

  it('accepts a label registered separately with registerJobTypeLabel', () => {
    const queue = createFakeJobQueue();
    queue.register(handler({ type: 'example.labelled-elsewhere' }));

    expect(findJobHandlerContractViolations(handler({ type: 'example.labelled-elsewhere', label: undefined }))).toEqual([]);
  });
});

/** An in-memory "world" a handler writes into, standing in for its tables. */
function world() {
  const rows = new Map<string, number>();
  return { rows, snapshot: () => Object.fromEntries(rows) };
}

async function kitFailures(subject: JobHandler | (() => JobHandler), options: JobHandlerConformanceOptions): Promise<Record<string, string>> {
  const { api, tests } = recordingTestApi();
  describeJobHandlerConformance('example.report', subject, { ...options, testApi: api });
  const failures: Record<string, string> = {};
  for (const test of tests) {
    const error = await outcome(test);
    if (error) failures[test.name.replace('Job handler conformance: example.report > ', '')] = error.message;
  }
  return failures;
}

describe('describeJobHandlerConformance', () => {
  it('registers the static case, three cases per succeeding payload, one per failing payload and the canDelete case, and passes a good handler', async () => {
    const w = world();
    const good = (): JobHandler =>
      handler({
        process: async (job: Job) => void w.rows.set(String((job.payload as { id: string }).id), 1),
        canDelete: async (job) => ((job.payload as { pinned?: boolean }).pinned ? 'Pinned by a report' : null),
        profile: { maxRuntimeMs: 30_000, maxAttempts: 2 },
      });
    const { api, tests } = recordingTestApi();
    const options: JobHandlerConformanceOptions = {
      payloads: [
        { name: 'one', payload: { id: 'r1' }, subjectType: 'report', subjectId: 'r1', arrange: () => w.rows.clear(), observe: w.snapshot },
        { name: 'bad', payload: {}, expectFailure: true },
      ],
      canDelete: [{ name: 'free', expected: 'allow' }, { name: 'pinned', job: { payload: { pinned: true } }, expected: 'veto', reasonIncludes: 'Pinned' }],
    };
    describeJobHandlerConformance('example.report', good, { ...options, testApi: api });

    expect(tests.map((test) => test.name.split(' > ')[1])).toEqual([
      expect.stringContaining('honours the static contract'),
      '[one] settles a claimed job as succeeded through the queue',
      '[one] is idempotent: running the same job twice leaves the same result',
      '[one] deduplicates: the same work queued twice is one job in flight, skipDedup is two',
      expect.stringContaining('[bad] fails by throwing'),
      expect.stringContaining('canDelete answers null or a reason'),
    ]);
    // `bad` makes the good handler succeed on an empty payload: the kit must flag it, so run the others only.
    const failures = await kitFailures(good, options);
    expect(Object.keys(failures)).toEqual([expect.stringContaining('[bad] fails by throwing')]);
  });

  it('fails a handler that is not idempotent, with the snapshots in the message', async () => {
    const w = world();
    const failures = await kitFailures(
      () => handler({ process: async () => void w.rows.set('n', (w.rows.get('n') ?? 0) + 1) }),
      { payloads: [{ name: 'counter', payload: {}, arrange: () => w.rows.clear(), observe: w.snapshot }] },
    );

    expect(Object.keys(failures)).toEqual(['[counter] is idempotent: running the same job twice leaves the same result']);
  });

  it('lets an additive-by-design handler say what may differ', async () => {
    const w = world();
    const failures = await kitFailures(
      () => handler({ process: async () => void w.rows.set('n', (w.rows.get('n') ?? 0) + 1) }),
      {
        payloads: [
          {
            name: 'counter',
            payload: {},
            arrange: () => w.rows.clear(),
            observe: w.snapshot,
            assertIdempotent: ({ afterSecond }, expect) => expect(afterSecond).toEqual({ n: 2 }),
          },
        ],
      },
    );

    expect(failures).toEqual({});
  });

  it('fails a handler that swallows an error it was meant to throw, and one whose message is wrong', async () => {
    const swallowing = await kitFailures(handler(), { payloads: [{ name: 'ok', payload: {} }, { name: 'missing', payload: {}, expectFailure: 'not found' }] });
    const wrongMessage = await kitFailures(
      handler({ process: async (job) => ((job.payload as { bad?: boolean }).bad ? Promise.reject(new Error('boom')) : undefined) }),
      { payloads: [{ name: 'ok', payload: {} }, { name: 'missing', payload: { bad: true }, expectFailure: 'not found' }] },
    );

    expect(Object.keys(swallowing)).toEqual(['[missing] fails by throwing, and the queue records the message and retries or fails the job']);
    expect(wrongMessage['[missing] fails by throwing, and the queue records the message and retries or fails the job']).toContain('expected the error to contain "not found"');
  });

  it('fails a handler that throws on a payload it should accept', async () => {
    const failures = await kitFailures(handler({ process: async () => Promise.reject(new Error('cannot')) }), { payloads: [{ name: 'ok', payload: {} }] });

    expect(Object.keys(failures)).toEqual(expect.arrayContaining(['[ok] settles a claimed job as succeeded through the queue']));
  });

  it('flags an org-scoped payload that has no subject', async () => {
    const failures = await kitFailures(handler(), { payloads: [{ name: 'org job', payload: {}, orgId: 'org-1' }] });

    expect(failures['[org job] deduplicates: the same work queued twice is one job in flight, skipDedup is two']).toContain("subjectType 'organization'");
  });

  it('checks a canDelete answer’s shape, and its expectations', async () => {
    const badShape = await kitFailures(handler({ canDelete: async () => '' }), { payloads: [{ name: 'ok', payload: {} }] });
    const wrongExpectation = await kitFailures(handler({ canDelete: async () => 'Nope' }), {
      payloads: [{ name: 'ok', payload: {} }],
      canDelete: [{ name: 'should allow', expected: 'allow' }],
    });

    expect(Object.keys(badShape)).toEqual([expect.stringContaining('canDelete answers null or a reason')]);
    expect(Object.keys(wrongExpectation)).toEqual([expect.stringContaining('canDelete answers null or a reason')]);
  });

  it('refuses a configuration that would pass vacuously', () => {
    const { api } = recordingTestApi();

    expect(() => describeJobHandlerConformance('x', handler(), { payloads: [], testApi: api })).toThrow('at least one payload');
    expect(() => describeJobHandlerConformance('x', handler(), { payloads: [{ name: 'only bad', expectFailure: true }], testApi: api })).toThrow('succeeds on');
  });
});

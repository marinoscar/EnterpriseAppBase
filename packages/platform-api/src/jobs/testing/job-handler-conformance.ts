// =============================================================================
// The job handler conformance kit (PP-14.26)
// =============================================================================
//
// A job handler is a contract the queue relies on without ever reading the
// handler's file: a permanent `type`, an optional execution profile of exactly two
// numbers, node eligibility DERIVED from two members, `ai.*` types that never leave
// the server, a label, an optional veto on delete, and a `process` that throws to
// fail and survives running twice (the queue is at-least-once). Until this kit the
// only suite in `jobs/testing` was `on-event-no-io`, which scans listener bodies and
// proves nothing about a handler.
//
// TWO ENTRY POINTS
//   - `findJobHandlerContractViolations(handler, options)`: PURE, no runner. The
//     static half of the contract. The reference app runs it over every handler its
//     booted registry holds (discovered, never listed).
//   - `describeJobHandlerConformance(name, subject, options)`: registers the cases
//     for ONE handler, including the behavioural ones over the payloads the author
//     supplies: it settles through `createFakeJobQueue`, is safe to run twice, fails
//     by throwing, collapses duplicates, and honours `canDelete`.
//
// Runner-agnostic like the Doctor kit: it registers on a `ConformanceTestApi`,
// defaulting to the runner's globals, and uses only the shared matcher subset.
// =============================================================================

import type { ConformanceTestApi } from '../../testing/index';
import { resolveConformanceTestApi } from '../../testing/index';
import type { Job, JobReason, JobsInputJsonValue } from '../data/jobs-db';
import { resolveJobProfile } from '../job-execution-profile';
import type { JobHandler } from '../job-handler.interface';
import { jobTypeLabel } from '../job-type-label';
import { createFakeJobQueue } from './fake-job-queue';
import type { FakeJobQueue } from './fake-job-queue';

/** The shape of a job type: dotted, lower-case, at least two segments (`storage.object.process`, `admin.factory_reset`). */
const JOB_TYPE_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/;

/** The default ceilings of a declared profile: a day, ten attempts. */
const DEFAULT_MAX_RUNTIME_CEILING_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS_CEILING = 10;

/**
 * What {@link findJobHandlerContractViolations} accepts.
 *
 * @stability experimental
 */
export interface JobHandlerContractOptions {
  /** The largest `profile.maxRuntimeMs` accepted (default 24 hours): a longer ceiling is almost always a typo in the unit. */
  readonly maxRuntimeCeilingMs?: number;
  /** The largest `profile.maxAttempts` accepted (default 10). */
  readonly maxAttemptsCeiling?: number;
  /**
   * Accept a handler with no `label` (the admin list then shows the type string).
   * Default false: a type needs a label, its own or one from `registerJobTypeLabel`.
   */
  readonly allowUnlabelled?: boolean;
}

/**
 * The static contract of a job handler, as one sentence per violation.
 *
 * Checks: a dotted lower-case `type`; a label; a profile that is usable, carries
 * exactly `maxRuntimeMs` and `maxAttempts` (never a lease or a heartbeat) and stays
 * inside the ceilings; `nodeResultSchema` and `persistNodeResult` both present or
 * both absent (eligibility is derived from the pair); an `ai.*` type with neither
 * and no `nodeSecretBroker` (AI job types are server-only, permanently); a
 * `canDelete` that is a function.
 *
 * @param handler - the handler, registered or not.
 * @param options - ceilings and the label rule.
 * @returns the violations; empty means the handler honours the contract.
 *
 * @example
 * ```ts
 * expect(findJobHandlerContractViolations(handler)).toEqual([]);
 * ```
 *
 * @stability experimental
 */
export function findJobHandlerContractViolations(handler: JobHandler, options: JobHandlerContractOptions = {}): string[] {
  const problems: string[] = [];
  const type = typeof handler.type === 'string' ? handler.type : '';
  const label = type === '' ? '(no type)' : type;

  if (!JOB_TYPE_PATTERN.test(type)) {
    problems.push(`${label}: the type must be dotted and lower-case with at least two segments, like "storage.object.process" (it is permanent once jobs of it exist)`);
  }

  const ownLabel = typeof handler.label === 'string' && handler.label.trim() !== '';
  if (!options.allowUnlabelled && type !== '' && !ownLabel && jobTypeLabel(type) === type) {
    problems.push(`${label}: no label. Declare \`readonly label\` on the handler (or registerJobTypeLabel) so the admin job list shows a phrase, not the type string`);
  }

  if (typeof handler.process !== 'function') problems.push(`${label}: process must be a function`);

  if (handler.profile !== undefined) {
    const profile = handler.profile as unknown as Record<string, unknown>;
    const extra = Object.keys(profile).filter((key) => key !== 'maxRuntimeMs' && key !== 'maxAttempts');
    if (extra.length > 0) {
      problems.push(`${label}: the profile declares ${extra.join(', ')}; a profile is exactly { maxRuntimeMs, maxAttempts } (the lease and the renewal interval are derived)`);
    }
    if (resolveJobProfile(handler) === undefined) {
      problems.push(`${label}: the profile is unusable and would be ignored (maxRuntimeMs must be a finite number >= 0, maxAttempts a finite number >= 1)`);
    } else {
      const runtimeCeiling = options.maxRuntimeCeilingMs ?? DEFAULT_MAX_RUNTIME_CEILING_MS;
      const attemptsCeiling = options.maxAttemptsCeiling ?? DEFAULT_MAX_ATTEMPTS_CEILING;
      if (handler.profile.maxRuntimeMs > runtimeCeiling) {
        problems.push(`${label}: profile.maxRuntimeMs ${handler.profile.maxRuntimeMs} is above the ${runtimeCeiling} ms ceiling (is it seconds written as milliseconds?)`);
      }
      if (!Number.isInteger(handler.profile.maxAttempts)) problems.push(`${label}: profile.maxAttempts must be a whole number`);
      if (handler.profile.maxAttempts > attemptsCeiling) {
        problems.push(`${label}: profile.maxAttempts ${handler.profile.maxAttempts} is above the ceiling of ${attemptsCeiling}`);
      }
    }
  }

  const hasSchema = handler.nodeResultSchema !== undefined;
  const hasPersist = handler.persistNodeResult !== undefined;
  if (hasSchema !== hasPersist) {
    problems.push(
      `${label}: carries ${hasSchema ? 'nodeResultSchema' : 'persistNodeResult'} without ${hasSchema ? 'persistNodeResult' : 'nodeResultSchema'}; ` +
        'node eligibility is derived from the pair, so give both (eligible) or neither (server-only)',
    );
  }
  if (hasPersist && typeof handler.persistNodeResult !== 'function') problems.push(`${label}: persistNodeResult must be a function`);

  if (type.startsWith('ai.')) {
    if (hasSchema || hasPersist) problems.push(`${label}: an ai.* job type is server-only, permanently: it must carry neither nodeResultSchema nor persistNodeResult`);
    if (handler.nodeSecretBroker !== undefined) problems.push(`${label}: an ai.* job type must not carry a nodeSecretBroker: a provider key never reaches a node`);
  }

  if (handler.canDelete !== undefined && typeof handler.canDelete !== 'function') problems.push(`${label}: canDelete must be a function`);

  return problems;
}

/**
 * One payload to exercise a handler with.
 *
 * @stability experimental
 */
export interface JobPayloadScenario {
  /** The scenario's name, shown in every test title. */
  readonly name: string;
  /** The job payload (identifiers, not copies of data). */
  readonly payload?: JobsInputJsonValue | null;
  /** The job's subject type; with `subjectId`, what dedup collapses on. */
  readonly subjectType?: string | null;
  /** The job's subject id. */
  readonly subjectId?: string | null;
  /** The organization the job belongs to; an org-scoped job without a natural subject uses `subjectType: 'organization'`, `subjectId: orgId`. */
  readonly orgId?: string | null;
  /** The job's reason (default `rerun`). */
  readonly reason?: JobReason;
  /** Resets the handler's fake world; runs before each test that uses this scenario. */
  arrange?(): void | Promise<void>;
  /**
   * A snapshot of everything the handler wrote (rows, objects, calls), taken after
   * a run. Without it the idempotency case can only prove that a second run does
   * not throw; with it, the two snapshots must be equal (or satisfy `assertIdempotent`).
   */
  observe?(): unknown | Promise<unknown>;
  /** A custom assertion over the snapshots after the first and the second run (an additive-by-design handler says what may differ). */
  assertIdempotent?(snapshots: { afterFirst: unknown; afterSecond: unknown }, expect: ConformanceTestApi['expect']): void | Promise<void>;
  /**
   * The handler must FAIL on this payload by throwing: `true`, or a substring of
   * the message. The scenario then skips the success and idempotency cases.
   */
  readonly expectFailure?: true | string;
}

/**
 * One `canDelete` expectation.
 *
 * @stability experimental
 */
export interface JobCanDeleteScenario {
  /** The expectation's name. */
  readonly name: string;
  /** Fields of the job row to ask about (default: a pending job of the handler's type with an empty payload). */
  readonly job?: Partial<Job>;
  /** `allow` when `canDelete` returns `null`, `veto` when it returns a reason. */
  readonly expected: 'allow' | 'veto';
  /** For a veto, a substring of the reason. */
  readonly reasonIncludes?: string;
  /** Resets the handler's fake world. */
  arrange?(): void | Promise<void>;
}

/**
 * What {@link describeJobHandlerConformance} accepts.
 *
 * @example
 * ```ts
 * describeJobHandlerConformance('report.build', () => new ReportHandler(fakeRepo), {
 *   payloads: [
 *     { name: 'one report', payload: { reportId: 'r1' }, subjectType: 'report', subjectId: 'r1', observe: () => fakeRepo.snapshot() },
 *     { name: 'a missing report', payload: { reportId: 'nope' }, expectFailure: 'not found' },
 *   ],
 * });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface JobHandlerConformanceOptions extends JobHandlerContractOptions {
  /** The payloads to exercise the handler with; at least one that succeeds. */
  readonly payloads: readonly JobPayloadScenario[];
  /** `canDelete` expectations; without them only the shape of the answer is checked. */
  readonly canDelete?: readonly JobCanDeleteScenario[];
  /** The queue to run on (default a fresh `createFakeJobQueue()` per test). */
  readonly createQueue?: () => FakeJobQueue;
  /** A test API to register on; defaults to the runner's globals. */
  readonly testApi?: ConformanceTestApi;
}

/** The job row a `canDelete` expectation asks about: a pending job of the handler's type, as the admin delete meets one. */
function deletableJobOf(handler: JobHandler, overrides: Partial<Job> | undefined): Job {
  const at = new Date(0);
  return {
    id: 'job-can-delete',
    type: handler.type,
    subjectType: null,
    subjectId: null,
    dedupKey: null,
    status: 'pending',
    reason: 'rerun',
    priority: 0,
    providerKey: null,
    modelVersion: null,
    payload: {},
    attempts: 0,
    lastError: null,
    createdAt: at,
    startedAt: null,
    finishedAt: null,
    scheduledFor: null,
    rateLimitedAt: null,
    rateLimitHits: 0,
    claimedByNodeId: null,
    leaseExpiresAt: null,
    executor: null,
    claimToken: null,
    traceContext: null,
    orgId: null,
    ...overrides,
  };
}

/**
 * Registers the conformance cases for one job handler: the static contract, then
 * for each payload a settle through the fake queue, a double run, a failure by
 * throwing, dedup, and `canDelete`.
 *
 * @param name - the handler's type or a title for the `describe` block.
 * @param subject - the handler, or a factory called once per test so state never leaks.
 * @param options - the payloads and expectations.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function describeJobHandlerConformance(
  name: string,
  subject: JobHandler | (() => JobHandler | Promise<JobHandler>),
  options: JobHandlerConformanceOptions,
): void {
  const api = resolveConformanceTestApi('describeJobHandlerConformance', options.testApi);
  const build = async (): Promise<JobHandler> => (typeof subject === 'function' ? await subject() : subject);
  const newQueue = (): FakeJobQueue => (options.createQueue ?? createFakeJobQueue)();

  if (options.payloads.length === 0) {
    throw new Error('describeJobHandlerConformance: pass at least one payload scenario; the behavioural cases need something to run.');
  }
  if (!options.payloads.some((scenario) => scenario.expectFailure === undefined)) {
    throw new Error('describeJobHandlerConformance: pass at least one payload the handler succeeds on, so the success and idempotency cases are not vacuous.');
  }

  const jobFor = async (queue: FakeJobQueue, handler: JobHandler, scenario: JobPayloadScenario, skipDedup = true): Promise<Job> =>
    queue.enqueue({
      type: handler.type,
      reason: scenario.reason ?? 'rerun',
      subjectType: scenario.subjectType,
      subjectId: scenario.subjectId,
      payload: scenario.payload,
      orgId: scenario.orgId,
      skipDedup,
    });

  api.describe(`Job handler conformance: ${name}`, () => {
    api.it('honours the static contract: a dotted type, a label, a two-number profile, a derived node eligibility, ai.* server-only', async () => {
      api.expect(findJobHandlerContractViolations(await build(), options)).toEqual([]);
    });

    for (const scenario of options.payloads) {
      if (scenario.expectFailure !== undefined) {
        api.it(`[${scenario.name}] fails by throwing, and the queue records the message and retries or fails the job`, async () => {
          await scenario.arrange?.();
          const handler = await build();
          const queue = newQueue();
          queue.register(handler);
          await jobFor(queue, handler, scenario);

          const run = await queue.runNext();
          api.expect(run?.outcome === 'succeeded' ? ['the handler succeeded; it must throw on this payload'] : []).toEqual([]);
          if (typeof scenario.expectFailure === 'string') {
            api.expect(run?.error?.includes(scenario.expectFailure) ? [] : [`expected the error to contain "${scenario.expectFailure}", got "${run?.error ?? ''}"`]).toEqual([]);
          }
          api.expect(typeof run?.job.lastError === 'string' && run.job.lastError.length > 0 ? [] : ['lastError was not recorded']).toEqual([]);
        });
        continue;
      }

      api.it(`[${scenario.name}] settles a claimed job as succeeded through the queue`, async () => {
        await scenario.arrange?.();
        const handler = await build();
        const queue = newQueue();
        queue.register(handler);
        const job = await jobFor(queue, handler, scenario);

        const run = await queue.runNext();
        api.expect(run?.job.id).toEqual(job.id);
        api.expect(run?.outcome === 'succeeded' ? [] : [`outcome ${run?.outcome ?? 'none'}: ${run?.error ?? ''}`]).toEqual([]);
      });

      api.it(`[${scenario.name}] is idempotent: running the same job twice leaves the same result`, async () => {
        await scenario.arrange?.();
        const handler = await build();
        const queue = newQueue();
        const job = await jobFor(queue, handler, scenario);

        await handler.process(job);
        const afterFirst = await scenario.observe?.();
        await handler.process(job);
        const afterSecond = await scenario.observe?.();

        if (scenario.assertIdempotent) await scenario.assertIdempotent({ afterFirst, afterSecond }, api.expect);
        else api.expect(afterSecond).toEqual(afterFirst);
      });

      api.it(`[${scenario.name}] deduplicates: the same work queued twice is one job in flight, skipDedup is two`, async () => {
        const handler = await build();
        const queue = newQueue();
        const first = await jobFor(queue, handler, scenario, false);
        const second = await jobFor(queue, handler, scenario, false);
        api.expect(second.id).toEqual(first.id);
        api.expect(queue.jobs({ type: handler.type }).length).toEqual(1);

        await jobFor(queue, handler, scenario, true);
        api.expect(queue.jobs({ type: handler.type }).length).toEqual(2);

        const orgWithoutSubject = typeof scenario.orgId === 'string' && (scenario.subjectType ?? null) === null;
        api.expect(orgWithoutSubject ? [`an org-scoped job needs a subject: use subjectType 'organization', subjectId '${scenario.orgId}' so two organizations' jobs never collapse`] : []).toEqual([]);
      });
    }

    api.it('canDelete answers null or a reason without throwing, and the queue respects the answer', async () => {
      const handler = await build();
      if (handler.canDelete === undefined) return;

      const expectations: readonly JobCanDeleteScenario[] = options.canDelete?.length ? options.canDelete : [{ name: 'a pending job', expected: 'allow' as const }];
      const shapeOnly = !options.canDelete?.length;

      for (const expectation of expectations) {
        await expectation.arrange?.();
        const queue = newQueue();
        queue.register(handler);
        const row = deletableJobOf(handler, expectation.job);
        const answer = await handler.canDelete(row);
        api.expect(answer === null || (typeof answer === 'string' && answer.trim() !== '') ? [] : [`${expectation.name}: canDelete must return null or a non-empty reason, got ${JSON.stringify(answer)}`]).toEqual([]);

        if (shapeOnly) continue;
        api.expect(answer === null ? 'allow' : 'veto').toEqual(expectation.expected);
        if (expectation.expected === 'veto' && expectation.reasonIncludes) {
          api.expect(answer?.includes(expectation.reasonIncludes) ? [] : [`${expectation.name}: expected the reason to contain "${expectation.reasonIncludes}", got "${String(answer)}"`]).toEqual([]);
        }
      }

      // The queue consults the handler the way the admin service does.
      const queue = newQueue();
      queue.register(handler);
      const queued = await queue.enqueue({ type: handler.type, reason: 'rerun', skipDedup: true });
      const stored = queue.get(queued.id);
      if (stored) {
        const decision = await queue.deleteJob(stored.id);
        const reason = await handler.canDelete(stored);
        api.expect(decision.deleted).toEqual(reason === null);
        api.expect(decision.reason).toEqual(reason);
      }
    });
  });
}

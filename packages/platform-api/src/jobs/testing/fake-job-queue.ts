// =============================================================================
// An in-memory job queue for tests (PP-14.26)
// =============================================================================
//
// What an app's tests need from the queue is rarely the database: they need to
// know that a service enqueued the right job, that the same work collapses onto
// one row while it is in flight, and that the handler registered for the type
// runs, retries and fails the way the worker would make it. The real thing needs
// Postgres for the one property that matters (`jobs_active_dedup_uniq_idx`), so
// the real-database behaviour stays a `*.db.spec.ts`; this double stands in for
// the REST, in the same shape.
//
// WHAT IT KEEPS FAITHFUL
//   - the dedup rule: a job holds `buildDedupKey(type, subjectType, subjectId)`
//     while it is `pending` or `running`, `skipDedup` leaves the key `null`, and a
//     collapsed `enqueue` returns the job already in flight (its `reason`,
//     `priority` and `payload` are the first caller's); `enqueueWithin` refuses
//     with the same unique-violation error the real one propagates;
//   - the claim order: `priority` ascending, then oldest first, and nothing
//     scheduled for the future is claimable;
//   - attempts are charged at claim time, a failure retries until the type's
//     `profile.maxAttempts` (else the default of 3) is spent, then the job is
//     `failed` with `lastError`;
//   - a delete is refused while running, and asks the handler's `canDelete`
//     (a throw refuses it, like the admin service).
//
// WHAT IT DOES NOT DO: leases, the reaper, backoff delays, node claims, trace
// context, metrics, the wake-up bus. A test of those is a test of the worker.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { JobStatus } from '../data/jobs-db';
import type { Job } from '../data/jobs-db';
import { PrismaClientKnownRequestError } from '../data/prisma-runtime';
import { resolveJobProfile } from '../job-execution-profile';
import type { JobHandler } from '../job-handler.interface';
import { JobHandlerRegistry } from '../job-handler.registry';
import { buildDedupKey } from '../job-keys';
import { ACTIVE_DEDUP_INDEX_NAME } from '../jobs.service';
import type { EnqueueJobInput, JobsService } from '../jobs.service';

/** The attempt budget of a type that declares no profile (the shipped `JOBS_MAX_ATTEMPTS`). */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * What {@link createFakeJobQueue} accepts.
 *
 * @stability experimental
 */
export interface FakeJobQueueOptions {
  /** The clock, for `createdAt`, `startedAt` and the scheduled-for check (default `new Date()`). */
  readonly now?: () => Date;
  /** The attempt budget of a type with no `profile` (default 3). */
  readonly defaultMaxAttempts?: number;
  /** The `orgId` an enqueue with none takes (default `null`, a system job). */
  readonly ambientOrgId?: string | null;
}

/**
 * What one {@link FakeJobQueue.runNext} did.
 *
 * @stability experimental
 */
export interface FakeJobRun {
  /** The job after the run. */
  readonly job: Job;
  /** `succeeded`, `retry` (back to `pending`, attempts left), or `failed` (budget spent, or no handler). */
  readonly outcome: 'succeeded' | 'retry' | 'failed';
  /** The error message, when the handler threw or none was registered. */
  readonly error?: string;
}

/**
 * The delete decision, as the admin service makes it.
 *
 * @stability experimental
 */
export interface FakeJobDelete {
  /** Whether the row was removed. */
  readonly deleted: boolean;
  /** Why it was refused: `running`, the handler's reason, or `owner_check_failed`; `null` when deleted. */
  readonly reason: string | null;
}

/**
 * The in-memory queue.
 *
 * @stability experimental
 */
export interface FakeJobQueue {
  /** The real handler registry, so `register` records labels exactly as the app does. */
  readonly registry: JobHandlerRegistry;
  /** Registers a handler (the real `JobHandlerRegistry.register`). */
  register(handler: JobHandler): void;
  /** Queues a job with the real dedup rule; see the file header. */
  enqueue(input: EnqueueJobInput): Promise<Job>;
  /** Queues inside a caller's transaction: a dedup conflict throws a Prisma `P2002` on `jobs_active_dedup_uniq_idx`. The `tx` is ignored. */
  enqueueWithin(tx: unknown, input: EnqueueJobInput): Promise<Job>;
  /** Every job, oldest first, optionally narrowed by type and status. */
  jobs(filter?: { type?: string; status?: JobStatus }): Job[];
  /** One job by id. */
  get(id: string): Job | undefined;
  /** Claims the most urgent claimable job, runs its handler once and settles it; `undefined` when nothing is claimable. */
  runNext(): Promise<FakeJobRun | undefined>;
  /** Runs jobs until none is claimable (or `max`, default 100, runs happened: a handler that always retries). */
  drain(max?: number): Promise<FakeJobRun[]>;
  /** The admin delete decision for a job. */
  deleteJob(id: string): Promise<FakeJobDelete>;
  /** The queue as the `JobsService` a service under test injects (`enqueue`, `enqueueWithin` and a no-op `recordProvider`). */
  asJobsService(): JobsService;
}

/**
 * Builds an in-memory queue with the real dedup rule, claim order and retry
 * budget. Hand `asJobsService()` to the service under test, `register` the
 * handlers, and `drain()` to run them.
 *
 * @param options - the clock and defaults.
 * @returns the queue.
 *
 * @example
 * ```ts
 * const queue = createFakeJobQueue();
 * queue.register(new MyHandler(...));
 * const service = new ReportService(queue.asJobsService());
 *
 * await service.request('r1');
 * await service.request('r1'); // collapsed: one job in flight
 * expect(queue.jobs({ type: 'my.report' })).toHaveLength(1);
 *
 * await queue.drain();
 * expect(queue.get(queue.jobs()[0].id)?.status).toBe('succeeded');
 * ```
 *
 * @stability experimental
 */
export function createFakeJobQueue(options: FakeJobQueueOptions = {}): FakeJobQueue {
  const now = options.now ?? (() => new Date());
  const defaultMaxAttempts = options.defaultMaxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const registry = new JobHandlerRegistry();
  const rows: Job[] = [];

  const isActive = (job: Job): boolean => job.status === JobStatus.pending || job.status === JobStatus.running;

  const dedupKeyOf = (input: EnqueueJobInput): string | null =>
    input.skipDedup ? null : buildDedupKey(input.type, input.subjectType, input.subjectId);

  const create = (input: EnqueueJobInput, dedupKey: string | null): Job => {
    const job: Job = {
      id: randomUUID(),
      type: input.type,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      dedupKey,
      status: JobStatus.pending,
      reason: input.reason,
      priority: input.priority ?? 0,
      providerKey: null,
      modelVersion: null,
      payload: (input.payload ?? {}) as Job['payload'],
      attempts: 0,
      lastError: null,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      scheduledFor: input.scheduledFor ?? null,
      rateLimitedAt: null,
      rateLimitHits: 0,
      claimedByNodeId: null,
      leaseExpiresAt: null,
      executor: null,
      claimToken: null,
      traceContext: null,
      orgId: input.orgId !== undefined ? input.orgId : (options.ambientOrgId ?? null),
    };
    rows.push(job);
    return job;
  };

  const activeHolder = (dedupKey: string | null): Job | undefined =>
    dedupKey === null ? undefined : rows.find((job) => job.dedupKey === dedupKey && isActive(job));

  const conflict = (): PrismaClientKnownRequestError =>
    new PrismaClientKnownRequestError('Unique constraint failed on the fields: (`dedup_key`)', {
      code: 'P2002',
      clientVersion: 'fake-job-queue',
      meta: { target: [ACTIVE_DEDUP_INDEX_NAME] },
    });

  const maxAttemptsOf = (handler: JobHandler | undefined): number => resolveJobProfile(handler)?.maxAttempts ?? defaultMaxAttempts;

  const claimable = (): Job | undefined =>
    rows
      .filter((job) => job.status === JobStatus.pending && (job.scheduledFor === null || job.scheduledFor.getTime() <= now().getTime()))
      .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime())[0];

  const queue: FakeJobQueue = {
    registry,
    register: (handler) => registry.register(handler),

    async enqueue(input) {
      const dedupKey = dedupKeyOf(input);
      return activeHolder(dedupKey) ?? create(input, dedupKey);
    },

    async enqueueWithin(_tx, input) {
      const dedupKey = dedupKeyOf(input);
      if (activeHolder(dedupKey)) throw conflict();
      return create(input, dedupKey);
    },

    jobs: (filter) => rows.filter((job) => (!filter?.type || job.type === filter.type) && (!filter?.status || job.status === filter.status)),

    get: (id) => rows.find((job) => job.id === id),

    async runNext() {
      const job = claimable();
      if (!job) return undefined;

      job.status = JobStatus.running;
      job.attempts += 1;
      job.startedAt = now();
      job.executor = 'server';

      const handler = registry.get(job.type);
      const settle = (status: Job['status'], error?: string): void => {
        job.status = status;
        job.lastError = error ?? null;
        job.finishedAt = status === JobStatus.pending ? null : now();
        job.executor = null;
      };

      if (!handler) {
        const error = `No handler is registered for job type "${job.type}"`;
        settle(JobStatus.failed, error);
        return { job, outcome: 'failed', error };
      }

      try {
        await handler.process(job);
        settle(JobStatus.succeeded);
        return { job, outcome: 'succeeded' };
      } catch (caught) {
        const error = caught instanceof Error ? caught.message : String(caught);
        if (job.attempts >= maxAttemptsOf(handler)) {
          settle(JobStatus.failed, error);
          return { job, outcome: 'failed', error };
        }
        settle(JobStatus.pending, error);
        return { job, outcome: 'retry', error };
      }
    },

    async drain(max = 100) {
      const runs: FakeJobRun[] = [];
      while (runs.length < max) {
        const run = await queue.runNext();
        if (!run) break;
        runs.push(run);
      }
      return runs;
    },

    async deleteJob(id) {
      const job = rows.find((candidate) => candidate.id === id);
      if (!job) return { deleted: false, reason: 'not_found' };
      if (job.status === JobStatus.running) return { deleted: false, reason: 'running' };

      const handler = registry.get(job.type);
      if (handler?.canDelete) {
        let reason: string | null;
        try {
          reason = await handler.canDelete(job);
        } catch {
          return { deleted: false, reason: 'owner_check_failed' };
        }
        if (reason !== null) return { deleted: false, reason };
      }

      rows.splice(rows.indexOf(job), 1);
      return { deleted: true, reason: null };
    },

    asJobsService: () =>
      ({
        enqueue: (input: EnqueueJobInput) => queue.enqueue(input),
        enqueueWithin: (tx: unknown, input: EnqueueJobInput) => queue.enqueueWithin(tx, input),
        recordProvider: async () => undefined,
      }) as unknown as JobsService,
  };

  return queue;
}

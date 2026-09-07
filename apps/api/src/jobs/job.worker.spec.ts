// =============================================================================
// Unit tests for the in-process worker pool (issue #262, epic #254)
// =============================================================================
//
// NO DATABASE, AND NO REAL SLEEPS LONGER THAN A FEW MILLISECONDS. Everything
// this file asserts is a DECISION the worker makes in memory — which types it
// claims for a given mode, what it does with a job whose handler is missing,
// whether a slot is freed when a job overruns, whether a slow job blocks a
// fast one — and every one of those is settled before any SQL exists. The
// claim and the terminal service are stubbed, so what is recorded on those
// stubs IS the assertion.
//
// The lifecycle half — "a handler registering in `onModuleInit` is always
// registered before the first claim" — cannot be asserted here, because it is
// a claim about Nest's phase ordering. It lives in
// `job.worker.bootstrap.spec.ts`, which boots a real module graph.
// =============================================================================

import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Job } from '@prisma/client';
import { z } from 'zod';

import { JobClaimService, ClaimOptions } from './job-claim.service';
import { JobClock } from './job-clock';
import { JobHandler } from './job-handler.interface';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobTerminalService } from './job-terminal.service';
import { JobTimeoutError, JobWorker, resetUnknownWorkerModeWarning } from './job.worker';
import { ProviderThrottleService } from './provider-throttle.service';

/** Every worker setting, with the shipped defaults spelled out rather than imported. */
interface WorkerConfig {
  'jobs.workerMode'?: unknown;
  'jobs.workerConcurrency'?: number;
  'jobs.pollMs'?: number;
  'jobs.jobTimeoutMs'?: number;
  'jobs.systemModeExtraTypes'?: unknown;
}

const DEFAULT_CONFIG: WorkerConfig = {
  'jobs.workerMode': 'all',
  'jobs.workerConcurrency': 1,
  // Long enough that a sleeping loop stays asleep for the whole test unless
  // something wakes it — which is exactly what the shutdown test measures.
  'jobs.pollMs': 60_000,
  'jobs.jobTimeoutMs': 0,
  'jobs.systemModeExtraTypes': [],
};

function stubConfig(values: WorkerConfig): ConfigService {
  const merged = { ...DEFAULT_CONFIG, ...values } as Record<string, unknown>;

  return {
    get: (key: string) => merged[key],
  } as unknown as ConfigService;
}

/** A claimed, running row. Only the fields the worker reads matter. */
function claimedJob(type: string, overrides: Partial<Job> = {}): Job {
  return {
    id: `job-${type}`,
    type,
    status: 'running',
    attempts: 1,
    payload: null,
    ...overrides,
  } as Job;
}

/** A handler whose `process` is whatever the test needs it to be. */
function handler(type: string, process: () => Promise<void>): JobHandler {
  return { type, process };
}

/** A NODE-ELIGIBLE handler: it carries BOTH optional members (§2). */
function nodeEligibleHandler(type: string): JobHandler {
  return {
    type,
    process: async () => undefined,
    nodeResultSchema: z.object({ ok: z.boolean() }),
    persistNodeResult: async () => undefined,
  };
}

/** Lets the event loop drain — enough turns for pending timers set to 0/1ms. */
async function drain(turns = 4): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Polls `predicate` on real time, up to `timeoutMs`. */
async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out');
    }

    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

interface Harness {
  worker: JobWorker;
  registry: JobHandlerRegistry;
  claim: jest.Mock;
  completeSucceeded: jest.Mock;
  completeFailed: jest.Mock;
  acquire: jest.Mock;
  warn: jest.SpyInstance;
  error: jest.SpyInstance;
}

function makeWorker(config: WorkerConfig = {}, throttle?: ProviderThrottleService): Harness {
  const registry = new JobHandlerRegistry();

  const claim = jest.fn().mockResolvedValue([] as Job[]);
  const completeSucceeded = jest.fn().mockResolvedValue('succeeded');
  const completeFailed = jest.fn().mockResolvedValue('failed');
  const acquire = jest.fn().mockResolvedValue(0);

  const worker = new JobWorker(
    stubConfig(config),
    registry,
    { claim } as unknown as JobClaimService,
    { completeSucceeded, completeFailed } as unknown as JobTerminalService,
    throttle ?? ({ acquire } as unknown as ProviderThrottleService)
  );

  return {
    worker,
    registry,
    claim,
    completeSucceeded,
    completeFailed,
    acquire,
    warn: jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
    error: jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
  };
}

describe('JobWorker', () => {
  beforeEach(() => {
    // The unknown-mode latch is MODULE level (so a typo warns once rather
    // than once per poll), which means it survives between cases. Left
    // un-reset, "warns exactly once" would pass vacuously for every case
    // after the first — the opposite of what that test is for.
    resetUnknownWorkerModeWarning();

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // The lifecycle hook, structurally. The behavioural proof is in
  // job.worker.bootstrap.spec.ts; this is the cheap guard against someone
  // renaming the hook back.
  // ---------------------------------------------------------------------------

  describe('lifecycle phase', () => {
    it('implements onApplicationBootstrap and deliberately NOT onModuleInit', () => {
      const prototype = JobWorker.prototype as unknown as Record<string, unknown>;

      expect(typeof prototype.onApplicationBootstrap).toBe('function');
      // Handlers register in THEIR onModuleInit; a worker with this hook
      // would be racing them. See job-handler.registry.ts.
      expect(prototype.onModuleInit).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Worker modes
  // ---------------------------------------------------------------------------

  describe('worker modes', () => {
    it('"all" claims every registered type, node-eligible ones included', () => {
      const { worker, registry } = makeWorker({ 'jobs.workerMode': 'all' });

      registry.register(handler('test.server-only', async () => undefined));
      registry.register(nodeEligibleHandler('test.node-eligible'));

      expect(worker.mode()).toBe('all');
      expect(worker.eligibleTypes().sort()).toEqual(
        ['test.node-eligible', 'test.server-only'].sort()
      );
    });

    it('"system" claims only what a node could never run', () => {
      const { worker, registry } = makeWorker({ 'jobs.workerMode': 'system' });

      registry.register(handler('test.server-only', async () => undefined));
      registry.register(nodeEligibleHandler('test.node-eligible'));

      expect(worker.mode()).toBe('system');
      expect(worker.eligibleTypes()).toEqual(['test.server-only']);
    });

    it('"off" starts no pool at all: nothing is ever claimed', async () => {
      const { worker, registry, claim } = makeWorker({
        'jobs.workerMode': 'off',
        'jobs.workerConcurrency': 4,
      });

      registry.register(handler('test.server-only', async () => undefined));

      worker.onApplicationBootstrap();
      await drain();

      expect(claim).not.toHaveBeenCalled();
      expect(worker.eligibleTypes()).toEqual([]);

      await worker.onModuleDestroy();
    });

    it('is case- and whitespace-insensitive about the configured value', () => {
      const { worker } = makeWorker({ 'jobs.workerMode': '  SYSTEM ' });

      expect(worker.mode()).toBe('system');
    });

    it('falls open to "all" on an unrecognised value rather than stopping work', () => {
      const { worker, registry } = makeWorker({ 'jobs.workerMode': 'sytem' });

      registry.register(handler('test.server-only', async () => undefined));
      registry.register(nodeEligibleHandler('test.node-eligible'));

      expect(worker.mode()).toBe('all');
      // The whole point of failing open: a typo must not silently stop the
      // node-eligible half of the queue.
      expect(worker.eligibleTypes()).toHaveLength(2);
    });

    it('warns EXACTLY ONCE about an unrecognised value, however often it is read', () => {
      const { worker, warn } = makeWorker({ 'jobs.workerMode': 'sytem' });

      for (let index = 0; index < 50; index += 1) {
        worker.mode();
      }

      const unknownModeWarnings = warn.mock.calls.filter((call) =>
        String(call[0]).includes('Unrecognised JOBS_WORKER_MODE')
      );

      expect(unknownModeWarnings).toHaveLength(1);
      expect(String(unknownModeWarnings[0][0])).toContain('sytem');
      expect(String(unknownModeWarnings[0][0])).toContain('all');
    });

    it('latches that warning at MODULE level, so a second worker stays quiet', () => {
      const first = makeWorker({ 'jobs.workerMode': 'nonsense' });
      first.worker.mode();

      const countUnknownModeWarnings = (): number =>
        first.warn.mock.calls.filter((call) =>
          String(call[0]).includes('Unrecognised JOBS_WORKER_MODE')
        ).length;

      expect(countUnknownModeWarnings()).toBe(1);

      // A SECOND worker instance, sharing nothing but the module-level latch.
      // (Both harnesses observe the same `Logger.prototype.warn` spy — Jest
      // returns the existing mock when a method is already spied on.)
      const second = makeWorker({ 'jobs.workerMode': 'nonsense' });
      second.worker.mode();

      // Still one across BOTH workers, not one each: the latch is why
      // re-reading the mode on every claim does not bury the log.
      expect(countUnknownModeWarnings()).toBe(1);
    });

    it('treats a missing setting as "all"', () => {
      const { worker, registry } = makeWorker({ 'jobs.workerMode': undefined });

      registry.register(nodeEligibleHandler('test.node-eligible'));

      expect(worker.mode()).toBe('all');
      expect(worker.eligibleTypes()).toEqual(['test.node-eligible']);
    });
  });

  // ---------------------------------------------------------------------------
  // JOBS_SYSTEM_MODE_EXTRA_TYPES
  // ---------------------------------------------------------------------------

  describe('systemModeEligibleTypes', () => {
    it('adds a registered node-eligible type named in the extras', () => {
      const { worker, registry } = makeWorker({
        'jobs.workerMode': 'system',
        'jobs.systemModeExtraTypes': ['test.node-eligible'],
      });

      registry.register(handler('test.server-only', async () => undefined));
      registry.register(nodeEligibleHandler('test.node-eligible'));

      expect(worker.systemModeEligibleTypes().sort()).toEqual(
        ['test.node-eligible', 'test.server-only'].sort()
      );
    });

    it('accepts a raw comma-separated string as well as a parsed list', () => {
      const { worker, registry } = makeWorker({
        'jobs.workerMode': 'system',
        'jobs.systemModeExtraTypes': ' test.node-eligible , ',
      });

      registry.register(nodeEligibleHandler('test.node-eligible'));

      expect(worker.systemModeEligibleTypes()).toEqual(['test.node-eligible']);
    });

    it('does not duplicate a type that is already server-only', () => {
      const { worker, registry } = makeWorker({
        'jobs.workerMode': 'system',
        'jobs.systemModeExtraTypes': ['test.server-only'],
      });

      registry.register(handler('test.server-only', async () => undefined));

      expect(worker.systemModeEligibleTypes()).toEqual(['test.server-only']);
    });

    it('DROPS an entry no handler registers, with a warning', () => {
      const { worker, registry, warn } = makeWorker({
        'jobs.workerMode': 'system',
        'jobs.systemModeExtraTypes': ['test.typo'],
      });

      registry.register(handler('test.server-only', async () => undefined));

      // Claiming a type with no handler is not harmless: the claim succeeds
      // and the job is then failed permanently.
      expect(worker.systemModeEligibleTypes()).toEqual(['test.server-only']);

      const dropped = warn.mock.calls.filter((call) =>
        String(call[0]).includes('JOBS_SYSTEM_MODE_EXTRA_TYPES')
      );

      expect(dropped).toHaveLength(1);
      expect(String(dropped[0][0])).toContain('test.typo');
    });

    it('warns about a dropped entry once per type, not once per claim', () => {
      const { worker, warn } = makeWorker({
        'jobs.workerMode': 'system',
        'jobs.systemModeExtraTypes': ['test.typo'],
      });

      for (let index = 0; index < 20; index += 1) {
        worker.systemModeEligibleTypes();
      }

      expect(
        warn.mock.calls.filter((call) =>
          String(call[0]).includes('JOBS_SYSTEM_MODE_EXTRA_TYPES')
        )
      ).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Claiming
  // ---------------------------------------------------------------------------

  describe('claiming', () => {
    it('claims ONE row at a time, as the server, with no node id', async () => {
      const { worker, registry, claim } = makeWorker({
        'jobs.workerConcurrency': 1,
        'jobs.jobTimeoutMs': 30_000,
      });

      registry.register(handler('test.echo', async () => undefined));

      worker.start(1);
      await waitFor(() => claim.mock.calls.length > 0);
      await worker.stop();

      const options = claim.mock.calls[0][0] as ClaimOptions;

      expect(options.limit).toBe(1);
      expect(options.executor).toBe('server');
      expect(options.nodeId).toBeNull();
      expect(options.eligibleTypes).toEqual(['test.echo']);
      // The lease is DERIVED from the timeout so it cannot be configured
      // shorter than the run it has to outlive.
      expect(options.leaseMs).toBeGreaterThan(30_000);
    });

    it('re-resolves eligible types per claim rather than capturing them at start', async () => {
      const { worker, registry, claim } = makeWorker({
        'jobs.workerConcurrency': 1,
        'jobs.pollMs': 5,
      });

      registry.register(handler('test.first', async () => undefined));

      worker.start(1);
      await waitFor(() => claim.mock.calls.length >= 1);

      // A handler registered AFTER the pool started — the situation a
      // bootstrap-time capture would never see.
      registry.register(handler('test.second', async () => undefined));

      await waitFor(() =>
        claim.mock.calls.some((call) =>
          (call[0] as ClaimOptions).eligibleTypes.includes('test.second')
        )
      );

      await worker.stop();
    });

    it('backs off instead of spinning when the claim query itself fails', async () => {
      const { worker, claim, error } = makeWorker({
        'jobs.workerConcurrency': 1,
        'jobs.pollMs': 5,
      });

      claim.mockRejectedValue(new Error('connection terminated'));

      worker.start(1);
      await waitFor(() => error.mock.calls.length >= 1);
      await worker.stop();

      expect(String(error.mock.calls[0][0])).toContain('connection terminated');
    });
  });

  // ---------------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------------

  describe('runJob', () => {
    it('settles a successful job through completeSucceeded, never by writing a row', async () => {
      const { worker, registry, completeSucceeded, completeFailed } = makeWorker();

      const ran = jest.fn();
      registry.register(
        handler('test.echo', async () => {
          ran();
        })
      );

      const job = claimedJob('test.echo');

      await expect(worker.runJob(job)).resolves.toBe('succeeded');

      expect(ran).toHaveBeenCalledTimes(1);
      expect(completeSucceeded).toHaveBeenCalledWith(job);
      expect(completeFailed).not.toHaveBeenCalled();
    });

    it('routes a thrown handler error through completeFailed unchanged', async () => {
      const { worker, registry, completeFailed, completeSucceeded } = makeWorker();

      const boom = new Error('handler exploded');
      registry.register(
        handler('test.echo', async () => {
          throw boom;
        })
      );

      const job = claimedJob('test.echo');

      await expect(worker.runJob(job)).resolves.toBe('failed');

      // No `permanent` flag: an ordinary failure must keep its retry budget.
      expect(completeFailed).toHaveBeenCalledWith(job, boom);
      expect(completeSucceeded).not.toHaveBeenCalled();
    });

    it('waits out a provider cooldown before running the handler', async () => {
      const slept: number[] = [];
      let current = 1_000;

      const clock: JobClock = {
        now: () => current,
        sleep: async (ms: number) => {
          slept.push(ms);
          current += ms;
        },
      };

      // The REAL gate, so this proves the worker and the throttle agree
      // rather than proving a mock.
      const throttle = new ProviderThrottleService(
        { get: () => 900_000 } as unknown as ConfigService,
        clock
      );

      const { worker, registry } = makeWorker({}, throttle);

      throttle.registerProviderKey('test.provider', 'acme');
      throttle.trip('test.provider', 20_000);

      const ran = jest.fn();
      registry.register(
        handler('test.provider', async () => {
          ran();
        })
      );

      await expect(worker.runJob(claimedJob('test.provider'))).resolves.toBe('succeeded');

      expect(slept).toEqual([20_000]);
      expect(ran).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // A claimed job with no handler
  // ---------------------------------------------------------------------------

  describe('a job whose type has no registered handler', () => {
    it('fails it TERMINALLY through the chokepoint, with the claim released', async () => {
      const { worker, completeFailed, completeSucceeded } = makeWorker();

      const job = claimedJob('test.vanished');

      await expect(worker.runJob(job)).resolves.toBe('failed');

      expect(completeSucceeded).not.toHaveBeenCalled();
      expect(completeFailed).toHaveBeenCalledTimes(1);

      const [settledJob, error, opts] = completeFailed.mock.calls[0];

      expect(settledJob).toBe(job);
      expect((error as Error).message).toContain('test.vanished');
      // PERMANENT, not a retry: the next attempt would find the same
      // registry and reach the same conclusion.
      expect(opts).toEqual({ permanent: true });
    });

    it('never calls a handler for a different type', async () => {
      const { worker, registry } = makeWorker();

      const other = jest.fn();
      registry.register(
        handler('test.other', async () => {
          other();
        })
      );

      await worker.runJob(claimedJob('test.vanished'));

      expect(other).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Per-job timeouts
  // ---------------------------------------------------------------------------

  describe('per-job timeouts', () => {
    it('frees the slot promptly and routes the timeout through the normal failure path', async () => {
      const { worker, registry, completeFailed } = makeWorker({ 'jobs.jobTimeoutMs': 20 });

      // Never settles on its own: only the timeout can end this.
      registry.register(handler('test.hang', () => new Promise<void>(() => undefined)));

      const started = Date.now();
      const outcome = await worker.runJob(claimedJob('test.hang'));

      expect(outcome).toBe('failed');
      expect(Date.now() - started).toBeLessThan(1_000);

      const [, error] = completeFailed.mock.calls[0];

      expect(error).toBeInstanceOf(JobTimeoutError);
      expect((error as JobTimeoutError).timeoutMs).toBe(20);
      expect((error as Error).message).toContain('test.hang');
    });

    it('produces NO unhandled rejection when the abandoned work rejects later', async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };

      process.on('unhandledRejection', onUnhandled);

      try {
        const { worker, registry } = makeWorker({ 'jobs.jobTimeoutMs': 20 });

        let rejectWork: (reason: unknown) => void = () => undefined;
        const work = new Promise<void>((_resolve, reject) => {
          rejectWork = reject;
        });

        registry.register(handler('test.hang', () => work));

        await expect(worker.runJob(claimedJob('test.hang'))).resolves.toBe('failed');

        // THE PART A NAIVE Promise.race GETS WRONG: the work promise lost the
        // race, and now — with nobody waiting on it any more — it rejects. If
        // the race did not attach its own reactions, this is an
        // unhandledRejection, which Node's default posture turns into a dead
        // process.
        rejectWork(new Error('the abandoned work failed, much later'));

        await drain(6);

        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });

    it('produces no unhandled rejection when the abandoned work RESOLVES later either', async () => {
      const { worker, registry, completeSucceeded } = makeWorker({ 'jobs.jobTimeoutMs': 20 });

      let finishWork: () => void = () => undefined;
      const work = new Promise<void>((resolve) => {
        finishWork = resolve;
      });

      registry.register(handler('test.slow', () => work));

      await expect(worker.runJob(claimedJob('test.slow'))).resolves.toBe('failed');

      finishWork();
      await drain(6);

      // The late success must NOT retroactively mark the job succeeded — the
      // row has already been settled by the timeout's failure path.
      expect(completeSucceeded).not.toHaveBeenCalled();
    });

    it('leaves the work untouched when the timeout is disabled with 0', async () => {
      const { worker, registry, completeSucceeded } = makeWorker({ 'jobs.jobTimeoutMs': 0 });

      registry.register(
        handler('test.slow', async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
        })
      );

      await expect(worker.runJob(claimedJob('test.slow'))).resolves.toBe('succeeded');
      expect(completeSucceeded).toHaveBeenCalledTimes(1);
    });

    it('cancels the timeout timer as soon as the job finishes', async () => {
      const { worker, registry } = makeWorker({ 'jobs.jobTimeoutMs': 60_000 });

      registry.register(handler('test.echo', async () => undefined));

      await worker.runJob(claimedJob('test.echo'));

      // A 60-second timer left behind per job is how a busy queue accumulates
      // thousands of them.
      expect((worker as unknown as { timers: Set<unknown> }).timers.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Independent slots
  // ---------------------------------------------------------------------------

  describe('independent slot loops', () => {
    it('does not let a slow job in one slot delay a fast job in another', async () => {
      const { worker, registry, claim, completeSucceeded } = makeWorker({
        'jobs.workerConcurrency': 2,
        'jobs.pollMs': 60_000,
      });

      const finished: string[] = [];

      registry.register(
        handler('test.slow', async () => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          finished.push('test.slow');
        })
      );
      registry.register(
        handler('test.fast', async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          finished.push('test.fast');
        })
      );

      // Slot 0 takes the slow job, slot 1 takes the fast one, and there is
      // nothing else to claim.
      claim
        .mockResolvedValueOnce([claimedJob('test.slow')])
        .mockResolvedValueOnce([claimedJob('test.fast')])
        .mockResolvedValue([]);

      worker.start(2);

      await waitFor(() => finished.includes('test.fast'));

      // THE ASSERTION: the fast job is done while the slow one is still
      // running. Under one loop claiming a batch of two, this array would be
      // empty until the slow job finished — the batch barrier.
      expect(finished).toEqual(['test.fast']);
      expect(completeSucceeded).toHaveBeenCalledTimes(1);

      await worker.stop();

      expect(finished).toEqual(['test.fast', 'test.slow']);
    });

    it('starts exactly as many loops as the configured concurrency', async () => {
      const { worker, claim } = makeWorker({
        'jobs.workerConcurrency': 3,
        'jobs.pollMs': 60_000,
      });

      worker.onApplicationBootstrap();
      await drain();

      // Each loop claims once, finds nothing, and parks in its poll sleep.
      expect(claim).toHaveBeenCalledTimes(3);

      await worker.onModuleDestroy();
    });

    it('is idempotent: a second start does not double the pool', async () => {
      const { worker, claim } = makeWorker({ 'jobs.pollMs': 60_000 });

      worker.start(2);
      worker.start(2);
      await drain();

      expect(claim).toHaveBeenCalledTimes(2);

      await worker.stop();
    });

    it('does not sleep between jobs while the queue still has work', async () => {
      const { worker, registry, claim, completeSucceeded } = makeWorker({
        'jobs.workerConcurrency': 1,
        // A poll interval this long makes the assertion unambiguous: three
        // jobs inside a second is only possible without a sleep between them.
        'jobs.pollMs': 600_000,
      });

      registry.register(handler('test.echo', async () => undefined));

      claim
        .mockResolvedValueOnce([claimedJob('test.echo', { id: 'a' })])
        .mockResolvedValueOnce([claimedJob('test.echo', { id: 'b' })])
        .mockResolvedValueOnce([claimedJob('test.echo', { id: 'c' })])
        .mockResolvedValue([]);

      worker.start(1);
      await waitFor(() => completeSucceeded.mock.calls.length === 3);
      await worker.stop();
    });
  });

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  describe('shutdown', () => {
    it('resolves promptly from a sleeping pool and leaves no timer behind', async () => {
      const { worker, claim } = makeWorker({
        'jobs.workerConcurrency': 3,
        // If shutdown waited a poll interval out, this test would take a
        // minute rather than milliseconds.
        'jobs.pollMs': 60_000,
      });

      worker.start(3);
      await waitFor(() => claim.mock.calls.length === 3);
      await waitFor(() => (worker as unknown as { timers: Set<unknown> }).timers.size === 3);

      const started = Date.now();
      await worker.onModuleDestroy();

      expect(Date.now() - started).toBeLessThan(1_000);
      expect((worker as unknown as { timers: Set<unknown> }).timers.size).toBe(0);
    });

    it('stops claiming immediately', async () => {
      const { worker, claim } = makeWorker({ 'jobs.pollMs': 1 });

      worker.start(1);
      await waitFor(() => claim.mock.calls.length >= 1);
      await worker.stop();

      const callsAtStop = claim.mock.calls.length;
      await drain(8);

      expect(claim.mock.calls.length).toBe(callsAtStop);
    });

    it('is safe to call when the pool never started, and safe to call twice', async () => {
      const { worker } = makeWorker({ 'jobs.workerMode': 'off' });

      worker.onApplicationBootstrap();

      await expect(worker.stop()).resolves.toBeUndefined();
      await expect(worker.stop()).resolves.toBeUndefined();
    });

    it('gives up on a job that outlives the grace rather than blocking the shutdown', async () => {
      const { worker, registry, claim } = makeWorker({
        'jobs.workerConcurrency': 1,
        'jobs.jobTimeoutMs': 0,
      });

      let release: () => void = () => undefined;
      const forever = new Promise<void>((resolve) => {
        release = resolve;
      });

      registry.register(handler('test.hang', () => forever));
      claim.mockResolvedValueOnce([claimedJob('test.hang')]).mockResolvedValue([]);

      worker.start(1);
      await waitFor(() => claim.mock.calls.length >= 1);

      const started = Date.now();
      // A short grace, because the point is that the wait is BOUNDED: the
      // row is left `running` with a lease for the reaper (#263).
      await worker.stop(30);

      expect(Date.now() - started).toBeLessThan(1_000);

      release();
      await drain();
    });

    it('does not start a pool at all when concurrency is zero', async () => {
      const { worker, claim, warn } = makeWorker({ 'jobs.workerConcurrency': 0 });

      worker.onApplicationBootstrap();
      await drain();

      expect(claim).not.toHaveBeenCalled();
      expect(
        warn.mock.calls.some((call) => String(call[0]).includes('JOBS_WORKER_CONCURRENCY'))
      ).toBe(true);

      await worker.onModuleDestroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Defensive configuration
  // ---------------------------------------------------------------------------

  describe('configuration fallbacks', () => {
    it('degrades a missing poll interval to the shipped default, never to NaN', async () => {
      // `setTimeout(NaN)` fires immediately, which would spin the event loop
      // flat out — the reason `configNumber` exists.
      const { worker, claim } = makeWorker({ 'jobs.pollMs': undefined });

      worker.start(1);
      await waitFor(() => claim.mock.calls.length >= 1);
      await drain(8);

      expect(claim.mock.calls.length).toBe(1);

      await worker.stop();
    });
  });
});

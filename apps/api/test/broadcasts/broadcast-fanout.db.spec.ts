// =============================================================================
// Real-Postgres test: the admin broadcast fan-out (issue #326, epic #319)
// =============================================================================
//
// `broadcast-start.handler.spec.ts` and `broadcast-chunk.handler.spec.ts`
// prove the SHAPE of every query the two handlers issue, against hand-built
// mocks. What they cannot prove — the same gap `job-claim.db.spec.ts` exists
// to close for the queue's claim — is that the compare-and-swap in
// `BroadcastStartHandler.process` really does resolve two concurrent
// executions to exactly one winner, that Postgres really does keyset-page the
// audience the way `audienceWhere` assumes, and that the terminal "mark sent"
// CAS in `BroadcastChunkHandler.finish` really cannot overwrite a concurrent
// cancel. A mocked `updateMany` returns whatever the test told it to; only a
// real server executing a real UPDATE under real row locks answers those
// questions, per `docs/specs/notification-broadcasts.md` §11.
//
// THE HANDLERS ARE CONSTRUCTED FOR REAL, over a real `PrismaClient` from
// `createDbClient()`. `JobsService` is ALSO the real class — its `enqueue` is
// nothing but `prisma.job.create` plus the dedup re-read
// (`jobs.service.ts`), so faking it would mean re-implementing the exact
// dedup-key logic this suite needs to prove `skipDedup: true` actually works
// against the real partial unique index, for no benefit. The two collaborators
// mocked are the outward edges the file header of both handlers names as
// deliberately swallowing everything beneath them: `NotificationsService`
// (`notifyNow` would otherwise try to send real email/browser notifications)
// and `JobHandlerRegistry` (`onModuleInit` is never called here — this suite
// drives `process()` directly, exactly like `job-claim.db.spec.ts` drives
// `JobClaimService.claim` directly, so nothing self-registers into a running
// application). `ConfigService` is a bare stub because neither handler under
// test needs `appUrl` for these assertions (no `link`/`ctaLabel` is set on
// any fixture broadcast).
//
// SUCCESSOR CHUNKS ARE DRIVEN BY RE-READING THE REAL `jobs` TABLE, not by
// capturing `JobsService.enqueue`'s return value: after each `process()` call
// this suite looks up the next `pending` `admin.broadcast.chunk` row for the
// broadcast (`nextPendingChunk`) and flips it to `succeeded` once handled
// (`markProcessed`) — a deliberately small stand-in for what the real worker
// does after a handler returns, sufficient to make "keep driving chunks until
// none are pending" a well-defined loop without pulling in the whole queue
// worker.
//
// THIS IS A `*.db.spec.ts` FILE, excluded from `npm test`/`test:unit`/
// `test:cov`/`test:ci` (see `apps/api/package.json`'s
// `testPathIgnorePatterns`) and run only by `npm run test:db` --runInBand,
// which is also what keeps this file from racing any sibling `*.db.spec.ts`
// suite for "all active users" — see the audience-computation note below.
// See `db-test-support.ts` for the reachability probe and for why
// `DATABASE_URL` is stripped before connecting.
// =============================================================================

import { Job, PrismaClient } from '@prisma/client';

import { BroadcastChunkHandler, BROADCAST_CHUNK_TYPE } from '../../src/notifications/broadcasts/handlers/broadcast-chunk.handler';
import { BroadcastStartHandler, BROADCAST_START_TYPE } from '../../src/notifications/broadcasts/handlers/broadcast-start.handler';
import { BROADCAST_CHUNK_SIZE, BROADCAST_SUBJECT_TYPE } from '../../src/notifications/broadcasts/broadcast-audience';
import { JobsService } from '../../src/jobs/jobs.service';
import type { ConfigService } from '@nestjs/config';
import type { JobHandlerRegistry } from '../../src/jobs/job-handler.registry';
import type { ProviderThrottleService } from '../../src/jobs/provider-throttle.service';
import type { NotificationsService } from '../../src/notifications/notifications.service';
import type { NotifyOptions } from '../../src/notifications/notification.types';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { createDbClient, resolveDbSuite } from '../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('broadcast-fanout.db.spec');

/**
 * Every user email and every broadcast `eventKey` this suite creates carries
 * this prefix, so cleanup (`afterEach`) can delete exactly what this suite
 * made — the database is shared with every other `*.db.spec.ts` suite and,
 * locally, may be a developer's seeded dev database. `broadcast-model.db.spec.ts`
 * uses the same `eventKey`-prefix convention.
 */
const PREFIX = `test.broadcast-fanout.${process.pid}.`;
let userCounter = 0;
let eventKeyCounter = 0;

/** A fresh, unique user email under this suite's prefix. */
const nextEmail = (label: string): string => `${PREFIX}${label}-${(userCounter += 1)}@example.test`;

/** A fresh, unique `eventKey`, so `notification_broadcasts` rows are identifiable and cleanable. */
const nextEventKey = (): string => `${PREFIX}${(eventKeyCounter += 1)}`;

/** A no-op `JobHandlerRegistry` stub — this suite calls `process()` directly and never `onModuleInit()`. */
function registryStub(): JobHandlerRegistry {
  return { register: jest.fn() } as unknown as JobHandlerRegistry;
}

/** A `ConfigService` stub. Neither handler needs `appUrl` for any fixture in this suite (no `link` is set). */
function configStub(): ConfigService {
  return { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
}

interface RecordedDispatch {
  eventKey: string;
  userId: string;
  data: unknown;
  options?: NotifyOptions;
}

/** A resolved/rejected pair a test can await, then settle from outside. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * A `NotificationsService` stand-in that records every `notifyNow` dispatch
 * and can pause the call at a chosen 0-based index until the test releases
 * it — the mechanism `it('a chunk still in flight...')` below uses to hold a
 * dispatch open while a concurrent cancel lands in the database.
 */
function makeNotificationsStub() {
  const calls: RecordedDispatch[] = [];
  let callIndex = 0;
  let trap: { at: number; reached: ReturnType<typeof deferred>; gate: ReturnType<typeof deferred> } | null = null;

  const notifyNow = jest.fn(
    async (eventKey: string, userId: string, data: unknown, options?: NotifyOptions) => {
      const current = callIndex;
      callIndex += 1;

      if (trap && trap.at === current) {
        trap.reached.resolve();
        await trap.gate.promise;
      }

      calls.push({ eventKey, userId, data, options });
    }
  );
  const notify = jest.fn();

  return {
    notifications: { notifyNow, notify } as unknown as NotificationsService,
    calls,
    notifyNow,
    notify,
    /**
     * Arranges for the dispatch at `at` to block until `release()` is
     * called, and returns a promise that resolves once that dispatch has
     * actually been reached (so the test does not race the handler to
     * install a trap after the call already passed).
     */
    trapAt(at: number): Promise<void> {
      trap = { at, reached: deferred(), gate: deferred() };
      return trap.reached.promise;
    },
    release(): void {
      trap?.gate.resolve();
    },
    /**
     * Resets BOTH the recorded-dispatch array and the underlying jest mock's
     * own call log. `notifyNow.mockClear()` alone would leave `calls` (the
     * array assertions actually read `userId`s off of) holding every earlier
     * phase's entries — the two must be cleared together or a later phase's
     * assertions silently include recipients from an earlier one.
     */
    clear(): void {
      calls.length = 0;
      notifyNow.mockClear();
    },
  };
}

/** The user ids `notifyNow` was actually called for, in call order. */
const dispatchedIds = (calls: RecordedDispatch[]): string[] => calls.map((call) => call.userId);

describeWithDb('Admin broadcast fan-out (real Postgres)', () => {
  let clientA: PrismaClient;
  let clientB: PrismaClient;
  let jobsA: JobsService;
  let jobsB: JobsService;

  /** Every broadcast id this suite creates, so `afterEach` cleans up exactly these rows and their jobs. */
  let createdBroadcastIds: string[];

  beforeAll(async () => {
    clientA = createDbClient();
    clientB = createDbClient();
    await Promise.all([clientA.$connect(), clientB.$connect()]);
    jobsA = new JobsService(clientA as unknown as PrismaService);
    jobsB = new JobsService(clientB as unknown as PrismaService);
  });

  beforeEach(() => {
    createdBroadcastIds = [];
  });

  afterEach(async () => {
    // Jobs before broadcasts: `Job.subjectId` is a plain, un-FK'd text column
    // (see the `jobs` table comment in CLAUDE.md), so there is no ordering
    // constraint, but jobs are the "trace" of a broadcast and are deleted
    // first purely to mirror that dependency conceptually.
    if (createdBroadcastIds.length > 0) {
      await clientA.job.deleteMany({ where: { subjectId: { in: createdBroadcastIds } } });
      await clientA.notificationBroadcast.deleteMany({ where: { id: { in: createdBroadcastIds } } });
    }
    // Users are cleaned every test, not just at the end of the suite: the
    // audience predicate is "every active user in the database", so a user
    // left behind by one test would silently join the next test's audience.
    await clientA.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  });

  afterAll(async () => {
    await clientA?.job.deleteMany({ where: { subjectType: BROADCAST_SUBJECT_TYPE } }).catch(() => undefined);
    await clientA?.notificationBroadcast
      .deleteMany({ where: { eventKey: { startsWith: PREFIX } } })
      .catch(() => undefined);
    await clientA?.user.deleteMany({ where: { email: { startsWith: PREFIX } } }).catch(() => undefined);
    await Promise.all([clientA?.$disconnect(), clientB?.$disconnect()]);
  });

  /** Creates `count` users under this suite's prefix, all active unless `isActive: false`. */
  async function createUsers(count: number, label: string, isActive = true): Promise<string[]> {
    if (count === 0) {
      return [];
    }
    await clientA.user.createMany({
      data: Array.from({ length: count }, () => ({ email: nextEmail(label), isActive })),
    });
    const rows = await clientA.user.findMany({
      where: { email: { startsWith: `${PREFIX}${label}-` } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** Creates a `scheduled` broadcast and tracks its id for cleanup. */
  async function createBroadcast(overrides: Partial<{ status: string }> = {}) {
    const broadcast = await clientA.notificationBroadcast.create({
      data: {
        title: 'Scheduled maintenance',
        body: 'The application will be briefly unavailable.',
        eventKey: nextEventKey(),
        channels: ['browser'],
        status: (overrides.status ?? 'scheduled') as never,
      },
    });
    createdBroadcastIds.push(broadcast.id);
    return broadcast;
  }

  function startJobFor(broadcastId: string, id = 'start-job'): Job {
    return {
      id,
      type: BROADCAST_START_TYPE,
      subjectType: BROADCAST_SUBJECT_TYPE,
      subjectId: broadcastId,
    } as Job;
  }

  /** The earliest still-`pending` chunk job for `broadcastId`, or `null` once none remain. */
  async function nextPendingChunk(broadcastId: string) {
    return clientA.job.findFirst({
      where: { type: BROADCAST_CHUNK_TYPE, subjectId: broadcastId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Marks a job row `succeeded`, standing in for what the real worker does
   * once a handler's `process()` returns — see the file header for why this
   * suite does not pull in the whole claim/worker machinery to get that one
   * status flip.
   */
  async function markProcessed(jobId: string): Promise<void> {
    await clientA.job.update({ where: { id: jobId }, data: { status: 'succeeded' } });
  }

  /**
   * Drives `chunkHandler` against every pending chunk job for `broadcastId`
   * until none remain, up to a generous safety cap so a regression that
   * makes the chain never terminate fails the test instead of hanging CI.
   */
  async function runChunksToCompletion(
    chunkHandler: BroadcastChunkHandler,
    broadcastId: string,
    maxChunks = 20
  ): Promise<number> {
    let processed = 0;
    for (; processed < maxChunks; processed += 1) {
      const job = await nextPendingChunk(broadcastId);
      if (!job) {
        break;
      }
      await chunkHandler.process(job);
      await markProcessed(job.id);
    }
    return processed;
  }

  function handlersFor(client: PrismaClient, jobs: JobsService, stub = makeNotificationsStub()) {
    const prisma = client as unknown as PrismaService;
    return {
      startHandler: new BroadcastStartHandler(prisma, jobs, registryStub()),
      chunkHandler: new BroadcastChunkHandler(
        prisma,
        stub.notifications,
        jobs,
        configStub(),
        registryStub(),
        { registerProviderKey: jest.fn() } as unknown as ProviderThrottleService
      ),
      stub,
    };
  }

  // ===========================================================================
  // 1. The full fan-out: exactly the active audience, none of the inactive
  // ===========================================================================

  it('dispatches to exactly the active audience as of the cutoff, and none of the inactive users', async () => {
    const activeIds = await createUsers(250, 'active');
    const inactiveIds = await createUsers(10, 'inactive', false);
    const broadcast = await createBroadcast();

    const { startHandler, chunkHandler, stub } = handlersFor(clientA, jobsA);

    await startHandler.process(startJobFor(broadcast.id));

    const afterStart = await clientA.notificationBroadcast.findUniqueOrThrow({
      where: { id: broadcast.id },
    });
    expect(afterStart.status).toBe('sending');
    expect(afterStart.audienceCutoff).toBeInstanceOf(Date);

    // The AUDIENCE THIS SUITE OWNS is exactly `activeIds` + `inactiveIds`, but
    // the predicate under test ("all active users as of the cutoff") also
    // matches whatever active users pre-exist in a shared database (a seeded
    // admin, rows left by another suite). Rather than assume isolation this
    // suite does not have, the expected set is COMPUTED with the same
    // predicate the handlers use, right after the cutoff is fixed — see the
    // task's "robust option" and `audienceWhere`'s own contract.
    const expectedRecipients = await clientA.user.findMany({
      where: { isActive: true, createdAt: { lte: afterStart.audienceCutoff! } },
      select: { id: true },
    });
    const expectedIds = expectedRecipients.map((row) => row.id).sort();

    expect(expectedIds).toEqual(expect.arrayContaining(activeIds));
    for (const inactiveId of inactiveIds) {
      expect(expectedIds).not.toContain(inactiveId);
    }

    const chunksRun = await runChunksToCompletion(chunkHandler, broadcast.id);
    expect(chunksRun).toBeGreaterThan(0);
    // 250 active users guarantees at least two 200-recipient pages.
    expect(chunksRun).toBeGreaterThanOrEqual(2);

    expect(dispatchedIds(stub.calls).sort()).toEqual(expectedIds);
    expect(dispatchedIds(stub.calls).sort()).toEqual(expect.arrayContaining(activeIds.sort()));
    for (const inactiveId of inactiveIds) {
      expect(dispatchedIds(stub.calls)).not.toContain(inactiveId);
    }

    const finished = await clientA.notificationBroadcast.findUniqueOrThrow({
      where: { id: broadcast.id },
    });
    expect(finished.status).toBe('sent');
    expect(finished.recipientsDispatched).toBe(expectedIds.length);
    expect(finished.recipientsTargeted).toBe(expectedIds.length);
    expect(finished.finishedAt).toBeInstanceOf(Date);

    // No successor left dangling once the audience is exhausted.
    expect(await nextPendingChunk(broadcast.id)).toBeNull();
  });

  // ===========================================================================
  // 2. The frozen cutoff excludes a user created mid-fan-out
  // ===========================================================================

  it('excludes a user created after the audience cutoff, even though they are active', async () => {
    await createUsers(5, 'before-cutoff');
    const broadcast = await createBroadcast();
    const { startHandler, chunkHandler, stub } = handlersFor(clientA, jobsA);

    await startHandler.process(startJobFor(broadcast.id));

    // Created strictly after `audienceCutoff` was stamped — the handler's own
    // `createdAt: { lte: cutoff }` clause is the thing under test here, not
    // an artificially back-dated row.
    const [lateUserId] = await createUsers(1, 'after-cutoff');

    await runChunksToCompletion(chunkHandler, broadcast.id);

    expect(dispatchedIds(stub.calls)).not.toContain(lateUserId);

    const finished = await clientA.notificationBroadcast.findUniqueOrThrow({
      where: { id: broadcast.id },
    });
    expect(finished.status).toBe('sent');
    // The late user does not inflate the target snapshot either — it was
    // counted before the user existed.
    expect(finished.recipientsTargeted).toBe(stub.calls.length);
  });

  // ===========================================================================
  // 3. Two concurrent starts: exactly one claim, one stamp, one first chunk
  // ===========================================================================

  it('lets exactly one of two concurrent start executions claim the broadcast', async () => {
    await createUsers(3, 'concurrent-audience');
    const broadcast = await createBroadcast();

    // Two INDEPENDENT connections, like `job-claim.db.spec.ts`'s two
    // claimers — the point is to let Postgres's own row locking resolve the
    // race, not an in-process mutex neither replica of a real deployment
    // would share.
    const { startHandler: startA } = handlersFor(clientA, jobsA);
    const { startHandler: startB } = handlersFor(clientB, jobsB);

    // `Promise.all` genuinely overlaps the two `process()` calls; if either
    // rejected, `Promise.all` would reject and fail this test — which is
    // exactly how "the loser is a clean no-op" is checked, alongside the
    // explicit assertions below.
    await expect(
      Promise.all([
        startA.process(startJobFor(broadcast.id, 'start-a')),
        startB.process(startJobFor(broadcast.id, 'start-b')),
      ])
    ).resolves.toBeDefined();

    const claimed = await clientA.notificationBroadcast.findUniqueOrThrow({
      where: { id: broadcast.id },
    });
    expect(claimed.status).toBe('sending');
    expect(claimed.audienceCutoff).toBeInstanceOf(Date);
    expect(claimed.startedAt).toBeInstanceOf(Date);

    // Exactly one first chunk — a second `updateMany` that matched nothing
    // never reaches the enqueue call at all, so a second chunk here would
    // mean the compare-and-swap let both executions past it.
    const chunkJobs = await clientA.job.findMany({
      where: { type: BROADCAST_CHUNK_TYPE, subjectType: BROADCAST_SUBJECT_TYPE, subjectId: broadcast.id },
    });
    expect(chunkJobs).toHaveLength(1);
  });

  // ===========================================================================
  // 4. A replayed chunk re-pages from the persisted cursor, never earlier
  // ===========================================================================

  it('replaying a chunk after the cursor advanced re-sends only the window after it', async () => {
    const PAGE_ONE_SIZE = BROADCAST_CHUNK_SIZE;
    const PAGE_TWO_SIZE = 20;
    await createUsers(PAGE_ONE_SIZE + PAGE_TWO_SIZE, 'replay-audience');
    const broadcast = await createBroadcast();
    const { startHandler, chunkHandler, stub } = handlersFor(clientA, jobsA);

    await startHandler.process(startJobFor(broadcast.id));

    const firstChunkJob = await nextPendingChunk(broadcast.id);
    expect(firstChunkJob).not.toBeNull();

    // Run the first chunk once — a full 200-recipient page, cursor
    // committed, successor enqueued but not yet run.
    await chunkHandler.process(firstChunkJob!);
    // NOT marked `succeeded` here — the whole point of this test is to hand
    // this exact row to `process()` a second time, standing in for a retry
    // or a lease reclaimed after the executing process died.
    expect(stub.calls).toHaveLength(PAGE_ONE_SIZE);
    const pageOneIds = new Set(dispatchedIds(stub.calls));

    const afterPageOne = await clientA.notificationBroadcast.findUniqueOrThrow({
      where: { id: broadcast.id },
    });
    expect(afterPageOne.status).toBe('sending');
    const cursorAfterPageOne = afterPageOne.cursorUserId;

    // ⚠ THE REPLAY: the SAME job row is handed to `process()` again — the
    // at-least-once scenario the file header of `broadcast-chunk.handler.ts`
    // names explicitly (a retry, or a lease reclaimed after the executing
    // process died). The cursor lives on the BROADCAST, not on the job, so
    // this replay reads the cursor page one just committed and pages from
    // there — page two — rather than resending page one.
    stub.clear();
    await chunkHandler.process(firstChunkJob!);
    // Now settle the row this suite is done replaying, so the lookup below
    // finds the REAL successor rather than this still-`pending` one again.
    await markProcessed(firstChunkJob!.id);

    const replayIds = dispatchedIds(stub.calls);
    expect(replayIds).toHaveLength(PAGE_TWO_SIZE);
    // Nobody from page one is touched again by the replay.
    expect(replayIds.some((id) => pageOneIds.has(id))).toBe(false);

    const afterReplay = await clientA.notificationBroadcast.findUniqueOrThrow({
      where: { id: broadcast.id },
    });
    // The audience is exhausted (page two was short), so the replay itself
    // finished the broadcast without needing the separately-enqueued
    // successor job to run at all.
    expect(afterReplay.status).toBe('sent');
    expect(afterReplay.cursorUserId).not.toBe(cursorAfterPageOne);
    expect(afterReplay.recipientsDispatched).toBe(PAGE_ONE_SIZE + PAGE_TWO_SIZE);

    // The successor job the FIRST run of the chunk enqueued is still sitting
    // there, unrun. Running it too must be a harmless no-op: the audience
    // is exhausted and the broadcast is already `sent`.
    const successor = await nextPendingChunk(broadcast.id);
    expect(successor).not.toBeNull();
    stub.notifyNow.mockClear();
    await chunkHandler.process(successor!);
    await markProcessed(successor!.id);
    expect(stub.notifyNow).not.toHaveBeenCalled();

    const finalState = await clientA.notificationBroadcast.findUniqueOrThrow({
      where: { id: broadcast.id },
    });
    expect(finalState.status).toBe('sent');
    expect(finalState.recipientsDispatched).toBe(PAGE_ONE_SIZE + PAGE_TWO_SIZE);
  });

  // ===========================================================================
  // 5. Cancel between two chunks, and cancel racing an in-flight finish
  // ===========================================================================

  describe('cancellation', () => {
    it('stops the fan-out when a cancel lands between two chunk jobs', async () => {
      const PAGE_ONE_SIZE = BROADCAST_CHUNK_SIZE;
      await createUsers(PAGE_ONE_SIZE + 30, 'cancel-between-audience');
      const broadcast = await createBroadcast();
      const { startHandler, chunkHandler, stub } = handlersFor(clientA, jobsA);

      await startHandler.process(startJobFor(broadcast.id));

      const firstChunkJob = await nextPendingChunk(broadcast.id);
      await chunkHandler.process(firstChunkJob!);
      await markProcessed(firstChunkJob!.id);
      expect(stub.calls).toHaveLength(PAGE_ONE_SIZE);

      // The cancel: the same conditional write `NotificationBroadcastsService
      // .cancel` performs (`CANCELABLE_STATUSES` is `['scheduled', 'sending']`
      // and is not exported, so this restates the shape rather than importing
      // a private constant — see `broadcasts.service.ts`).
      const canceled = await clientA.notificationBroadcast.updateMany({
        where: { id: broadcast.id, status: { in: ['scheduled', 'sending'] } },
        data: { status: 'canceled', canceledAt: new Date() },
      });
      expect(canceled.count).toBe(1);

      const successor = await nextPendingChunk(broadcast.id);
      expect(successor).not.toBeNull();

      stub.notifyNow.mockClear();
      await chunkHandler.process(successor!);
      await markProcessed(successor!.id);

      // The status guard at the top of `process()` — `canceled` is not
      // `sending`, so the chunk sends nothing at all, not even a partial
      // page.
      expect(stub.notifyNow).not.toHaveBeenCalled();

      const finalState = await clientA.notificationBroadcast.findUniqueOrThrow({
        where: { id: broadcast.id },
      });
      expect(finalState.status).toBe('canceled');
      expect(finalState.recipientsDispatched).toBe(PAGE_ONE_SIZE);
      expect(await nextPendingChunk(broadcast.id)).toBeNull();
    });

    it('cannot let a chunk still dispatching flip a concurrently-cancelled broadcast to sent', async () => {
      // A SHORT PAGE (well under `BROADCAST_CHUNK_SIZE`) so the whole audience
      // fits in the dispatch loop's first (and only) sub-group — no mid-page
      // status re-check fires, and the run proceeds straight to `finish()`
      // once every recipient has been dispatched. That is the precise window
      // this test forces a cancel into: the chunk has ALREADY committed to
      // finishing when the row underneath it becomes `canceled`.
      const activeIds = await createUsers(5, 'inflight-audience');
      const broadcast = await createBroadcast();
      const { startHandler, chunkHandler, stub } = handlersFor(clientA, jobsA);

      await startHandler.process(startJobFor(broadcast.id));
      const chunkJob = await nextPendingChunk(broadcast.id);
      expect(chunkJob).not.toBeNull();

      // Block the LAST recipient's dispatch mid-flight — everyone before it
      // has already been "sent" by the time the cancel below is issued.
      const reachedLastDispatch = stub.trapAt(activeIds.length - 1);

      const processPromise = chunkHandler.process(chunkJob!);

      await reachedLastDispatch;

      // The cancel is issued WHILE the chunk is paused inside its last
      // `notifyNow` call — i.e. genuinely concurrently with the chunk's own
      // in-flight work, not sequenced before or after it.
      const canceled = await clientA.notificationBroadcast.updateMany({
        where: { id: broadcast.id, status: { in: ['scheduled', 'sending'] } },
        data: { status: 'canceled', canceledAt: new Date() },
      });
      expect(canceled.count).toBe(1);

      stub.release();
      await processPromise;
      await markProcessed(chunkJob!.id);

      // The dispatch itself still completed for every recipient — cancelling
      // does not un-send a notification already in flight, which is exactly
      // what the handlers' own comments say ("worst case one in-flight
      // sub-group still goes out after the click"). What must NOT have
      // happened is `finish()` overwriting `canceled` with `sent`.
      expect(dispatchedIds(stub.calls).sort()).toEqual([...activeIds].sort());

      const finalState = await clientA.notificationBroadcast.findUniqueOrThrow({
        where: { id: broadcast.id },
      });
      expect(finalState.status).toBe('canceled');
      expect(finalState.finishedAt).toBeNull();
      // The progress counter is still written — it records what was actually
      // sent regardless of how the broadcast ended.
      expect(finalState.recipientsDispatched).toBe(activeIds.length);
      // And no successor was queued once the (short) page was dispatched —
      // `finish()` never enqueues, whichever way its own CAS resolves.
      expect(await nextPendingChunk(broadcast.id)).toBeNull();
    });
  });
});
